# QYRO Environment Rules
_Every environment is fully isolated. Never share credentials across environments._

## Three environments

### dev (local)
- Purpose: development and experimentation
- Leads: fake/test data only — never real business contacts
- Email/SMS: sandbox mode only (Resend test key, no real sends)
- AI: real OpenAI key but low daily cap ($1/day hard limit)
- Billing: Stripe test mode only
- n8n: local Docker instance (see infra/docker-compose.yml)
- Database: local Postgres (Docker)
- Redis: local Redis (Docker)

### staging
- Purpose: QA, integration testing, pre-release validation
- Leads: test tenant data only — no real prospects
- Email/SMS: sandbox mode (can flip to real for deliverability testing with test addresses)
- AI: separate OpenAI project key, $5/day cap
- Billing: Stripe test mode
- n8n: dedicated staging instance (not shared with prod)
- Database: separate Postgres instance
- Redis: separate Redis instance

### prod
- Purpose: real tenants, real data, real money
- Leads: real business contacts
- Email/SMS: real sends — human approval gate is critical
- AI: separate OpenAI org key with billing alerts set
- Billing: Stripe live mode
- n8n: dedicated prod instance, queue mode, min 2 workers
- Database: managed Postgres (Supabase or Neon) with daily backups
- Redis: managed Redis (Upstash or Railway) with persistence enabled
- Admin access: restricted — only owner role can access prod directly

---

## Per-environment variables

Every environment has its own value for ALL of these. No sharing.

```
DATABASE_URL
REDIS_URL
OPENAI_API_KEY         (separate project per env)
CLERK_SECRET_KEY       (separate Clerk env per env)
STRIPE_SECRET_KEY      (test vs live)
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
EMAIL_FROM                       (e.g. "QYRO <hello@mail.yourdomain.com>")
APOLLO_API_KEY
CAL_API_KEY
N8N_WEBHOOK_BASE_URL
N8N_API_KEY
INTERNAL_WEBHOOK_SECRET
AZURE_STORAGE_CONNECTION_STRING  (separate container per env)
```

---

## Separation checklist (before launching prod)

- [ ] Separate database — no shared connection strings
- [ ] Separate Redis — no shared queues
- [ ] Separate storage bucket/container — no shared files
- [ ] Separate OpenAI project key — billing isolated
- [ ] Separate Clerk environment — test users cannot hit prod
- [ ] Separate Stripe mode — test keys on dev/staging, live on prod
- [ ] Separate Twilio subaccount (when voice enabled — Phase 5)
- [ ] n8n prod instance has at least 1 main + 2 workers
- [ ] Prod database has automated daily backups configured
- [ ] Billing alerts set on OpenAI prod key ($10, $50, $100 thresholds)
- [ ] Error monitoring enabled on prod API (e.g. Sentry)

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

# 4. Run migrations
pnpm db:migrate

# 5. Seed internal tenant
npx tsx infra/seed.ts

# 6. Start API
pnpm dev

# 7. Start workers (separate terminals, or use PM2)
pnpm --filter @qyro/queue worker:research
pnpm --filter @qyro/queue worker:outreach
pnpm --filter @qyro/queue worker:webhook
# or: pm2 start infra/pm2/ecosystem.config.cjs
```

### Railway worker start commands

Create separate Railway services for each worker process with these start commands:

- `pnpm --filter @qyro/queue worker:research`
- `pnpm --filter @qyro/queue worker:outreach`
- `pnpm --filter @qyro/queue worker:outbound-call`
- `pnpm --filter @qyro/queue worker:webhook`

---

## Promoting from staging to prod

1. All tests pass on staging
2. Run migrations on prod database first (never auto-migrate on deploy)
3. Deploy API — verify /health returns 200
4. Verify n8n workers are running
5. Run a single test lead through the full pipeline manually before opening to tenants
6. Monitor error logs for 30 minutes post-deploy

---

## Solo rollout tracker

If you are deploying solo, use this checklist as the source of truth and check items in order:

- docs/SOLO_ROLLOUT_CHECKLIST.md
