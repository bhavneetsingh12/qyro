# QYRO Architecture Document
_Generated: 2026-04-10 | Derived from: all .md files, git log (50 commits), and live filesystem_

---

## 1. System Overview

QYRO is two separately-sold AI products running on one shared platform:

| Product | Target buyer | Tenant type | Status |
|---|---|---|---|
| **QYRO Assist** | Local businesses (dental, medspa, home services, etc.) | `assistant` | Production-ready |
| **QYRO Lead** | Agencies / sales teams | `internal` now, `lead_engine` Phase 4 | Internal use only |

Both products share one codebase, one Postgres database, one Redis instance, one API, and one auth layer. They are separated at runtime by `tenant_type` on the `tenants` table. They have separate Next.js portal routes, separate pricing pages, and separate landing page sections.

**Current priority:** Ship QYRO Assist to paying clients. QYRO Lead runs internally only and is used to find Assist clients.

---

## 2. Architecture Diagram

```
[ Public landing / sign-up ]
          |
          v
[ Clerk Auth — session JWT ]
          |
     ┌────┴─────┐
     v           v
[ /internal/* ] [ /client/* ]    (Next.js App Router — Vercel)
  QYRO Lead       QYRO Assist
  portal          portal
     └────┬─────┘
          |  Bearer token
          v
[ Node/Express API — Railway ]
  apps/api/src/index.ts (port 3001)
          |
  ┌───────┼────────┬──────────────┐
  v       v        v              v
[Postgres] [Redis] [BullMQ queues] [SSE /events/stream]
  Railway   Railway  research       Redis pub/sub
  Postgres  Redis    outreach       real-time push
                     outbound-call
                     webhook
                     reply-triage
          |
  ┌───────┼────────────────────┐
  v       v                    v
[OpenAI] [SignalWire + Retell] [Stripe]
  LLM     telephony             billing
          (cXML + Retell AI)
          |
  ┌───────┼─────────┐
  v       v         v
[Cal.com] [Google Calendar] [Resend email]
  booking  booking           transactional
```

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 14 App Router | Deployed on Vercel; push to main = auto-deploy |
| Backend API | Node.js + TypeScript + Express | Deployed on Railway; port 3001 |
| Database | Postgres | Railway Postgres; Drizzle ORM; RLS policies in migration 0001 |
| Cache / Queues | Redis + BullMQ | Railway Redis; 6 queue types |
| Auth | Clerk | Separate production/dev environments; JWT bearer tokens to API |
| Billing | Stripe | Webhooks as entitlement authority; `tenant_subscriptions` table |
| AI models | OpenAI (tiered) | gpt-4o-mini (cheap), gpt-4o (standard), claude-sonnet-4-6 (premium) |
| Voice telephony | SignalWire (primary) | cXML-compatible; `x-signalwire-signature` verification |
| Voice AI runtime | Retell | Custom LLM WebSocket; tenant-level `voice_runtime` flag |
| Alternative voice | SWAIG | SignalWire AI native; separate route surface |
| Calendar (Assist) | Cal.com + Google Calendar | Adapter pattern; factory in `packages/agents/src/calendars/` |
| Email | Resend | Raw fetch (no SDK); `sendEmail.ts` wrapper |
| Lead sources | Google Places API (New) | Only search source; Apollo used for email enrichment only |
| Email enrichment | Apollo API + Hunter API | Domain-level email lookup; monthly usage tracking |
| Process management | PM2 + Railway services | `infra/pm2/ecosystem.prod.config.cjs`; separate Railway service per worker |
| Scheduling | Railway crons (active) + n8n (legacy) | Railway cron scripts in `apps/crons/`; n8n kept until verified |
| Real-time | Redis pub/sub + SSE | `packages/queue/src/realtime.ts`; `/api/v1/events/stream` |

---

## 4. Repository Structure

