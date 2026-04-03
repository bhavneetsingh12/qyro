# QYRO Project Status Report
_Generated: 2026-04-03 | Reviewer: Claude Code (read-only scan)_

---

## 1. WHAT IS BUILT

### Root / Config
- `CLAUDE.md` — Session rules, phase checklist, project memory
- `QYRO_CLAUDE_CODE_INSTRUCTIONS.md` — First-session bootstrap guide (Phase 1 task runner)
- `package.json` — pnpm workspace root with turbo scripts
- `pnpm-workspace.yaml` — Declares apps/* and packages/* as workspaces
- `turbo.json` — Turborepo pipeline (build, dev)
- `tsconfig.json` — Root TypeScript config (path aliases)
- `.env.example` — Env var template for onboarding
- `.gitignore` / `.claudeignore` — Standard ignore files

### apps/api — Node/Express backend
- `src/index.ts` — Express server; Clerk middleware; mounts leads, campaigns, assist, tenants, webhooks routers; graceful shutdown; port 3005 default
- `src/middleware/auth.ts` — Clerk session verification; DEV_BYPASS_AUTH escape hatch
- `src/middleware/tenant.ts` — Resolves tenantId from Clerk user; sets Postgres RLS context; DEV_BYPASS_AUTH bypass path
- `src/middleware/quota.ts` — Per-tenant daily token quota check; blocks at HTTP 429
- `src/routes/leads.ts` — Full CRUD + ingest + research/outreach enqueue + message approval
- `src/routes/campaigns.ts` — Full CRUD + approve/reject per message + queue endpoint + campaign activation
- `src/routes/assist.ts` — GET /sessions and GET /appointments for client portal
- `src/routes/webhooks.ts` — POST /nightly/ingest (n8n trigger) + POST /morning/digest (summary); secured with INTERNAL_WEBHOOK_SECRET
- `src/routes/tenants.ts` — GET/PATCH /api/v1/tenants/settings (enrichment provider, API keys, booking link, etc.)
- `src/lib/sendEmail.ts` — Resend REST API wrapper (no SDK; native fetch)

### packages/db — Database
- `src/schema.ts` — Complete Drizzle ORM schema: tenants, users, plans, prospects_raw, prospects_enriched, lead_scores, outreach_sequences, message_attempts, call_attempts, consent_events, do_not_contact, appointments, assistant_sessions, prompt_versions, usage_events, billing_events, audit_logs, webhook_events, dead_letter_queue
- `src/client.ts` — Drizzle connection (main + admin pool); setTenantContext() for RLS; graceful shutdown
- `src/index.ts` — Re-exports all schema + client
- `drizzle.config.ts` — Drizzle Kit config pointing to schema
- `migrations/0000_needy_tinkerer.sql` — Full initial migration (all enums and tables)

### packages/agents — AI agents
- `src/budget.ts` — Model tier assignments, per-agent token limits, per-plan daily limits, quota check, usage logging
- `src/runner.ts` — Single callLLM wrapper (quota → OpenAI → log usage); runCompletion + runStructuredCompletion (JSON-parsed)
- `src/compact.ts` — Conversation compaction for Client Assistant (every 6 turns; summarizes older turns via LLM)
- `src/cache.ts` — Exported (file exists; not deeply read but referenced in QYRO_CLAUDE_CODE_INSTRUCTIONS.md)
- `src/index.ts` — Barrel exports for agents
- `src/agents/leadDiscovery.ts` — Lead Discovery agent: NL location parsing → Google Places API (New) → dedup → insert prospects_raw → enqueue research jobs; email enrichment via emailEnrichment.ts
- `src/agents/research.ts` — Research agent: Redis cache check → website fetch → LLM summary/scoring → upsert prospects_enriched → cache result
- `src/agents/outreach.ts` — Outreach agent: consent + DNC gate → load enriched data → generate email/SMS draft via LLM → insert message_attempts as "pending_approval"
- `src/agents/replyTriage.ts` — Reply Triage agent: LLM classification → DNC insertion on unsubscribe → classification logged to message_attempts
- `src/agents/booking.ts` — Booking agent: Cal.com slot fetch → LLM time parsing → best slot match → Cal.com booking → appointments row
- `src/agents/qa.ts` — QA Guardrail agent: static checks (placeholders, banned phrases) + LLM semantic review → pass/block verdict + db update
- `src/agents/emailEnrichment.ts` — Email enrichment adapter: mock/Hunter/Apollo providers; tenant monthly usage tracking

### packages/queue — BullMQ
- `src/queues.ts` — Redis connection; research, outreach, reply queue definitions with retry settings
- `src/index.ts` — Barrel exports
- `src/workers/researchWorker.ts` — BullMQ worker for research queue; calls runResearch(); dead-letter on permanent failure; graceful shutdown
- `src/workers/replyTriageWorker.ts` — BullMQ worker for reply queue; calls runReplyTriage(); dead-letter on permanent failure; graceful shutdown

### packages/prompts — Prompt loader
- `src/loader.ts` — Loads prompt .md files from docs/PROMPTS/

### apps/web — Next.js 14 frontend
- `src/app/layout.tsx` — Root layout; ClerkProvider wrapper
- `src/app/page.tsx` — Root redirect (assumed; not read but file exists)
- `src/app/globals.css` — Tailwind base styles + custom CSS classes (`.input`, `.sidebar-link`, etc.)
- `src/middleware.ts` — Clerk middleware for Next.js; DEV_BYPASS_AUTH dev escape; protects all non-public routes
- `src/app/sign-in/[[...sign-in]]/page.tsx` — Clerk sign-in page
- `src/app/(internal)/layout.tsx` — Internal portal layout; fetches approval count for sidebar badge; renders InternalSidebar
- `src/app/(internal)/internal/dashboard/page.tsx` — Internal dashboard: leads today, pending approvals, token spend (placeholder), recent leads + campaigns list
- `src/app/(internal)/internal/leads/page.tsx` — Paginated leads table with email, urgency, research status; bulk research button; per-row research trigger; FindLeadsModal integration
- `src/app/(internal)/internal/leads/actions.ts` — Server actions: addToCampaignAction, runResearchAction, runResearchBatchAction
- `src/app/(internal)/internal/leads/FindLeadsModal.tsx` — Client-side modal: niche + location (single/multiple) + radius slider + max results → POST /api/leads/ingest
- `src/app/(internal)/internal/leads/LeadsRefresher.tsx` — Client component: triggers router.refresh() on interval or on demand
- `src/app/(internal)/internal/leads/PendingSubmitButton.tsx` — Form submit button with pending state (useFormStatus)
- `src/app/(internal)/internal/leads/ResearchQueueButton.tsx` — Client button wrapping runResearchAction with pending state
- `src/app/(internal)/internal/leads/[id]/page.tsx` — Lead detail page: raw data, consent badge, enriched summary, urgency meter, evidence-backed pain points, pitch angles, add-to-campaign form
- `src/app/(internal)/internal/leads/[id]/AddToCampaignForm.tsx` — Client form: select active campaign → POST /api/leads/:id/outreach
- `src/app/(internal)/internal/campaigns/page.tsx` — Campaign list table: channel badge, status, prompt pack; activate button; view queue link
- `src/app/(internal)/internal/campaigns/new/page.tsx` — Create campaign form: name, niche, channel, prompt pack dropdown
- `src/app/(internal)/internal/campaigns/actions.ts` — Server actions: createCampaignAction, activateCampaignAction
- `src/app/(internal)/internal/approvals/page.tsx` — Approval queue page; fetches pending messages
- `src/app/(internal)/internal/approvals/ApprovalQueue.tsx` — Client component: approve/reject messages with optimistic UI, QA flag display, channel icons
- `src/app/(internal)/internal/approvals/actions.ts` — Server actions: approveMessageAction, rejectMessageAction
- `src/app/(internal)/internal/settings/page.tsx` — Internal settings: enrichment provider, Apollo/Hunter API key management, monthly credit limit
- `src/components/sidebar/InternalSidebar.tsx` — Sidebar: Dashboard, Leads, Campaigns, Approvals (with badge), Settings, Sign out; mobile drawer support
- `src/components/sidebar/ClientSidebar.tsx` — Client portal sidebar (not read in full but exists)
- `src/app/(client)/layout.tsx` — Client portal layout with ClientSidebar
- `src/app/(client)/client/dashboard/page.tsx` — Client dashboard: conversations today, bookings this week, missed calls, FAQ responses; recent sessions list
- `src/app/(client)/client/conversations/page.tsx` — Conversation inbox: session type, turn count, escalated badge, date
- `src/app/(client)/client/bookings/page.tsx` — Bookings list: prospect name, start time, status badge
- `src/app/(client)/client/settings/page.tsx` — Client settings: business name, approved services, booking link, email from name
- `src/app/(client)/client/widget/page.tsx` — Widget embed page: fetches tenant ID → generates script snippet → copy button + simulated widget preview

### docs/
- `BLUEPRINT.md` — Architecture reference; two-product platform; stack; build phases; tenant isolation rules
- `AGENTS.md` — Agent specifications, contracts, what each agent must/must not do
- `TOKEN_BUDGET.md` — Token budget rules (referenced; not read in full)
- `COMPLIANCE.md` — Compliance gate for voice/Twilio (referenced; not read in full)
- `DECISIONS.md` — Architecture decision log (referenced; not read in full)
- `ENVIRONMENTS.md` — Environment variable guide (referenced; not read in full)
- `NIGHTLY_LEAD_PIPELINE.md` — Documents the overnight n8n pipeline and morning digest ops
- `PROMPTS/lead/medspa_missed_call_v1.md` — Single prompt pack for medspa missed-call SMS

### infra/
- `docker-compose.yml` — Local dev: Postgres + Redis + n8n
- `docker-compose.test.yml` — Isolated test stack (different ports: Postgres 5433, Redis 6380)
- `.env.docker` — Docker Compose env vars
- `n8n/workflows/nightly-lead-pipeline.json` — n8n workflow that calls POST /webhooks/nightly/ingest on a schedule
- `n8n/workflows/morning-lead-digest.json` — n8n workflow that calls POST /webhooks/morning/digest each morning
- `pm2/ecosystem.config.cjs` — PM2 process definitions: qyro-api + qyro-research-worker
- `seed.ts` — Seeds internal tenant (Bhavneet), owner user, and plan definitions; idempotent (upserts)

### scripts/
- `test-e2e.ts` — End-to-end test script: creates test tenant → inserts prospect → runResearch → runOutreach → approves message → cleanup

---

## 2. WHAT IS WORKING

Based on code review only (cannot confirm runtime behavior):

**Backend (appears fully functional):**
- Express API server with Clerk auth, tenant scoping, quota middleware
- All 8 REST route groups mounted and implemented
- Lead Discovery agent: Google Places API (New) search → dedup → DB insert → research queue enqueue
- Research agent: Redis cache → website fetch → LLM summarize → DB upsert → cache store
- Outreach agent: consent/DNC gates → LLM draft → pending_approval insert (no auto-send)
- Reply Triage agent: LLM classify → DNC auto-insert on unsubscribe → DB update
- Booking agent: Cal.com slots → LLM time parse → slot match → Cal.com create → DB insert
- QA Guardrail agent: static checks + LLM semantic checks → block/pass verdict
- Email Enrichment: mock/Hunter/Apollo multi-provider with monthly credit tracking
- Research worker: processes research queue, dead-letters on failure, graceful shutdown
- Reply Triage worker: processes reply queue, dead-letters on failure, graceful shutdown
- Webhook endpoints: nightly ingest (with optional outreach drafting) + morning digest
- Conversation compaction (compact.ts): built and logically complete
- Token budget system: quota check + usage logging on every LLM call
- DB schema: comprehensive; all tables have tenant_id; migration file exists
- Seed script: upserts plans, internal tenant, owner user

**Frontend (appears fully functional):**
- Clerk auth routing for both portals
- Internal portal: Dashboard, Lead inbox (with FindLeadsModal), Lead detail, Campaigns (list + new + activate), Approval queue (approve/reject with optimistic UI), Settings (enrichment provider + API keys)
- Client portal: Dashboard, Conversation inbox, Bookings, Settings (business profile), Widget embed code page
- Mobile sidebar drawer on both portals
- Server Actions wiring to backend API
- Tailwind warm design system matching spec

---

## 3. WHAT IS INCOMPLETE

### Critical gaps:

**1. QA Guardrail not wired into Outreach agent**
`packages/agents/src/agents/outreach.ts` generates a message draft and immediately inserts it into `message_attempts` with `status: "pending_approval"` without calling `runQA()`. AGENTS.md spec says: _"Passes draft to QA Agent before anything is stored."_ As built, QA only runs if explicitly called from elsewhere — it is not called from the outreach flow. Messages bypass QA.

**2. Outreach worker missing**
`packages/queue/src/queues.ts` defines the `outreach` queue, but there is no `packages/queue/src/workers/outreachWorker.ts`. Outreach jobs are enqueued (by leads routes and webhooks) but never processed. They will sit in Redis indefinitely.

**3. Audit logs not written on campaign approval**
`QYRO_CLAUDE_CODE_INSTRUCTIONS.md` Task G says "verify approve writes to audit_logs." The campaigns route (`POST /:id/approve/:messageId`) updates `message_attempts` but does not insert into `audit_logs`. The `audit_logs` table exists in schema but is never written to anywhere in the codebase.

**4. Port mismatch in leads-related frontend files**
The API server defaults to port **3005** (`apps/api/src/index.ts`). But these frontend files hard-code fallback to **3001**:
- `apps/web/src/app/(internal)/internal/leads/page.tsx` — `"http://localhost:3005"`
- `apps/web/src/app/(internal)/internal/leads/[id]/page.tsx` — `"http://localhost:3005"`
- `apps/web/src/app/(internal)/internal/leads/actions.ts` — `"http://localhost:3005"`
- `apps/web/src/app/(internal)/internal/leads/FindLeadsModal.tsx` — `"http://localhost:3005"`

All other pages correctly default to 3005. Leads pages will fail API calls in dev if `API_URL` env var is not explicitly set.

**5. Session L not marked done in CLAUDE.md**
CLAUDE.md shows `[ ] Session L — Lead detail + campaign manager`. However, `leads/[id]/page.tsx`, `leads/[id]/AddToCampaignForm.tsx`, `campaigns/page.tsx`, `campaigns/new/page.tsx`, and `campaigns/actions.ts` are all built and appear complete. The checklist is out of sync with the actual code.

**6. E2E test step 3 assertion may be fragile**
`scripts/test-e2e.ts` Step 3 asserts `enriched.painPoints is non-empty`. The Research agent's `normalizeResearchSummary()` strips pain points that lack the exact `| Evidence: ... | Source: website` format AND requires meaningful website text. For many domains, the website may be unreachable or text too short, resulting in empty `painPoints`. The assertion will fail on real runs for businesses without fetchable websites.

**7. Postgres RLS policies not in migrations**
`packages/db/src/client.ts` documents that RLS policies must be created manually:
```
CREATE POLICY tenant_isolation ON <table>
USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```
This SQL is NOT in `migrations/0000_needy_tinkerer.sql` or any migration. `setTenantContext()` sets the session variable but there are no policies to enforce it at the DB level. Tenant isolation currently relies entirely on application-level WHERE clauses. A bug bypassing the middleware would expose cross-tenant data.

**8. Session P (Polish + mobile) not started**
Dashboard stat cards "Token spend today" and "Research cache hits" show `"—"` with "endpoint coming" — placeholder values, no real data endpoint exists. General mobile polish pass not done.

---

## 4. WHAT IS MISSING

Files or features referenced in CLAUDE.md or BLUEPRINT.md that do not exist:

| Missing Item | Where Referenced | Notes |
|---|---|---|
| `packages/agents/src/agents/clientAssistant.ts` | BLUEPRINT.md, AGENTS.md, schema (assistant_sessions table), compact.ts | Core agent for QYRO Assist — not built. compact.ts exists to support it but nothing calls it. |
| `packages/agents/src/agents/promptHygiene.ts` | AGENTS.md (full spec written) | Not built. No CI validation of prompt packs. |
| `packages/queue/src/workers/outreachWorker.ts` | queue/queues.ts (outreach queue defined), routes/leads.ts (jobs enqueued), pm2 config (only research worker listed) | Outreach jobs pile up in Redis unprocessed. |
| `apps/api/src/routes/billing.ts` | BLUEPRINT.md repo structure, CLAUDE.md Phase 2 (Stripe billing) | Stripe billing not implemented. |
| `docs/PROMPTS/assist/` | BLUEPRINT.md Phase 2 prompt packs | Directory does not exist. No QYRO Assist prompt packs. Only `lead/medspa_missed_call_v1.md` exists. |
| Widget JS (`widget.qyro.ai/widget.js`) | `apps/web/src/app/(client)/client/widget/page.tsx` references `WIDGET_SRC = "https://widget.qyro.ai/widget.js"` | The actual embeddable widget JavaScript does not exist in this repo. The embed page generates a snippet pointing to a URL that serves nothing. |
| Tenant-type routing / access control | BLUEPRINT.md `PRODUCT_ACCESS` object | No route-level tenant_type enforcement. The `tenantType` field is read from the DB and set on `req`, but no route checks it. An "assistant" tenant can call `/api/leads/*` routes. |
| Usage/stats API endpoint | Internal dashboard ("Token spend today", "Research cache hits") | No `/api/usage` or `/api/stats` endpoint exists; dashboard shows placeholders. |

---

## 5. ARCHITECTURE CHANGES

Things built differently from the blueprint:

**1. Apollo API never used — only Google Places**
BLUEPRINT.md and AGENTS.md specify "Apollo API + Google Places API." In practice, `leadDiscovery.ts` uses only **Google Places API (New)** (`places.googleapis.com/v1/places:searchText`) for lead search. The function named `searchApollo()` actually calls Google Places. The `searchPlaces()` function always returns `[]` (disabled to avoid duplicates). Apollo API is never called in any agent. Email enrichment uses Apollo only for domain-level email lookup (not lead search).

**2. Email enrichment added (not in original spec)**
`emailEnrichment.ts` was added as an extra layer: during lead ingestion, if a prospect has no email, the system tries to enrich it via mock/Hunter/Apollo. This is a useful addition not described in the original blueprint.

**3. Webhook ops routes added**
Two operational webhook endpoints were added beyond the spec: `/webhooks/nightly/ingest` and `/webhooks/morning/digest`. These support a fully automated overnight pipeline via n8n (nightly-lead-pipeline.json, morning-lead-digest.json), which was not in the original Phase 1 plan.

**4. PM2 + n8n workflows infrastructure**
`infra/pm2/ecosystem.config.cjs` and `infra/n8n/workflows/` were added to support production-style process management and automated scheduling. Not in original blueprint but sensible additions for operability.

**5. Resend for email**
`sendEmail.ts` uses Resend (REST, no SDK). The blueprint did not specify an email provider for transactional sends. Resend is a reasonable choice but undocumented in BLUEPRINT.md or DECISIONS.md.

**6. Internal Settings page added**
`/internal/settings` page (enrichment provider, API key management) was built. Not in the original Phase 2 session plan (Session O was "Client settings + widget embed" for the client portal) but a practical addition.

**7. Outreach agent skips QA inline**
Per AGENTS.md: _"Passes draft to QA Agent before anything is stored."_ The outreach agent does not call `runQA()`. QA agent is built but disconnected from the outreach flow.

**8. `searchApollo` / `searchPlaces` function naming**
The internal function names in `leadDiscovery.ts` (`searchApollo`, `searchPlaces`) are misleading — both originally intended to call separate APIs, but now only `searchApollo` (confusingly) calls Google Places, and `searchPlaces` is a no-op stub.

**9. Seed uses raw SQL for user upsert**
`infra/seed.ts` uses raw `client.unsafe()` SQL for the user upsert with a comment "Drizzle enum OID bug on postgres-js." This is a workaround and should be documented in DECISIONS.md.

**10. tenants route path differs from blueprint**
Blueprint shows `routes/tenants.ts` but the route is mounted at `/api/v1/tenants` (not `/api/tenants`). The "v1" prefix is inconsistent with the other routes (`/api/leads`, `/api/campaigns`, etc.).

---

## 6. DOCS THAT NEED UPDATING

| Doc | Issue |
|---|---|
| `CLAUDE.md` | Session L is marked `[ ]` but the code for lead detail + campaign manager is fully built. Should be `[x]`. |
| `BLUEPRINT.md` | States "Apollo API + Google Places API" as lead sources; Apollo is not used for search. Update to reflect Google Places as primary (only) search source. |
| `BLUEPRINT.md` | Does not mention email enrichment (Hunter/Apollo for domain-email lookup), Resend email provider, PM2 configuration, or n8n operational webhooks. |
| `AGENTS.md` | `promptHygiene.ts` agent is fully specced but the file does not exist. Either note it as not built or remove from docs. |
| `AGENTS.md` | `clientAssistant.ts` is specced. Should note it as Phase 2 pending. |
| `docs/ENVIRONMENTS.md` | Presumably needs `RESEND_API_KEY`, `EMAIL_FROM`, `INTERNAL_WEBHOOK_SECRET` added (introduced after initial setup). Cannot confirm current state without reading it. |
| `docs/DECISIONS.md` | Should document: Google Places vs Apollo decision, Resend email provider choice, raw SQL workaround in seed, PM2 adoption, outreach worker gap. Cannot confirm current state without reading it. |
| `docs/TOKEN_BUDGET.md` | Cannot confirm current state but likely needs updating now that emailEnrichment.ts is added and QA agent is not wired into outreach flow. |

---

## 7. NEXT STEPS

### To complete Phase 1 end-to-end testing

1. **Fix the outreach worker gap** — create `packages/queue/src/workers/outreachWorker.ts` that dequeues from the outreach queue and calls `runOutreach()`. Wire it into PM2 (`ecosystem.config.cjs`) and the `package.json` scripts.

2. **Wire QA Guardrail into outreach agent** — call `runQA()` inside `runOutreach()` after `generateMessage()` succeeds, before inserting into `message_attempts`. If QA blocks, set `status: "blocked_by_qa"` instead of `"pending_approval"`.

3. **Fix the port mismatch** — use `"http://localhost:3005"` fallback consistently in leads-related frontend files, or better: pull from a single `API_URL` env var consistently.

4. **Run the actual e2e test** — `tsx scripts/test-e2e.ts` with a real `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY`. Verify all 7 steps pass. Update the e2e assertion on `painPoints` to be lenient (check `Array.isArray` rather than `length > 0`) to handle businesses with no fetchable website.

5. **Mark CLAUDE.md Session L as done** — leads/[id] and campaigns pages are fully built.

### To complete QYRO Assist (Phase 2)

6. **Build `clientAssistant.ts` agent** — This is the core QYRO Assist agent. It must handle FAQ, escalation, and booking intent detection. Use `compact.ts` (already built) for turn-6 compaction. Write a corresponding BullMQ worker or HTTP endpoint for the client widget to call.

7. **Build the actual widget JS** — The widget embed page (`/client/widget`) generates a `<script>` tag pointing to `https://widget.qyro.ai/widget.js`. This JavaScript file does not exist. Build it (likely a separate app or serverless function) — it needs to render a chat bubble on any third-party website and POST messages to the API.

8. **Create `docs/PROMPTS/assist/` prompt packs** — QYRO Assist needs prompt packs (FAQ answer sets, missed-call SMS templates) for each niche being sold. Start with one niche (e.g., medspa or dental).

9. **Build Session P (Polish + mobile)** — Add real data to the two placeholder stat cards on the internal dashboard (token spend today, cache hits). General mobile/responsive polish pass across both portals.

10. **Add tenant_type access control to routes** — Currently any tenant can call any route. Add a middleware check (or inline guards) so `internal`-only routes reject `assistant` tenants, and vice versa.

### To get to first paying client

11. **Stripe billing** — Build `apps/api/src/routes/billing.ts` and wire Stripe webhook handling into `routes/webhooks.ts`. Add plan selection and subscription status to the client portal.

12. **Manual onboarding flow** — Until Phase 3, onboard clients manually: run seed with their Clerk user ID, set their tenant_type to "assistant", configure their settings via `/client/settings`. Document the manual onboarding steps.

13. **Add Postgres RLS policies** — Create a migration that adds `CREATE POLICY tenant_isolation` on all tenant-scoped tables. Without this, tenant isolation depends entirely on the application layer. This is a security gap for a multi-tenant product.

14. **Validate the lead engine actually signs clients** — Run the full nightly pipeline (n8n workflow → ingest → research → outreach draft → approval → email send via Resend) end-to-end with real data. Fix any runtime issues. This is the primary goal of Phase 1 — use it to find QYRO Assist clients.
