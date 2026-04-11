# QYRO Fix Roadmap

Generated: 2026-04-11  
Scope: Read-only implementation planning document. This report translates the earlier audits into a practical fix roadmap with priorities, impact, effort, and likely file touch points. No application code was changed.

Assumption locked for this roadmap:

- SignalWire is the primary provider for numbers and agent flows.
- Retell is out of scope unless explicitly reintroduced later.
- Retell-related work is treated as cleanup or decommissioning, not forward-path hardening.

## How To Read This

Priority levels:

- `P0`: should be reviewed and likely fixed before broader production scaling
- `P1`: important hardening and governance work
- `P2`: reliability, clarity, and operational quality improvements

Effort labels:

- `Low`: narrow change, few files, limited blast radius
- `Medium`: multiple files or architectural coordination
- `High`: deeper change to runtime assumptions or data model

## P0

### P0-1. Lock provider direction and decommission Retell from the forward path

Why:

- The repo still carries mixed architecture signals.
- That causes wasted review and hardening effort on a provider you are not using going forward.

Impact:

- High

Effort:

- Medium

What we would do:

- identify every public route, doc, env var, and UI/settings surface that still assumes Retell is active
- decide whether to remove Retell code entirely or mark it deprecated and unreachable
- update architecture docs so the system is clearly SignalWire-first

Primary files to review first:

- [apps/api/src/index.ts](apps/api/src/index.ts)
- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- [apps/api/src/routes/retell.ts](apps/api/src/routes/retell.ts)
- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)
- [apps/web/src/app/(client)/client/settings/page.tsx](apps/web/src/app/(client)/client/settings/page.tsx)
- [CLAUDE.md](CLAUDE.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [retell_twilio_instructions.md](retell_twilio_instructions.md)
- [.env.example](.env.example)

Decision point:

- keep dormant Retell code behind zero reachable public surface, or remove it entirely

### P0-2. Remove any production path that can bypass SignalWire trust validation

Why:

- This is the most important live ingress control if SignalWire is the main provider.

Impact:

- Very high

Effort:

- Low

What we would do:

- block `SKIP_SW_SIGNATURE_CHECK` from ever being usable in production
- make startup or request handling fail loudly if production trust assumptions are broken

Primary files:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- [apps/api/src/index.ts](apps/api/src/index.ts)

### P0-3. Reclassify every public route by trust type

Why:

- The API is now broad enough that implicit route assumptions are risky.
- You want an explicit list of what is public, provider-only, internal-secret-only, and tenant-authenticated.

Impact:

- High

Effort:

- Medium

What we would do:

- inventory all mounts in the API index
- label each route group by required trust mechanism
- align middleware and docs to that classification

Primary files:

- [apps/api/src/index.ts](apps/api/src/index.ts)
- [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts)
- [apps/api/src/routes/swaig.ts](apps/api/src/routes/swaig.ts)
- [apps/api/src/routes/pricing.ts](apps/api/src/routes/pricing.ts)

Deliverable of this step:

- a clean route trust matrix

### P0-4. Make tenant isolation mechanically trustworthy

Why:

- The schema and RLS migration are strong on paper, but the runtime connection model needs review before you can fully trust it.

Impact:

- Very high

Effort:

- High

What we would do:

- decide whether to enforce per-request transaction-scoped tenant context or simplify the model and rely explicitly on application filtering
- remove ambiguity between documented isolation and real isolation

Primary files:

- [packages/db/src/client.ts](packages/db/src/client.ts)
- [apps/api/src/middleware/tenant.ts](apps/api/src/middleware/tenant.ts)
- [packages/db/migrations/0001_rls_policies.sql](packages/db/migrations/0001_rls_policies.sql)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)

Architecture note:

- this is a correctness fix, not just a documentation update

## P1

### P1-1. Move tenant provider secrets out of metadata

Why:

- Plaintext credential storage in tenant metadata is too permissive.

Impact:

- High

Effort:

- High

What we would do:

- define a dedicated secret-storage model
- separate operator-visible settings from sensitive credentials
- preserve masked displays in UI while changing storage semantics

Primary files:

- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)
- [apps/web/src/app/(client)/client/settings/page.tsx](apps/web/src/app/(client)/client/settings/page.tsx)
- [apps/web/src/app/(internal)/internal/settings/page.tsx](apps/web/src/app/(internal)/internal/settings/page.tsx)

### P1-2. Fill audit-log gaps on approvals, rejections, and other critical mutations

Why:

- Human approvals are high-value governance points and need attribution.

Impact:

- High

Effort:

- Low to Medium

What we would do:

- add audit writes for campaign approval, message approval, and message rejection
- review other operator mutation endpoints for similar gaps

Primary files:

