# QYRO Architecture Blueprint
_Last updated: 2026-03-30 | Owner: Bhavneet Singh / Zentryx LLC_

## Two products, one platform

```
┌─────────────────────────────────────────────────────────────────┐
│                      SHARED PLATFORM                            │
│         Postgres · Redis · n8n · Node API · Auth · Billing      │
├───────────────────────────┬─────────────────────────────────────┤
│     QYRO Lead             │         QYRO Assist                 │
│  (internal → sell later)  │      (sell this first)              │
│                           │                                     │
│  Lead Discovery Agent     │  Client Assistant Agent             │
│  Research Agent           │  Booking Agent                      │
│  Outreach Agent           │  Reply Triage Agent                 │
│  Reply Triage Agent       │  QA Guardrail Agent                 │
│  Booking Agent            │  Missed-call follow-up              │
│  QA Guardrail Agent       │  Website widget                     │
│                           │                                     │
│  tenant_type: "internal"  │  tenant_type: "assistant"           │
│  tenant_type: "lead_engine"  (Phase 4+)                         │
└───────────────────────────┴─────────────────────────────────────┘
```

**QYRO Lead** — finds businesses, researches them, runs outreach, books calls.
Bhavneet uses this to find QYRO Assist clients. Later sold to agencies/sales teams.

**QYRO Assist** — sits inside a client's business. Handles their customer
interactions: website chat, missed-call SMS, FAQ, appointment booking.
This is the immediate revenue product.

They share agents where it makes sense (Reply Triage, Booking, QA).
They have separate prompt packs, separate workflows, separate dashboards.

---

## Tenant type routing

Every tenant has a `tenant_type` field. API routes and frontend pages check
this to determine which features are available.

```typescript
// What each tenant type can access
const PRODUCT_ACCESS = {
  internal:    ["lead_discovery", "research", "outreach", "reply_triage", "booking"],
  assistant:   ["client_assistant", "missed_call", "faq", "booking", "reply_triage"],
  lead_engine: ["lead_discovery", "research", "outreach", "reply_triage", "booking"],
  both:        ["all"],
} as const;
```

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Phase 2+ — QYRO Assist client portal |
| Backend API | Node.js + TypeScript + Express | REST + webhook ingestion |
| Database | Postgres (Supabase or Neon) | RLS for tenant isolation |
| Cache / Queue | Redis + BullMQ | job queues + research cache |
| Object Storage | Azure Blob or S3-compatible | recordings, exports, prompt packs |
| Orchestrator | n8n Cloud (queue mode) | workflows, retries, approval gates |
| Auth | Clerk | multi-tenant, RBAC |
| Billing | Stripe | Phase 2+ for QYRO Assist |
| AI | OpenAI (tiered) | see TOKEN_BUDGET.md |
| Voice | Twilio | Phase 5 only |
| Calendar | Cal.com | booking + reschedule |
| CRM | HubSpot | contact sync |
| Lead sources | Apollo API + Google Places API | no scraping |

---

## Repository structure

