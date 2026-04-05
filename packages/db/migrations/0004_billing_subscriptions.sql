-- QYRO — billing subscriptions table
-- Tracks Stripe subscription state and resolved product access per tenant.

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL UNIQUE,
  "stripe_subscription_id" text NOT NULL UNIQUE,
  "stripe_price_id" text NOT NULL,
  "status" text NOT NULL,
  "product_access" jsonb NOT NULL DEFAULT '{"lead": false, "assist": false}',
  "current_period_start" timestamp,
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_subscriptions_tenant_idx"
  ON "tenant_subscriptions" ("tenant_id");

CREATE INDEX IF NOT EXISTS "tenant_subscriptions_status_idx"
  ON "tenant_subscriptions" ("status");
