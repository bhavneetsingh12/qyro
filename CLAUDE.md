# QYRO — Claude Code Project Memory

## What this project is
QYRO is TWO separate products built on one shared platform:

**Product 1 — QYRO Lead** (internal use first, sell later)
An AI-powered lead engine. Bhavneet uses this internally to find and
contact businesses to sell Product 2 to. Eventually productized and sold
to agencies/sales teams as a standalone SaaS. NOT being sold yet.

**Product 2 — QYRO Assist** (sell this first)
An AI-powered client assistant for local businesses. Handles website chat,
missed-call follow-up, FAQ, and appointment booking. Immediate revenue product.

Both products share one codebase, one database, and one infrastructure.
Separated by tenant_type at the data and routing level.
Sold independently with separate landing pages and pricing.

## Owner
Bhavneet Singh — Zentryx LLC, Hillsboro Oregon
Stack: Next.js 14 + Node/TS + Postgres + Redis + n8n + OpenAI

## Tenant types

```
tenant_type: "internal"      — QYRO Lead, Bhavneet only, no billing, no self-serve UI
tenant_type: "assistant"     — QYRO Assist, paying clients, full multi-tenant
tenant_type: "lead_engine"   — QYRO Lead as a product (Phase 4+, DO NOT BUILD YET)
tenant_type: "both"          — future: clients who buy both (DO NOT BUILD YET)
```

Only "internal" and "assistant" are active right now.

## Build phases

```
Phase 1 — QYRO Lead, internal only (COMPLETE)
  Single tenant: Bhavneet (tenant_type: "internal")
  No frontend UI needed — n8n dashboard + API routes + admin scripts
  No billing, no self-serve onboarding
  Agents: Lead Discovery, Research (cached), Outreach, Reply Triage, Booking
  Goal: use this to find and sign the first QYRO Assist clients

Phase 2 — QYRO Assist, multi-tenant (sell this first) (CURRENT)
  Full multi-tenant (tenant_type: "assistant")
  Client widget + missed-call follow-up + FAQ + booking
  Manual onboarding for first clients is fine
  Stripe billing

Phase 3 — QYRO Assist productization
  Self-serve onboarding, niche prompt packs, analytics, admin portal

Phase 4 — QYRO Lead as a product
  Add tenant_type: "lead_engine", build onboarding UI + billing
  No new backend agents needed — already built in Phase 1
  Separate pricing page and landing page from QYRO Assist

Phase 5 — Voice (both products)
  Only after COMPLIANCE.md gate is satisfied
  Inbound only first (missed-call callback), not cold calling
```

---

## SESSION RULES — read and follow every single session

### Why these rules exist
Claude Code and claude.ai share a usage limit. To avoid hitting the limit
mid-build, every session must be short, focused, and compacted when done.
One task per session. Compact when done. Clear between subsystems.

### Session startup — do this every time
```
1. /load CLAUDE.md                    ← always first (you are reading this now)
2. /load docs/BLUEPRINT.md            ← only if you need architecture context
3. /load [only the file you are working on]
4. Do the ONE task for this session
5. /compact when the task is complete
```

### One task per session — strict rule
Each session builds exactly ONE of these tasks and then stops:

```
Phase 1 (COMPLETE)
Session A  →  packages/db/client.ts + drizzle.config.ts     then /compact
Session B  →  apps/api/src/index.ts                          then /compact
Session C  →  packages/agents/src/agents/leadDiscovery.ts    then /compact
Session D  →  packages/agents/src/agents/research.ts         then /compact
Session E  →  packages/agents/src/agents/outreach.ts         then /compact
Session F  →  apps/api/src/routes/leads.ts                   then /compact
Session G  →  apps/api/src/routes/campaigns.ts               then /compact
Session H  →  packages/queue/src/workers/researchWorker.ts   then /compact
Session I  →  end-to-end test                                then /compact

Phase 2 (CURRENT)
Session J  →  Next.js setup + auth routing + shared layout   then /compact
Session K  →  Internal dashboard home + lead inbox           then /compact
Session L  →  Lead detail + campaign manager                 then /compact
Session M  →  Approval queue                                 then /compact
Session N  →  Client portal home + conversation inbox        then /compact
Session O  →  Client settings + widget embed                 then /compact
Session P  →  Polish + mobile                                then /compact
```

Do not combine tasks. Do not keep going after a task is done.
Finish → /compact → close. Start fresh next session.

### What to load per session — no more, no less

| Task | Load these files |
|---|---|
| DB work | CLAUDE.md + packages/db/schema.ts |
| Agent work | CLAUDE.md + packages/agents/src/budget.ts + packages/agents/src/runner.ts |
| Route work | CLAUDE.md + apps/api/src/middleware/tenant.ts + apps/api/src/middleware/quota.ts |
| Queue work | CLAUDE.md + packages/queue/src/queues.ts |
| Any agent | CLAUDE.md + docs/AGENTS.md + packages/agents/src/runner.ts |
| Next.js / frontend | CLAUDE.md + apps/web/src/app/layout.tsx (once it exists) |

Never load: node_modules, .next, dist, the whole packages/ tree, or multiple
unrelated files "just in case". Every file loaded costs tokens.

