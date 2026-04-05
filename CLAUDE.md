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
**Phase 2 — COMPLETE. Phase 3 — Stripe Billing + Self-Serve Onboarding (NEXT)**

Phase 1 (QYRO Lead backend) is complete. Phase 2 (QYRO Assist product) is complete.
P0/P1 critical fixes have been documented (see QYRO_P0_FIXES.md).
Phase 3 will add Stripe billing, self-serve onboarding, and admin controls.

### April 2026 shipping updates
Recent working changes now in the codebase:

```
[x] Clerk first-login auto-provisioning for users/tenants
[x] Duplicate first-login race fix on users.clerk_id unique constraint
[x] Default plan bootstrap + starter fallback for quota checks
[x] Client Call Control center with enable/disable, pause/resume, manual queue
[x] Bulk handoff from QYRO Lead -> QYRO Assist for outbound calls and outreach
[x] Product entitlement gating via tenant metadata.product_access
[x] /client/outbound-pipeline page showing queued outbound leads + statuses
[x] Direct contact add/import flow in outbound pipeline (CSV/paste rows)
[x] Lead page hydration fix after nested form regression
```

Operational notes:

```
- Outbound queueing is blocked unless /api/v1/assist/outbound-calls/control has enabled=true
- Local dev can silently break if macOS AppleDouble files (._*) leak into apps/web/.next
- If Next chunks 404 locally, clean apps/web/.next and restart the web dev server from repo root

### April 5, 2026 shipping log (traceability)
All items below were implemented and deployed across API/web/DB.

```
[x] Outbound call_attempts schema compatibility: proactive information_schema detection in assist routes
[x] Legacy-safe call_attempts insert path to avoid Drizzle emitting missing columns on older DB shape
[x] Outbound call pipeline refresh UX fix: explicit manual refreshing state + button spinner behavior
[x] Cross-product switching links in both sidebars for tenants with dual access (Lead + Assist)
[x] Billing foundation: Stripe checkout, billing portal, and webhook ingestion routes
[x] Subscription persistence: tenant_subscriptions table + migration 0004_billing_subscriptions.sql
[x] Product access resolution now prefers subscription record over metadata fallback
[x] Billing-first entitlement default changed to { lead: false, assist: false } when no access exists
[x] Products page billing actions added: unlock Lead, unlock Assist, unlock Bundle, manage billing
[x] Stripe checkout UX update: custom submit message to reduce blank/unclear checkout context
[x] Public marketing entrypoint added at / (signed-out users now see landing page)
[x] Middleware updated to keep / public while protecting app routes
[x] Product selector sign-out added so users are never trapped before choosing a product
[x] Landing page upgraded with Product/Solutions/Pricing sections and improved nav/CTA structure
```

Production configuration work completed during the same window:

```
[x] Stripe env wiring on API service: secret key, webhook secret, price IDs, app base URL
[x] Migration 0004 executed in production Postgres
[x] Clerk production key rollout completed (web + API)
[x] End-to-end checkout completed: product unlock confirmed after webhook processing
```

Follow-up scheduled for next morning:

```
[ ] Twilio setup pass (phone numbers, env vars, webhooks)
[ ] P1 optimization: replace JS tenant scan in voice number resolution with indexed DB lookup
```
```

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

### Phase 2 — COMPLETE
Core platform and both portals (internal + client) are production-ready.
All voice inbound and outbound call infrastructure complete.

