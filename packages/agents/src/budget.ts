// QYRO Token Budget & Model Routing
// Read TOKEN_BUDGET.md before modifying this file.
// RULE: check quota before every LLM call. Log usage after every LLM call.

import { db, adminDb, usageEvents, tenants, plans } from "@qyro/db";
import { eq, and, gte, sql } from "drizzle-orm";

// ─── Model tiers ──────────────────────────────────────────────────────────────

export type ModelTier = "cheap" | "standard" | "premium";

export const MODELS: Record<ModelTier, string> = {
  cheap:    "gpt-4o-mini",
  standard: "gpt-4o",
  premium:  "claude-sonnet-4-6",
};

export function getModelForTier(tier: ModelTier): string {
  return MODELS[tier];
}

// ─── Per-agent limits (single invocation) ────────────────────────────────────

export type AgentName =
  | "lead_discovery"
  | "research"
  | "outreach"
  | "reply_triage"
  | "booking"
  | "client_assistant"
  | "qa_guardrail"
  | "prompt_hygiene";

export const PER_RUN_LIMITS: Record<AgentName, { maxInput: number; maxOutput: number; tier: ModelTier }> = {
  lead_discovery:   { maxInput: 1_500, maxOutput: 200,  tier: "cheap"    },
  research:         { maxInput: 4_000, maxOutput: 600,  tier: "cheap"    },
  outreach:         { maxInput: 2_000, maxOutput: 250,  tier: "cheap"    },
  reply_triage:     { maxInput: 1_500, maxOutput: 100,  tier: "cheap"    },
  booking:          { maxInput: 1_500, maxOutput: 150,  tier: "standard" },
  client_assistant: { maxInput: 3_000, maxOutput: 400,  tier: "cheap"    },
  qa_guardrail:     { maxInput: 2_000, maxOutput: 200,  tier: "cheap"    },
  prompt_hygiene:   { maxInput: 1_500, maxOutput: 150,  tier: "cheap"    },
};

// ─── Per-plan daily hard limits ───────────────────────────────────────────────

export type Plan = "starter" | "growth" | "agency";

export const PLAN_DAILY_LIMITS: Record<Plan, { dailyInputTokens: number; dailyOutputTokens: number }> = {
  starter: { dailyInputTokens:  50_000, dailyOutputTokens:  20_000 },
  growth:  { dailyInputTokens: 200_000, dailyOutputTokens:  80_000 },
  agency:  { dailyInputTokens: 800_000, dailyOutputTokens: 300_000 },
};

// ─── Quota error ──────────────────────────────────────────────────────────────

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  constructor(
    public readonly tenantId: string,
    public readonly agentName: AgentName,
    public readonly used: number,
    public readonly limit: number,
    public readonly tokenType: "input" | "output",
  ) {
    super(`Daily ${tokenType} token quota exceeded for tenant ${tenantId} (agent: ${agentName})`);
    this.name = "QuotaExceededError";
  }
}

// ─── Usage helpers ────────────────────────────────────────────────────────────

export async function getTodayUsage(tenantId: string): Promise<{ input: number; output: number }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({
      input:  sql<number>`COALESCE(SUM(${usageEvents.inputTokens}), 0)`,
      output: sql<number>`COALESCE(SUM(${usageEvents.outputTokens}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        gte(usageEvents.createdAt, todayStart),
      )
    );

  return { input: Number(row?.input ?? 0), output: Number(row?.output ?? 0) };
}

export async function getPlanLimits(tenantId: string): Promise<{ dailyInputTokens: number; dailyOutputTokens: number }> {
  // Use adminDb — called before RLS context may be set in worker context
  const tenant = await adminDb.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const plan = await adminDb.query.plans.findFirst({ where: eq(plans.name, tenant.plan) });
  if (!plan) {
    // Fall back to PLAN_DAILY_LIMITS constants if plans table row is missing
    return PLAN_DAILY_LIMITS[tenant.plan as Plan] ?? PLAN_DAILY_LIMITS.starter;
  }

  return { dailyInputTokens: plan.dailyInputTokens, dailyOutputTokens: plan.dailyOutputTokens };
}

export async function checkQuota(tenantId: string, agentName: AgentName): Promise<void> {
  const [usage, limits] = await Promise.all([getTodayUsage(tenantId), getPlanLimits(tenantId)]);

  if (usage.input >= limits.dailyInputTokens) {
    throw new QuotaExceededError(tenantId, agentName, usage.input, limits.dailyInputTokens, "input");
  }
  if (usage.output >= limits.dailyOutputTokens) {
    throw new QuotaExceededError(tenantId, agentName, usage.output, limits.dailyOutputTokens, "output");
  }
}

export async function logUsage(params: {
  tenantId:     string;
  agentName:    AgentName;
  model:        string;
  modelTier:    ModelTier;
  inputTokens:  number;
  outputTokens: number;
  cached:       boolean;
  runId?:       string;
}): Promise<void> {
  await db.insert(usageEvents).values({
    tenantId:     params.tenantId,
    agentName:    params.agentName,
    model:        params.model,
    modelTier:    params.modelTier,
    inputTokens:  params.inputTokens,
    outputTokens: params.outputTokens,
    cached:       params.cached,
    runId:        params.runId ?? null,
  });
}
