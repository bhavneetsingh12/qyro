# Change Tracker

Purpose: running log of all changes made in this workspace session series so follow-up commands have clear traceability.

## 2026-04-11

### pending - docs: consolidate canonical source-of-truth set and remove stale runtime narratives
- Request summary:
  - Promote the canonical doc set to the only active source of truth.
  - Remove Retell/n8n drift from current documentation.
  - Clean stale generated artifacts and obsolete generated reports from the repo view.
- Files changed:
  - `docs/ARCHITECTURE.md`
  - `docs/ENVIRONMENTS.md`
  - `docs/AGENTS.md`
  - `docs/COMPLIANCE.md`
  - `docs/DECISIONS.md`
  - `docs/TOKEN_BUDGET.md`
  - `CLAUDE.md`
- Key behavior changes:
  - Canonical docs now describe SignalWire + SWAIG as the active voice stack.
  - Retell is treated as decommissioned.
  - Railway cron services are treated as the active scheduling path instead of n8n.
  - `CLAUDE.md` is trimmed to collaboration/session memory instead of acting as a second architecture spec.

### pending - feat: encrypt tenant integration secrets at the application layer
- Request summary:
  - Encrypt `tenant_integration_secrets` values at rest while keeping reads backward-compatible with existing plaintext rows.
- Files changed:
  - `packages/db/src/secrets.ts`
  - `packages/db/src/index.ts`
  - `apps/api/src/routes/tenants.ts`
  - `apps/api/src/routes/swaig.ts`
  - `packages/agents/src/agents/emailEnrichment.ts`
  - `docs/ENVIRONMENTS.md`
- Key behavior changes:
  - New writes to `tenant_integration_secrets` are AES-GCM encrypted using `TENANT_INTEGRATION_SECRET_KEY`.
  - Existing plaintext rows remain readable through a compatibility path.
  - Decryption now occurs at secret read sites rather than exposing raw stored values.

### pending - chore: add one-off backfill for legacy tenant integration secrets
- Request summary:
  - Add a safe operational command to encrypt existing plaintext rows in `tenant_integration_secrets` after the shared key is deployed.
- Files changed:
  - `scripts/backfill-tenant-secrets.ts`
  - `package.json`
  - `docs/ARCHITECTURE.md`
  - `docs/ENVIRONMENTS.md`
- Key behavior changes:
  - Added `pnpm backfill:tenant-secrets` as a dry-run scanner for plaintext rows.
  - Added `pnpm backfill:tenant-secrets --apply` to encrypt only legacy plaintext fields while leaving already-encrypted values untouched.
  - Added optional `--tenant <tenantId>` targeting for narrower rollouts if needed.

### pending - feat: align Lead and Assist as live products for launch
- Request summary:
  - Make both products feel intentionally live for launch, with Lead feeding Assist for outbound calling and warm-lead workflows.
- Files changed:
  - `apps/web/src/app/products/page.tsx`
  - `apps/web/src/app/onboarding/page.tsx`
  - `apps/web/src/app/lead/page.tsx`
  - `apps/web/src/app/assist/page.tsx`
  - `apps/web/src/app/(client)/client/outbound-pipeline/page.tsx`
  - `apps/web/src/components/auth/PlanCapture.tsx`
  - `apps/web/src/components/sidebar/InternalSidebar.tsx`
  - `apps/web/src/components/sidebar/ClientSidebar.tsx`
  - `apps/web/src/config/pricing.ts`
  - `apps/api/src/routes/pricing.ts`
- Key behavior changes:
  - Lead is no longer presented as coming soon in public pricing and onboarding flows.
  - `/products` now acts as a real workspace selector when a tenant has both Lead and Assist access.
  - Onboarding now supports both Assist and Lead plan intents and routes billing by the selected product.
  - Public pricing pages now reserve guided setup for Pro tiers instead of sending users into unsupported direct-checkout paths.
  - The outbound pipeline cancel action now matches the backend API route shape.

### pending - fix: gate outbound call queueing behind Assist and surface upgrade CTAs from Lead
- Request summary:
  - Make the Lead -> Assist handoff explicit so outbound calling is only available when Assist access exists, while giving Lead-only tenants a clear upgrade path.
- Files changed:
  - `apps/api/src/routes/assist.ts`
  - `apps/web/src/app/(internal)/internal/leads/page.tsx`
- Key behavior changes:
  - `POST /api/v1/assist/outbound-calls/enqueue` now requires both Lead and Assist access before queueing calls.
  - Lead workspace batch actions now show `Send to Assist Calls` only when Assist is active.
  - Lead-only tenants now see an `Unlock Assist for Calls` CTA that routes to the product hub upgrade path.

### pending - docs: define Assist operations plan and calendar control strategy
- Request summary:
  - Create one canonical plan for how Assist chat, voice, booking, and calendar control should operate, including how QYRO should become the booking control plane while syncing to third-party calendar providers.
- Files changed:
  - `docs/ASSIST_OPERATIONS.md`
  - `docs/ARCHITECTURE.md`
- Key behavior changes:
  - Added a canonical Assist operations document covering current runtime truth, known gaps, booking modes, calendar control strategy, and phased implementation order.
  - Recorded the intended model where QYRO owns booking policy while external providers remain the calendar sync target and event system of record.
  - Added an architecture rule that chat, voice, and booking should converge on shared orchestration services rather than separate channel-specific logic.

