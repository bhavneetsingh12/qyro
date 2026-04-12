# QYRO Assist Operations Plan
_Last updated: 2026-04-12_
_Canonical operating plan for QYRO Assist chat, voice, booking, and calendar control._

## 1. Purpose

This document defines:
- what QYRO Assist does today
- where the active gaps are
- how chat, voice, booking, and calendar control should work together
- the phased implementation plan to make Assist reliable for launch and maintainable after launch

If this file and runtime code disagree, trust the code first, then update this file.

## 2. Current Runtime Truth

### Website chat

Website chat is already live.

Current path:
- embed script: `apps/web/public/widget.js`
- widget settings UI: `apps/web/src/app/(client)/client/widget/page.tsx`
- public chat API: `POST /api/v1/assist/chat`
- assistant engine: `packages/agents/src/agents/clientAssistant.ts`

Current behavior:
- website visitors send a chat message through the widget
- the message goes to `runClientAssistant()`
- the assistant classifies the intent as:
  - `question`
  - `booking_intent`
  - `escalate`
  - `unsubscribe`
- the assistant generates a reply using the approved prompt pack
- the reply is passed through QA guardrails
- the reply is stored as a `message_attempts` record with `pending_approval`
- escalation notifications can be triggered for high-risk or human-needed cases

Important note:
- chat is AI-backed today
- it is not yet positioned clearly in the UI as "website chat" or "website AI assistant"
- booking from chat is currently less mature than booking from SWAIG voice

### Voice

QYRO currently has two voice paths.

#### Path A: custom voice route

Files:
- `apps/api/src/routes/voice.ts`
- `packages/agents/src/agents/voiceAssistant.ts`

Current behavior:
- inbound SignalWire call hits `/api/v1/voice/incoming`
- QYRO resolves the tenant by voice number
- QYRO creates a session
- QYRO handles turns through `/api/v1/voice/turn`
- `voiceAssistant` delegates intent handling to `runClientAssistant()`
- escalation can transfer the live call to staff
- outbound calls are dialed by the outbound queue worker and use `/api/v1/voice/outbound/twiml`

#### Path B: SWAIG voice functions

Files:
- `apps/api/src/routes/swaig.ts`

Current behavior:
- SignalWire AI Agent calls SWAIG functions during voice conversations
- QYRO currently exposes these functions:
  - `business-info`
  - `book-appointment`
  - `escalate`
  - `callback-sms`

Important note:
- these two paths overlap in responsibility
- that overlap creates product ambiguity and operational drift
- one canonical voice orchestration path should own booking and business logic

### Booking

Booking is currently split across two logic paths.

#### Chat booking path

File:
- `packages/agents/src/agents/clientAssistant.ts`

Current behavior:
- if intent is `booking_intent`, the assistant selects a calendar adapter
- it fetches available slots
- it books the first available slot

Current weakness:
- this path uses generic adapter resolution and does not fully use tenant-specific integration configuration
- for multi-tenant production, this is not reliable enough to be the main booking path

#### SWAIG booking path

File:
- `apps/api/src/routes/swaig.ts`

Current behavior:
- resolves tenant
- finds or creates prospect
- normalizes provider from tenant metadata
- reads tenant integration secrets
- supports provider-specific fallback behavior:
  - Cal.com direct booking
  - booking-link SMS for Calendly or Acuity style flows
  - callback-only SMS flow for any business
- persists appointment record to QYRO

Current strength:
- this is the more mature path today because it handles fallback more safely

### Outbound calling

Primary file:
- `packages/queue/src/workers/outboundCallWorker.ts`

Current behavior:
- queue-based outbound dialing through SignalWire
- checks DNC before calling
- supports tenant pause and global pause
- applies tenant concurrency limits
- enforces retry windows
- enforces calling-hour guardrails using prospect timezone when possible

Current strength:
- outbound timezone protection already exists

Current weakness:
- call outcomes and UI language still expose internal system wording in several places

## 3. Known Gaps

### Gap 1: two different booking brains

Chat and voice do not rely on one shared booking service.

Effect:
- different channels can behave differently
- bug fixes need to be made in multiple places
- support and auditing become harder

### Gap 2: calendar adapter behavior is inconsistent

Current adapters are not equally production-ready.

Known issue:
- the Google Calendar adapter currently reads calendar events as returned slots instead of computing true free availability

Effect:
- Google-backed booking cannot be trusted for automatic slot selection until corrected

### Gap 3: QYRO is not yet the booking control plane

Today QYRO stores appointments, but it is not yet the operational source of truth for:
- staff-managed manual bookings
- vacation / blackout blocks
- provider availability changes
- cross-channel booking enforcement

Effect:
- human changes outside QYRO may not be reflected consistently in AI behavior
- AI may keep booking based on stale or incomplete availability assumptions

### Gap 4: direct OpenAI call exists outside the shared runner

File:
- `apps/api/src/routes/swaig.ts`

Current issue:
- `business-info` calls OpenAI directly instead of the shared runner

Effect:
- weaker cost visibility
- weaker quota consistency
- harder to standardize AI behavior

### Gap 5: channel naming and product explanation are unclear

Current examples:
- "Widget" is used where "Website chat" would be clearer
- booking states like `missing_phone` surface too directly in UI
- customers cannot easily understand what is AI, what is human-assisted, and what is pending approval

## 4. Recommended Product Model

## 4.1 Default AI strategy

Recommendation:
- ship a managed QYRO chat AI by default for every Assist customer
- do not support bring-your-own-model in the initial operating model

Reasoning:
- QYRO needs one supportable behavior baseline
- BYO model increases:
  - safety risk
  - prompt drift
  - output inconsistency
  - support burden
  - cost debugging complexity

