# QYRO Project Memory
_Last updated: 2026-04-11_
_This file is collaboration memory and session guidance, not a replacement for the canonical docs._

## 1. What To Trust

For current system truth, use these files:
- `docs/ARCHITECTURE.md`
- `docs/ENVIRONMENTS.md`
- `docs/AGENTS.md`
- `docs/COMPLIANCE.md`
- `docs/DECISIONS.md`
- `docs/TOKEN_BUDGET.md`
- `CHANGE_TRACKER.md`
- this file

Do not use snapshot audits, generated summaries, or old implementation runbooks as active guidance.

## 2. Project Summary

QYRO operates two product surfaces on one shared platform:
- QYRO Lead: internal lead-generation and outreach operations
- QYRO Assist: customer-facing assistant with chat, voice, booking, approvals, dashboards, and billing

Current active voice/provider direction:
- SignalWire is active
- SWAIG is active
- Retell is decommissioned

Current active scheduling direction:
- Railway cron services are active
- n8n is not the active execution path

## 3. Session Rules

1. Read this file first.
2. Read only the canonical docs relevant to the task.
3. Load only the code you need.
4. Prefer updating source-of-truth docs over creating new summary files.
5. If code and docs disagree, fix the docs after confirming the code path.

## 4. Collaboration Rules

1. Keep work scoped and explicit.
2. Prefer a small number of high-trust docs over many generated reports.
3. Avoid introducing new historical/runbook files unless there is an operational reason.
4. If you change platform behavior, update the canonical docs in the same workstream.

## 5. Current Priorities

High-value platform hardening still pending:
- encrypt `tenant_integration_secrets` at rest
- improve automated tests around auth, tenancy, billing, and outbound controls
- standardize route/version naming over time
- keep generated artifacts out of source paths

## 6. Repo Hygiene Rules

1. `src/` should contain source, not generated JavaScript or declaration output.
2. `dist/` is build output and should not be treated as evidence of live architecture.
3. Historical reports should be archived or deleted, not treated as living docs.

## 7. When Updating Docs

If you change behavior in:
- API routing: update `docs/ARCHITECTURE.md`
- env/secrets/deploy flow: update `docs/ENVIRONMENTS.md`
- agent behavior: update `docs/AGENTS.md`
- channel/policy rules: update `docs/COMPLIANCE.md`
- long-lived design decisions: update `docs/DECISIONS.md`
- LLM budget/model routing: update `docs/TOKEN_BUDGET.md`
- shipped history: append to `CHANGE_TRACKER.md`
