# QYRO Environment Rules
_Last updated: 2026-04-10_
_Every environment is fully isolated. Never share credentials across environments._

## Three environments

### dev (local)
- Purpose: development and experimentation
- Leads: fake/test data only — never real business contacts
- Email/SMS: sandbox mode only (Resend test key, no real sends)
- AI: real OpenAI key but low daily cap ($1/day hard limit)
- Billing: Stripe test mode only
- Scheduling: Railway cron scripts can be run manually; n8n kept as local fallback
- Database: local Postgres (Docker)
- Redis: local Redis (Docker)

### staging
- Purpose: QA, integration testing, pre-release validation
- Leads: test tenant data only — no real prospects
- Email/SMS: sandbox mode (can flip to real for deliverability testing with test addresses)
- AI: separate OpenAI project key, $5/day cap
- Billing: Stripe test mode
- Database: separate Postgres instance
- Redis: separate Redis instance

### prod
- Purpose: real tenants, real data, real money
- Leads: real business contacts
- Email/SMS: real sends — human approval gate is critical
- AI: separate OpenAI org key with billing alerts set
- Billing: Stripe live mode
- Database: Railway Postgres with daily backups
- Redis: Railway Redis with persistence enabled
- Admin access: restricted — only owner role can access prod directly

---

## Complete environment variable reference

Every environment has its own value for ALL of these. No sharing.

### Core infrastructure

```
DATABASE_URL              PostgreSQL connection string
DATABASE_URL_TEST         Test database (separate instance)
REDIS_URL                 Redis connection string
NODE_ENV                  development | staging | production
PORT                      API server port (default: 3001)
```

### Auth (Clerk)

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   Web app — public key
CLERK_SECRET_KEY                    API — secret key
SEED_CLERK_USER_ID                  Clerk user ID for seed script (internal tenant)
```

### AI

```
OPENAI_API_KEY            OpenAI project key (separate per env)
```

### Billing (Stripe)

```
STRIPE_SECRET_KEY           sk_test_... (dev) | sk_live_... (prod)
STRIPE_WEBHOOK_SECRET       Stripe webhook signing secret
APP_BASE_URL                Web app URL used for Stripe checkout return URLs
                            e.g. http://localhost:3000 | https://qyro.us
STRIPE_PRICE_LEAD_STARTER   Stripe price ID for Lead Starter plan
STRIPE_PRICE_LEAD_GROWTH    Stripe price ID for Lead Growth plan
STRIPE_PRICE_ASSIST_STARTER Stripe price ID for Assist Starter plan
STRIPE_PRICE_ASSIST_GROWTH  Stripe price ID for Assist Growth plan
STRIPE_PRICE_BUNDLE_STARTER Stripe price ID for Bundle Starter plan
STRIPE_PRICE_BUNDLE_GROWTH  Stripe price ID for Bundle Growth plan
```

### Voice — SignalWire (primary telephony transport)

```
SIGNALWIRE_PROJECT_ID       SignalWire project UUID
SIGNALWIRE_API_TOKEN         SignalWire API token
SIGNALWIRE_SPACE_URL         e.g. your-space.signalwire.com

SKIP_SW_SIGNATURE_CHECK     true = bypass signature validation (dev/testing ONLY)
                            ⚠️  MUST be unset or false before broad client rollout
```

### Voice — SWAIG (SignalWire AI Agent function gateway)

```
SWAIG_WEBHOOK_SECRET        Shared secret for SWAIG HTTP Basic auth
                            Configure in SignalWire AI Agent as:
                            https://user:<SWAIG_WEBHOOK_SECRET>@api.qyro.us/api/v1/swaig/...
```

### Voice — Retell (optional per-tenant AI runtime)

```
RETELL_API_KEY              Retell API key
RETELL_AGENT_ID_DEFAULT     Default Retell agent ID (can override per tenant via settings)
RETELL_WEBHOOK_SECRET       Retell HMAC-SHA256 webhook signing secret
RETELL_BASE_URL             https://api.retellai.com
RETELL_CREATE_CALL_PATH     /v2/create-phone-call  (override if Retell changes the path)
```

### Outbound voice controls

```
OUTBOUND_VOICE_GLOBAL_PAUSED    true = block all outbound dials globally
                                Use as emergency kill switch
DEFAULT_TIMEZONE                America/Los_Angeles (default for calling hours)
PUBLIC_API_BASE_URL             Full public URL of the API server
                                Used in TwiML action URLs sent to SignalWire
                                e.g. https://api.qyro.us
```

### Calendar

```
DEFAULT_CALENDAR_PROVIDER   cal_com | google_calendar (per-tenant override in settings)
GOOGLE_CALENDAR_ID          Google Calendar ID for default booking calendar
CAL_API_KEY                 Cal.com API key
CAL_EVENT_TYPE_ID           Cal.com event type ID for default booking
```

### Email (Resend)

```
RESEND_API_KEY    Resend API key
EMAIL_FROM        "QYRO <hello@mail.yourdomain.com>"
```

### Lead enrichment

```
APOLLO_API_KEY              Apollo API key (email lookup only — not lead search)
GOOGLE_PLACES_API_KEY       Google Places API (New) key for lead discovery
EMAIL_ENRICHER_PROVIDER     mock | apollo | hunter
EMAIL_ENRICHER_API_KEY      Hunter API key (if using Hunter)
```

### Internal automation

```
WEBHOOK_SECRET        Shared secret for Railway cron → API webhook calls
                      Sent as x-webhook-secret header
