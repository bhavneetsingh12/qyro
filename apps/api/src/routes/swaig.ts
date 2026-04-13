// SWAIG webhook endpoints for SignalWire AI Agent
//
// SWAIG (SignalWire AI Gateway) sends POST requests when the AI agent
// needs to take actions during a call. Each request looks like:
//   {
//     "function": "book_appointment",
//     "argument": { "parsed": [{ ...params }] },
//     "caller_id_num": "+16084712686",
//     "caller_id_name": "John Doe",
//     "ai_session_id": "xxx",
//     "project_id": "xxx",
//     "call_id": "xxx"
//   }
//
// Tenant identification priority:
// 1. tenantId / tenant_id in payload root (pass via SWML global_data in AI agent config)
// 2. tenantId in argument.parsed[0]
// 3. to / call_to number looked up against tenants.voice_number

import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@qyro/db";
import { executeBooking } from "@qyro/agents/bookingService";
import { runCompletion } from "@qyro/agents/runner";
import { resolveAssistantMode, resolveTenantAgentProfiles, type AssistAgentMode } from "../lib/agentProfiles";
import {
  auditLogs,
  messageAttempts,
  promptVersions,
  prospectsRaw,
  tenants,
} from "@qyro/db";
import { logAudit } from "../lib/auditLog";

const router: ExpressRouter = Router();

// ─── SMS helper ───────────────────────────────────────────────────────────────
// Used by the callback-sms SWAIG function. Booking SMS is handled inside
// bookingService.ts; this covers direct outbound SMS from SWAIG actions.

async function sendSms(params: { from: string; to: string; body: string }): Promise<string | null> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_API_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
  if (!projectId || !token || !spaceUrl) return null;
  try {
    const url = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: params.from, To: params.to, Body: params.body }).toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sid?: string };
    return data.sid ?? null;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SwaigPayload = {
  function?: string;
  argument?: {
    parsed?: Array<Record<string, unknown>>;
    raw?: string;
  };
  caller_id_num?: string;
  caller_id_name?: string;
  ai_session_id?: string;
  project_id?: string;
  call_id?: string;
  // SWML global_data fields are merged into the payload root
  tenantId?: string;
  tenant_id?: string;
  // SignalWire may send the called (To) number here
  to?: string;
  call_to?: string;
};

type SwaigResponse = {
  response: string;
  action?: unknown[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function getParsed(payload: SwaigPayload): Record<string, unknown> {
  return (payload.argument?.parsed?.[0] ?? {}) as Record<string, unknown>;
}

function normalizePhone(value?: string): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function parseAgentMode(payload: SwaigPayload): AssistAgentMode {
  const parsed = getParsed(payload);
  const explicitMode = str(parsed.agent_mode) || str(parsed.mode) || str(payload.function);
  if (explicitMode.toLowerCase().includes("chat")) return "chat";
  const direction = str(parsed.direction).toLowerCase();
  if (direction === "outbound") return resolveAssistantMode({ channel: "voice", direction: "outbound" });
  return resolveAssistantMode({ channel: "voice", direction: "inbound" });
}

async function resolveTenant(
  payload: SwaigPayload,
): Promise<typeof tenants.$inferSelect | null> {
  const parsed = getParsed(payload);

  // 1. Explicit tenantId in payload (SWML global_data or argument)
  const explicitId =
    str(payload.tenantId) ||
    str(payload.tenant_id) ||
    str(parsed.tenantId) ||
    str(parsed.tenant_id);

  if (explicitId) {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, explicitId))
      .limit(1);
    if (tenant) return tenant;
    console.warn(`[swaig] tenant not found for explicitId=${explicitId}`);
  }

  // 2. Look up by the called (To) number
  const toNum = normalizePhone(
    str(payload.to) || str(payload.call_to) || str(parsed.to),
  );
  if (toNum) {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.voiceNumber, toNum))
      .limit(1);
    if (tenant) return tenant;
    console.warn(`[swaig] tenant not found for to=${toNum}`);
  }

  return null;
}

async function findOrCreateProspect(
  tenantId: string,
  phone: string,
  name?: string,
): Promise<string | null> {
  if (!phone) return null;

  const [existing] = await db
    .select({ id: prospectsRaw.id })
    .from(prospectsRaw)
    .where(and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.phone, phone)))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(prospectsRaw)
    .values({
      tenantId,
      source: "inbound_form",
      sourceType: "individual",
      businessName: name || phone,
      phone,
      consentState: "given",
    })
    .returning({ id: prospectsRaw.id });

  return created?.id ?? null;
}


// ─── Route: business-info ─────────────────────────────────────────────────────
// Expected args: { question: string }

