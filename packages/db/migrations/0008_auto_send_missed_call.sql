-- Migration 0008: per-tenant auto-send toggle for missed-call SMS
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_send_missed_call boolean NOT NULL DEFAULT false;