INTERNAL_TENANT_ID    Tenant UUID for internal QYRO Lead tenant
                      Required when DEV_BYPASS_AUTH=true
```

### Web / CORS

```
WEB_ORIGIN        Web app URL for API CORS config (e.g. https://qyro.us)
API_URL           API URL for Next.js server-side fetch (e.g. https://api.qyro.us)
NEXT_PUBLIC_API_URL   API URL for Next.js client-side fetch
EXTRA_WEB_ORIGIN  Additional allowed origin (e.g. http://localhost:3000 in dev)
PROMPTS_DIR       Path to prompt packs directory (docs/PROMPTS)
```

### Master admin access

```
MASTER_ADMIN_CLERK_IDS   Comma-separated Clerk user IDs granted master_admin
MASTER_ADMIN_EMAILS      Comma-separated emails granted master_admin
                         Leave blank to rely on DB role only
```

### Dev escape hatches (NEVER enable in production)

```
DEV_BYPASS_AUTH     true = skip Clerk auth entirely (local dev only)
                    Guarded: throws at startup if NODE_ENV=production
```

---

## Local dev setup (quick start)

```bash
# 1. Start local services
docker compose -f infra/docker-compose.yml up -d

# 2. Copy env template
cp .env.example .env.local

# 3. Fill in at minimum:
#    OPENAI_API_KEY
#    CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY (from Clerk dashboard, dev env)
#    SEED_CLERK_USER_ID (your Clerk user ID)
#    SIGNALWIRE_* (for voice testing) OR set SKIP_SW_SIGNATURE_CHECK=true

# 4. Run migrations
pnpm db:migrate

# 5. Seed internal tenant
npx tsx infra/seed.ts

# 6. Start API
pnpm dev

# 7. Start workers (separate terminals, or use PM2)
pnpm --filter @qyro/workers worker:research
pnpm --filter @qyro/workers worker:outreach
pnpm --filter @qyro/workers worker:reply-triage
pnpm --filter @qyro/queue worker:outbound-call
pnpm --filter @qyro/queue worker:webhook
# or: pm2 start infra/pm2/ecosystem.config.cjs
```

### Railway worker start commands

Create separate Railway services with these start commands:

```
API:               pnpm --filter @qyro/api start (or dev for Railway)
research worker:   pnpm --filter @qyro/workers worker:research
outreach worker:   pnpm --filter @qyro/workers worker:outreach
reply-triage:      pnpm --filter @qyro/workers worker:reply-triage
outbound-call:     pnpm --filter @qyro/queue worker:outbound-call
webhook worker:    pnpm --filter @qyro/queue worker:webhook
nightly cron:      node apps/crons/dist/nightly-ingest.js
morning cron:      node apps/crons/dist/morning-digest.js
```

Cron required env vars: `API_URL`, `WEBHOOK_SECRET`

---

## Promoting from staging to prod

### Required pre-deploy validation gate

Run these from repo root before every production deployment:

```bash
pnpm run smoke:workers
pnpm run test:tenant-middleware
pnpm exec tsc --noEmit --pretty false
```

1. All tests pass on staging
2. Run migrations on prod database first (never auto-migrate on deploy)
3. Deploy API — verify `/health` returns 200
4. Verify Railway workers are running
5. Run a single test lead through the full pipeline manually before opening to tenants
6. Monitor error logs for 30 minutes post-deploy

---

## Pre-launch security checklist

Before enabling real traffic:

### Route trust requirements (must be true in production)

- Provider-signed routes (`/api/v1/voice/*`):
    - `SIGNALWIRE_AUTH_TOKEN` (or `SIGNALWIRE_API_TOKEN` fallback)
    - `PUBLIC_API_BASE_URL` exactly matching the externally reachable API hostname
- Internal-secret/provider routes (`/api/v1/swaig/*`):
    - `SWAIG_WEBHOOK_SECRET`
- Internal webhook routes (`/webhooks/*`):
    - `WEBHOOK_SECRET`
    - `STRIPE_WEBHOOK_SECRET` for `/webhooks/stripe`
- Public ingress routes (`/api/v1/assist/*`, pricing routes):
    - Redis must be healthy because public rate limits are configured fail-closed on limiter infra errors

- [ ] `SKIP_SW_SIGNATURE_CHECK` is NOT set in prod
- [ ] `DEV_BYPASS_AUTH` is NOT set or is `false` in prod
- [ ] `OUTBOUND_VOICE_GLOBAL_PAUSED` is set correctly (true during soft launch)
- [ ] Stripe live keys configured and webhook registered
- [ ] Clerk production environment configured (separate from dev)
- [ ] `MASTER_ADMIN_CLERK_IDS` or `MASTER_ADMIN_EMAILS` set for Bhavneet's account
- [ ] `SWAIG_WEBHOOK_SECRET` set (required for SWAIG production calls)
- [ ] All Railway services have health checks configured
- [ ] Billing alerts set on OpenAI prod key ($10, $50, $100 thresholds)

---

## Solo rollout tracker

See `docs/SOLO_ROLLOUT_CHECKLIST.md` for the step-by-step execution checklist.
