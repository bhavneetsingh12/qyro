# PROJECT_AUDIT.md
# QYRO Full Codebase Audit
# Generated: 2026-04-03
# Auditor: Claude Code (read-only, no files modified)

> Historical snapshot: this report predates the SignalWire-only cleanup and worker package split. For current architecture state, use the 2026-04-11 reports.

---

## 1. IMPLEMENTATION STATUS

### QYRO Lead (Phase 1) — Internal Use

| Feature | Status | Notes |
|---|---|---|
| DB schema + Drizzle ORM | DONE | 20 tables, all tenant-scoped |
| DB client + RLS context | DONE | `packages/db/src/client.ts` |
| Express API server | DONE | `apps/api/src/index.ts` |
| Clerk auth middleware | DONE | `apps/api/src/middleware/auth.ts` |
| Tenant scoping middleware | DONE | `apps/api/src/middleware/tenant.ts` |
| Daily token quota middleware | DONE | `apps/api/src/middleware/quota.ts` |
| Lead discovery agent | DONE | `packages/agents/src/agents/leadDiscovery.ts` |
| Research agent (+ Redis caching) | DONE | `packages/agents/src/agents/research.ts` |
| Outreach agent | DONE | `packages/agents/src/agents/outreach.ts` |
| Reply triage agent | DONE | `packages/agents/src/agents/replyTriage.ts` |
| Booking agent | DONE | `packages/agents/src/agents/booking.ts` |
| QA guardrail agent | DONE | `packages/agents/src/agents/qa.ts` |
| Email enrichment agent | DONE | `packages/agents/src/agents/emailEnrichment.ts` |
| Token budget enforcement | DONE | `packages/agents/src/budget.ts` |
| Agent runner + error envelope | DONE | `packages/agents/src/runner.ts` |
| Conversation compaction | DONE | `packages/agents/src/compact.ts` |
| Leads API routes | DONE | `apps/api/src/routes/leads.ts` |
| Campaigns API routes | DONE | `apps/api/src/routes/campaigns.ts` |
| Research BullMQ worker | DONE | `packages/workers/src/researchWorker.ts` |
| Outreach BullMQ worker | DONE | `packages/workers/src/outreachWorker.ts` |
| Internal n8n webhook routes | DONE | `apps/api/src/routes/webhooks.ts` (nightly/ingest, morning/digest) |
| Lead portal — dashboard | DONE | `/internal/dashboard` |
| Lead portal — lead list + detail | DONE | `/internal/leads`, `/internal/leads/[id]` |
| Lead portal — campaign manager | DONE | `/internal/campaigns` |
| Lead portal — approval queue | DONE | `/internal/approvals` |
| Lead portal — settings | DONE | `/internal/settings` |
| Phase 1 E2E test script | DONE | `scripts/test-e2e.ts` |

### QYRO Assist (Phase 2) — Multi-Tenant Client Product

| Feature | Status | Notes |
|---|---|---|
| Calendar adapters (Google + Cal.com) | DONE | `packages/agents/src/calendars/` — 4 files |
| Client Assistant agent (text) | DONE | `packages/agents/src/agents/clientAssistant.ts` |
| Voice Assistant agent | DONE | `packages/agents/src/agents/voiceAssistant.ts` |
| Voice routes (Twilio inbound) | PARTIAL | Routes exist. Critical bugs (see Section 2). |
| Assist API routes (chat, missed-call, approve/reject, pending) | DONE | `apps/api/src/routes/assist.ts` |
| Widget JavaScript (embeddable) | DONE | `apps/web/public/widget.js` |
| Prompt packs (FAQ, SMS, email, voice) | DONE | `docs/PROMPTS/assist/` — 4 files |
| Client portal — dashboard | DONE | `/client/dashboard` |
| Client portal — conversations | DONE | `/client/conversations` |
| Client portal — approvals | DONE | `/client/approvals` |
| Client portal — calls | DONE | `/client/calls` |
| Client portal — settings | DONE | `/client/settings` (widget config, providers) |
| Client portal — call control (Phase B) | DONE | `/client/call-control` |
| Assist E2E test script | DONE | `scripts/test-assist-e2e.ts` |

### Outbound Call Pipeline (Phase 5A)