### pending - feat: lay down shared Assist booking controls and clean up misleading Assist UX
- Request summary:
  - Start implementing the Assist operations plan by normalizing booking/calendar behavior, exposing booking mode in tenant settings, and cleaning up misleading Assist labels and copy.
- Files changed:
  - `packages/agents/src/assistBooking.ts`
  - `packages/agents/src/agents/clientAssistant.ts`
  - `packages/agents/src/agents/voiceAssistant.ts`
  - `packages/agents/src/calendars/googleCalendar.ts`
  - `packages/agents/src/index.ts`
  - `packages/agents/package.json`
  - `apps/api/src/routes/assist.ts`
  - `apps/api/src/routes/swaig.ts`
  - `apps/api/src/routes/tenants.ts`
  - `apps/api/src/routes/voice.ts`
  - `apps/web/src/app/(client)/client/admin/page.tsx`
  - `apps/web/src/app/(client)/client/settings/page.tsx`
  - `apps/web/src/app/(client)/client/conversations/page.tsx`
  - `apps/web/src/app/(client)/client/dashboard/page.tsx`
  - `apps/web/src/app/(client)/client/calls/page.tsx`
  - `apps/web/src/app/(client)/client/call-control/page.tsx`
  - `apps/web/src/app/(client)/client/widget/page.tsx`
  - `apps/web/src/components/sidebar/ClientSidebar.tsx`
  - `apps/web/src/components/billing/BillingActions.tsx`
  - `apps/web/src/app/products/page.tsx`
- Key behavior changes:
  - Added a shared Assist booking configuration resolver with normalized provider and booking-mode handling.
  - Exposed booking mode through tenant settings so calendar behavior can be explicitly controlled per tenant.
  - Updated chat and voice assistant flows to use the shared booking configuration and to fail closed into callback/escalation when direct booking is not safely available.
  - Prevented unsafe Google availability auto-booking by failing closed instead of treating busy events as open slots.
  - Moved SWAIG `business-info` AI execution onto the shared agent runner so quota, usage logging, and model governance are consistent with the rest of Assist.
  - Cleaned up Assist UI language: "Widget" now presents as "Website Chat", several raw call outcomes are translated into business-readable text, billing CTAs are less misleading, and the products hub back-link is contextual to the active workspace.

### pending - fix: retire legacy bundle checkout from products billing CTA
- Request summary:
  - Prevent new customers from being routed to the old bundle Stripe product when they click to add both products.
- Files changed:
  - `apps/web/src/components/billing/BillingActions.tsx`
  - `apps/api/src/routes/billing.ts`
- Key behavior changes:
  - Removed the "Add Both Products" checkout button that triggered legacy bundle pricing.
  - Added an API guard that blocks new `product="bundle"` checkout session creation (unless an explicit allowed `priceId` is passed), returning a retired-product error message.
  - Existing bundle subscriptions remain readable for entitlement mapping/backward compatibility.

### pending - feat: TCPA compliance core gating for automated outbound voice
- Request summary:
  - Add a compliance decision layer that can block or route outbound attempts to manual review based on suppressions and consent evidence before calls are queued or dialed.
- Files changed:
  - `packages/db/migrations/0017_tcpa_compliance_core.sql`
  - `packages/db/src/schema.ts`
  - `packages/db/src/compliance.ts`
  - `packages/db/src/index.ts`
  - `apps/api/src/routes/assist.ts`
  - `packages/queue/src/workers/outboundCallWorker.ts`
  - `apps/api/src/routes/tenants.ts`
  - `apps/web/src/app/(client)/client/admin/page.tsx`
- Key behavior changes:
  - Added core compliance tables: `consent_records`, `suppressions`, and `compliance_decisions`.
  - Added shared evaluator `evaluateComplianceForProspect(...)` with `ALLOW | BLOCK | MANUAL_REVIEW` outcomes and rule codes.
  - Outbound enqueue now evaluates compliance per prospect and returns blocked/manual-review reasons instead of silently queueing all records.
  - Outbound call worker now enforces the same compliance gate before dialing, preventing queue bypass.
  - Added authenticated endpoints to write consent and suppression records:
    - `POST /api/v1/assist/compliance/consent`
    - `POST /api/v1/assist/compliance/suppressions`
  - Added tenant setting `tcpaStrictMode` (`metadata.tcpa_strict_mode`) and Admin UI toggle to enable strict consent checks without direct DB edits.

## 2026-04-12

### pending - feat: consent capture wiring for intake paths + evidence persistence

- Request summary:
  - Ensure strict compliance mode receives real consent evidence from lead intake and public Assist entry points.
- Files changed:
  - `apps/api/src/routes/leads.ts`
  - `apps/api/src/routes/assist.ts`
- Key behavior changes:
  - `POST /api/leads` now accepts optional `consent` payload and writes `consent_records` with request IP/user-agent evidence when `consent.given === true` and phone is valid E.164.
  - Manual lead intake now sets `prospects_raw.consent_state` to `given` when consent evidence is provided.
  - Public Assist chat/missed-call intake now supports optional consent payload and persists consent evidence to `consent_records`.
  - Prospect consent state is updated to `given` when evidence is captured.

### pending - feat: campaign-level compliance metadata propagation from enqueue through worker

- Request summary:
  - Ensure compliance evaluator uses campaign-specific seller/automation context consistently in both enqueue and dial worker stages.
