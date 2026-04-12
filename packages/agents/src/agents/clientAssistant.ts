import fs from "node:fs";
import path from "node:path";
import { db } from "@qyro/db";
import { redis } from "@qyro/queue";
import { assistantSessions, promptVersions, tenants } from "@qyro/db";
import { and, desc, eq } from "drizzle-orm";
import { runCompletion, runStructuredCompletion, type AgentResult } from "../runner";
import { type AgentName } from "../budget";
import { compactHistory, shouldCompact } from "../compact";
import { resolveTenantBookingConfig } from "../assistBooking";
import { executeBooking } from "../bookingService";
import { runQA } from "./qa";

const AGENT: AgentName = "client_assistant";

type TenantMeta = {
  assistPromptPackId?: string;
  calendar_provider?: string;
  approvedServices?: string[] | string;
  bannedPhrases?: string[] | string;
  bookingEmail?: string;
  bookingName?: string;
};

export type ClientAssistantInput = {
  tenantId: string;
  sessionId?: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  sessionType?: "website_widget" | "missed_call_sms";
  prospectId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  runId?: string;
};

export type ClientAssistantOutput = {
  reply: string;
  intent: "question" | "booking_intent" | "escalate" | "unsubscribe";
  escalate: boolean;
  escalationReason?: string;
  bookingId?: string;
  sessionId: string;
};

type IntentResult = {
  intent: "question" | "booking_intent" | "escalate" | "unsubscribe";
  escalate: boolean;
  reason: string;
};

function utcDayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function intentCounterKey(tenantId: string, metric: "questions_count" | "appointments_booked_count" | "escalations_count"): string {
  return `daily_summary:intent:${tenantId}:${utcDayString()}:${metric}`;
}

