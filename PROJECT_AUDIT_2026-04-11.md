# QYRO Project Audit

Generated: 2026-04-11  
Scope: Read-only code review of the current `qyro` monorepo state. No runtime deployment validation was performed, and no application files were modified as part of this audit.

## Executive Summary

QYRO is materially more complete than the older status and audit documents in the repository suggest. The codebase now supports a real multi-product platform:

- `QYRO Assist` is the most production-advanced surface: public widget chat, inbound voice, outbound call pipeline, booking, client dashboard, billing foundation, and operator controls are implemented.
- `QYRO Lead` is operational internally: lead discovery, research, outreach drafting, QA, approvals, and internal dashboards are present.
- Billing, webhooks, queues, SSE, daily summaries, and anti-scraping controls are also implemented beyond what the older audit files describe.

The primary gap is not missing features. It is trust hardening. The most important risks are around webhook authentication fail-open behavior, the practical strength of tenant isolation, and plaintext secret storage inside tenant metadata.

## Findings

### 1. High: Retell webhook and tool authentication fails open when the secret is missing

Files:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- [apps/api/src/index.ts](apps/api/src/index.ts)
- [apps/api/src/routes/retell.ts](apps/api/src/routes/retell.ts)

What is verified:

- `validateRetellRequest()` allows the request through if `RETELL_WEBHOOK_SECRET` is not configured.
- The route group is mounted publicly at `/api/v1/retell`.
- That surface includes webhook endpoints and tool endpoints that read tenant state and can update operational data paths.

Why this matters:

- In any environment where `RETELL_WEBHOOK_SECRET` is unset, Retell-facing endpoints effectively become public endpoints with no real authentication barrier.
- That is a production-hardening issue, not just a local-dev convenience issue, because the middleware does not fail closed when the secret is absent.

Impact:

- Forged webhook events.
- Unauthorized tool calls against business context, availability, booking, escalation, and DNC-related flows.

Recommendation:

- Fail closed in production when `RETELL_WEBHOOK_SECRET` is missing.
- Treat missing webhook secrets as a startup error for public providers.

### 2. High: SignalWire signature verification can be disabled with a production-use bypass flag

File:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)

What is verified:

- `validateSignalWireSignature()` allows a complete bypass when `SKIP_SW_SIGNATURE_CHECK=true`.
- The comment explicitly says it is a temporary Railway testing bypass.

Why this matters:

- If that variable is enabled in a real deployment, inbound voice requests, status callbacks, and transcript-related webhook paths lose origin authentication.

Impact:

- Forged call state changes.
- Untrusted voice traffic reaching assistant flows.
- False operational records in `call_attempts` and related downstream processing.

Recommendation:

- Remove the bypass or restrict it to non-production only.
- At minimum, make startup fail in production if `SKIP_SW_SIGNATURE_CHECK=true`.

### 3. High: The advertised RLS backstop is weaker than the docs imply

Files:

- [packages/db/migrations/0001_rls_policies.sql](packages/db/migrations/0001_rls_policies.sql)
- [packages/db/src/client.ts](packages/db/src/client.ts)
- [apps/api/src/middleware/tenant.ts](apps/api/src/middleware/tenant.ts)

What is verified:

- RLS policies do exist in migrations.
- Request handling sets tenant context with `setTenantContext()` before normal queries.
- The code does not wrap request handling in a transaction that guarantees subsequent queries run on the same DB session where `set_config('app.current_tenant_id', ...)` was set.

Why this matters:

- With pooled connections, session-local RLS context is only trustworthy if the context-setting query and subsequent queries are guaranteed to run on the same connection.
- The code comments describe transaction-local behavior, but the request path does not actually establish a request transaction boundary.

Impact:

- The application-level `tenant_id` filters are still doing most of the real isolation work.
- The database-layer “defense in depth” story should not be treated as fully reliable in its current form.

Recommendation:

- Move tenant-scoped request work into a per-request transaction or dedicated connection.
- Alternatively, treat explicit tenant filtering as the primary guarantee and document RLS as incomplete until connection affinity is enforced.

### 4. Medium: Tenant integration secrets are stored in plaintext JSON metadata

