import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@qyro/db";
import { assistantSessions, appointments, callAttempts, doNotContact, prospectsRaw, tenants, webhookEvents } from "@qyro/db";
import { outboundCallQueue } from "@qyro/queue";

const router: ExpressRouter = Router();

type CallLifecycle = "dialing" | "ringing" | "answered" | "completed" | "no_answer" | "busy" | "failed" | "canceled";

type RetellPayload = Record<string, unknown>;

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function getString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function getNestedObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapRetellStatus(raw: string): CallLifecycle {
  const status = raw.trim().toLowerCase();
  if (["initiated", "created", "queued", "dialing"].includes(status)) return "dialing";
  if (status === "ringing") return "ringing";
  if (["active", "in_progress", "in-progress", "answered"].includes(status)) return "answered";
  if (["ended", "completed", "complete"].includes(status)) return "completed";
  if (["no_answer", "no-answer"].includes(status)) return "no_answer";
  if (status === "busy") return "busy";
  if (["canceled", "cancelled"].includes(status)) return "canceled";
  if (["failed", "error"].includes(status)) return "failed";
  return "failed";
}

function getNextRetryDate(attemptCount: number): Date | null {
  const mins = [15, 120, 1440, 4320][Math.max(0, attemptCount - 1)];
  if (!mins) return null;
  return new Date(Date.now() + mins * 60 * 1000);
}

function resolveCallAttemptId(payload: RetellPayload): string {
  const metadata = getNestedObject(payload.metadata);
  const call = getNestedObject(payload.call);
  const callMetadata = getNestedObject(call.metadata);

  return getString(payload, ["callAttemptId", "call_attempt_id", "custom_id"])
    || getString(metadata, ["callAttemptId", "call_attempt_id"])
    || getString(call, ["callAttemptId", "call_attempt_id", "custom_id"])
    || getString(callMetadata, ["callAttemptId", "call_attempt_id"]);
}

function resolveSessionId(payload: RetellPayload): string {
  const metadata = getNestedObject(payload.metadata);
  const session = getNestedObject(payload.session);

  return getString(payload, ["sessionId", "session_id"])
    || getString(metadata, ["sessionId", "session_id"])
    || getString(session, ["id", "sessionId", "session_id"]);
}

function resolveRetellCallId(payload: RetellPayload): string {
  const call = getNestedObject(payload.call);
  return getString(payload, ["callId", "call_id", "id"]) || getString(call, ["id", "callId", "call_id"]);
}

function resolveRetellEventId(req: Request, payload: RetellPayload, fallbackPrefix: string): string {
  const direct = getString(payload, ["eventId", "event_id", "requestId", "request_id"]);
  const fromHeader = String(req.headers["x-retell-request-id"] ?? req.headers["x-request-id"] ?? "").trim();
  if (direct) return direct;
  if (fromHeader) return fromHeader;

  const callId = resolveRetellCallId(payload);
  const sessionId = resolveSessionId(payload);
  const status = getString(payload, ["status", "event", "call_status"]);
  const transcript = getString(payload, ["transcript", "text", "utterance"]);
  return [fallbackPrefix, callId || sessionId || "unknown", status || transcript || "unknown"].join(":");
}

async function beginRetellWebhookEvent(params: {
  req: Request;
  payload: RetellPayload;
  kind: string;
  tenantId?: string | null;
}) {
  const eventId = resolveRetellEventId(params.req, params.payload, params.kind);
  const eventType = `${params.kind}:${eventId}`;

  const existing = await db.query.webhookEvents.findFirst({
    where: and(eq(webhookEvents.source, "retell"), eq(webhookEvents.eventType, eventType)),
  });

  if (existing?.processed) {
    return { duplicate: true as const, rowId: existing.id };
  }

  if (existing) {
    return { duplicate: false as const, rowId: existing.id };
  }

  const [created] = await db
    .insert(webhookEvents)
    .values({
      tenantId: params.tenantId ?? null,
      source: "retell",
      eventType,
      payload: params.payload,
      processed: false,
    })
    .returning({ id: webhookEvents.id });

  return { duplicate: false as const, rowId: created.id };
}

