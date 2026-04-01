// Quota middleware — checks per-tenant daily token budget before agent calls.
// Usage: router.post("/run", requireClerkAuth, tenantMiddleware, quotaCheck("research"), handler)

import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { adminDb, plans, tenants } from "@qyro/db";
import { eq } from "drizzle-orm";

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  constructor(
    public readonly tenantId: string,
    public readonly agentName: string,
    public readonly used: number,
    public readonly limit: number,
    public readonly tokenType: "input" | "output"
  ) {
    super(`Daily ${tokenType} token quota exceeded for tenant ${tenantId}`);
  }
}

// Returns today's total input + output token consumption for the tenant
async function getTodayUsage(tenantId: string): Promise<{ input: number; output: number }> {
  const result = await adminDb.execute(sql`
    SELECT
      COALESCE(SUM(input_tokens), 0)  AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM usage_events
    WHERE tenant_id = ${tenantId}::uuid
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
  `);
  const row = ((result as unknown as Array<{ input_tokens: string; output_tokens: string }>)[0]) ?? { input_tokens: "0", output_tokens: "0" };
  return {
    input: Number(row.input_tokens),
    output: Number(row.output_tokens),
  };
}

// Returns the plan limits for the tenant
async function getPlanLimits(tenantId: string): Promise<{ dailyInputTokens: number; dailyOutputTokens: number }> {
  const result = await adminDb
    .select({
      dailyInputTokens: plans.dailyInputTokens,
      dailyOutputTokens: plans.dailyOutputTokens,
    })
    .from(tenants)
    .innerJoin(plans, eq(tenants.plan, plans.name))
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!result.length) throw new Error(`No plan found for tenant ${tenantId}`);
  return result[0];
}

// Factory: returns middleware that checks quota before passing to the handler.
// agentName is used only for error reporting and usage_events logging context.
export function quotaCheck(agentName: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(500).json({ error: "tenantMiddleware must precede quotaCheck" });
        return;
      }

      const [usage, limits] = await Promise.all([
        getTodayUsage(tenantId),
        getPlanLimits(tenantId),
      ]);

      if (usage.input >= limits.dailyInputTokens) {
        const err = new QuotaExceededError(
          tenantId, agentName, usage.input, limits.dailyInputTokens, "input"
        );
        res.status(429).json({
          error: err.code,
          message: err.message,
          used: usage.input,
          limit: limits.dailyInputTokens,
          tokenType: "input",
        });
        return;
      }

      if (usage.output >= limits.dailyOutputTokens) {
        const err = new QuotaExceededError(
          tenantId, agentName, usage.output, limits.dailyOutputTokens, "output"
        );
        res.status(429).json({
          error: err.code,
          message: err.message,
          used: usage.output,
          limit: limits.dailyOutputTokens,
          tokenType: "output",
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