File:

- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)

What is verified:

- The settings API persists `calendarApiKey`, `apolloApiKey`, and `hunterApiKey` into tenant metadata.
- The GET path masks those values in responses, but the underlying storage remains plaintext JSONB.

Why this matters:

- Masking at read time is not encryption.
- A DB compromise, overly broad admin query, or accidental dump exposes third-party credentials directly.

Impact:

- Compromise of outbound enrichment providers.
- Compromise of calendar integrations.
- Broader cross-system blast radius than a normal tenant record leak.

Recommendation:

- Move secrets into an encrypted secrets table or external secret manager.
- Keep only presence flags and masked previews in tenant metadata.

### 5. Medium: Campaign approval and rejection flows are not audit logged

Files:

- [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)
- [apps/api/src/lib/auditLog.ts](apps/api/src/lib/auditLog.ts)

What is verified:

- List-style and some read operations call `logAudit()`.
- `POST /api/campaigns/:id/approve`, `POST /api/campaigns/:id/approve/:messageId`, and `POST /api/campaigns/:id/reject/:messageId` update operational state without writing an audit record.

Why this matters:

- Message approvals are exactly the kind of human-in-the-loop action that should be attributable.

Impact:

- Weaker accountability for outbound messaging decisions.
- Reduced forensic value for compliance review and debugging.

Recommendation:

- Add audit log writes for campaign approval, message approval, and message rejection actions.

### 6. Medium: Public rate limiting is designed to fail open if Redis is unavailable

File:

- [apps/api/src/middleware/rateLimit.ts](apps/api/src/middleware/rateLimit.ts)

What is verified:

- On Redis errors, rate limiting logs a warning and calls `next()`.

Why this matters:

- This is a reasonable uptime tradeoff for internal routes, but it weakens abuse resistance during the exact kind of dependency degradation where protective controls are most valuable.

Impact:

- Abuse windows during Redis outages.
- Reduced control against scraping or API bursts.

Recommendation:

- Keep authenticated routes fail-open if desired, but consider fail-closed or degraded local fallback for public surfaces.

### 7. Medium: Inbound voice prospect lookup still scans a capped recent set in memory

File:

- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)

What is verified:

- `findProspectByPhone()` fetches up to 200 recent prospects and then performs JS matching on normalized phone values.

Why this matters:

- This does not scale cleanly.
- It can miss older prospects beyond the 200-row window.

Impact:

- Duplicate or missing prospect linkage for inbound calls.
- Avoidable latency on call routing.

Recommendation:

- Normalize and index phone numbers for direct DB lookup.

## Current Capabilities

### QYRO Assist

Verified in current code:

- Public widget chat with origin allowlisting and per-IP Redis rate limiting.
- Public missed-call flow.
- SignalWire voice webhook path.
- Retell webhook and tool surface.
- Inbound and outbound voice session handling.
- Conversation history persistence and compaction for voice.
- Appointment booking support.
- Client dashboard, conversations, calls, approvals, bookings, settings, outbound pipeline, and control surfaces.
- Daily summaries and realtime event publishing.

Overall assessment:

- This is the most complete product in the repo.
- It appears closest to sustained external use, assuming the security hardening items above are addressed.

### QYRO Lead

Verified in current code:

- Google Places-based lead discovery.
- Research pipeline with caching.
- Outreach drafting with QA enforcement.
- Reply triage and DNC handling.
- Campaign management and approval queues.
- Internal lead dashboard, campaigns, approvals, and settings.
- Nightly ingest and morning digest operational webhooks.

Overall assessment:

- The internal lead engine is real and operationally coherent.
- The public productization path is not complete yet, but the internal engine is substantially built.

### Billing and Commercial Surface

Verified in current code:

- Stripe checkout session creation.
- Billing portal session creation.
- Stripe webhook ingestion.
- Tenant subscription state persistence.
- Product access derivation from subscription state.
- Public pricing API.

Overall assessment:

- Billing foundation is implemented.
- Commercial onboarding is still asymmetric: Assist is being surfaced; Lead is still marked coming soon in public-facing UX.

