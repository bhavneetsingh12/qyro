// QYRO Lead Discovery Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: invent contacts, scrape Google Maps, auto-send, set consent != unknown
// Sources:  Google Places API (primary), Google Places API (enrichment)
// Model:    cheap (gpt-4o-mini) — used only to parse niche/location into API query params

import { db, adminDb, prospectsRaw } from "@qyro/db";
import { eq, and, or, isNotNull } from "drizzle-orm";
import { researchQueue } from "@qyro/queue";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { enrichEmail } from "./emailEnrichment";
import { type AgentName } from "../budget";

const AGENT: AgentName = "lead_discovery";
const US_STATE_ABBREVIATIONS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
]);

const NICHES_TO_APOLLO_TAGS: Record<string, string[]> = {
  "hospital": ["health_and_medical"],
  "health": ["health_and_medical"],
  "medical": ["health_and_medical"],
  "medspa": ["health_and_medical"],
  "dental": ["health_and_medical"],
  "auto repair": ["automotive"],
  "plumber": ["contractors"],
  "construction": ["construction"],
  "software": ["software"],
  "saas": ["software"],
  "marketing": ["marketing"],
  "legal": ["legal"],
};

function parseLocationHint(location: string) {
  const cleanedLocation = location.replace(/\(.*?\)/g, "").trim();

  const parts = cleanedLocation
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.split(";").map((x) => x.trim()))
    .filter(Boolean);

  if (parts.length === 0) return null;

  // If text includes comma-separated city/state candidates, join pairs.
  if (parts.length === 1) {
    const commaParts = parts[0]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (commaParts.length >= 2) {
      const maybeState = commaParts[commaParts.length - 1].toUpperCase();
      if (US_STATE_ABBREVIATIONS.has(maybeState)) {
        const city = commaParts.slice(0, commaParts.length - 1).join(", ");
        return { city, state: maybeState, country: "US" };
      }
    }

    // fallback: assume entire string is city
    return { city: parts[0], state: "", country: "US" };
  }

  // Multiple entries: use the first entry to infer parsing (LLM fallback still exists).
  const first = parts[0];
  const firstParts = first.split(",").map((x) => x.trim()).filter(Boolean);
  if (firstParts.length >= 2) {
    const maybeState = firstParts[firstParts.length - 1].toUpperCase();
    if (US_STATE_ABBREVIATIONS.has(maybeState)) {
      return { city: firstParts.slice(0, firstParts.length - 1).join(", "), state: maybeState, country: "US" };
    }
  }

  return { city: first, state: "", country: "US" };
}
// ─── Types ────────────────────────────────────────────────────────────────────

export type LeadDiscoveryInput = {
  tenantId:   string;
  niche:      string;       // e.g. "medspa", "dental office", "auto repair shop"
  location:   string;       // e.g. "Hillsboro, OR", "Portland metro"
  maxResults: number;       // max leads to ingest this run
  radius?:    number;       // optional radius in miles for location context
  filters?:   LeadFilters;
  runId?:     string;
};

export type LeadFilters = {
  minEmployees?:    number;
  maxEmployees?:    number;
  minRevenue?:      number;  // USD/year
  maxRevenue?:      number;
  excludeDomains?:  string[];
};

export type LeadDiscoveryOutput = {
  leadsQueued:       number;
  duplicatesSkipped: number;
  sourceBreakdown:   { google: number; places: number };
};

// ─── Apollo API types (subset) ────────────────────────────────────────────────

type ApolloOrganization = {
  id?:                  string;
  name?:                string;
  website_url?:         string;
  phone?:               string;
  primary_domain?:      string;
  estimated_num_employees?: number;
  annual_revenue?:      number;
  raw_address?:         string;
  email?:               string;  // Added for Apollo compatibility
};

type ApolloSearchResponse = {
  organizations?: ApolloOrganization[];
  pagination?:    { total_entries: number };
};

// ─── Google Places API types (subset) ────────────────────────────────────────

type PlacesResult = {
  place_id?:           string;
  name?:               string;
  formatted_phone_number?: string;
  website?:            string;
  formatted_address?:  string;
  vicinity?:           string;
};

type PlacesSearchResponse = {
  results?: PlacesResult[];
  status?:  string;
};

// ─── LLM: parse niche + location into structured API params ──────────────────

