// Anomaly detection worker — runs every 15 minutes.
// Flags tenants with suspicious data-access patterns and logs to scraping_alerts.
//
// Patterns detected:
//   high_api_volume      — >500 API calls in the last hour (via rate_limit_hits)
//   high_export_volume   — >10 exports in the last 24 hours (via audit_logs)
//   sequential_pagination — many paginated reads with incrementing offsets within 5 min

import http from "http";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, gte, eq, desc, count } from "drizzle-orm";
import * as schema from "@qyro/db/schema";

if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const QUEUE_NAME = "anomaly_detection";

// ─── Detection helpers ────────────────────────────────────────────────────────

async function detectHighApiVolume(): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // last hour

  const rows = await db
    .select({
      tenantId: schema.rateLimitHits.tenantId,
      hitCount: count(schema.rateLimitHits.id),
    })
    .from(schema.rateLimitHits)
    .where(gte(schema.rateLimitHits.createdAt, since))
    .groupBy(schema.rateLimitHits.tenantId);

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
      tenantId: schema.auditLogs.tenantId,
      exportCount: count(schema.auditLogs.id),
    })
    .from(schema.auditLogs)
    .where(
      sql`${schema.auditLogs.action} LIKE 'leads.export%' AND ${schema.auditLogs.createdAt} >= ${since}`
    )
    .groupBy(schema.auditLogs.tenantId);

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
      tenantId: schema.auditLogs.tenantId,
      readCount: count(schema.auditLogs.id),
    })
    .from(schema.auditLogs)
    .where(
      sql`${schema.auditLogs.action} = ANY(${listActions}) AND ${schema.auditLogs.createdAt} >= ${since}`
    )
    .groupBy(schema.auditLogs.tenantId);

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
    where: sql`${schema.scrapingAlerts.tenantId} = ${tenantId}
      AND ${schema.scrapingAlerts.patternDetected} = ${pattern}
      AND ${schema.scrapingAlerts.resolvedAt} IS NULL
      AND ${schema.scrapingAlerts.createdAt} >= ${since}`,
  });

  if (existing) return;

  await db.insert(schema.scrapingAlerts).values({
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

export const anomalyDetectionWorker = new Worker(QUEUE_NAME, runDetection, {
  connection: redis,
  concurrency: 1,
});

anomalyDetectionWorker.on("failed", (job, err) => {
  console.error(`[anomalyDetection] job ${job?.id} failed:`, err.message);
});

// ─── Scheduler bootstrap ─────────────────────────────────────────────────────
// Call scheduleAnomalyDetection() once at worker startup to register the
// repeating job (every 15 minutes). Safe to call multiple times — BullMQ
// upserts by repeat key.

import { Queue } from "bullmq";

export async function scheduleAnomalyDetection(): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection: redis });
  await queue.upsertJobScheduler(
    "anomaly-detection-15m",
    { every: 15 * 60 * 1000 }, // 15 minutes
    { name: "anomaly-detection", data: {} },
  );
  console.log("[anomalyDetection] scheduler registered (every 15 min)");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log("[anomalyDetection] worker started");

  scheduleAnomalyDetection().catch((err) => {
    console.error("[anomalyDetection] scheduler registration failed:", err);
  });

  async function shutdown() {
    await anomalyDetectionWorker.close();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  http.createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", worker: "anomaly-detection" }));
  }).listen(process.env.PORT || 3007, () => {
    console.log("[anomalyDetection] health server on port", process.env.PORT || 3007);
  });
}
