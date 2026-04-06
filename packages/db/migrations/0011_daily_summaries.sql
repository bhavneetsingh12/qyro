-- Migration 0011: daily summaries for analytics and digest persistence
CREATE TABLE IF NOT EXISTS daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  new_prospects_count integer NOT NULL DEFAULT 0,
  pending_approval_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  calls_handled_count integer NOT NULL DEFAULT 0,
  appointments_booked_count integer NOT NULL DEFAULT 0,
  escalations_count integer NOT NULL DEFAULT 0,
  questions_count integer NOT NULL DEFAULT 0,
  avg_urgency_score integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_summaries_tenant_date_idx
  ON daily_summaries (tenant_id, date);

CREATE INDEX IF NOT EXISTS daily_summaries_tenant_idx
  ON daily_summaries (tenant_id, date);