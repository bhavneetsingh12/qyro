// QYRO Outreach Worker — BullMQ
// Processes jobs from the "outreach" queue.
// Calls runOutreach() per job. Writes permanent failures to dead_letter_queue.

import { Worker, type Job } from "bullmq";
import { redis, QUEUE_NAMES, type OutreachJobData } from "../queues";
import { runOutreach } from "@qyro/agents";
import { db, deadLetterQueue } from "@qyro/db";

function createOutreachWorker() {
  const worker = new Worker<OutreachJobData>(
    QUEUE_NAMES.OUTREACH,
    async (job: Job<OutreachJobData>) => {
      const { tenantId, prospectId, sequenceId } = job.data;
      console.log(`[outreachWorker] job ${job.id} — prospect ${prospectId}`);

      const result = await runOutreach({
        tenantId,
        prospectId,
        sequenceId,
        runId: job.id ?? undefined,
      });

      if (!result.ok) {
        if (result.error.code === "QUOTA_EXCEEDED") {
          console.warn(`[outreachWorker] quota exceeded for tenant ${tenantId}, dropping job ${job.id}`);
          return;
        }
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }

      if (result.data.skipped) {
        console.log(`[outreachWorker] skipped — prospect ${prospectId} reason=${result.data.skipReason}`);
        return;
      }

      console.log(
        `[outreachWorker] done — attempt ${result.data.messageAttemptId} ` +
        `channel=${result.data.channel}`,
      );
    },
    {
      connection:  redis,
      concurrency: 2,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;

    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (attemptsLeft > 0) return;

    console.error(`[outreachWorker] job ${job.id} failed permanently:`, err.message);

    await db
      .insert(deadLetterQueue)
      .values({
        tenantId:     job.data.tenantId,
        workflowName: QUEUE_NAMES.OUTREACH,
        payload:      job.data,
        errorType:    err.name ?? "Error",
        lastError:    err.message,
        attemptCount: job.attemptsMade,
      })
      .catch((e) => console.error("[outreachWorker] dead-letter write failed:", e));
  });

  worker.on("error", (err) => {
    console.error("[outreachWorker] worker error:", err);
  });

  return worker;
}

export { createOutreachWorker };

// ─── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const worker = createOutreachWorker();
  console.log(`[outreachWorker] listening on queue: ${QUEUE_NAMES.OUTREACH}`);

  async function shutdown() {
    await worker.close();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);
}
