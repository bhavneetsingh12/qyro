export type ModelTier = "cheap" | "standard" | "premium";
export declare const MODELS: Record<ModelTier, string>;
export declare function getModelForTier(tier: ModelTier): string;
export type AgentName = "lead_discovery" | "research" | "outreach" | "reply_triage" | "booking" | "client_assistant" | "qa_guardrail" | "prompt_hygiene";
export declare const PER_RUN_LIMITS: Record<AgentName, {
    maxInput: number;
    maxOutput: number;
    tier: ModelTier;
}>;
export type Plan = "starter" | "growth" | "agency";
export declare const PLAN_DAILY_LIMITS: Record<Plan, {
    dailyInputTokens: number;
    dailyOutputTokens: number;
}>;
export declare class QuotaExceededError extends Error {
    readonly tenantId: string;
    readonly agentName: AgentName;
    readonly used: number;
    readonly limit: number;
    readonly tokenType: "input" | "output";
    readonly code: "QUOTA_EXCEEDED";
    constructor(tenantId: string, agentName: AgentName, used: number, limit: number, tokenType: "input" | "output");
}
export declare function getTodayUsage(tenantId: string): Promise<{
    input: number;
    output: number;
}>;
export declare function getPlanLimits(tenantId: string): Promise<{
    dailyInputTokens: number;
    dailyOutputTokens: number;
}>;
export declare function checkQuota(tenantId: string, agentName: AgentName): Promise<void>;
export declare function logUsage(params: {
    tenantId: string;
    agentName: AgentName;
    model: string;
    modelTier: ModelTier;
    inputTokens: number;
    outputTokens: number;
    cached: boolean;
    runId?: string;
}): Promise<void>;
//# sourceMappingURL=budget.d.ts.map