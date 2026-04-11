-- Session 14: speed up inbound voice prospect lookup by normalized phone

CREATE INDEX IF NOT EXISTS prospects_raw_tenant_phone_norm_idx
ON prospects_raw (
  tenant_id,
  (regexp_replace(coalesce(phone, ''), '[^+0-9]', '', 'g'))
);
