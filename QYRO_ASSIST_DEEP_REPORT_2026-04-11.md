# QYRO Assist Deep Report

Generated: 2026-04-11  
Scope: Read-only product deep-dive for the current QYRO Assist implementation. No code or configuration changes were made.

## Executive Summary

QYRO Assist is the most mature product surface in the repository. It is no longer just a concept or partial prototype. The current codebase supports a real client-facing AI receptionist platform with:

- inbound voice handling
- public website chat widget
- missed-call follow-up
- booking workflows
- outbound follow-up pipeline
- client dashboard and call history
- tenant settings and onboarding
- billing-backed access control

The biggest remaining issues are not missing product features. They are production-trust and operations-hardening gaps around provider auth, tenant isolation confidence, secret storage, and audit completeness.

## What QYRO Assist Can Do Right Now

### 1. Public customer interaction surfaces

Verified in current code:

- Public widget chat endpoint in [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- Public missed-call endpoint in [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts)
- Embeddable widget script in [apps/web/public/widget.js](apps/web/public/widget.js)
- Voice ingress in [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- Retell integration surface in [apps/api/src/routes/retell.ts](apps/api/src/routes/retell.ts)

Observed product shape:

- A business can receive inbound AI-handled conversations through voice and web chat.
- The assistant can create or link prospects during public interactions.
- The system can escalate and notify humans when needed.

### 2. Voice and conversation handling

Verified in current code:

- SignalWire-signed voice route mounting in [apps/api/src/index.ts](apps/api/src/index.ts)
- Session creation and conversation persistence in [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- Voice turn processing via `processTurn()` in [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- History compaction support in [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)
- Escalation-to-staff flow in [apps/api/src/routes/voice.ts](apps/api/src/routes/voice.ts)

Observed product shape:

- This is not a stateless call loop anymore.
- Voice sessions keep history and can support multi-turn continuity.
- The architecture supports both a default voice runtime and an opt-in Retell path.

### 3. Booking and follow-up capability

Verified in current code:

- Booking logic exposed through Assist flows and Retell tools.
- Appointments API used by the client portal.
- Outbound call queueing and retry behavior in [apps/api/src/routes/assist.ts](apps/api/src/routes/assist.ts) and [packages/queue/src/workers/outboundCallWorker.ts](packages/queue/src/workers/outboundCallWorker.ts)
- Escalation notifications in [apps/api/src/lib/escalation.ts](apps/api/src/lib/escalation.ts)

Observed product shape:

- QYRO Assist can do more than answer questions.
- It can transition from inbound interaction to operational action: booking, escalation, and outbound workflow.

### 4. Client portal

Verified in current code:

- Dashboard in [apps/web/src/app/(client)/client/dashboard/page.tsx](apps/web/src/app/(client)/client/dashboard/page.tsx)
- Calls UI in [apps/web/src/app/(client)/client/calls/page.tsx](apps/web/src/app/(client)/client/calls/page.tsx)
- Outbound pipeline UI in [apps/web/src/app/(client)/client/outbound-pipeline/page.tsx](apps/web/src/app/(client)/client/outbound-pipeline/page.tsx)
- Settings and tenant configuration in [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts)

Observed product shape:

- Clients have a usable operator surface, not just backend APIs.
- Dashboard, call history, escalation visibility, and outbound control are all present.

### 5. Access control and monetization

Verified in current code:

- Billing route implementation in [apps/api/src/routes/billing.ts](apps/api/src/routes/billing.ts)
- Product access resolution in [apps/api/src/lib/entitlements.ts](apps/api/src/lib/entitlements.ts)
- Pricing API in [apps/api/src/routes/pricing.ts](apps/api/src/routes/pricing.ts)
- Onboarding and product routing in [apps/web/src/app/onboarding/page.tsx](apps/web/src/app/onboarding/page.tsx) and [apps/web/src/app/products/page.tsx](apps/web/src/app/products/page.tsx)

Observed product shape:

- Assist is clearly the product being pushed toward commercial use now.
- Billing-backed access is already part of the code, even if some sales/onboarding flows remain uneven.

## What Is Being Done As Of Now

Based on current code, QYRO Assist is actively being shaped as:

- the primary sellable product in the monorepo
- the client-facing AI receptionist offering
- a system that combines inbound voice, widget chat, booking, escalation, and outbound follow-up
- a subscription-aware SaaS with tenant-level controls

The public-facing UX reinforces that direction:

- Assist is selectable and active in onboarding.
- Lead is still explicitly marked as coming soon in the public onboarding flow.

## Capability Assessment

### Strongest capabilities

The strongest parts of QYRO Assist right now are:

1. Multi-surface interaction model.
2. Practical workflow depth from conversation to booking or escalation.
3. Client portal visibility into calls and sessions.
4. Operator controls for outbound calling.
5. Subscription-aware entitlement logic.

### Most differentiated capability

The feature combination that appears strongest is this:

- AI receptionist experience
- missed-call handling
- call transcript and recording review
- outbound callback or outbound pipeline support
- live escalation path

That is a stronger operational bundle than a simple chat widget or a simple phone bot.

## Comparative Position

### Assist vs Lead

Compared to QYRO Lead, QYRO Assist is:

- more externally productized
- more commercially aligned in the current UI
- more complete from onboarding through billing and day-to-day client operations

QYRO Lead still has substantial backend capability, but Assist is the clearer near-term product surface.

### Docs vs real implementation

The current code is ahead of the older audit/status docs. In particular, Assist now includes working surfaces that older project audit files described as missing, partial, or blocked.

Verified examples:

- public widget path exists
- billing exists
- outbound pipeline exists
- voice history persistence exists
- RLS migration exists

## Risks and Weak Areas

### 1. Provider trust boundaries are still too soft

The main Assist-specific production concern is that public provider-facing endpoints are not hardened enough by default.

Examples:

- Retell auth can fail open if the secret is absent in [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)
- SignalWire checks can be bypassed through an env flag in [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts)

This matters more for Assist than Lead because Assist has more public ingress.

### 2. Secret storage model is too permissive

Assist tenant settings persist provider credentials in metadata through [apps/api/src/routes/tenants.ts](apps/api/src/routes/tenants.ts). That is expedient, but not a strong long-term model.

### 3. Approval and operator actions are not fully attributable

Assist and campaign-related state transitions are not uniformly audit logged. For a product that touches customer conversations and outbound actions, this is a governance gap.

### 4. Some operational workflows are still “best effort”

Escalation notifications in [apps/api/src/lib/escalation.ts](apps/api/src/lib/escalation.ts) are fire-and-forget. If provider configuration is missing, alerts are skipped rather than strongly surfaced as an operational fault.

## Short Path Opportunities

The shortest-path improvements for Assist are mostly hardening, not new product invention.

1. Fail closed for missing Retell auth config in production.
2. Remove or block the SignalWire signature bypass in production.
3. Add audit logging to approval and rejection flows.
4. Move API credentials out of tenant metadata.
5. Replace the capped in-memory phone match path for inbound call prospect lookup.

## What Could Work Best

The best next move for QYRO Assist is not another major feature layer. It is a production-readiness pass focused on:

- webhook authenticity
- secret handling
- dependable tenant isolation semantics
- audit completeness
- operator-alert reliability

Why this is the best path:

- The product already has enough functional breadth.
- Trust failures on public ingress would undermine the whole system faster than feature gaps would.
- Tightening these boundaries makes the existing product easier to sell with confidence.

## Final Assessment

QYRO Assist is a credible product surface now. It already contains the main elements of a real AI receptionist platform and is clearly the most advanced part of the repo.

If you want to maximize value quickly, treat Assist as the near-term commercial core and prioritize hardening over expansion.