| Feature | Status | Notes |
|---|---|---|
| Outbound call schema columns | DONE | Migration `0002_outbound_call_pipeline.sql` |
| Outbound BullMQ queue | DONE | `packages/queue/src/queues.ts` |
| Outbound BullMQ worker | DONE | `packages/queue/src/workers/outboundCallWorker.ts` |
| Outbound enqueue API | DONE | `POST /api/v1/assist/outbound-calls/enqueue` |
| Outbound pipeline view API | DONE | `GET /api/v1/assist/outbound-calls/pipeline` |
| Outbound control (pause/resume) API | DONE | `GET|PATCH /api/v1/assist/outbound-calls/control` |
| Outbound metrics API | DONE | `GET /api/v1/assist/outbound-calls/metrics` |
| Outbound cancel API | DONE | `POST /api/v1/assist/outbound-calls/cancel/:id` |
| DNC enforcement at dial time | DONE | Worker checks `doNotContact` table |
| Capacity throttle guard | DONE | Worker enforces `maxConcurrentCalls` |
| Retry schedule (15min/2hr/1day/3day) | DONE | `voice.ts` status route + worker |
| DND intent capture during call | DONE | `voice.ts` turn route |
| Tenant pause/resume switch | DONE | Via metadata + control PATCH |
| Global pause switch | DONE | `OUTBOUND_VOICE_GLOBAL_PAUSED` env var |
| Outbound E2E test script | DONE | `scripts/test-outbound-calls-e2e.ts` |

### NOT YET BUILT (by design or missing)

| Feature | Status | Notes |
|---|---|---|
| Stripe billing integration | NOT STARTED | `billingEvents` table exists, zero Stripe code. Phase 3. |
| Stripe webhooks | NOT STARTED | `webhooks.ts` has no Stripe handler. |
| Clerk webhooks | NOT STARTED | `webhooks.ts` has no Clerk handler. |
| Cal.com webhooks | NOT STARTED | `webhooks.ts` has no Cal.com handler. |
| Self-serve tenant onboarding | NOT STARTED | Phase 3 — by design. |
| Twilio signature verification on voice routes | MISSING | Security gap (see Section 3). |
| Rate limiting on chat endpoint | MISSING | No rate limiter anywhere. |
| Session P (polish + mobile) | NOT STARTED | CLAUDE.md checklist shows `[ ]`. |
| Lead engine as a product (Phase 4) | NOT STARTED | By design. |
| Calendly / Square Appointments adapters | NOT STARTED | Phase 3 per QYRO_ASSIST_INSTRUCTIONS.md |

---

## 2. CODE FLAWS

### BUG-01 — P0 — Widget chat endpoint blocked by Clerk auth
**File**: `apps/api/src/index.ts` lines 83–88  
**What**: The `assistRouter` is mounted under `/api` with `requireClerkAuth` and `tenantMiddleware` applied. This means `POST /api/v1/assist/chat` — the endpoint the widget calls — requires a valid Clerk session. The widget runs on third-party customer websites with no Clerk session.  
**Impact**: Widget chat is completely non-functional in any environment where `DEV_BYPASS_AUTH` is not `true`. Every widget POST returns 401. First paying customers cannot use the product.  
**Fix**: Move `/api/v1/assist/chat` and `/api/v1/assist/missed-call` to a public route group (like the voice routes). Validate the `tenantId` directly from the request body by looking it up in the DB, without requiring a Clerk session.

---

### BUG-02 — P0 — Session UUID spoken aloud to customer during voice call
**File**: `apps/api/src/routes/voice.ts` line 113  
**What**:
```typescript
const say = `${reply} Session ID ${session.id}.`;
```
The greeting TwiML includes the raw UUID (e.g., "Session ID 550e8400-e29b-41d4-a716-446655440000") appended to the AI greeting. This is read to every inbound caller.  
**Impact**: Every caller hears a garbled UUID after the greeting. Damages first impression. Appears to be a debug artifact never removed.  
**Fix**: Remove ` Session ID ${session.id}.` from the greeting string. The sessionId is passed via query param to the `/turn` route — it does not need to be spoken.

---

### BUG-03 — P1 — Voice calls have no conversation history (AI forgets everything each turn)
**File**: `apps/api/src/routes/voice.ts` line 240  
**What**:
```typescript
const turn = await processTurn({
  tenantId: session.tenantId,
  sessionId: session.id,
  message: speech,
  history: [],   // ← hardcoded empty array
  runId: callSid || undefined,
});
```
`history` is always `[]`. Each turn the AI has no memory of what was said earlier in the same call.  
**Impact**: AI cannot maintain context. Cannot follow multi-turn conversations ("What was the appointment we just booked?"). Makes voice booking flow completely broken.  
**Fix**: Load conversation history from the DB (the `assistantSessions` table with turn tracking, or `messageAttempts`) before calling `processTurn`. The `compact.ts` module exists for this purpose.

---

