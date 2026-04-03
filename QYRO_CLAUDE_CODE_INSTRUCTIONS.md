# QYRO — Claude Code Session Instructions
# Hand this file to Claude Code at the START of the very first session only.
# After that, CLAUDE.md is the guide for every session.

---

## IMPORTANT: How to work on this project without hitting usage limits

Each session = one task. No exceptions.
After the task is done: /compact then stop.
Next session: /load CLAUDE.md first, check the task checklist, pick the next task.

---

## First session only — read these files in order

```
/load CLAUDE.md
/load QYRO_CLAUDE_CODE_INSTRUCTIONS.md
/load docs/BLUEPRINT.md
/load docs/TOKEN_BUDGET.md
/load docs/AGENTS.md
/load docs/DECISIONS.md
```

After reading all six, start Task A below. Do not start Task B in the same session.

---

## Files already written — DO NOT recreate

```
CLAUDE.md                                         ✓
QYRO_CLAUDE_CODE_INSTRUCTIONS.md                  ✓
.claudeignore / .env.example                      ✓
turbo.json / tsconfig.json / package.json         ✓
docs/BLUEPRINT.md                                 ✓
docs/TOKEN_BUDGET.md                              ✓
docs/AGENTS.md                                    ✓
docs/DECISIONS.md                                 ✓
docs/COMPLIANCE.md                                ✓
docs/ENVIRONMENTS.md                              ✓
docs/PROMPTS/lead/medspa_missed_call_v1.md        ✓
packages/db/schema.ts                             ✓
packages/db/package.json / tsconfig.json          ✓
packages/agents/src/budget.ts                     ✓
packages/agents/src/runner.ts                     ✓
packages/agents/src/compact.ts                    ✓
packages/agents/src/cache.ts                      ✓
packages/agents/src/agents/qa.ts                  ✓
packages/agents/src/agents/booking.ts             ✓
packages/agents/src/agents/replyTriage.ts         ✓
packages/agents/package.json / tsconfig.json      ✓
packages/prompts/src/loader.ts                    ✓
packages/prompts/package.json / tsconfig.json     ✓
packages/queue/src/queues.ts                      ✓
packages/queue/package.json / tsconfig.json       ✓
apps/api/src/middleware/tenant.ts                 ✓
apps/api/src/middleware/quota.ts                  ✓
apps/api/src/middleware/auth.ts                   ✓
apps/api/src/lib/sendEmail.ts                     ✓
apps/api/package.json / tsconfig.json             ✓
infra/docker-compose.yml                          ✓
infra/docker-compose.test.yml                     ✓
infra/.env.docker                                 ✓
```

These are scaffolding files. Each task session reviews the relevant file,
fills any gaps, and verifies it compiles. Do not rewrite from scratch.

---

## Phase 1 task list — one task per session

### Task A — Database client + seed
Session load: CLAUDE.md + packages/db/schema.ts

Files to complete:
- packages/db/client.ts        — verify Drizzle connection, RLS context helper
- packages/db/drizzle.config.ts — verify config points to schema.ts
- infra/seed.ts                — verify internal tenant + owner user seed

When done:
- Run: docker compose -f infra/docker-compose.yml up -d
- Run: pnpm db:generate && pnpm db:migrate
- Run: npx tsx infra/seed.ts
- Confirm seed ran without errors
- /compact → stop

---

### Task B — API server
Session load: CLAUDE.md + apps/api/src/middleware/tenant.ts

Files to complete:
- apps/api/src/index.ts — verify Express setup, Clerk middleware, all routes mounted

When done:
- Run: pnpm --filter @qyro/api dev
- Hit: GET http://localhost:3005/health → should return { status: "ok" }
- /compact → stop

---

### Task C — Lead Discovery Agent
Session load: CLAUDE.md + docs/AGENTS.md + packages/agents/src/runner.ts

Files to complete:
- packages/agents/src/agents/leadDiscovery.ts
  — verify Apollo API call, dedup logic, BullMQ enqueue
  — verify do_not_contact check is present

When done:
- Run: POST http://localhost:3005/api/v1/leads/ingest
  body: { "niche": "medspa", "location": "Portland OR", "maxResults": 3 }
- Confirm prospects_raw rows written to DB
- Confirm research jobs enqueued in Redis (check BullMQ dashboard or redis-cli)
- /compact → stop

---

### Task D — Research Agent
Session load: CLAUDE.md + packages/agents/src/runner.ts + packages/agents/src/cache.ts

Files to complete:
- packages/agents/src/agents/research.ts
  — verify Redis cache check runs BEFORE any LLM call
  — verify website fetch is max 3 URLs, max 3000 chars
  — verify result written to prospects_enriched
  — verify cache stored with 7-day TTL