```
qyro/
├── apps/
│   ├── api/                     ← Express API (Railway)
│   │   └── src/
│   │       ├── index.ts         ← server entry, route mounts
│   │       ├── middleware/
│   │       │   ├── auth.ts      ← Clerk, Retell, SignalWire, SWAIG verification
│   │       │   ├── tenant.ts    ← tenant resolution + first-login provisioning
│   │       │   ├── quota.ts     ← per-tenant daily token quota check
│   │       │   └── rateLimit.ts
│   │       ├── routes/
│   │       │   ├── leads.ts         ← QYRO Lead: ingest, research, outreach
│   │       │   ├── campaigns.ts     ← QYRO Lead: campaign CRUD + approve/reject
│   │       │   ├── assist.ts        ← QYRO Assist: chat, missed-call, outbound queue
│   │       │   ├── voice.ts         ← SignalWire/Twilio inbound+outbound TwiML
│   │       │   ├── retell.ts        ← Retell webhooks + tool endpoints + LLM WebSocket
│   │       │   ├── swaig.ts         ← SignalWire AI (SWAIG) native endpoints
│   │       │   ├── billing.ts       ← Stripe checkout, portal, subscription
│   │       │   ├── tenants.ts       ← settings, onboarding, users, missed-call
│   │       │   ├── admin.ts         ← master-admin: cross-tenant controls
│   │       │   ├── events.ts        ← SSE real-time stream
│   │       │   └── webhooks.ts      ← nightly ingest + morning digest (cron triggers)
│   │       └── lib/
│   │           ├── entitlements.ts  ← subscription + trial + override resolver
│   │           └── sendEmail.ts     ← Resend REST wrapper
│   │
│   ├── web/                     ← Next.js 14 (Vercel)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx             ← public landing page
│   │       │   ├── onboarding/          ← NEW: self-serve onboarding (4-step)
│   │       │   ├── products/            ← product chooser (gated by onboarding)
│   │       │   ├── sign-in/, sign-up/   ← Clerk pages
│   │       │   ├── (internal)/          ← QYRO Lead portal
│   │       │   │   └── internal/
│   │       │   │       ├── dashboard/
│   │       │   │       ├── leads/, leads/[id]/
│   │       │   │       ├── campaigns/, campaigns/new/
│   │       │   │       ├── approvals/
│   │       │   │       ├── settings/
│   │       │   │       ├── team/        ← role + user management
│   │       │   │       └── admin/       ← master-admin cross-tenant controls
│   │       │   ├── (client)/            ← QYRO Assist portal
│   │       │   │   └── client/
│   │       │   │       ├── dashboard/, dashboard/analytics/
│   │       │   │       ├── conversations/
│   │       │   │       ├── calls/       ← call history + transcripts + recordings
│   │       │   │       ├── bookings/
│   │       │   │       ├── approvals/
│   │       │   │       ├── call-control/ ← outbound pause/resume/metrics
│   │       │   │       ├── outbound-pipeline/
│   │       │   │       ├── settings/
│   │       │   │       ├── widget/      ← embed code generator
│   │       │   │       └── admin/       ← tenant admin panel
│   │       │   └── (admin)/             ← platform ops (obscured path)
│   │       │       └── qx-ops/
│   │       ├── components/
│   │       │   ├── sidebar/InternalSidebar.tsx
│   │       │   ├── sidebar/ClientSidebar.tsx
│   │       │   ├── brand/QyroBrand.tsx
│   │       │   ├── auth/SignOutButton.tsx
│   │       │   └── billing/BillingActions.tsx
│   │       └── middleware.ts        ← Clerk protection; public: /, /sign-in, /sign-up, /terms, /privacy
│   │
│   └── crons/                   ← Railway cron trigger scripts
│       ├── nightly-ingest.ts    ← POST /webhooks/nightly/ingest at 22:00 PT
│       └── morning-digest.ts    ← POST /webhooks/morning/digest at 07:00 PT
│
├── packages/
│   ├── db/
│   │   ├── src/schema.ts        ← all 20+ tables (see Section 6)
│   │   ├── src/client.ts        ← Drizzle + admin pool + setTenantContext()
│   │   └── migrations/          ← 13 migrations (0000–0012)
│   │
│   ├── agents/
│   │   └── src/
│   │       ├── budget.ts        ← model tier assignments + per-tenant limits
│   │       ├── runner.ts        ← callLLM wrapper: quota → OpenAI → log
│   │       ├── compact.ts       ← 6-turn compaction for Client Assistant
│   │       ├── cache.ts         ← Redis research cache helpers
│   │       ├── agents/
│   │       │   ├── leadDiscovery.ts    ← Google Places → dedup → research queue
│   │       │   ├── research.ts         ← Redis cache → website → LLM → prospects_enriched
│   │       │   ├── outreach.ts         ← consent/DNC gate → draft → QA → pending_approval
│   │       │   ├── replyTriage.ts      ← LLM classify reply → route → DNC on unsubscribe
│   │       │   ├── booking.ts          ← Cal.com/Google → slot parse → confirm → appointments
│   │       │   ├── clientAssistant.ts  ← text: FAQ/booking/escalation + compaction
│   │       │   ├── voiceAssistant.ts   ← voice: same capabilities, voice-optimized
│   │       │   ├── emailEnrichment.ts  ← mock/Hunter/Apollo email lookup
│   │       │   └── qa.ts               ← static + LLM checks → pass/block
│   │       └── calendars/
│   │           ├── types.ts      ← CalendarAdapter interface
│   │           ├── calCom.ts     ← Cal.com adapter
│   │           ├── googleCalendar.ts ← Google Calendar adapter
│   │           └── index.ts      ← factory: loads adapter from tenant metadata
│   │
│   ├── queue/
│   │   └── src/
│   │       ├── queues.ts         ← 6 BullMQ queue definitions (see Section 7)
│   │       ├── realtime.ts       ← Redis pub/sub publisher for SSE events
│   │       └── workers/
│   │           ├── researchWorker.ts       ← processes research queue
│   │           ├── outreachWorker.ts       ← processes outreach queue
│   │           ├── replyTriageWorker.ts    ← processes reply-triage queue
│   │           ├── outboundCallWorker.ts   ← processes outbound-call queue
│   │           ├── webhookWorker.ts        ← async webhook processing (concurrency 5)
│   │           └── anomalyDetectionWorker.ts ← detects pipeline anomalies
│   │
│   └── prompts/
│       └── src/loader.ts        ← loads prompt .md from docs/PROMPTS/
│
├── docs/
│   ├── BLUEPRINT.md
│   ├── AGENTS.md
│   ├── DECISIONS.md             ← 19 ADRs documented
│   ├── TOKEN_BUDGET.md
│   ├── ENVIRONMENTS.md
│   ├── COMPLIANCE.md
│   ├── NIGHTLY_LEAD_PIPELINE.md
│   ├── SOLO_ROLLOUT_CHECKLIST.md
│   └── PROMPTS/
│       ├── lead/medspa_missed_call_v1.md
│       └── assist/
│           ├── general_faq_v1.md
│           ├── general_followup_email_v1.md
│           ├── general_missed_call_sms_v1.md
│           └── general_voice_v1.md
│
├── infra/
│   ├── docker-compose.yml         ← local dev: Postgres + Redis + n8n
│   ├── pm2/ecosystem.prod.config.cjs ← production PM2 (API + all workers)
│   ├── n8n/workflows/             ← legacy workflow JSON (kept during Railway cron rollout)
│   └── sql_todo_master_admin.sql  ← runbook for master-admin role management
│
└── scripts/
    ├── test-e2e.ts                ← Phase 1 end-to-end test
    ├── test-assist-e2e.ts         ← Phase 2 Assist end-to-end test
    ├── test-outbound-calls-e2e.ts ← Outbound call pipeline E2E test
    └── test-retell-phase-d.ts     ← Retell voice QA harness (10 scenarios)
```

