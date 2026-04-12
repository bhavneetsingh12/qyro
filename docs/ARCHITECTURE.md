# QYRO Architecture Reference
_Last updated: 2026-04-11_
_Canonical architecture document. If this file and another narrative doc disagree, trust the code first, then update this file._

## 1. Platform Summary

QYRO is one multi-tenant platform serving two product surfaces:

| Product | Tenant type | Current role |
|---|---|---|
| QYRO Lead | `internal` today, future `lead_engine` | Internal lead discovery, research, outreach drafting, approvals, and operator workflows |
| QYRO Assist | `assistant` | Public-facing customer assistant with chat, voice, booking, approvals, dashboards, and billing-backed access |

Both products share:
- one monorepo
- one API
- one Postgres database
- one Redis/queue layer
- one auth model
- one billing model

Tenant isolation is enforced by:
- explicit tenant-aware request middleware
- per-request tenant context in the DB client
- RLS policies in Postgres as defense in depth

## 2. Runtime Topology

```text
Vercel
  Next.js web app
    public marketing
    onboarding
    internal portal
    client portal

Railway
  Express API
    auth
    tenant scoping
    public ingress
    billing
    voice
    SSE

Railway
  BullMQ workers
    research
    outreach
    reply triage
    outbound call
    webhook
    anomaly detection

Railway
  Cron services
    nightly-ingest
    morning-digest

Railway
  Postgres + Redis
```

## 3. External Services

| Concern | Service | Notes |
|---|---|---|
| Auth | Clerk | Session/auth identity for web and API |
| Billing | Stripe | Checkout, portal, webhook-driven entitlements |
| AI | OpenAI | `gpt-4o-mini` default, `gpt-4o` for higher-complexity paths |
| Voice transport | SignalWire | Signed voice callbacks and SWAIG |
| Calendar | Cal.com, Google Calendar | Adapter-based booking integrations |
| Email | Resend | Transactional email |
| Lead source | Google Places API (New) | Primary lead discovery source |
| Enrichment | Apollo, Hunter | Email/domain enrichment only |

Retell is decommissioned and is not part of the active architecture.

## 4. Repository Structure

```text
qyro/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── lib/
│   │       ├── middleware/
│   │       └── routes/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       └── config/
│   └── crons/
│       ├── nightly-ingest.ts
│       └── morning-digest.ts
├── packages/
│   ├── agents/
│   ├── db/
│   ├── prompts/
│   ├── queue/
│   └── workers/
├── docs/
└── infra/
```

## 5. API Surface

The live mount points are defined in `apps/api/src/index.ts`.

### Public/provider routes

| Route prefix | Purpose | Protection |
|---|---|---|
| `/health` | Health check | none |
| `/webhooks/*` | Stripe + internal cron webhooks | route-specific secret/signature checks |
| `/api/v1/voice/*` | SignalWire voice callbacks | `validateSignalWireSignature` |
| `/api/v1/swaig/*` | SignalWire AI Agent function calls | `validateSwaigRequest` |
| `/api/v1/assist/*` | Public widget/missed-call ingress | IP-based fail-closed rate limiting |
| `/api/v1/pricing` | Public pricing | IP-based fail-closed rate limiting |

### Authenticated routes

| Route prefix | Purpose |
|---|---|
| `/api/leads/*` | Lead discovery, ingest, research, export, outreach |
| `/api/campaigns/*` | Campaign CRUD, queue, approval/rejection |
| `/api/sessions`, `/api/appointments`, `/api/v1/assist/*` | Assist dashboards, calls, approvals, outbound control, analytics |
| `/api/v1/tenants/*` | Settings, onboarding, users, FAQ |
| `/api/v1/events/*` | SSE stream |
| `/api/v1/billing/*` | Billing portal, checkout state, subscription details |
| `/api/v1/admin/*` | Master-admin controls |

## 6. Voice Architecture

QYRO currently has two active voice paths:

### Path A: Signed SignalWire webhook/TwiML flow
- `POST /api/v1/voice/incoming`
- `POST /api/v1/voice/turn`
- `POST /api/v1/voice/outbound/twiml`
- `POST /api/v1/voice/status`

This path handles:
- inbound greeting and turn handling
- outbound callback/campaign dialing
- transcript/recording capture
- escalation handoff

### Path B: SignalWire AI Agent via SWAIG
- `POST /api/v1/swaig/business-info`
- `POST /api/v1/swaig/book-appointment`
- `POST /api/v1/swaig/escalate`
- `POST /api/v1/swaig/callback-sms`

This path handles:
- provider-managed conversational voice
- QYRO-managed business actions
- appointment booking and escalation hooks

Retell is not active, not routed, and should not be documented as current runtime.

Operational guidance for how chat, voice, booking, and calendar control are intended to converge lives in `docs/ASSIST_OPERATIONS.md`.

## 7. Scheduling and Automation

Scheduled operations are code-first and run via Railway cron services:

| Job | File | Purpose |
|---|---|---|
| Nightly ingest | `apps/crons/nightly-ingest.ts` | Trigger overnight lead discovery / drafting |
| Morning digest | `apps/crons/morning-digest.ts` | Trigger daily summary generation |

Legacy `infra/n8n/` assets are historical only and are not part of the active execution path.

## 8. Database Model

Key tables:

| Table | Purpose |
|---|---|
| `tenants` | Tenant identity, voice number, metadata, state flags |
| `tenant_integration_secrets` | Tenant provider credentials, stored encrypted at the application layer |
| `users` | Tenant users and roles |
| `tenant_subscriptions` | Stripe-backed access state |
| `prospects_raw` | Lead inputs |
| `prospects_enriched` | Research outputs |
| `outreach_sequences` | Campaign definitions |
| `message_attempts` | Drafts, approvals, sends, replies |
| `call_attempts` | Inbound/outbound call records |
| `assistant_sessions` | Chat/voice sessions |
| `appointments` | Booking records |
| `daily_summaries` | Analytics snapshots |
| `audit_logs` | Operator/system audit trail |
| `rate_limit_hits` | Abuse logging |
| `webhook_events` | Webhook event recording/dedup support |

## 9. Current Hardening Gaps

These are the highest-value remaining architecture tasks:

1. Run the one-off `pnpm backfill:tenant-secrets --apply` command in each deployed environment so legacy plaintext rows in `tenant_integration_secrets` are encrypted at rest.
2. Route naming is inconsistent between `/api/*` and `/api/v1/*`.
3. Test coverage is still thin relative to platform risk.
4. Build artifacts and generated files can drift away from `src/` and confuse review.

## 10. Architecture Rules

1. Docs must follow code. Do not preserve obsolete architecture stories for convenience.
2. Public ingress must either be provider-signed, secret-authenticated, or fail-closed rate-limited.
3. New tenant-scoped features must use the tenant middleware and the shared DB client.
4. New LLM calls must go through `packages/agents/src/runner.ts`.
5. New scheduled behavior should use code-first cron services, not n8n.
6. Chat, voice, and booking flows should converge on shared orchestration services rather than separate channel-specific logic.