### /compact — when and how
Run /compact:
- After completing a task (every session)
- If the session is getting long before the task is done
- Any time you feel the context is getting heavy

/compact summarizes everything so far into a dense snapshot.
The project state is preserved in the files — not in the conversation.
It is always safe to compact.

### /clear — when to use
Run /clear when:
- Switching from one product to another (Lead → Assist)
- Switching between completely unrelated subsystems
- Starting a fresh session after a break

After /clear, always reload CLAUDE.md first.

### If Claude Code stops mid-session (usage limit hit)
1. Note exactly which file you were working on
2. Wait for the limit to reset
3. New session: /load CLAUDE.md → /load that file → continue
4. The files already written are safe on disk — nothing is lost

### Signs a session is getting too long
- You have loaded more than 4 files
- The task has taken more than 30 messages
- You are starting to work on a second task

When you see these signs: finish the current task, /compact, stop.

---

## How to resume work in a new session
1. Read this file (CLAUDE.md) — you are doing that now
2. Check "Current phase" below to find the next task
3. Load ONLY the files listed for that task (see session table above)
4. Build that one task
5. /compact when done

## Current phase
**Phase 2 — QYRO Assist, multi-tenant frontend (CURRENT)**

Phase 1 is complete. The backend API, agents, and DB are production-ready.
Now building apps/web — the Next.js 14 frontend for both portals.

### Phase 1 — COMPLETE
```
[x] Task A — packages/db/client.ts + drizzle.config.ts + infra/seed.ts
[x] Task B — apps/api/src/index.ts (Express server)
[x] Task C — packages/agents/src/agents/leadDiscovery.ts
[x] Task D — packages/agents/src/agents/research.ts
[x] Task E — packages/agents/src/agents/outreach.ts
[x] Task F — apps/api/src/routes/leads.ts
[x] Task G — apps/api/src/routes/campaigns.ts
[x] Task H — packages/queue/src/workers/researchWorker.ts
[x] Task I — end-to-end test: ingest 1 lead → research → outreach draft → approval
```

### Phase 2 — Task checklist
Mark done by changing [ ] to [x] after each session.

```
[x] Session J — Next.js setup + auth routing + shared layout
[x] Session K — Internal dashboard home + lead inbox
[x] Session L — Lead detail + campaign manager
[x] Session M — Approval queue
[x] Session N — Client portal home + conversation inbox
[x] Session O — Client settings + widget embed
[ ] Session P — Polish + mobile
```

### Phase 2 — Design direction
Warm modern (Notion-inspired)
- Off-white backgrounds, warm grays, rounded cards
- Sidebar navigation
- Accent color: amber/coral

### Phase 2 — Portal architecture
Two portals, separate logins, same codebase:

  /internal/...  — QYRO Lead portal, Bhavneet only (tenant_type: "internal")
                   Lead inbox, campaign manager, approval queue

  /client/...    — QYRO Assist portal, paying clients (tenant_type: "assistant")
                   Conversation inbox, settings, widget embed code

Auth: separate login pages per portal, session-scoped to tenant_type.
Shared: layout components, design system, API client.

---

## Project structure summary
```
qyro/
  apps/
    web/          Next.js 14 frontend — Phase 2 (CURRENT — building now)
    api/          Node/Express/TS backend — Phase 1+
  packages/
    db/           Drizzle ORM schema + migrations
    agents/       Agent runner + token budget enforcement
    prompts/      Prompt loader + validator
    queue/        BullMQ job definitions
  docs/           Architecture docs (load these to orient, not source files)
  infra/          Docker Compose, env templates
  .claudeignore   Files Claude Code should never load
```

## What NOT to do
- Do not write raw SQL queries without tenant_id scoping
- Do not call an LLM without checking token budget first (packages/agents/src/budget.ts)
- Do not add new agents without a corresponding entry in docs/AGENTS.md
- Do not commit secrets or API keys — use .env.local (gitignored)
- Do not use Maps scraping — Apollo API and Google Places API only
- Do not enable voice/Twilio until Phase 5 (see docs/COMPLIANCE.md)
- Do not build self-serve onboarding or billing UI until Phase 3
- Do not build tenant_type "lead_engine" or "both" until Phase 4
- Do not add QYRO Assist agents (Client Assistant widget) until Phase 2 Session N+
- Do not load more files than the session table says to load

## Key files to know
- packages/agents/src/budget.ts      — all model assignments + per-tenant limits
- packages/agents/src/runner.ts      — agent call wrapper with error envelope
- packages/agents/src/compact.ts     — conversation compaction for Client Assistant
- packages/db/schema.ts              — all tables, tenant_id on every table
- apps/api/src/middleware/tenant.ts  — tenant scoping middleware
- apps/api/src/middleware/quota.ts   — token quota check middleware
- docs/PROMPTS/                      — all prompts live here as versioned .md files

## Token discipline
- cheap model (gpt-4o-mini): classification, scoring, triage, FAQ drafts, rewrite
- standard model (gpt-4o): booking slot parsing, complex client assistant sessions
- premium model (claude-sonnet-4-6): complex objections, voice — premium plan only
- Always check packages/agents/src/budget.ts before assigning a model
- Cache research summaries in Redis 7 days: key = research:{tenantId}:{domain}
- Conversation compaction: compact Client Assistant history every 6 turns
