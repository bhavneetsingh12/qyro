-- Session 17: TCPA compliance core tables

CREATE TABLE IF NOT EXISTS "consent_records" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "prospect_id"        uuid REFERENCES "prospects_raw"("id") ON DELETE SET NULL,
  "phone_e164"         text NOT NULL,
  "seller_name"        text NOT NULL,
  "consent_channel"    text NOT NULL, -- voice | sms | both
  "consent_type"       text NOT NULL, -- written | express | inquiry_only | unknown
  "disclosure_text"    text,
  "disclosure_version" text,
  "form_url"           text,
  "ip_address"         text,
  "user_agent"         text,
  "captured_at"        timestamp NOT NULL,
  "expires_at"         timestamp,
  "revoked_at"         timestamp,
  "revoked_reason"     text,
  "created_at"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "consent_records_tenant_phone_idx"
  ON "consent_records"("tenant_id", "phone_e164");

CREATE INDEX IF NOT EXISTS "consent_records_tenant_captured_idx"
  ON "consent_records"("tenant_id", "captured_at");

CREATE TABLE IF NOT EXISTS "suppressions" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "phone_e164"       text,
  "email"            text,
  "domain"           text,
  "suppression_type" text NOT NULL, -- internal_dnc | stop_reply | verbal_optout | manual_block
  "scope"            text NOT NULL DEFAULT 'global', -- global | seller_specific | campaign_specific
  "seller_name"      text,
  "campaign_id"      uuid,
  "reason"           text,
  "effective_at"     timestamp NOT NULL DEFAULT now(),
  "revoked_at"       timestamp,
  "source_event_id"  uuid,
  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "suppressions_tenant_phone_idx"
  ON "suppressions"("tenant_id", "phone_e164");

CREATE INDEX IF NOT EXISTS "suppressions_tenant_email_idx"
  ON "suppressions"("tenant_id", "email");

CREATE INDEX IF NOT EXISTS "suppressions_tenant_domain_idx"
  ON "suppressions"("tenant_id", "domain");

CREATE TABLE IF NOT EXISTS "compliance_decisions" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "prospect_id"       uuid REFERENCES "prospects_raw"("id") ON DELETE SET NULL,
  "campaign_id"       uuid,
  "channel"           text NOT NULL,
  "automated"         boolean NOT NULL DEFAULT true,
  "decision"          text NOT NULL, -- ALLOW | BLOCK | MANUAL_REVIEW
  "rule_code"         text NOT NULL,
  "explanation"       text NOT NULL,
  "consent_record_id" uuid REFERENCES "consent_records"("id") ON DELETE SET NULL,
  "suppression_id"    uuid REFERENCES "suppressions"("id") ON DELETE SET NULL,
  "evaluated_at"      timestamp NOT NULL DEFAULT now(),
  "created_at"        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "compliance_decisions_tenant_eval_idx"
  ON "compliance_decisions"("tenant_id", "evaluated_at");

