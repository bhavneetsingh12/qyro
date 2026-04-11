# QYRO Token Budget & Model Routing
_Last updated: 2026-04-11_
_Canonical LLM cost and model-routing reference._

## 1. Model Tiers

| Tier | Model | Typical use |
|---|---|---|
| cheap | `gpt-4o-mini` | classification, triage, drafting, FAQ, QA |
| standard | `gpt-4o` | booking interpretation and higher-complexity assistant flows |
| premium | reserved | not the default path in current runtime |

Default rule:
- use `cheap` first
- escalate only when quality clearly justifies it

## 2. Daily Limits

Daily limits are enforced in `packages/agents/src/budget.ts`.

| Plan | Input/day | Output/day |
|---|---|---|
| Starter | 50,000 | 20,000 |
| Growth | 200,000 | 80,000 |
| Agency | 800,000 | 300,000 |

## 3. Per-Run Limits

| Agent | Max input | Max output |
|---|---|---|
| Lead Discovery | 1,500 | 200 |
| Research | 4,000 | 600 |
| Outreach | 2,000 | 250 |
| Reply Triage | 1,500 | 100 |
| Booking | 1,500 | 150 |
| Client Assistant | 3,000 | 400 |
| QA | 2,000 | 200 |

## 4. Required Controls

Every new LLM path must:
- call through the shared runner
- use explicit token ceilings
- log usage
- respect tenant quotas
- document why the selected model tier is needed

## 5. Caching

Research is the main cache-worthy flow.

Current rule:
- cache normalized research results in Redis
- prefer cache hits over repeated web/LLM work

## 6. Compaction

Conversation compaction exists to keep assistant costs bounded.

Current rule:
- compact multi-turn assistant history periodically
- keep recent context verbatim
- summarize older turns

## 7. Budget Backlog

Still worth improving:

1. add better cost dashboards for operators/admin
2. add tests that guard model-tier regressions
3. document any premium-tier reintroduction before use