async function finishRetellWebhookEvent(rowId: string, error?: string) {
  await db
    .update(webhookEvents)
    .set({
      processed: !error,
      processedAt: !error ? new Date() : null,
      error: error ?? null,
    })
    .where(eq(webhookEvents.id, rowId));
}

router.post("/call-events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = getNestedObject(req.body);
    const callAttemptId = resolveCallAttemptId(payload);
    if (!callAttemptId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "callAttemptId is required" });
      return;
    }

    const attempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) });
    if (!attempt) {
      res.status(404).json({ error: "NOT_FOUND", message: "Call attempt not found" });
      return;
    }

    const event = await beginRetellWebhookEvent({
      req,
      payload,
      kind: "call-events",
      tenantId: attempt.tenantId,
    });
    if (event.duplicate) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    const statusRaw = getString(payload, ["status", "event", "call_status"]);
    const status = mapRetellStatus(statusRaw || attempt.status || "failed");
    const durationRaw = getString(payload, ["duration", "duration_seconds", "call_duration"]);
    const parsedDuration = Number.parseInt(durationRaw, 10);
    const duration = Number.isFinite(parsedDuration) ? parsedDuration : undefined;
    const retellCallId = resolveRetellCallId(payload);

    const retryable = ["no_answer", "busy", "failed"].includes(status);
    const attemptsUsed = attempt.attemptCount ?? 0;
    const maxAttempts = attempt.maxAttempts ?? 4;
    const shouldRetry = attempt.direction === "outbound" && retryable && attemptsUsed < maxAttempts;
    const retryAt = shouldRetry ? getNextRetryDate(attemptsUsed) : null;

    await db
      .update(callAttempts)
      .set({
        status: shouldRetry ? "retry_scheduled" : status,
        outcome: status,
        duration,
        callSid: retellCallId || attempt.callSid,
        nextAttemptAt: retryAt,
      })
      .where(eq(callAttempts.id, attempt.id));

    if (shouldRetry && retryAt) {
      const delayMs = Math.max(0, retryAt.getTime() - Date.now());
      await outboundCallQueue.add(
        "outbound-call",
        { tenantId: attempt.tenantId, callAttemptId: attempt.id },
        {
          delay: delayMs,
          jobId: `outbound-call:${attempt.id}:${attemptsUsed + 1}`,
        },
      );
    }

    await finishRetellWebhookEvent(event.rowId);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/transcript-events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = getNestedObject(req.body);
    const sessionId = resolveSessionId(payload);

    if (!sessionId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "sessionId is required" });
      return;
    }

    const session = await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, sessionId) });
    if (!session) {
      res.status(404).json({ error: "NOT_FOUND", message: "Session not found" });
      return;
    }

    const event = await beginRetellWebhookEvent({
      req,
      payload,
      kind: "transcript-events",
      tenantId: session.tenantId,
    });
    if (event.duplicate) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    const transcript = getString(payload, ["transcript", "text", "utterance"]);
    const speakerRaw = getString(payload, ["speaker", "role", "source"]).toLowerCase();
    const role = speakerRaw.includes("agent") || speakerRaw.includes("assistant")
      ? "assistant"
      : "user";

    if (!transcript) {
      res.json({ ok: true, skipped: "empty_transcript" });
      return;
    }

    const currentHistory = Array.isArray(session.conversationHistory)
      ? (session.conversationHistory as Array<{ role: "user" | "assistant"; content: string }>).filter((m) => m && typeof m.content === "string")
      : [];

    const updatedHistory = [...currentHistory, { role, content: transcript }];

    await db
      .update(assistantSessions)
      .set({
        conversationHistory: updatedHistory,
        turnCount: updatedHistory.length,
      })
      .where(eq(assistantSessions.id, session.id));

    await finishRetellWebhookEvent(event.rowId);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function resolveTenantAndAttempt(body: Record<string, unknown>) {
  const tenantId = getString(body, ["tenantId", "tenant_id"]);
  const callAttemptId = getString(body, ["callAttemptId", "call_attempt_id"]);
  const sessionId = resolveSessionId(body);

  const attempt = callAttemptId
    ? await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) })
    : null;

  const session = sessionId
    ? await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, sessionId) })
    : null;

  const derivedTenantIds = [attempt?.tenantId, session?.tenantId].filter((value): value is string => Boolean(value));
  if (tenantId && derivedTenantIds.some((value) => value !== tenantId)) {
    return {
      tenant: null,
      attempt,
      session,
      tenantId: "",
      error: "TENANT_MISMATCH" as const,
    };
  }

  const resolvedTenantId = tenantId || attempt?.tenantId || session?.tenantId || "";

  if (!resolvedTenantId) return { tenant: null, attempt, session, tenantId: "", error: "MISSING_TENANT" as const };

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, resolvedTenantId) });
  return { tenant, attempt, session, tenantId: resolvedTenantId, error: null };
}

