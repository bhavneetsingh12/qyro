# QYRO Architecture Decision Records

Format: ## ADR-NNN: Title | Date | Status

---

## ADR-001: n8n as workflow orchestrator (not custom workers for v1)
Date: 2026-03-30 | Status: Accepted

**Decision:** Use n8n Cloud in queue mode as the workflow orchestrator for Phase 1.

**Reasons:**
- Faster to wire up workflows without writing job queue boilerplate
- Visual workflow editor useful for non-engineering review of approval gates
- Queue mode (Postgres + Redis backend) is production-ready and scalable
- Can migrate individual workflows to code-first workers later without changing the API

**Trade-offs accepted:**
- n8n can become messy if business logic creeps in — all config and prompts stay in git, not n8n
- Business data stays in Postgres, not inside n8n workflow state

**Revisit when:** workflow count exceeds ~50 or n8n costs become significant

---

## ADR-002: Drizzle ORM (not Prisma)
Date: 2026-03-30 | Status: Accepted

**Decision:** Use Drizzle ORM for all database access.

**Reasons:**
- TypeScript-first, schema defined in TS (better for monorepo)
- Closer to SQL — easier to audit for tenant scoping
- Better Postgres RLS support
- Lighter runtime than Prisma

**Trade-offs accepted:**
- Less ecosystem tooling than Prisma
- Fewer auto-generated utilities

---

## ADR-003: Tenant isolation via both RLS and application-level scoping
Date: 2026-03-30 | Status: Accepted

**Decision:** Enforce tenant isolation at two layers: (1) Postgres Row Level Security policies, (2) explicit tenant_id in every query via middleware.

**Reasons:**
- Defense in depth — if application layer has a bug, RLS is a backstop
- Easier to audit — tenant_id visible in every query
- RLS alone is insufficient because admin operations need service role

**Implementation:**
- RLS policy: `CREATE POLICY tenant_isolation ON table USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`
- Middleware: `apps/api/src/middleware/tenant.ts` sets context on every request

---

## ADR-004: cheap model (gpt-4o-mini) as default for all agents
Date: 2026-03-30 | Status: Accepted

**Decision:** Default all agents to gpt-4o-mini. Escalate to gpt-4o only for booking (slot parsing) and complex client assistant sessions. claude-sonnet-4-6 for premium plan only.

**Reasons:**
- Cost: gpt-4o-mini is ~17x cheaper than gpt-4o on output tokens
- Quality is sufficient for classification, triage, outreach drafts
- Booking needs better language understanding for time slot parsing
- Premium model kept as a plan differentiator

**Revisit when:** output quality from cheap model degrades measurably on real data

---

## ADR-005: Voice (Twilio) deferred to Phase 4
Date: 2026-03-30 | Status: Accepted

**Decision:** No voice calling in Phase 1, 2, or 3.

**Reasons:**
- FCC has ruled AI-generated voices in robocalls are "artificial" under TCPA
- Requires prior express written consent for outbound calls to wireless numbers
- State-specific rules vary and require legal review before scale
- Compliance infrastructure (consent records, DNC checks, disclosure logic) must be solid first

**Phase 4 gate requirements:**
- Consent records implemented and audited
- Legal review of Oregon + target state rules completed
- Only inbound voice (missed-call callback) at first, not outbound cold calling

---

## ADR-006: No Maps scraping — API-only lead sourcing
Date: 2026-03-30 | Status: Accepted (amended by ADR-009)

**Decision:** Lead sourcing uses APIs only. No web scraping of Google Maps or other directories that prohibit it.

**Reasons:**
- Google Maps ToS explicitly prohibits bulk export of business data
- Legal and reputational risk outweighs cost of using API
- APIs provide permitted, reliable, attributable data

**See ADR-009** for the actual implementation: Google Places API is the sole search source; Apollo is used only for email enrichment, not lead search.

---

## ADR-007: Two separate products on one shared platform
Date: 2026-03-30 | Status: Accepted

**Decision:** QYRO Lead and QYRO Assist are two separate sellable products
that share one codebase, one database, and one infrastructure layer.
Separated at runtime by tenant_type.

**Reasons:**
- Separate positioning: QYRO Lead targets agencies/sales teams,
  QYRO Assist targets local businesses — different buyers, different pricing
- Shared infrastructure reduces maintenance cost vs two separate codebases
- Tenant_type flag is cheap to implement and easy to extend
- Backend agents are largely reusable across both products

**Trade-offs accepted:**
- Slightly more complex routing logic (tenant_type checks in middleware)
- Must be careful not to leak Lead features into Assist UI and vice versa

**Revisit when:** Products diverge so significantly that shared codebase
becomes a liability (unlikely before $1M ARR)

---

## ADR-009: Google Places API (New) as sole lead search source
Date: 2026-04-03 | Status: Accepted

**Decision:** `leadDiscovery.ts` uses Google Places API (New) (`places.googleapis.com/v1/places:searchText`) as the only lead search source. Apollo is not called for search. A `searchPlaces()` stub exists but returns `[]` (disabled to avoid duplicates). Apollo is used only inside `emailEnrichment.ts` for domain-level email lookup.

