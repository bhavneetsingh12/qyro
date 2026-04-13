-- Session 18: store campaign compliance context on call_attempts

ALTER TABLE "call_attempts"
  ADD COLUMN IF NOT EXISTS "campaign_id" uuid,
  ADD COLUMN IF NOT EXISTS "compliance_seller_name" text,
  ADD COLUMN IF NOT EXISTS "compliance_automated" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "call_attempts_tenant_campaign_idx"
  ON "call_attempts"("tenant_id", "campaign_id");
