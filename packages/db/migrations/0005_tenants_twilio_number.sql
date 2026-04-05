-- QYRO — typed tenant Twilio number for fast inbound routing lookup

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "twilio_number" text;

-- Backfill from legacy metadata keys if present.
UPDATE "tenants"
SET "twilio_number" = regexp_replace(
  COALESCE(
    NULLIF(metadata->>'twilio_number', ''),
    NULLIF(metadata->>'twilioNumber', '')
  ),
  '[^+0-9]',
  '',
  'g'
)
WHERE "twilio_number" IS NULL
  AND COALESCE(
    NULLIF(metadata->>'twilio_number', ''),
    NULLIF(metadata->>'twilioNumber', '')
  ) IS NOT NULL;

CREATE INDEX IF NOT EXISTS "tenants_twilio_number_idx"
  ON "tenants" ("twilio_number");
