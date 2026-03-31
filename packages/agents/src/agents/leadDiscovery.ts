// QYRO Lead Discovery Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: invent contacts, scrape Google Maps, auto-send, set consent != unknown
// Sources:  Apollo API (primary), Google Places API (enrichment)
// Model:    cheap (gpt-4o-mini) — used only to parse niche/location into API query params

import { db, adminDb, prospectsRaw } from "@qyro/db";
import { eq, and, or, isNotNull } from "drizzle-orm";
import { researchQueue } from "@qyro/queue";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";

const AGENT: AgentName = "lead_discovery";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeadDiscoveryInput = {
  tenantId:   string;
  niche:      string;       // e.g. "medspa", "dental office", "auto repair shop"
  location:   string;       // e.g. "Hillsboro, OR", "Portland metro"
  maxResults: number;       // max leads to ingest this run
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
  sourceBreakdown:   { apollo: number; places: number };
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
  const systemPrompt = `You parse niche and location strings into structured API query parameters.
Return ONLY valid JSON matching this TypeScript type:
{
  "industryKeywords":  string[],   // 2-4 search terms for this niche
  "city":              string,
  "state":             string,     // 2-letter US state code
  "country":           string,     // ISO 2-letter, default "US"
  "apolloIndustries":  string[]    // Apollo industry slugs, best-effort, e.g. ["health_and_medical"]
}
No markdown, no explanation. JSON only.`;

  const result = await runStructuredCompletion<ParsedQuery>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: `Niche: "${niche}"\nLocation: "${location}"` }],
    systemPrompt,
  );

  if (!result.ok) {
    console.error("[leadDiscovery] failed to parse niche/location:", result.error);
    return null;
  }
  return result.data;
}

// ─── Apollo API ───────────────────────────────────────────────────────────────

async function searchApollo(
  query:      ParsedQuery,
  maxResults: number,
  filters:    LeadFilters,
): Promise<ApolloOrganization[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.warn("[leadDiscovery] APOLLO_API_KEY not set — skipping Apollo");
    return [];
  }

  const body: Record<string, unknown> = {
    api_key:                  apiKey,
    q_organization_keyword_tags: query.industryKeywords,
    organization_locations:   [`${query.city}, ${query.state}, ${query.country}`],
    page:                     1,
    per_page:                 Math.min(maxResults, 25),
  };

  if (filters.minEmployees != null || filters.maxEmployees != null) {
    body.organization_num_employees_ranges = [
      `${filters.minEmployees ?? 1},${filters.maxEmployees ?? 10000}`,
    ];
  }

  const resp = await fetch("https://api.apollo.io/v1/mixed_companies/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error("[leadDiscovery] Apollo API error:", resp.status, await resp.text());
    return [];
  }

  const data = (await resp.json()) as ApolloSearchResponse;
  return data.organizations ?? [];
}

// ─── Google Places API ────────────────────────────────────────────────────────

async function searchPlaces(
  query:      ParsedQuery,
  maxResults: number,
): Promise<PlacesResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[leadDiscovery] GOOGLE_PLACES_API_KEY not set — skipping Places");
    return [];
  }

  const textQuery = encodeURIComponent(
    `${query.industryKeywords[0] ?? query.industryKeywords.join(" ")} in ${query.city} ${query.state}`,
  );

  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${textQuery}&key=${apiKey}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    console.error("[leadDiscovery] Places API error:", resp.status, await resp.text());
    return [];
  }

  const data = (await resp.json()) as PlacesSearchResponse;
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.error("[leadDiscovery] Places API status:", data.status);
    return [];
  }

  return (data.results ?? []).slice(0, maxResults);
}

// ─── Deduplication ────────────────────────────────────────────────────────────

