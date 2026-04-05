-- Migration: rename provider-specific column names to provider-neutral names
-- tenants.twilio_number   -> tenants.voice_number
-- call_attempts.twilio_call_sid -> call_attempts.call_sid

-- Rename column on tenants
ALTER TABLE "tenants" RENAME COLUMN "twilio_number" TO "voice_number";

-- Rename index (drop old, create new)
DROP INDEX IF EXISTS "tenants_twilio_number_idx";
CREATE INDEX IF NOT EXISTS "tenants_voice_number_idx" ON "tenants" ("voice_number");

-- Rename column on call_attempts
ALTER TABLE "call_attempts" RENAME COLUMN "twilio_call_sid" TO "call_sid";
