ALTER TABLE "compliance_decisions"
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "resolved_by" text,
  ADD COLUMN IF NOT EXISTS "resolution_action" text,
  ADD COLUMN IF NOT EXISTS "resolution_note" text;

CREATE INDEX IF NOT EXISTS "compliance_decisions_tenant_open_idx"
  ON "compliance_decisions"("tenant_id", "decision", "resolved_at", "evaluated_at");
