# QYRO Solo Rollout Checklist

Use this as your one-by-one execution list.
Rule: do not start the next item until the current item is checked.

## How to Use

- Mark each box only after you verify it yourself.
- Fill the Evidence line with a short proof (URL, screenshot note, command output summary).
- If blocked, write the blocker under Notes and move to the matching unblock item.

---

## Phase 0 - Ground Truth (Do First)

- [x] 0.1 Confirm API and TypeScript are clean
  - Action: run full type/build checks.
  - Evidence: 2026-04-04 -> `npx tsc --noEmit` produced no output (clean); `pnpm --filter @qyro/api build` completed with `tsc` success.
  - Notes: verified in workspace terminal.

- [x] 0.2 Confirm web fallback API URLs are aligned to port 3001
  - Action: verify no old localhost:3005 references remain in web source.
  - Evidence: 2026-04-04 -> search in `apps/web/src/**` for `localhost:3005` returned no matches.
  - Notes: alignment confirmed.

- [x] 0.3 Confirm PM2 production process file exists and is correct
  - Action: verify API + all workers are in production config.
  - Evidence: 2026-04-04 -> file present at `infra/pm2/ecosystem.prod.config.cjs`.
  - Notes: includes API + research worker + outreach worker + outbound-call worker entries.

---

## Phase 1 - Domains and Hosting Inputs

- [x] 1.1 Choose production web domain
  - Needed: final hostname for Next.js app.
  - Evidence: 2026-04-04 -> selected domain: qyro.us
  - Notes: if preferred later, keep marketing at qyro.us and move app to app.qyro.us.

- [ ] 1.2 Choose production API domain
  - Needed: final hostname for Express API.
  - Evidence: pending decision
  - Notes: recommended: api.qyro.us (clean separation and easiest CORS/callback setup).

- [x] 1.3 Confirm DNS ownership and access
  - Needed: registrar/dashboard login that can create records.
  - Evidence: 2026-04-04 -> confirmed full DNS access.
  - Notes:

- [x] 1.4 Confirm web hosting target
  - Needed: where web app runs in prod.
  - Evidence: 2026-04-04 -> web deployed successfully on Vercel.
  - Notes: Vercel confirmed as web host for QYRO.

- [ ] 1.5 Confirm API hosting target
  - Needed: where API runs in prod.
  - Evidence: pending decision
  - Notes: recommended for solo operator: Railway (simple deploy, env vars, and managed Postgres/Redis options). Current status: user signed into Railway with GitHub.
  - Blocking setup task: create a new dedicated Railway project for QYRO API/workers.

- [x] 1.6 Confirm worker hosting target
  - Needed: where PM2 workers run in prod.
  - Evidence: 2026-04-04 -> selected: same host as API.
  - Notes: keeps operations simpler for a one-person team.

- [x] 1.7 Create QYRO web project in Vercel
  - Needed: dedicated project (separate from zentrynexus).
  - Evidence: 2026-04-04 -> Vercel project created and deployment completed.
  - Notes: connected to `bhavneetsingh12/qyro` with web root directory.

- [ ] 1.8 Create QYRO API/workers project in Railway
  - Needed: dedicated Railway project for API + worker runtime.
  - Evidence:
  - Notes: after creation, add services/env vars and map `api.qyro.us`.

---

## Phase 2 - Core Infrastructure Secrets

- [ ] 2.1 Provision production Postgres
  - Needed: DATABASE_URL (prod only).
  - Evidence:
  - Notes:

- [ ] 2.2 Provision production Redis
  - Needed: REDIS_URL (prod only).
  - Evidence:
  - Notes:

- [ ] 2.3 Provision Clerk production keys
  - Needed: publishable/secret keys for prod environment.
  - Evidence: blocker observed in Vercel build log -> missing publishable key.
  - Notes: current status 2026-04-04 -> no Production/Preview env vars configured yet in Vercel. Next action: create Clerk env vars for Production and Preview, then redeploy.

- [ ] 2.4 Provision OpenAI production key
  - Needed: separate prod key with billing alerts.
  - Evidence:
  - Notes:

- [ ] 2.5 Verify no dev bypass in prod
  - Check: DEV_BYPASS_AUTH is not enabled in production.
  - Evidence:
  - Notes:

---

## Phase 3 - Voice Stack (Twilio + Retell)

- [ ] 3.1 Create/confirm Twilio production setup
  - Needed: account SID, auth token, owned phone number(s).
  - Evidence:
  - Notes:

- [ ] 3.2 Create/confirm Retell production setup
  - Needed: RETELL_API_KEY, RETELL_WEBHOOK_SECRET, default agent id.
  - Evidence:
  - Notes:

- [ ] 3.3 Point Twilio/Retell callbacks to production API
  - Needed: final PUBLIC_API_BASE_URL and webhook paths.
  - Evidence:
  - Notes:

- [ ] 3.4 Verify webhook signing checks are active
  - Check: invalid signatures are rejected.
  - Evidence:
  - Notes:

---

## Phase 4 - Tenant Pilot Configuration

- [ ] 4.1 Select pilot tenant
  - Needed: tenant id/slug for first rollout.
  - Evidence:
  - Notes:

- [ ] 4.2 Set pilot tenant voice runtime
  - Needed: voice_runtime set intentionally (retell or twilio).
  - Evidence:
  - Notes:

- [ ] 4.3 Set pilot tenant retell agent id
  - Needed: retell_agent_id on tenant settings.
  - Evidence:
  - Notes:

- [ ] 4.4 Set widget allowed origins
  - Needed: exact production site origins only.
  - Evidence:
  - Notes:

- [ ] 4.5 Confirm business context fields
  - Needed: approved services, business hours, booking link/provider details.
  - Evidence:
  - Notes:

---

## Phase 5 - Deployment Execution

- [ ] 5.1 Deploy API
  - Verify: health endpoint returns 200.
  - Evidence:
  - Notes:

- [ ] 5.2 Deploy workers using PM2 production config
  - Verify: research, outreach, outbound-call workers are online.
  - Evidence:
  - Notes:

- [ ] 5.3 Deploy web app
  - Verify: login and product switch page work on production domain.
  - Evidence:
  - Notes:

- [ ] 5.4 Confirm env wiring in all deployed services
  - Verify: no missing critical variables at runtime.
  - Evidence:
  - Notes:

---

## Phase 6 - Live Validation (Pilot)

- [ ] 6.1 Run Phase D Retell harness in deployed environment
  - Verify: call events, transcript events, tool calls, duplicate-skip behavior.
  - Evidence:
  - Notes:

- [ ] 6.2 Run 10 receptionist scenarios live
  - Verify: greeting, barge-in, booking, escalation, DND, retry behavior.
  - Evidence:
  - Notes:

- [ ] 6.3 Validate call-control behavior
  - Verify: pause/resume, counters, retry scheduling, DND compliance.
  - Evidence:
  - Notes:

- [ ] 6.4 Validate widget flow from allowed origin
  - Verify: chat works only from allowed origin and logs correctly.
  - Evidence:
  - Notes:

---

## Phase 7 - Operations and Safety

- [ ] 7.1 Confirm daily DB backup and restore path
  - Evidence:
  - Notes:

- [ ] 7.2 Confirm centralized logs for API and workers
  - Evidence:
  - Notes:

- [ ] 7.3 Set alerts
  - Minimum: API health, queue lag, webhook failures.
  - Evidence:
  - Notes:

- [ ] 7.4 Document secret rotation owner and method
  - Evidence:
  - Notes:

---

## Phase 8 - Go/No-Go Gate

- [ ] 8.1 All above checklist items complete
  - Evidence:
  - Notes:

- [ ] 8.2 Pilot tenant approved for real traffic
  - Evidence:
  - Notes:

- [ ] 8.3 Rollout decision recorded
  - Decision: Go / No-Go
  - Date:
  - Evidence:
  - Notes:

---

## Optional Hardening Backlog (After Pilot)

- [ ] Replace in-memory public route rate limiter with Redis-backed limiter.
- [ ] Encrypt tenant API keys at rest.
- [ ] Add stronger DB-level idempotency constraints for webhook replay protection.

---

## Personal Progress Log

- [ ] Log entry template
  - Date:
  - Completed items:
  - New blockers:
  - Next item:
