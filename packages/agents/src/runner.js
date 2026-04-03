"use strict";
// QYRO Agent Runner
// Every LLM call in the system goes through this. Never call OpenAI directly.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCompletion = runCompletion;
exports.runStructuredCompletion = runStructuredCompletion;
exports.parseJson = parseJson;
const openai_1 = __importDefault(require("openai"));
const budget_1 = require("./budget");
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
// ─── Core: call OpenAI, check quota, log usage ────────────────────────────────
async function callLLM(ctx, messages) {
    const limits = budget_1.PER_RUN_LIMITS[ctx.agentName];
    const modelTier = limits.tier;
    const model = budget_1.MODELS[modelTier];
    // 1. Quota check (throws QuotaExceededError if over limit)
    try {
        await (0, budget_1.checkQuota)(ctx.tenantId, ctx.agentName);
    }
    catch (err) {
        if (err instanceof budget_1.QuotaExceededError) {
            return {
                ok: false,
                error: { code: "QUOTA_EXCEEDED", message: err.message },
            };
        }
        throw err;
    }
    // 2. Call OpenAI
    let completion;
    try {
        completion = await openai.chat.completions.create({
            model,
            messages,
            max_tokens: limits.maxOutput,
            temperature: 0.3,
        });
    }
    catch (err) {
        const isTimeout = err.code === "ETIMEDOUT";
        return {
            ok: false,
            error: {
                code: isTimeout ? "TIMEOUT" : "MODEL_ERROR",
                message: err instanceof Error ? err.message : "Unknown OpenAI error",
            },
        };
    }
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    // 3. Log usage (fire-and-forget — don't fail the call if logging fails)
    (0, budget_1.logUsage)({
        tenantId: ctx.tenantId,
        agentName: ctx.agentName,
        model,
        modelTier,
        inputTokens,
        outputTokens,
        cached: false,
        runId: ctx.runId,
    }).catch((e) => console.error("[runner] failed to log usage:", e));
    const rawText = completion.choices[0]?.message?.content ?? "";
    return {
        ok: true,
        data: rawText,
        usage: { inputTokens, outputTokens, model, modelTier, cached: false },
    };
}
// ─── runCompletion — plain text response ─────────────────────────────────────
async function runCompletion(ctx, userMessages, systemPrompt) {
    const messages = [
        { role: "system", content: systemPrompt },
        ...userMessages,
    ];
    return callLLM(ctx, messages);
}
// ─── runStructuredCompletion — JSON-parsed response ──────────────────────────
async function runStructuredCompletion(ctx, userMessages, systemPrompt) {
    const result = await runCompletion(ctx, userMessages, systemPrompt);
    if (!result.ok)
        return result;
    try {
        const data = parseJson(result.data);
        return { ok: true, data, usage: result.usage };
    }
    catch (err) {
        return {
            ok: false,
            error: {
                code: "PARSE_ERROR",
                message: `Failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
            },
        };
    }
}
// ─── Utilities ────────────────────────────────────────────────────────────────
function parseJson(text) {
    // Strip markdown code fences if the model wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
}
//# sourceMappingURL=runner.js.map