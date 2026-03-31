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

## ADR-006: No Maps scraping — Apollo + Google Places API only
Date: 2026-03-30 | Status: Accepted

**Decision:** Lead sourcing uses Apollo API and Google Places API. No web scraping of Google Maps or other directories that prohibit it.

**Reasons:**
- Google Maps ToS explicitly prohibits bulk export of business data
- Legal and reputational risk outweighs cost of using API
- Apollo provides enriched B2B data with permitted use

**Compliant mix:** Apollo (primary), Google Places API (enrichment with attribution), inbound forms, referrals

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
