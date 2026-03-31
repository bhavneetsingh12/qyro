// QYRO Agent Runner
// Every LLM call in the system goes through this. Never call OpenAI directly.

import OpenAI from "openai";
import {
  checkQuota,
  logUsage,
  MODELS,
  PER_RUN_LIMITS,
  QuotaExceededError,
  type AgentName,
  type ModelTier,
} from "./budget";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentContext = {
  tenantId:  string;
  agentName: AgentName;
  runId?:    string;
};

export type AgentUsage = {
  inputTokens:  number;
  outputTokens: number;
  model:        string;
  modelTier:    ModelTier;
  cached:       boolean;
};

export type AgentResult<T> =
  | { ok: true;  data: T;   usage: AgentUsage }
  | { ok: false; error: { code: string; message: string } };

// ─── Core: call OpenAI, check quota, log usage ────────────────────────────────

async function callLLM(
  ctx: AgentContext,
  messages: OpenAI.ChatCompletionMessageParam[],
): Promise<AgentResult<string>> {
  const limits    = PER_RUN_LIMITS[ctx.agentName];
  const modelTier = limits.tier;
  const model     = MODELS[modelTier];

  // 1. Quota check (throws QuotaExceededError if over limit)
  try {
    await checkQuota(ctx.tenantId, ctx.agentName);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return {
        ok:    false,
        error: { code: "QUOTA_EXCEEDED", message: err.message },
      };
    }
    throw err;
  }

  // 2. Call OpenAI
  let completion: OpenAI.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens:  limits.maxOutput,
      temperature: 0.3,
    });
  } catch (err: unknown) {
    const isTimeout = (err as { code?: string }).code === "ETIMEDOUT";
    return {
      ok:    false,
      error: {
        code:    isTimeout ? "TIMEOUT" : "MODEL_ERROR",
        message: err instanceof Error ? err.message : "Unknown OpenAI error",
      },
    };
  }

  const inputTokens  = completion.usage?.prompt_tokens    ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;

  // 3. Log usage (fire-and-forget — don't fail the call if logging fails)
  logUsage({
    tenantId:     ctx.tenantId,
    agentName:    ctx.agentName,
    model,
    modelTier,
    inputTokens,
    outputTokens,
    cached:       false,
    runId:        ctx.runId,
  }).catch((e) => console.error("[runner] failed to log usage:", e));

  const rawText = completion.choices[0]?.message?.content ?? "";

  return {
    ok:   true,
    data: rawText,
    usage: { inputTokens, outputTokens, model, modelTier, cached: false },
  };
}

// ─── runCompletion — plain text response ─────────────────────────────────────

export async function runCompletion(
  ctx:          AgentContext,
  userMessages: { role: "user" | "assistant"; content: string }[],
  systemPrompt: string,
): Promise<AgentResult<string>> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  return callLLM(ctx, messages);
}

// ─── runStructuredCompletion — JSON-parsed response ──────────────────────────

export async function runStructuredCompletion<T>(
  ctx:          AgentContext,
  userMessages: { role: "user" | "assistant"; content: string }[],
  systemPrompt: string,
): Promise<AgentResult<T>> {
  const result = await runCompletion(ctx, userMessages, systemPrompt);
  if (!result.ok) return result;

  try {
    const data = parseJson<T>(result.data);
    return { ok: true, data, usage: result.usage };
  } catch (err) {
    return {
      ok:    false,
      error: {
        code:    "PARSE_ERROR",
        message: `Failed to parse JSON response: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function parseJson<T>(text: string): T {
  // Strip markdown code fences if the model wrapped the JSON
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as T;
}