- Files changed:
  - `packages/db/migrations/0018_call_attempts_compliance_campaign_context.sql`
  - `packages/db/src/schema.ts`
  - `packages/db/src/complianceContext.ts`
  - `packages/db/src/index.ts`
  - `apps/api/src/routes/assist.ts`
  - `packages/queue/src/workers/outboundCallWorker.ts`
- Key behavior changes:
  - Added call attempt columns:
    - `campaign_id`
    - `compliance_seller_name`
    - `compliance_automated`
  - Enqueue endpoint now accepts campaign context (top-level or nested `campaign`) and stores it on `call_attempts`.
  - Compliance evaluator at enqueue now receives `campaignId`, `sellerName`, and `automated` values from campaign context.
  - Outbound worker now reuses the same stored context so compliance decisions stay consistent after queueing.

### pending - test: add focused hardening suite for evaluator outcomes, gating context, and booking fallback

- Request summary:
  - Add deterministic automated tests for core hardening logic without external infra.
- Files changed:
  - `packages/db/src/compliance.test.ts`
  - `packages/db/src/complianceContext.test.ts`
  - `packages/db/src/compliance.ts`
  - `packages/agents/src/bookingMode.ts`
  - `packages/agents/src/assistBooking.ts`
  - `packages/agents/src/assistBooking.test.ts`
  - `package.json`
- Key behavior changes:
  - Added pure evaluator helper `evaluateComplianceFromSnapshot(...)` and unit tests for:
    - DNC block
    - missing consent manual review
    - written-consent enforcement for automated outreach
    - valid strict-mode allow path
  - Added compliance context resolution tests for enqueue/worker metadata propagation.
  - Extracted booking-mode normalization to pure module and added fallback behavior tests.
  - Added root test command: `pnpm test:hardening`.
- Validation run:
  - `pnpm -s -r typecheck`: pass
  - `pnpm test:hardening`: pass (10 tests, 0 failures)

### pending - ops: compliance reporting endpoints + strict-mode rollout playbook

- Request summary:
  - Provide operational monitoring tools for strict mode plus a rollout checklist.
- Files changed:
  - `apps/api/src/routes/assist.ts`
  - `docs/STRICT_MODE_ROLLOUT.md`
- Key behavior changes:
  - Added `GET /api/v1/assist/compliance/report?days=...` with totals, top rules, and by-day breakdown.
  - Added `GET /api/v1/assist/compliance/alerts` with simple spike detection (BLOCK and MANUAL_REVIEW vs 7-day baseline).
  - Added rollout/operations document for strict mode enablement and incident response.

### pending - feat: shared multi-agent runtime profiles (inbound/outbound/chat) with tenant-level policy controls

- Request summary:
  - Avoid per-client SignalWire agent sprawl by running a shared runtime and resolving behavior by tenant + mode (`inbound`, `outbound`, `chat`) inside QYRO.
- Files changed:
  - `apps/api/src/lib/agentProfiles.ts`
  - `apps/api/src/routes/tenants.ts`
  - `apps/api/src/routes/assist.ts`
  - `apps/api/src/routes/voice.ts`
  - `apps/api/src/routes/swaig.ts`
  - `packages/agents/src/agents/clientAssistant.ts`
  - `packages/agents/src/agents/voiceAssistant.ts`
  - `apps/web/src/app/(client)/client/admin/page.tsx`
- Key behavior changes:
  - Added tenant metadata-backed `agentProfiles` config for:
    - `inbound`
    - `outbound`
    - `chat`
  - Each profile supports:
    - `enabled`
    - `name`
    - `behaviorHint`
    - `allowBooking`
    - `allowEscalation`
  - `GET /api/v1/tenants/settings` now returns normalized `agentProfiles`.
  - `PATCH /api/v1/tenants/settings` now accepts and merges `agentProfiles`.
  - Assist chat route now resolves `chat` profile, blocks when disabled, injects mode hint, and enforces no-booking/no-escalation profile policy on result handling.
  - Voice routes now resolve direction-based mode:
    - inbound calls -> inbound profile
    - outbound calls -> outbound profile
    and pass mode behavior hints into turn processing.
  - SWAIG routes now resolve mode and enforce profile policy:
    - `business-info` respects mode enabled/behavior
    - `book-appointment` requires `allowBooking`
    - `escalate` requires `allowEscalation`
    - `callback-sms` requires mode enabled
  - Client Admin UI now includes an editable **Shared Agent Runtime Profiles** section under Voice tab.
- Validation run:
  - `pnpm -s -r typecheck`: pass (no output)

### pending - ops+feat: verify migration 0017 in live DB and wire inbound opt-out suppression ingestion

- Request summary:
  - Verify the TCPA compliance migration is truly present in the deployed environment.
  - Auto-ingest STOP/opt-out revocations from real inbound channels so suppressions are created without manual operator action.
- Files changed:
  - `apps/api/src/routes/voice.ts`
  - `apps/api/src/routes/assist.ts`