### BUG-04 — P1 — Inbound voice session created with wrong session type
**File**: `apps/api/src/routes/voice.ts` line 96  
**What**:
```typescript
sessionType: "missed_call_sms",
```
An inbound voice call creates an `assistantSession` with type `"missed_call_sms"`. This is wrong — it should be `"voice_inbound"`.  
**Impact**: All voice call sessions are misclassified in the DB. Reporting, analytics, and filtering (e.g., `/client/calls` page) will show inbound voice calls as SMS sessions. Data integrity issue.  
**Fix**: Change `sessionType: "missed_call_sms"` to `sessionType: "voice_inbound"` in the incoming route handler.

---

### BUG-05 — P1 — Widget sends `channel: "sms"` for website chat
**File**: `apps/web/public/widget.js` line 73  
**What**:
```javascript
channel: "sms"
```
The website chat widget hardcodes `channel: "sms"`. Website chat is not SMS.  
**Impact**: All widget conversations are classified as SMS in `messageAttempts.channel`. This affects filtering, reporting, and any channel-specific logic (SMS max 160 chars, SMS opt-out wording). Silent data corruption.  
**Fix**: Change to `channel: "chat"` or `channel: "email"` — whatever is the canonical value for widget-originated messages in the `messageAttempts` schema.

---

### BUG-06 — P1 — Port mismatch between `.env.example` and `index.ts` default
**File**: `.env.example` line 33 vs `apps/api/src/index.ts` line 16  
**What**:
```
# .env.example
PORT=3001

// index.ts
const PORT = Number(process.env.PORT ?? 3005);
```
`.env.example` documents port 3001. The server defaults to 3005 if `PORT` is not set. Any developer who copies `.env.example` and then does NOT set `PORT` in `.env.local` will get port 3001 from the env file but the server code defaults to 3005.  
Wait — if `.env.example` IS copied to `.env.local` and `PORT=3001` is set, the server will run on 3001. If `.env.local` is not present, server runs on 3005. The mismatch is that the hardcoded fallback in code (3005) disagrees with the documented default (3001). This has caused real port confusion noted in CLAUDE.md commit history.  
**Impact**: Frontend may call wrong port. E2E tests may fail. Confusing to new contributors.  
**Fix**: Align the default in `index.ts` to `3001`: `const PORT = Number(process.env.PORT ?? 3001)`.

---

### BUG-07 — P1 — `findTenantByTwilioNumber` loads all active tenants into memory
**File**: `apps/api/src/routes/voice.ts` lines 51–62  
**What**:
```typescript
const activeTenants = await db.query.tenants.findMany({
  where: eq(tenants.active, true),
});
const target = normalizePhone(toPhone);
return activeTenants.find((t) => { ... });
```
Every inbound Twilio call loads the entire tenants table into memory, then does JS-level phone number matching.  
**Impact**: Does not scale. 100 tenants = 100 DB rows fetched per call. If twilio_number were indexed, a direct SQL query would be instant. At moderate scale this will cause latency and memory pressure.  
**Fix**: Add a DB index on `tenants.metadata->>'twilio_number'` (or extract it to a typed column), and query directly.

---

### BUG-08 — P2 — `findProspectByPhone` loads up to 200 prospect rows for in-memory match
**File**: `apps/api/src/routes/voice.ts` lines 64–75  
**What**:
```typescript
const prospects = await db.query.prospectsRaw.findMany({
  where: eq(prospectsRaw.tenantId, tenantId),
  orderBy: desc(prospectsRaw.createdAt),
  limit: 200,
});
return prospects.find((p) => normalizePhone(p.phone ?? "") === target) ?? null;
```
Loads 200 prospects per call and matches in JS. Will miss prospects if more than 200 exist.  
**Impact**: Silent miss on callers who are existing prospects beyond the 200 limit. Silently creates duplicate prospect records.  
**Fix**: Add a normalized phone column or query by phone directly with SQL.

---

### BUG-09 — P2 — `webhooks.ts` does not handle Stripe, Clerk, or Cal.com events
**File**: `apps/api/src/routes/webhooks.ts`  
**What**: The file only implements `POST /webhooks/nightly/ingest` and `POST /webhooks/morning/digest`. Despite CLAUDE.md, the index page endpoint listing (`/`), and the `billingEvents` + `webhookEvents` tables implying otherwise, there are zero Stripe webhook handlers, zero Clerk webhook handlers, and zero Cal.com webhook handlers.  
**Impact**: 
- `billingEvents` table is permanently empty — no billing state tracked.
- Plan upgrades/downgrades from Stripe never applied.
- Clerk user lifecycle events (deletion, etc.) not handled.
- Cal.com booking confirmations never processed.  
**Fix**: Implement Stripe, Clerk, and Cal.com handlers in Phase 3.

---

