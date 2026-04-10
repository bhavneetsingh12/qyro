// Anomaly detection worker — runs every 15 minutes.
// Flags tenants with suspicious data-access patterns and logs to scraping_alerts.
//
// Patterns detected:
//   high_api_volume      — >500 API calls in the last hour (via rate_limit_hits)
//   high_export_volume   — >10 exports in the last 24 hours (via audit_logs)
//   sequential_pagination — many paginated reads with incrementing offsets within 5 min

import http from "http";
import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { sql, gte, count, and, inArray } from "drizzle-orm";
import { db, rateLimitHits, auditLogs, scrapingAlerts } from "@qyro/db";

const REQUIRED_ENV_ANOMALY = ["DATABASE_URL", "REDIS_URL"];

let redis: IORedis;

const QUEUE_NAME = "anomaly_detection";

// ─── Detection helpers ────────────────────────────────────────────────────────

async function detectHighApiVolume(): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // last hour

  const rows = await db
    .select({
      tenantId: rateLimitHits.tenantId,
      hitCount: count(rateLimitHits.id),
    })
    .from(rateLimitHits)
    .where(gte(rateLimitHits.createdAt, since))
    .groupBy(rateLimitHits.tenantId);

  for (const row of rows) {
    if (Number(row.hitCount) > 500) {
      await insertAlert(row.tenantId, "high_api_volume", Number(row.hitCount), {
        window: "1h",
        threshold: 500,
      });
    }
  }
}

async function detectHighExportVolume(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

  const rows = await db
    .select({
      tenantId: auditLogs.tenantId,
      exportCount: count(auditLogs.id),
    })
    .from(auditLogs)
    .where(
      sql`${auditLogs.action} LIKE 'leads.export%' AND ${auditLogs.createdAt} >= ${since}`
    )
    .groupBy(auditLogs.tenantId);

  for (const row of rows) {
    if (Number(row.exportCount) > 10) {
      await insertAlert(row.tenantId, "high_export_volume", Number(row.exportCount), {
        window: "24h",
        threshold: 10,
      });
    }
  }
}

async function detectSequentialPagination(): Promise<void> {
  // Look for tenants making many paginated list reads within a 5-minute window.
  // A tenant with >20 list reads in 5 minutes is likely scraping page by page.
  const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes

  const listActions = ["leads.list", "calls.list", "sessions.list"];

  const rows = await db
    .select({
      tenantId: auditLogs.tenantId,
      readCount: count(auditLogs.id),
    })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.action, listActions),
        gte(auditLogs.createdAt, since),
      )
    )
    .groupBy(auditLogs.tenantId);

  for (const row of rows) {
    if (Number(row.readCount) > 20) {
      await insertAlert(row.tenantId, "sequential_pagination", Number(row.readCount), {
        window: "5m",
        threshold: 20,
      });
    }
  }
}

async function insertAlert(
  tenantId: string,
  pattern: string,
  requestCount: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  // Deduplicate: skip if a same-pattern alert was logged in the last hour
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const existing = await db.query.scrapingAlerts.findFirst({
    where: sql`${scrapingAlerts.tenantId} = ${tenantId}
      AND ${scrapingAlerts.patternDetected} = ${pattern}
      AND ${scrapingAlerts.resolvedAt} IS NULL
      AND ${scrapingAlerts.createdAt} >= ${since}`,
  });

  if (existing) return;

  await db.insert(scrapingAlerts).values({
    tenantId,
    patternDetected: pattern,
    requestCount,
    metadata,
  });

  // Internal alert — log prominently. Wire to Slack/email when available.
  console.warn(
    `[anomalyDetection] ALERT pattern=${pattern} tenant=${tenantId} count=${requestCount}`,
    JSON.stringify(metadata),
  );
  // TODO: wire to Slack webhook or email via sendEmail() when alerting is configured.
  // The scraping_alerts table is the authoritative record for now.
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function runDetection(_job: Job): Promise<void> {
  console.log("[anomalyDetection] running detection pass...");

  await Promise.allSettled([
    detectHighApiVolume(),
    detectHighExportVolume(),
    detectSequentialPagination(),
  ]);

  console.log("[anomalyDetection] detection pass complete");
}

let anomalyDetectionWorker: Worker;

// ─── Scheduler bootstrap ─────────────────────────────────────────────────────
// Call scheduleAnomalyDetection() once at worker startup to register the
// repeating job (every 15 minutes). Safe to call multiple times — BullMQ
// upserts by repeat key.

async function scheduleAnomalyDetection(): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection: redis });
  await queue.upsertJobScheduler(
    "anomaly-detection-15m",
    { every: 15 * 60 * 1000 }, // 15 minutes
    { name: "anomaly-detection", data: {} },
  );
  console.log("[anomalyDetection] scheduler registered (every 15 min)");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function start() {
  const missing = REQUIRED_ENV_ANOMALY.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("❌ MISSING ENV VARS:", missing.join(", "));
    process.exit(1);
  }

  redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

  anomalyDetectionWorker = new Worker(QUEUE_NAME, runDetection, {
    connection: redis,
    concurrency: 1,
  });

  anomalyDetectionWorker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  anomalyDetectionWorker.on("failed", (job, err) => {
    console.error(`[anomalyDetection] job ${job?.id} failed:`, err.message);
  });

  anomalyDetectionWorker.on("error", (err) => {
    console.error("[anomalyDetection] worker error:", err);
  });

  console.log("[anomalyDetection] worker started");

  await scheduleAnomalyDetection().catch((err) => {
    console.error("[anomalyDetection] scheduler registration failed:", err);
  });

  async function shutdown() {
    await anomalyDetectionWorker.close();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const PORT = process.env.PORT || 3007;
  http.createServer((_req, res) => {
    const healthy = anomalyDetectionWorker !== null;
    res.writeHead(healthy ? 200 : 503);
    res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", worker: "anomaly-detection", uptime: process.uptime() }));
  }).listen(PORT, () => {
    console.log("[anomalyDetection] health server on port", PORT);
  });
}

start().catch((err) => {
  console.error("❌ STARTUP FAILED:", err);
  process.exit(1);
});