- Key behavior changes:
  - Verified migration state in current environment:
    - `pnpm -C /Volumes/WrkspaceSSD/dev/qyro migrate` => `All migrations already applied. Nothing to do.`
    - Confirmed tables exist: `consent_records`, `suppressions`, `compliance_decisions`.
  - Added shared opt-out ingestion behavior in voice routes:
    - Voice "stop" path now writes both `do_not_contact` and `suppressions`, and revokes matching `consent_records` for phone.
    - Added `POST /api/v1/voice/sms/inbound` (SignalWire-signed) to process inbound SMS STOP/opt-out requests.
    - SMS opt-out now marks matching outbound attempts as DND and clears future scheduling.
  - Added chat opt-out ingestion behavior in Assist public chat route:
    - Widget chat messages containing opt-out intents now create suppression + DNC and revoke consent when phone is present.
    - Chat returns a direct opt-out confirmation response instead of continuing normal AI conversation flow.
- Validation run:
  - `pnpm -s -r typecheck`: pass (no output)

### pending - feat: add compliance decision review API + Call Control queue panel

- Request summary:
  - Add day-to-day visibility for strict-mode outcomes so blocked/manual-review decisions are actionable without digging through raw logs.
- Files changed:
  - `apps/api/src/routes/assist.ts`
  - `apps/web/src/app/(client)/client/call-control/page.tsx`
- Key behavior changes:
  - Added `GET /api/v1/assist/compliance/decisions?limit=25&decision=open` returning recent `BLOCK` + `MANUAL_REVIEW` decisions with rule code, explanation, channel, and prospect context.
  - Added a new **Compliance Review Queue** panel in Call Control that surfaces those decisions in the client UI.
  - Queue action feedback now includes how many submissions were blocked by compliance at enqueue time.
  - Added user-facing mapping for `blocked_compliance` outcome text.
- Validation run:
  - `pnpm -s -r typecheck`: pass (no output)
- Highest-priority list status after this change:
  - ✅ Add compliance UI pages for reviewing `MANUAL_REVIEW` and blocked decisions (initial operational view complete)
  - ❌ Run migration `0017` in all deployed environments and verify table presence
  - ❌ Inbound STOP/revocation ingestion to auto-create suppressions from real inbound channels
  - ❌ Consent capture wiring at lead intake/onboarding/forms for strict-mode evidence
  - ❌ Campaign-level compliance metadata + evaluator wiring
  - ❌ Complete provider writeback for all supported calendar providers + bookings UX hardening
  - ❌ Focused automated tests for evaluator/worker suppression and booking fallback
  - ❌ Deployment/ops checks (strict-mode rollout playbook, daily report, anomaly alerting)

### pending - feat: shared booking execution service, manual bookings, and blackout blocks

- Request summary:
  - Eliminate the duplicate booking brains in chat and SWAIG voice by extracting a shared `executeBooking()` service.
  - Add a `blackout_blocks` table so staff can mark periods when AI booking is blocked.
  - Add a manual booking API endpoint and interactive Bookings UI with an availability blocks tab.
- Files changed:
  - `packages/db/migrations/0016_blackout_blocks.sql`
  - `packages/db/src/schema.ts`
  - `packages/agents/src/bookingService.ts`
  - `packages/agents/src/index.ts`
  - `packages/agents/package.json`
  - `packages/agents/src/agents/clientAssistant.ts`
  - `apps/api/src/routes/swaig.ts`
  - `apps/api/src/routes/assist.ts`
  - `apps/web/src/app/(client)/client/bookings/page.tsx`
  - `docs/ASSIST_OPERATIONS.md`
- Key behavior changes:
  - New `executeBooking()` in `packages/agents/src/bookingService.ts` is the single execution path for all channels (chat, voice_swaig, voice_turn, manual).
  - Service resolves tenant config, checks blackout blocks, runs direct_booking / booking_link_sms / callback_only, persists appointment, returns channel-appropriate reply.
  - Manual bookings (channel: "manual") skip the blackout check so staff can override.
  - `swaig.ts /book-appointment` now delegates to `executeBooking()` — removed `bookCalCom()`, `sendSignalWireSms()`, and the inline provider switch block.
  - `clientAssistant.ts` booking_intent block now delegates to `executeBooking()` after slot discovery. Also handles the "no prospect yet" case explicitly before attempting booking.
  - New `blackout_blocks` table with tenant-scoped range index for efficient overlap queries.
  - `appointments` table gains nullable `source` and `created_by` columns.
  - New API routes: `POST /api/appointments/manual`, `PATCH /api/appointments/:id`, `GET/POST/DELETE /api/v1/assist/blackout-blocks`.
  - Bookings page converted to interactive client component with Appointments tab (list + "Schedule appointment" modal) and Availability Blocks tab (form + list with delete).
- Validation run:
  - `pnpm -s -r typecheck`: pass (no output)
- Priority order coverage:
  - ✅ Priority 1 — shared booking execution service
  - ✅ Priority 2 — manual booking UI + blackout/vacation block management
  - ✅ Priority 3 — provider writeback (QYRO → external calendar) — see entry below
  - ✅ Priority 4 — fallback chain explicit in service (`direct_booking` → `booking_link_sms` → `callback_only`)
  - ❌ Priority 5 — Assist UX hardening on bookings/approvals/outbound pipeline — not started

### pending - feat: provider writeback for manual bookings and blackout blocks

- Request summary:
  - Wire external calendar sync so QYRO-side changes propagate to the provider.
  - Manual bookings should write to the provider regardless of configured `bookingMode`.
  - Blackout blocks should push a busy event to the provider calendar on create, and remove it on delete.
