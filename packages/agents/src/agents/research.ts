// QYRO Research Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: invent business data, call LLM without quota check
// Cache:    Redis 7 days — key research:{tenantId}:{sha256(domain)}
// Model:    cheap (gpt-4o-mini) — summarize website, score urgency, propose pitch angles
// Input:    website homepage (fetched here) + businessName + niche from prospects_raw
// Output:   summary, painPoints[], pitchAngles[], urgencyScore → upserted to prospects_enriched

import { createHash } from "crypto";
import { db } from "@qyro/db";
import { prospectsRaw, prospectsEnriched } from "@qyro/db";
import { eq, and } from "drizzle-orm";
import { redis } from "@qyro/queue";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";

const AGENT: AgentName = "research";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7 days
const FETCH_TIMEOUT_MS  = 5_000;
const MAX_HTML_CHARS    = 8_000;  // truncate before sending to LLM

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResearchInput = {
  tenantId:   string;
  prospectId: string;
  domain:     string;   // may be empty string if unknown
  runId?:     string;
};

export type ResearchOutput = {
  prospectId:   string;
  fromCache:    boolean;
  urgencyScore: number;
};

type ResearchSummary = {
  summary:      string;    // 2-3 sentence business overview
  painPoints:   string[];  // 2-3 likely operational pain points
  pitchAngles:  string[];  // 1-2 angles for pitching QYRO Assist
  urgencyScore: number;    // 1-10
};

// ─── Cache helpers ────────────────────────────────────────────────────────────

function buildCacheKey(tenantId: string, domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `research:${tenantId}:${hash}`;
}

async function getCached(key: string): Promise<ResearchSummary | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResearchSummary;
  } catch {
    return null;
  }
}

async function setCached(key: string, value: ResearchSummary): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
}

// ─── Website fetch + HTML strip ───────────────────────────────────────────────

async function fetchWebsiteText(domain: string): Promise<string | null> {
  for (const protocol of ["https", "http"] as const) {
    try {
      const resp = await fetch(`${protocol}://${domain}`, {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; QyroBot/1.0)" },
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      return stripHtml(html).slice(0, MAX_HTML_CHARS);
    } catch {
      // timeout or connection refused — try next protocol
    }
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── LLM: summarize + score ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sales research assistant for QYRO Assist — an AI chat + missed-call follow-up product for local businesses.
Given a business name, niche, and their website text (if available), return ONLY valid JSON:
{
  "summary":      string,   // 2-3 sentences: what the business does, who they serve
  "painPoints":   string[], // 2-3 likely operational pain points (e.g. missed calls, after-hours inquiries)
  "pitchAngles":  string[], // 1-2 specific angles to pitch QYRO Assist to THIS business
  "urgencyScore": number    // 1-10: how urgently this business likely needs automation (10 = obvious fit)
}
No markdown, no explanation. JSON only.`;

async function summarizeBusiness(
  tenantId:     string,
  businessName: string,
  niche:        string,
  websiteText:  string | null,
  runId?:       string,
): Promise<AgentResult<ResearchSummary>> {
  const userContent = [
    `Business: ${businessName}`,
    `Niche: ${niche}`,
    websiteText
      ? `Website content:\n${websiteText}`
      : "(no website text available — infer from business name and niche only)",
  ].join("\n\n");

  return runStructuredCompletion<ResearchSummary>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: userContent }],
    SYSTEM_PROMPT,
  );
}

// ─── Persist enriched record ──────────────────────────────────────────────────

async function upsertEnriched(params: {
  tenantId:     string;
  prospectId:   string;
  summary:      ResearchSummary;
  fromCache:    boolean;
  cacheKey:     string;
}): Promise<void> {
  await db
    .insert(prospectsEnriched)
    .values({
      tenantId:     params.tenantId,
      prospectId:   params.prospectId,
      summary:      params.summary.summary,
      painPoints:   params.summary.painPoints,
      pitchAngles:  params.summary.pitchAngles,
      urgencyScore: params.summary.urgencyScore,
      fromCache:    params.fromCache,
      cacheKey:     params.cacheKey,
    })
    .onConflictDoUpdate({
      target: [prospectsEnriched.tenantId, prospectsEnriched.prospectId],
      set: {
        summary:      params.summary.summary,
        painPoints:   params.summary.painPoints,
        pitchAngles:  params.summary.pitchAngles,
        urgencyScore: params.summary.urgencyScore,
        fromCache:    params.fromCache,
        cacheKey:     params.cacheKey,
        researchedAt: new Date(),
      },
    });
}

// ─── Main agent function ──────────────────────────────────────────────────────

export async function runResearch(
  input: ResearchInput,
): Promise<AgentResult<ResearchOutput>> {
  const { tenantId, prospectId, domain, runId } = input;

  // 1. Load prospect details — need businessName + niche for LLM context
  const prospect = await db.query.prospectsRaw.findFirst({
    where: and(
      eq(prospectsRaw.tenantId, tenantId),
      eq(prospectsRaw.id, prospectId),
    ),
  });

  if (!prospect) {
    return {
      ok:    false,
      error: { code: "INVALID_INPUT", message: `Prospect not found: ${prospectId}` },
    };
  }

  const normalizedDomain = domain.trim().toLowerCase().replace(/^www\./, "");
  const key = buildCacheKey(tenantId, normalizedDomain);

  // 2. Redis cache check (skip if domain is unknown)
  if (normalizedDomain) {
    const cached = await getCached(key);
    if (cached) {
      await upsertEnriched({ tenantId, prospectId, summary: cached, fromCache: true, cacheKey: key });
      return {
        ok:   true,
        data: { prospectId, fromCache: true, urgencyScore: cached.urgencyScore },
        usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "cheap", cached: true },
      };
    }
  }

  // 3. Fetch website homepage
  const websiteText = normalizedDomain ? await fetchWebsiteText(normalizedDomain) : null;

  // 4. LLM: summarize business + score urgency
  const result = await summarizeBusiness(
    tenantId,
    prospect.businessName,
    prospect.niche ?? "local business",
    websiteText,
    runId,
  );

  if (!result.ok) return result;

  // 5. Cache the summary (fire-and-forget if domain known)
  if (normalizedDomain) {
    setCached(key, result.data).catch((e) =>
      console.error("[research] failed to cache result:", e),
    );
  }

  // 6. Upsert enriched record
  await upsertEnriched({
    tenantId,
    prospectId,
    summary:   result.data,
    fromCache: false,
    cacheKey:  key,
  });

  return {
    ok:   true,
    data: { prospectId, fromCache: false, urgencyScore: result.data.urgencyScore },
    usage: result.usage,
  };
}