router.post("/business-info", async (req: Request, res: Response) => {
  const payload = req.body as SwaigPayload;
  const parsed = getParsed(payload);
  const question =
    str(parsed.question) || str(parsed.query) || str(parsed.text);

  if (!question) {
    res.json({
      response:
        "I'm sorry, I didn't catch your question. Could you repeat that?",
    } satisfies SwaigResponse);
    return;
  }

  const tenant = await resolveTenant(payload).catch(() => null);
  if (!tenant) {
    console.warn("[swaig/business-info] tenant not resolved");
    res.json({
      response:
        "I'm sorry, I don't have that information available right now. Would you like me to have someone call you back?",
    } satisfies SwaigResponse);
    return;
  }

  try {
    const mode = parseAgentMode(payload);
    const profile = resolveTenantAgentProfiles(tenant.metadata)[mode];
    if (!profile.enabled) {
      res.json({
        response: "This assistant path is currently disabled for your account. Please hold while we connect you to the team.",
      } satisfies SwaigResponse);
      return;
    }

    const promptRow = await db
      .select({ content: promptVersions.content })
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.tenantId, tenant.id),
          eq(promptVersions.status, "approved"),
        ),
      )
      .orderBy(desc(promptVersions.createdAt))
      .limit(1);

    const faqContext = promptRow[0]?.content ?? "";

    const systemPrompt = [
      `You are a helpful voice assistant for ${tenant.name}.`,
      `Runtime mode: ${mode}.`,
      `Mode policy: ${profile.behaviorHint}`,
      faqContext ? `Business information:\n${faqContext}` : "",
      "Answer the caller's question concisely and naturally, as if speaking aloud.",
      "Keep your answer under 3 sentences. If you don't know, say so and offer a callback.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const completion = await runCompletion(
      {
        tenantId: tenant.id,
        agentName: "client_assistant",
        runId: str(payload.call_id) || undefined,
      },
      [{ role: "user", content: question }],
      systemPrompt,
    );

    const answer = completion.ok ? completion.data.trim() : "";
    res.json({
      response:
        answer ||
        "I'm sorry, I don't have that information right now. Would you like me to have someone follow up with you?",
    } satisfies SwaigResponse);
  } catch (err) {
    console.error("[swaig/business-info] error:", err);
    res.json({
      response:
        "I'm sorry, I'm having trouble looking that up right now. Would you like me to have someone call you back?",
    } satisfies SwaigResponse);
  }
});

// ─── Route: book-appointment ──────────────────────────────────────────────────
// Expected args: { caller_name, service, preferred_date, preferred_time, phone_number }

router.post("/book-appointment", async (req: Request, res: Response) => {
  const payload = req.body as SwaigPayload;
  const parsed = getParsed(payload);

  const callerName =
    str(parsed.caller_name) || str(payload.caller_id_name) || "Caller";
  const service = str(parsed.service);
  const preferredDate = str(parsed.preferred_date) || str(parsed.date);
  const preferredTime = str(parsed.preferred_time) || str(parsed.time);
  const phoneNumber = normalizePhone(
    str(parsed.phone_number) || str(payload.caller_id_num),
  );

  const tenant = await resolveTenant(payload).catch(() => null);
  if (!tenant) {
    console.warn("[swaig/book-appointment] tenant not resolved");
    res.json({
      response:
        "I'm sorry, I wasn't able to complete the booking. Please call us back or we'll follow up with you shortly.",
    } satisfies SwaigResponse);
    return;
  }

  try {
    const mode = parseAgentMode(payload);
    const profile = resolveTenantAgentProfiles(tenant.metadata)[mode];
    if (!profile.enabled || !profile.allowBooking) {
      res.json({
        response: "Booking is currently handled by the team directly. We will call you back to schedule.",
      } satisfies SwaigResponse);
      return;
    }

    const prospectId = await findOrCreateProspect(tenant.id, phoneNumber, callerName);
    if (!prospectId) {
      res.json({
        response:
          "I'm sorry, I wasn't able to save your booking. Please call back and we'll get you scheduled.",
      } satisfies SwaigResponse);
      return;
    }

    // Parse date/time — fall back to tomorrow if unparseable
    const rawDate =
      preferredDate && preferredTime
        ? new Date(`${preferredDate} ${preferredTime}`)
        : preferredDate
          ? new Date(preferredDate)
          : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const startAt = isNaN(rawDate.getTime())
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : rawDate;
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const result = await executeBooking({
      tenantId: tenant.id,
      prospectId,
      callerName,
      callerPhone: phoneNumber,
      service: service || undefined,
      startAt,
      endAt,
      channel: "voice_swaig",
      notes: `Caller: ${callerName} (${phoneNumber}).`,
    });

    logAudit({
      req,
      tenantId: tenant.id,
      action: "appointments.create_via_swaig",
      resourceType: "appointment",
      resourceId: result.appointmentId,
    });

    res.json({
      response: result.aiResponse,
      action: [
        {
          set_meta_data: {
            appointment_booked: result.status === "booked",
            appointment_id: result.appointmentId,
          },
        },
      ],
    } satisfies SwaigResponse);
  } catch (err) {
    console.error("[swaig/book-appointment] error:", err);
    res.json({
      response:
        "I'm sorry, something went wrong while booking. Please call back and we'll get you taken care of.",
    } satisfies SwaigResponse);
  }
});

// ─── Route: escalate ──────────────────────────────────────────────────────────
// Expected args: { reason: string }