```
qyro/
├── CLAUDE.md                    ← Claude Code reads this first every session
├── .claudeignore
├── .env.example
├── package.json                 ← pnpm workspace root
│
├── apps/
│   ├── web/                     ← Next.js 14 — Phase 2+ (QYRO Assist portal)
│   └── api/                     ← Node/Express API — Phase 1+
│       └── src/
│           ├── middleware/
│           │   ├── tenant.ts    ← scopes every request to tenant + checks tenant_type
│           │   ├── auth.ts
│           │   └── quota.ts
│           ├── routes/
│           │   ├── leads.ts          ← QYRO Lead routes
│           │   ├── campaigns.ts      ← QYRO Lead routes
│           │   ├── assistant.ts      ← QYRO Assist routes (Phase 2)
│           │   ├── webhooks.ts
│           │   └── billing.ts        ← Phase 2
│           └── index.ts
│
├── packages/
│   ├── db/
│   │   ├── schema.ts            ← ALL tables — tenant_id + tenant_type on tenants
│   │   ├── migrations/
│   │   └── client.ts
│   │
│   ├── agents/
│   │   └── src/
│   │       ├── budget.ts
│   │       ├── runner.ts
│   │       ├── compact.ts
│   │       └── agents/
│   │           ├── leadDiscovery.ts   ← QYRO Lead
│   │           ├── research.ts        ← QYRO Lead
│   │           ├── outreach.ts        ← QYRO Lead
│   │           ├── replyTriage.ts     ← shared
│   │           ├── booking.ts         ← shared
│   │           ├── clientAssistant.ts ← QYRO Assist (Phase 2)
│   │           ├── qa.ts              ← shared
│   │           └── promptHygiene.ts   ← shared
│   │
│   ├── prompts/
│   └── queue/
│
├── docs/
│   ├── BLUEPRINT.md
│   ├── DECISIONS.md
│   ├── AGENTS.md
│   ├── TOKEN_BUDGET.md
│   ├── ENVIRONMENTS.md
│   ├── COMPLIANCE.md
│   └── PROMPTS/
│       ├── lead/                ← QYRO Lead prompt packs
│       │   └── medspa_missed_call_v1.md
│       └── assist/              ← QYRO Assist prompt packs (Phase 2)
│
└── infra/
    ├── docker-compose.yml
    └── n8n/workflows/
```

---

## Architecture diagram

```
[ QYRO Lead UI — Phase 4 ]    [ QYRO Assist Portal — Phase 2 ]
           |                              |
           └──────────────┬───────────────┘
                          v
              [ Node/TS API Backend ]
                          |
              ┌───────────┼────────────┐
              v           v            v
         [Postgres]    [Redis]   [Object Storage]
              |           |
              └─────┬─────┘
                    v
           [ n8n Orchestrator ]
                    |
        ┌───────────┼────────────┐
        v           v            v
   [Lead agents] [Assist agents] [Shared agents]
   Discovery     ClientAssistant  ReplyTriage
   Research      MissedCall       Booking
   Outreach      FAQ              QA
        |           |
        └─────┬─────┘
              v
        [OpenAI API]
        [Apollo API]
        [Places API]
        [Cal.com]
        [Twilio — Phase 5]
```

---

## Build phases (detailed)

### Phase 1 — QYRO Lead, internal (CURRENT)
**What:** Backend only. Bhavneet runs the lead engine for himself.
**Tenant:** Single hardcoded tenant (tenant_type: "internal")
**No:** frontend UI, billing, self-serve, Client Assistant
**Agents to build:** leadDiscovery, research, outreach, replyTriage, booking
**Workflows in n8n:** lead ingestion, research queue, outreach approval, reply handling

### Phase 2 — QYRO Assist, multi-tenant
**What:** The product Bhavneet sells to local businesses.
**Tenant type:** "assistant"
**Build:** Next.js portal, client widget (embeddable JS), Stripe billing, manual onboarding
**Agents:** clientAssistant, missed-call follow-up (reuse outreach + replyTriage)
**Prompt packs:** docs/PROMPTS/assist/

### Phase 3 — QYRO Assist productization
Self-serve onboarding, niche template library, analytics dashboard,
white-label option for agencies.

### Phase 4 — QYRO Lead as a product
Add tenant_type: "lead_engine". Build onboarding, billing, UI for it.
All backend agents already exist from Phase 1 — just expose them via UI.
Separate landing page and pricing from QYRO Assist.

### Phase 5 — Voice
Inbound missed-call callback first. Requires COMPLIANCE.md gate.
TCPA + state legal review required before any outbound voice.

---

## Tenant isolation rules
1. Every table has tenant_id
2. Postgres RLS policies enforce this at DB level
3. Tenant middleware sets context on every request
4. tenant_type checked on routes that are product-specific
5. Never bypass RLS except in explicit admin operations

---

## Human approval gates (never remove)
- New outbound sequence activation
- First outbound to any new segment
- Voice script changes
- Billing / plan changes
- Exports above threshold
- Prompt pack promotion to status: approved