---

## 5. Database Schema

### Migration history
| Migration | What it adds |
|---|---|
| 0000_needy_tinkerer.sql | All base tables: tenants, users, plans, prospects, enrichment, leads, outreach, calls, sessions, billing_events, audit_logs, etc. |
| 0001_rls_policies.sql | Postgres RLS `CREATE POLICY tenant_isolation` on all tenant-scoped tables |
| 0002_outbound_call_pipeline.sql | Outbound fields on `call_attempts`: direction, status, attempt_count, DND, compliance, booking_status |
| 0003_voice_conversation_history.sql | Conversation history storage for voice turns |
| 0004_billing_subscriptions.sql | `tenant_subscriptions` table: Stripe customer/subscription/price/status/period |
| 0005_tenants_twilio_number.sql | Intermediate voice number field (superseded by 0006) |
| 0006_rename_voice_fields.sql | Renames provider-branded fields: `twilio_number` → `voice_number`, `twilio_call_sid` → `call_sid` |
| 0007_anti_scraping.sql | Anti-scraping protections on prospect tables |
| 0008_auto_send_missed_call.sql | `tenants.auto_send_missed_call` boolean |
| 0009_escalation_contact.sql | `tenants.escalation_contact_phone`, `escalation_contact_email` |
| 0010_call_recordings.sql | `call_attempts.duration_seconds`, `transcript_text`, `transcript_json`, `recording_url` |
| 0011_daily_summaries.sql | `daily_summaries` table: per-tenant daily KPI aggregates |
| 0012_consent_gate_research_skip.sql | `prospects_raw.source_type`, `research_skipped`, `research_skip_reason` |

