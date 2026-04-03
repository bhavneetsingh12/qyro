"use strict";
// QYRO Lead Discovery Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: invent contacts, scrape Google Maps, auto-send, set consent != unknown
// Sources:  Google Places API (primary), Google Places API (enrichment)
// Model:    cheap (gpt-4o-mini) — used only to parse niche/location into API query params
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLeadDiscovery = runLeadDiscovery;
const db_1 = require("@qyro/db");
const drizzle_orm_1 = require("drizzle-orm");
const queue_1 = require("@qyro/queue");
const runner_1 = require("../runner");
const AGENT = "lead_discovery";
const US_STATE_ABBREVIATIONS = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);
const NICHES_TO_APOLLO_TAGS = {
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
function parseLocationHint(location) {
    const cleanedLocation = location.replace(/\(.*?\)/g, "").trim();
    const parts = cleanedLocation
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => line.split(";").map((x) => x.trim()))
        .filter(Boolean);
    if (parts.length === 0)
        return null;
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
async function parseNicheAndLocation(tenantId, niche, location, runId) {
    const defaultKeywords = niche
        .split(/[\s,]+/)
        .map((k) => k.trim())
        .filter(Boolean);
    const locationHint = parseLocationHint(location);
    if (locationHint?.city) {
        const quickParsed = {
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
    const result = await (0, runner_1.runStructuredCompletion)({ tenantId, agentName: AGENT, runId }, [{ role: "user", content: `Niche: "${niche}"\nLocation: "${location}"` }], systemPrompt);
    if (!result.ok) {
        console.error("[leadDiscovery] failed to parse niche/location:", result.error);
        if (locationHint?.city) {
            const fallbackIndustries = [];
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
        for (const [key, tag] of Object.entries(NICHES_TO_APOLLO_TAGS)) {
            if (normalizedNiche.includes(key)) {
                parsed.apolloIndustries = [tag];
                break;
            }
        }
    }
    if (!parsed.city)
        parsed.city = locationHint?.city || "";
    console.debug("[leadDiscovery] parsed query (LLM):", {
        niche,
        location,
        parsed,
    });
    return parsed;
}
// ─── Google Places API (primary search) ───────────────────────────────────────
async function searchApollo(query, maxResults, filters) {
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
            "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.id",
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        console.error("[leadDiscovery] Google Places API error:", resp.status, await resp.text());
        return [];
    }
    const data = await resp.json();
    // Map Google Places (New) results to ApolloOrganization format
    const organizations = (data.places ?? []).map((result) => ({
        id: result.id,
        name: result.displayName?.text,
        website_url: result.websiteUri,
        phone: result.internationalPhoneNumber,
        primary_domain: result.websiteUri ? normalizeDomain(result.websiteUri) : undefined,
        raw_address: result.formattedAddress,
    }));
    if (!organizations.length) {
        console.warn("[leadDiscovery] Google Places returned 0 organizations", { locationString, query });
    }
    return organizations;
}
// ─── Google Places API (additional search) ────────────────────────────────────
async function searchPlaces(query, maxResults) {
    // Since we're using Google Places for primary search, skip additional search to avoid duplicates
    return [];
}
// ─── Deduplication ────────────────────────────────────────────────────────────
async function getExistingKeys(tenantId) {
    const rows = await db_1.db
        .select({ domain: db_1.prospectsRaw.domain, phone: db_1.prospectsRaw.phone })
        .from(db_1.prospectsRaw)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(db_1.prospectsRaw.tenantId, tenantId), (0, drizzle_orm_1.eq)(db_1.prospectsRaw.deduped, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(db_1.prospectsRaw.domain), (0, drizzle_orm_1.isNotNull)(db_1.prospectsRaw.phone))));
    const domains = new Set();
    const phones = new Set();
    for (const row of rows) {
        if (row.domain)
            domains.add(normalizeDomain(row.domain));
        if (row.phone)
            phones.add(normalizePhone(row.phone));
    }
    return { domains, phones };
}
function normalizeDomain(raw) {
    return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}
function normalizePhone(raw) {
    return raw.replace(/\D/g, "");
}
async function insertRawLeads(leads) {
    if (leads.length === 0)
        return [];
    const inserted = await db_1.db
        .insert(db_1.prospectsRaw)
        .values(leads.map((l) => ({
        tenantId: l.tenantId,
        source: l.source,
        sourceId: l.sourceId,
        businessName: l.businessName,
        domain: l.domain,
        phone: l.phone,
        address: l.address,
        niche: l.niche,
        consentState: "unknown", // NEVER anything else on ingestion
        deduped: true, // marked deduped after our check
    })))
        .returning({ id: db_1.prospectsRaw.id });
    return inserted.map((r) => r.id);
}
// ─── Main agent function ──────────────────────────────────────────────────────
async function runLeadDiscovery(input) {
    const { tenantId, niche, location, radius, maxResults, filters = {}, runId } = input;
    const locationForParsing = radius ? `${location} (within ${radius} mile radius)` : location;
    // 1. Parse niche + location via LLM (cheap model, ≤200 tokens out)
    const parsed = await parseNicheAndLocation(tenantId, niche, locationForParsing, runId);
    if (!parsed) {
        return {
            ok: false,
            error: { code: "INVALID_INPUT", message: "Failed to parse niche/location into API params" },
        };
    }
    // 2. Fetch from both sources in parallel
    const [apolloResults, placesResults] = await Promise.all([
        searchApollo(parsed, maxResults, filters),
        searchPlaces(parsed, maxResults),
    ]);
    const candidates = [
        ...apolloResults.map((o) => ({
            source: "google",
            sourceId: o.id ?? null,
            businessName: o.name ?? "Unknown",
            domain: o.primary_domain ?? (o.website_url ? normalizeDomain(o.website_url) : null),
            phone: o.phone ?? null,
            address: o.raw_address ?? null,
        })),
        ...placesResults.map((p) => ({
            source: "places",
            sourceId: p.place_id ?? null,
            businessName: p.name ?? "Unknown",
            domain: p.website ? normalizeDomain(p.website) : null,
            phone: p.formatted_phone_number ?? null,
            address: p.formatted_address ?? p.vicinity ?? null,
        })),
    ];
    // 4. Filter out excluded domains (from filters.excludeDomains)
    const excludeSet = new Set((filters.excludeDomains ?? []).map(normalizeDomain));
    const afterExclude = candidates.filter((c) => !c.domain || !excludeSet.has(c.domain));
    // 5. Deduplicate against existing prospects
    const { domains: existingDomains, phones: existingPhones } = await getExistingKeys(tenantId);
    const newLeads = [];
    let duplicatesSkipped = 0;
    const seenDomains = new Set();
    const seenPhones = new Set();
    for (const c of afterExclude) {
        if (newLeads.length >= maxResults)
            break;
        const domainKey = c.domain ? normalizeDomain(c.domain) : null;
        const phoneKey = c.phone ? normalizePhone(c.phone) : null;
        const isDuplicate = (domainKey && (existingDomains.has(domainKey) || seenDomains.has(domainKey))) ||
            (phoneKey && (existingPhones.has(phoneKey) || seenPhones.has(phoneKey)));
        if (isDuplicate) {
            duplicatesSkipped++;
            continue;
        }
        if (domainKey)
            seenDomains.add(domainKey);
        if (phoneKey)
            seenPhones.add(phoneKey);
        newLeads.push({
            tenantId,
            source: c.source,
            sourceId: c.sourceId,
            businessName: c.businessName,
            domain: domainKey,
            phone: c.phone,
            address: c.address,
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
            domain: newLeads[i].domain ?? "",
        },
    }));
    if (researchJobs.length > 0) {
        await queue_1.researchQueue.addBulk(researchJobs);
    }
    // 8. Count breakdown
    const googleCount = newLeads.filter((l) => l.source === "google").length;
    const placesCount = newLeads.filter((l) => l.source === "places").length;
    return {
        ok: true,
        data: {
            leadsQueued: insertedIds.length,
            duplicatesSkipped,
            sourceBreakdown: { google: googleCount, places: placesCount },
        },
        usage: {
            // Usage was already logged by the LLM call in parseNicheAndLocation.
            // Here we report zeros for the non-LLM portion of the agent.
            inputTokens: 0, outputTokens: 0,
            model: "none", modelTier: "cheap", cached: false,
        },
    };
}
//# sourceMappingURL=leadDiscovery.js.map