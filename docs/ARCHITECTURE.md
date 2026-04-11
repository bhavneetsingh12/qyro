# QYRO Architecture Reference
_Last updated: 2026-04-10 | Owner: Bhavneet Singh / Zentryx LLC_
_Source of truth for all system state. Detailed enough for new-developer onboarding,
Claude Code session resumption, and technical review._

---

## 1. What QYRO Is

QYRO is **two SaaS products on one shared platform**:

| Product | Tenant type | Status | Who uses it |
|---|---|---|---|
| **QYRO Lead** | `internal` / future `lead_engine` | COMPLETE (internal use) | Bhavneet only — finds and contacts QYRO Assist prospects |
| **QYRO Assist** | `assistant` | COMPLETE (selling now) | Local business clients — AI receptionist: calls, chat, booking, follow-up |

Both products share one codebase, one database, one API, one infrastructure.
Separated at the data layer by `tenant_type` and enforced by Postgres RLS + tenant middleware.

---

## 2. High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          VERCEL (Next.js 14)                           │
│  Landing page  /products  /onboarding  /client/*  /internal/*  widgets │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │ HTTPS (API_URL)
┌─────────────────────────────▼──────────────────────────────────────────┐
│                      RAILWAY — Express API (:3001)                     │
│                                                                        │
│  Auth middleware (Clerk JWT)   Tenant middleware   Quota middleware     │
│                                                                        │
│  /api/v1/leads      /api/v1/campaigns   /api/v1/tenants                │
│  /api/v1/assist     /api/v1/billing     /api/v1/admin                  │
│  /api/v1/voice      /api/v1/swaig       /api/v1/pricing                │
│  /api/v1/webhooks   /api/v1/events/stream (SSE)                        │
│  /widgets/assist    (public, rate-limited)                             │
└──────┬──────────────┬──────────────┬──────────────────────────────────┘
       │              │              │
┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────────────────────────────────┐
│  Postgres   │ │   Redis   │ │         BullMQ Workers (Railway)        │
│  (Railway)  │ │ (Railway) │ │  research  outreach  replyTriage        │
│  Drizzle    │ │  pub/sub  │ │  outboundCall  webhook  anomaly          │
│  RLS on     │ │  queues   │ │                                         │
│  every table│ │  cache    │ └─────────────────────────────────────────┘
└─────────────┘ └─────┬─────┘
                      │ SSE broadcast
              ┌───────▼───────┐
              │  Browser SSE  │
              │  client dash  │
              └───────────────┘

External services:
  OpenAI (gpt-4o-mini / gpt-4o)   Google Places API   Apollo/Hunter (email)
    SignalWire (telephony PSTN)       Cal.com / Google Calendar
  Resend (transactional email)      Stripe (billing)    Clerk (auth)
```

---

## 3. Technology Stack

| Layer | Choice | Deployment | Notes |
|---|---|---|---|
| Frontend | Next.js 14 (App Router) | Vercel | `git push main` = auto-deploy |
| Backend API | Node.js + TypeScript + Express | Railway | Port 3001; separate service |
| Database | Postgres | Railway | Drizzle ORM; RLS policies enforced |
| Cache/Queue | Redis + BullMQ | Railway | 6 queue types + 6 workers |
| Scheduling | Railway cron services | Railway | Replaced n8n schedule triggers |
| Auth | Clerk | Clerk cloud | JWT bearer tokens; separate prod/dev envs |
| Billing | Stripe | Stripe cloud | Webhooks = entitlement authority |
| AI — cheap | gpt-4o-mini | OpenAI | Classification, scoring, drafts, FAQ |
| AI — standard | gpt-4o | OpenAI | Booking slot parsing, complex sessions |
| AI — premium | claude-sonnet-4-6 | Anthropic | Complex objections, voice premium |
| Voice telephony | SignalWire | SignalWire | cXML-compatible; `x-signalwire-signature` verification |
| Voice AI path A | SignalWire AI Agent + SWAIG | SignalWire | Native SWML function calling; `/api/v1/swaig/*` |
| Voice AI path B | N/A (decommissioned) | N/A | Retell runtime removed from active API surface |
| Calendar | Cal.com + Google Calendar | Adapter pattern | Factory in `packages/agents/src/calendars/` |
| Email | Resend | Resend cloud | REST only (no SDK); `apps/api/src/lib/sendEmail.ts` |
| Lead sources | Google Places API (New) | Google | Primary lead search; no scraping |
| Email enrichment | Apollo (domain) + Hunter | External APIs | Email lookup only — not lead search |
| Real-time events | Redis pub/sub + SSE | In-process | `GET /api/v1/events/stream`; dashboard toasts |
| Process mgmt | PM2 (local) + Railway (prod) | Railway | Separate Railway service per worker |

---

## 4. Repository Structure

```
qyro/
├── CLAUDE.md                    ← Claude Code reads every session
├── CHANGE_TRACKER.md            ← Running log of all changes
├── .claudeignore                ← Files Claude should never read
├── .env.example                 ← Complete env var reference
├── package.json                 ← pnpm workspace root
├── turbo.json                   ← Turborepo pipeline config
│
├── apps/
│   ├── api/                     ← Express API (Railway)
│   │   └── src/
│   │       ├── index.ts         ← Server entry; routes mounting; WS upgrade for Retell
│   │       ├── lib/
│   │       │   ├── sendEmail.ts       ← Resend REST email sender
│   │       │   └── entitlements.ts    ← Subscription + trial + override resolver
│   │       ├── middleware/
│   │       │   ├── auth.ts            ← Clerk JWT + DEV_BYPASS_AUTH; Retell HMAC; SWAIG Basic
│   │       │   ├── tenant.ts          ← Tenant scoping; auto-provision on first login
│   │       │   └── quota.ts           ← Per-tenant token quota check
│   │       └── routes/
│   │           ├── leads.ts           ← Lead management + urgency sort
│   │           ├── campaigns.ts       ← Campaign CRUD
│   │           ├── assist.ts          ← Outbound pipeline, metrics, call control, analytics
│   │           ├── voice.ts           ← SignalWire inbound/outbound TwiML + status callbacks
│   │           ├── retell.ts          ← Retell webhooks, tool endpoints, LLM WS
│   │           ├── swaig.ts           ← SignalWire AI Agent SWAIG functions
│   │           ├── tenants.ts         ← Settings, onboarding, users
│   │           ├── billing.ts         ← Stripe checkout, portal, webhook
│   │           ├── admin.ts           ← Master-admin cross-tenant controls
│   │           ├── events.ts          ← SSE stream endpoint
│   │           └── webhooks.ts        ← Nightly ingest, morning digest, Stripe
│   │
│   ├── web/                     ← Next.js 14 (Vercel)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx                      ← Public landing page
│   │       │   ├── onboarding/page.tsx            ← 4-step self-serve onboarding
│   │       │   ├── products/page.tsx              ← Product chooser (→ /onboarding gate)
│   │       │   ├── (client)/client/
│   │       │   │   ├── dashboard/                 ← Client main dashboard
│   │       │   │   │   └── analytics/             ← 30-day trend charts (recharts)
│   │       │   │   ├── conversations/             ← Chat inbox
│   │       │   │   ├── calls/                     ← Call history + transcript playback
│   │       │   │   ├── approvals/                 ← Pending message approvals
│   │       │   │   ├── bookings/                  ← Appointment list
│   │       │   │   ├── outbound-pipeline/         ← Outbound lead queue
│   │       │   │   ├── call-control/              ← Pause/resume/capacity controls
│   │       │   │   ├── settings/page.tsx          ← Voice, AI, org settings
│   │       │   │   ├── admin/page.tsx             ← Tabbed admin panel (org/voice/AI/team/billing)
│   │       │   │   └── widget/                    ← Embed code generator
│   │       │   ├── (internal)/internal/
│   │       │   │   ├── dashboard/                 ← Lead ops home
│   │       │   │   ├── leads/                     ← Lead inbox + urgency sort + skipped filter
│   │       │   │   ├── campaigns/                 ← Campaign manager
│   │       │   │   ├── approvals/                 ← Message approval queue
│   │       │   │   ├── settings/                  ← Internal tenant settings
│   │       │   │   ├── admin/                     ← Master admin (cross-tenant)
│   │       │   │   └── team/                      ← Tenant user management
│   │       │   ├── sign-in/  sign-up/  terms/  privacy/  contact/
│   │       │   └── (admin)/             ← /qx-ops rate-limited ops path
│   │       ├── components/
│   │       │   ├── sidebar/ClientSidebar.tsx
│   │       │   └── sidebar/InternalSidebar.tsx
│   │       └── hooks/useSSEEvents.ts    ← SSE hook with reconnect + live indicator
│   │
│   └── crons/                   ← Railway cron services (TypeScript)
│       ├── nightly-ingest.ts    ← POST /api/v1/webhooks/nightly-ingest (22:00 PT)
│       └── morning-digest.ts    ← POST /api/v1/webhooks/morning-digest (07:00 PT)
│
├── packages/
│   ├── db/
│   │   ├── src/schema.ts        ← ALL tables; tenant_id on every table
│   │   ├── migrations/          ← 13 migrations (see §6)
│   │   └── client.ts            ← Drizzle client + connection
│   │
│   ├── agents/
│   │   └── src/
│   │       ├── runner.ts        ← Agent call wrapper; AgentResult<T> envelope
│   │       ├── budget.ts        ← Model tier assignments + per-tenant limits
│   │       ├── compact.ts       ← Conversation compaction (every 6 turns)
│   │       ├── calendars/
│   │       │   ├── index.ts     ← Calendar adapter factory (Cal.com or Google)
│   │       │   ├── calCom.ts    ← Cal.com REST adapter
│   │       │   ├── googleCalendar.ts ← Google Calendar adapter
│   │       │   └── types.ts     ← Shared CalendarSlot, BookingResult types
│   │       └── agents/
│   │           ├── leadDiscovery.ts   ← Google Places API lead search
│   │           ├── research.ts        ← Website summary + urgency score (Redis cached 7d)
│   │           ├── outreach.ts        ← Outreach draft → pending_approval
│   │           ├── replyTriage.ts     ← Inbound reply classification + DNC
│   │           ├── booking.ts         ← Slot parsing + Cal.com booking creation
│   │           ├── clientAssistant.ts ← Chat/text AI assistant; intent counters
│   │           ├── voiceAssistant.ts  ← Voice-optimized AI assistant (TwiML path)
│   │           ├── emailEnrichment.ts ← Apollo/Hunter email lookup
│   │           ├── qa.ts              ← Outbound message guardrail (PASS/BLOCK)
│   │           └── (promptHygiene.ts) ← SPECCED, NOT YET BUILT
│   │
│   ├── queue/
│   │   └── src/
│   │       ├── queues.ts        ← All BullMQ queue definitions (6 queues)
│   │       ├── realtime.ts      ← Redis pub/sub for SSE event emission
│   │       └── workers/
│   │           ├── outboundCallWorker.ts     ← Dials SignalWire + DNC + capacity guard
│   │           ├── webhookWorker.ts          ← Async voice webhook processing (concurrency 5)
│   │           └── anomalyDetectionWorker.ts ← Every 15min: high API vol, export vol, sequential pagination
│   │
│   ├── workers/
│   │   └── src/
│   │       ├── researchWorker.ts        ← Runs research agent
│   │       ├── outreachWorker.ts        ← Runs outreach agent + QA
│   │       └── replyTriageWorker.ts     ← Classifies inbound replies
│   │
│   └── prompts/                 ← Prompt loader + validator
│
├── docs/
│   ├── ARCHITECTURE.md          ← This file
│   ├── BLUEPRINT.md             ← Product vision + phase tracking
│   ├── AGENTS.md                ← Agent specs + contracts
│   ├── ENVIRONMENTS.md          ← All env vars + local setup guide
│   ├── COMPLIANCE.md            ← Channel compliance rules (TCPA, CAN-SPAM)
│   ├── TOKEN_BUDGET.md          ← Model tiers + token limits
│   ├── DECISIONS.md             ← Architecture decision records
│   └── PROMPTS/
│       ├── assist/              ← QYRO Assist prompt packs
│       │   ├── general_faq_v1.md
│       │   ├── general_followup_email_v1.md
│       │   ├── general_missed_call_sms_v1.md
│       │   └── general_voice_v1.md
│       └── lead/
│           └── medspa_missed_call_v1.md
│
└── infra/
    ├── docker-compose.yml       ← Local Postgres + Redis
    ├── pm2/ecosystem.config.cjs ← Local process management (API + workers)
    ├── seed.ts                  ← Seeds internal tenant + test data
    └── n8n/workflows/           ← Legacy workflow configs (kept as fallback)
```

---

## 5. Database Schema

Every table has `tenant_id`. Postgres RLS enforced via migration `0001_rls_policies.sql`.

### Core tables

| Table | Purpose |
|---|---|
| `tenants` | One row per tenant. `tenant_type`, `voice_number`, `metadata` (JSONB) |
| `users` | Clerk users with tenant linkage and roles |
| `tenant_subscriptions` | Stripe subscription state — entitlement authority |

### QYRO Lead tables

| Table | Purpose |
|---|---|
| `prospects_raw` | Raw leads from Google Places / Apollo. `source_type`, `research_skipped`, `research_skip_reason` |
| `prospects_enriched` | Research agent output: summary, urgency_score, pitch_angles |
| `do_not_contact` | DNC list (checked before every outreach). Never deleted |
| `message_attempts` | Outreach drafts + status (pending_approval → sent → replied) |

### QYRO Assist tables

| Table | Purpose |
|---|---|
| `conversations` | Session records for chat + voice interactions |
| `conversation_messages` | Turn-by-turn message history |
| `call_attempts` | All call records. Fields: direction, status, attempt_count, max_attempts, next_attempt_at, recording_url, transcript_text, transcript_json, duration_seconds |
| `appointments` | Bookings created by Booking Agent |
| `daily_summaries` | Per-tenant/per-day analytics (leads, calls, booked, escalations, intent counts) |

### Shared tables

| Table | Purpose |
|---|---|
| `usage_events` | Every agent call logged here (model, tokens, cost) |
| `audit_logs` | System events, escalations, DNC additions, consent gates |
| `consent_events` | Per-prospect per-channel consent records |
| `webhook_events` | Deduplication store for Retell and SignalWire webhooks |

### Migrations (in order)

| Migration | What it adds |
|---|---|
| `0000_needy_tinkerer.sql` | Initial schema — all core tables |
| `0001_rls_policies.sql` | Postgres RLS tenant isolation policies |
| `0002_outbound_call_pipeline.sql` | call_attempts outbound fields (direction, status, attempt_count, etc.) |
| `0003_voice_conversation_history.sql` | conversationHistory Redis key linkage |
| `0004_billing_subscriptions.sql` | tenant_subscriptions table |
| `0005_tenants_twilio_number.sql` | Initial voice number field (pre-rename) |
| `0006_rename_voice_fields.sql` | Rename to provider-neutral: voice_number, call_sid |
| `0007_anti_scraping.sql` | Rate limit tracking, anomaly log tables |
| `0008_auto_send_missed_call.sql` | Tenant missed call SMS auto-send toggle |
| `0009_escalation_contact.sql` | Tenant escalation contact fields; session escalation_reason |
| `0010_call_recordings.sql` | call_attempts recording_url, transcript_text, transcript_json, duration_seconds |
| `0011_daily_summaries.sql` | daily_summaries table for analytics |
| `0012_consent_gate_research_skip.sql` | prospects_raw source_type, research_skipped, research_skip_reason |

---

## 6. API Surface

All routes under `/api/v1/` unless noted. Clerk JWT required unless marked PUBLIC.

### API Trust Matrix (Source of truth: `apps/api/src/index.ts`)

| Route prefix | Trust class | Middleware chain | Fail mode |
|---|---|---|---|
| `/webhooks` | Internal/provider callback | Router-specific validation (`WEBHOOK_SECRET` and Stripe signature in mounted routers) | Closed on auth/signature failure |
| `/api/v1/voice` | Provider-signed | `validateSignalWireSignature` -> `voiceRouter` | Closed (403) on missing/invalid signature in production |
| `/api/v1/swaig` | Internal-secret/provider | `validateSwaigRequest` -> `swaigRouter` | Closed in production on missing/invalid secret |
| `/api/v1/assist` | Public ingress (widget/missed-call) | `rateLimitWithOptions(... { scope: "ip", failureMode: "fail-closed" })` -> `assistPublicRouter` | Closed on rate-limit infra failure |
| `/api` (pricing router) | Public read | `rateLimitWithOptions(... { scope: "ip", failureMode: "fail-closed" })` -> `pricingRouter` | Closed on rate-limit infra failure |
| `/api/leads` | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `rateLimit("general")` -> `leadsRouter` | Open on rate-limit infra failure (availability-biased) |
| `/api/campaigns` | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `rateLimit("general")` -> `campaignsRouter` | Open on rate-limit infra failure (availability-biased) |
| `/api` (assist router) | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `rateLimit("general")` -> `assistRouter` | Open on rate-limit infra failure (availability-biased) |
| `/api/v1/tenants` | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `rateLimit("general")` -> `tenantsRouter` | Open on rate-limit infra failure (availability-biased) |
| `/api/v1/events` | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `eventsRouter` | SSE path bypasses transaction pinning intentionally |
| `/api` (admin router) | Authenticated admin | `requireClerkAuth` -> `adminRouter` | Closed by auth/role checks in admin handlers |
| `/api` (billing router) | Authenticated + tenant-scoped | `requireClerkAuth` -> `tenantMiddleware` -> `rateLimit("general")` -> `billingRouter` | Open on rate-limit infra failure (availability-biased) |

### Auth + Admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/me` | Master admin | Current admin identity |
| GET | `/api/v1/admin/tenants` | Master admin | All tenants |
| PATCH | `/api/v1/admin/tenants/:id/access` | Master admin | Override tenant product access |
| PATCH | `/api/v1/admin/users/:id/role` | Master admin | Set user role |
| GET | `/api/v1/tenants/settings` | Clerk | Tenant settings incl. onboardingComplete |
| PATCH | `/api/v1/tenants/settings` | Clerk | Update tenant settings |
| PATCH | `/api/v1/tenants/onboarding` | Clerk | Save onboarding data, mark complete |
| GET | `/api/v1/tenants/users` | Owner/admin | List tenant users |
| PATCH | `/api/v1/tenants/users/:id` | Owner/admin | Update user role/access |

### QYRO Lead

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/leads` | Clerk | List prospects (sort by urgency, filter skipped) |
| GET | `/api/v1/leads/:id` | Clerk | Prospect detail |
| POST | `/api/v1/leads/discover` | Clerk | Trigger lead discovery |
| GET | `/api/v1/campaigns` | Clerk | List campaigns |
| POST | `/api/v1/campaigns` | Clerk | Create campaign |
| PATCH | `/api/v1/campaigns/:id` | Clerk | Update campaign |

### QYRO Assist

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/assist/outbound-calls/enqueue` | Clerk | Enqueue outbound call (blocks if paused) |
| GET | `/api/v1/assist/outbound-calls/pipeline` | Clerk | Pipeline status list |
| POST | `/api/v1/assist/outbound-calls/cancel/:id` | Clerk | Cancel queued attempt |
| GET | `/api/v1/assist/outbound-calls/control` | Clerk | Pause/resume state + capacity |
| PATCH | `/api/v1/assist/outbound-calls/control` | Owner/admin/operator | Pause, resume, drain, set max concurrent |
| GET | `/api/v1/assist/outbound-calls/metrics` | Clerk | Status counts + capacity strip |
| GET | `/api/v1/assist/analytics` | Clerk | 30-day analytics (daily_summaries) |

### Voice — SignalWire TwiML

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/voice/incoming` | SignalWire sig | Inbound call — TwiML response |
| POST | `/api/v1/voice/turn` | SignalWire sig | Voice turn processing (voiceAssistant) |
| POST | `/api/v1/voice/outbound/twiml` | SignalWire sig | Outbound call TwiML |
| POST | `/api/v1/voice/status` | SW sig (async) | Call status callback → webhookWorker queue |

### Voice — SWAIG (SignalWire AI Agent functions)

HTTP Basic auth: `SWAIG_WEBHOOK_SECRET`

| Method | Path | SWAIG function | Purpose |
|---|---|---|---|
| POST | `/api/v1/swaig/booking` | `book_appointment` | Calendar lookup + booking creation |
| POST | `/api/v1/swaig/faq` | `business_info` | Return approved services/hours |
| POST | `/api/v1/swaig/escalation` | `escalate` | Log + notify staff + return transfer instruction |
| POST | `/api/v1/swaig/sms` | `callback_sms` | Send follow-up SMS to caller |

Tenant identification priority: SWML `global_data.tenantId` → payload `tenantId` → `voice_number` lookup.

### Voice — Retell

Retell runtime and route surface are decommissioned in the active API. Historical references may remain in archived docs only.

### Billing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/billing/subscription` | Clerk | Current subscription state |
| POST | `/api/v1/billing/checkout-session` | Clerk | Create Stripe checkout |
| POST | `/api/v1/billing/portal-session` | Clerk | Create Stripe billing portal |
| POST | `/webhooks/stripe` | Stripe sig (PUBLIC) | Stripe event processing |

### Internal automation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/webhooks/nightly-ingest` | `x-webhook-secret` | Trigger lead discovery pipeline |
| POST | `/api/v1/webhooks/morning-digest` | `x-webhook-secret` | Compute daily metrics → daily_summaries |

### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/widgets/assist/chat` | Widget chat (rate-limited by Redis; `widget_allowed_origins` enforced) |
| GET | `/api/v1/events/stream` | SSE real-time stream (Clerk JWT via query param) |

---

## 7. AI Agents

All agents go through `packages/agents/src/runner.ts`. All check token budget first via `packages/agents/src/budget.ts`. All errors wrapped in `AgentResult<T>`. All prompts loaded from `docs/PROMPTS/`.

| Agent | File | Model tier | Status |
|---|---|---|---|
| Lead Discovery | `leadDiscovery.ts` | cheap (gpt-4o-mini) | ACTIVE |
| Research | `research.ts` | cheap + optional web_search | ACTIVE |
| Outreach | `outreach.ts` | cheap | ACTIVE |
| Reply Triage | `replyTriage.ts` | cheap | ACTIVE |
| Booking | `booking.ts` | standard (gpt-4o) | ACTIVE |
| Client Assistant | `clientAssistant.ts` | cheap → escalate to standard | ACTIVE |
| Voice Assistant | `voiceAssistant.ts` | cheap → escalate to standard | ACTIVE (TwiML path only) |
| Email Enrichment | `emailEnrichment.ts` | N/A (API call) | ACTIVE |
| QA Guardrail | `qa.ts` | cheap | ACTIVE |
| Prompt Hygiene | `promptHygiene.ts` | cheap | **NOT YET BUILT** |

**SWAIG functions are NOT LLM agents** — they are callable endpoints invoked by SignalWire AI Agent.

---

## 8. Queue Workers

All BullMQ. Redis URL from `REDIS_URL`. Separate Railway service per worker.

| Worker | Queue | Concurrency | Trigger | What it does |
|---|---|---|---|---|
| `researchWorker` | RESEARCH | 3 | Lead discovery enqueue | Runs research agent; caches in Redis 7d |
| `outreachWorker` | OUTREACH | 2 | Research complete | Runs outreach + QA; writes pending_approval |
| `replyTriageWorker` | REPLY_TRIAGE | 5 | Inbound reply | Classifies reply; adds DNC if unsubscribe |
| `outboundCallWorker` | OUTBOUND_CALL | 3 | Manual enqueue / nightly | DNC + pause + capacity check; dials SignalWire or Retell |
| `webhookWorker` | WEBHOOK | 5 | Voice/Retell status webhooks | Async processing; Redis idempotency 24h TTL |
| `anomalyDetectionWorker` | (timer, 15min) | 1 | Cron-style | Detects high API vol, export vol, sequential pagination |

**PM2 start commands (local):**
```
pnpm --filter @qyro/workers worker:research
pnpm --filter @qyro/workers worker:outreach
pnpm --filter @qyro/workers worker:reply-triage
pnpm --filter @qyro/queue worker:outbound-call
pnpm --filter @qyro/queue worker:webhook
```

**Railway start commands:**
```
research worker:   pnpm --filter @qyro/workers worker:research
outreach worker:   pnpm --filter @qyro/workers worker:outreach
reply-triage:      pnpm --filter @qyro/workers worker:reply-triage
outboundCall:      pnpm --filter @qyro/queue worker:outbound-call
webhook worker:    pnpm --filter @qyro/queue worker:webhook
```

---

## 9. Voice Architecture

### Path A — SignalWire AI Agent (SWAIG) — PRIMARY

```
Customer calls tenant's SignalWire number
    ↓
SignalWire AI Agent (SWML config) handles speech with its own LLM
    ↓ (when business action needed)
POST /api/v1/swaig/<function>  [HTTP Basic auth: SWAIG_WEBHOOK_SECRET]
    ↓
QYRO executes action (booking / FAQ / escalation / SMS)
    ↓
Returns result string → AI reads aloud to caller
```

QYRO backend (`voiceAssistant.ts`) is **NOT called** in this path.

### Path B — Retell Custom LLM (per-tenant opt-in)

```
Customer calls tenant's SignalWire number
    ↓
SignalWire routes to Retell (configured via tenant voice_runtime=retell)
    ↓
Retell connects to /api/v1/retell/llm-websocket (WebSocket)
    ↓
QYRO voiceAssistant runs as LLM backend; tool calls handled via /retell/tools/*
```

### Path C — TwiML Loop (legacy / fallback)

```
Customer calls → POST /api/v1/voice/incoming → TwiML <Gather>
    ↓
Speech recognized → POST /api/v1/voice/turn → voiceAssistant.ts
    ↓
Reply wrapped in <Say> → returned as TwiML
```

This path has a 4-second processing guard. Fallback TwiML: "Please hold while we connect you."

### Outbound calls

```
Enqueue via POST /api/v1/assist/outbound-calls/enqueue
    ↓ BullMQ OUTBOUND_CALL queue
outboundCallWorker:
  1. Re-check DNC
  2. Check tenant pause + global pause (OUTBOUND_VOICE_GLOBAL_PAUSED)
  3. Check capacity: activeCount < maxConcurrentCalls (default 3)
  4. Dial: SignalWire LaML REST (or Retell create-phone-call if voice_runtime=retell)
  5. Status webhook → POST /api/v1/voice/status → webhookWorker → retry scheduling
```

---

## 10. Tenant Provisioning and Onboarding

### Auto-provisioning

On every authenticated API call, `apps/api/src/middleware/tenant.ts` checks if the user has a tenant. If not, `provisionTenantForClerkUser()` creates one with:
- `tenant_type: "assistant"` (default)
- `metadata.onboarding_complete: false`
- `metadata.provisioned_from: "clerk_first_login"`

Race condition guard: unique constraint on `users.clerk_id` + `ON CONFLICT DO NOTHING`.

### Onboarding gate

`GET /api/v1/tenants/settings` returns `onboardingComplete: boolean`.

`apps/web/src/app/products/page.tsx` redirects to `/onboarding` when `onboardingComplete === false`.
Existing tenants (field absent) are treated as complete — no disruption.

### Onboarding flow (`/onboarding`)

4-step page at `apps/web/src/app/onboarding/page.tsx`:

| Step | What's collected |
|---|---|
| 0 — Product selection | `productType`: "assist" (Lead = "coming soon") |
| 1 — Business info | name, industry, phone, timezone |
| 2 — AI setup | businessDescription, services (comma-list), greeting |
| 3 — Done | Call-forwarding instructions displayed |

`PATCH /api/v1/tenants/onboarding` saves all fields to tenant metadata + sets `onboarding_complete: true`.

After completion: redirects to `/client/dashboard` (Assist) or `/internal/dashboard` (Lead).

---

## 11. Real-Time Events (SSE)

```
Server-side event emitter: packages/queue/src/realtime.ts
  publishEvent(tenantId, eventType, data) → Redis pub/sub channel: events:{tenantId}

SSE endpoint: GET /api/v1/events/stream
  - Clerk JWT required (query param token=)
  - Subscribes to Redis channel for tenant
  - Streams events to browser as text/event-stream
  - 30-second ping heartbeat

Browser: apps/web/src/hooks/useSSEEvents.ts
  - Reconnect on error/close
  - Live status indicator
  - Dashboard toast notifications for: pending_approval, escalation, call_status_change, new_lead
```

Events emitted by:
- `leads.ts` — `new_lead`
- `voice.ts` / `webhookWorker.ts` — `call_status_change`
- `outreach.ts` / `outreachWorker.ts` — `pending_approval`
- `voice.ts` / `swaig.ts` — `escalation`

---

## 12. Entitlement Model

Resolution order (highest priority wins):

1. **Billing override** — master admin can force-grant access regardless of subscription
2. **Active Stripe subscription** — `tenant_subscriptions` table; updated by Stripe webhook
3. **Trial access** — trial call counters in tenant metadata (decrements per use)
4. **Per-user overrides** — `users.metadata.product_access` can extend/restrict
5. **Default** — `{ lead: false, assist: false }` if no entitlement source exists

Implemented in `apps/api/src/lib/entitlements.ts`.

`invoice.payment_failed` Stripe event revokes access immediately.

---

## 13. Security Model

### Auth layers

| Layer | Mechanism | Bypass flag |
|---|---|---|
| Web app routes | Clerk middleware | None in prod |
| API routes | Clerk JWT bearer token | `DEV_BYPASS_AUTH=true` (blocks if `NODE_ENV=production`) |
| SignalWire webhooks | HMAC `x-signalwire-signature` | `SKIP_SW_SIGNATURE_CHECK=true` (dev only) |
| Retell webhooks | HMAC-SHA256 `x-retell-signature` | None |
| SWAIG functions | HTTP Basic `SWAIG_WEBHOOK_SECRET` | None |
| Internal crons | `x-webhook-secret` header | None |
| Stripe webhooks | Stripe signature | None |

### Rate limiting

- Widget chat endpoint: Redis-backed INCR/EXPIRE (persists across restarts)
- `/qx-ops` admin ops path: 5 req/min per IP; 1-hour block on violation
- SSE stream: Clerk JWT required; per-tenant channel isolation

### Tenant isolation

- Every table has `tenant_id` column
- Postgres RLS policies (migration `0001_rls_policies.sql`) enforce tenant scoping at DB level
- Tenant middleware sets `req.tenant` on every authenticated request
- `widget_allowed_origins` per tenant prevents cross-origin widget abuse

---

## 14. Deployment Topology

```
                    ┌──────────────────────────────────────────┐
                    │               VERCEL                     │
                    │   Next.js 14 web app — git push = deploy │
                    │   GitHub: bhavneetsingh12/qyro           │
                    │   No vercel.json — Vercel defaults       │
                    └──────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                              RAILWAY                                    │
│                                                                         │
│  api service         pnpm --filter @qyro/api start                     │
│  research-worker     pnpm --filter @qyro/workers worker:research        │
│  outreach-worker     pnpm --filter @qyro/workers worker:outreach        │
│  reply-worker        pnpm --filter @qyro/workers worker:reply-triage    │
│  outbound-worker     pnpm --filter @qyro/queue worker:outbound-call     │
│  webhook-worker      pnpm --filter @qyro/queue worker:webhook           │
│  nightly-cron        node apps/crons/dist/nightly-ingest.js             │
│  morning-cron        node apps/crons/dist/morning-digest.js             │
│                                                                         │
│  postgres            Railway Postgres (daily backups)                   │
│  redis               Railway Redis (persistence enabled)                │
└─────────────────────────────────────────────────────────────────────────┘
```

Cron schedules (Railway dashboard — not in code):
- `nightly-ingest`: 22:00 PT daily
- `morning-digest`: 07:00 PT daily

Cron required env vars: `API_URL`, `WEBHOOK_SECRET`

---

## 15. Known Gaps and TODOs

### Phase 3 (next to build)

| Item | Priority | Notes |
|---|---|---|
| Wire Stripe checkout into onboarding | P1 | Products page has manual billing; onboarding doesn't gate on it yet |
| Calling hours enforcement in outboundCallWorker | P1 | Gate is documented in COMPLIANCE.md; not yet coded |
| Cal.com webhook for booking confirmation | P1 | Confirmations not yet auto-synced back |
| Clerk user lifecycle webhooks | P2 | No user sync on Clerk delete/update |
| Calendly / Square Appointments adapters | P2 | Only Cal.com + Google Calendar today |

### Phase 4 (future)

| Item | Notes |
|---|---|
| QYRO Lead as a product | `tenant_type: "lead_engine"` — backend exists; no UI/billing/onboarding yet |
| Prompt Hygiene Agent | Specced in AGENTS.md; `promptHygiene.ts` does not exist yet |
| Session P — mobile polish | Pre-launch UI refinement pass |

### Compliance gates (never remove until satisfied)

- Cold outbound AI voice calling: BLOCKED — see COMPLIANCE.md for full gate
- Proactive SMS outreach (non-missed-call): blocked — consent collection not built
- FTC National DNC Registry check: not integrated

---

## 16. Key Architectural Decisions

### ADR-001: One codebase, two products
Keep QYRO Lead and QYRO Assist in one monorepo, separated by `tenant_type`.
Avoids maintaining two separate codebases. Agents and infra are shared where appropriate.

### ADR-002: SignalWire over Twilio
Migrated to SignalWire in April 2026. cXML-compatible, same PSTN routing semantics,
better pricing. All voice fields renamed to provider-neutral names (`voice_number`, `call_sid`).

### ADR-003: SWAIG as primary voice AI path
SignalWire AI Agent handles all speech processing natively. QYRO exposes callable SWAIG
function endpoints. This means QYRO's `voiceAssistant.ts` is NOT called on the primary path —
SignalWire handles the LLM. QYRO handles the business actions.

### ADR-004: Stripe webhook = entitlement authority
Subscription state is persisted in `tenant_subscriptions` and updated by Stripe webhook.
Tenant metadata is retained as fallback only. `invoice.payment_failed` = immediate access revoke.

### ADR-005: Consent-first, approval-gated outreach
No outbound message is auto-sent without human approval gate.
No prospect is messaged without DNC check. Unsubscribes honored immediately (no queue delay).

### ADR-006: Railway crons replaced n8n schedule triggers
n8n is kept in `infra/n8n/` as a fallback/recovery option but is no longer the execution path.
Cron scripts POST to API with `x-webhook-secret` — same auth as before, simpler infrastructure.

### ADR-007: BullMQ webhook worker for voice event async processing
`POST /api/v1/voice/status`, `/retell/call-events`, `/retell/transcript-events` now return
immediate 200 and enqueue for processing. Prevents provider timeout (SignalWire/Retell have
short callback windows). Redis idempotency cache (24h TTL) on Retell events.

---

## 17. Local Development Setup

```bash
# 1. Start local services
docker compose -f infra/docker-compose.yml up -d

# 2. Copy env template
cp .env.example .env.local
# Fill in: OPENAI_API_KEY, CLERK keys, SIGNALWIRE keys (or SKIP_SW_SIGNATURE_CHECK=true)

# 3. Run migrations
pnpm db:migrate

# 4. Seed internal tenant
npx tsx infra/seed.ts

# 5. Start API
pnpm dev

# 6. Start workers (separate terminals or PM2)
pm2 start infra/pm2/ecosystem.config.cjs

# If Next chunks 404 locally: clean apps/web/.next and restart web dev server
```

### Key environment variables

See `docs/ENVIRONMENTS.md` for the complete env var reference.

Must be set before any traffic:
- `DATABASE_URL`, `REDIS_URL`
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_API_TOKEN`, `SIGNALWIRE_SPACE_URL`
- `SWAIG_WEBHOOK_SECRET` (required for SWAIG calls)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `WEBHOOK_SECRET` (Railway cron auth)
- `PUBLIC_API_BASE_URL` (used in TwiML action URLs)

### Pre-launch security checklist

- Pre-deploy gate (run before every prod rollout):

```bash
pnpm run smoke:workers
pnpm run test:tenant-middleware
pnpm exec tsc --noEmit --pretty false
```

- [ ] `SKIP_SW_SIGNATURE_CHECK` is NOT set in prod
- [ ] `DEV_BYPASS_AUTH` is NOT set or is `false` in prod
- [ ] `OUTBOUND_VOICE_GLOBAL_PAUSED` set correctly (true during soft launch)
- [ ] Stripe live keys configured + webhook registered
- [ ] Clerk production environment configured
- [ ] `MASTER_ADMIN_CLERK_IDS` or `MASTER_ADMIN_EMAILS` set for Bhavneet
- [ ] `SWAIG_WEBHOOK_SECRET` set
- [ ] All Railway services have health checks configured
- [ ] Billing alerts set on OpenAI prod key ($10, $50, $100)
