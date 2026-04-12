# QYRO Environment Rules
_Last updated: 2026-04-11_
_Canonical environment and deployment reference._

## 1. Environments

| Environment | Purpose | Data policy |
|---|---|---|
| `dev` | Local development | test data only |
| `staging` | Pre-release validation | isolated test data only |
| `prod` | Live tenants and billing | real data, real traffic |

Never reuse secrets across environments.

## 2. Core Variables

```text
DATABASE_URL
DATABASE_URL_TEST
REDIS_URL
NODE_ENV
PORT
```

`PORT` defaults to `3001` in the API.

## 3. Auth

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
SEED_CLERK_USER_ID
```

## 4. AI

```text
OPENAI_API_KEY
```

## 5. Billing

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
APP_BASE_URL
STRIPE_PRICE_LEAD_STARTER
STRIPE_PRICE_LEAD_GROWTH
STRIPE_PRICE_ASSIST_STARTER
STRIPE_PRICE_ASSIST_GROWTH
STRIPE_PRICE_BUNDLE_STARTER
STRIPE_PRICE_BUNDLE_GROWTH
```

## 6. Voice: SignalWire

```text
SIGNALWIRE_PROJECT_ID
SIGNALWIRE_API_TOKEN
SIGNALWIRE_AUTH_TOKEN
SIGNALWIRE_SPACE_URL
PUBLIC_API_BASE_URL
```

Notes:
- `SIGNALWIRE_AUTH_TOKEN` is the preferred signing secret for request validation.
- `SIGNALWIRE_API_TOKEN` may be used as fallback in current code.
- `PUBLIC_API_BASE_URL` must exactly match the externally reachable API URL for signature validation and callback URL generation.

## 7. Voice: SWAIG

```text
SWAIG_WEBHOOK_SECRET
```

Used for HTTP Basic or equivalent shared-secret auth on `/api/v1/swaig/*`.

## 8. Outbound Voice Controls

```text
OUTBOUND_VOICE_GLOBAL_PAUSED
DEFAULT_TIMEZONE
```

## 9. Calendar

```text
DEFAULT_CALENDAR_PROVIDER
GOOGLE_CALENDAR_ID
CAL_API_KEY
CAL_EVENT_TYPE_ID
```

## 10. Email and Enrichment

```text
RESEND_API_KEY
EMAIL_FROM
APOLLO_API_KEY
GOOGLE_PLACES_API_KEY
EMAIL_ENRICHER_PROVIDER
EMAIL_ENRICHER_API_KEY
```

## 11. Internal Automation

```text
WEBHOOK_SECRET
INTERNAL_TENANT_ID
WIDGET_SIGNING_SECRET
ALLOW_PUBLIC_TENANT_PROVISIONING
```

`WEBHOOK_SECRET` is used to HMAC-sign cron-triggered webhook routes.
`WIDGET_SIGNING_SECRET` signs public Assist widget tokens. If omitted, the API falls back to `TENANT_INTEGRATION_SECRET_KEY`, but a dedicated value is recommended.
`ALLOW_PUBLIC_TENANT_PROVISIONING=true` is required in production if you want first-login Clerk users to automatically create starter tenants.

## 11.5 Tenant secret encryption

```text
TENANT_INTEGRATION_SECRET_KEY
```

Used to encrypt and decrypt values stored in `tenant_integration_secrets`.
This must be set consistently per environment once encrypted rows exist.

## 12. Web and CORS

```text
WEB_ORIGIN
API_URL
NEXT_PUBLIC_API_URL
EXTRA_WEB_ORIGIN
PROMPTS_DIR
```

## 13. Master Admin

```text
MASTER_ADMIN_CLERK_IDS
MASTER_ADMIN_EMAILS
```

## 14. Dev Escape Hatches

```text
DEV_BYPASS_AUTH
SKIP_SW_SIGNATURE_CHECK
```

Rules:
- never enable either in production
- both exist only for local/testing escape hatches

## 15. Local Development

```bash
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env.local
pnpm db:migrate
npx tsx infra/seed.ts
pnpm dev
```

Workers:

```bash
pnpm --filter @qyro/workers worker:research
pnpm --filter @qyro/workers worker:outreach
pnpm --filter @qyro/workers worker:reply-triage
pnpm --filter @qyro/queue worker:outbound-call
pnpm --filter @qyro/queue worker:webhook
```

## 16. Railway Services

Recommended service split:

```text
API:             pnpm --filter @qyro/api start
research:        pnpm --filter @qyro/workers worker:research
outreach:        pnpm --filter @qyro/workers worker:outreach
reply-triage:    pnpm --filter @qyro/workers worker:reply-triage
outbound-call:   pnpm --filter @qyro/queue worker:outbound-call
webhook:         pnpm --filter @qyro/queue worker:webhook
nightly cron:    node apps/crons/dist/nightly-ingest.js
morning cron:    node apps/crons/dist/morning-digest.js
```

## 17. Environment Hardening Backlog

Still worth doing:

1. Run `pnpm backfill:tenant-secrets` first, then `pnpm backfill:tenant-secrets --apply` after reviewing the dry-run output.
2. Add environment validation for more provider keys at startup.
3. Add a documented secret-rotation procedure per provider.
