import { type AgentName, type ModelTier } from "./budget";
export type AgentContext = {
    tenantId: string;
    agentName: AgentName;
    runId?: string;
};
export type AgentUsage = {
    inputTokens: number;
    outputTokens: number;
    model: string;
    modelTier: ModelTier;
    cached: boolean;
};
export type AgentResult<T> = {
    ok: true;
    data: T;
    usage: AgentUsage;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
export declare function runCompletion(ctx: AgentContext, userMessages: {
    role: "user" | "assistant";
    content: string;
}[], systemPrompt: string): Promise<AgentResult<string>>;
export declare function runStructuredCompletion<T>(ctx: AgentContext, userMessages: {
    role: "user" | "assistant";
    content: string;
}[], systemPrompt: string): Promise<AgentResult<T>>;
export declare function parseJson<T>(text: string): T;
//# sourceMappingURL=runner.d.ts.map