router.post("/tools/get-business-context", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const { tenant, error } = await resolveTenantAndAttempt(body);

    if (error === "TENANT_MISMATCH") {
      res.status(403).json({ error: "FORBIDDEN", message: "tenantId does not match session or call attempt" });
      return;
    }

    if (!tenant) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const meta = getNestedObject(tenant.metadata);
    res.json({
      data: {
        businessName: tenant.name,
        approvedServices: String(meta.approvedServices ?? ""),
        bookingLink: String(meta.bookingLink ?? ""),
        businessHours: String(meta.businessHours ?? ""),
        autoRespond: meta.autoRespond === true,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/tools/check-availability", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const { tenant, tenantId, error } = await resolveTenantAndAttempt(body);

    if (error === "TENANT_MISMATCH") {
      res.status(403).json({ error: "FORBIDDEN", message: "tenantId does not match session or call attempt" });
      return;
    }

    if (!tenant || !tenantId) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const startAt = getString(body, ["startAt", "start_at"]);
    const endAt = getString(body, ["endAt", "end_at"]);

    if (!startAt || !endAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt and endAt are required" });
      return;
    }

    const from = new Date(startAt);
    const to = new Date(endAt);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Invalid startAt/endAt window" });
      return;
    }

    const existing = await db.query.appointments.findMany({
      where: and(eq(appointments.tenantId, tenantId), eq(appointments.status, "confirmed")),
      limit: 500,
    });

    const hasConflict = existing.some((slot) => {
      const slotStart = new Date(slot.startAt);
      const slotEnd = new Date(slot.endAt);
      return slotStart < to && from < slotEnd;
    });

    res.json({
      data: {
        available: !hasConflict,
        slots: hasConflict ? [] : [{ startAt: from.toISOString(), endAt: to.toISOString() }],
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/tools/create-booking", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const { tenant, attempt, tenantId, error } = await resolveTenantAndAttempt(body);

    if (error === "TENANT_MISMATCH") {
      res.status(403).json({ error: "FORBIDDEN", message: "tenantId does not match session or call attempt" });
      return;
    }

    if (!tenant || !tenantId) {
      res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found" });
      return;
    }

    const startAt = getString(body, ["startAt", "start_at"]);
    const endAt = getString(body, ["endAt", "end_at"]);
    const name = getString(body, ["name", "full_name"]) || "Caller";
    const email = getString(body, ["email"]);

    if (!startAt || !endAt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "startAt and endAt are required" });
      return;
    }

    const bookingStart = new Date(startAt);
    const bookingEnd = new Date(endAt);
    if (Number.isNaN(bookingStart.getTime()) || Number.isNaN(bookingEnd.getTime()) || bookingStart >= bookingEnd) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Invalid startAt/endAt window" });
      return;
    }

    let prospectId = attempt?.prospectId ?? "";
    if (!prospectId) {
      const phone = normalizePhone(getString(body, ["phone", "from_number", "caller"]));
      const found = phone
        ? await db.query.prospectsRaw.findFirst({
            where: and(eq(prospectsRaw.tenantId, tenantId), eq(prospectsRaw.phone, phone)) as any,
          })
        : null;

      if (found) {
        prospectId = found.id;
      } else {
        const [createdProspect] = await db
          .insert(prospectsRaw)
          .values({
            tenantId,
            source: "voice_inbound",
            businessName: name || "Caller",
            phone: phone || null,
            email: email || null,
            consentState: "unknown",
          })
          .returning({ id: prospectsRaw.id });

        prospectId = createdProspect.id;
      }
    }

    const [appointment] = await db
      .insert(appointments)
      .values({
        tenantId,
        prospectId,
        calBookingUid: null,
        startAt: bookingStart,
        endAt: bookingEnd,
        status: "confirmed",
        notes: getString(body, ["notes"]) || null,
      })
      .returning({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt, status: appointments.status });

    if (attempt) {
      await db
        .update(callAttempts)
        .set({ bookingStatus: "confirmed", bookingRef: appointment.id })
        .where(eq(callAttempts.id, attempt.id));
    }

    res.json({ data: { booking: appointment } });
  } catch (err) {
    next(err);
  }
});