### Core tables (abridged)
```
tenants              — id, name, slug, plan, voice_number, auto_send_missed_call,
                       escalation_contact_*, active, metadata (jsonb), created_at
users                — id, tenant_id, clerk_id, email, name, role, active, tos_accepted_at
tenant_subscriptions — id, tenant_id, stripe_customer_id, stripe_subscription_id,
                       stripe_price_id, status, product_access (jsonb), period_*
plans                — id, name, daily_input_tokens, daily_output_tokens, max_seats, price_monthly
prospects_raw        — id, tenant_id, name, domain, phone, email, niche, source, source_type,
                       consent_state, research_skipped, research_skip_reason
prospects_enriched   — id, tenant_id, prospect_id, urgency_score, summary, pain_points,
                       pitch_angles, services, researched_at
call_attempts        — id, tenant_id, prospect_id, call_sid, direction, status, attempt_count,
                       max_attempts, duration_seconds, transcript_text, transcript_json,
                       recording_url, dnd_at, booking_status, booking_ref
assistant_sessions   — id, tenant_id, session_type, channel, turn_count, escalated, created_at
message_attempts     — id, tenant_id, prospect_id, sequence_id, channel, status, direction,
                       body, classification
appointments         — id, tenant_id, prospect_id, cal_booking_id, start_time, status
do_not_contact       — id, tenant_id, email, phone, domain, reason, created_at
consent_events       — id, tenant_id, prospect_id, channel, consent_state, method, ip_address
daily_summaries      — id, tenant_id, date, new_prospects_count, calls_handled_count,
                       appointments_booked_count, escalations_count, questions_count, avg_urgency
usage_events         — id, tenant_id, agent_name, model, input_tokens, output_tokens, run_id
audit_logs           — id, tenant_id, actor_id, action, target_type, target_id, payload
webhook_events       — id, tenant_id, provider, event_type, payload, processed_at
dead_letter_queue    — id, tenant_id, queue_name, payload, error, created_at
```

---

## 6. API Route Surface

All authenticated routes require Clerk bearer token + tenant middleware unless marked `[public]`.

### QYRO Lead routes
| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/v1/leads` | List leads / ingest new leads via Places API |
| GET/PATCH/DELETE | `/api/v1/leads/:id` | Lead detail, update, delete |
| POST | `/api/v1/leads/:id/research` | Enqueue research job |
| POST | `/api/v1/leads/:id/outreach` | Enqueue outreach draft job |
| GET/POST | `/api/v1/campaigns` | List / create campaigns |
| GET/PATCH/DELETE | `/api/v1/campaigns/:id` | Campaign detail / update |
| POST | `/api/v1/campaigns/:id/approve/:messageId` | Approve outreach message |
| POST | `/api/v1/campaigns/:id/reject/:messageId` | Reject outreach message |

### QYRO Assist routes
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/assist/chat` | [public] Widget chat endpoint (tenant from body) |
| POST | `/api/v1/assist/missed-call` | [public] Missed-call SMS trigger |
| GET | `/api/v1/assist/sessions` | Conversation session list |
| GET | `/api/v1/assist/appointments` | Appointment list |
| POST | `/api/v1/assist/approve/:id` | Approve pending message |
| POST | `/api/v1/assist/reject/:id` | Reject pending message |
| POST | `/api/v1/assist/outbound-calls/enqueue` | Queue outbound call attempt |
| GET | `/api/v1/assist/outbound-calls/pipeline` | Pipeline status view |
| GET/PATCH | `/api/v1/assist/outbound-calls/control` | Pause/resume/max-concurrency |
| GET | `/api/v1/assist/outbound-calls/metrics` | Grouped status counts + capacity |
| POST | `/api/v1/assist/outbound-calls/cancel/:id` | Cancel queued attempt |
| GET | `/api/v1/assist/analytics` | 30-day KPI series (daily_summaries) |
| GET | `/api/v1/assist/calls` | Call history + transcripts |

