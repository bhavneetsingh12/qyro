# Strict TCPA Mode Rollout

This playbook is the operational path for enabling `tcpa_strict_mode` safely.

## 1) Prerequisites

- `consent_records`, `suppressions`, and `compliance_decisions` tables exist.
- Inbound opt-out ingestion is enabled:
  - Voice stop phrases
  - SMS STOP via `POST /api/v1/voice/sms/inbound`
  - Chat opt-out phrasing in widget intake
- Outbound compliance context is set per campaign when queueing calls (`campaignId`, `sellerName`, `automated`).

## 2) Dry Run

- Keep strict mode OFF.
- Queue sample outbound calls.
- Review compliance decisions:
  - `GET /api/v1/assist/compliance/decisions?decision=open`
  - `GET /api/v1/assist/compliance/report?days=7`

## 3) Enable Strict Mode

- In Assist Admin, enable **strict TCPA compliance mode**.
- Limit outbound volume for first 24 hours.
- Confirm consent capture is flowing from your lead/forms intake.

## 4) Daily Operations

- Check report:
  - `GET /api/v1/assist/compliance/report?days=1`
- Check anomaly alerts:
  - `GET /api/v1/assist/compliance/alerts`
- Work the manual-review queue from Call Control.

## 5) Incident Response

- If `BLOCK` or `MANUAL_REVIEW` spikes:
  - Pause outbound from Call Control.
  - Verify seller/channel/campaign metadata on enqueue payloads.
  - Verify consent disclosure capture in current lead source.
  - Resume gradually after correction.
