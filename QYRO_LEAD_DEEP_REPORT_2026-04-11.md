# QYRO Lead Deep Report

Generated: 2026-04-11  
Scope: Read-only product deep-dive for the current QYRO Lead implementation. No code or configuration changes were made.

## Executive Summary

QYRO Lead is already a substantial internal lead engine, not just a concept. The codebase supports:

- lead discovery from Google Places
- deduplication across domains, phones, and emails
- email enrichment
- research and urgency scoring
- outreach draft generation with QA gates
- human approval flows
- campaign management
- export and nightly automation hooks

The main distinction between Lead and Assist is not capability. It is packaging and go-to-market. Lead is operationally useful now, but it is still positioned mostly as an internal engine rather than a public product.

## What QYRO Lead Can Do Right Now

### 1. Lead discovery and ingestion

Verified in current code:

- Lead routes in [apps/api/src/routes/leads.ts](apps/api/src/routes/leads.ts)
- Discovery agent in [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts)

Current behavior:

- Takes niche plus location input.
- Normalizes and parses search geography.
- Uses Google Places API as the live discovery source.
- Deduplicates against existing tenant leads using domain, phone, and email.
- Inserts new prospects into the raw prospect table.
- Enqueues research jobs for eligible leads.
- Marks ineligible leads as research-skipped with a reason.

This is a real ingestion engine, not a placeholder flow.

### 2. Data hygiene and gating

Verified in current code:

- Dedup logic in [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts)
- Skip-reason persistence in [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts)
- DNC checks and source-based outreach gating in [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts)

Current behavior:

- Prevents duplicates by checking prior domains, phones, and emails.
- Avoids research or outreach progression for certain leads when they are DNC-listed, individually sourced, or otherwise ineligible.
- Tracks why a lead was skipped.

This is one of the more mature parts of the Lead engine. It shows the system is trying to behave like an operational pipeline, not just a lead scraper.

### 3. Research and scoring

Verified in current code:

- Research agent in [packages/agents/src/agents/research.ts](packages/agents/src/agents/research.ts)

Current behavior:

- Fetches website content when a domain exists.
- Caches research results for seven days.
- Uses an LLM to generate summary, pain points, pitch angles, and urgency score.
- Normalizes output to remove weak or non-evidenced pain points.
- Upserts enriched research records.

This means Lead is not just collecting businesses. It is trying to prioritize and contextualize them for outreach.

### 4. Outreach drafting and QA

Verified in current code:

- Outreach agent in [packages/agents/src/agents/outreach.ts](packages/agents/src/agents/outreach.ts)
- Campaign routes in [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts)

Current behavior:

- Outreach is generated only after research exists.
- DNC and consent checks run before drafting.
- QA is run before message persistence.
- Messages are stored as pending approval or blocked by QA.
- Human approval and rejection flows exist.

This is one of the strongest aspects of the Lead system: it is built around human review rather than auto-send.

### 5. Internal operator UI

Verified in current code:

- Lead list UI in [apps/web/src/app/(internal)/internal/leads/page.tsx](apps/web/src/app/(internal)/internal/leads/page.tsx)
- Lead detail UI in [apps/web/src/app/(internal)/internal/leads/[id]/page.tsx](apps/web/src/app/(internal)/internal/leads/[id]/page.tsx)
- Campaign UI in [apps/web/src/app/(internal)/internal/campaigns/page.tsx](apps/web/src/app/(internal)/internal/campaigns/page.tsx)

Current behavior:

- Operators can browse leads, sort, and filter skipped entries.
- The detail page exposes research summary, urgency, evidence-backed pain points, and pitch angles.
- Campaigns can be created and activated.
- Leads can be routed into campaigns.

This is enough UI to operate the internal lead engine effectively.

### 6. Export and automation hooks

Verified in current code:

- Export route in [apps/api/src/routes/leads.ts](apps/api/src/routes/leads.ts)
- Nightly and morning operational routes in [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts)

Current behavior:

- Lead export exists with watermarking and rate limiting.
- Nightly ingest and morning digest routes support automation.

This is a meaningful sign that Lead is already treated as an operating workflow, not just a manual dashboard.

