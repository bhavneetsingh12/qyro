# Retell + Twilio Implementation Instructions

Last updated: 2026-04-03
Owner: QYRO Assist Voice Migration
Status: Approved implementation path

## 1) Goal

Upgrade QYRO Assist from Twilio default voice (`<Say>/<Gather>`) to a receptionist-grade realtime voice system.

Target architecture:
- Twilio: phone numbers, PSTN, inbound/outbound telephony
- Retell: realtime conversational voice runtime
- QYRO API: business tools, booking, escalation, compliance, DND, call state persistence
- QYRO web client: call control, metrics, visibility, operations

## 2) Scope

In scope:
- Inbound voice migration to Retell runtime
- Outbound call initiation migration to Retell runtime
- Retell webhook ingestion and call state persistence
- Retell tool endpoints for QYRO business actions
- Keep existing QYRO call control and queue governance

Out of scope (for this migration phase):
- Stripe billing implementation
- Self-serve onboarding
- New calendar providers beyond current adapters

## 3) Existing QYRO components to keep

Keep these files/components as platform foundation:
- `apps/api/src/routes/assist.ts` (outbound controls, metrics, queue operations)
- `packages/queue/src/workers/outboundCallWorker.ts` (capacity/compliance controls)
- `apps/web/src/app/(client)/client/call-control/page.tsx` (operator UI)
- `apps/api/src/routes/tenants.ts` (tenant settings metadata)
- `packages/agents/src/agents/clientAssistant.ts` (core business response logic)

## 4) Components to replace or refactor

Primary replacement target:
- `apps/api/src/routes/voice.ts`

Current behavior:
- Twilio TwiML `<Say>/<Gather>` loop

Target behavior:
- Twilio call enters Retell runtime
- Retell handles live conversational speech
- QYRO API is invoked as tool layer and source-of-truth

## 5) New API endpoints to add (planned)

Retell control/webhook endpoints:
- `POST /api/v1/retell/call-events`
- `POST /api/v1/retell/transcript-events`

Retell tool endpoints:
- `POST /api/v1/retell/tools/get-business-context`
- `POST /api/v1/retell/tools/check-availability`
- `POST /api/v1/retell/tools/create-booking`
- `POST /api/v1/retell/tools/escalate-to-human`
- `POST /api/v1/retell/tools/mark-do-not-contact`
- `POST /api/v1/retell/tools/log-call-outcome`

Security requirement:
- All Retell webhooks/tools must verify provider signature/token before processing.

## 6) Data/state mapping

Call lifecycle mapping target:
- initiated -> dialing
- ringing -> ringing
- active -> answered
- ended -> completed | no_answer | busy | failed

Persist in QYRO tables:
- `call_attempts` for status/outcome/timestamps
- `assistant_sessions` for session-level conversation linkage
- `do_not_contact` for opt-out/DND events

## 7) Outbound flow target

1. Existing enqueue route creates `call_attempts` rows (keep)
2. Worker picks queued attempt (keep)
3. Worker calls Retell outbound call create API instead of direct Twilio Calls API
4. Retell runtime executes conversation and posts events to QYRO webhook endpoint
5. QYRO updates status/outcome and schedules retry if required

Critical guardrails (keep):
- tenant pause/global pause
- max concurrent call throttle
- DND suppression
- compliance block behavior

## 8) Inbound flow target

1. Twilio number receives inbound call
2. Twilio routes call to Retell (or Retell-provided telephony bridge model)
3. Retell drives conversation and tool calls
4. QYRO tool endpoints return business answers/booking actions
5. QYRO persists call/session/transcript references

## 9) Environment variables (expected)

Retell-specific placeholders to add in `.env.local` when implementing:
- `RETELL_API_KEY`
- `RETELL_AGENT_ID_DEFAULT`
- `RETELL_WEBHOOK_SECRET`
- `RETELL_BASE_URL` (if needed by SDK/client)

Existing Twilio/QYRO vars still required:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `PUBLIC_API_BASE_URL`
- `OUTBOUND_VOICE_GLOBAL_PAUSED`

## 10) Implementation phases

Phase A — Inbound migration (first)
- Add Retell webhook verification middleware
- Implement Retell call event route
- Wire inbound telephony path to Retell
- Persist inbound statuses and transcripts

Phase B — Tooling layer
- Implement tool endpoints
- Wire booking/escalation/DND/business-context tools
- Add structured logging and error envelopes

Phase C — Outbound migration
- Change worker outbound initiation path to Retell API
- Keep queue governance and retry scheduling in QYRO
- Verify cancellation/pause/resume continue working

Phase D — QA and rollout
- Run scenario tests (10 receptionist scripts minimum)
- Validate latency, barge-in, booking success, DND handling
- Staged rollout by tenant

## 11) Test checklist

Must-pass before production tenant rollout:
- Inbound greeting sounds natural and consistent
- Caller interruption (barge-in) works
- Booking flow succeeds and persists correctly
- Escalation flow works with clear user messaging
- DND request suppresses future calls
- Pause/resume/global pause behavior still enforced
- Call control counters remain accurate
- Retry scheduling still functions on no-answer/busy

## 12) Risk controls

- Keep old voice path behind feature flag until Retell path is stable
- Enable migration by tenant-level voice runtime mode
- Store all webhook payload IDs to prevent duplicate processing
- Fail closed on webhook signature mismatch

## 13) Done criteria

This migration is complete when:
- One production-intended tenant uses Retell voice path end-to-end
- Inbound + outbound both run through Retell runtime
- QYRO control center remains authoritative for operations
- Call quality is approved against receptionist benchmark scripts

## 14) Notes

- This document is the execution runbook for Retell + Twilio implementation.
- Update this file at the end of each implementation phase with outcomes and blockers.

## 15) Progress Update (2026-04-03)

Phase A/B/C partial implementation completed:

Completed in code:
- Added Retell route surface at `apps/api/src/routes/retell.ts`
- Added signed mount in API index: `/api/v1/retell`
- Added Retell request verification middleware (`validateRetellRequest`)
- Added call event + transcript event ingestion handlers
- Added Retell tool endpoints:
  - get-business-context
  - check-availability
  - create-booking
  - escalate-to-human
  - mark-do-not-contact
  - log-call-outcome
- Updated outbound worker to support runtime selection:
  - `voice_runtime=retell` -> Retell outbound create call API
  - default fallback remains Twilio
- Added Retell env keys to `.env.example`

Completed after the initial slice:
- Twilio inbound call path now supports Retell handoff in `apps/api/src/routes/voice.ts`
- Retell request verification now supports provider-style HMAC-SHA256 payload verification using captured raw request bodies
- Retell webhook events are now logged in `webhook_events` and duplicate call/transcript payloads are skipped
- Public assist widget routes now enforce origin allowlisting and basic rate limiting
- Tenant settings API now supports `voice_runtime`, `retell_agent_id`, and `widget_allowed_origins`
- Phase D QA harness added at `scripts/test-retell-phase-d.ts`

Still required before production rollout:
- Run the live receptionist benchmark scripts against real Twilio + Retell subscriptions
- Configure tenant-level `widget_allowed_origins`, `voice_runtime`, and `retell_agent_id`
- Verify one production-intended tenant end-to-end with real PSTN calls

Next implementation step:
- Execute the Phase D script locally, then run the 10 live receptionist scenarios and enable one pilot tenant only
