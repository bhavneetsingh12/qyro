-- Migration 0009: per-tenant escalation contact + session escalation reason
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS escalation_contact_phone text,
  ADD COLUMN IF NOT EXISTS escalation_contact_email text;

ALTER TABLE assistant_sessions
  ADD COLUMN IF NOT EXISTS escalation_reason text;
