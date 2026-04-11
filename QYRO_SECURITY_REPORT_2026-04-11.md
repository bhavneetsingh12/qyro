# QYRO Security Report

Generated: 2026-04-11  
Scope: Read-only security-focused review of the current QYRO codebase. No fixes were applied.

## Executive Summary

QYRO already contains several strong security-oriented design choices:

- tenant-scoped schema design
- RLS migration coverage
- rate limiting
- DNC enforcement
- audit log table and helper
- provider signature verification logic
- entitlement-based product access

The main security problem is not the absence of controls. It is that some critical controls can fail open, be bypassed, or are not fully dependable in practice.

## Highest-Priority Findings

### 1. High: Retell route authentication fails open if the secret is unset

Files:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- [apps/api/src/index.ts](apps/api/src/index.ts)
- [apps/api/src/routes/retell.ts](apps/api/src/routes/retell.ts)

Verified behavior:

- `validateRetellRequest()` logs a warning and allows the request through when `RETELL_WEBHOOK_SECRET` is absent.
- `/api/v1/retell` is mounted as a public route group.

Risk:

- Webhooks and Retell tool endpoints lose meaningful authentication when the secret is missing.

Why it matters:

- Those endpoints are not passive. They can influence bookings, conversation state, and business context reads.

Priority:

- P0 for any public deployment using Retell.

### 2. High: SignalWire voice verification can be completely bypassed by env flag

File:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)

Verified behavior:

- `SKIP_SW_SIGNATURE_CHECK=true` short-circuits provider signature verification.

Risk:

- If enabled outside a controlled local/test case, voice ingress authenticity collapses.

Why it matters:

- Attackers could forge provider callbacks or mutate call state via untrusted requests.

Priority:

- P0 for production hardening.

### 3. High: RLS exists, but the connection/session semantics are not strong enough to treat it as a dependable backstop

Files:

- [packages/db/migrations/0001_rls_policies.sql](packages/db/migrations/0001_rls_policies.sql)
- [packages/db/src/client.ts](packages/db/src/client.ts)
- [apps/api/src/middleware/tenant.ts](apps/api/src/middleware/tenant.ts)

Verified behavior:

- The code sets tenant context with `set_config('app.current_tenant_id', ...)`.
- The request path is not wrapped in a transaction that pins later queries to the same DB session.

Risk:

- The codebase appears to rely on RLS as defense in depth, but the runtime pattern does not make that guarantee mechanically strong.

Why it matters:

- This weakens the safety story for a multi-tenant system handling customer communications and billing data.

Priority:

- P0/P1 depending on how much you currently rely on explicit tenant filters versus RLS for assurance.

### 4. Medium: Secrets are stored in plaintext tenant metadata

File:

- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)

Verified behavior:

- Calendar and enrichment provider keys are stored directly in metadata.

Risk:

- DB leaks, backups, or broad admin queries expose third-party credentials.

Why it matters:

- This turns a normal tenant data exposure event into a wider external-service compromise.

Priority:

- P1.

### 5. Medium: Audit coverage is incomplete for critical state changes

Files:

- [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)
- [apps/api/src/lib/auditLog.ts](apps/api/src/lib/auditLog.ts)

Verified behavior:

- Some operational reads are audited.
- Campaign approval and message approval/rejection paths are not.

Risk:

- Weak accountability for human decisions affecting outbound messaging.

Priority:

- P1.

### 6. Medium: Rate limiting is intentionally fail-open on Redis outage

File:

- [apps/api/src/middleware/rateLimit.ts](apps/api/src/middleware/rateLimit.ts)

Verified behavior:

- Redis errors produce a warning and allow the request.

Risk:

- Abuse protection disappears during dependency degradation.

Priority:

- P2 overall, but higher for public endpoints if abuse risk is material.

### 7. Medium: Inbound prospect lookup uses a capped in-memory search

File:

- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)

Verified behavior:

- Up to 200 recent prospects are loaded, then JS matching is performed on phone numbers.

Risk:

- Incorrect linkage and degraded performance under scale.
- This is more reliability than classic security, but it can affect data integrity.

Priority:

- P2.

## Existing Security Strengths

These are real positives in the codebase now:

### Tenant-aware schema discipline

The schema in [packages/db/src/schema.ts](packages/db/src/schema.ts) is broadly tenant-centered and consistently uses `tenant_id` across core business tables.

### DNC and consent controls

The system includes DNC tables, consent state, and runtime gating across outreach and outbound flows.

### Provider verification logic is present

Even though some paths are too permissive, the project already has the right shape of verification middleware for:

- Clerk auth
- SignalWire
- Retell
- SWAIG

### Rate limiting and anti-abuse scaffolding

The project has Redis-backed rate limiting and dedicated anti-scraping schema support, which is better than many internal-first projects reach.

### Billing-backed entitlements

Access is not purely cosmetic. Product access is derived from subscription state in [apps/api/src/routes/billing.ts](apps/api/src/routes/billing.ts) and [apps/api/src/lib/entitlements.ts](apps/api/src/lib/entitlements.ts).

## Threat Model Notes

The highest-risk QYRO surfaces are the public provider ingress points and tenant settings plane.

Most sensitive trust boundaries:

1. Public webhooks and provider callbacks.
2. Public widget and assist ingress.
3. Tenant-scoped data separation.
4. Tenant configuration containing integration secrets.
5. Approval paths affecting outbound communication.

If these are hardened, the broader architecture becomes much more defensible without major redesign.

## What Could Work Best

The best security path is a control-plane hardening pass focused on four areas:

1. Make public-provider auth fail closed.
2. Remove or production-block test bypasses.
3. Strengthen tenant isolation mechanics at the DB session/transaction level.
4. Move secrets into proper protected storage.

Why this path works best:

- It addresses the most consequential failure modes first.
- It increases trust in the product without requiring major product redesign.
- It upgrades the current architecture rather than replacing it.

## Short Path Security Wins

These have the shortest likely path to meaningful security improvement:

1. Block startup or request handling when `RETELL_WEBHOOK_SECRET` is missing in production.
2. Remove or hard-block `SKIP_SW_SIGNATURE_CHECK` in production.
3. Add audit logging for approval/rejection actions.
4. Move provider secrets out of tenant metadata.
5. Convert inbound phone matching to indexed DB lookup.

## Final Assessment

QYRO is not security-empty. It already has several thoughtful controls. The issue is that some of the most important ones are not strict enough at the exact trust boundaries that matter most.

The project is closest to being secure enough for broader use once the public-ingress authentication behavior, tenant-isolation confidence, and secret-handling model are tightened.