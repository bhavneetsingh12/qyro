# QYRO Architecture Decision Records
_Last updated: 2026-04-11_

## ADR-001: Two products on one shared platform
Date: 2026-03-30 | Status: Accepted

QYRO Lead and QYRO Assist share one codebase, one API, one DB, and one infra layer, with tenant-aware separation.

## ADR-002: Drizzle ORM over Prisma
Date: 2026-03-30 | Status: Accepted

Chosen for SQL-near ergonomics, easier tenancy review, and lightweight runtime behavior.

## ADR-003: Tenant isolation via middleware plus RLS
Date: 2026-03-30 | Status: Accepted

Tenant scoping is explicit in application logic and reinforced with DB policy/context.

## ADR-004: `gpt-4o-mini` as the default agent tier
Date: 2026-03-30 | Status: Accepted

Escalate to `gpt-4o` only where the quality/cost tradeoff is justified.

## ADR-005: API-only lead sourcing
Date: 2026-03-30 | Status: Accepted

No scraping-based growth path. Public APIs only.

## ADR-006: Google Places API as the lead discovery source
Date: 2026-04-03 | Status: Accepted

Google Places is the active discovery source; Apollo/Hunter are enrichment tools, not discovery engines.

## ADR-007: Resend for transactional email
Date: 2026-04-03 | Status: Accepted

Transactional email uses a thin REST integration.

## ADR-008: Stripe webhook as entitlement authority
Date: 2026-04-05 | Status: Accepted

Subscription state and access posture are synchronized from Stripe webhook events.

## ADR-009: SignalWire as the active voice transport
Date: 2026-04-05 | Status: Accepted

SignalWire is the current provider for signed voice ingress, outbound calling, and SWAIG-based voice actions.

## ADR-010: Provider-neutral voice field naming
Date: 2026-04-05 | Status: Accepted

Schema and app code use provider-neutral names such as `voice_number` and `call_sid`.

## ADR-011: Railway cron services over n8n for scheduled execution
Date: 2026-04-06 | Status: Accepted

Scheduled ingest and digest operations run through code-first cron entrypoints in `apps/crons/`.

Historical n8n files may exist temporarily, but they are not the active execution path.

## ADR-012: Retell decommissioned
Date: 2026-04-11 | Status: Accepted

Retell is no longer part of the active product/runtime direction. Architecture, docs, and operational checklists should not present it as a supported path.

## ADR-013: Public ingress must be signed, secret-authenticated, or fail-closed rate-limited
Date: 2026-04-11 | Status: Accepted

Every public-facing route must clearly declare its trust boundary and degrade safely.

## ADR-014: Canonical doc set is limited
Date: 2026-04-11 | Status: Accepted

The live documentation set is:
- `docs/ARCHITECTURE.md`
- `docs/ENVIRONMENTS.md`
- `docs/AGENTS.md`
- `docs/COMPLIANCE.md`
- `docs/DECISIONS.md`
- `docs/TOKEN_BUDGET.md`
- `CHANGE_TRACKER.md`
- `CLAUDE.md`

Snapshot reports and one-off generated audits are archival material, not source of truth.
