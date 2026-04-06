-- Migration: rename provider-specific column names to provider-neutral names
-- tenants.twilio_number   -> tenants.voice_number
-- call_attempts.twilio_call_sid -> call_attempts.call_sid
-- Safe to re-run: all renames are guarded by existence checks.

DO $$
BEGIN
  -- Rename tenants.twilio_number -> voice_number (only if old name still exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'twilio_number'
  ) THEN
    ALTER TABLE "tenants" RENAME COLUMN "twilio_number" TO "voice_number";
  END IF;

  -- Rename call_attempts.twilio_call_sid -> call_sid (only if old name still exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'call_attempts' AND column_name = 'twilio_call_sid'
  ) THEN
    ALTER TABLE "call_attempts" RENAME COLUMN "twilio_call_sid" TO "call_sid";
  END IF;
END $$;

-- Rename index (drop old, create new)
DROP INDEX IF EXISTS "tenants_twilio_number_idx";
CREATE INDEX IF NOT EXISTS "tenants_voice_number_idx" ON "tenants" ("voice_number");