### BUG-10 — P2 — `getOrCreateProspect` only matches on phone, ignores email
**File**: `apps/api/src/routes/assist.ts` lines 55–63  
**What**:
```typescript
where: and(
  eq(prospectsRaw.tenantId, params.tenantId),
  phone ? eq(prospectsRaw.phone, phone) : undefined,
) as any,
```
If a phone number is provided, it matches on phone. If only email is provided and `phone` is null/empty, the `where` clause becomes `and(tenantId_match, undefined)` — which Drizzle likely treats as just the tenantId condition, returning the first prospect for that tenant regardless of email.  
**Impact**: If a widget visitor provides only email (no phone), `getOrCreateProspect` may return a wrong prospect record or the first prospect in the DB. Silent data corruption.  
**Fix**: Properly handle the email-only case with an explicit email `eq` condition.

---

### BUG-11 — P3 — QYRO_ASSIST_INSTRUCTIONS.md completion checklist is stale
**File**: `QYRO_ASSIST_INSTRUCTIONS.md` lines 205–213  
**What**: All 9 session checkboxes (AA–AI) are unchecked `[ ]` in the document, but CLAUDE.md addendum confirms all sessions AA–AI are complete.  
**Impact**: False reporting of project status. Confusing for anyone reading this document.  
**Fix**: Mark all 9 checkboxes as `[x]`.

---

### BUG-12 — P3 — API root endpoint (`GET /`) lists wrong paths
**File**: `apps/api/src/index.ts` lines 47–55  
**What**:
```typescript
endpoints: {
  assist: "POST /api/assist",        // actual: /api/v1/assist/chat
  tenants: "GET /api/v1/tenants",    // actual: /api/v1/tenants/settings
  webhooks: "POST /webhooks"         // actual: /webhooks/nightly/ingest, /webhooks/morning/digest
}
```
The discovery endpoint documents wrong paths.  
**Impact**: Misleads API consumers. Low severity.  
**Fix**: Update the paths to reflect actual routes.

---

## 3. SECURITY ISSUES

### SEC-01 — P0 — No Twilio signature verification on voice routes
**File**: `apps/api/src/index.ts` line 63; `apps/api/src/routes/voice.ts`  
**What**: Voice routes (`/api/v1/voice/incoming`, `/api/v1/voice/turn`, `/api/v1/voice/outbound/twiml`, `/api/v1/voice/status`) are completely public with no request validation. Any HTTP client can POST to these endpoints with forged Twilio parameters.  
**Impact**: An attacker can:
- Forge calls to any tenant's phone number, triggering AI responses
- Forge DND requests to block future calls to any prospect
- Trigger retry scheduling, exhausting call attempt slots
- Manipulate call status (mark calls completed, etc.)  
**Fix**: Add `twilio.validateExpressRequest()` using `twilio` SDK and `TWILIO_AUTH_TOKEN` env var. This validates the `X-Twilio-Signature` header.

---

### SEC-02 — P0 — Widget chat endpoint requires Clerk auth (same as BUG-01)
**File**: `apps/api/src/index.ts` lines 83–88  
**What**: `POST /api/v1/assist/chat` and `POST /api/v1/assist/missed-call` require Clerk auth (they are under the `/api` mount with `requireClerkAuth`). The widget never has a Clerk session.  
**Impact**: In production, every widget chat request returns 401. This is both a critical bug AND a security architecture problem — the chat endpoint needs to be public but validated by tenantId lookup instead of Clerk session.

---

### SEC-03 — P1 — Widget CSRF risk — no tenantId origin validation
**File**: `apps/web/public/widget.js`; `apps/api/src/routes/assist.ts`  
**What**: The widget sends `tenantId` in the request body. If the chat endpoint were made public (fixing SEC-02), any party could POST to `/api/v1/assist/chat` with any `tenantId`, injecting messages into any tenant's inbox.  
**Impact**: An attacker could flood competitor tenants with fake chat messages.  
**Fix**: When making the chat endpoint public, validate that the origin of the request matches the tenant's configured `widget_allowed_origins` domain list. Add rate limiting per IP/session.

---

### SEC-04 — P1 — API keys stored unencrypted in JSONB metadata
**File**: `apps/api/src/routes/tenants.ts`  
**What**: Apollo API key, Hunter API key, and Cal.com API key are stored as plaintext in the `tenants.metadata` JSONB column. They are masked in API responses but stored unencrypted in the database.  
**Impact**: A database dump or backup exposure leaks all tenant API keys.  
**Fix**: Encrypt API key values at rest before storing (AES-256 with a server-side key), or use a dedicated secrets table with application-level encryption.

---

### SEC-05 — P2 — No rate limiting on any endpoints
**File**: `apps/api/src/index.ts`  
**What**: There is no rate limiting middleware on any route — not on chat, not on voice, not on lead ingestion.  
**Impact**: 
- Chat endpoint (when fixed) can be abused for DoS
- Lead ingest can be spammed to exhaust quotas
- Voice turn can be called in a loop  
**Fix**: Add `express-rate-limit` with Redis store. Prioritize the chat endpoint and voice endpoints.

