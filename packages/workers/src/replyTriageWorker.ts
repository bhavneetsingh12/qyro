// QYRO Reply Triage Worker — BullMQ
// Processes jobs from the "reply" queue.
// Calls runReplyTriage() per job. Writes permanent failures to dead_letter_queue.

import http from "http";
import { Worker, type Job } from "bullmq";
import { redis, QUEUE_NAMES, type ReplyJobData } from "@qyro/queue/queues";
import { runReplyTriage } from "@qyro/agents";
import { db } from "@qyro/db";
import { deadLetterQueue } from "@qyro/db";

function createReplyTriageWorker() {
  const worker = new Worker<ReplyJobData>(
    QUEUE_NAMES.REPLY,
    async (job: Job<ReplyJobData>) => {
      const { tenantId, messageId, replyText } = job.data;
      console.log(`[replyTriageWorker] job ${job.id} — message ${messageId}`);

      const result = await runReplyTriage({
        tenantId,
        messageId,
        replyText,
        runId: job.id ?? undefined,
      });

      if (!result.ok) {
        if (result.error.code === "QUOTA_EXCEEDED") {
          console.warn(`[replyTriageWorker] quota exceeded for tenant ${tenantId}, dropping job ${job.id}`);
          return;
        }
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }

      const { classification, nextAction, addedToDNC } = result.data;
      console.log(
        `[replyTriageWorker] done — message ${messageId} ` +
        `classification=${classification} nextAction=${nextAction} addedToDNC=${addedToDNC}`,
      );
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;

    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (attemptsLeft > 0) return;

    console.error(`[replyTriageWorker] job ${job.id} failed permanently:`, err.message);

    await db
      .insert(deadLetterQueue)
      .values({
        tenantId: job.data.tenantId,
        workflowName: QUEUE_NAMES.REPLY,
        payload: job.data,
        errorType: err.name ?? "Error",
        lastError: err.message,
        attemptCount: job.attemptsMade,
      })
      .catch((e) => console.error("[replyTriageWorker] dead-letter write failed:", e));
  });

  worker.on("error", (err) => {
    console.error("[replyTriageWorker] worker error:", err);
  });

  return worker;
}

export { createReplyTriageWorker };

// ─── Entry point ───────────────────────────────────────────────────────────────

const REQUIRED_ENV_REPLY_TRIAGE = ["DATABASE_URL", "REDIS_URL"];

if (require.main === module) {
  async function start() {
    const missing = REQUIRED_ENV_REPLY_TRIAGE.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error("❌ MISSING ENV VARS:", missing.join(", "));
      process.exit(1);
    }

    const worker = createReplyTriageWorker();
    console.log(`[replyTriageWorker] listening on queue: ${QUEUE_NAMES.REPLY}`);

    worker.on("completed", (job) => {
      console.log(`✅ Job ${job.id} completed`);
    });

    async function shutdown() {
      await worker.close();
      process.exit(0);
    }
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    const PORT = process.env.PORT || 3005;
    http.createServer((_req, res) => {
      const healthy = worker !== null;
      res.writeHead(healthy ? 200 : 503);
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", worker: "reply-triage", uptime: process.uptime() }));
    }).listen(PORT, () => {
      console.log("[replyTriageWorker] health server on port", PORT);
    });
  }

  start().catch((err) => {
    console.error("❌ STARTUP FAILED:", err);
    process.exit(1);
  });
}