function incrementIntentAggregate(tenantId: string, intent: IntentResult["intent"]): void {
  const metric = intent === "question"
    ? "questions_count"
    : intent === "booking_intent"
      ? "appointments_booked_count"
      : intent === "escalate"
        ? "escalations_count"
        : null;

  if (!metric) return;

  void redis.incr(intentCounterKey(tenantId, metric)).catch((err) => {
    console.error("[clientAssistant] failed to increment intent aggregate:", err);
  });
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function getPromptsDir(): string {
  return process.env.PROMPTS_DIR ?? path.resolve(process.cwd(), "docs/PROMPTS");
}

async function loadAssistPrompt(params: {
  tenantId: string;
  promptPackId: string;
}): Promise<{ promptPackId: string; content: string }> {
  const assistFile = path.join(getPromptsDir(), "assist", `${params.promptPackId}.md`);
  if (fs.existsSync(assistFile)) {
    return {
      promptPackId: params.promptPackId,
      content: fs.readFileSync(assistFile, "utf8"),
    };
  }

  const [promptRow] = await db
    .select({
      promptPackId: promptVersions.promptPackId,
      content: promptVersions.content,
    })
    .from(promptVersions)
    .where(
      and(
        eq(promptVersions.tenantId, params.tenantId),
        eq(promptVersions.promptPackId, params.promptPackId),
        eq(promptVersions.status, "approved"),
      ),
    )
    .orderBy(desc(promptVersions.version))
    .limit(1);

  if (promptRow) {
    return promptRow;
  }

  return {
    promptPackId: params.promptPackId,
    content: "Assist customers with clear, concise answers and safe escalation.",
  };
}

async function ensureSession(input: ClientAssistantInput): Promise<{ id: string; turnCount: number; compactionCount: number; escalated: boolean }> {
  if (input.sessionId) {
    const existing = await db.query.assistantSessions.findFirst({
      where: and(
        eq(assistantSessions.id, input.sessionId),
        eq(assistantSessions.tenantId, input.tenantId),
      ),
    });

    if (existing) {
      return {
        id: existing.id,
        turnCount: existing.turnCount,
        compactionCount: existing.compactionCount,
        escalated: existing.escalated,
      };
    }
  }

  const [created] = await db
    .insert(assistantSessions)
    .values({
      tenantId: input.tenantId,
      sessionType: input.sessionType ?? "website_widget",
      turnCount: 0,
      compactionCount: 0,
      escalated: false,
    })
    .returning({
      id: assistantSessions.id,
      turnCount: assistantSessions.turnCount,
      compactionCount: assistantSessions.compactionCount,
      escalated: assistantSessions.escalated,
    });

  return created;
}

async function detectIntent(params: {
  tenantId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  runId?: string;
}): Promise<AgentResult<IntentResult>> {
  const system = `Classify the latest customer message.
Return ONLY JSON:
{
  "intent": "question"|"booking_intent"|"escalate"|"unsubscribe",
  "escalate": boolean,
  "reason": string
}

Rules:
- unsubscribe if user asks to stop, opt out, remove, unsubscribe
- booking_intent for booking/reschedule/cancel appointment intent
- escalate for threats, legal, complaints, abuse, or unclear high-risk requests
- otherwise question`;

  const historyText = params.history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  return runStructuredCompletion<IntentResult>(
    { tenantId: params.tenantId, agentName: AGENT, runId: params.runId },
    [{ role: "user", content: `History:\n${historyText}\n\nLatest message:\n${params.message}` }],
    system,
  );
}

async function generateReply(params: {
  tenantId: string;
  promptPack: string;
  tenantName: string;
  approvedServices: string[];
  intent: IntentResult["intent"];
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  runId?: string;
}): Promise<AgentResult<string>> {
  const system = `You are the text assistant for ${params.tenantName}.
Use this approved prompt pack as source of truth:\n\n${params.promptPack}\n\nRules:
- Stay concise and helpful
- Do not promise services outside approved list
- If unsubscribe intent, confirm opt-out and be brief
- If escalate intent, say a human will follow up
- No markdown`;

  const historyText = params.history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const userContent = [
    `Approved services: ${params.approvedServices.join(", ") || "(none specified)"}`,
    `Intent: ${params.intent}`,
    `Recent history:\n${historyText}`,
    `Latest customer message:\n${params.message}`,
    "Write only the assistant reply text.",
  ].join("\n\n");

  return runCompletion(
    { tenantId: params.tenantId, agentName: AGENT, runId: params.runId },
    [{ role: "user", content: userContent }],
    system,
  );
}

export async function runClientAssistant(
  input: ClientAssistantInput,
): Promise<AgentResult<ClientAssistantOutput>> {
  const session = await ensureSession(input);

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, input.tenantId) });
  if (!tenant) {
    return { ok: false, error: { code: "INVALID_INPUT", message: `Tenant not found: ${input.tenantId}` } };
  }

  const tenantMeta = (tenant.metadata as TenantMeta | null) ?? {};
  const approvedServices = toStringArray(tenantMeta.approvedServices);
  const bannedPhrases = toStringArray(tenantMeta.bannedPhrases);

  const promptPackId = tenantMeta.assistPromptPackId ?? "general_faq_v1";
  const promptPack = await loadAssistPrompt({ tenantId: input.tenantId, promptPackId });

  const fullHistory = [...input.history, { role: "user" as const, content: input.message }];
  const turnCountAfter = session.turnCount + 1;

  let compactedHistory = fullHistory;
  let didCompact = false;

  if (shouldCompact(turnCountAfter)) {
    try {
      const compacted = await compactHistory({
        sessionId: session.id,
        messages: fullHistory.map((m) => ({ role: m.role, content: m.content })),
      });
      compactedHistory = compacted
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));
      didCompact = true;
    } catch (err) {
      console.error("[clientAssistant] compaction failed:", err);
    }
  }

  const intentResult = await detectIntent({
    tenantId: input.tenantId,
    history: compactedHistory,
    message: input.message,
    runId: input.runId,
  });
  if (!intentResult.ok) return intentResult;

  incrementIntentAggregate(input.tenantId, intentResult.data.intent);

  let reply = "";
  let bookingId: string | undefined;
  let escalate = intentResult.data.escalate;
  let escalationReason: string | undefined = escalate ? intentResult.data.reason : undefined;

  if (intentResult.data.intent === "booking_intent") {
    if (!input.prospectId) {
      // No prospect identity yet — escalate so a team member can follow up
      escalate = true;
      escalationReason = "booking_no_prospect";
      reply = "I'd be happy to help you schedule. Could you share your name and phone number so we can get you booked?";
    } else {
      try {
        const bookingConfig = await resolveTenantBookingConfig({ tenant });
        const bookingTimeZone = bookingConfig.timezone ?? process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles";

        // For direct_booking: discover an available slot first so the service
        // can create the booking at a known time.
        let slotStart: Date | null = null;
        let slotEnd: Date | null = null;

        if (bookingConfig.bookingMode === "direct_booking" && bookingConfig.supportsAvailabilityLookup) {
          const { getCalendarAdapterForConfig } = await import("../assistBooking.js");
          const adapter = getCalendarAdapterForConfig(bookingConfig);
          if (adapter) {
            const windowStart = new Date().toISOString();
            const windowEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
            const slots = await adapter.getAvailableSlots({ startAt: windowStart, endAt: windowEnd, timeZone: bookingTimeZone });
            if (slots.length > 0) {
              slotStart = new Date(slots[0].startAt);
              slotEnd = new Date(slots[0].endAt);
            }
          }
        }

        if (bookingConfig.bookingMode === "direct_booking" && !slotStart) {
          // No slot found or lookup not supported — fall back to callback
          escalate = true;
          escalationReason = "no_available_slots";
          reply = "I could not find an available slot right now. A team member will follow up to schedule you.";
        } else {
          const chosenStart = slotStart ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
          const chosenEnd = slotEnd ?? new Date(chosenStart.getTime() + 60 * 60 * 1000);

          const result = await executeBooking({
            tenantId: input.tenantId,
            prospectId: input.prospectId,
            callerName: input.contactName ?? tenantMeta.bookingName ?? "Website Visitor",
            callerPhone: input.contactPhone ?? "",
            callerEmail: input.contactEmail ?? tenantMeta.bookingEmail,
            startAt: chosenStart,
            endAt: chosenEnd,
            channel: "chat",
          });

          reply = result.aiResponse;
          bookingId = result.calBookingUid ?? result.appointmentId;
          if (result.escalate) {
            escalate = true;
            escalationReason = result.escalationReason;
          }
        }
      } catch (err) {
        escalate = true;
        escalationReason = "booking_error";
        reply = "I ran into an issue while scheduling. A team member will follow up to complete your booking.";
        console.error("[clientAssistant] booking flow failed:", err);
      }
    }
  } else {
    const replyResult = await generateReply({
      tenantId: input.tenantId,
      promptPack: promptPack.content,
      tenantName: tenant.name,
      approvedServices,
      intent: intentResult.data.intent,
      message: input.message,
      history: compactedHistory,
      runId: input.runId,
    });
    if (!replyResult.ok) return replyResult;
    reply = replyResult.data.trim();
  }

  const qaResult = await runQA({
    tenantId: input.tenantId,
    messageText: reply,
    approvedServices,
    bannedPhrases,
    runId: input.runId,
  });

  if (!qaResult.ok) return qaResult;

  if (qaResult.data.verdict === "block") {
    escalate = true;
    escalationReason = `qa_block: ${JSON.stringify(qaResult.data.flags ?? [])}`;
    reply = "I am escalating this to a team member to make sure you get the right answer.";
  }

  await db
    .update(assistantSessions)
    .set({
      turnCount: turnCountAfter,
      escalated: session.escalated || escalate,
      ...(escalate && escalationReason ? { escalationReason } : {}),
      compactionCount: session.compactionCount + (didCompact ? 1 : 0),
    })
    .where(eq(assistantSessions.id, session.id));

  return {
    ok: true,
    data: {
      reply,
      intent: intentResult.data.intent,
      escalate,
      escalationReason,
      bookingId,
      sessionId: session.id,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      model: "workflow",
      modelTier: "cheap",
      cached: false,
    },
  };
}