**Why this differs from the original spec (ADR-006):**
- The `places:searchText` endpoint in the Google Places API (New) returns business name, address, phone, and website in one call — sufficient for lead ingestion without Apollo.
- Apollo API is better suited to email/contact enrichment than raw business discovery in local-service niches.
- Simpler data flow: one search source, one enrichment source, clear separation.

**Trade-offs accepted:**
- `searchApollo()` is a misleading function name (calls Google Places, not Apollo). This is a known naming issue — documented here, fix when convenient.
- Apollo lead count and firmographic data are not available at discovery time.

**Revisit when:** coverage gaps appear in niches or geographies where Google Places data is thin.

---

## ADR-010: Resend for transactional email
Date: 2026-04-03 | Status: Accepted

**Decision:** Transactional email (outreach sends) uses Resend via a thin REST wrapper in `apps/api/src/lib/sendEmail.ts`. No SDK, raw `fetch` to `api.resend.com`.

**Reasons:**
- Resend has a clean, stable REST API that doesn't warrant an SDK dependency.
- Developer-friendly domain verification and test-mode sandbox.
- Lower cost and simpler integration than SendGrid or Mailgun for initial scale.
- No SDK means one fewer dependency to audit for supply-chain risk.

**Environment variables required:** `RESEND_API_KEY`, `EMAIL_FROM`

**Trade-offs accepted:**
- No automatic retries or webhooks from Resend (bounces/complaints must be polled or handled via webhook separately).

**Revisit when:** email volume exceeds ~10K/month or bounce handling needs automation.

---

## ADR-011: Raw SQL for user upsert in seed script
Date: 2026-04-03 | Status: Accepted (workaround)

**Decision:** `infra/seed.ts` uses `client.unsafe()` raw SQL for the `users` table upsert rather than Drizzle's typed insert.

**Reason:** Drizzle ORM has a known OID resolution bug with custom Postgres enums (specifically the `role` enum) on `postgres-js` when running upserts with `ON CONFLICT DO UPDATE`. The raw SQL workaround avoids the OID mismatch that causes a runtime error.

**Scope:** Seed script only. All application code uses Drizzle typed queries.

**Revisit when:** Drizzle releases a fix for the enum OID issue, at which point this can be replaced with `db.insert(users).values(...).onConflictDoUpdate(...)`.

---

## ADR-012: PM2 for process management in development and production
Date: 2026-04-03 | Status: Accepted

**Decision:** PM2 (`infra/pm2/ecosystem.config.cjs`) manages the API server and BullMQ workers as named processes. Not specified in the original blueprint — added during Phase 1 to make multi-process local dev and production restarts practical.

**Processes defined:**
- `qyro-api` — Express API server (`pnpm --filter @qyro/api dev`)
- `qyro-research-worker` — Research queue worker
- `qyro-outreach-worker` — Outreach queue worker

**Reasons:**
- Without PM2, each worker requires a separate terminal and manual restart on crash.
- PM2 provides auto-restart, log aggregation, and a consistent `pm2 start/stop/logs` interface.
- Lighter than adding Kubernetes or systemd for a solo-operator setup.

**Trade-offs accepted:**
- PM2 config is separate from the pnpm/turbo scripts — must keep both in sync when adding workers.

**Revisit when:** moving to a container-based deployment (Docker Compose or Kubernetes), at which point PM2 is replaced by container restart policies.

---

## ADR-008: QYRO Lead built as internal tool first, not as a product
Date: 2026-03-30 | Status: Accepted

**Decision:** Phase 1 builds QYRO Lead for Bhavneet's internal use only.
No self-serve, no billing, no UI beyond what is needed to run it.
Productization of QYRO Lead is deferred to Phase 4.

**Reasons:**
- Reduces Phase 1 scope significantly (no frontend, no billing, no onboarding)
- Validates the lead engine on real data before selling it to others
- QYRO Assist is the validated revenue opportunity — focus there first
- All backend work done in Phase 1 carries forward to Phase 4 with no rewrite

**Implication for architecture:**
- tenant_type: "internal" is a real tenant type in the schema
- "lead_engine" tenant type exists in the enum but is not yet active
- Phase 4 just adds UI + billing on top of Phase 1 backend

---

## ADR-013: Subscription-first entitlement model for product access
Date: 2026-04-05 | Status: Accepted

**Decision:** Product access (`lead`, `assist`) resolves from `tenant_subscriptions` first. Tenant metadata remains a fallback path for transitional/back-compat reads.

**Reasons:**
- Metadata-only access cannot reliably represent Stripe lifecycle state.
- Subscription status + price mapping must drive deterministic access revocation/grant.
- Enables clear billing-first default (`lead=false`, `assist=false`) for unprovisioned tenants.

**Implementation artifacts:**
- DB table: `tenant_subscriptions`
- Migration: `packages/db/migrations/0004_billing_subscriptions.sql`
- Routes: `apps/api/src/routes/billing.ts`
- Resolver updates: `apps/api/src/routes/tenants.ts`

