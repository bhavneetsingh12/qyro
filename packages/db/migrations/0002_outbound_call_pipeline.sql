-- QYRO — outbound call pipeline fields
-- Adds retry/DND/compliance tracking to call_attempts.

ALTER TABLE "call_attempts"
  ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp,
  ADD COLUMN IF NOT EXISTS "source" text,
  ADD COLUMN IF NOT EXISTS "compliance_blocked_reason" text,
  ADD COLUMN IF NOT EXISTS "booking_status" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "booking_ref" text,
  ADD COLUMN IF NOT EXISTS "dnd_at" timestamp,
  ADD COLUMN IF NOT EXISTS "scheduled_by" uuid REFERENCES "users"("id");

CREATE INDEX IF NOT EXISTS "call_attempts_status_next_attempt_idx"
  ON "call_attempts" ("tenant_id", "status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "call_attempts_direction_status_idx"
  ON "call_attempts" ("tenant_id", "direction", "status");