- Files changed:
  - `packages/agents/src/calendars/types.ts`
  - `packages/agents/src/calendars/googleCalendar.ts`
  - `packages/db/migrations/0016_blackout_blocks.sql`
  - `packages/db/src/schema.ts`
  - `packages/agents/src/bookingService.ts`
  - `apps/api/src/routes/assist.ts`
  - `docs/ASSIST_OPERATIONS.md`
- Key behavior changes:
  - `CalendarAdapter` interface gains optional `createBlock(params)` and `cancelBlock(blockId)` methods.
  - `GoogleCalendarAdapter` implements both — `createBlock` posts an opaque busy event (no attendees, no invite), `cancelBlock` delegates to `cancelBooking`.
  - Cal.com does not implement `createBlock`; writeback silently skips for Cal.com tenants.
  - `blackout_blocks` table gains `provider_block_id` column to track the external event ID.
  - `POST /api/v1/assist/blackout-blocks` calls `attemptBlackoutWriteback()` before insert; stores the returned provider event ID on the row.
  - `DELETE /api/v1/assist/blackout-blocks/:id` calls `attemptBlackoutCancelWriteback()` if the row has a `provider_block_id`. Writeback failure is non-blocking.
  - `executeBooking()` with `channel: "manual"` now has a dedicated path: always attempts provider write if `supportsDirectBooking`, then saves locally regardless of `bookingMode`. No SMS is sent for manual channel.
  - Two new exports from `bookingService.ts`: `attemptBlackoutWriteback` and `attemptBlackoutCancelWriteback`.
- Validation run:
  - `pnpm -s -r typecheck`: pass (no output)
- Priority order coverage:
  - ✅ Priority 3 — provider writeback complete for Google Calendar; Cal.com block writeback deferred (no suitable API)

## 2026-04-06

### d2c604e - feat: SSE real-time dashboard updates for calls, leads, and approvals
- Added authenticated SSE stream endpoint at /api/v1/events/stream with tenant scoping and 30s ping heartbeat.
- Added Redis pub/sub realtime layer and shared event types.
- Emitted realtime events for new leads, call status changes, pending approvals, and escalations.
- Added web SSE hook with reconnect behavior and live status indicator.
- Added dashboard toasts for pending approvals and escalations.

### 2715e88 - feat: escalation detection to human handoff via SMS, email, and call transfer
- Added tenant escalation contact fields and session escalation_reason support.
- Added escalation notifications (SignalWire SMS + SendGrid email + audit log).
- Added voice escalation transfer path via TwiML Dial.
- Added client settings fields for escalation contacts.
- Added dashboard escalations section and API endpoint.

### a640cfc - feat: missed call SMS auto-send toggle per tenant
- Added per-tenant missed call SMS auto-send capability and related controls.

### 58187f2 - feat: call recording storage, transcript capture, and playback UI
- Request summary:
  - Persist call recordings and full transcripts from SignalWire and Retell.
  - Add call history UI with expandable turn-by-turn transcript and recording playback/export.
- Files changed:
  - packages/db/migrations/0010_call_recordings.sql
  - packages/db/src/schema.ts
  - apps/api/src/routes/voice.ts
  - apps/api/src/routes/retell.ts
  - apps/api/src/routes/assist.ts
  - apps/web/src/app/(client)/client/calls/page.tsx
- Key behavior changes:
  - Added call_attempts fields: duration_seconds, transcript_text, transcript_json.
  - SignalWire status callback now captures RecordingUrl, stores duration_seconds, and fetches transcript text when a transcript URL is present.
  - Retell call/transcript webhooks now persist recording_url/duration_seconds and transcript text + structured turns to call_attempts.
  - Calls API now returns recording/transcript fields and prospect name for history rendering.
  - Client Call History now supports transcript expansion, recording playback link, and transcript text export.
- Validation run:
  - get_errors on touched API/DB/web files: no errors
  - pnpm -s -r typecheck: pass (no output)

### 61037ab - feat: prospect urgency score drives outreach queue priority and leads UI
- Request summary:
  - Use urgency score to prioritize outreach jobs in BullMQ.
  - Show urgency badges in leads UI and default sort by urgency.
- Files changed:
  - apps/api/src/routes/leads.ts
  - apps/api/src/routes/webhooks.ts
  - packages/queue/src/queues.ts
  - apps/web/src/app/(internal)/internal/leads/page.tsx
- Key behavior changes:
  - Added urgency -> priority mapping (8-10 => 1, 5-7 => 2, 1-4 => 3).
  - Applied priority on manual outreach enqueue route and nightly leadDiscovery->outreach bulk enqueue path.
  - Set outreach queue default priority to medium (2), while allowing per-job override.
  - Leads list now defaults to urgency sort and includes sort selector (urgency/recent).
  - Urgency badges now render as Urgent (red), Medium (amber), Low (gray).
- Validation run:
  - get_errors on touched files: no errors
  - pnpm -s -r typecheck: pass (no output)

### d5c09ae - feat: async webhook processing via BullMQ, idempotency on Retell handlers
- Request summary:
  - Prevent provider timeout by moving status/event webhook processing off request thread.
  - Keep synchronous TwiML for live call endpoints with a 4 second fallback guard.
- Files changed:
  - apps/api/src/routes/voice.ts
  - apps/api/src/routes/retell.ts
  - packages/queue/src/queues.ts
  - packages/queue/src/workers/webhookWorker.ts
  - packages/queue/package.json
  - infra/pm2/ecosystem.config.cjs
  - docs/ENVIRONMENTS.md