### Voice routes (SignalWire/Twilio cXML)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/voice/incoming` | Inbound call webhook → TwiML or Retell handoff |
| POST | `/api/v1/voice/turn` | Voice conversation turn → TwiML response |
| POST | `/api/v1/voice/status` | Call status callback → retry scheduling |
| POST | `/api/v1/voice/outbound/twiml` | Outbound call TwiML |
| POST | `/api/v1/voice/register-call` | Retell inbound registration |

### Retell routes (HMAC-SHA256 verified)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/retell/call-events` | Call lifecycle events (async queued) |
| POST | `/api/v1/retell/transcript-events` | Transcript events (async queued) |
| WS | `/api/v1/retell/llm-websocket` | Custom LLM WebSocket for Retell |
| POST | `/api/v1/retell/tools/get-business-context` | Tool: tenant context |
| POST | `/api/v1/retell/tools/check-availability` | Tool: calendar slots |
| POST | `/api/v1/retell/tools/create-booking` | Tool: create appointment |
| POST | `/api/v1/retell/tools/escalate-to-human` | Tool: escalation |
| POST | `/api/v1/retell/tools/mark-do-not-contact` | Tool: add to DNC |
| POST | `/api/v1/retell/tools/log-call-outcome` | Tool: persist call result |

### SWAIG routes (SignalWire AI native)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/swaig/booking` | SWAIG booking function |
| POST | `/api/v1/swaig/faq` | SWAIG FAQ function |
| POST | `/api/v1/swaig/escalation` | SWAIG escalation function |
| POST | `/api/v1/swaig/sms` | SWAIG SMS callback |

### Tenant / billing / admin routes
| Method | Path | Description |
|---|---|---|
| GET/PATCH | `/api/v1/tenants/settings` | Tenant settings read/write |
| PATCH | `/api/v1/tenants/onboarding` | Save onboarding data + mark complete |
| PATCH | `/api/v1/tenants/settings/missed-call-auto-send` | Toggle auto missed-call SMS |
| GET/PATCH | `/api/v1/tenants/users` | Team member list + role/access management |
| GET | `/api/v1/billing/subscription` | Current subscription state |
| POST | `/api/v1/billing/checkout-session` | Stripe checkout redirect |
| POST | `/api/v1/billing/portal-session` | Stripe billing portal redirect |
| POST | `/webhooks/stripe` | [public] Stripe webhook — entitlement authority |
| POST | `/api/v1/admin/me` | Master-admin self-check |
| GET | `/api/v1/admin/tenants` | Cross-tenant list |
| PATCH | `/api/v1/admin/tenants/:id/access` | Override tenant access |
| PATCH | `/api/v1/admin/users/:id/role` | Change user role |
| GET | `/api/v1/events/stream` | SSE real-time event stream |
| POST | `/webhooks/nightly/ingest` | Cron: nightly lead discovery |
| POST | `/webhooks/morning/digest` | Cron: morning digest + daily_summaries |

---

## 7. Queue Workers

6 BullMQ workers, each a separate Railway service:

| Worker | Queue | Concurrency | What it does |
|---|---|---|---|
| `researchWorker` | `research` | default | Calls `runResearch()` → prospects_enriched; dead-letters on perm failure |
| `outreachWorker` | `outreach` | default | Calls `runOutreach()` → message_attempts pending_approval |
| `replyTriageWorker` | `reply-triage` | default | Calls `runReplyTriage()` → DNC on unsubscribe |
| `outboundCallWorker` | `outbound-call` | default | Checks pause/DNC/capacity → SignalWire or Retell dial; retry scheduling |
| `webhookWorker` | `webhook` | 5 | Processes voice status + Retell event payloads async; idempotency via Redis TTL |
| `anomalyDetectionWorker` | varies | default | Detects pipeline anomalies; logs to audit_logs |

