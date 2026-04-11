# QYRO Review-First List

Generated: 2026-04-11  
Scope: Read-only prioritized review guide based on the current codebase and prior audit reports. No code or configuration changes were made.

Related reports:

- [QYRO_EXECUTIVE_SUMMARY_2026-04-11.md](QYRO_EXECUTIVE_SUMMARY_2026-04-11.md)
- [PROJECT_AUDIT_2026-04-11.md](PROJECT_AUDIT_2026-04-11.md)
- [QYRO_SECURITY_REPORT_2026-04-11.md](QYRO_SECURITY_REPORT_2026-04-11.md)
- [QYRO_ASSIST_DEEP_REPORT_2026-04-11.md](QYRO_ASSIST_DEEP_REPORT_2026-04-11.md)
- [QYRO_LEAD_DEEP_REPORT_2026-04-11.md](QYRO_LEAD_DEEP_REPORT_2026-04-11.md)

## Purpose

This is the best order to review the system if the goal is deeper understanding before deciding what to fix.

The order is not based on code size. It is based on leverage:

- what most affects production trust
- what explains the real architecture fastest
- what unlocks understanding of both products at once
- what helps you judge later fixes correctly

## Review Order

### 1. Provider authentication and public ingress

Review first:

- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- [apps/api/src/index.ts](apps/api/src/index.ts)
- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)

Why first:

- This is the highest-risk trust boundary in the whole repo.
- It determines who can reach the system from outside and under what conditions.
- It explains the real production exposure surface faster than any other area.

What you will understand after reviewing it:

- how public traffic enters QYRO
- how SignalWire, SWAIG, widget chat, and missed-call flows are authenticated
- where the code currently fails closed versus fails open
- which ingress paths matter most for Assist

What to look for:

- bypass flags
- secret-required versus secret-optional behavior
- public mounts in the API index
- trust assumptions around provider callbacks

### 2. Tenant isolation and database trust model

Review second:

- [packages/db/src/client.ts](packages/db/src/client.ts)
- [apps/api/src/middleware/tenant.ts](apps/api/src/middleware/tenant.ts)
- [packages/db/migrations/0001_rls_policies.sql](packages/db/migrations/0001_rls_policies.sql)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)

Why second:

- This is the architectural backbone of the whole multi-tenant system.
- If you do not understand this layer clearly, it is easy to misunderstand how safe the rest of the code really is.

What you will understand after reviewing it:

- how tenant identity is established per request
- how RLS is intended to work
- why the current app-level filtering is still critical
- where the gap is between the documented security model and runtime certainty

What to look for:

- session versus transaction assumptions
- use of `adminDb`
- where `tenant_id` is enforced in queries
- where metadata carries tenant-type meaning

### 3. Entitlements, billing, and product access

Review third:

- [apps/api/src/routes/billing.ts](apps/api/src/routes/billing.ts)
- [apps/api/src/lib/entitlements.ts](apps/api/src/lib/entitlements.ts)
- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)
- [apps/api/src/routes/pricing.ts](apps/api/src/routes/pricing.ts)
- [apps/web/src/app/products/page.tsx](apps/web/src/app/products/page.tsx)
- [apps/web/src/app/onboarding/page.tsx](apps/web/src/app/onboarding/page.tsx)

Why third:

- This tells you what the business model is in actual code, not just in docs.
- It also clarifies why Assist is currently the more public-facing product and why Lead is still positioned differently.

What you will understand after reviewing it:

- how product access is granted and revoked
- how billing state affects tenant behavior
- how onboarding routes users into products
- where product strategy shows up in implementation

What to look for:

- subscription state handling
- trial and override logic
- product access resolution
- places where metadata is still doing too much

### 4. QYRO Assist operating flow

Review fourth:

- [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- [apps/api/src/lib/escalation.ts](apps/api/src/lib/escalation.ts)
- [packages/queue/src/workers/outboundCallWorker.ts](packages/queue/src/workers/outboundCallWorker.ts)
- [packages/queue/src/workers/webhookWorker.ts](packages/queue/src/workers/webhookWorker.ts)
- [apps/web/src/app/(client)/client/dashboard/page.tsx](apps/web/src/app/(client)/client/dashboard/page.tsx)
- [apps/web/src/app/(client)/client/calls/page.tsx](apps/web/src/app/(client)/client/calls/page.tsx)

Why fourth:

- Assist is the clearest near-term product, so this gives the best understanding of how QYRO creates customer-facing value.

What you will understand after reviewing it:

- inbound conversation lifecycle
- session persistence and escalation behavior
- outbound callback/control logic
- how the client portal reflects backend operations

What to look for:

- session creation and linkage
- escalation paths and alert reliability
- outbound call queueing and retries
- places where provider auth and tenant access intersect with runtime logic

### 5. QYRO Lead operating flow

Review fifth:

- [apps/api/src/routes/leads.ts](apps/api/src/routes/leads.ts)
- [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts)
- [packages/agents/src/agents/research.ts](packages/agents/src/agents/research.ts)
- [packages/agents/src/agents/outreach.ts](packages/agents/src/agents/outreach.ts)
- [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)
- [apps/web/src/app/(internal)/internal/leads/page.tsx](apps/web/src/app/(internal)/internal/leads/page.tsx)
- [apps/web/src/app/(internal)/internal/leads/[id]/page.tsx](apps/web/src/app/(internal)/internal/leads/[id]/page.tsx)

Why fifth:

- Once you understand ingress, tenancy, and billing, you can judge Lead correctly as an internal acquisition engine rather than a generic lead-generation feature set.

What you will understand after reviewing it:

- how discovery, research, and outreach fit together
- where QA and human approvals enter the workflow
- why Lead is already operationally useful even if still not fully public-facing

What to look for:

- deduplication strategy
- skip reasons and DNC logic
- research quality controls
- QA gating before message persistence

### 6. Audit, governance, and operator accountability

Review sixth:

- [apps/api/src/lib/auditLog.ts](apps/api/src/lib/auditLog.ts)
- [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)
- [apps/api/src/routes/leads.ts](apps/api/src/routes/leads.ts)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)

Why sixth:

- This is where you determine whether important actions are merely possible or also properly attributable.

What you will understand after reviewing it:

- what the system records today
- where operator actions are visible
- where compliance and forensic gaps remain

What to look for:

- state-changing actions without audit writes
- export tracking
- approval and rejection flows
- whether audit events are consistent across products

### 7. Secrets and settings management

Review seventh:

- [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)
- [apps/api/src/lib/escalation.ts](apps/api/src/lib/escalation.ts)
- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)

Why seventh:

- By this point you will know what the system needs from each provider and can judge whether the current settings model is acceptable or too permissive.

What you will understand after reviewing it:

- which secrets are tenant-scoped
- which are environment-wide
- where configuration risk enters production behavior

What to look for:

- plaintext secrets in metadata
- masked display versus actual storage
- missing-secret handling
- fallback behavior that is too permissive

### 8. Queue, worker, and automation fabric

Review eighth:

- [packages/workers/src/researchWorker.ts](packages/workers/src/researchWorker.ts)
- [packages/workers/src/outreachWorker.ts](packages/workers/src/outreachWorker.ts)
- [packages/workers/src/replyTriageWorker.ts](packages/workers/src/replyTriageWorker.ts)
- [packages/queue/src/workers/outboundCallWorker.ts](packages/queue/src/workers/outboundCallWorker.ts)
- [packages/queue/src/workers/webhookWorker.ts](packages/queue/src/workers/webhookWorker.ts)
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts)

Why eighth:

- This explains how the system keeps working beyond direct HTTP request-response paths.
- It is also where many reliability and scale assumptions live.

What you will understand after reviewing it:

- how async operations are processed
- where retries happen
- what failure modes are handled or ignored
- how nightly and morning automation support Lead operations

What to look for:

- retry policies
- dead-letter behavior
- idempotency handling
- handoff from synchronous routes to queues

## Fastest Understanding Path

If you want the shortest practical path to strong understanding, use this condensed sequence:

1. Auth and public ingress.
2. Tenant isolation and DB trust model.
3. Billing and entitlements.
4. Assist runtime flow.
5. Lead runtime flow.

That gives you the best system-level understanding in the least time.

## What To Notice As You Review

Across every area, keep these questions in mind:

1. Is this path public or internal?
2. What identity or secret does it trust?
3. Is the control fail-open or fail-closed?
4. Is tenant isolation guaranteed here or just expected?
5. Is the action attributable afterward?
6. Is this logic shaping Assist, Lead, or both?

Those questions will keep the review focused on what matters most.

## Final Guidance

Do not start with the biggest files. Start with the files that define trust, tenancy, access, and product shape.

That is the fastest way to stop seeing QYRO as a pile of routes and workers and start seeing it as what it actually is:

- one shared platform
- one public-facing AI receptionist product
- one internal lead engine
- a codebase that mostly needs hardening and governance clarity more than new foundational functionality