---

### SEC-06 — P2 — Missing env vars not documented in `.env.example`
**File**: `.env.example`  
**What**: The following env vars are used in code but absent from `.env.example`:
- `TWILIO_ACCOUNT_SID` — required by outbound call worker
- `TWILIO_AUTH_TOKEN` — required for Twilio API + signature validation
- `PUBLIC_API_BASE_URL` — used as base for Twilio callback URLs
- `INTERNAL_TENANT_ID` — required when `DEV_BYPASS_AUTH=true`
- `EXTRA_WEB_ORIGIN` — CORS additional origin
- `OUTBOUND_VOICE_GLOBAL_PAUSED` — global pause switch
- `DEFAULT_TIMEZONE` — calendar/scheduling default TZ
- `GOOGLE_CALENDAR_ID` — Google Calendar integration
- `DEFAULT_CALENDAR_PROVIDER` — `google_calendar` | `cal_com`
- `CAL_API_KEY` — Cal.com API key
- `CAL_EVENT_TYPE_ID` — Cal.com event type
- `PROMPTS_DIR` — path override for prompt files  
**Impact**: New deployments will silently fail or use wrong defaults for any of these.  
**Fix**: Add all missing vars to `.env.example` with placeholder values and comments.

---

### SEC-07 — P2 — `DEV_BYPASS_AUTH` has no IP restriction
**File**: `apps/api/src/middleware/tenant.ts` lines 22–51  
**What**: When `DEV_BYPASS_AUTH=true`, any request with `INTERNAL_TENANT_ID` in the header (or matching fallback behavior) bypasses Clerk entirely.  
**Impact**: If this env var is accidentally set on a production server, all auth is disabled.  
**Fix**: Add an additional guard: `if (process.env.NODE_ENV === 'production' && process.env.DEV_BYPASS_AUTH === 'true') throw new Error('DEV_BYPASS_AUTH is not allowed in production')`.

---

### SEC-08 — P3 — Widget sessionId has no server-side TTL or expiry
**File**: `apps/web/public/widget.js` lines 10–11  
**What**: `sessionId` is stored in `localStorage` with no expiry. The server never expires sessions.  
**Impact**: A stolen sessionId works forever. Abandoned sessions accumulate.  
**Fix**: Add session TTL (e.g., 30 days) in `assistantSessions` and reject stale sessionIds.

---

## 4. MISSING IMPLEMENTATIONS

### MISS-01 — Stripe not implemented (billing is completely absent)
No Stripe SDK. No `stripe` npm package. No Stripe webhook handler. No subscription checks. No plan enforcement beyond the manually seeded `plans` table. The `billingEvents` table will always be empty. See Section 6 for full Stripe status.

### MISS-02 — Clerk user lifecycle webhook not implemented
There is no handler for Clerk's `user.deleted` or `user.updated` events. If a user is deleted in Clerk, their `users` row and associated data remain in the DB. This is a data hygiene issue.

### MISS-03 — Cal.com booking confirmation webhook not implemented
`appointments` are created optimistically by the booking agent, but Cal.com sends async confirmation webhooks. There is no handler to update appointment status from Cal.com.