- Key behavior changes:
  - Added `webhook` BullMQ queue and `worker:webhook` worker script.
  - `POST /api/v1/voice/status`, `POST /api/v1/retell/call-events`, and `POST /api/v1/retell/transcript-events` now enqueue payloads and return immediate 200 acknowledgements.
  - `POST /api/v1/voice/incoming` and `POST /api/v1/voice/turn` stay synchronous but now return fallback TwiML (`Please hold while we connect you`) if processing exceeds 4 seconds.
  - Added webhook worker (concurrency 5) with BullMQ retries and audit log failure writes.
  - Added Redis idempotency cache for Retell processing using call_id + event_type style keys with 24h TTL.
  - Added webhook worker start command documentation for Railway and PM2 entry for local process management.
- Validation run:
  - get_errors on touched files: no errors
  - pnpm -s -r typecheck: pass (no output)

### b24f7aa - feat: daily digest storage, intent aggregation, analytics dashboard
- Request summary:
  - Persist daily digest metrics in DB, aggregate intent counts, and expose a dashboard analytics view.
- Files changed:
  - packages/db/migrations/0011_daily_summaries.sql
  - packages/db/src/schema.ts
  - apps/api/src/routes/webhooks.ts
  - packages/agents/src/agents/clientAssistant.ts
  - apps/api/src/routes/assist.ts
  - apps/web/src/app/(client)/client/dashboard/analytics/page.tsx
  - apps/web/src/app/dashboard/analytics/page.tsx
  - apps/web/src/components/sidebar/ClientSidebar.tsx
  - apps/web/package.json
  - pnpm-lock.yaml
- Key behavior changes:
  - Added `daily_summaries` table (tenant/day aggregates for leads, calls, booked, escalations, intents, and avg urgency).
  - `POST /api/v1/webhooks/morning-digest` now computes metrics and upserts into `daily_summaries`.
  - Morning digest now includes daily intent counters from Redis, then clears those keys after persistence.
  - Client assistant now increments Redis intent counters by detected intent for daily aggregation.
  - Added authenticated analytics API endpoint (`GET /api/v1/assist/analytics?days=30`) returning day-series data and totals.
  - Added client analytics page with 30-day trend charts and KPI cards.
  - Added sidebar navigation link to Analytics and route alias at `/dashboard/analytics`.
  - Added `recharts` dependency to web app for chart rendering.
- Validation run:
  - get_errors on touched files: no errors
  - pnpm -s -r typecheck: pass (no output)

### 22eed78 - feat: consent pre-check gate before research and outreach job enqueue
- Request summary:
  - Add a consent eligibility gate so lead discovery only enqueues research for compliant prospects.
  - Add tenant outreach toggle and a skipped-leads filter with reasons in the dashboard.
- Files changed:
  - packages/db/src/schema.ts
  - packages/db/migrations/0012_consent_gate_research_skip.sql
  - packages/agents/src/agents/leadDiscovery.ts
  - apps/api/src/routes/leads.ts
  - apps/api/src/routes/tenants.ts
  - apps/web/src/app/(internal)/internal/settings/page.tsx
  - apps/web/src/app/(internal)/internal/leads/page.tsx
  - infra/seed.ts
- Key behavior changes:
  - Added `prospects_raw.source_type`, `prospects_raw.research_skipped`, and `prospects_raw.research_skip_reason` fields.
  - Added lead discovery pre-check gate before research enqueue:
    - block if DNC match exists for phone/email/domain
    - block if tenant metadata `outreach_enabled` is false
    - block if source is not from approved public business datasets
    - block if prospect source_type is `individual`
  - Eligible prospects are enqueued to research; skipped prospects are marked on `prospects_raw` and logged to `audit_logs` with skip reason.
  - Added internal tenant setting `outreachEnabled` (maps to metadata `outreach_enabled`, default true).
  - Added leads API/UI "Skipped" filter and per-row skip reason visibility.
  - Internal tenant seed now includes `outreach_enabled: true`.
- Validation run:
  - get_errors on touched files: no errors
  - pnpm -s -r typecheck: pass (no output)

### pending - feat: Railway cron scripts to replace n8n for nightly ingest and morning digest
- Request summary:
  - Replace scheduled n8n trigger calls with Railway cron scripts while keeping n8n config in place during rollout.
- Files changed:
  - apps/crons/package.json
  - apps/crons/tsconfig.json
  - apps/crons/nightly-ingest.ts
  - apps/crons/morning-digest.ts
  - apps/api/src/routes/webhooks.ts
  - turbo.json
  - CLAUDE.md
  - pnpm-lock.yaml
- Key behavior changes:
  - Added a new `@qyro/crons` workspace package with TypeScript build output to `apps/crons/dist`.
  - Added `nightly-ingest` and `morning-digest` cron trigger scripts that POST to API webhook routes with `x-webhook-secret`.
  - Updated webhook secret validation to use `WEBHOOK_SECRET` + `x-webhook-secret` with compatibility fallback to legacy internal secret/header.
  - Added cron dist path in turbo build outputs for Railway artifact discovery.
  - Documented Railway cron replacement plan, schedules, start commands, and required env vars in CLAUDE.md.
  - Left n8n configuration untouched per rollout safety requirement.
