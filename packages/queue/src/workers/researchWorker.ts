// QYRO Research Worker — BullMQ
// Processes jobs from the "research" queue.
// Calls runResearch() per job. Writes permanent failures to dead_letter_queue.

import { Worker, type Job } from "bullmq";
import { redis, QUEUE_NAMES, type ResearchJobData } from "../queues";
import { runResearch } from "@qyro/agents";
import { db, deadLetterQueue } from "@qyro/db";

function createResearchWorker() {
  const worker = new Worker<ResearchJobData>(
    QUEUE_NAMES.RESEARCH,
    async (job: Job<ResearchJobData>) => {
      const { tenantId, prospectId, domain } = job.data;
      console.log(`[researchWorker] job ${job.id} — prospect ${prospectId}`);

      const result = await runResearch({
        tenantId,
        prospectId,
        domain,
        runId: job.id ?? undefined,
      });

      if (!result.ok) {
        if (result.error.code === "QUOTA_EXCEEDED") {
          // Quota errors are not retryable — drop gracefully
          console.warn(`[researchWorker] quota exceeded for tenant ${tenantId}, dropping job ${job.id}`);
          return;
        }
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }

      console.log(
        `[researchWorker] done — prospect ${prospectId} ` +
        `fromCache=${result.data.fromCache} urgency=${result.data.urgencyScore}`,
      );
    },
    {
      connection:  redis,
      concurrency: 3,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;

    // Only dead-letter after all retries exhausted
    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (attemptsLeft > 0) return;

    console.error(`[researchWorker] job ${job.id} failed permanently:`, err.message);

    await db
      .insert(deadLetterQueue)
      .values({
        tenantId:     job.data.tenantId,
        workflowName: QUEUE_NAMES.RESEARCH,
        payload:      job.data,
        errorType:    err.name ?? "Error",
        lastError:    err.message,
        attemptCount: job.attemptsMade,
      })
      .catch((e) => console.error("[researchWorker] dead-letter write failed:", e));
  });

  worker.on("error", (err) => {
    console.error("[researchWorker] worker error:", err);
  });

  return worker;
}

export { createResearchWorker };

// ─── Entry point ───────────────────────────────────────────────────────────────

const REQUIRED_ENV_RESEARCH = ["DATABASE_URL", "REDIS_URL"];

if (require.main === module) {
  async function start() {
    const missing = REQUIRED_ENV_RESEARCH.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error("❌ MISSING ENV VARS:", missing.join(", "));
      process.exit(1);
    }

    const worker = createResearchWorker();
    console.log(`[researchWorker] listening on queue: ${QUEUE_NAMES.RESEARCH}`);

    const http = require("http") as typeof import("http");
    const PORT = Number(process.env.PORT ?? 3004);
    http.createServer((_req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
      const healthy = worker !== null;
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", worker: "research", uptime: process.uptime() }));
    }).listen(PORT, () => {
      console.log(`[researchWorker] health server on port ${PORT}`);
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