type ParsedQuery = {
  industryKeywords:  string[];   // e.g. ["medspa", "medical spa", "aesthetics"]
  city:              string;
  state:             string;     // 2-letter
  country:           string;     // e.g. "US"
  apolloIndustries:  string[];   // Apollo industry slugs, best-effort
};

async function parseNicheAndLocation(
  tenantId: string,
  niche:    string,
  location: string,
  runId?:   string,
): Promise<ParsedQuery | null> {
  const defaultKeywords = niche
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  const locationHint = parseLocationHint(location);
  if (locationHint?.city) {
    const quickParsed: ParsedQuery = {
      industryKeywords: defaultKeywords.length ? defaultKeywords : [niche],
      city: locationHint.city,
      state: locationHint.state,
      country: locationHint.country,
      apolloIndustries: [],
    };

    if (quickParsed.apolloIndustries.length === 0) {
      const normalizedNiche = niche.trim().toLowerCase();
      for (const [key, tags] of Object.entries(NICHES_TO_APOLLO_TAGS)) {
        if (normalizedNiche.includes(key)) {
          quickParsed.apolloIndustries = tags;
        }
      }
    }

    console.debug("[leadDiscovery] quick parse location hint:", {
      niche,
      location,
      quickParsed,
    });

    if (quickParsed.state) {
      return quickParsed;
    }
  }

  const systemPrompt = `You parse niche and location strings into structured API query parameters.
Return ONLY valid JSON matching this TypeScript type:
{
  "industryKeywords":  string[],   // 2-4 search terms for this niche
  "city":              string,
  "state":             string,     // 2-letter US state code
  "country":           string,     // ISO 2-letter, default "US"
  "apolloIndustries":  string[]    // Apollo industry slugs, best-effort
}
No markdown, no explanation. JSON only.`;

  const result = await runStructuredCompletion<ParsedQuery>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: `Niche: "${niche}"\nLocation: "${location}"` }],
    systemPrompt,
  );

  if (!result.ok) {
    console.error("[leadDiscovery] failed to parse niche/location:", result.error);

    if (locationHint?.city) {
      const fallbackIndustries = [] as string[];
      const normalizedNiche = niche.trim().toLowerCase();
      for (const [key, tags] of Object.entries(NICHES_TO_APOLLO_TAGS)) {
        if (normalizedNiche.includes(key)) {
          fallbackIndustries.push(...tags);
          break;
        }
      }

      return {
        industryKeywords: defaultKeywords.length ? defaultKeywords : [niche],
        city: locationHint.city,
        state: locationHint.state,
        country: locationHint.country,
        apolloIndustries: fallbackIndustries,
      };
    }

    return null;
  }

  const parsed = result.data;
  parsed.city = parsed.city?.trim() || locationHint?.city || "";
  parsed.state = parsed.state?.trim() || locationHint?.state || "";
  parsed.country = parsed.country?.trim() || "US";
  parsed.industryKeywords = parsed.industryKeywords?.length
    ? parsed.industryKeywords
    : defaultKeywords;
  parsed.apolloIndustries = parsed.apolloIndustries ?? [];

  if (parsed.apolloIndustries.length === 0) {
    const normalizedNiche = niche.trim().toLowerCase();
    for (const [key, tags] of Object.entries(NICHES_TO_APOLLO_TAGS)) {
      if (normalizedNiche.includes(key)) {
        parsed.apolloIndustries = tags;
        break;
      }
    }
  }

  if (!parsed.city) parsed.city = locationHint?.city || "";

  console.debug("[leadDiscovery] parsed query (LLM):", {
    niche,
    location,
    parsed,
  });

  return parsed;
}

// ─── Google Places API (primary search) ───────────────────────────────────────