---

## ADR-014: Stripe webhook as entitlement synchronization authority
Date: 2026-04-05 | Status: Accepted

**Decision:** Stripe webhook events are the authoritative trigger for persisting subscription lifecycle and updating tenant product access.

**Reasons:**
- Checkout completion alone is insufficient to represent long-lived subscription state.
- Lifecycle events (created/updated/deleted) must propagate to access controls.
- Keeps entitlements consistent with Stripe truth under upgrades, cancellations, and status transitions.

**Implementation artifacts:**
- Public endpoint: `POST /webhooks/stripe`
- Events handled: checkout completion + subscription created/updated/deleted
- Side effects: upsert subscription row, write product access snapshot

---

## ADR-015: Schema-mode compatibility for outbound call_attempts
Date: 2026-04-05 | Status: Accepted

**Decision:** Outbound assist routes detect `call_attempts` schema capabilities at runtime and branch between modern and legacy query/insert shapes.

**Reasons:**
- Production databases can lag migrations, causing hard failures on missing columns.
- Error-driven fallback was insufficient because SQL generation could fail before catch paths.
- Proactive detection via `information_schema.columns` avoids invalid SQL generation paths.

**Implementation artifacts:**
- Detection + cache logic in `apps/api/src/routes/assist.ts`
- Legacy-safe insert path for minimal columns

---

## ADR-016: Public root landing with protected product/application surfaces
Date: 2026-04-05 | Status: Accepted

**Decision:** Keep `/` public for signed-out visitors while continuing to protect authenticated app surfaces via Clerk middleware.

**Reasons:**
- Conversion flow requires a viewable marketing page before sign-in.
- Full-route protection caused immediate auth redirect and removed product narrative.
- Product selector also requires an explicit sign-out path to avoid trapping newly-authenticated users.

**Implementation artifacts:**
- Middleware public route update in `apps/web/src/middleware.ts`
- Landing page redesign in `apps/web/src/app/page.tsx`
- Product selector sign-out control in `apps/web/src/app/products/page.tsx`

---

## ADR-017: SignalWire as primary cXML telephony transport
Date: 2026-04-05 | Status: Accepted

**Decision:** Replace Twilio-specific inbound signature verification and outbound call-init wiring with SignalWire-compatible implementations while retaining cXML-compatible webhook behavior.

**Reasons:**
- Lower recurring telephony cost target with comparable cXML compatibility.
- Existing webhook/call-control architecture already aligned with cXML patterns, minimizing migration blast radius.
- Keeps voice transport configurable while removing hard provider coupling in middleware and worker paths.

**Implementation artifacts:**
- Signature validation middleware in `apps/api/src/middleware/auth.ts`
- Middleware mount in `apps/api/src/index.ts`
- Outbound dial worker endpoint/auth updates in `packages/queue/src/workers/outboundCallWorker.ts`

---

## ADR-018: Provider-neutral voice identifiers in schema and app code
Date: 2026-04-05 | Status: Accepted

**Decision:** Rename provider-branded fields to neutral names in both database schema and runtime code.

**Renames:**
- `tenants.twilio_number` -> `tenants.voice_number`
- `call_attempts.twilio_call_sid` -> `call_attempts.call_sid`

**Reasons:**
- Avoids repeated refactors when switching telephony providers.
- Reduces developer/operator confusion where naming implies the wrong provider.
- Supports long-term multi-provider capability without schema churn.

**Implementation artifacts:**
- Schema updates in `packages/db/src/schema.ts`
- Migration `packages/db/migrations/0006_rename_voice_fields.sql`
- Route/worker/frontend reference updates across API, queue, and web app.

---

## ADR-019: Master-admin control plane and billing-UX bypass semantics
Date: 2026-04-05 | Status: Accepted

**Decision:** Introduce a platform-level master-admin role that can manage tenant/user access and trial controls across all tenants, and bypass tenant billing-gated UX constraints.

**Reasons:**
- Platform operators need emergency/operational controls independent of tenant subscription state.
- Tenant billing status should not block platform support and administration workflows.
- Access policy requires deterministic composition of paid access, overrides, trial, and user-level controls.

**Implementation details:**
- Added central entitlement resolver combining:
    - subscription-derived access
    - billing override flags
    - trial days/quota controls
    - per-user product access overrides
- Added master-admin API routes and internal admin UI for cross-tenant management.
- Added tenant owner/admin team-management route/UI for role and product-access control.
- Updated internal/client routing and products UX to suppress tenant billing prompts for master-admin sessions.

**Implementation artifacts:**
- `apps/api/src/lib/entitlements.ts`
- `apps/api/src/routes/admin.ts`
- `apps/api/src/routes/tenants.ts`
- `apps/web/src/app/(internal)/internal/admin/page.tsx`
- `apps/web/src/app/(internal)/internal/team/page.tsx`
- `apps/web/src/app/products/page.tsx`
- `apps/web/src/app/(internal)/layout.tsx`
- `apps/web/src/app/(client)/layout.tsx`
