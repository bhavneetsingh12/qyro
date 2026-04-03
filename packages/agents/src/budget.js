"use strict";
// QYRO Token Budget & Model Routing
// Read TOKEN_BUDGET.md before modifying this file.
// RULE: check quota before every LLM call. Log usage after every LLM call.
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotaExceededError = exports.PLAN_DAILY_LIMITS = exports.PER_RUN_LIMITS = exports.MODELS = void 0;
exports.getModelForTier = getModelForTier;
exports.getTodayUsage = getTodayUsage;
exports.getPlanLimits = getPlanLimits;
exports.checkQuota = checkQuota;
exports.logUsage = logUsage;
const db_1 = require("@qyro/db");
const drizzle_orm_1 = require("drizzle-orm");
exports.MODELS = {
    cheap: "gpt-4o-mini",
    standard: "gpt-4o",
    premium: "claude-sonnet-4-6",
};
function getModelForTier(tier) {
    return exports.MODELS[tier];
}
exports.PER_RUN_LIMITS = {
    lead_discovery: { maxInput: 1_500, maxOutput: 200, tier: "cheap" },
    research: { maxInput: 4_000, maxOutput: 600, tier: "cheap" },
    outreach: { maxInput: 2_000, maxOutput: 250, tier: "cheap" },
    reply_triage: { maxInput: 1_500, maxOutput: 100, tier: "cheap" },
    booking: { maxInput: 1_500, maxOutput: 150, tier: "standard" },
    client_assistant: { maxInput: 3_000, maxOutput: 400, tier: "cheap" },
    qa_guardrail: { maxInput: 2_000, maxOutput: 200, tier: "cheap" },
    prompt_hygiene: { maxInput: 1_500, maxOutput: 150, tier: "cheap" },
};
exports.PLAN_DAILY_LIMITS = {
    starter: { dailyInputTokens: 50_000, dailyOutputTokens: 20_000 },
    growth: { dailyInputTokens: 200_000, dailyOutputTokens: 80_000 },
    agency: { dailyInputTokens: 800_000, dailyOutputTokens: 300_000 },
};
// ─── Quota error ──────────────────────────────────────────────────────────────
class QuotaExceededError extends Error {
    tenantId;
    agentName;
    used;
    limit;
    tokenType;
    code = "QUOTA_EXCEEDED";
    constructor(tenantId, agentName, used, limit, tokenType) {
        super(`Daily ${tokenType} token quota exceeded for tenant ${tenantId} (agent: ${agentName})`);
        this.tenantId = tenantId;
        this.agentName = agentName;
        this.used = used;
        this.limit = limit;
        this.tokenType = tokenType;
        this.name = "QuotaExceededError";
    }
}
exports.QuotaExceededError = QuotaExceededError;
// ─── Usage helpers ────────────────────────────────────────────────────────────
async function getTodayUsage(tenantId) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [row] = await db_1.db
        .select({
        input: (0, drizzle_orm_1.sql) `COALESCE(SUM(${db_1.usageEvents.inputTokens}), 0)`,
        output: (0, drizzle_orm_1.sql) `COALESCE(SUM(${db_1.usageEvents.outputTokens}), 0)`,
    })
        .from(db_1.usageEvents)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(db_1.usageEvents.tenantId, tenantId), (0, drizzle_orm_1.gte)(db_1.usageEvents.createdAt, todayStart)));
    return { input: Number(row?.input ?? 0), output: Number(row?.output ?? 0) };
}
async function getPlanLimits(tenantId) {
    // Use adminDb — called before RLS context may be set in worker context
    const tenant = await db_1.adminDb.query.tenants.findFirst({ where: (0, drizzle_orm_1.eq)(db_1.tenants.id, tenantId) });
    if (!tenant)
        throw new Error(`Tenant not found: ${tenantId}`);
    const plan = await db_1.adminDb.query.plans.findFirst({ where: (0, drizzle_orm_1.eq)(db_1.plans.name, tenant.plan) });
    if (!plan) {
        // Fall back to PLAN_DAILY_LIMITS constants if plans table row is missing
        return exports.PLAN_DAILY_LIMITS[tenant.plan] ?? exports.PLAN_DAILY_LIMITS.starter;
    }
    return { dailyInputTokens: plan.dailyInputTokens, dailyOutputTokens: plan.dailyOutputTokens };
}
async function checkQuota(tenantId, agentName) {
    const [usage, limits] = await Promise.all([getTodayUsage(tenantId), getPlanLimits(tenantId)]);
    if (usage.input >= limits.dailyInputTokens) {
        throw new QuotaExceededError(tenantId, agentName, usage.input, limits.dailyInputTokens, "input");
    }
    if (usage.output >= limits.dailyOutputTokens) {
        throw new QuotaExceededError(tenantId, agentName, usage.output, limits.dailyOutputTokens, "output");
    }
}
async function logUsage(params) {
    await db_1.db.insert(db_1.usageEvents).values({
        tenantId: params.tenantId,
        agentName: params.agentName,
        model: params.model,
        modelTier: params.modelTier,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cached: params.cached,
        runId: params.runId ?? null,
    });
}
//# sourceMappingURL=budget.js.map