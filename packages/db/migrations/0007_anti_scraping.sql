-- Migration 0007: Anti-scraping controls
-- Adds data freeze, extended audit log fields, scraping alerts table,
-- and ToS acceptance fields for legal record-keeping.

-- ── tenants: subscription cancellation data freeze ─────────────────────────────
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "data_frozen_at" TIMESTAMP;

-- ── users: ToS acceptance legal record ────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tos_accepted_at" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tos_accepted_ip" TEXT;

-- ── audit_logs: extended fields for data-access auditing ─────────────────────
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "request_count" INTEGER;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "response_record_count" INTEGER;

-- ── scraping_alerts: anomaly detection log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scraping_alerts" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "pattern_detected"  TEXT NOT NULL,
  "request_count"     INTEGER NOT NULL DEFAULT 0,
  "metadata"          JSONB NOT NULL DEFAULT '{}',
  "resolved_at"       TIMESTAMP,
  "created_at"        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "scraping_alerts_tenant_idx" ON "scraping_alerts" ("tenant_id", "created_at");

-- ── rate_limit_hits: rate limit violation log ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "rate_limit_hits" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "endpoint"    TEXT NOT NULL,
  "limit_type"  TEXT NOT NULL, -- "general_min" | "general_hour" | "general_day" | "heavy_min" | "heavy_hour" | "export_hour" | "export_day"
  "ip_address"  TEXT,
  "created_at"  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rate_limit_hits_tenant_idx" ON "rate_limit_hits" ("tenant_id", "created_at");
