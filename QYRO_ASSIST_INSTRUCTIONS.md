# QYRO Assist — Build Instructions
# Hand this to Claude Code at the start of any QYRO Assist session.
# Read alongside CLAUDE.md and docs/BLUEPRINT.md.
# Last updated: 2026-04-03

---

## What QYRO Assist is

QYRO Assist is a full AI-powered customer communication assistant for local businesses.
It handles ALL inbound customer touchpoints on behalf of the business:

1. Voice calls — AI picks up, greets, answers questions, checks calendar,
   books appointments, confirms booking, transfers to staff if needed
2. Website chat widget — customer asks questions on the business website
3. Missed-call SMS — customer called, no one answered → auto SMS follow-up
4. Email follow-up — re-engage cold leads or unanswered inquiries
5. Eventually outbound voice — Phase 5, gated behind COMPLIANCE.md

---

## Compliance — read before building voice

INBOUND voice (building now):
- Customer calls the business number. AI picks up.
- Customer initiated — consent is implied.
- Only requirement: disclose AI at start of call.
- Disclosure: "Hi, you've reached [Business]. I'm an AI assistant
  and I can help with questions and booking. How can I help you today?"

OUTBOUND cold calling (NOT building — Phase 5):
- TCPA applies. FCC AI voice ruling applies. Needs legal review.
- Blocked in COMPLIANCE.md. Do not build.

SMS (building now):
- Inbound reply to missed-call — implied consent.
- Always include: "Reply STOP to opt out."
- Check do_not_contact before every send.

---

## Calendar provider architecture

Use adapter pattern — one interface, multiple implementations.

interface CalendarAdapter {
  getAvailableSlots(params) → Slot[]
  getProviders() → Provider[]
  createBooking(params) → Booking
  cancelBooking(bookingId) → void
  getBooking(bookingId) → Booking
}

Phase 2: Google Calendar + Cal.com
Phase 3: Calendly + Square Appointments

Client selects provider in settings. Adapter loaded from tenant metadata.calendar_provider.

---

## Voice call flow

Customer calls business Twilio number
→ POST /api/v1/voice/incoming
→ Look up tenant by Twilio number
→ Create call_attempts + assistant_session
→ AI greets: "Hi, you've reached [Business]. I'm an AI assistant. How can I help?"
→ Customer speaks → Twilio transcribes → POST /api/v1/voice/turn
→ Voice Assistant Agent processes:
   - Question → answer from FAQ
   - Book appointment → ask service → ask provider if applicable
     → fetch slots → present 2-3 options → customer picks
     → confirm booking → "You're booked for Tuesday at 2pm with Sarah. Repeat?"
     → send confirmation SMS
   - Wants human → transfer via TwiML Dial
   - Complaint/complex → transfer to staff
→ Log transcript to call_attempts
→ Update assistant_session

---

## Session plan

### Session AA — Calendar adapters
Build: packages/agents/src/calendars/
Files: types.ts, googleCalendar.ts, calCom.ts, index.ts (factory)
Test: both adapters compile without errors. Stop.

### Session AB — Client Assistant Agent (text)
Build: packages/agents/src/agents/clientAssistant.ts
- Loads tenant context + prompt pack
- Detects intent: question | booking_intent | escalate | unsubscribe
- For booking: uses calendar adapter to find + create booking
- Compacts history every 6 turns using compact.ts
- Runs QA Guardrail before returning reply
- Returns: { reply, intent, escalate, bookingId?, sessionId }
Stop when agent file complete.

### Session AC — Voice Assistant Agent
Build: packages/agents/src/agents/voiceAssistant.ts
- Wraps clientAssistant with voice constraints
- Responses max 2-3 sentences, speakable, no lists
- Handles: greeting, processTurn, confirmBooking, transferToStaff
- Uses clientAssistant internally for intent + booking
Stop when agent file complete.

