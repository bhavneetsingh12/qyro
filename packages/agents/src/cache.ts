// QYRO Agent Cache Utilities
// Thin wrappers around the @qyro/queue Redis connection.
// Used by the Research Agent and any future agent that caches summaries.
//
// Key format: research:{tenantId}:{sha256(normalizedDomain)[0:16]}
// TTL:        7 days (604800 seconds)
// See docs/TOKEN_BUDGET.md — "Research cache" section.

import { redis } from "@qyro/queue";

const RESEARCH_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7 days

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CachedResearch = {
  summary:      string;
  painPoints:   string[];
  pitchAngles:  string[];
  urgencyScore: number;
};

// ─── Research cache ────────────────────────────────────────────────────────────

export async function getResearchCache(
  cacheKey: string,
): Promise<CachedResearch | null> {
  const raw = await redis.get(cacheKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedResearch;
  } catch {
    return null;
  }
}

export async function setResearchCache(
  cacheKey: string,
  value:    CachedResearch,
): Promise<void> {
  await redis.set(cacheKey, JSON.stringify(value), "EX", RESEARCH_TTL_SECONDS);
}

export async function deleteResearchCache(cacheKey: string): Promise<void> {
  await redis.del(cacheKey);
}

// ─── Health check ──────────────────────────────────────────────────────────────

export async function redisPing(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