### Platform and Ops

Verified in current code:

- BullMQ workers for research, outreach, reply triage, outbound calls, webhooks, and anomaly detection.
- RLS migrations and tenant-aware data model.
- Realtime pub/sub to SSE.
- Anti-scraping tables and rate-limit hit logging.
- PM2 and cron-oriented operational support.

Overall assessment:

- The operational platform is broader than the older docs imply.
- The main weakness is consistency and hardening, not basic capability.

## Comparative Report

### Docs vs Current Code

The repository’s older audit and status files understate the current implementation. The live code now includes capabilities that earlier docs describe as missing or incomplete.

Key verified differences:

- The outreach worker exists: [packages/workers/src/outreachWorker.ts](packages/workers/src/outreachWorker.ts)
- Billing routes exist and are wired: [apps/api/src/routes/billing.ts](apps/api/src/routes/billing.ts)
- RLS migration exists: [packages/db/migrations/0001_rls_policies.sql](packages/db/migrations/0001_rls_policies.sql)
- Public assist widget routes exist without Clerk auth: [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- Voice conversation history is persisted and compacted: [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- Architecture has progressed from Twilio-only assumptions to SignalWire plus optional Retell paths.

### Product State Comparison

`QYRO Assist`:

- Stronger public product readiness.
- Broader implemented workflow surface.
- Commercial path already present via pricing, onboarding, and billing plumbing.

`QYRO Lead`:

- Stronger internal operating capability than public go-to-market readiness.
- Core engine works as an internal tool, but public-facing productization still looks intentionally deferred.

### What Is Being Done As Of Now

Based on current code, the project is actively doing the following now:

- Selling or preparing to sell Assist as the public-facing product.
- Using Lead primarily as an internal engine.
- Running a multi-channel AI assistant stack with voice, widget chat, booking, and escalation.
- Operating billing-driven access control.
- Adding operational controls around rate limiting, anomaly detection, and summaries.

## What Could Work Best

The best near-term path is not a large feature push. It is a hardening pass focused on trust boundaries.

Priority order:

1. Fail closed on missing provider secrets for Retell and SignalWire-related public routes.
2. Make tenant isolation mechanically trustworthy at the DB/session layer, not just conceptually documented.
3. Move provider credentials out of plaintext tenant metadata.
4. Add audit coverage for all approve/reject flows.

Why this path is best:

- The platform already has enough capability to create value.
- The largest remaining risks are around authenticity, isolation, and accountability.
- Hardening these areas improves real production readiness more than adding another feature.

## Shortest Path Opportunities

These items appear to have the shortest path to meaningful improvement:

1. Remove or production-block `SKIP_SW_SIGNATURE_CHECK`.
2. Make missing `RETELL_WEBHOOK_SECRET` a fail-closed condition in production.
3. Add `logAudit()` to campaign approve/reject handlers.
4. Replace the 200-row inbound prospect scan with indexed phone lookup.
5. Expose Lead more publicly only after the trust-boundary issues above are closed, because the internal engine is already largely there.

## Changes Needed

Highest-value changes needed next:

- Provider auth hardening.
- Reliable tenant-isolation enforcement semantics.
- Secret storage redesign.
- Approval-path audit coverage.
- Small performance cleanup in phone matching and some fail-open controls.

## Can-Do Assessment

What the current project can already do credibly:

- Run a tenant-aware Assist product with chat, voice, booking, dashboards, and billing-backed access.
- Run an internal AI lead pipeline end to end from discovery through approval.
- Support operator workflows with queues, realtime updates, and summaries.

What it should not yet be trusted to do without changes:

- Rely entirely on provider webhook authenticity unless secrets and bypasses are locked down.
- Treat DB-layer RLS as a proven backstop without connection-affinity or transactional enforcement.
- Store more tenant API credentials in metadata as the integration surface grows.

## Final Assessment

This is not an early prototype anymore. It is an advanced product codebase with real multi-product capability, but it still has a few trust-boundary shortcuts that matter more than the remaining feature gaps.

If the goal is fastest path to stronger production readiness, the next win is a security and control-plane hardening sprint, not a broad new feature sprint.