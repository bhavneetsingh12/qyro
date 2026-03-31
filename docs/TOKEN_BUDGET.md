# QYRO Token Budget & Model Routing
_Read this before writing any code that calls an LLM._

## Model tier assignments

```
CHEAP    → gpt-4o-mini
           Use for: classification, scoring, triage, FAQ drafts,
                    rewrite/paraphrase, outreach personalization,
                    reply classification, prompt hygiene checks
           Cost:    ~$0.15/1M input, $0.60/1M output

STANDARD → gpt-4o
           Use for: research summaries, complex outreach personalization,
                    multi-turn client assistant sessions
           Cost:    ~$2.50/1M input, $10/1M output

PREMIUM  → claude-sonnet-4-6
           Use for: complex objections, difficult replies, voice flows
           Restricted to: Agency/Growth plans only
           Cost:    higher — must show plan check before use
```

**Default rule: use CHEAP. Escalate only when output quality demonstrably fails.**

---

## Per-tenant daily hard limits

| Plan | Input tokens/day | Output tokens/day | LLM budget/day (est.) |
|---|---|---|---|
| Starter | 50,000 | 20,000 | ~$0.02 |
| Growth | 200,000 | 80,000 | ~$0.08 |
| Agency | 800,000 | 300,000 | ~$0.30 |

These are enforced in `packages/agents/src/budget.ts` and checked by `apps/api/src/middleware/quota.ts` before every agent call.

Exceeding the daily limit: log to `usage_events`, send `quota_exceeded` webhook to tenant, halt the workflow gracefully. Do NOT throw a 500 — return a structured QuotaExceededError.

---

## Per-run token limits (max per single agent invocation)

| Agent | Max input tokens | Max output tokens |
|---|---|---|
| Lead Discovery | 1,500 | 200 |
| Research | 4,000 | 600 |
| Outreach | 2,000 | 250 |
| Reply Triage | 1,500 | 100 |
| Booking | 1,500 | 150 |
| Client Assistant | 3,000 | 400 |
| QA Guardrail | 2,000 | 200 |
| Prompt Hygiene | 1,500 | 150 |

If a run would exceed these, truncate input (log a warning) — never silently expand.

---

## Conversation compaction (Client Assistant)

The Client Assistant is the only agent that holds multi-turn conversations.
Compact after every 6 turns using this strategy:

1. Keep system prompt (always)
2. Keep last 3 exchanges verbatim (recency matters)
3. Summarize older turns into a single [Context summary: ...] message
4. Summary generation: use CHEAP model, max 150 output tokens
5. Log: compaction event goes to `assistant_sessions` with token_count_before / after

Implementation: `packages/agents/src/compact.ts`

---

## Research cache

Research summaries are expensive. Cache them in Redis.

Key format:   `research:{tenantId}:{sha256(normalizedDomain)}`
TTL:          7 days (604800 seconds)
On cache hit: skip Research Agent entirely — log `cache_hit` to usage_events
On cache miss: run agent, store result, log `cache_miss`

This alone can cut research token spend by 60-80% once the pipeline matures.

---

## Web search tool cost

If enabling web_search tool on any agent:
- Costs ~$10 per 1,000 calls (OpenAI pricing)
- Only enable on Research Agent
- Hard cap: 3 searches per research run
- Never enable on Client Assistant or Outreach Agent

---

## Token ledger table

All LLM usage must be logged to `usage_events`:

```sql
INSERT INTO usage_events (
  tenant_id, agent_name, model, 
  input_tokens, output_tokens, 
  cached, run_id, created_at
) VALUES (...);
```

This feeds the billing overage calculation and the admin cost dashboard.

---

## Cost discipline checklist (run before adding any new LLM call)

- [ ] Which agent tier does this belong to? (cheap / standard / premium)
- [ ] Is there a cache check before the LLM call?
- [ ] Is max_tokens set explicitly?
- [ ] Is the quota middleware in the call path?
- [ ] Will tokens be logged to usage_events?
- [ ] Does the QA agent gate this output before it leaves the system?
