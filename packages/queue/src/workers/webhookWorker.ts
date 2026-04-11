import { Worker, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import {
  db,
  callAttempts,
  auditLogs,
} from "@qyro/db";
import {
  redis,
  QUEUE_NAMES,
  outboundCallQueue,
  publishRealtimeEvent,
  type WebhookJobData,
} from "../index";

type EscalationNotifyPayload = {
  sessionId: string;
  prospectName?: string;
  prospectPhone?: string | null;
  escalationContactPhone?: string | null;
  escalationContactEmail?: string | null;
  fromNumber?: string | null;
  escalationReason?: string;
  appBaseUrl?: string;
};

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

function buildEscalationAlertBody(tenantId: string, payload: EscalationNotifyPayload): string {
  const appBaseUrl = payload.appBaseUrl ?? "https://app.qyro.us";
  const sessionLink = `${appBaseUrl}/client/conversations?sessionId=${encodeURIComponent(payload.sessionId)}`;
  const customer = payload.prospectName || payload.prospectPhone || "Unknown customer";
  return `QYRO Alert: Customer ${customer} needs immediate assistance. Tenant: ${tenantId}. Session: ${sessionLink}`;
}

async function sendEscalationSms(tenantId: string, payload: EscalationNotifyPayload): Promise<boolean> {
  const to = String(payload.escalationContactPhone ?? "").trim();
  const from = String(payload.fromNumber ?? "").trim();
  if (!to || !from) return false;

  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const apiToken = process.env.SIGNALWIRE_API_TOKEN;
  const spaceUrl = String(process.env.SIGNALWIRE_SPACE_URL ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!projectId || !apiToken || !spaceUrl) return false;

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", buildEscalationAlertBody(tenantId, payload));

  const res = await fetch(
    `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Escalation SMS failed ${res.status}: ${body.slice(0, 200)}`);
  }

  return true;
}

async function sendEscalationEmail(tenantId: string, payload: EscalationNotifyPayload): Promise<boolean> {
  const toEmail = String(payload.escalationContactEmail ?? "").trim();
  if (!toEmail) return false;

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? "no-reply@qyro.us";
  if (!apiKey) return false;

  const customer = payload.prospectName || payload.prospectPhone || "Unknown customer";
  const appBaseUrl = payload.appBaseUrl ?? "https://app.qyro.us";
  const sessionLink = `${appBaseUrl}/client/conversations?sessionId=${encodeURIComponent(payload.sessionId)}`;
  const text = [
    "A customer requires immediate attention.",
    "",
    `Customer: ${customer}`,
    `Phone: ${payload.prospectPhone ?? "unknown"}`,
    `Reason: ${payload.escalationReason ?? "escalation requested"}`,
    `Session: ${sessionLink}`,
    "",
    `Tenant: ${tenantId}`,
    "",
    "- QYRO Assist",
  ].join("\n");

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: "QYRO Assist" },
      subject: `QYRO Alert: ${customer} needs assistance`,
      content: [{ type: "text/plain", value: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Escalation email failed ${res.status}: ${body.slice(0, 200)}`);
  }

  return true;
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

async function processEscalationNotifyJob(job: WebhookJobData): Promise<void> {
  if (!job.tenantId) throw new Error("escalation_notify missing tenantId");

  const payload = job.body as EscalationNotifyPayload;
  if (!payload.sessionId) throw new Error("escalation_notify missing sessionId");

  const [smsResult, emailResult] = await Promise.allSettled([
    sendEscalationSms(job.tenantId, payload),
    sendEscalationEmail(job.tenantId, payload),
  ]);

  await db.insert(auditLogs).values({
    tenantId: job.tenantId,
    action: "escalation.delivery.attempted",
    resourceType: "session",
    resourceId: payload.sessionId,
    after: {
      sms: smsResult.status === "fulfilled" ? smsResult.value : `error:${smsResult.reason instanceof Error ? smsResult.reason.message : String(smsResult.reason)}`,
      email: emailResult.status === "fulfilled" ? emailResult.value : `error:${emailResult.reason instanceof Error ? emailResult.reason.message : String(emailResult.reason)}`,
    },
  });

  if (smsResult.status === "rejected" || emailResult.status === "rejected") {
    throw new Error("escalation notification delivery failed");
  }
}

async function processWebhookJob(job: Job<WebhookJobData>) {
  const data = job.data;

  if (data.kind === "voice_status") {
    await processVoiceStatusJob(data);
    return;
  }

  if (data.kind === "escalation_notify") {
    await processEscalationNotifyJob(data);
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

  if (data.kind === "escalation_notify") {
    return String(data.tenantId ?? "").trim() || null;
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
