-- Migration: rename provider-specific column names to provider-neutral names
-- tenants.twilio_number        -> tenants.voice_number
-- call_attempts.twilio_call_sid -> call_attempts.call_sid
--
-- Idempotent: safe in all DB states —
--   • Only renames if old name exists AND new name does not yet exist.
--   • If new name already exists (rename already done), skips silently.
--   • If both exist (schema drift), skips rename and leaves voice_number in place.

DO $$
BEGIN
  -- tenants: rename twilio_number -> voice_number
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'twilio_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'voice_number'
  ) THEN
    ALTER TABLE "tenants" RENAME COLUMN "twilio_number" TO "voice_number";
  END IF;

  -- call_attempts: rename twilio_call_sid -> call_sid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_attempts' AND column_name = 'twilio_call_sid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_attempts' AND column_name = 'call_sid'
  ) THEN
    ALTER TABLE "call_attempts" RENAME COLUMN "twilio_call_sid" TO "call_sid";
  END IF;
END $$;

-- Indexes: provider-neutral names
DROP INDEX IF EXISTS "tenants_twilio_number_idx";
CREATE INDEX IF NOT EXISTS "tenants_voice_number_idx" ON "tenants" ("voice_number");
