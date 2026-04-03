// QYRO QA Guardrail Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: pass a message with unresolved placeholders or banned phrases
// MUST NOT: be bypassed — every outbound message goes through this
// Model:    cheap (gpt-4o-mini)
// Input:    tenantId, messageAttemptId, approvedServices, bannedPhrases
// Output:   { verdict: 'pass' | 'block', reason?, flags[] }

import { db } from "@qyro/db";
import { messageAttempts } from "@qyro/db";
import { eq } from "drizzle-orm";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";

const AGENT: AgentName = "qa_guardrail";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type QAInput = {
  tenantId:         string;
  messageAttemptId: string;
  approvedServices: string[];
  bannedPhrases:    string[];
  runId?:           string;
};

export type QADraftInput = {
  tenantId:         string;
  messageText:      string;
  approvedServices: string[];
  bannedPhrases:    string[];
  runId?:           string;
};

export type QAOutput = {
  verdict: "pass" | "block";
  reason?: string;
  flags:   string[];
};

type LLMQAResult = {
  verdict: "pass" | "block";
  reason:  string;
  flags:   string[];
};

// ─── Static checks — no LLM needed ────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

function runStaticChecks(text: string, bannedPhrases: string[]): string[] {
  const flags: string[] = [];

  // Unresolved placeholders
  const unresolved = text.match(PLACEHOLDER_RE) ?? [];
  for (const p of unresolved) {
    flags.push(`unresolved_placeholder:${p}`);
  }

  // Banned phrases (case-insensitive)
  for (const phrase of bannedPhrases) {
    if (phrase && text.toLowerCase().includes(phrase.toLowerCase())) {
      flags.push(`banned_phrase:${phrase}`);
    }
  }

  return flags;
}

// ─── LLM: semantic checks ──────────────────────────────────────────────────────

const QA_SYSTEM = `You are a compliance reviewer for outbound B2B sales messages. Review the message for:
1. Claims about services NOT in the approved services list
2. Misleading statistics or guarantees (e.g. "guaranteed ROI", "100% success rate", "always")
3. Aggressive, pushy, or inappropriate tone for a local business outreach

Return ONLY valid JSON — no markdown, no explanation:
{
  "verdict": "pass"|"block",
  "reason":  string,   // empty string if pass
  "flags":   string[]  // specific issues; empty array if none
}`;

async function runLLMChecks(params: {
  tenantId:         string;
  messageText:      string;
  approvedServices: string[];
  runId?:           string;
}): Promise<AgentResult<LLMQAResult>> {
  const { tenantId, messageText, approvedServices, runId } = params;

  const userContent = [
    `Approved services: ${approvedServices.length > 0 ? approvedServices.join(", ") : "(none specified — flag any specific service claims)"}`,
    `Message:\n${messageText}`,
  ].join("\n\n");

  return runStructuredCompletion<LLMQAResult>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: userContent }],
    QA_SYSTEM,
  );
}

async function evaluateMessage(params: {
  tenantId:         string;
  messageText:      string;
  approvedServices: string[];
  bannedPhrases:    string[];
  runId?:           string;
}): Promise<AgentResult<QAOutput>> {
  const { tenantId, messageText, approvedServices, bannedPhrases, runId } = params;

  // 1. Static checks first — fast, no tokens burned
  const staticFlags = runStaticChecks(messageText, bannedPhrases);

  if (staticFlags.length > 0) {
    return {
      ok:   true,
      data: { verdict: "block", reason: staticFlags[0], flags: staticFlags },
      usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "cheap", cached: false },
    };
  }

  // 2. LLM semantic checks
  const llmResult = await runLLMChecks({
    tenantId,
    messageText,
    approvedServices,
    runId,
  });

  if (!llmResult.ok) return llmResult;

  const { verdict, reason, flags } = llmResult.data;
  return {
    ok:   true,
    data: { verdict, reason: reason || undefined, flags },
    usage: llmResult.usage,
  };
}

export async function runQADraft(input: QADraftInput): Promise<AgentResult<QAOutput>> {
  const { tenantId, messageText, approvedServices, bannedPhrases, runId } = input;

  if (!messageText) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "Message has no text to review" } };
  }

  return evaluateMessage({
    tenantId,
    messageText,
    approvedServices,
    bannedPhrases,
    runId,
  });
}

// ─── Main agent function ───────────────────────────────────────────────────────

export async function runQA(
  input: QAInput,
): Promise<AgentResult<QAOutput>> {
  const { tenantId, messageAttemptId, approvedServices, bannedPhrases, runId } = input;

  // 1. Load the message attempt
  const attempt = await db.query.messageAttempts.findFirst({
    where: eq(messageAttempts.id, messageAttemptId),
  });

  if (!attempt) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Message attempt not found: ${messageAttemptId}` } };
  }

  if (!attempt.messageText) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "Message has no text to review" } };
  }

  const evaluation = await evaluateMessage({
    tenantId,
    messageText: attempt.messageText,
    approvedServices,
    bannedPhrases,
    runId,
  });

  if (!evaluation.ok) return evaluation;
  const { verdict, reason, flags } = evaluation.data;

  // Persist verdict on the existing message attempt
  await db
    .update(messageAttempts)
    .set({
      status:    verdict === "block" ? "blocked_by_qa" : "pending_approval",
      qaVerdict: verdict,
      qaFlags:   flags,
    })
    .where(eq(messageAttempts.id, messageAttemptId));

  return {
    ok:   true,
    data: { verdict, reason: reason || undefined, flags },
    usage: evaluation.usage,
  };
}