### MISS-04 — Twilio account credentials not in `.env.example`
`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are used by the outbound call worker and voice routes but not documented. A fresh deployment will fail silently at Twilio dial time.

### MISS-05 — Google Calendar credentials not in `.env.example`
`GOOGLE_CALENDAR_ID`, `DEFAULT_CALENDAR_PROVIDER`, and related OAuth credentials are not documented. Google Calendar adapter is implemented but cannot run without these.

### MISS-06 — Prompt loader `PROMPTS_DIR` not in `.env.example`
The agents package uses `PROMPTS_DIR` env var to locate prompt pack files. Not documented. If unset, falls back to `docs/PROMPTS` relative path which may not resolve correctly in all environments.

### MISS-07 — No `/client/widget` page that shows actual embed code
The sidebar navigation links to `/client/widget` (per the `ls` output showing a `widget` directory under client). The settings page (`/client/settings`) handles widget config. Whether `/client/widget` exists as a separate page with embed code instructions is unclear from directory listing alone.

### MISS-08 — No inbound SMS handling route
`QYRO_ASSIST_INSTRUCTIONS.md` specifies missed-call SMS replies should be handled. `POST /api/v1/assist/missed-call` exists for outbound SMS initiation. But there is no route for handling an inbound SMS reply (a customer texting back). Twilio would need a separate webhook for inbound SMS.

---

## 5. INTERFACE MISMATCHES

### MM-01 — P0 — Widget endpoint URL vs auth requirement
**Frontend (widget.js)**: calls `POST {apiBase}/api/v1/assist/chat` with no auth headers  
**Backend (index.ts)**: `/api/v1/assist/chat` requires Clerk session via `requireClerkAuth`  
**Result**: 401 on every widget message in production. Widget is non-functional.

### MM-02 — P1 — Widget channel field mismatch
**Frontend (widget.js line 73)**: sends `channel: "sms"`  
**Backend (messageAttempts schema)**: enum likely includes `email | sms` but website chat is not SMS  
**Result**: All widget conversations misclassified as SMS in the database.

### MM-03 — P1 — Port mismatch between env docs and code default
**`.env.example`**: `PORT=3001`  
**`apps/api/src/index.ts` line 16**: `process.env.PORT ?? 3005`  
**Result**: If `PORT` is not explicitly set in environment, server starts on 3005 not 3001. Frontend or tests expecting port 3001 will fail.

### MM-04 — P2 — `GET /` API info lists wrong endpoint paths
**`index.ts` lines 47–55**: Documents `POST /api/assist`, `GET /api/v1/tenants`  
**Actual routes**: `POST /api/v1/assist/chat`, `GET /api/v1/tenants/settings`  
**Result**: Discovery endpoint misleads API consumers.

### MM-05 — P2 — Voice turn route doesn't use session ID from URL correctly in inbound calls
**`voice.ts` incoming handler (line 113)**: Speaks session ID (bug). No session ID passed as query param in `twimlGatherAndSay`.  
**`voice.ts` turn handler (line 166)**: Reads `sessionId` from query or body.  
**Result**: For inbound calls, `sessionId` is never passed in the `<Gather action>` URL, so the turn handler always gets an empty sessionId, then fails to find the session, and returns "Your session was not found."  

This is a compound of BUG-02 (session ID spoken aloud) and a separate routing flaw: `twimlGatherAndSay(say)` uses a hardcoded `/api/v1/voice/turn` action with no `?sessionId=` query param. The outbound route correctly uses `twimlGatherAndSayWithAction(action, ...)` with session ID in the URL. The inbound route does not.

---

## 6. STRIPE AND BILLING STATUS

### What exists
- **`packages/db/src/schema.ts`**: `billingEvents` table — columns: `id`, `tenantId`, `stripeEventId`, `eventType`, `amount`, `metadata`
- **`packages/db/src/schema.ts`**: `webhookEvents` table — `source` field would support `"stripe"`
- **`packages/db/src/schema.ts`**: `plans` table — `priceMonthly`, `setupFee` columns exist (seeded manually)

### What does NOT exist
- `stripe` npm package — not in any `package.json`
- Stripe SDK initialization — nowhere in codebase
- Stripe webhook signature verification — not implemented
- Stripe checkout / subscription creation — not implemented
- Stripe webhook handler (`/webhooks/stripe/*`) — not implemented
- Subscription status enforcement — `plans` table is seeded but never checked at runtime based on Stripe state
- Plan upgrade / downgrade flow — not implemented

### Summary
**Stripe billing is 0% implemented.** The schema is pre-built in anticipation of Phase 3. All current QYRO Assist clients are on manually assigned plans. No automated billing. This is consistent with Phase 2 design intent ("Manual onboarding for first clients is fine") but must be implemented before scaling beyond a handful of customers.

---

## 7. QYRO ASSIST STATUS

### clientAssistant.ts
**Exists**: Yes — `packages/agents/src/agents/clientAssistant.ts`  
**Complete**: Yes  
**Features**: Intent detection (question | booking_intent | escalate | unsubscribe), calendar adapter integration, conversation compaction every 6 turns, QA guardrail before reply, returns `{ reply, intent, escalate, bookingId?, sessionId }`.

### voiceAssistant.ts
**Exists**: Yes — `packages/agents/src/agents/voiceAssistant.ts`  
**Complete**: Yes  
**Features**: Wraps clientAssistant with voice constraints (max 2-3 sentences), exports `greeting()`, `processTurn()`, `transferToStaff()`.

### Calendar Adapters
**Exists**: Yes — `packages/agents/src/calendars/`  
**Files**: `types.ts`, `googleCalendar.ts`, `calCom.ts`, `index.ts` (factory)  
**Complete**: Yes (Google Calendar + Cal.com). Calendly and Square Appointments are Phase 3.

### Voice Routes
**Exists**: Yes — `apps/api/src/routes/voice.ts`  
**Complete**: PARTIAL — routes exist and handle Twilio TwiML correctly, but contain critical bugs (session UUID spoken aloud, empty history, wrong session type, inbound session ID not passed to turn route).

### Widget.js
**Exists**: Yes — `apps/web/public/widget.js`  
**Complete**: PARTIAL — Shadow DOM isolation, chat bubble, session persistence, history limiting (30 msgs) all work. Critical flaw: `channel: "sms"` mislabeled, and the endpoint it calls is blocked by Clerk auth in production.

### Prompt Packs (`docs/PROMPTS/assist/`)
**Exists**: Yes — 4 files confirmed:
- `general_faq_v1.md`
- `general_missed_call_sms_v1.md`
- `general_followup_email_v1.md`
- `general_voice_v1.md`  
**Complete**: Yes (all 4 required by Session AF).

### Assist API Routes
**Exists**: `apps/api/src/routes/assist.ts`  
**What exists**:
- `GET /api/sessions` ✓
- `GET /api/appointments` ✓
- `POST /api/v1/assist/chat` ✓ (exists, but behind wrong auth — see BUG-01)
- `POST /api/v1/assist/missed-call` ✓
- `POST /api/v1/assist/approve/:messageId` ✓
- `POST /api/v1/assist/reject/:messageId` ✓
- `GET /api/v1/assist/pending` ✓
- `GET /api/v1/assist/calls` ✓
- All outbound call pipeline routes ✓

**What is missing**:
- Inbound SMS reply webhook route (customer texting back)
- Stripe billing routes (Phase 3)

### Client Portal Pages
| Page | Real Data | Notes |
|---|---|---|
| `/client/dashboard` | Cannot confirm | Calls `/api/sessions` + `/api/appointments` — routes exist |
| `/client/conversations` | Cannot confirm | Calls `/api/sessions` |
| `/client/approvals` | Cannot confirm | Calls `/api/v1/assist/pending` |
| `/client/calls` | Cannot confirm | Calls `/api/v1/assist/calls` |
| `/client/call-control` | Cannot confirm | Calls outbound metrics + control routes |
| `/client/settings` | Cannot confirm | Calls `/api/v1/tenants/settings` |

All portal pages call existing API routes. Cannot confirm data renders correctly without running the app. Route-level alignment appears correct.

---

## 8. WHAT WORKS RIGHT NOW

### Can run and demonstrate without changes
- **Lead discovery pipeline**: `POST /webhooks/nightly/ingest` → research worker → outreach worker → approval queue. Fully functional for internal use. All routes auth'd correctly for internal tenant.
- **Internal portal**: Dashboard, leads, campaigns, approvals, settings — all pages call correct endpoints. Functional for a signed-in internal user.
- **Outbound call pipeline backend**: Enqueue, pause, resume, metrics, cancel — all routes work. Worker enforces DNC, compliance flags, capacity throttle, and retry scheduling.
- **Call Control page**: `/client/call-control` renders live metrics and pause/resume controls.
- **Tenant settings API**: `GET|PATCH /api/v1/tenants/settings` — works, API keys masked.
- **Token budget enforcement**: All LLM calls go through `quota.ts`. Hard stop at plan limits.
- **QA guardrail**: Mandatory before any outbound message.

### Cannot confirm without running
- **Widget chat**: Blocked by auth in production (P0 bug). Works in dev with `DEV_BYPASS_AUTH=true`.
- **Inbound voice calls**: Route exists but three bugs (spoken UUID, empty history, wrong session type) make it unusable for real calls.
- **Outbound voice calls**: Worker and routes are implemented. Whether actual Twilio dials succeed depends on `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` being set.
- **Calendar booking**: Cal.com and Google Calendar adapters exist but depend on `CAL_API_KEY`, `GOOGLE_CALENDAR_ID` etc. being configured.
- **Client portal pages**: Routes exist and match. Cannot confirm rendering without running the Next.js server.

---

## 9. PRIORITY FIX LIST

### P0 — Will crash, cause data loss, or security breach

| # | Issue | File | What to Change |
|---|---|---|---|
| P0-1 | Widget chat blocked by Clerk auth | `apps/api/src/index.ts` lines 83–88 | Extract `/api/v1/assist/chat` and `/api/v1/assist/missed-call` from the auth-required `/api` mount. Add them as public routes (like voice routes). Validate tenantId by DB lookup in the handler. |
| P0-2 | Session UUID spoken aloud to callers | `apps/api/src/routes/voice.ts` line 113 | Change `const say = \`${reply} Session ID ${session.id}.\`;` to `const say = reply;` |
| P0-3 | No Twilio signature validation | `apps/api/src/routes/voice.ts` | Add `twilio.validateExpressRequest()` middleware to all `/api/v1/voice/*` routes using `TWILIO_AUTH_TOKEN`. |
| P0-4 | Inbound call session ID never passed to turn route | `apps/api/src/routes/voice.ts` line 114 | Replace `twimlGatherAndSay(say)` with `twimlGatherAndSayWithAction(\`/api/v1/voice/turn?sessionId=...\`, say)` like the outbound handler does. |

### P1 — Breaks core functionality

| # | Issue | File | What to Change |
|---|---|---|---|
| P1-1 | Voice AI has no memory (empty history) | `apps/api/src/routes/voice.ts` line 240 | Load conversation history from DB before calling `processTurn`. Use `compact.ts` if turn count > 6. |
| P1-2 | Inbound voice session type wrong | `apps/api/src/routes/voice.ts` line 96 | Change `sessionType: "missed_call_sms"` to `sessionType: "voice_inbound"` |
| P1-3 | Widget channel mislabeled "sms" | `apps/web/public/widget.js` line 73 | Change `channel: "sms"` to `channel: "chat"` (or whatever canonical value the schema uses for web chat) |
| P1-4 | Port mismatch in default + docs | `apps/api/src/index.ts` line 16 | Change default to `3001`: `const PORT = Number(process.env.PORT ?? 3001)` |
| P1-5 | `getOrCreateProspect` email-only case broken | `apps/api/src/routes/assist.ts` lines 55–63 | Fix the `where` clause to properly handle email-only match: `or(phone ? eq(prospectsRaw.phone, phone) : undefined, email ? eq(prospectsRaw.email, email) : undefined)` |
| P1-6 | Missing env vars in `.env.example` | `.env.example` | Add all 12 missing env vars listed in SEC-06 with comments and placeholder values |

### P2 — Feature incomplete, system still runs

| # | Issue | File | What to Change |
|---|---|---|---|
| P2-1 | Widget CSRF — no origin validation | `apps/api/src/routes/assist.ts` | After making chat public, validate `Origin` header against tenant's `widget_allowed_origins` list |
| P2-2 | No rate limiting | `apps/api/src/index.ts` | Add `express-rate-limit` with Redis store on chat and voice endpoints |
| P2-3 | API keys stored unencrypted | `apps/api/src/routes/tenants.ts` | Encrypt API key values before storage (AES-256 or vault solution) |
| P2-4 | `findTenantByTwilioNumber` loads all tenants | `apps/api/src/routes/voice.ts` lines 51–62 | Query by Twilio number directly (index `metadata->>'twilio_number'`) |
| P2-5 | `findProspectByPhone` loads 200 rows | `apps/api/src/routes/voice.ts` lines 64–75 | Add phone column with index; query directly |
| P2-6 | `DEV_BYPASS_AUTH` can run in production | `apps/api/src/middleware/tenant.ts` | Add `NODE_ENV === 'production'` guard that throws if bypass is enabled |
| P2-7 | Stripe billing not implemented | N/A | Phase 3 task — add `stripe` package, webhook handler, subscription checks |
| P2-8 | No inbound SMS reply route | `apps/api/src/index.ts` | Add `POST /webhooks/twilio/sms-reply` public route, look up tenant by SMS-to number, run `runClientAssistant`, reply with TwiML |
| P2-9 | API root lists wrong route paths | `apps/api/src/index.ts` lines 47–55 | Update the `endpoints` object to correct paths |
| P2-10 | QYRO_ASSIST_INSTRUCTIONS.md checklist stale | `QYRO_ASSIST_INSTRUCTIONS.md` | Mark sessions AA–AI as `[x]` |

### P3 — Polish, nice to have

| # | Issue | File | What to Change |
|---|---|---|---|
| P3-1 | Widget session has no TTL | `apps/web/public/widget.js`; `assist.ts` | Add session expiry (30 days) and reject stale sessionIds server-side |
| P3-2 | No Clerk user lifecycle webhooks | `apps/api/src/routes/webhooks.ts` | Add handler for `user.deleted` Clerk events to clean up user records |
| P3-3 | No Cal.com booking confirmation webhook | `apps/api/src/routes/webhooks.ts` | Add handler to update `appointments.status` from Cal.com confirmations |

---

## AUDIT SUMMARY

| Category | Count | Worst Severity |
|---|---|---|
| Code bugs | 12 | P0 |
| Security issues | 8 | P0 |
| Missing implementations | 8 | P0 |
| Interface mismatches | 5 | P0 |
| P0 items total | **4** | Fix before any customer goes live |
| P1 items total | **6** | Fix before voice is used by clients |
| P2 items total | **10** | Fix before Phase 3 launch |
| P3 items total | **3** | Fix before general availability |

**The internal QYRO Lead pipeline is production-ready.**  
**The QYRO Assist product has 4 P0 blockers that prevent it from working in production. Fix P0-1 through P0-4 before onboarding any paying client.**
