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

### Pending hash - feat: async webhook processing via BullMQ, idempotency on Retell handlers
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

## Ongoing Update Rule
- For each new user command, append a new entry with:
  - timestamp/date
  - summary of request
  - files changed
  - key behavior changes
  - validation steps run
  - commit hash (once committed)
