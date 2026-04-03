// QYRO Outreach Agent
// See docs/AGENTS.md for contract rules.
//
// MUST NOT: send any message — only create a draft for human approval
// MUST NOT: generate if DNC match or consent = "denied" | "revoked"
// Model:    cheap (gpt-4o-mini) — personalized cold outreach draft
// Input:    enriched prospect (summary, painPoints, pitchAngles) + sequence
// Output:   message_attempts row with status "pending_approval"

import { db } from "@qyro/db";
import {
  prospectsRaw, prospectsEnriched, outreachSequences,
  messageAttempts, doNotContact, tenants,
} from "@qyro/db";
import { eq, and, or } from "drizzle-orm";
import { runCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";
import { runQA } from "./qa";

const AGENT: AgentName = "outreach";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OutreachInput = {
  tenantId:   string;
  prospectId: string;
  sequenceId: string;
  runId?:     string;
};

export type OutreachOutput = {
  messageAttemptId: string;
  channel:          string;
  preview:          string;   // first 120 chars of draft
  skipped:          false;
} | {
  skipped:    true;
  skipReason: string;
};

// ─── DNC check ────────────────────────────────────────────────────────────────

async function isDNC(tenantId: string, email: string | null, phone: string | null, domain: string | null): Promise<string | null> {
  const conditions = [];

  if (email)  conditions.push(eq(doNotContact.email,  email));
  if (phone)  conditions.push(eq(doNotContact.phone,  phone));
  if (domain) conditions.push(eq(doNotContact.domain, domain));

  if (conditions.length === 0) return null;

  const row = await db.query.doNotContact.findFirst({
    where: and(
      eq(doNotContact.tenantId, tenantId),
      or(...conditions),
    ),
  });

  return row ? row.reason : null;
}

// ─── LLM: generate message ────────────────────────────────────────────────────

const EMAIL_SYSTEM = `You are a sales copywriter drafting a short cold outreach email for QYRO Assist — an AI chat + missed-call follow-up product for local businesses.

Rules:
- 3 sentences max in the body (subject + 3 sentences + CTA)
- Be specific: use the business name and one concrete pain point from the research
- Tone: conversational, not salesy or pushy
- CTA: ask for a 15-minute call — nothing more
- Output format (no JSON, no markdown):
  Subject: <subject line>
  Body: <email body>`;

const SMS_SYSTEM = `You are a sales copywriter drafting a short cold SMS for QYRO Assist — an AI chat + missed-call follow-up product for local businesses.

Rules:
- 2 sentences max, under 160 characters total
- Be specific: use the business name and one pain point
- Tone: direct, not pushy
- End with a simple yes/no question or a link placeholder [LINK]
- Output plain text only — no labels, no JSON, no markdown`;

async function generateMessage(params: {
  tenantId:     string;
  businessName: string;
  niche:        string;
  painPoints:   string[];
  pitchAngles:  string[];
  channel:      "email" | "sms";
  runId?:       string;
}): Promise<AgentResult<string>> {
  const { tenantId, businessName, niche, painPoints, pitchAngles, channel, runId } = params;

  const topPain   = painPoints[0]   ?? "missed after-hours inquiries";
  const topAngle  = pitchAngles[0]  ?? "automated follow-up";

  const userContent = [
    `Business: ${businessName}`,
    `Niche: ${niche}`,
    `Key pain point: ${topPain}`,
    `Pitch angle: ${topAngle}`,
  ].join("\n");

  return runCompletion(
    { tenantId, agentName: AGENT, runId },
    [{ role: "user", content: userContent }],
    channel === "email" ? EMAIL_SYSTEM : SMS_SYSTEM,
  );
}

// ─── Main agent function ──────────────────────────────────────────────────────

export async function runOutreach(
  input: OutreachInput,
): Promise<AgentResult<OutreachOutput>> {
  const { tenantId, prospectId, sequenceId, runId } = input;

  // 1. Load prospect (raw)
  const prospect = await db.query.prospectsRaw.findFirst({
    where: and(
      eq(prospectsRaw.tenantId, tenantId),
      eq(prospectsRaw.id, prospectId),
    ),
  });

  if (!prospect) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Prospect not found: ${prospectId}` } };
  }

  // 2. Consent gate
  if (prospect.consentState === "denied" || prospect.consentState === "revoked") {
    return {
      ok:   true,
      data: { skipped: true, skipReason: `consent_${prospect.consentState}` },
      usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "cheap", cached: false },
    };
  }

  // 3. DNC gate
  const domain = prospect.domain
    ? prospect.domain.trim().toLowerCase().replace(/^www\./, "")
    : null;
  const dncReason = await isDNC(tenantId, prospect.email, prospect.phone, domain);
  if (dncReason) {
    return {
      ok:   true,
      data: { skipped: true, skipReason: `dnc:${dncReason}` },
      usage: { inputTokens: 0, outputTokens: 0, model: "none", modelTier: "cheap", cached: false },
    };
  }

  // 4. Load enriched research
  const enriched = await db.query.prospectsEnriched.findFirst({
    where: and(
      eq(prospectsEnriched.tenantId, tenantId),
      eq(prospectsEnriched.prospectId, prospectId),
    ),
  });

  if (!enriched) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `No enriched research found for prospect: ${prospectId}. Run research agent first.` } };
  }

  // 5. Load outreach sequence
  const sequence = await db.query.outreachSequences.findFirst({
    where: and(
      eq(outreachSequences.tenantId, tenantId),
      eq(outreachSequences.id, sequenceId),
    ),
  });

  if (!sequence) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Sequence not found: ${sequenceId}` } };
  }

  if (!sequence.active) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Sequence ${sequenceId} is not active` } };
  }

  const channel = sequence.channel as "email" | "sms";

  // 6. Generate message
  const painPoints  = (enriched.painPoints  as string[]) ?? [];
  const pitchAngles = (enriched.pitchAngles as string[]) ?? [];

  const result = await generateMessage({
    tenantId,
    businessName: prospect.businessName,
    niche:        prospect.niche ?? sequence.niche ?? "local business",
    painPoints,
    pitchAngles,
    channel,
    runId,
  });

  if (!result.ok) return result;

  // 7. Insert message_attempts draft — QA will set final status below
  const [attempt] = await db
    .insert(messageAttempts)
    .values({
      tenantId,
      sequenceId,
      prospectId,
      channel,
      direction:   "outbound",
      messageText: result.data,
      status:      "pending_approval",
    })
    .returning({ id: messageAttempts.id });

  // 8. Run QA guardrail — updates status to "blocked_by_qa" or keeps "pending_approval"
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  const meta = (tenant?.metadata as Record<string, unknown>) ?? {};
  const approvedServicesRaw = (meta.approvedServices as string) ?? "";
  const approvedServices = approvedServicesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const qaResult = await runQA({
    tenantId,
    messageAttemptId: attempt.id,
    approvedServices,
    bannedPhrases:    [],
    runId,
  });

  if (!qaResult.ok) {
    console.warn(`[outreach] QA failed for attempt ${attempt.id}:`, qaResult.error.message);
  }

  return {
    ok:   true,
    data: {
      skipped:          false,
      messageAttemptId: attempt.id,
      channel,
      preview:          result.data.slice(0, 120),
    },
    usage: result.usage,
  };
}