## What QYRO Lead Is Doing As Of Now

Based on the current code, QYRO Lead is being used or prepared to be used as:

- an internal lead sourcing engine
- a research-and-prioritization system for outbound sales work
- a draft-generation pipeline with human approval
- a feeder system into outbound voice and outreach operations

The clearest current role is this:

- Lead helps find and qualify prospects for QYRO Assist customer acquisition.

That role fits the repo direction and the internal tooling emphasis visible in the UI.

## Capability Assessment

### Strongest capabilities

The strongest parts of QYRO Lead right now are:

1. Discovery plus deduplication.
2. Research plus urgency scoring.
3. Evidence-aware pain-point generation.
4. QA-gated outreach drafting.
5. Internal operator tooling for campaign and approval management.

### Most valuable current workflow

The best current Lead workflow appears to be:

1. ingest by niche and location
2. research and urgency sort
3. review the strongest leads
4. push into campaigns
5. approve outbound messages or hand off to outbound calling

That workflow is already coherent enough to create internal sales leverage.

## Comparative Position

### Lead vs Assist

Compared to QYRO Assist, QYRO Lead is:

- less public-facing
- less commercially packaged
- more clearly an internal operations engine today

But Lead is not significantly behind in backend sophistication. It is simply not being surfaced as the primary public product yet.

### Internal engine vs public product

The public onboarding flow still marks Lead as coming soon. That means the difference is mainly commercial readiness, branding, onboarding, and customer-facing packaging, not basic backend function.

In other words:

- Lead the engine exists.
- Lead the public product is not fully launched.

## Risks and Weak Areas

### 1. The discovery source is narrower than older product ideas implied

The code in [packages/agents/src/agents/leadDiscovery.ts](packages/agents/src/agents/leadDiscovery.ts) is effectively centered on Google Places as the live search source.

That is operationally simpler, but it also means:

- coverage depends heavily on Places quality
- the earlier idea of broader search-source diversity is not what the code is doing now

This is not necessarily wrong. It just narrows the engine’s sourcing strategy.

### 2. Lead is still packaged like an internal system first

The internal operator UI is solid, but public productization is still visibly deferred. That affects:

- onboarding clarity
- public pricing alignment
- tenant-type separation in go-to-market messaging

### 3. Approval governance is incomplete

The campaign approval and rejection paths in [apps/api/src/routes/campaigns.ts](apps/api/src/routes/campaigns.ts) are not fully audit logged. That weakens accountability around outbound decision-making.

### 4. Lead depends on broader platform trust issues

Even though Lead itself is not the main public-ingress surface, it still depends on broader platform concerns already identified elsewhere:

- tenant isolation confidence
- secret storage model
- control-plane hardening

### 5. Some flows still require a human operational layer

That is often the right choice, but it means the system’s success depends on disciplined approvals and review, not just model performance.

## Short Path Opportunities

The shortest-path ways to improve QYRO Lead are not massive rebuilds.

1. Add audit logging to approval and rejection operations.
2. Clarify and document Lead as an internal engine versus public product.
3. Improve visibility into skipped leads and skip reasons inside operational reporting.
4. Expand operator review surfaces around exports, approvals, and automation runs.
5. Decide whether Google Places-only sourcing is the intentional long-term strategy or just the current pragmatic one.

## What Could Work Best

The best near-term path for QYRO Lead is probably this:

- keep using it as the internal acquisition engine
- harden governance and audit trails
- measure where sourced leads actually convert
- only then productize it externally if the internal engine proves repeatable value

Why this path works best:

- The backend already has enough capability to create internal leverage.
- Externalizing it too early would add packaging, onboarding, support, and billing complexity before validating the strongest niches and workflows.
- Assist appears to be the better immediate public product while Lead functions as the acquisition machine behind it.

## Final Assessment

QYRO Lead is already a serious internal product. It is not unfinished in the way early status docs might imply. The core engine for sourcing, research, prioritization, drafting, and approval is present.

Its next challenge is not basic capability. It is deciding how far to keep optimizing it as an internal weapon before turning it into a public-facing sellable product.