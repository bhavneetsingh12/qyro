-- QYRO — Tenant isolation RLS policies
-- Run after 0000_needy_tinkerer.sql.
--
-- Pattern: tenant_id = current_setting('app.current_tenant_id')::uuid
-- Set the context before queries: SELECT set_config('app.current_tenant_id', $tenantId, true)
-- The third arg (true) makes the setting LOCAL to the current transaction.
--
-- Admin/seed operations use a superuser role that bypasses RLS automatically.
-- Do NOT use FORCE ROW LEVEL SECURITY — it would block superuser admin scripts.

-- ─── Enable RLS on all tenant-scoped tables ────────────────────────────────────

ALTER TABLE "prospects_raw"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospects_enriched"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_scores"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_sequences"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_attempts"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_attempts"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "do_not_contact"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_sessions"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prompt_versions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dead_letter_queue"   ENABLE ROW LEVEL SECURITY;

-- ─── Create tenant_isolation policies ────────────────────────────────────────
--
-- nullif(..., '') returns NULL when the setting is absent/empty.
-- tenant_id = NULL is always false, so unscoped connections see zero rows.

CREATE POLICY tenant_isolation ON "prospects_raw"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "prospects_enriched"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "lead_scores"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "outreach_sequences"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "message_attempts"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "call_attempts"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "consent_events"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "do_not_contact"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "appointments"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "assistant_sessions"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "prompt_versions"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "usage_events"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "billing_events"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "audit_logs"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "webhook_events"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "dead_letter_queue"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
