import { Worker, type Job } from "bullmq";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  db,
  callAttempts,
  prospectsRaw,
  tenants,
  doNotContact,
  auditLogs,
  inferProspectTimezone,
  resolveCallingTimezone,
  evaluateComplianceForProspect,
} from "@qyro/db";
import { redis, QUEUE_NAMES, outboundCallQueue, type OutboundCallJobData } from "../queues";
import { publishRealtimeEvent } from "../realtime";

const RETRY_MINUTES = [15, 120, 1440, 4320];
const CAPACITY_RETRY_MS = 60 * 1000;

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function getNextRetryDate(attemptCount: number): Date | null {
  const idx = Math.max(0, attemptCount - 1);
  const mins = RETRY_MINUTES[idx];
  if (!mins) return null;
  return new Date(Date.now() + mins * 60 * 1000);
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required for outbound calling`);
  }
  return value;
}

function outboundGlobalPauseEnabled(): boolean {
  return String(process.env.OUTBOUND_VOICE_GLOBAL_PAUSED ?? "false").toLowerCase() === "true";
}

function getMaxConcurrentCalls(meta: Record<string, unknown>): number {
  const raw = Number(meta.outbound_voice_max_concurrent_calls ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(Math.trunc(raw), 25));
}

function toRealtimeCallStatus(status: string): "queued" | "dialing" | "connected" | "completed" | "failed" {
  if (status === "answered") return "connected";
  if (status === "dialing") return "dialing";
  if (status === "completed") return "completed";
  if (status === "queued" || status === "retry_scheduled") return "queued";
  return "failed";
}

function emitCallStatusChange(tenantId: string, callAttemptId: string, status: string): void {
  void publishRealtimeEvent({
    type: "call_status_change",
    tenantId,
    payload: {
      callAttemptId,
      status: toRealtimeCallStatus(status),
      rawStatus: status,
    },
  }).catch((err) => {
    console.error("[outboundCallWorker] realtime publish failed:", err);
  });
}

async function isDnd(tenantId: string, phone?: string | null, email?: string | null, domain?: string | null): Promise<boolean> {
  const normalizedPhone = normalizePhone(phone);

  const row = await db.query.doNotContact.findFirst({
    where: and(
      eq(doNotContact.tenantId, tenantId),
      or(
        normalizedPhone ? eq(doNotContact.phone, normalizedPhone) : undefined,
        email ? eq(doNotContact.email, email) : undefined,
        domain ? eq(doNotContact.domain, domain) : undefined,
      ) as any,
    ),
  });

  return !!row;
}

async function dialSignalWire(params: {
  to: string;
  from: string;
  callAttemptId: string;
}): Promise<{ sid: string; status?: string }> {
  const projectId = getEnv("SIGNALWIRE_PROJECT_ID");
  const apiToken = getEnv("SIGNALWIRE_API_TOKEN");
  const spaceUrl = getEnv("SIGNALWIRE_SPACE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiBase = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:3005";

  const form = new URLSearchParams();
  form.set("To", params.to);
  form.set("From", params.from);
  form.set("Url", `${apiBase}/api/v1/voice/outbound/twiml?callAttemptId=${encodeURIComponent(params.callAttemptId)}`);
  form.set("StatusCallback", `${apiBase}/api/v1/voice/status?callAttemptId=${encodeURIComponent(params.callAttemptId)}`);
  form.set("StatusCallbackEvent", "initiated ringing answered completed");
  form.set("StatusCallbackMethod", "POST");

  const res = await fetch(`https://${spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SignalWire dial failed ${res.status}: ${body.slice(0, 250)}`);
  }

  const data = (await res.json()) as { sid: string; status?: string };
  return data;
}

function isWithinCallingHours(
  prospectTimezone: string | null,
  tenantTimezone: string | null,
): boolean {
  const tz = resolveCallingTimezone(prospectTimezone, tenantTimezone);
  const now = DateTime.now().setZone(tz);
  const hour = now.hour;
  const day = now.weekday; // 1=Mon … 7=Sun
  // No calls before 8am or at/after 9pm local time, no calls on Sunday
  return hour >= 8 && hour < 21 && day !== 7;
}

function getNextCallingWindowStart(
  prospectTimezone: string | null,
  tenantTimezone: string | null,
): Date {
  const tz = resolveCallingTimezone(prospectTimezone, tenantTimezone);
  let next = DateTime.now()
    .setZone(tz)
    .startOf("day")
    .set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  // If 8am today is already past, move to tomorrow
  if (DateTime.now().setZone(tz) >= next) {
    next = next.plus({ days: 1 });
  }
  // Skip Sunday (weekday === 7) → move to Monday
  if (next.weekday === 7) {
    next = next.plus({ days: 1 });
  }
  return next.toJSDate();
}

