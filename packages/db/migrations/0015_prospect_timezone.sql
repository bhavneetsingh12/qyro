-- Session 15: persist inferred prospect timezone for safer outbound calling

ALTER TABLE prospects_raw
  ADD COLUMN IF NOT EXISTS prospect_timezone text;
