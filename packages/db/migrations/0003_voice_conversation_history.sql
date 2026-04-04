-- Migration: add conversation_history to assistant_sessions
-- Used by voice turn handler to persist and reload per-turn history.

ALTER TABLE "assistant_sessions"
  ADD COLUMN IF NOT EXISTS "conversation_history" jsonb NOT NULL DEFAULT '[]';