router.post("/tools/escalate-to-human", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const sessionId = getString(body, ["sessionId", "session_id"]);

    if (sessionId) {
      await db
        .update(assistantSessions)
        .set({ escalated: true })
        .where(eq(assistantSessions.id, sessionId));
    }

    res.json({ data: { escalated: true, message: "Connecting you with a team member now." } });
  } catch (err) {
    next(err);
  }
});

router.post("/tools/mark-do-not-contact", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const { attempt, tenantId, error } = await resolveTenantAndAttempt(body);

    if (error === "TENANT_MISMATCH") {
      res.status(403).json({ error: "FORBIDDEN", message: "tenantId does not match session or call attempt" });
      return;
    }

    const resolvedTenantId = tenantId || attempt?.tenantId || "";

    if (!resolvedTenantId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "tenantId or callAttemptId is required" });
      return;
    }

    const phone = normalizePhone(getString(body, ["phone", "from_number"]));
    const email = getString(body, ["email"]).toLowerCase() || "";

    if (!phone && !email && !attempt) {
      res.status(400).json({ error: "INVALID_INPUT", message: "phone, email, or callAttemptId is required" });
      return;
    }

    let attemptProspect = null;
    if (attempt) {
      attemptProspect = await db.query.prospectsRaw.findFirst({ where: eq(prospectsRaw.id, attempt.prospectId) });
    }

    await db.insert(doNotContact).values({
      tenantId: resolvedTenantId,
      phone: phone || attemptProspect?.phone || null,
      email: email || attemptProspect?.email || null,
      domain: attemptProspect?.domain ?? null,
      reason: "unsubscribe",
    });

    if (attempt) {
      await db
        .update(callAttempts)
        .set({
          status: "dnd",
          outcome: "do_not_contact",
          dndAt: new Date(),
          nextAttemptAt: null,
        })
        .where(eq(callAttempts.id, attempt.id));

      await db
        .update(callAttempts)
        .set({
          status: "dnd",
          outcome: "do_not_contact",
          dndAt: new Date(),
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(callAttempts.tenantId, attempt.tenantId),
            eq(callAttempts.prospectId, attempt.prospectId),
            eq(callAttempts.direction, "outbound"),
            inArray(callAttempts.status, ["queued", "retry_scheduled"]),
          ) as any,
        );
    }

    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.post("/tools/log-call-outcome", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = getNestedObject(req.body);
    const callAttemptId = getString(body, ["callAttemptId", "call_attempt_id"]);
    if (!callAttemptId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "callAttemptId is required" });
      return;
    }

    const attempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) });
    if (!attempt) {
      res.status(404).json({ error: "NOT_FOUND", message: "Call attempt not found" });
      return;
    }

    const rawStatus = getString(body, ["status", "outcome"]) || attempt.status;
    const status = mapRetellStatus(rawStatus);
    const duration = Number.parseInt(getString(body, ["duration", "duration_seconds"]), 10);

    await db
      .update(callAttempts)
      .set({
        status,
        outcome: status,
        duration: Number.isFinite(duration) ? duration : attempt.duration,
        recordingUrl: getString(body, ["recordingUrl", "recording_url"]) || attempt.recordingUrl,
        transcriptUrl: getString(body, ["transcriptUrl", "transcript_url"]) || attempt.transcriptUrl,
      })
      .where(eq(callAttempts.id, attempt.id));

    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