Railway start commands:
```
pnpm --filter @qyro/queue worker:research
pnpm --filter @qyro/queue worker:outreach
pnpm --filter @qyro/queue worker:reply-triage
pnpm --filter @qyro/queue worker:outbound-call
pnpm --filter @qyro/queue worker:webhook
```

---

## 8. AI Agents

All agents go through `packages/agents/src/runner.ts` → quota check → OpenAI → log to `usage_events`.

| Agent | File | Model | Used by |
|---|---|---|---|
| Lead Discovery | `leadDiscovery.ts` | cheap | leads route, nightly ingest |
| Research | `research.ts` | cheap | research worker |
| Outreach | `outreach.ts` | cheap | outreach worker |
| Reply Triage | `replyTriage.ts` | cheap | reply-triage worker |
| Booking | `booking.ts` | standard | clientAssistant, voiceAssistant |
| Client Assistant | `clientAssistant.ts` | cheap (→ standard) | assist chat endpoint |
| Voice Assistant | `voiceAssistant.ts` | cheap (→ standard) | voice turn route |
| Email Enrichment | `emailEnrichment.ts` | n/a (API calls) | leadDiscovery |
| QA Guardrail | `qa.ts` | cheap | outreach agent |

### Calendar adapters (not agents but part of the booking flow)
`packages/agents/src/calendars/` — `CalendarAdapter` interface with `calCom.ts` and `googleCalendar.ts` implementations. Factory loaded from `tenant.metadata.calendarProvider`.

### Model tiers
```
cheap    → gpt-4o-mini   ($0.15/1M input, $0.60/1M output)
standard → gpt-4o        ($2.50/1M input, $10/1M output)
premium  → claude-sonnet-4-6  (premium plan only)
```

### Per-plan daily token limits
```
starter → 50K input / 20K output / day
growth  → 200K input / 80K output / day
agency  → 800K input / 300K output / day
```

---

## 9. Entitlement Model

Product access (`lead: boolean`, `assist: boolean`) is resolved by `apps/api/src/lib/entitlements.ts` from four layered sources (highest wins):

1. **Per-user overrides** — `tenant.metadata.user_product_access[userId]`
2. **Billing override** — `tenant.metadata.billing_override_access`
3. **Active subscription** — `tenant_subscriptions` table (Stripe as authority)
4. **Trial access** — `tenant.metadata.trial_*` fields

**Default posture:** `{ lead: false, assist: false }` when no entitlement source exists.

**Master admin** (identified by Clerk user ID or email match in env) bypasses all entitlement checks and gets `{ lead: true, assist: true }`.

**Stripe webhook** (`POST /webhooks/stripe`) is the authoritative trigger for subscription lifecycle. Events handled: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`.

---

## 10. Voice Architecture

### Phone number model
Bring-Your-Own-Number (BYON): clients forward their existing business number to a SignalWire number provisioned in QYRO. No number porting required. QYRO handles the AI conversation and forwards calls to staff when escalation is needed.

### Voice runtime modes (per tenant)
```
tenant.metadata.voice_runtime = "signalwire"  ← TwiML Say/Gather loop (default)
tenant.metadata.voice_runtime = "retell"      ← Retell AI runtime handoff
```

### Inbound call flow (SignalWire + Retell)
```
1. Customer calls forwarded number
2. POST /api/v1/voice/incoming
   → Look up tenant by voice_number
   → Create call_attempts + assistant_session
   → If voice_runtime=retell: POST to Retell register-call API → return TwiML redirect
   → If voice_runtime=signalwire: TwiML Say + Gather → /api/v1/voice/turn loop
3. Retell AI drives conversation, calls QYRO tool endpoints for business context
4. QYRO persists call state, transcript, recordings
5. On escalation: TwiML Dial to staff + SMS/email notification
```

### Outbound call flow
```
1. POST /api/v1/assist/outbound-calls/enqueue (creates call_attempts row)
2. outboundCallWorker picks up:
   → Check pause/global pause
   → Check DNC list
   → Check capacity (active calls < maxConcurrentCalls)
   → Dial via SignalWire REST (or Retell create-call if voice_runtime=retell)
