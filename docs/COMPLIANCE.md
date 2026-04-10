# QYRO Compliance Reference
_Last updated: 2026-04-10_
_Read before enabling any new outreach channel or expanding voice volume._

## Current channel status

| Channel | Status | Notes |
|---|---|---|
| Email (outbound) | **ACTIVE** | Approval gate + DNC check required |
| SMS (outbound) | **ACTIVE** | Missed-call follow-up; implied consent path only |
| Voice (inbound) | **ACTIVE** | AI disclosure in greeting; SignalWire AI Agent |
| Voice (outbound — callback) | **ACTIVE** | DNC + consent check + capacity controls enforced |
| Voice (outbound — cold calling) | **BLOCKED** | Full TCPA gate below; do not enable without legal review |
| Website chat widget | **ACTIVE** | Inbound only; origin allowlisting enforced |

---

## Email compliance (active)

**What is required:**
- Every outbound email must include a clear unsubscribe mechanism
- Unsubscribes must be honored immediately — Reply Triage Agent adds to DNC on detection
- `do_not_contact` table must be checked before every send
- CAN-SPAM: include physical address in footer (use Zentryx LLC address)
- No misleading subject lines

**What QYRO does:**
- QA Guardrail blocks messages without a clear call to action
- Reply Triage classifies unsubscribes and adds to `do_not_contact` immediately
- Human approval gate prevents auto-send
- All sends logged to `message_attempts` with timestamp

---

## SMS compliance (active)

Inbound replies to missed-call SMS use an implied consent path (customer initiated contact).

**Requirements satisfied:**
- STOP keyword handling implemented in Reply Triage (maps to `unsubscribe`)
- `do_not_contact` checked before every send
- All SMS sends include "Reply STOP to opt out" in prompt packs

**Before enabling proactive SMS outreach (not missed-call):**
- [ ] Consent collection mechanism built (web form or inbound SMS opt-in)
- [ ] Consent records stored in `consent_events` table per prospect per channel
- [ ] HELP keyword auto-response implemented
- [ ] Sender ID registered (10DLC or toll-free number registered with carrier)
- [ ] Message frequency disclosed at opt-in

---

## Voice compliance — Inbound (active)

Customer calls the business forwarded number. AI picks up.
**Customer initiated contact — consent is implied.**

**Requirements satisfied:**
- AI disclosure in greeting: "Hi, you've reached [Business]. I'm an AI assistant
  and I can help with questions and booking. How can I help you today?"
- Call recording disclosure handled at SignalWire layer
- Escalation to human available at any point during call
- Transcripts stored with `call_attempts` for audit trail

**Ongoing monitoring required:**
- Review call transcripts weekly for unexpected AI behavior
- Monitor escalation rate — spike may indicate prompt or capability gaps
- Do not change greeting scripts without updating disclosure language

---

## Voice compliance — Outbound callback (active, controlled)

Outbound calls initiated from the QYRO outbound pipeline.
Currently limited to callback-or-consent-only numbers.

**Controls in place:**
- `do_not_contact` table checked before every dial
- Tenant-level pause/resume control
- Global pause via `OUTBOUND_VOICE_GLOBAL_PAUSED=true` env var
- Capacity throttle (max concurrent calls per tenant)
- DNC intent captured during live call → immediate suppression
- Retry schedule: 15 min / 2 hr / 1 day / 3 day (no-answer / busy)

**Calling hours enforcement — PARTIAL:**
- `DEFAULT_TIMEZONE` env var set; timezone per tenant in metadata
- Calling hours gate (8am–9pm local time) is planned but **not yet enforced in code**
- Until implemented: do not run outbound campaigns outside business hours manually
- [ ] TODO: Add calling-hours check in `outboundCallWorker.ts` before dial

**Before expanding outbound volume:**
- [ ] Confirm all numbers are business lines (not wireless personal numbers)
- [ ] Confirm all prospects have given prior consent or are business-to-business context
- [ ] Verify calling hours enforcement is implemented

---

## Voice compliance — Cold outbound calling (BLOCKED)

**Do not write or enable cold AI voice calling to wireless numbers.**

This remains blocked until ALL of the following are satisfied:

### Federal requirements (FCC / TCPA)
- [ ] Legal review completed for outbound AI voice calls
- [ ] FCC ruling confirmed: AI-generated voices = "artificial voice" under TCPA
- [ ] Prior express written consent process designed and implemented for wireless numbers
- [ ] Consent records stored with: timestamp, method, phone number, IP address
- [ ] AI disclosure script written ("This is an automated call from...")
- [ ] Opt-out mechanism works during live call (press 9 to opt out)

### State-specific requirements
- [ ] Oregon state rules reviewed
- [ ] Rules reviewed for each target state before launching in that state
- [ ] Do-Not-Call registry check implemented (FTC National DNC Registry)

### Technical requirements
- [ ] Call recording disclosure implemented at dial time
- [ ] DNC check runs before every call attempt (currently done for outbound pipeline)
- [ ] Calling hours enforcement implemented in worker (partially done — see above)
- [ ] Consent records verified at dial time, not just at enqueue time

---

## Do-Not-Contact rules (absolute — never override)

The `do_not_contact` table is the source of truth. These rules are absolute:

1. Before every outbound message (any channel), check `do_not_contact`
2. On any unsubscribe/stop signal, add immediately — do not wait for human review
3. Check by: email, phone, AND domain (if any match, do not contact)
4. Records are never deleted — only soft-flagged as resolved if there is a documented re-consent event
5. Export `do_not_contact` list monthly for backup

---

## Data minimization rules

- Store only what is needed for outreach and compliance
- Do not store raw scraped page HTML permanently — summaries only
- Call recordings: retain for 90 days, then delete (update `call_attempts` with `deleted_at`)
- Exports: auto-delete from object storage after 30 days
- Lead data from Apollo: governed by Apollo's terms — do not re-export or resell

---

## Incident response

If a compliance incident occurs (e.g. message sent to DNC contact):
1. Halt all outbound for the affected tenant immediately (`OUTBOUND_VOICE_GLOBAL_PAUSED=true`)
2. Document in `audit_logs`: what happened, when, how many records affected
3. Notify affected prospect with apology and confirmation of removal
4. Root-cause analysis before re-enabling outbound
5. Update this document with the incident and fix applied
