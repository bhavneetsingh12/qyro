-- Migration 0010: call recording + transcript persistence fields
ALTER TABLE call_attempts
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS transcript_text text,
  ADD COLUMN IF NOT EXISTS transcript_json jsonb DEFAULT '[]'::jsonb;