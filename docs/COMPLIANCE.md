# QYRO Compliance Reference
_Last updated: 2026-04-11_
_Canonical compliance and channel-usage policy._

## 1. Current Channel Status

| Channel | Status | Notes |
|---|---|---|
| Email outbound | ACTIVE | approval + DNC required |
| SMS outbound | ACTIVE, controlled | missed-call and approved workflows only |
| Voice inbound | ACTIVE | SignalWire-backed |
| Voice outbound callback | ACTIVE, controlled | DNC, pause, capacity, calling-hours controls |
| Cold outbound AI voice | BLOCKED | legal/compliance gate not cleared |
| Website widget chat | ACTIVE | origin allowlisting enforced |

## 2. Core Rules

1. `do_not_contact` is authoritative across channels.
2. Unsubscribe/STOP intent must be honored immediately.
3. Human approval remains required for outbound messaging unless a feature is explicitly designed otherwise.
4. Customer-facing AI must disclose itself when required by channel context.

## 3. Email

Required:
- unsubscribe path
- DNC check before send
- truthful content and subject
- operator approval

## 4. SMS

Allowed active uses:
- missed-call follow-up
- approved outbound workflows

Required:
- DNC check
- opt-out support
- STOP handling

## 5. Voice Inbound

Inbound voice is active and customer-initiated.

Required:
- AI disclosure in greeting
- escalation path when needed
- transcript/call record retention per policy

## 6. Voice Outbound Callback

Allowed only for controlled callback/compliant operational use.

Current controls in code:
- tenant pause/resume
- global pause
- capacity throttling
- DNC suppression
- retry scheduling
- calling-hours enforcement in the outbound worker

## 7. Cold Outbound Voice

Still blocked.

Do not enable until:
- legal review is complete
- consent requirements are explicitly implemented
- state-by-state requirements are documented
- live opt-out and consent-verification controls are proven

## 8. Data Minimization

- store only what is needed for operations, billing, compliance, and support
- avoid unnecessary retention of provider payloads and exported data
- review call and message retention periodically

## 9. Incident Response

If a compliance failure occurs:

1. pause outbound activity
2. write audit records
3. contain the affected path
4. perform root-cause analysis
5. update this document or the architecture docs if the policy changed

## 10. Compliance Backlog

Still worth doing:

1. document record-retention windows more explicitly by table/provider
2. add automated tests around DNC and outbound control behavior
3. add stricter evidence capture for future consent-sensitive voice expansion