async function processOutboundCallJob(job: Job<OutboundCallJobData>) {
  const { tenantId, callAttemptId } = job.data;

  const attempt = await db.query.callAttempts.findFirst({
    where: and(
      eq(callAttempts.id, callAttemptId),
      eq(callAttempts.tenantId, tenantId),
    ),
  });

  if (!attempt) {
    console.warn(`[outboundCallWorker] attempt not found ${callAttemptId}`);
    return;
  }

  if (attempt.direction !== "outbound") {
    console.warn(`[outboundCallWorker] non-outbound attempt ${callAttemptId} ignored`);
    return;
  }

  if (!["queued", "retry_scheduled"].includes(attempt.status ?? "")) {
    console.log(`[outboundCallWorker] attempt ${callAttemptId} status=${attempt.status} skipped`);
    return;
  }

  const prospect = await db.query.prospectsRaw.findFirst({
    where: and(
      eq(prospectsRaw.id, attempt.prospectId),
      eq(prospectsRaw.tenantId, tenantId),
    ),
  });

  if (!prospect) {
    await db
      .update(callAttempts)
      .set({
        status: "failed",
        outcome: "prospect_not_found",
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  const isOnDnd = await isDnd(tenantId, prospect.phone, prospect.email, prospect.domain);
  if (isOnDnd) {
    await db
      .update(callAttempts)
      .set({
        status: "dnd",
        outcome: "do_not_contact",
        dndAt: new Date(),
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.id, tenantId), eq(tenants.active, true)),
  });

  const tenantMeta = (tenant?.metadata as Record<string, unknown> | null) ?? {};
  const compliance = await evaluateComplianceForProspect({
    tenantId,
    prospectId: prospect.id,
    channel: "voice",
    automated: true,
    strictMode: tenantMeta.tcpa_strict_mode === true,
    sellerName: tenant?.name ?? null,
  });

  if (compliance.decision !== "ALLOW") {
    await db
      .update(callAttempts)
      .set({
        status: "blocked_compliance",
        outcome: "blocked_compliance",
        complianceBlockedReason: `${compliance.decision}:${compliance.ruleCode}`,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  const outboundEnabled = tenantMeta.outbound_voice_enabled !== false;
  const tenantPaused = tenantMeta.outbound_voice_paused === true;
  const globalPaused = outboundGlobalPauseEnabled();

  if (!outboundEnabled) {
    await db
      .update(callAttempts)
      .set({
        status: "blocked_compliance",
        outcome: "blocked_compliance",
        complianceBlockedReason: "outbound_voice_disabled",
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  if (tenantPaused || globalPaused) {
    const retryAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .update(callAttempts)
      .set({
        status: "retry_scheduled",
        outcome: tenantPaused ? "paused_tenant" : "paused_global",
        nextAttemptAt: retryAt,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "retry_scheduled");

    await outboundCallQueue.add(
      "outbound-call",
      { tenantId, callAttemptId: attempt.id },
      {
        delay: Math.max(0, retryAt.getTime() - Date.now()),
        jobId: `outbound-call:${attempt.id}:paused:${Date.now()}`,
      },
    );
    return;
  }

  const maxConcurrentCalls = getMaxConcurrentCalls(tenantMeta);
  const activeRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.tenantId, tenantId),
        eq(callAttempts.direction, "outbound"),
        inArray(callAttempts.status, ["dialing", "ringing", "answered"]),
      ),
    );

  const activeCallCount = Number(activeRows[0]?.count ?? 0);
  if (activeCallCount >= maxConcurrentCalls) {
    const retryAt = new Date(Date.now() + CAPACITY_RETRY_MS);

    await db
      .update(callAttempts)
      .set({
        status: "retry_scheduled",
        outcome: "capacity_throttled",
        nextAttemptAt: retryAt,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "retry_scheduled");

    await outboundCallQueue.add(
      "outbound-call",
      { tenantId, callAttemptId: attempt.id },
      {
        delay: CAPACITY_RETRY_MS,
        jobId: `outbound-call:${attempt.id}:capacity:${Date.now()}`,
      },
    );
    return;
  }

  // ─── Calling hours gate ────────────────────────────────────────────────────
  const tenantTimezone = (tenantMeta.timezone as string | null) ?? null;
  const prospectTimezone = prospect.prospectTimezone ?? inferProspectTimezone(prospect.address ?? null);
  const effectiveTimezone = resolveCallingTimezone(prospectTimezone, tenantTimezone);
  const timezoneSource = prospect.prospectTimezone
    ? "prospect_record"
    : prospectTimezone
      ? "prospect_address"
      : tenantTimezone
        ? "tenant_default"
        : "system_default";

  if (!isWithinCallingHours(prospectTimezone, tenantTimezone)) {
    const nextWindow = getNextCallingWindowStart(prospectTimezone, tenantTimezone);
    const delayMs = Math.max(0, nextWindow.getTime() - Date.now());

    await db
      .update(callAttempts)
      .set({
        status: "retry_scheduled",
        outcome: "outside_calling_hours",
        nextAttemptAt: nextWindow,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "retry_scheduled");

    await db.insert(auditLogs).values({
      tenantId,
      action: "outbound_call.skipped",
      resourceType: "call_attempt",
      resourceId: attempt.id,
      after: {
        reason: "outside_calling_hours",
        nextWindowAt: nextWindow.toISOString(),
        timezone: effectiveTimezone,
        timezoneSource,
        prospectAddress: prospect.address ?? null,
      },
    });

    await outboundCallQueue.add(
      "outbound-call",
      { tenantId, callAttemptId: attempt.id },
      {
        delay: delayMs,
        jobId: `outbound-call:${attempt.id}:hours:${nextWindow.getTime()}`,
      },
    );
    return;
  }

  const to = normalizePhone(prospect.phone);
  const from = normalizePhone(
    tenant?.voiceNumber
      ?? (tenantMeta.voice_number as string | undefined)
      ?? (tenantMeta.voiceNumber as string | undefined)
      ?? "",
  );

  if (!to || !from) {
    const outcome = !to ? "missing_prospect_phone" : "missing_voice_number";
    await db
      .update(callAttempts)
      .set({
        status: "failed",
        outcome,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  const nextAttemptCount = (attempt.attemptCount ?? 0) + 1;

  await db
    .update(callAttempts)
    .set({
      status: "dialing",
      outcome: "dialing",
      attemptCount: nextAttemptCount,
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
    })
    .where(eq(callAttempts.id, attempt.id));
  emitCallStatusChange(tenantId, attempt.id, "dialing");

  const isOnDndBeforeDial = await isDnd(tenantId, prospect.phone, prospect.email, prospect.domain);
  if (isOnDndBeforeDial) {
    await db
      .update(callAttempts)
      .set({
        status: "dnd",
        outcome: "do_not_contact",
        dndAt: new Date(),
        nextAttemptAt: null,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "failed");
    return;
  }

  try {
    const sw = await dialSignalWire({ to, from, callAttemptId: attempt.id });

    await db
      .update(callAttempts)
      .set({
        callSid: sw.sid,
        status: "ringing",
        outcome: sw.status ?? "ringing",
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, "ringing");
  } catch (err) {
    const retryAt = nextAttemptCount < (attempt.maxAttempts ?? 4)
      ? getNextRetryDate(nextAttemptCount)
      : null;

    await db
      .update(callAttempts)
      .set({
        status: retryAt ? "retry_scheduled" : "failed",
        outcome: retryAt ? "dial_failed_retry" : "dial_failed",
        nextAttemptAt: retryAt,
      })
      .where(eq(callAttempts.id, attempt.id));
    emitCallStatusChange(tenantId, attempt.id, retryAt ? "retry_scheduled" : "failed");

    if (retryAt) {
      const delayMs = Math.max(0, retryAt.getTime() - Date.now());
      await outboundCallQueue.add(
        "outbound-call",
        { tenantId, callAttemptId: attempt.id },
        {
          delay: delayMs,
          jobId: `outbound-call:${attempt.id}:${nextAttemptCount}`,
        },
      );
    }

    throw err;
  }
}

function createOutboundCallWorker() {
  const worker = new Worker<OutboundCallJobData>(
    QUEUE_NAMES.OUTBOUND_CALL,
    processOutboundCallJob,
    {
      connection: redis,
      concurrency: 3,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[outboundCallWorker] job ${job?.id ?? "unknown"} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[outboundCallWorker] worker error:", err);
  });

  return worker;
}

export { createOutboundCallWorker };

const REQUIRED_ENV_OUTBOUND = ["DATABASE_URL", "REDIS_URL"];

if (require.main === module) {
  async function start() {
    const missing = REQUIRED_ENV_OUTBOUND.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error("❌ MISSING ENV VARS:", missing.join(", "));
      process.exit(1);
    }

    const worker = createOutboundCallWorker();
    console.log(`[outboundCallWorker] listening on queue: ${QUEUE_NAMES.OUTBOUND_CALL}`);

    const http = require("http") as typeof import("http");
    const PORT = Number(process.env.PORT ?? 3002);
    http.createServer((_req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
      const healthy = worker !== null;
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", worker: "outbound-call", uptime: process.uptime() }));
    }).listen(PORT, () => {
      console.log(`[outboundCallWorker] health server on port ${PORT}`);
    });

    worker.on("completed", (job) => {
      console.log(`✅ Job ${job.id} completed`);
    });

    async function shutdown() {
      await worker.close();
      process.exit(0);
    }

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  start().catch((err) => {
    console.error("❌ STARTUP FAILED:", err);
    process.exit(1);
  });
}