3. Status callbacks → /api/v1/voice/status
   → Schedule retries at 15min/2hr/1day/3day for no-answer/busy
4. DND captured during call → added to do_not_contact immediately
```

### SWAIG (alternative)
SignalWire's native AI function calling system. A separate route surface at `/api/v1/swaig/` exposes booking, FAQ, escalation, and SMS functions. Multi-provider calendar adapter added 2026-04-10. Operates independently of the Retell runtime path.

---

## 11. Deployment Topology

### Production
| Service | Platform | Notes |
|---|---|---|
| Web app | Vercel | git push origin main = auto-deploy; project `prj_C4gIk9spUIqDKCQblnCJtNLlmlrJ` |
| API | Railway | Node.js Express; port 3001; health endpoint at /health |
| research worker | Railway | Separate service; `pnpm --filter @qyro/queue worker:research` |
| outreach worker | Railway | Separate service |
| outbound-call worker | Railway | Separate service |
| webhook worker | Railway | Separate service |
| Postgres | Railway | Managed Postgres |
| Redis | Railway | Managed Redis |
| nightly-ingest cron | Railway | `node apps/crons/dist/nightly-ingest.js`; 22:00 PT |
| morning-digest cron | Railway | `node apps/crons/dist/morning-digest.js`; 07:00 PT |

### Deploy method
Push to `main` branch triggers Vercel auto-deploy for web. Railway services auto-deploy on push (configured per service in Railway dashboard).

No `vercel.json` — using Vercel defaults. No manual deploy step needed.

### Environment variables
Each service has its own set. Key vars:

```
# Core
DATABASE_URL         REDIS_URL           OPENAI_API_KEY
CLERK_SECRET_KEY     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# Voice
SIGNALWIRE_PROJECT_ID   SIGNALWIRE_API_TOKEN   SIGNALWIRE_SPACE_URL
RETELL_API_KEY          RETELL_AGENT_ID_DEFAULT  RETELL_WEBHOOK_SECRET

# Billing
STRIPE_SECRET_KEY    STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ASSIST_STARTER   STRIPE_PRICE_ASSIST_GROWTH
STRIPE_PRICE_LEAD_STARTER     STRIPE_PRICE_LEAD_GROWTH
STRIPE_APP_BASE_URL

# Crons
API_URL              WEBHOOK_SECRET

# Email / enrichment
RESEND_API_KEY       EMAIL_FROM
APOLLO_API_KEY       CAL_API_KEY

# Admin
MASTER_ADMIN_CLERK_ID   MASTER_ADMIN_EMAIL
INTERNAL_TENANT_ID      OUTBOUND_VOICE_GLOBAL_PAUSED
```

---

## 12. User Signup and Onboarding Flow

As of 2026-04-10, new signups go through automated onboarding:

```
1. User hits /sign-up → Clerk creates account
2. Root page redirects signed-in users to /products
3. /products fetches GET /api/v1/tenants/settings:
   → First API call triggers tenant auto-provisioning in tenant.ts middleware
     (creates tenant with onboarding_complete: false in metadata)
   → If onboardingComplete === false → redirect to /onboarding
4. /onboarding (4-step client-side page):
   Step 0: Product selection (QYRO Assist vs Lead — Lead is "coming soon")
   Step 1: Business info (name, industry, phone, timezone)
   Step 2: AI setup (description, services, greeting)
   Step 3: Done (call-forwarding instructions + "Go to dashboard")