### Session AD — Voice routes (Twilio)
Build: apps/api/src/routes/voice.ts
Routes:
- POST /api/v1/voice/incoming — Twilio webhook, returns TwiML greeting
- POST /api/v1/voice/turn — processes each turn, returns TwiML response
- POST /api/v1/voice/status — call ended, handles missed call → SMS queue
Mount in index.ts. Stop when routes return valid TwiML.

### Session AE — Text/SMS/widget routes
Expand: apps/api/src/routes/assist.ts
Add:
- POST /api/v1/assist/chat (widget/SMS/email)
- POST /api/v1/assist/missed-call
- POST /api/v1/assist/approve/:messageId
- POST /api/v1/assist/reject/:messageId
- GET /api/v1/assist/pending
Stop when all routes work.

### Session AF — Prompt packs
Create docs/PROMPTS/assist/:
1. general_faq_v1.md — FAQ for widget/email/voice
2. general_missed_call_sms_v1.md — SMS follow-up (160 char max)
3. general_followup_email_v1.md — cold lead re-engagement
4. general_voice_v1.md — voice-specific (2-3 sentences per turn)
All must follow frontmatter schema from medspa_missed_call_v1.md.
Stop when all four files created.

### Session AG — Widget JavaScript
Build: apps/web/public/widget.js
- Self-contained, no dependencies
- Shadow DOM for CSS isolation
- Chat bubble bottom-right
- Posts to POST /api/v1/assist/chat
- Stores sessionId in localStorage
- Embed: <script src="widget.js" data-tenant-id="..." data-primary-color="#F59E0B">
- Test on plain HTML file. Stop when renders correctly.

### Session AH — Client portal updates
Update apps/web/src/app/(client)/:
1. settings/page.tsx — add calendar provider, staff/providers list,
   auto-respond toggle, business hours, Twilio number display
2. approvals/page.tsx — NEW: pending messages, approve/reject, auto-refresh
3. calls/page.tsx — NEW: call log with transcripts, filter by outcome
Add Calls + Approvals to ClientSidebar.
Stop when all three pages render.

### Session AI — End to end test
Create: scripts/test-assist-e2e.ts
12 steps:
1. Create test assistant tenant
2. Widget chat → session created
3. Confirm pending_approval message
4. Approve message → status sent
5. Second message → turn_count incremented
6. Booking intent → calendar adapter called
7. Appointment row created
8. Missed-call → SMS queued
9. Voice incoming → TwiML greeting returned
10. Voice turn → AI response returned
11. Voice missed → SMS enqueued
12. Cleanup
All 12 must pass. Fix issues. Stop.

---

## Hard rules

1. Never send to customer without approval (until auto_respond ON)
2. Never promise services not in approved_services
3. Never quote prices outside approved_price_range
4. Check do_not_contact before every outbound message
5. Always run QA Guardrail before storing any message
6. Escalate: complaint, legal, threat, abusive language
7. Never deny being AI if asked — disclose and offer transfer
8. SMS max 160 chars per segment
9. Voice max 2-3 sentences per turn
10. No outbound cold calling — inbound only until Phase 5
11. SMS must include "Reply STOP to opt out"
12. One session at a time. /compact when done. Stop.

---

## Session startup

/clear
Read CLAUDE.md + QYRO_ASSIST_INSTRUCTIONS.md
Check checklist for next session
Load only files listed for that session
Build that one session
/compact when done
git add . && git commit -m "feat: QYRO Assist Session XX complete"
git push
/clear

---

## Completion checklist

[ ] Session AA — Calendar adapters (Google Calendar + Cal.com)
[ ] Session AB — clientAssistant.ts (text agent)
[ ] Session AC — voiceAssistant.ts (voice agent)
[ ] Session AD — Voice routes (Twilio inbound + turn + status)
[ ] Session AE — Text/SMS/widget API routes
[ ] Session AF — Prompt packs (FAQ, SMS, email, voice)
[ ] Session AG — widget.js embeddable chat widget
[ ] Session AH — Client portal: providers + approval queue + calls page
[ ] Session AI — End to end test

All 9 sessions = QYRO Assist v1 ready for first client.
