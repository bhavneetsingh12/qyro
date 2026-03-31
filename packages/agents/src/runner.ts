// QYRO Agent Runner
// Every LLM call in the system goes through this. Never call OpenAI directly.

import OpenAI from "openai";
import { getModel, getRunLimits, checkQuota, type PlanName } from "./budget";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Error types ──────────────────────────────────────────────────────────────

export type AgentErrorType =
  | "quota_exceeded"
  | "model_error"
  | "guardrail_blocked"
  | "timeout"
  | "invalid_input"
  | "unknown";

export type AgentResult<T> =
  | { ok: true;  data: T; tokensUsed: { input: number; output: number }; model: string; cachedAt?: string }
  | { ok: false; error: AgentErrorType; retryable: boolean; message: string };

// ─── Context for every agent run ─────────────────────────────────────────────

export interface AgentContext {
  tenantId:   string;
  runId:      string;        // UUID for this invocation — used in usage_events
  agentName:  string;        // must match a key in RUN_LIMITS
  plan:       PlanName;
  dailyUsage: { inputTokensToday: number; outputTokensToday: number };
  onUsageLog: (event: UsageLogEvent) => Promise<void>; // inject your DB logger
}

export interface UsageLogEvent {
  tenantId:     string;
  agentName:    string;
  model:        string;
  inputTokens:  number;
  outputTokens: number;
  cached:       boolean;
  runId:        string;
}

// ─── Core runner ─────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  ctx:          AgentContext;
  systemPrompt: string;
  userMessage:  string;
  history?:     { role: "user" | "assistant"; content: string }[];
  overrideModel?: string; // only for special cases — document why
}

export async function runAgent<T = string>(
  opts: RunAgentOptions,
  parseResponse?: (text: string) => T
): Promise<AgentResult<T>> {
  const { ctx, systemPrompt, userMessage, history = [], overrideModel } = opts;
  
  // 1. Get model + limits
  const model     = overrideModel ?? getModel(ctx.agentName, ctx.plan);
  const limits    = getRunLimits(ctx.agentName);
  
  // 2. Quota check
  const quotaResult = checkQuota(ctx.dailyUsage, ctx.plan, limits.maxInput);
  if (!quotaResult.allowed) {
    return {
      ok: false,
      error: "quota_exceeded",
      retryable: false,
      message: `Daily ${quotaResult.reason.replace("_", " ")} for plan ${ctx.plan}. Used: ${quotaResult.used}, limit: ${quotaResult.limit}`,
    };
  }
  
  // 3. Truncate user message if it exceeds per-run input limit
  const truncatedUserMessage = truncateToTokens(userMessage, limits.maxInput);
  if (truncatedUserMessage.length < userMessage.length) {
    console.warn(`[runner] ${ctx.agentName} input truncated (${ctx.runId})`);
  }
  
  // 4. Build messages
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user",   content: truncatedUserMessage },
  ];
  
  // 5. Call OpenAI
  let completion: OpenAI.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: limits.maxOutput,
      temperature: 0.3, // low temperature for consistency
    });
  } catch (err: unknown) {
    const isTimeout = (err as { code?: string }).code === "ETIMEDOUT";
    return {
      ok: false,
      error: isTimeout ? "timeout" : "model_error",
      retryable: isTimeout,
      message: err instanceof Error ? err.message : "Unknown OpenAI error",
    };
  }
  
  // 6. Log usage
  const inputTokens  = completion.usage?.prompt_tokens    ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  
  await ctx.onUsageLog({
    tenantId:    ctx.tenantId,
    agentName:   ctx.agentName,
    model,
    inputTokens,
    outputTokens,
    cached:      false,
    runId:       ctx.runId,
  });
  
  // 7. Parse and return
  const rawText = completion.choices[0]?.message?.content ?? "";
  
  try {
    const data = parseResponse ? parseResponse(rawText) : (rawText as unknown as T);
    return {
      ok: true,
      data,
      tokensUsed: { input: inputTokens, output: outputTokens },
      model,
    };
  } catch (err) {
    return {
      ok: false,
      error: "model_error",
      retryable: false,
      message: `Failed to parse agent response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── JSON response helper ────────────────────────────────────────────────────

export function parseJson<T>(text: string): T {
  // Strip markdown code fences if the model wrapped the JSON
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

// ─── Cached agent call ────────────────────────────────────────────────────────

export interface CachedAgentOptions<T> extends RunAgentOptions {
  cacheKey:       string;
  cacheTtlSeconds: number;
  redis:          { get: (k: string) => Promise<string | null>; set: (k: string, v: string, ex: number) => Promise<void> };
  parseResponse?: (text: string) => T;
}

export async function runAgentCached<T>(
  opts: CachedAgentOptions<T>
): Promise<AgentResult<T>> {
  const { cacheKey, cacheTtlSeconds, redis, ...runOpts } = opts;
  
  // Check cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached) as T;
      // Log cache hit as a usage event with 0 tokens
      await runOpts.ctx.onUsageLog({
        tenantId:    runOpts.ctx.tenantId,
        agentName:   runOpts.ctx.agentName,
        model:       "cache",
        inputTokens: 0,
        outputTokens: 0,
        cached:      true,
        runId:       runOpts.ctx.runId,
      });
      return { ok: true, data, tokensUsed: { input: 0, output: 0 }, model: "cache", cachedAt: "redis" };
    } catch {
      // Cache entry is corrupt — fall through to LLM
    }
  }
  
  const result = await runAgent<T>(runOpts, opts.parseResponse);
  
  // Store in cache if successful
  if (result.ok) {
    await redis.set(cacheKey, JSON.stringify(result.data), cacheTtlSeconds);
  }
  
  return result;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// Rough character-to-token approximation (4 chars ≈ 1 token for English)
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[truncated]";
}
