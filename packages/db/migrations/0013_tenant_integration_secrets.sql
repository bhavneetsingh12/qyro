-- Session 13: move integration secrets out of tenants.metadata

CREATE TABLE IF NOT EXISTS tenant_integration_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_api_key text,
  apollo_api_key text,
  hunter_api_key text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tenant_integration_secrets_tenant_idx UNIQUE (tenant_id)
);

-- Backfill existing metadata-stored secrets into dedicated secret rows.
INSERT INTO tenant_integration_secrets (tenant_id, calendar_api_key, apollo_api_key, hunter_api_key)
SELECT
  t.id,
  nullif(trim(coalesce(t.metadata->>'calendarApiKey', t.metadata->>'calendar_api_key', '')), ''),
  nullif(trim(coalesce(t.metadata->>'apolloApiKey', '')), ''),
  nullif(trim(coalesce(t.metadata->>'hunterApiKey', '')), '')
FROM tenants t
ON CONFLICT (tenant_id)
DO UPDATE SET
  calendar_api_key = COALESCE(EXCLUDED.calendar_api_key, tenant_integration_secrets.calendar_api_key),
  apollo_api_key = COALESCE(EXCLUDED.apollo_api_key, tenant_integration_secrets.apollo_api_key),
  hunter_api_key = COALESCE(EXCLUDED.hunter_api_key, tenant_integration_secrets.hunter_api_key),
  updated_at = now();

-- Remove legacy secret keys from metadata after backfill.
UPDATE tenants
SET metadata = (metadata - 'calendarApiKey' - 'calendar_api_key' - 'apolloApiKey' - 'hunterApiKey')
WHERE metadata ? 'calendarApiKey'
   OR metadata ? 'calendar_api_key'
   OR metadata ? 'apolloApiKey'
   OR metadata ? 'hunterApiKey';

ALTER TABLE tenant_integration_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_integration_secrets
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
