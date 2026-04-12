// Redis-backed sliding window rate limiting middleware.
// Applied to all authenticated API routes.
//
// Tiers:
//   general  — 100/min, 1000/hour, 10000/day  (all authenticated routes)
//   heavy    — 30/min, 200/hour               (leads list, calls, transcripts)
//   export   — 5/hour, 20/day                 (CSV export endpoints)

import type { RequestHandler } from "express";
import { db } from "@qyro/db";
import { rateLimitHits } from "@qyro/db";
import { redis } from "@qyro/queue";

export type RateLimitTier = "general" | "heavy" | "export";
export type RateLimitFailureMode = "fail-open" | "fail-closed";
export type RateLimitScope = "tenant" | "ip";

interface RateLimitOptions {
  failureMode?: RateLimitFailureMode;
  scope?: RateLimitScope;
}

interface RateLimitWindow {
  key: string;
  limit: number;
  ttlSeconds: number;
  limitType: string;
}

const TIER_WINDOWS: Record<RateLimitTier, RateLimitWindow[]> = {
  general: [
    { key: "min",  limit: 100,    ttlSeconds: 60,     limitType: "general_min"  },
    { key: "hour", limit: 1_000,  ttlSeconds: 3_600,  limitType: "general_hour" },
    { key: "day",  limit: 10_000, ttlSeconds: 86_400, limitType: "general_day"  },
  ],
  heavy: [
    { key: "min",  limit: 30,  ttlSeconds: 60,    limitType: "heavy_min"  },
    { key: "hour", limit: 200, ttlSeconds: 3_600, limitType: "heavy_hour" },
  ],
  export: [
    { key: "hour", limit: 5,  ttlSeconds: 3_600,  limitType: "export_hour" },
    { key: "day",  limit: 20, ttlSeconds: 86_400, limitType: "export_day"  },
  ],
};

function getRequestIp(req: Parameters<RequestHandler>[0]): string {
  return (req as any).ip || (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress || "unknown";
}

async function logRateLimitHit(tenantId: string, endpoint: string, limitType: string, ip: string) {
  try {
    await db.insert(rateLimitHits).values({ tenantId, endpoint, limitType, ipAddress: ip });
  } catch {
    console.warn(`[rateLimit] failed to log rate limit hit for tenant ${tenantId}`);
  }
}

/**
 * Returns a middleware that enforces the given rate limit tier per tenant.
 * Skips if tenantId is not yet set on req.
 */
export function rateLimit(tier: RateLimitTier): RequestHandler {
  return rateLimitWithOptions(tier, {});
}

export function rateLimitWithOptions(tier: RateLimitTier, options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const failureMode = options.failureMode ?? (process.env.NODE_ENV === "production" ? "fail-closed" : "fail-open");
    const scope = options.scope ?? "tenant";

    const tenantId: string | undefined = (req as any).tenantId;
    const scopeKey = scope === "ip" ? getRequestIp(req) : tenantId;
    if (!scopeKey) {
      next();
      return;
    }

    const endpoint = req.path;
    const windows = TIER_WINDOWS[tier];

    for (const win of windows) {
      const redisKey = `rl:${tier}:${scope}:${win.key}:${scopeKey}`;
      let count: number;
      try {
        count = await redis.incr(redisKey);
        if (count === 1) {
          await redis.expire(redisKey, win.ttlSeconds);
        }
      } catch {
        if (failureMode === "fail-closed") {
          const retryAfter = 30;
          res.setHeader("Retry-After", String(retryAfter));
          res.status(503).json({
            error: "RATE_LIMIT_UNAVAILABLE",
            message: "Rate limiting is temporarily unavailable. Please retry shortly.",
            retryAfter,
          });
          return;
        }

        console.warn(`[rateLimit] Redis error on key ${redisKey}, failing open`);
        next();
        return;
      }

      if (count > win.limit) {
        const ip = getRequestIp(req);
        if (tenantId) {
          void logRateLimitHit(tenantId, endpoint, win.limitType, ip);
        }

        const retryAfter = win.ttlSeconds;
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-RateLimit-Limit", String(win.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + retryAfter));

        res.status(429).json({
          error: "RATE_LIMIT_EXCEEDED",
          message: `Too many requests. Limit: ${win.limit} per ${win.key}. Retry after ${retryAfter}s.`,
          retryAfter,
        });
        return;
      }
    }

    next();
  };
}
