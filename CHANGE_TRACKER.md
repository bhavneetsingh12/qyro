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
