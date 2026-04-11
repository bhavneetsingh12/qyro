# QYRO Agent Specifications
_Last updated: 2026-04-11_
_Canonical agent contract document._

## 1. Global Rules

1. Every LLM call goes through `packages/agents/src/runner.ts`.
2. Every agent is budgeted through `packages/agents/src/budget.ts`.
3. Every agent call logs usage to `usage_events`.
4. Tenant-scoped agents must only operate inside tenant-scoped DB access.
5. Prompts come from `docs/PROMPTS/` or approved DB prompt versions.

## 2. Lead Discovery Agent

**File:** `packages/agents/src/agents/leadDiscovery.ts`

Responsibilities:
- discover businesses using Google Places API
- dedupe by existing tenant lead data
- apply consent/DNC/research-skip gates
- insert `prospects_raw`
- enqueue research jobs

Must not:
- scrape prohibited sources
- invent contacts
- mark consent beyond known facts

## 3. Research Agent

**File:** `packages/agents/src/agents/research.ts`

Responsibilities:
- fetch and summarize a prospect’s public web presence
- produce urgency score and pitch angles
- cache normalized results in Redis
- write `prospects_enriched`

Must not:
- store raw scraped content permanently
- bypass cache discipline

## 4. Outreach Agent

**File:** `packages/agents/src/agents/outreach.ts`

Responsibilities:
- draft email or SMS outreach
- run QA before persistence
- write `message_attempts`
- stop on DNC or blocked consent state

Current contract:
- QA is part of the live flow
- output persists as `pending_approval` or `blocked_by_qa`
- the agent does not send messages directly

## 5. Reply Triage Agent

**File:** `packages/agents/src/agents/replyTriage.ts`

Responsibilities:
- classify replies
- add DNC on unsubscribe
- update downstream message state

Must not:
- send messages directly
- override unsubscribe intent

## 6. Booking Agent

**File:** `packages/agents/src/agents/booking.ts`

Responsibilities:
- parse booking intent
- use calendar adapters
- create appointment records

Must not:
- book outside configured availability
- silently invent slots

## 7. Client Assistant Agent

**File:** `packages/agents/src/agents/clientAssistant.ts`

Responsibilities:
- answer website/widget and text-style customer questions
- detect intent
- compact conversation history
- trigger booking actions when appropriate
- escalate when unsafe or unsupported
- increment analytics intent counters

Must not:
- promise unapproved services
- improvise policy/compliance answers

## 8. Voice Assistant Agent

**File:** `packages/agents/src/agents/voiceAssistant.ts`

Responsibilities:
- power concise, speech-friendly replies for the signed voice route
- support greeting, turn processing, booking confirmation, and transfer

Must not:
- produce long verbose spoken responses
- continue after explicit escalation handoff

## 9. QA Guardrail Agent

**File:** `packages/agents/src/agents/qa.ts`

Responsibilities:
- catch banned phrases
- catch unresolved placeholders
- catch unsupported service claims
- return structured pass/block verdicts

Must not:
- be bypassed by new outbound messaging flows

## 10. Calendar Adapter Layer

**Files:** `packages/agents/src/calendars/*`

Implemented adapters:
- Cal.com
- Google Calendar

Purpose:
- normalize booking operations behind a shared interface
- keep booking logic provider-neutral

## 11. SWAIG Functions

**Route file:** `apps/api/src/routes/swaig.ts`

These are not local LLM agents. They are provider-invoked business actions.

Endpoints:
- `POST /api/v1/swaig/business-info`
- `POST /api/v1/swaig/book-appointment`
- `POST /api/v1/swaig/escalate`
- `POST /api/v1/swaig/callback-sms`

These functions are part of the live voice stack and should be treated as canonical.

## 12. Not Active

Retell-specific tool and voice paths are decommissioned and should not be treated as live agent architecture.

## 13. Agent Hardening Backlog

1. Add more automated tests around agent I/O contracts.
2. Add stronger prompt validation and prompt hygiene checks.
3. Add regression tests for QA gating, escalation behavior, and booking fallback paths.
