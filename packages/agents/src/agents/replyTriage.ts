// QYRO Reply Triage Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: send any reply itself
// MUST NOT: override an unsubscribe classification
// MUST:     err toward false positive on unsubscribe signals
// Model:    cheap (gpt-4o-mini)
// Input:    tenantId, messageId, replyText
// Output:   { classification, nextAction, addedToDNC }

import { db } from "@qyro/db";
import {
  messageAttempts, prospectsRaw, doNotContact,
} from "@qyro/db";
import { eq, and } from "drizzle-orm";
import { runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";

const AGENT: AgentName = "reply_triage";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ReplyTriageInput = {
  tenantId:  string;
  messageId: string;
  replyText: string;
  runId?:    string;
};

export type Classification =
  | "interested"
  | "neutral"
  | "not_now"
  | "unsubscribe"
  | "angry"
  | "question";

export type NextAction =
  | "book_call"
  | "send_followup"
  | "add_to_dnc"
  | "escalate_human"
  | "no_action";

export type ReplyTriageOutput = {
  classification: Classification;
  nextAction:     NextAction;
  addedToDNC:     boolean;
};

type LLMTriageResult = {
  classification: Classification;
  nextAction:     NextAction;
};

// ─── Classification → next action ─────────────────────────────────────────────

const ACTION_MAP: Record<Classification, NextAction> = {
  interested:  "book_call",
  neutral:     "send_followup",
  not_now:     "send_followup",
  unsubscribe: "add_to_dnc",
  angry:       "escalate_human",
  question:    "escalate_human",
};

// ─── LLM: classify reply ───────────────────────────────────────────────────────

const TRIAGE_SYSTEM = `You are a sales reply classifier. Classify this inbound reply into EXACTLY one of these categories:
- interested:   prospect wants to move forward — asks for demo, call, or pricing
- neutral:      acknowledges message but no clear intent either way
- not_now:      declines now but not permanently (e.g. "maybe next quarter")
- unsubscribe:  ANY signal of wanting to stop contact (opt-out, remove me, stop, unsubscribe, not interested)
- angry:        hostile, threatening, or very negative tone
- question:     asks a specific question about the product or service

IMPORTANT: When in doubt between unsubscribe and another category, choose unsubscribe.

Return ONLY valid JSON — no markdown, no explanation:
{
  "classification": "interested"|"neutral"|"not_now"|"unsubscribe"|"angry"|"question",
  "nextAction":     "book_call"|"send_followup"|"add_to_dnc"|"escalate_human"|"no_action"
}`;

async function classifyReply(
  tenantId:  string,
  replyText: string,
  runId?:    string,
): Promise<AgentResult<LLMTriageResult>> {
  return runStructuredCompletion<LLMTriageResult>(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: `Reply:\n"${replyText}"` }],
    TRIAGE_SYSTEM,
  );
}

// ─── Main agent function ───────────────────────────────────────────────────────

export async function runReplyTriage(
  input: ReplyTriageInput,
): Promise<AgentResult<ReplyTriageOutput>> {
  const { tenantId, messageId, replyText, runId } = input;

  // 1. Load the original outbound message to get prospectId
  const message = await db.query.messageAttempts.findFirst({
    where: and(
      eq(messageAttempts.tenantId, tenantId),
      eq(messageAttempts.id, messageId),
    ),
  });

  if (!message) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Message not found: ${messageId}` } };
  }

  // 2. Classify via LLM
  const result = await classifyReply(tenantId, replyText, runId);
  if (!result.ok) return result;

  // Always override nextAction from our map — never trust the model's routing
  const classification = result.data.classification;
  const nextAction     = ACTION_MAP[classification] ?? result.data.nextAction;

  // 3. Log classification on the message record + mark replied
  await db
    .update(messageAttempts)
    .set({ classification, status: "replied" })
    .where(eq(messageAttempts.id, messageId));

  // 4. Add to DNC immediately if unsubscribe — this step is never skipped
  let addedToDNC = false;

  if (classification === "unsubscribe" && message.prospectId) {
    const prospect = await db.query.prospectsRaw.findFirst({
      where: and(
        eq(prospectsRaw.tenantId, tenantId),
        eq(prospectsRaw.id, message.prospectId),
      ),
    });

    if (prospect) {
      await db
        .insert(doNotContact)
        .values({
          tenantId,
          email:  prospect.email  ?? null,
          phone:  prospect.phone  ?? null,
          domain: prospect.domain ?? null,
          reason: "unsubscribe",
        })
        .onConflictDoNothing();

      addedToDNC = true;
    }
  }

  return {
    ok:    true,
    data:  { classification, nextAction, addedToDNC },
    usage: result.usage,
  };
}