5. PATCH /api/v1/tenants/onboarding saves all data + sets onboarding_complete: true
6. User redirected to /client/dashboard (Assist) or /internal/dashboard (Lead)
```

**Existing tenants are unaffected:** the onboarding gate only fires when `metadata.onboarding_complete === false` (explicitly false, not missing/null).

---

## 13. Real-Time Events

SSE stream at `GET /api/v1/events/stream` (authenticated, tenant-scoped).

Events published via Redis pub/sub (`packages/queue/src/realtime.ts`):
- `new_lead` — new prospect ingested
- `call_status_change` — call attempt status updated
- `pending_approval` — new message awaiting approval
- `escalation` — call escalation triggered

Frontend subscribes with 30s ping heartbeat and auto-reconnect. Dashboard shows live toasts for pending approvals and escalations.

---

## 14. Security Model

| Concern | Mechanism |
|---|---|
| Authentication | Clerk JWT bearer tokens on all protected API routes |
| Tenant isolation | Application-level `tenant_id` scoping (every query) + Postgres RLS policies (migration 0001) |
| Voice webhook verification | `x-signalwire-signature` HMAC on voice routes |
| Retell webhook verification | `x-retell-signature` HMAC-SHA256 on raw request body |
| SWAIG verification | SWAIG-specific auth in `validateSwaigRequest` middleware |
| Widget rate limiting | Redis INCR/EXPIRE per tenant+IP (survives restarts); origin allowlist via `widget_allowed_origins` |
| DEV bypass protection | `DEV_BYPASS_AUTH=true` throws at startup if `NODE_ENV=production` |
| Master admin | Identified by Clerk user ID or email match in env vars; bypasses billing checks |
| Outbound compliance | DNC check + tenant pause check + capacity check before every dial |
| Data minimization | Call recordings retained 90 days; exports auto-delete after 30 days |

---

## 15. Known Gaps and Open Items

### P1 — Important, fix before broad client rollout

| Gap | Notes |
|---|---|
| In-memory rate limiter on chat endpoint | Resets on server restart; acceptable for single-instance, replace before horizontal scaling |
| Clerk webhooks not implemented | `user.created` not handled; current first-login provisioning works but has no email/name capture from Clerk |
| Cal.com webhooks not implemented | Booking confirmations not pushed back to QYRO |
| RLS policies need verification | Migration 0001 adds them but production execution must be confirmed |
| SWAIG calendar adapter | Multi-provider added 2026-04-10; needs E2E testing with real SignalWire setup |
| Retell live receptionist scenarios | 10 benchmark scripts must be run against real PSTN before pilot tenant |

### P2 — Nice to have, Phase 3+

| Gap | Notes |
|---|---|
| Self-serve tenant onboarding | Onboarding flow now built, but Stripe checkout not wired in-flow (billing still via /products) |
| Calendly / Square Appointments adapters | Phase 3 per QYRO_ASSIST_INSTRUCTIONS.md |
| promptHygiene agent | Specced in AGENTS.md but never built |
| Session P (polish + mobile) | Dashboard stat placeholders; general mobile pass |
| Anomaly detection | `anomalyDetectionWorker.ts` exists but undocumented; confirm behavior and alerting targets |
| Postgres RLS — admin pool | `adminDb` bypasses RLS by design but admin routes need careful review |

### Compliant but worth noting
| Item | Status |
|---|---|
| Email outbound | Active; QA Guardrail + human approval gate + DNC check |
| SMS outbound | Active (missed-call follow-up); implied consent, STOP keyword handled |
| Voice inbound | Active; AI disclosure required per COMPLIANCE.md |
| Voice outbound (cold) | Blocked until COMPLIANCE.md gate satisfied (legal review + consent infrastructure) |

---

## 16. Key Architecture Decisions (Summary)

Full ADRs in `docs/DECISIONS.md`. Summary of most impactful:

| ADR | Decision |
|---|---|
| ADR-002 | Drizzle ORM over Prisma — TS-first, closer to SQL, better RLS |
| ADR-003 | Dual tenant isolation: RLS + application-level WHERE clauses |
| ADR-004 | gpt-4o-mini as default model; gpt-4o for booking/complex; claude-sonnet-4-6 for premium |
| ADR-007 | Two products on one platform, separated by tenant_type |
| ADR-009 | Google Places API is sole lead search source; Apollo for email enrichment only |
| ADR-013 | Subscription-first entitlement model; billing-first default (no access without sub) |
| ADR-014 | Stripe webhooks are the authoritative entitlement synchronization trigger |
| ADR-017 | SignalWire as primary cXML telephony transport |
| ADR-018 | Provider-neutral DB field names: `voice_number`, `call_sid` |
| ADR-019 | Master-admin role bypasses billing-gated UX for platform operations |