Possible future upgrade path:
- BYO AI can become an enterprise or advanced tier later
- if added later, it should be implemented as:
  - constrained model/provider choice
  - still wrapped in QYRO safety and approval rules
  - tenant-scoped usage accounting

## 4.2 Booking model

Recommendation:
- QYRO should become the booking control plane
- the external calendar provider should become the sync target and availability source

That means:
- users should be able to create and manage business time rules from QYRO
- QYRO should read external availability
- QYRO should write confirmed bookings back to the provider
- QYRO should write blackout/vacation blocks back to the provider when supported
- AI should only book through the shared QYRO booking service

This is the safest operational design because:
- humans and AI use the same rules
- outbound and inbound flows use the same schedule logic
- support teams can explain one booking system, not multiple

## 5. Calendar Control Strategy

The correct long-term design is:

### QYRO owns booking policy

QYRO should own:
- booking mode
- buffer rules
- working hours policy
- provider assignment rules
- escalation/callback fallback rules
- blackout blocks created in QYRO

### External provider owns canonical calendar state

The external calendar should remain the event system of record for actual booked time.

QYRO should:
- read availability from the provider
- create bookings on the provider
- update or cancel bookings on the provider
- mirror the result into QYRO `appointments`

### Why this model works

This lets the customer:
- continue using Google Calendar, Cal.com, or another provider
- make manual bookings or blocks from QYRO
- have those changes appear in the external calendar
- prevent AI from booking stale availability

## 6. Required Calendar Features

To support "QYRO as the booking control plane", the platform should support these actions:

### Manual booking from QYRO

Use cases:
- human takes over a call and wants to book directly
- staff wants to add a phone booking manually

Expected behavior:
- booking created in QYRO UI
- booking written to external provider
- local QYRO appointment record updated with provider booking id

### Blackout / vacation management

Use cases:
- owner goes on vacation
- provider is unavailable for certain hours
- special closures or holidays

Expected behavior:
- staff creates a blackout in QYRO
- QYRO writes the block to the provider when supported
- if provider-level block writing is not supported, QYRO must still enforce the block in its own booking service before allowing AI booking

### Unified availability resolution

Availability must be computed from:
- provider calendar busy times
- QYRO blackout blocks
- tenant business hours
- optional per-staff availability rules
- buffer times

AI must only book against this unified availability result.

## 7. Booking Modes Per Tenant

Each tenant should have one explicit booking mode:

### `direct_booking`

Use when:
- provider integration is fully configured
- availability resolution is trustworthy
- writeback is verified

Behavior:
- AI can directly book confirmed appointments

### `booking_link_sms`

Use when:
- customer uses a self-serve booking system
- QYRO should send the caller/chat visitor a scheduling link

Behavior:
- AI captures intent
- QYRO sends link by SMS or chat
- QYRO records the attempt

### `callback_only`

Use when:
- integration is incomplete
- business wants manual confirmation
- high reliability is more important than automation

Behavior:
- AI captures requested date/time/service
- QYRO alerts staff
- staff confirms manually

For launch, `callback_only` and `booking_link_sms` are the safest defaults unless a tenant integration has been proven end-to-end.

## 8. Phased Implementation Plan

### Phase 1: truth and consolidation

Goals:
- define one operating model
- eliminate ambiguity between channels

Tasks:
1. Create one shared booking service for chat and voice
2. Move SWAIG business-info onto the shared AI runner
3. Define one canonical voice orchestration path
4. Normalize UI wording from "Widget" to "Website chat"
5. Add per-channel outcome wording that is business-readable

### Phase 2: calendar correctness

Goals:
- make automated booking trustworthy

Tasks:
1. Fix Google Calendar availability logic
2. Resolve tenant-specific provider config in one place
3. Support provider capability flags:
   - read availability
   - create booking
   - cancel booking
   - create blackout block
4. Add booking mode to tenant settings
5. Audit all direct booking claims in UI

### Phase 3: QYRO as booking control plane

Goals:
- let humans and AI use the same system

Tasks:
1. ✅ Shared booking execution service (`packages/agents/src/bookingService.ts`)
2. ✅ Blackout/vacation blocks — `blackout_blocks` table + API CRUD + UI tab
3. ✅ Manual booking from QYRO — `POST /api/appointments/manual` + UI modal
4. ✅ AI booking blocked during active blackout blocks
5. ✅ Provider writeback — blackout blocks push busy events to Google Calendar; manual bookings write to provider if `supportsDirectBooking`; Cal.com block writeback not supported (no native API)
6. Add provider/staff-level availability rules (future)

### Phase 4: launch hardening

Goals:
- make operations measurable and supportable

Tasks:
1. Add booking metrics and failure reasons
2. Add call metrics and live voice-path visibility
3. Add AI usage and channel-cost visibility
4. Add operator-facing logs for:
   - why booking failed
   - why a call was delayed
   - why a reply required approval

## 9. Launch Recommendation

For near-term launch, the safest configuration is:
- managed QYRO chat AI enabled
- one chosen live voice path
- outbound voice enabled with timezone gating
- direct booking only for verified tenants
- everyone else on `booking_link_sms` or `callback_only`

This gives customers immediate value without pretending that every calendar integration is production-perfect.

## 10. Immediate Build Order

Build in this order:

1. ✅ Shared booking service — `packages/agents/src/bookingService.ts`
2. ✅ Manual booking + blackout controls in Assist — API + UI
3. ✅ Provider writeback — manual bookings + blackout blocks sync to external calendar
4. Canonical voice-path decision and consolidation
5. Google availability fix
6. UI wording cleanup and clearer operational states (ongoing)

