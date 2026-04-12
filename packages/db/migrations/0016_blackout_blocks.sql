-- Add source and created_by to appointments
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "source" text,
  ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id");

-- Create blackout_blocks table
CREATE TABLE IF NOT EXISTS "blackout_blocks" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label"             text NOT NULL,
  "start_at"          timestamp NOT NULL,
  "end_at"            timestamp NOT NULL,
  "notes"             text,
  "provider_block_id" text,
  "created_by"        uuid REFERENCES "users"("id"),
  "created_at"        timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "blackout_blocks_tenant_idx"
  ON "blackout_blocks"("tenant_id");

-- Range overlap index: finds blocks that overlap a given window
CREATE INDEX IF NOT EXISTS "blackout_blocks_range_idx"
  ON "blackout_blocks"("tenant_id", "start_at", "end_at");