- Validation run:
  - get_errors on touched files: no errors
  - pnpm -s -r typecheck: pass (no output)
  - pnpm --filter @qyro/crons build: pass

## 2026-04-07 to 2026-04-10

### b0e540a - fix: retell call-events 500 — RETELL_WEBHOOK_SECRET missing caused hard 500
- Added graceful error when RETELL_WEBHOOK_SECRET is not configured — returns 401 instead of 500.

### 9ee9b98 - feat: add voice runtime and retell agent ID fields to settings pages
- Added `voice_runtime` and `retell_agent_id` fields to client settings page and PATCH /tenants/settings.
- Operators can now switch per-tenant voice runtime (signalwire/retell) from the portal.

### 6c02a8f - fix: move voice config to client settings only, add voice admin panel
- Voice number and configuration moved to client portal settings only (removed from internal portal).
- Added voice section to client admin panel for tenant-level voice management.

### 0e552ab - feat: client admin panel with org/voice/AI/team/billing + secure ops path
- Added `/client/admin` page with tabbed interface: org, voice, AI, team, billing.
- Moved platform ops path from `/admin` to `/qx-ops` with rate limiting.
- Rate limiter: 5 requests per minute per IP; 1-hour block on violation.

### f8eca3d - fix: move admin panel to /admin route, remove from internal portal
- Intermediate fix before /qx-ops migration.

### 41c89c8 - feat: add Retell Custom LLM WebSocket endpoint
- Added WebSocket handler at `/api/v1/retell/llm-websocket`.
- Retell can now use QYRO as its custom LLM backend for fully custom conversational logic.
- Wired into the WS upgrade path in `apps/api/src/index.ts`.

### 292eb65 - fix: SignalWire signature validation
- Fixed auth token key in validation middleware (was using wrong env var key).
- Added `SKIP_SW_SIGNATURE_CHECK=true` bypass flag for Railway testing.
- Fixed URL construction in HMAC validation to match SignalWire's expected format.

### d3a9650 - fix: add express.urlencoded() so SignalWire webhook bodies parse correctly
- SignalWire sends `application/x-www-form-urlencoded` for cXML webhooks.
- Added `express.urlencoded({ extended: false })` middleware before voice routes.

### c7e935b - feat: SWAIG endpoints for SignalWire AI agent
- Added new route file `apps/api/src/routes/swaig.ts`.
- Added `validateSwaigRequest` middleware (HTTP Basic auth with `SWAIG_WEBHOOK_SECRET`).
- Implemented 4 SWAIG function endpoints:
  - `POST /api/v1/swaig/booking` — book_appointment
  - `POST /api/v1/swaig/faq` — business_info
  - `POST /api/v1/swaig/escalation` — escalate
  - `POST /api/v1/swaig/sms` — callback_sms
- Tenant identification: SWML global_data → payload tenantId → voice_number lookup.
- Mounted in `apps/api/src/index.ts` with SWAIG auth middleware.

### 01db096 - feat: multi-provider calendar adapter for SWAIG booking, default SMS callback flow
- SWAIG booking endpoint now uses the calendar adapter factory (`packages/agents/src/calendars/index.ts`).
- Supports Cal.com and Google Calendar based on `tenant.metadata.calendarProvider`.
- Falls back to `callback_only` if no calendar provider configured — sends SMS to request callback.
- Default missed-call SMS callback flow documented and implemented.

### 0dc5b37 - feat: auto tenant creation on signup, onboarding flow, product selection
- `tenant.ts` provisioning now sets `onboarding_complete: false` in metadata.
- `GET /api/v1/tenants/settings` now returns `onboardingComplete` and `tenantType`.
- Added `PATCH /api/v1/tenants/onboarding` endpoint (saves business info + marks complete).
- `/products` page redirects to `/onboarding` when `onboardingComplete === false`.
- New 4-step onboarding page at `apps/web/src/app/onboarding/page.tsx`:
  - Step 0: Product selection (Assist vs Lead — Lead shows "coming soon")
  - Step 1: Business info (name, industry, phone, timezone)
  - Step 2: AI setup (description, services, greeting)
  - Step 3: Done (call-forwarding instructions)
- Existing tenants unaffected (no `onboarding_complete` field = skip gate).

### 32474ce - docs: complete architecture document
- Generated `docs/ARCHITECTURE.md` from all .md files + git log + live filesystem scan.

---

## Ongoing Update Rule
- For each new user command, append a new entry with:
  - timestamp/date
  - summary of request
  - files changed
  - key behavior changes
  - validation steps run
  - commit hash (once committed)

### 2026-04-11 - launch hardening in progress
- `packages/queue/src/workers/outboundCallWorker.ts`
  - Outbound calling-hours enforcement now prefers a best-effort prospect timezone inferred from lead address before falling back to the tenant timezone.
  - Audit logs for outside-calling-hours skips now record the effective timezone, the timezone source, and the stored prospect address.
- `packages/db/src/schema.ts`
  - Added persisted `prospect_timezone` storage on raw prospects so dialing does not have to infer from address every time.
- `packages/db/src/prospectTimezone.ts`
  - Added a shared prospect timezone inference helper so ingest, API, and outbound calling use the same logic.
- `packages/db/migrations/0015_prospect_timezone.sql`
  - Added migration to create the new `prospect_timezone` column.
- `packages/agents/src/agents/leadDiscovery.ts`
  - Newly discovered leads now persist an inferred prospect timezone at insert time.
