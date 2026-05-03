-- Session 20: Enable RLS on tables added after the initial policy migration.
--
-- Migrations 0011, 0016, and 0017 created tenant-scoped tables without
-- ENABLE ROW LEVEL SECURITY or policies. This migration closes that gap.
-- Pattern matches 0001_rls_policies.sql: tenant_id = current_setting(...).

-- ─── daily_summaries (added in 0011) ─────────────────────────────────────────

ALTER TABLE "daily_summaries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "daily_summaries"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- ─── blackout_blocks (added in 0016) ─────────────────────────────────────────

ALTER TABLE "blackout_blocks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "blackout_blocks"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- ─── consent_records (added in 0017) ─────────────────────────────────────────

ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "consent_records"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- ─── suppressions (added in 0017) ────────────────────────────────────────────

ALTER TABLE "suppressions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "suppressions"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- ─── compliance_decisions (added in 0017) ────────────────────────────────────

ALTER TABLE "compliance_decisions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_decisions"
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