async function getExistingKeys(tenantId: string): Promise<{ domains: Set<string>; phones: Set<string> }> {
  const rows = await db
    .select({ domain: prospectsRaw.domain, phone: prospectsRaw.phone })
    .from(prospectsRaw)
    .where(
      and(
        eq(prospectsRaw.tenantId, tenantId),
        eq(prospectsRaw.deduped, true),
        or(isNotNull(prospectsRaw.domain), isNotNull(prospectsRaw.phone)),
      )
    );

  const domains = new Set<string>();
  const phones  = new Set<string>();
  for (const row of rows) {
    if (row.domain) domains.add(normalizeDomain(row.domain));
    if (row.phone)  phones.add(normalizePhone(row.phone));
  }
  return { domains, phones };
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

// ─── Persist raw leads ────────────────────────────────────────────────────────

type RawLeadInsert = {
  tenantId:     string;
  source:       string;
  sourceId:     string | null;
  businessName: string;
  domain:       string | null;
  phone:        string | null;
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
  const { tenantId, niche, location, maxResults, filters = {}, runId } = input;

  // 1. Parse niche + location via LLM (cheap model, ≤200 tokens out)
  const parsed = await parseNicheAndLocation(tenantId, niche, location, runId);
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
    source:       "apollo" | "places";
    sourceId:     string | null;
    businessName: string;
    domain:       string | null;
    phone:        string | null;
    address:      string | null;
  };

  const candidates: Candidate[] = [
    ...apolloResults.map((o) => ({
      source:       "apollo" as const,
      sourceId:     o.id ?? null,
      businessName: o.name ?? "Unknown",
      domain:       o.primary_domain ?? (o.website_url ? normalizeDomain(o.website_url) : null),
      phone:        o.phone ?? null,
      address:      o.raw_address ?? null,
    })),
    ...placesResults.map((p) => ({
      source:       "places" as const,
      sourceId:     p.place_id ?? null,
      businessName: p.name ?? "Unknown",
      domain:       p.website ? normalizeDomain(p.website) : null,
      phone:        p.formatted_phone_number ?? null,
      address:      p.formatted_address ?? p.vicinity ?? null,
    })),
  ];

  // 4. Filter out excluded domains (from filters.excludeDomains)
  const excludeSet = new Set((filters.excludeDomains ?? []).map(normalizeDomain));
  const afterExclude = candidates.filter(
    (c) => !c.domain || !excludeSet.has(c.domain),
  );

  // 5. Deduplicate against existing prospects
  const { domains: existingDomains, phones: existingPhones } = await getExistingKeys(tenantId);

  const newLeads: RawLeadInsert[] = [];
  let duplicatesSkipped = 0;
  const seenDomains = new Set<string>();
  const seenPhones  = new Set<string>();

  for (const c of afterExclude) {
    if (newLeads.length >= maxResults) break;

    const domainKey = c.domain ? normalizeDomain(c.domain) : null;
    const phoneKey  = c.phone  ? normalizePhone(c.phone)  : null;

    const isDuplicate =
      (domainKey && (existingDomains.has(domainKey) || seenDomains.has(domainKey))) ||
      (phoneKey  && (existingPhones.has(phoneKey)  || seenPhones.has(phoneKey)));

    if (isDuplicate) {
      duplicatesSkipped++;
      continue;
    }

    if (domainKey) seenDomains.add(domainKey);
    if (phoneKey)  seenPhones.add(phoneKey);

    newLeads.push({
      tenantId,
      source:       c.source,
      sourceId:     c.sourceId,
      businessName: c.businessName,
      domain:       domainKey,
      phone:        c.phone,
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
  const apolloCount  = newLeads.filter((l) => l.source === "apollo").length;
  const placesCount  = newLeads.filter((l) => l.source === "places").length;

  return {
    ok: true,
    data: {
      leadsQueued:       insertedIds.length,
      duplicatesSkipped,
      sourceBreakdown:   { apollo: apolloCount, places: placesCount },
    },
    usage: {
      // Usage was already logged by the LLM call in parseNicheAndLocation.
      // Here we report zeros for the non-LLM portion of the agent.
      inputTokens: 0, outputTokens: 0,
      model: "none", modelTier: "cheap", cached: false,
    },
  };
}