- `apps/api/src/routes/assist.ts`
  - Local hardening still restricts Lead -> Assist outbound enqueue so it requires both Lead and Assist access.
- `apps/api/src/routes/leads.ts`
  - Lead list responses now include `prospectTimezone`, and manual lead creation now stores an inferred timezone when address is provided.
- `apps/web/src/app/(internal)/internal/leads/page.tsx`
  - Local Lead workspace changes now expose the Assist handoff when Assist is active, show an upgrade path when it is not, and surface each lead's current dialing timezone state.
- `apps/web/src/app/(internal)/internal/leads/[id]/page.tsx`
  - Lead detail now shows the stored address and prospect timezone.
- `apps/web/src/app/products/page.tsx`
  - Local product cards now send users without access to the public product details page instead of a protected dashboard.
- `scripts/backfill-prospect-timezones.ts`
  - Added a dry-run/apply backfill script for existing leads that do not yet have `prospect_timezone` populated.
- `package.json`
  - Added `pnpm backfill:prospect-timezones`.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending

### 2026-04-12

### pending - feat: add operator actions for compliance review queue in Assist Call Control
- Request summary:
  - Move to the next implementation chunk without waiting by making the compliance queue operational, not read-only.
- Files changed:
  - `apps/web/src/app/(client)/client/call-control/page.tsx`
- Key behavior changes:
  - Added per-decision operator actions in the Compliance Review Queue:
    - `Block Contact` writes a suppression via `POST /api/v1/assist/compliance/suppressions`.
    - `Record Consent` writes consent evidence via `POST /api/v1/assist/compliance/consent`.
  - Added inline action notices so operators immediately see success/failure and know next steps.
  - Successful actions remove handled decisions from the local queue and trigger a refresh for queue/report consistency.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending

### pending - feat: add inbound revocation ingestion endpoint for compliance suppressions
- Request summary:
  - Continue autonomous backlog execution by adding a single ingestion path for inbound STOP/opt-out/revocation events.
- Files changed:
  - `apps/api/src/routes/assist.ts`
- Key behavior changes:
  - Added `POST /api/v1/assist/compliance/inbound-events`.
  - Endpoint evaluates inbound event text/disposition and applies suppression + consent revocation when opt-out intent is detected.
  - Supports channel-aware suppression typing (`verbal_optout` for voice, `stop_reply` for sms/chat).
  - If a prospect is identified, pending outbound attempts are moved to `dnd` with `do_not_contact` outcome.
  - Non-opt-out events are explicitly ignored with a structured response.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending

### pending - test: harden inbound opt-out detection with shared logic + unit tests
- Request summary:
  - Continue autonomous hardening by protecting STOP/revocation behavior with deterministic tests and removing route-level regex drift.
- Files changed:
  - `apps/api/src/lib/optOut.ts`
  - `apps/api/src/lib/optOut.test.ts`
  - `apps/api/src/routes/assist.ts`
  - `apps/api/src/routes/voice.ts`
  - `package.json`
- Key behavior changes:
  - Added shared opt-out helpers:
    - `isOptOutText(...)`
    - `isOptOutDisposition(...)`
    - `resolveInboundSuppressionType(...)`
  - Replaced duplicated route regex logic with shared helper usage in both Assist and Voice routes.
  - Added focused tests for phrase/disposition detection and suppression-type resolution.
  - Added new opt-out test file to `pnpm test:hardening`.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending

### pending - feat: add compliance decision resolution lifecycle (open vs resolved)
- Request summary:
  - Continue autonomous hardening by making compliance queue items explicitly resolvable so operators can clear and audit actions over time.
- Files changed:
  - `packages/db/migrations/0019_compliance_decision_resolution.sql`
  - `packages/db/src/schema.ts`
  - `apps/api/src/routes/assist.ts`
  - `apps/web/src/app/(client)/client/call-control/page.tsx`
- Key behavior changes:
  - Added resolution fields on `compliance_decisions`:
    - `resolved_at`
    - `resolved_by`
    - `resolution_action`
    - `resolution_note`
  - `GET /api/v1/assist/compliance/decisions` now supports real open/resolved behavior:
    - `decision=open` returns unresolved BLOCK/MANUAL_REVIEW only.
    - `decision=resolved` returns resolved BLOCK/MANUAL_REVIEW records.
  - Added `POST /api/v1/assist/compliance/decisions/:id/resolve` for operator workflow.
  - Call Control actions (`Block Contact`, `Record Consent`) now resolve decisions after applying the action, and a new `Dismiss` action resolves false alarms without suppression/consent writes.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending

### pending - ops: include compliance health metrics in morning digest webhook
- Request summary:
  - Continue autonomous delivery by adding daily compliance telemetry into the existing scheduled digest workflow.
- Files changed:
  - `apps/api/src/routes/webhooks.ts`
- Key behavior changes:
  - `/webhooks/morning/digest` now returns per-tenant and aggregate compliance metrics for the digest lookback window:
    - `complianceAllow`
    - `complianceBlock`
    - `complianceManualReview`
    - `complianceOpen` (current unresolved BLOCK/MANUAL_REVIEW queue size)
  - This gives daily operational visibility into strict-mode pressure without requiring manual dashboard/API checks.
- Validation run:
  - pending after current edit set
- Commit hash:
  - pending
