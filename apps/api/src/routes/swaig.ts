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
import OpenAI from "openai";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@qyro/db";
import {
  appointments,
  auditLogs,
  messageAttempts,
  promptVersions,
  prospectsRaw,
  tenants,
} from "@qyro/db";
import { logAudit } from "../lib/auditLog";

const router: ExpressRouter = Router();

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

async function sendSignalWireSms(params: {
  from: string;
  to: string;
  body: string;
}): Promise<string | null> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_API_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;

  if (!projectId || !token || !spaceUrl) {
    console.error("[swaig/sms] SignalWire env vars not configured");
    return null;
  }

  const url = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${projectId}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: params.from, To: params.to, Body: params.body }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[swaig/sms] SignalWire SMS failed ${response.status}: ${text}`);
    return null;
  }

  const data = (await response.json()) as { sid?: string };
  return data.sid ?? null;
}

// Cal.com booking — direct API call without adapter to avoid subpath export dependency
async function bookCalCom(params: {
  startAt: string;
  endAt: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<{ uid: string; startAt: string; endAt: string } | null> {
  const apiKey = process.env.CAL_API_KEY;
  const eventTypeId = process.env.CAL_EVENT_TYPE_ID;
  if (!apiKey || !eventTypeId) return null;

  const response = await fetch(
    `https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventTypeId,
        start: params.startAt,
        responses: { name: params.name, email: params.email },
        timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Los_Angeles",
        language: "en",
      }),
    },
  );

  if (!response.ok) {
    console.warn(`[swaig/cal] Cal.com booking failed ${response.status}`);
    return null;
  }

  const data = (await response.json()) as {
    uid?: string;
    startTime?: string;
    endTime?: string;
  };

  if (!data.uid) return null;
  return {
    uid: data.uid,
    startAt: data.startTime ?? params.startAt,
    endAt: data.endTime ?? params.endAt,
  };
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
      faqContext ? `Business information:\n${faqContext}` : "",
      "Answer the caller's question concisely and naturally, as if speaking aloud.",
      "Keep your answer under 3 sentences. If you don't know, say so and offer a callback.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    const answer = completion.choices[0]?.message?.content?.trim() ?? "";
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
    const prospectId = await findOrCreateProspect(
      tenant.id,
      phoneNumber,
      callerName,
    );

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

    // Try Cal.com if configured
    let calBookingUid: string | null = null;
    if (process.env.CAL_API_KEY && process.env.CAL_EVENT_TYPE_ID && phoneNumber) {
      const calResult = await bookCalCom({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        name: callerName,
        email: `${phoneNumber.replace(/\D/g, "")}@placeholder.qyro.us`,
        notes: `Booked via voice call. Service: ${service || "not specified"}.`,
      }).catch((err) => {
        console.warn("[swaig/book-appointment] Cal.com failed:", err);
        return null;
      });
      calBookingUid = calResult?.uid ?? null;
    }

    const [appt] = await db
      .insert(appointments)
      .values({
        tenantId: tenant.id,
        prospectId,
        calBookingUid,
        startAt,
        endAt,
        status: "proposed",
        notes: [
          "Booked via SWAIG voice call.",
          service ? `Service: ${service}.` : "",
          `Caller: ${callerName} (${phoneNumber}).`,
        ]
          .filter(Boolean)
          .join(" "),
      })
      .returning({ id: appointments.id });

    logAudit({
      req,
      tenantId: tenant.id,
      action: "appointments.create_via_swaig",
      resourceType: "appointment",
      resourceId: appt?.id,
    });

    const dateStr = startAt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const timeStr = startAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    res.json({
      response: `I've booked your ${service || "appointment"} for ${dateStr} at ${timeStr}. You'll receive a confirmation shortly. Is there anything else I can help you with?`,
      action: [
        {
          set_meta_data: {
            appointment_booked: true,
            appointment_id: appt?.id,
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

    const sid = await sendSignalWireSms({
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
