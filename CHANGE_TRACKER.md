# Change Tracker

Purpose: running log of all changes made in this workspace session series so follow-up commands have clear traceability.

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

## Ongoing Update Rule
- For each new user command, append a new entry with:
  - timestamp/date
  - summary of request
  - files changed
  - key behavior changes
  - validation steps run
  - commit hash (once committed)