async function searchApollo(
  query:      ParsedQuery,
  maxResults: number,
  filters:    LeadFilters,
): Promise<ApolloOrganization[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[leadDiscovery] GOOGLE_PLACES_API_KEY not set — skipping search");
    return [];
  }

  const locationString = query.state
    ? `${query.city}, ${query.state}, ${query.country}`
    : query.city
      ? `${query.city}, ${query.country}`
      : `${query.country}`;

  const textQuery = `${query.industryKeywords.join(" ")} in ${locationString}`;

  const url = `https://places.googleapis.com/v1/places:searchText`;

  const body = {
    textQuery,
    maxResultCount: Math.min(maxResults, 20), // Places API (New) max is 20
  };

  console.debug("[leadDiscovery] searchApollo (Google Places New) request", { textQuery, url, body });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.email,places.id",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error("[leadDiscovery] Google Places API error:", resp.status, await resp.text());
    return [];
  }

  const data = await resp.json() as { places?: Array<any> };

  // Map Google Places (New) results to ApolloOrganization format
  const organizations: ApolloOrganization[] = (data.places ?? []).map((result: any) => ({
    id: result.id,
    name: result.displayName?.text,
    website_url: result.websiteUri,
    phone: result.internationalPhoneNumber,
    primary_domain: result.websiteUri ? normalizeDomain(result.websiteUri) : undefined,
    raw_address: result.formattedAddress,
    email: result.email,  // Added email extraction
  }));

  if (!organizations.length) {
    console.warn("[leadDiscovery] Google Places returned 0 organizations", { locationString, query });
  }

  return organizations;
}

// ─── Google Places API (additional search) ────────────────────────────────────

async function searchPlaces(
  query:      ParsedQuery,
  maxResults: number,
): Promise<PlacesResult[]> {
  // Since we're using Google Places for primary search, skip additional search to avoid duplicates
  return [];
}

// ─── Deduplication ────────────────────────────────────────────────────────────

