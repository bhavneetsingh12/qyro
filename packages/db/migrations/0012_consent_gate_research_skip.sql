-- Session 8: consent gate tracking fields on prospects_raw

ALTER TABLE prospects_raw
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS research_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS research_skip_reason text;

CREATE INDEX IF NOT EXISTS prospects_raw_research_skipped_idx
  ON prospects_raw (tenant_id, research_skipped, created_at DESC);