- [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)
- [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- [apps/api/src/lib/auditLog.ts](apps/api/src/lib/auditLog.ts)

### P1-3. Clean up docs and product direction around SignalWire-first Assist plus internal Lead

Why:

- The docs are carrying too much legacy direction and mixed provider language.

Impact:

- Medium to High

Effort:

- Medium

What we would do:

- rewrite provider references
- align architecture and roadmap language with actual code direction
- make Lead versus Assist positioning consistent

Primary files:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CLAUDE.md](CLAUDE.md)
- [PROJECT_STATUS.md](PROJECT_STATUS.md)
- [PROJECT_AUDIT.md](PROJECT_AUDIT.md)
- [QYRO_ASSIST_INSTRUCTIONS.md](QYRO_ASSIST_INSTRUCTIONS.md)

### P1-4. Review public-rate-limit behavior and decide where fail-open is acceptable

Why:

- Failing open is sometimes pragmatic, but it should be an intentional decision per surface.

Impact:

- Medium

Effort:

- Medium

What we would do:

- separate internal-route resilience policy from public-surface abuse policy
- decide whether widget, missed-call, and provider ingress should degrade differently on Redis failures

Primary files:

- [apps/api/src/middleware/rateLimit.ts](apps/api/src/middleware/rateLimit.ts)
- [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts)

## P2

### P2-1. Replace capped in-memory phone matching with indexed lookups

Why:

- This is a small but meaningful correctness and scale improvement.

Impact:

- Medium

Effort:

- Low to Medium

What we would do:

- normalize phone matching strategy
- query directly by indexed/normalized phone instead of scanning recent rows

Primary files:

- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)
- any related migration file under [packages/db/migrations](packages/db/migrations)

### P2-2. Strengthen escalation reliability and observability

Why:

- Escalation should be more than best-effort if Assist is a serious client product.

Impact:

- Medium

Effort:

- Medium

What we would do:

- improve alert delivery reliability
- make skipped alert conditions easier to notice operationally
- decide whether escalation notifications belong in queue-backed retry flow

Primary files:

- [apps/api/src/lib/escalation.ts](apps/api/src/lib/escalation.ts)
- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [packages/queue/src/workers/webhookWorker.ts](packages/queue/src/workers/webhookWorker.ts)

### P2-3. Improve visibility into skipped leads, blocked outreach, and dead-letter conditions

Why:

- The system already has strong gating logic, but operators need better visibility into what the system chose not to do.

Impact:

- Medium

Effort:

- Medium

What we would do:

- expose skipped research reasons more clearly
- surface blocked-by-QA and DLQ conditions in UI or admin reporting
- make pipeline stalls easier to inspect

Primary files:

- [apps/web/src/app/(internal)/internal/leads/page.tsx](apps/web/src/app/(internal)/internal/leads/page.tsx)
- [apps/web/src/app/(internal)/internal/approvals/page.tsx](apps/web/src/app/(internal)/internal/approvals/page.tsx)
- [packages/workers/src/outreachWorker.ts](packages/workers/src/outreachWorker.ts)
- [packages/workers/src/researchWorker.ts](packages/workers/src/researchWorker.ts)

### P2-4. Tighten queue and worker operational clarity

Why:

- The async architecture is already broad. Better clarity will reduce debugging cost and runtime confusion.

Impact:

- Medium

Effort:

- Medium

What we would do:

- review retry schedules, idempotency, and dead-letter handling
- improve observability for async failures

Primary files:

- [packages/queue/src/workers/webhookWorker.ts](packages/queue/src/workers/webhookWorker.ts)
- [packages/queue/src/workers/outboundCallWorker.ts](packages/queue/src/workers/outboundCallWorker.ts)
- [packages/queue/src/workers/anomalyDetectionWorker.ts](packages/queue/src/workers/anomalyDetectionWorker.ts)
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts)

## Recommended Execution Order

If the goal is best sequence rather than fastest isolated fix, use this order:

1. `P0-1` Provider-direction cleanup
2. `P0-2` SignalWire trust hardening
3. `P0-3` Public-route trust classification
4. `P0-4` Tenant-isolation fix or architecture clarification
5. `P1-1` Secret-storage redesign
6. `P1-2` Audit-log coverage completion
7. `P1-3` Documentation and product-alignment cleanup
8. `P1-4` Rate-limit failure-policy review
9. `P2-1` Phone lookup reliability improvement
10. `P2-2` Escalation reliability improvements
11. `P2-3` Operator visibility improvements
12. `P2-4` Queue and worker observability improvements

## Best First Sprint

If you want a first focused sprint, I would scope it like this:

Sprint 1:

- remove Retell from the active architecture story
- harden SignalWire trust path
- classify public routes and trust assumptions
- decide and document the real tenant-isolation strategy

Why this sprint first:

- it resolves the largest uncertainty in the system
- it reduces future wasted effort
- it makes later fixes more coherent

## What We Should Not Start With

Not first:

- UI polish
- new features
- public Lead productization
- low-value refactors
- provider-agnostic abstractions that do not match the actual SignalWire-first direction

## Final Recommendation

The right next move is not “fix random issues.” It is to sequence fixes so trust, tenancy, and product direction become stable first.

If you want the best practical next step after this roadmap, it is:

1. open a Phase 1 implementation plan just for `P0-1` through `P0-4`
2. list exact files and intended changes for that phase only
3. execute after that in small, verified steps