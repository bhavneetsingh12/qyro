# QYRO Compliance Reference
_Read before enabling any new outreach channel. Voice is gated behind this document._

## Current channel status

| Channel | Status | Notes |
|---|---|---|
| Email (outbound) | Active — Phase 1 | Approval gate required |
| SMS (outbound) | Phase 2 | Requires consent records first |
| Voice (outbound) | Phase 5 — BLOCKED | See gate below |
| Voice (inbound callback) | Phase 5 — BLOCKED | Lower risk but still gated |
| Website chat widget | Phase 2 | Inbound only, low risk |

---

## Email compliance (current)

**What is required:**
- Every outbound email must include a clear unsubscribe mechanism
- Unsubscribes must be honored immediately — Reply Triage Agent adds to DNC on detection
- do_not_contact table must be checked before every send
- CAN-SPAM: include physical address in footer (use Zentryx LLC address)
- No misleading subject lines

**What QYRO does:**
- QA Guardrail blocks messages without a clear call to action
- Reply Triage classifies unsubscribes and adds to do_not_contact immediately
- Human approval gate prevents auto-send
- All sends logged to message_attempts with timestamp

---

## SMS compliance (Phase 2 gate)

Before enabling SMS outbound:
- [ ] Consent collection mechanism built (web form or inbound SMS opt-in)
- [ ] Consent records stored in consent_events table per prospect per channel
- [ ] STOP keyword handling implemented in Reply Triage (maps to "unsubscribe")
- [ ] HELP keyword auto-response implemented
- [ ] Sender ID registered (10DLC or toll-free number registered with Twilio)
- [ ] Message frequency disclosed at opt-in

---

## Voice compliance gate (Phase 5)

**Do not write any Twilio voice code until ALL of these are checked:**

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
- [ ] Twilio subaccount created (separate from dev/staging)
- [ ] Call recording disclosure implemented ("This call may be recorded")
- [ ] DNC check runs before every call attempt
- [ ] Call attempt logged to call_attempts before dialing
- [ ] Outcome logged after call completes

### What Phase 5 voice looks like (inbound callback first)
1. Prospect misses a call or fills a form → SMS/email follow-up sent first
2. If they reply with interest → offer a callback (human or AI)
3. AI callback only after explicit "yes please call me back" — that IS consent
4. No cold outbound AI voice calls to wireless numbers without written consent

---

## Do-Not-Contact rules

The do_not_contact table is the source of truth. These rules are absolute:

1. Before every outbound message (any channel), check do_not_contact
2. On any unsubscribe/stop signal, add immediately — do not wait for human review
3. Check by: email, phone, AND domain (if any match, do not contact)
4. Records are never deleted — only soft-flagged as resolved if there is a documented re-consent event
5. Export do_not_contact list monthly for backup

---

## Data minimization rules

- Store only what is needed for outreach and compliance
- Do not store raw scraped page HTML permanently — summaries only
- Call recordings: retain for 90 days, then delete (update call_attempts with deleted_at)
- Exports: auto-delete from object storage after 30 days
- Lead data from Apollo: governed by Apollo's terms — do not re-export or resell

---

## Incident response

If a compliance incident occurs (e.g. message sent to DNC contact):
1. Halt all outbound for the affected tenant immediately
2. Document in audit_logs: what happened, when, how many records affected
3. Notify affected prospect with apology and confirmation of removal
4. Root-cause analysis before re-enabling outbound
5. Update this document with the incident and fix applied