When done:
- Start research worker: pnpm --filter @qyro/queue worker:research
- Trigger a research job manually or via lead ingest
- Check prospects_enriched for a new row
- Run the same prospect again — confirm cache_hit logged in usage_events
- /compact → stop

---

### Task E — Outreach Agent
Session load: CLAUDE.md + packages/agents/src/agents/qa.ts + packages/prompts/src/loader.ts

Files to complete:
- packages/agents/src/agents/outreach.ts
  — verify do_not_contact checked first
  — verify prompt pack loaded from docs/PROMPTS/lead/
  — verify QA agent runs on every draft
  — verify message written as pending_approval (never auto-sent)

When done:
- POST http://localhost:3005/api/v1/campaigns (create a test campaign)
- POST http://localhost:3005/api/v1/campaigns/:id/activate
- POST http://localhost:3005/api/v1/campaigns/:id/run/:prospectId
- Confirm message_attempts row with status: "pending_approval"
- Confirm NO email was sent
- /compact → stop

---

### Task F — Leads route
Session load: CLAUDE.md + apps/api/src/middleware/tenant.ts

Files to complete:
- apps/api/src/routes/leads.ts
  — verify all three endpoints work: POST /ingest, GET /, GET /:id
  — verify tenant scoping on every query
  — verify rate limiting applied on /ingest

When done:
- GET http://localhost:3005/api/v1/leads → returns list
- GET http://localhost:3005/api/v1/leads/:id → returns prospect + enriched
- /compact → stop

---

### Task G — Campaigns route
Session load: CLAUDE.md + apps/api/src/middleware/tenant.ts

Files to complete:
- apps/api/src/routes/campaigns.ts
  — verify create, activate, run, queue, approve, reject all work
  — verify approve writes to audit_logs
  — verify approved message triggers email send via sendEmail.ts

When done:
- Full approval flow test:
  create campaign → activate → run on prospect → GET queue → approve
- Confirm audit_log row written on approve
- /compact → stop

---

### Task H — Research worker
Session load: CLAUDE.md + packages/queue/src/queues.ts

Files to complete:
- packages/queue/src/workers/researchWorker.ts
  — verify concurrency setting reads from env
  — verify failed jobs go to dead_letter_queue after 3 attempts
  — verify graceful shutdown on SIGTERM

When done:
- Start worker: pnpm --filter @qyro/queue worker:research
- Trigger 3 research jobs
- Confirm all 3 complete and prospects_enriched has 3 rows
- Kill worker with Ctrl+C — confirm graceful shutdown logged
- /compact → stop

---

### Task I — End-to-end smoke test
Session load: CLAUDE.md only

This session does NOT write code. It runs the full pipeline once end to end:

1. POST /api/v1/leads/ingest → confirm leads queued
2. Research worker picks up jobs → confirm prospects_enriched populated
3. Create + activate campaign → confirm sequence active
4. POST /api/v1/campaigns/:id/run/:prospectId → confirm pending_approval
5. GET /api/v1/campaigns/:id/queue → confirm message in queue
6. POST approve → confirm audit_log + email triggered
7. Check usage_events → confirm all token usage logged correctly

If all 7 steps pass: Phase 1 is complete. Update CLAUDE.md task checklist.
/compact → stop. Start planning Phase 2.

---

## Hard rules — never violate

1. Every DB query includes tenant_id — use tenant middleware
2. Every LLM call goes through packages/agents/src/runner.ts
3. Every LLM call checks budget — packages/agents/src/budget.ts
4. Every outbound message goes through QA Guardrail agent
5. Approval gate is mandatory — no message auto-sends
6. No voice/Twilio code until Phase 5
7. No Maps scraping — Apollo + Places API only
8. Prompts in docs/PROMPTS/ as .md files — never hardcoded in agent files
9. Do not build apps/web frontend until Phase 2
10. Do not build tenant_type "lead_engine" or "both" until Phase 4
11. One task per session. /compact when done. Stop.

---

## Local dev setup (run once before Task A)

```bash
# Install dependencies
pnpm install

# Start local services (Postgres + Redis + n8n)
docker compose -f infra/docker-compose.yml up -d

# Copy env template and fill in your keys
cp .env.example .env.local
# Required keys to fill in:
#   OPENAI_API_KEY
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY
#   SEED_CLERK_USER_ID (your Clerk user ID from Clerk dashboard)

# Run DB migrations
pnpm db:generate
pnpm db:migrate

# Seed internal tenant
npx tsx infra/seed.ts
```