async function getExistingKeys(tenantId: string): Promise<{ domains: Set<string>; phones: Set<string>; emails: Set<string> }> {
  const rows = await db
    .select({ domain: prospectsRaw.domain, phone: prospectsRaw.phone, email: prospectsRaw.email })
    .from(prospectsRaw)
    .where(
      and(
        eq(prospectsRaw.tenantId, tenantId),
        eq(prospectsRaw.deduped, true),
        or(isNotNull(prospectsRaw.domain), isNotNull(prospectsRaw.phone), isNotNull(prospectsRaw.email)),
      )
    );

  const domains = new Set<string>();
  const phones  = new Set<string>();
  const emails  = new Set<string>();
  for (const row of rows) {
    if (row.domain) domains.add(normalizeDomain(row.domain));
    if (row.phone)  phones.add(normalizePhone(row.phone));
    if (row.email)  emails.add(normalizeEmail(row.email));
  }
  return { domains, phones, emails };
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─── Persist raw leads ────────────────────────────────────────────────────────

type RawLeadInsert = {
  tenantId:     string;
  source:       string;
  sourceId:     string | null;
  businessName: string;
  domain:       string | null;
  phone:        string | null;
  email:        string | null;  // Added email field
  address:      string | null;
  niche:        string;
};

async function insertRawLeads(leads: RawLeadInsert[]): Promise<string[]> {
  if (leads.length === 0) return [];

  const inserted = await db
    .insert(prospectsRaw)
    .values(
      leads.map((l) => ({
        tenantId:     l.tenantId,
        source:       l.source,
        sourceId:     l.sourceId,
        businessName: l.businessName,
        domain:       l.domain,
        phone:        l.phone,
        email:        l.email,  // Added email field
        address:      l.address,
        niche:        l.niche,
        consentState: "unknown" as const,  // NEVER anything else on ingestion
        deduped:      true,                // marked deduped after our check
      }))
    )
    .returning({ id: prospectsRaw.id });

  return inserted.map((r) => r.id);
}

// ─── Main agent function ──────────────────────────────────────────────────────

export async function runLeadDiscovery(
  input: LeadDiscoveryInput,
): Promise<AgentResult<LeadDiscoveryOutput>> {
  const { tenantId, niche, location, radius, maxResults, filters = {}, runId } = input;
  const locationForParsing = radius ? `${location} (within ${radius} mile radius)` : location;

  // 1. Parse niche + location via LLM (cheap model, ≤200 tokens out)
  const parsed = await parseNicheAndLocation(tenantId, niche, locationForParsing, runId);
  if (!parsed) {
    return {
      ok:    false,
      error: { code: "INVALID_INPUT", message: "Failed to parse niche/location into API params" },
    };
  }

  // 2. Fetch from both sources in parallel
  const [apolloResults, placesResults] = await Promise.all([
    searchApollo(parsed, maxResults, filters),
    searchPlaces(parsed, maxResults),
  ]);

  // 3. Build unified candidate list
  type Candidate = {
    source:       "google" | "places";
    sourceId:     string | null;
    businessName: string;
    domain:       string | null;
    phone:        string | null;
    email:        string | null;  // Added email field
    address:      string | null;
  };

  const candidates: Candidate[] = [
    ...apolloResults.map((o) => ({
      source:       "google" as const,
      sourceId:     o.id ?? null,
      businessName: o.name ?? "Unknown",
      domain:       o.primary_domain ?? (o.website_url ? normalizeDomain(o.website_url) : null),
      phone:        o.phone ?? null,
      email:        o.email ?? null,  // Added email extraction
      address:      o.raw_address ?? null,
    })),
    ...placesResults.map((p) => ({
      source:       "places" as const,
      sourceId:     p.place_id ?? null,
      businessName: p.name ?? "Unknown",
      domain:       p.website ? normalizeDomain(p.website) : null,
      phone:        p.formatted_phone_number ?? null,
      email:        null,  // Places API doesn't provide emails
      address:      p.formatted_address ?? p.vicinity ?? null,
    })),
  ];

  // 4. Filter out excluded domains (from filters.excludeDomains)
  const excludeSet = new Set((filters.excludeDomains ?? []).map(normalizeDomain));
  const afterExclude = candidates.filter(
    (c) => !c.domain || !excludeSet.has(c.domain),
  );

  // 5. Deduplicate against existing prospects
  const { domains: existingDomains, phones: existingPhones, emails: existingEmails } = await getExistingKeys(tenantId);

  const newLeads: RawLeadInsert[] = [];
  let duplicatesSkipped = 0;
  const seenDomains = new Set<string>();
  const seenPhones  = new Set<string>();
  const seenEmails  = new Set<string>();

  for (const c of afterExclude) {
    if (newLeads.length >= maxResults) break;

    // Fill email from enrichment provider if we don't already have direct email
    if (!c.email && c.domain) {
      try {
        const enrichment = await enrichEmail(tenantId, c.domain, c.businessName);
        if (enrichment?.email) {
          c.email = enrichment.email;
          console.debug("[leadDiscovery] enriched email", { domain: c.domain, email: c.email, source: enrichment.source });
        }
      } catch (err) {
        console.warn("[leadDiscovery] email enrichment failed", err);
      }
    }

    const domainKey = c.domain ? normalizeDomain(c.domain) : null;
    const phoneKey  = c.phone  ? normalizePhone(c.phone)  : null;
    const emailKey  = c.email  ? normalizeEmail(c.email)  : null;

    const isDuplicate =
      (domainKey && (existingDomains.has(domainKey) || seenDomains.has(domainKey))) ||
      (phoneKey  && (existingPhones.has(phoneKey)  || seenPhones.has(phoneKey))) ||
      (emailKey  && (existingEmails.has(emailKey)  || seenEmails.has(emailKey)));

    if (isDuplicate) {
      duplicatesSkipped++;
      continue;
    }

    if (domainKey) seenDomains.add(domainKey);
    if (phoneKey)  seenPhones.add(phoneKey);
    if (emailKey)  seenEmails.add(emailKey);

    newLeads.push({
      tenantId,
      source:       c.source,
      sourceId:     c.sourceId,
      businessName: c.businessName,
      domain:       domainKey,
      phone:        c.phone,
      email:        c.email,  // Added email field
      address:      c.address,
      niche,
    });
  }

  // 6. Persist new raw leads
  const insertedIds = await insertRawLeads(newLeads);

  // 7. Enqueue Research jobs for each new lead
  const researchJobs = insertedIds.map((prospectId, i) => ({
    name: "research",
    data: {
      tenantId,
      prospectId,
      domain: newLeads[i]!.domain ?? "",
    },
  }));

  if (researchJobs.length > 0) {
    await researchQueue.addBulk(researchJobs);
  }

  // 8. Count breakdown
  const googleCount  = newLeads.filter((l) => l.source === "google").length;
  const placesCount  = newLeads.filter((l) => l.source === "places").length;

  return {
    ok: true,
    data: {
      leadsQueued:       insertedIds.length,
      duplicatesSkipped,
      sourceBreakdown:   { google: googleCount, places: placesCount },
    },
    usage: {
      // Usage was already logged by the LLM call in parseNicheAndLocation.
      // Here we report zeros for the non-LLM portion of the agent.
      inputTokens: 0, outputTokens: 0,
      model: "none", modelTier: "cheap", cached: false,
    },
  };
}
