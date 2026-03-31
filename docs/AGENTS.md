# QYRO Agent Specifications

## Agent contract rules (apply to ALL agents)

1. Every agent call goes through `packages/agents/src/runner.ts` — never call OpenAI directly
2. Every call checks quota before running — `packages/agents/src/budget.ts`
3. Every call logs to `usage_events` after running
4. Error envelope is always `AgentResult<T>` — never throw raw errors to callers
5. Prompts are loaded from `docs/PROMPTS/` — never hardcoded in agent files

---

## Lead Discovery Agent

**File:** `packages/agents/src/agents/leadDiscovery.ts`
**Model tier:** cheap (gpt-4o-mini)
**Max input:** 1,500 tokens | **Max output:** 200 tokens

**What it does:**
- Queries Apollo API or Google Places API for businesses matching niche + location + size criteria
- Deduplicates against `prospects_raw` table (check domain + phone)
- Enqueues matched leads as Research jobs in BullMQ
- Writes raw lead records to `prospects_raw` with `source`, `source_id`, `consent_state: 'unknown'`

**What it must never do:**
- Invent or hallucinate contacts
- Scrape Google Maps or any site that prohibits scraping
- Auto-send anything
- Mark consent as anything other than 'unknown' on ingestion

**Inputs:** `{ tenantId, niche, location, maxResults, filters }`
**Outputs:** `{ leadsQueued: number, duplicatesSkipped: number }`

---

## Research Agent

**File:** `packages/agents/src/agents/research.ts`
**Model tier:** cheap (gpt-4o-mini) with optional web_search (max 3 calls)
**Max input:** 4,000 tokens | **Max output:** 600 tokens

**What it does:**
- Checks Redis cache first (`research:{tenantId}:{domain}`) — skip if hit
- Fetches and summarizes the prospect's website (title, services, pain points, tone)
- Classifies urgency score 1-10
- Proposes 1-2 pitch angles
- Writes enriched record to `prospects_enriched`
- Caches normalized summary in Redis (TTL: 7 days)

**What it must never do:**
- Browse indefinitely (3 web lookups max)
- Use expensive models for basic classification
- Decide legal compliance on its own
- Store raw scraped pages permanently

**Inputs:** `{ tenantId, prospectId, domain }`
**Outputs:** `{ summary, urgencyScore, pitchAngles, cached: boolean }`

---

## Outreach Agent

**File:** `packages/agents/src/agents/outreach.ts`
**Model tier:** cheap (gpt-4o-mini)
**Max input:** 2,000 tokens | **Max output:** 250 tokens

**What it does:**
- Loads the approved prompt pack for the niche/channel from `docs/PROMPTS/`
- Resolves all placeholders against the enriched prospect record
- Drafts the outreach message (email or SMS)
- Passes draft to QA Agent before anything is stored
- Writes to `message_attempts` with `status: 'pending_approval'`
- Stops immediately if prospect is in `do_not_contact`

**What it must never do:**
- Send without human approval gate
- Message any prospect in `do_not_contact`
- Continue messaging after an unsubscribe reply
- Change brand tone without an approved prompt pack change
- Use unapproved placeholders

**Inputs:** `{ tenantId, prospectId, sequenceId, channel }`
**Outputs:** `{ messageId, status: 'pending_approval' | 'blocked_by_qa' }`

---

## Reply Triage Agent

**File:** `packages/agents/src/agents/replyTriage.ts`
**Model tier:** cheap (gpt-4o-mini)
**Max input:** 1,500 tokens | **Max output:** 100 tokens

**What it does:**
- Classifies inbound reply into: `interested` | `neutral` | `not_now` | `unsubscribe` | `angry` | `question`
- Routes to appropriate next step (book call / send follow-up / add to DNC / escalate to human)
- Immediately adds to `do_not_contact` if classified as `unsubscribe`
- Logs classification to `message_attempts`

**What it must never do:**
- Send any reply itself
- Override an `unsubscribe` classification
- Miss an unsubscribe signal (err toward false positives here)

**Inputs:** `{ tenantId, messageId, replyText }`
**Outputs:** `{ classification, nextAction, addedToDNC: boolean }`

---

## Booking Agent

**File:** `packages/agents/src/agents/booking.ts`
**Model tier:** standard (gpt-4o) — needs reliable slot parsing
**Max input:** 1,500 tokens | **Max output:** 150 tokens

**What it does:**
- Fetches available slots from Cal.com API for the relevant calendar
- Parses natural language time requests ("sometime next week", "Tuesday afternoon")
- Proposes 2-3 options to the prospect
- On confirmation, creates the booking via Cal.com API
- Writes to `appointments` table
- Sends confirmation to both parties

**What it must never do:**
- Double-book
- Book outside configured availability windows
- Book without confirming prospect identity

**Inputs:** `{ tenantId, prospectId, calendarId, requestText }`
**Outputs:** `{ appointmentId, slot, confirmationSent: boolean }`

---

## Client Assistant Agent

**File:** `packages/agents/src/agents/clientAssistant.ts`
**Model tier:** cheap (gpt-4o-mini) | escalate to standard for complex queries
**Max input:** 3,000 tokens (after compaction) | **Max output:** 400 tokens

**What it does:**
- Answers FAQs from approved answer set (loaded from prompt pack)
- Schedules and reschedules appointments via Booking Agent
- Qualifies inbound leads and routes to appropriate sequence
- Escalates edge cases (complaints, legal, pricing outside range) to human
- Compacts conversation history every 6 turns (see TOKEN_BUDGET.md)

**What it must never do:**
- Promise services not in `approved_services` list
- Quote prices outside `approved_price_range`
- Improvise policy, legal, or compliance answers
- Keep talking after escalation flag is set

**Inputs:** `{ tenantId, sessionId, message, history }` (history is compacted)
**Outputs:** `{ reply, escalate: boolean, bookingIntent: boolean }`

---

## QA Guardrail Agent

**File:** `packages/agents/src/agents/qa.ts`
**Model tier:** cheap (gpt-4o-mini)
**Max input:** 2,000 tokens | **Max output:** 200 tokens

**What it does:**
- Checks outbound messages against: banned phrases, token budget, tone compliance
- Checks for unresolved placeholders (e.g. `{{business_name}}` still in output)
- Checks for hallucinated claims (services not in approved list)
- Returns PASS or BLOCK with specific reason

**What it must never do:**
- Pass a message with unresolved placeholders
- Pass a message with banned phrases
- Be bypassed — every outbound message must go through this

**Inputs:** `{ messageText, promptPack, approvedServices, bannedPhrases }`
**Outputs:** `{ verdict: 'pass' | 'block', reason?: string, flags: string[] }`

---

## Prompt Hygiene Agent

**File:** `packages/agents/src/agents/promptHygiene.ts`
**Model tier:** cheap (gpt-4o-mini)
**Max input:** 1,500 tokens | **Max output:** 150 tokens

**What it does:**
- Reviews prompt .md files for: missing required frontmatter fields,
  undefined placeholders, contradictory instructions, tone drift
- Flags issues but does not auto-fix (human must approve fixes)
- Runs in CI as part of prompt pack validation pipeline

**What it must never do:**
- Auto-promote a prompt to `status: approved`
- Modify prompt files directly
- Run in production on live messages

**Inputs:** `{ promptFileContent, schema }`
**Outputs:** `{ valid: boolean, issues: Issue[], suggestions: string[] }`
