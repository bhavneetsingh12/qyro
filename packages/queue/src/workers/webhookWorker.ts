import { Worker, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import {
  db,
  assistantSessions,
  callAttempts,
  webhookEvents,
  auditLogs,
} from "@qyro/db";
import {
  redis,
  QUEUE_NAMES,
  outboundCallQueue,
  publishRealtimeEvent,
  type WebhookJobData,
} from "../index";

type RetellPayload = Record<string, unknown>;

type TranscriptTurn = {
  role: "user" | "assistant";
  content: string;
  ts?: string;
};

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

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text.length > 0) return text;
  }
  return null;
}

function mapTwilioStatusToPipeline(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "initiated") return "dialing";
  if (normalized === "ringing") return "ringing";
  if (normalized === "in-progress") return "answered";
  if (normalized === "completed") return "completed";
  if (normalized === "no-answer") return "no_answer";
  if (normalized === "busy") return "busy";
  if (normalized === "failed") return "failed";
  if (normalized === "canceled") return "canceled";
  return normalized || "unknown";
}

function mapRetellStatus(raw: string): string {
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

function toRealtimeCallStatus(status: string): "queued" | "dialing" | "connected" | "completed" | "failed" {
  if (status === "answered") return "connected";
  if (status === "dialing" || status === "ringing") return "dialing";
  if (status === "completed") return "completed";
  if (status === "queued" || status === "retry_scheduled") return "queued";
  return "failed";
}

function getNextRetryDate(attemptCount: number): Date | null {
  const mins = [15, 120, 1440, 4320][Math.max(0, attemptCount - 1)];
  if (!mins) return null;
  return new Date(Date.now() + mins * 60 * 1000);
}

async function fetchSignalWireTranscriptText(url: string): Promise<string | null> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const apiToken = process.env.SIGNALWIRE_API_TOKEN;

  try {
    const headers: Record<string, string> = {};
    if (projectId && apiToken) {
      headers.Authorization = `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) return null;

    const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = await res.json() as Record<string, unknown>;
      return firstNonEmpty(json.transcript, json.text, json.body);
    }

    const text = (await res.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
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

function parseTranscriptTurns(payload: RetellPayload): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  const candidateArrays = [
    payload.transcript,
    payload.utterances,
    payload.messages,
    getNestedObject(payload.call).transcript,
    getNestedObject(payload.call).utterances,
    getNestedObject(payload.conversation).turns,
  ];

  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const row = getNestedObject(item);
      const rawRole = getString(row, ["role", "speaker", "source"]).toLowerCase();
      const role: "user" | "assistant" = (rawRole.includes("agent") || rawRole.includes("assistant")) ? "assistant" : "user";
      const content = getString(row, ["text", "transcript", "content", "utterance"]);
      if (!content) continue;
      const ts = getString(row, ["timestamp", "time", "ts"]) || undefined;
      turns.push({ role, content, ts });
    }
  }

  if (turns.length > 0) return turns;

  const fallbackText = getString(payload, ["transcript", "text", "utterance"]);
  if (!fallbackText) return [];
  const speakerRaw = getString(payload, ["speaker", "role", "source"]).toLowerCase();
  const role: "user" | "assistant" = (speakerRaw.includes("agent") || speakerRaw.includes("assistant")) ? "assistant" : "user";
  return [{ role, content: fallbackText }];
}

function transcriptTextFromTurns(turns: TranscriptTurn[]): string {
  return turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
}

async function ensureRetellIdempotency(kind: string, payload: RetellPayload): Promise<{ ok: boolean; key?: string }> {
  const callId = resolveRetellCallId(payload) || resolveCallAttemptId(payload) || resolveSessionId(payload) || "unknown";
  const eventType = getString(payload, ["event_type", "event", "status", "call_status"]) || kind;
  const key = `retell:processed:${callId}:${kind}:${eventType}`;

  const result = await redis.set(key, "1", "EX", 24 * 60 * 60, "NX");
  return { ok: result === "OK", key };
}

async function processVoiceStatusJob(job: WebhookJobData): Promise<void> {
  const body = job.body;
  const query = job.query ?? {};

  const callSid = String(body.CallSid ?? "");
  const callStatus = String(body.CallStatus ?? "");
  const durationRaw = String(body.CallDuration ?? "0");
  const duration = Number.parseInt(durationRaw, 10) || 0;
  const recordingUrl = firstNonEmpty(body.RecordingUrl, body.RecordingURL, body.RecordingUrl0);
  const transcriptUrl = firstNonEmpty(body.TranscriptionUrl, body.TranscriptUrl, body.TranscriptionURL);
  const directTranscript = firstNonEmpty(body.TranscriptionText, body.TranscriptText, body.RecordingTranscript);
  const queryCallAttemptId = String(query.callAttemptId ?? "").trim();

  if (!callSid && !queryCallAttemptId) return;

  const attempt = await db.query.callAttempts.findFirst({
    where: callSid && queryCallAttemptId
      ? and(eq(callAttempts.callSid, callSid), eq(callAttempts.id, queryCallAttemptId))
      : callSid
        ? eq(callAttempts.callSid, callSid)
        : eq(callAttempts.id, queryCallAttemptId),
  });

  if (!attempt) return;

  const pipelineStatus = mapTwilioStatusToPipeline(callStatus);
  const retryable = ["no_answer", "busy", "failed"].includes(pipelineStatus);
  const attemptsUsed = attempt.attemptCount ?? 0;
  const maxAttempts = attempt.maxAttempts ?? 4;
  const shouldRetry = attempt.direction === "outbound" && retryable && attemptsUsed < maxAttempts;
  const retryAt = shouldRetry ? getNextRetryDate(attemptsUsed) : null;

  const fetchedTranscript = !directTranscript && transcriptUrl
    ? await fetchSignalWireTranscriptText(transcriptUrl)
    : null;
  const transcriptText = directTranscript ?? fetchedTranscript;
  const transcriptJson = transcriptText ? [{ role: "assistant", content: transcriptText, source: "signalwire" }] : [];

  await db
    .update(callAttempts)
    .set({
      duration,
      durationSeconds: duration,
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(transcriptUrl ? { transcriptUrl } : {}),
      ...(transcriptText ? { transcriptText, transcriptJson } : {}),
      outcome: pipelineStatus || callStatus || attempt.outcome,
      status: shouldRetry ? "retry_scheduled" : (pipelineStatus || attempt.status),
      nextAttemptAt: retryAt,
    })
    .where(eq(callAttempts.id, attempt.id));

  const realtimeStatus = shouldRetry ? "retry_scheduled" : (pipelineStatus || attempt.status);
  await publishRealtimeEvent({
    type: "call_status_change",
    tenantId: attempt.tenantId,
    payload: {
      callAttemptId: attempt.id,
      status: toRealtimeCallStatus(realtimeStatus),
      rawStatus: realtimeStatus,
      callSid,
    },
  });

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
}

async function processRetellCallEventsJob(job: WebhookJobData): Promise<void> {
  const payload = getNestedObject(job.body);
  const dedupe = await ensureRetellIdempotency("call-events", payload);
  if (!dedupe.ok) return;

  try {
    const callAttemptId = resolveCallAttemptId(payload);
    if (!callAttemptId) return;

    const attempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) });
    if (!attempt) return;

    const statusRaw = getString(payload, ["status", "event", "call_status"]);
    const status = mapRetellStatus(statusRaw || attempt.status || "failed");
    const durationRaw = getString(payload, ["duration", "duration_seconds", "call_duration"]);
    const parsedDuration = Number.parseInt(durationRaw, 10);
    const duration = Number.isFinite(parsedDuration) ? parsedDuration : undefined;
    const retellCallId = resolveRetellCallId(payload);
    const recordingUrl = getString(payload, ["recording_url", "recordingUrl", "recording"])
      || getString(getNestedObject(payload.call), ["recording_url", "recordingUrl", "recording"])
      || undefined;
    const transcriptUrl = getString(payload, ["transcript_url", "transcriptUrl"])
      || getString(getNestedObject(payload.call), ["transcript_url", "transcriptUrl"])
      || undefined;

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
        ...(duration !== undefined ? { durationSeconds: duration } : {}),
        callSid: retellCallId || attempt.callSid,
        ...(recordingUrl ? { recordingUrl } : {}),
        ...(transcriptUrl ? { transcriptUrl } : {}),
        nextAttemptAt: retryAt,
      })
      .where(eq(callAttempts.id, attempt.id));

    const realtimeStatus = shouldRetry ? "retry_scheduled" : status;
    await publishRealtimeEvent({
      type: "call_status_change",
      tenantId: attempt.tenantId,
      payload: {
        callAttemptId: attempt.id,
        status: toRealtimeCallStatus(realtimeStatus),
        rawStatus: realtimeStatus,
        retellCallId,
      },
    });

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

    await db
      .insert(webhookEvents)
      .values({
        tenantId: attempt.tenantId,
        source: "retell",
        eventType: "call-events",
        payload,
        processed: true,
        processedAt: new Date(),
      });
  } catch (err) {
    if (dedupe.key) await redis.del(dedupe.key);
    throw err;
  }
}

async function processRetellTranscriptEventsJob(job: WebhookJobData): Promise<void> {
  const payload = getNestedObject(job.body);
  const dedupe = await ensureRetellIdempotency("transcript-events", payload);
  if (!dedupe.ok) return;

  try {
    const sessionId = resolveSessionId(payload);
    const callAttemptId = resolveCallAttemptId(payload);

    const session = sessionId
      ? await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, sessionId) })
      : null;

    let attempt = callAttemptId
      ? await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) })
      : null;

    if (!attempt) {
      const callId = resolveRetellCallId(payload);
      if (callId) {
        attempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.callSid, callId) });
      }
    }

    if (!session && !attempt) return;

    const turns = parseTranscriptTurns(payload);
    if (turns.length === 0) return;

    const transcriptText = transcriptTextFromTurns(turns);

    if (session) {
      const currentHistory = Array.isArray(session.conversationHistory)
        ? (session.conversationHistory as Array<{ role: "user" | "assistant"; content: string }>).filter((m) => m && typeof m.content === "string")
        : [];

      const updatedHistory = [...currentHistory, ...turns.map((turn) => ({ role: turn.role, content: turn.content }))];

      await db
        .update(assistantSessions)
        .set({
          conversationHistory: updatedHistory,
          turnCount: updatedHistory.length,
        })
        .where(eq(assistantSessions.id, session.id));
    }

    if (attempt) {
      const mergedTurns = Array.isArray(attempt.transcriptJson)
        ? ([...attempt.transcriptJson, ...turns] as unknown[])
        : (turns as unknown[]);

      const mergedText = [String(attempt.transcriptText ?? "").trim(), transcriptText]
        .filter(Boolean)
        .join("\n");

      await db
        .update(callAttempts)
        .set({
          transcriptText: mergedText,
          transcriptJson: mergedTurns,
        })
        .where(eq(callAttempts.id, attempt.id));

      await db
        .insert(webhookEvents)
        .values({
          tenantId: attempt.tenantId,
          source: "retell",
          eventType: "transcript-events",
          payload,
          processed: true,
          processedAt: new Date(),
        });
    }
  } catch (err) {
    if (dedupe.key) await redis.del(dedupe.key);
    throw err;
  }
}

async function processWebhookJob(job: Job<WebhookJobData>) {
  const data = job.data;

  if (data.kind === "voice_status") {
    await processVoiceStatusJob(data);
    return;
  }

  if (data.kind === "retell_call_events") {
    await processRetellCallEventsJob(data);
    return;
  }

  if (data.kind === "retell_transcript_events") {
    await processRetellTranscriptEventsJob(data);
    return;
  }
}

async function resolveTenantId(data: WebhookJobData): Promise<string | null> {
  if (data.tenantId) return data.tenantId;

  if (data.kind === "voice_status") {
    const callSid = String(data.body?.CallSid ?? "").trim();
    const callAttemptId = String(data.query?.callAttemptId ?? "").trim();
    const attempt = await db.query.callAttempts.findFirst({
      where: callSid && callAttemptId
        ? and(eq(callAttempts.callSid, callSid), eq(callAttempts.id, callAttemptId))
        : callSid
          ? eq(callAttempts.callSid, callSid)
          : eq(callAttempts.id, callAttemptId),
    });
    return attempt?.tenantId ?? null;
  }

  const payload = getNestedObject(data.body);
  const callAttemptId = resolveCallAttemptId(payload);
  if (callAttemptId) {
    const attempt = await db.query.callAttempts.findFirst({ where: eq(callAttempts.id, callAttemptId) });
    if (attempt) return attempt.tenantId;
  }

  const sessionId = resolveSessionId(payload);
  if (sessionId) {
    const session = await db.query.assistantSessions.findFirst({ where: eq(assistantSessions.id, sessionId) });
    if (session) return session.tenantId;
  }

  return null;
}

function createWebhookWorker() {
  const worker = new Worker<WebhookJobData>(
    QUEUE_NAMES.WEBHOOK,
    processWebhookJob,
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;

    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (attemptsLeft > 0) return;

    const tenantId = await resolveTenantId(job.data);
    if (!tenantId) {
      console.error("[webhookWorker] failed with unknown tenant:", err.message);
      return;
    }

    await db.insert(auditLogs).values({
      tenantId,
      action: "webhook.worker.failed",
      resourceType: "webhook",
      after: {
        kind: job.data.kind,
        error: err.message,
      },
    });
  });

  worker.on("error", (err) => {
    console.error("[webhookWorker] worker error:", err);
  });

  return worker;
}

export { createWebhookWorker };

const REQUIRED_ENV_WEBHOOK = ["DATABASE_URL", "REDIS_URL"];

if (require.main === module) {
  async function start() {
    const missing = REQUIRED_ENV_WEBHOOK.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error("❌ MISSING ENV VARS:", missing.join(", "));
      process.exit(1);
    }

    const worker = createWebhookWorker();
    console.log(`[webhookWorker] listening on queue: ${QUEUE_NAMES.WEBHOOK}`);

    const http = require("http") as typeof import("http");
    const PORT = Number(process.env.PORT ?? 3006);
    http.createServer((_req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
      const healthy = worker !== null;
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", worker: "webhook", uptime: process.uptime() }));
    }).listen(PORT, () => {
      console.log(`[webhookWorker] health server on port ${PORT}`);
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