router.post("/escalate", async (req: Request, res: Response) => {
  const payload = req.body as SwaigPayload;
  const parsed = getParsed(payload);
  const reason = str(parsed.reason) || "Caller requested to speak with staff";
  const callerPhone = normalizePhone(str(payload.caller_id_num));

  const tenant = await resolveTenant(payload).catch(() => null);
  if (!tenant) {
    console.warn("[swaig/escalate] tenant not resolved");
    res.json({
      response: "Let me connect you with our team. Please hold.",
    } satisfies SwaigResponse);
    return;
  }
  const mode = parseAgentMode(payload);
  const profile = resolveTenantAgentProfiles(tenant.metadata)[mode];
  if (!profile.enabled || !profile.allowEscalation) {
    res.json({
      response:
        "Our escalation path is currently unavailable. A team member will follow up with you shortly.",
    } satisfies SwaigResponse);
    return;
  }

  // Fire-and-forget audit log
  db.insert(auditLogs)
    .values({
      tenantId: tenant.id,
      action: "voice.escalate_via_swaig",
      resourceType: "call",
      endpoint: req.originalUrl,
      ipAddress:
        String(req.headers["x-forwarded-for"] ?? "")
          .split(",")[0]
          ?.trim() ||
        req.ip ||
        "unknown",
      after: { reason, callerPhone, ai_session_id: payload.ai_session_id },
    })
    .catch((err) =>
      console.warn("[swaig/escalate] audit log failed:", err?.message),
    );

  const escalationPhone = tenant.escalationContactPhone;
  if (!escalationPhone) {
    console.warn(`[swaig/escalate] tenant ${tenant.id} has no escalation_contact_phone`);
    res.json({
      response:
        "I'm sorry, our team is not available right now. I'll make sure someone follows up with you shortly.",
    } satisfies SwaigResponse);
    return;
  }

  res.json({
    response:
      "Let me connect you with someone from our team right now. One moment please.",
    action: [
      {
        SWML: {
          version: "1.0.0",
          sections: {
            main: [
              {
                connect: {
                  to: escalationPhone,
                },
              },
            ],
          },
        },
      },
    ],
  } satisfies SwaigResponse);
});

// ─── Route: callback-sms ──────────────────────────────────────────────────────
// Expected args: { phone_number?: string, message?: string }

router.post("/callback-sms", async (req: Request, res: Response) => {
  const payload = req.body as SwaigPayload;
  const parsed = getParsed(payload);

  const toPhone = normalizePhone(
    str(parsed.phone_number) || str(payload.caller_id_num),
  );
  const messageText =
    str(parsed.message) ||
    "Hi! This is a follow-up from your recent call with us. We'll be in touch shortly. Reply STOP to opt out.";

  if (!toPhone) {
    res.json({
      response:
        "I wasn't able to send a text message because I don't have your phone number. Is there anything else I can help you with?",
    } satisfies SwaigResponse);
    return;
  }

  const tenant = await resolveTenant(payload).catch(() => null);
  if (!tenant) {
    console.warn("[swaig/callback-sms] tenant not resolved");
    res.json({
      response:
        "I'm sorry, I wasn't able to send that text message. Is there anything else I can help you with?",
    } satisfies SwaigResponse);
    return;
  }
  const mode = parseAgentMode(payload);
  const profile = resolveTenantAgentProfiles(tenant.metadata)[mode];
  if (!profile.enabled) {
    res.json({
      response:
        "Text follow-up is currently unavailable for this assistant path. A team member will contact you directly.",
    } satisfies SwaigResponse);
    return;
  }

  const fromPhone = tenant.voiceNumber;
  if (!fromPhone) {
    console.warn(`[swaig/callback-sms] tenant ${tenant.id} has no voice_number`);
    res.json({
      response:
        "I'm sorry, I wasn't able to send that text message right now. Someone will follow up with you shortly.",
    } satisfies SwaigResponse);
    return;
  }

  try {
    const prospectId = await findOrCreateProspect(tenant.id, toPhone).catch(
      () => null,
    );

    const sid = await sendSms({
      from: fromPhone,
      to: toPhone,
      body: messageText,
    });

    if (prospectId) {
      db.insert(messageAttempts)
        .values({
          tenantId: tenant.id,
          prospectId,
          channel: "sms",
          direction: "outbound",
          messageText,
          status: sid ? "sent" : "failed",
          externalId: sid ?? null,
          sentAt: sid ? new Date() : null,
        })
        .catch((err) =>
          console.warn(
            "[swaig/callback-sms] messageAttempts insert failed:",
            err?.message,
          ),
        );
    }

    res.json({
      response: sid
        ? "I've sent you a text message. We'll follow up with you shortly. Is there anything else I can help you with?"
        : "I'm sorry, I had trouble sending the text message. Someone from our team will follow up with you.",
    } satisfies SwaigResponse);
  } catch (err) {
    console.error("[swaig/callback-sms] error:", err);
    res.json({
      response:
        "I'm sorry, I wasn't able to send that text message. Someone will follow up with you shortly.",
    } satisfies SwaigResponse);
  }
});

export default router;