```
[x] Session J — Next.js setup + auth routing + shared layout
[x] Session K — Internal dashboard home + lead inbox
[x] Session L — Lead detail + campaign manager
[x] Session M — Approval queue
[x] Session N — Client portal home + conversation inbox
[x] Session O — Client settings + widget embed
[x] Session AA — Calendar adapters (Google + Cal.com)
[x] Session AB — Client Assistant agent (text)
[x] Session AC — Voice Assistant agent
[x] Session AD — Voice routes (Twilio inbound)
[x] Session AE — Assist API expansion (outbound queue + controls)
[x] Session AF — Assist prompt packs (FAQ, SMS, email, voice)
[x] Session AG — Widget JavaScript (embeddable chat)
[x] Session AH — Client portal updates (calls/approvals/settings/call-control)
[x] Session AI — Assist E2E test script
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
- Do not build self-serve onboarding or billing UI before Phase 3 is scheduled
- Do not build tenant_type "lead_engine" or "both" until Phase 4
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
- **Claude Code preference**: Use Haiku 4.5 for simple bug fixes, doc updates, and one-line changes to save tokens

---

## Known remaining issues

### P0 Critical — ALL FIXED (2026-04-05 audit)
All P0 issues from QYRO_P0_FIXES.md have been resolved:
[x] 1. Widget chat public endpoint — assistPublicRouter mounted correctly
[x] 2. Session UUID in greeting — removed
[x] 3. Inbound sessionId in TwiML action URL — passing ?sessionId=
[x] 4. Signature verification — validateSignalWireSignature applied to voice routes
[x] 5. Voice memory between turns — history loaded/saved via conversationHistory
[x] 6. Wrong session type — voice_inbound used correctly
[x] 7. Widget channel — channel: "chat" set correctly
[x] 8. Missing env vars — .env.example updated with all vars incl. SignalWire, master admin, API_URL
[x] 9. DEV_BYPASS_AUTH in production — guard added to both requireClerkAuth and tenantMiddleware
[x] 10. Port mismatch — defaults to 3001

Security fixes also applied (2026-04-05 audit):
[x] invoice.payment_failed Stripe webhook — now revokes access on failed payments
[x] icon.svg added (was referenced in layout.tsx but missing)
[x] stripe product assets committed (were untracked, would not deploy)
[x] Terms of service page (/terms) added
[x] Privacy policy page (/privacy) added
[x] Sign-up page (/sign-up) added

### P1 Important (Phase 3)
- Rate limiting on chat endpoint is in-memory only — resets on server restart (acceptable for single-instance dev, upgrade before scaling)
- Self-serve tenant onboarding not built (manual onboarding only)
- Clerk webhooks not implemented (user lifecycle sync)
- Cal.com webhooks not implemented (booking confirmation)
- Calendly / Square Appointments adapters not built

### P2 Nice-to-have (Phase 3+)
- Session P (polish + mobile UI refinement)
- Lead engine as product (Phase 4)
- Additional calendar integrations

---

## Project Status Addendum (2026-04-03)

This addendum records what has already been completed, what was recently updated,
and what phase is next. Existing content above remains the source memory and is unchanged.

### Completed phase record

Phase 1 — QYRO Lead (internal)
- COMPLETE (A through I complete)

Phase 2 — QYRO Assist buildout
- COMPLETE for implemented Assist sessions:
  - Session AA — Calendar adapters
  - Session AB — Client Assistant agent
  - Session AC — Voice Assistant agent
  - Session AD — Voice routes
  - Session AE — Assist API expansion
  - Session AF — Assist prompt packs
  - Session AG — Widget JavaScript
  - Session AH — Client portal updates (calls/approvals/settings)
  - Session AI — Assist E2E script

### Summary of what we updated recently

- Added clear product split entry routes so Lead and Assist behave as separate products:
  - `/products` product chooser
  - `/lead` entry route to Lead portal
  - `/assist` entry route to Assist portal
- Updated root route behavior to send signed-in users to `/products` instead of auto-routing to Lead.
- Confirmed web app and API local runtime alignment and validated health endpoint.
- Kept current architecture as one shared platform with two distinct product surfaces.

### Current known state (high level)

- QYRO Lead and QYRO Assist are both usable under the same stack.
- Outbound AI voice calling is not yet implemented as an automated campaign pipeline.
- Compliance gate for outbound voice remains mandatory before broad enablement.

### Next phase to start

Phase 5A — Outbound calls (controlled rollout)

Scope for next phase:
1. Tenant-level outbound voice feature flag and mode selection.
2. Outbound call queue + worker with retry pipeline for no-answer/busy outcomes.
3. DND enforcement: if requested, immediately block future calls and remove from retry pipeline.
4. Call status lifecycle tracking in DB for every attempt.
5. Booking result capture from calls (meeting/appointment status linked to call attempt).
6. Human approval and compliance checks before dial in initial rollout.

Guardrails for Phase 5A:
- Start with callback-only or explicit-consent numbers first.
- No uncontrolled cold outbound AI voice until compliance checklist is satisfied.
- Every outbound dial must pass DNC and compliance validation at dial time.

---

## Implementation Addendum (2026-04-03, Outbound + Phase B Kickoff)

This addendum records work completed after the prior status block.
No prior sections were removed or replaced.

### Outbound implementation completed so far (Phase 5A baseline)

Backend/data updates completed:
- Added outbound call pipeline fields to `call_attempts` in schema:
  - direction, status, attempt_count, max_attempts
  - next_attempt_at, last_attempt_at, source
  - compliance_blocked_reason, booking_status, booking_ref
  - dnd_at, scheduled_by
- Added migration file:
  - `packages/db/migrations/0002_outbound_call_pipeline.sql`

Queue/worker updates completed:
- Added outbound queue definition (`OUTBOUND_CALL`) in `packages/queue/src/queues.ts`
- Added outbound worker:
  - `packages/queue/src/workers/outboundCallWorker.ts`
- Added queue script:
  - `packages/queue/package.json` → `worker:outbound-call`
- Added PM2 process:
  - `infra/pm2/ecosystem.config.cjs` → `qyro-outbound-call-worker`

API updates completed:
- Assist routes now include outbound pipeline endpoints:
  - `POST /api/v1/assist/outbound-calls/enqueue`
  - `GET /api/v1/assist/outbound-calls/pipeline`
  - `POST /api/v1/assist/outbound-calls/cancel/:callAttemptId`
- Voice routes now support outbound flow and retry/DND handling:
  - `POST /api/v1/voice/outbound/twiml`
  - `POST /api/v1/voice/status` retry scheduling
  - `POST /api/v1/voice/turn` DND intent capture + future call suppression

Validation completed:
- Outbound E2E script added:
  - `scripts/test-outbound-calls-e2e.ts`
- Script run completed with 12 passed, 0 failed in local environment.

### Product-level clarifications captured

Operational/business requirements identified for next stage:
- Admin control center to pause/resume/drain outbound calls
- Live visibility for active call load and capacity
- Multi-agent seat model (capacity scaling) and occupancy tracking
- Calendar conflict re-check before booking commit
- Billing visibility for additional agents/numbers

### Phase B status

Phase B (Admin Control + Observability) is now marked as:
- KICKOFF READY
- Next implementation batch will prioritize:
  1. Global/tenant pause-resume switches
  2. Real-time pipeline counters and active-call visibility
  3. Browser-visible admin control panel in Assist portal

---

## Implementation Addendum (2026-04-03, Phase B Admin Control + Observability)

This addendum records Phase B work completed in this session.
No prior content was removed or replaced.

### Backend controls added

Assist outbound API now includes admin control and observability routes:
- `GET /api/v1/assist/outbound-calls/control`
  - Returns tenant outbound control state (enabled/paused/reason/max concurrency)
  - Returns global pause state (`OUTBOUND_VOICE_GLOBAL_PAUSED`)
  - Returns whether current user can manage controls (owner/admin/operator)
- `PATCH /api/v1/assist/outbound-calls/control`
  - Role-gated to owner/admin/operator
  - Supports pause/resume updates, pause reason updates, max concurrency updates
  - Supports optional queue drain on pause (`drainQueued=true`) which cancels queued/retry-scheduled outbound attempts
- `GET /api/v1/assist/outbound-calls/metrics`
  - Returns grouped status counts and computed totals (queued, retry_scheduled, active, completed, dnd, blocked)
  - Returns latest outbound attempt list for operator visibility

Existing enqueue route now blocks when outbound is paused:
- `POST /api/v1/assist/outbound-calls/enqueue`
  - Returns `OUTBOUND_PAUSED` if tenant pause is active or global pause is enabled

### Worker behavior updated

Outbound worker now enforces pause controls before dialing:
- File: `packages/queue/src/workers/outboundCallWorker.ts`
- Behavior:
  - If tenant pause or global pause is active, worker does not dial Twilio
  - Attempt is set to `retry_scheduled` with pause outcome marker
  - Job is re-enqueued with delay so it can resume automatically when controls are lifted

### Client portal control center added

New Assist ops page added:
- `apps/web/src/app/(client)/client/call-control/page.tsx`
  - Live counters for queued/retry/active/completed/dnd/blocked
  - Pause/resume controls with optional queue drain
  - Max concurrent calls control
  - 15-second auto-refresh for live pipeline visibility
  - Recent outbound attempts panel

Navigation update:
- `apps/web/src/components/sidebar/ClientSidebar.tsx`
  - Added `Call Control` menu item at `/client/call-control`

### Validation summary

- Targeted diagnostics check: no new errors in modified files.
- Web lint run:
  - New Call Control page issues resolved.
  - Remaining warnings are pre-existing in other client pages (`approvals`, `calls`) and were not introduced in this session.
- API TypeScript build:
  - Still blocked by pre-existing unrelated issue in `apps/api/src/routes/webhooks.ts` (location type mismatch).
  - No new compile failures introduced by Phase B control/metrics route changes.

---

## Implementation Addendum (2026-04-03, Phase B.1 Capacity Guard)

This addendum records the capacity-throttle follow-up implemented after Phase B controls.
No prior content was removed or replaced.

### Worker-level hard concurrency guard added

Outbound worker now enforces per-tenant active-call limits before any dial attempt:
- File: `packages/queue/src/workers/outboundCallWorker.ts`
- New behavior:
  - Reads `outbound_voice_max_concurrent_calls` from tenant metadata (default 3, bounded 1..25)
  - Counts active outbound calls using statuses: `dialing`, `ringing`, `answered`
  - If active count is at/over limit:
    - does not dial Twilio
    - sets attempt to `retry_scheduled` with outcome `capacity_throttled`
    - schedules a short delayed retry (60 seconds)

This converts max concurrency from a dashboard setting into an enforced runtime guard.

### Metrics API capacity visibility added

Outbound metrics now return a `capacity` block:
- File: `apps/api/src/routes/assist.ts`
- Route: `GET /api/v1/assist/outbound-calls/metrics`
- New fields:
  - `maxConcurrentCalls`
  - `active`
  - `availableSlots`

### Call Control UI updated

Client Call Control page now displays live capacity posture:
- File: `apps/web/src/app/(client)/client/call-control/page.tsx`
- Added inline capacity strip:
  - active / max concurrent
  - available slots

### Validation summary

- Targeted diagnostics: no errors in modified files.
- Web lint: unchanged pre-existing warnings remain in `approvals` and `calls` pages.
- Queue package build script is not defined (`@qyro/queue` has no `build` script); file-level diagnostics used for compile safety in this session.

---

## Implementation Addendum (2026-04-03, Retell + Twilio Direction Locked)

This addendum records the architecture decision made after voice-quality review.
No prior content was removed or replaced.

### Architecture decision

QYRO Assist voice is now planned to move to:
- Twilio for telephony transport (numbers, PSTN, inbound/outbound call routing)
- Retell for realtime conversational voice runtime (natural speech, interruption handling, turn-taking)

Rationale:
- Better receptionist-quality voice than Twilio default `<Say>` / `<Gather>` flow
- Faster path to believable production voice behavior
- Preserves existing QYRO backend logic and operator control plane

### What remains in QYRO core (kept)

- Outbound queue and controls remain core platform capabilities
- DND/compliance/capacity controls remain enforced in QYRO
- Tenant settings and business context remain source-of-truth in QYRO
- Existing client assistant/business rule logic remains reusable via tool endpoints

### Planned implementation sequence

1. Replace inbound voice loop first with Retell-backed runtime
2. Add Retell webhook + tool endpoints in API
3. Keep Assist Call Control UI as primary operator surface
4. Switch outbound call initiation path from TwiML loop to Retell initiation
5. Run receptionist-scenario QA passes before broad client rollout

### Documentation handoff created

Implementation runbook created at project root:
- `retell_twilio_instructions.md`

This file is the execution guide for phased implementation and testing.

---

## Implementation Addendum (2026-04-05, SignalWire + Admin Control Plane)

This addendum records platform-control and voice-provider changes shipped after prior April 5 stabilization work.
No prior content was removed or replaced.

### Voice transport migration completed

Primary telephony runtime moved from Twilio-specific wiring to SignalWire cXML-compatible transport:
- Signature middleware now validates `x-signalwire-signature`
- Outbound dial path now uses SignalWire LaML REST endpoint
- API env vars switched to SignalWire set (`SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_API_TOKEN`, `SIGNALWIRE_SPACE_URL`)

### Provider-neutral schema naming completed

DB and application field naming was normalized to avoid Twilio-specific confusion:
- `tenants.twilio_number` -> `tenants.voice_number`
- `call_attempts.twilio_call_sid` -> `call_attempts.call_sid`
- App-level field names updated accordingly (`voiceNumber`, `callSid`)

Migration added:
- `packages/db/migrations/0006_rename_voice_fields.sql`

### Master admin and permissions control plane added

New admin APIs (Clerk-authenticated) added:
- `GET /api/v1/admin/me`
- `GET /api/v1/admin/tenants`
- `PATCH /api/v1/admin/tenants/:tenantId/access`
- `PATCH /api/v1/admin/users/:userId/role`

Tenant-level user management APIs added:
- `GET /api/v1/tenants/users`
- `PATCH /api/v1/tenants/users/:userId`

New entitlement resolver added:
- `apps/api/src/lib/entitlements.ts`
- Resolves paid access + billing override access + trial access + per-user access overrides

### Trial behavior now enforced at voice entry points

Inbound/outbound enforcement implemented:
- Inbound voice rejects when Assist access is not enabled
- Outbound enqueue rejects when Lead access is not enabled
- Trial call counters decrement when trial access is consumed

### New frontend control surfaces

Master admin UI:
- `/internal/admin` for cross-tenant access/trial controls

Tenant owner/admin UI:
- `/internal/team` for role, active-state, and per-user product-access management

Sidebar updates:
- Internal nav includes Admin and Team entries

### Master-admin UX behavior finalized

Master admin sessions no longer follow tenant subscription UX constraints:
- `/products` redirects master admins to `/internal/admin`
- Internal/client layouts bypass entitlement redirects for master admins
- Billing action/status UI is suppressed for master-admin session context

### SQL tracking file added

Operational SQL checklist retained at:
- `infra/sql_todo_master_admin.sql`

Purpose:
- Promote/demote master admin role safely
- Verify role changes
- Keep repeatable runbook for Railway Postgres operations

---

## Implementation Addendum (2026-04-03, Retell + Twilio Integration Slice 1)

This addendum records the first code implementation slice for the Retell migration.
No prior content was removed or replaced.

### What was implemented

New Retell API surface:
- Added `apps/api/src/routes/retell.ts`
- Added routes:
  - `POST /api/v1/retell/call-events`
  - `POST /api/v1/retell/transcript-events`
  - `POST /api/v1/retell/tools/get-business-context`
  - `POST /api/v1/retell/tools/check-availability`
  - `POST /api/v1/retell/tools/create-booking`
  - `POST /api/v1/retell/tools/escalate-to-human`
  - `POST /api/v1/retell/tools/mark-do-not-contact`
  - `POST /api/v1/retell/tools/log-call-outcome`

Security wiring:
- Added `validateRetellRequest` middleware in `apps/api/src/middleware/auth.ts`
- Mounted Retell router under signed public path:
  - `app.use("/api/v1/retell", validateRetellRequest, retellRouter)` in `apps/api/src/index.ts`

Outbound runtime migration start:
- Updated `packages/queue/src/workers/outboundCallWorker.ts`
- Worker now supports tenant runtime mode:
  - `voice_runtime = "twilio"` (existing path)
  - `voice_runtime = "retell"` (new path)
- Added Retell dialer path with API call creation and metadata linking (`tenantId`, `callAttemptId`, `prospectId`)
- Twilio path remains intact as fallback

Environment updates:
- Added Retell env placeholders in `.env.example`:
  - `RETELL_API_KEY`
  - `RETELL_AGENT_ID_DEFAULT`
  - `RETELL_WEBHOOK_SECRET`
  - `RETELL_BASE_URL`
  - `RETELL_CREATE_CALL_PATH`

Validation:
- `pnpm --filter @qyro/api build` passed after integration changes
- Queue worker file diagnostics show no errors for modified code

### Known remaining work for full migration

- Inbound telephony handoff from Twilio to Retell runtime is not yet switched in `voice.ts`
- Retell webhook signature verification currently uses shared-secret token validation; can be upgraded to provider-native signed payload verification if required
- Tool endpoints currently persist booking/availability using QYRO DB behavior and should be aligned to final provider-specific contract once Retell tool schema is finalized

---

## Implementation Addendum (2026-04-04, Retell Phase D + Security Hardening)

This addendum records the rollout-readiness and security-hardening work completed after the initial Retell migration slice.
No prior content was removed or replaced.

### Retell rollout and QA work completed

- Twilio inbound voice route now supports tenant-level Retell handoff in `apps/api/src/routes/voice.ts`
- Added a Phase D rollout harness:
  - `scripts/test-retell-phase-d.ts`
  - root script: `pnpm test:retell-phase-d`
- The harness validates:
  - inbound Retell redirect path
  - Retell call-event processing and retry scheduling
  - duplicate webhook suppression for call/transcript events
  - transcript persistence
  - business-context tool
  - availability tool
  - booking creation
  - escalation persistence
  - DND persistence
  - call-outcome persistence
- The harness also prints the 10 live receptionist benchmark scenarios that must still be run against real phone calls.

### Security hardening completed

- Retell request verification now uses HMAC-SHA256 against captured raw request bodies when `x-retell-signature` is present
- Missing raw request body now fails closed instead of silently falling back
- Retell webhook events are recorded in `webhook_events` with duplicate call/transcript payload skipping
- Unsafe phone-number-based tenant fallback was removed from Retell tool resolution
- Retell tool routes now reject mismatched `tenantId` vs session/call-attempt context
- Public widget routes now enforce:
  - tenant-configured `widget_allowed_origins`
  - basic per-tenant/per-IP rate limiting
- Tenant settings API now supports:
  - `voice_runtime`
  - `retell_agent_id`
  - `widget_allowed_origins`
- Voice status callback now requires `CallSid` in production and matches `CallSid` + `callAttemptId` when both are supplied
- Outbound worker now re-checks DND immediately before dialing to reduce race-condition risk

### What still requires live rollout work

- Real Twilio and Retell subscriptions/accounts configured in the deployment environment
- One pilot tenant configured with:
  - `voice_runtime = retell`
  - `retell_agent_id`
  - `twilio_number`
  - `widget_allowed_origins`
- Manual execution of the 10 live receptionist benchmark scripts over PSTN
- Final production verification that Retell tool payloads include the expected `tenantId`, `sessionId`, or `callAttemptId` fields in all live call paths


