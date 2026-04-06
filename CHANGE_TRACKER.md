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

## Ongoing Update Rule
- For each new user command, append a new entry with:
  - timestamp/date
  - summary of request
  - files changed
  - key behavior changes
  - validation steps run
  - commit hash (once committed)
