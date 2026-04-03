# Nightly Lead Pipeline (n8n + PM2)

This runbook sets up unattended overnight lead generation and draft warming.

## What this does

- n8n runs on a nightly schedule (default 10:00 PM server time).
- n8n sends one internal request to `POST /webhooks/nightly/ingest`.
- API discovers leads and optionally enqueues outreach drafts.
- Existing approval flow stays in control before sending.
- n8n runs a morning digest (default 7:00 AM) via `POST /webhooks/morning/digest`.
- PM2 keeps API and research worker running and auto-restarts on failure.

## Prerequisites

- Docker and Docker Compose available.
- Redis and Postgres reachable by API/worker.
- `pnpm install` already run in repo root.

## 1) Required environment variables

### API and worker (`.env`)

Set these in your API/worker runtime env:

- `INTERNAL_WEBHOOK_SECRET`: shared secret for internal orchestration endpoint.
- `REDIS_URL`: BullMQ/queue Redis URL.
- `DATABASE_URL`: Postgres URL.

`INTERNAL_WEBHOOK_SECRET` must match what n8n sends.

### n8n service env

In your n8n runtime (compose env or `.env` consumed by compose), set:

- `INTERNAL_WEBHOOK_SECRET`: same value as API.
- `N8N_API_BASE_URL`: API base URL reachable from n8n.
  - Docker on macOS example: `http://host.docker.internal:3005`
- `N8N_TENANT_ID`: tenant UUID for nightly runs.
- `N8N_SEQUENCE_ID`: outreach sequence UUID (if drafts should be queued).
- `N8N_DIGEST_LOOKBACK_HOURS`: lookback window for morning digest (default `12`).
- Optional `N8N_DIGEST_WEBHOOK_URL`: Slack/Teams/Discord webhook URL for digest notification.
- Optional:
  - `N8N_NICHE_1` (default `medspa`)
  - `N8N_LOCATION_1` (default `Portland, OR`)
  - `N8N_LOCATION_2` (default `Seattle, WA`)

## 2) Start core services

Use PM2 config in `infra/pm2/ecosystem.config.cjs`:

```bash
pm2 start infra/pm2/ecosystem.config.cjs
pm2 save
```

Check status:

```bash
pm2 status
pm2 logs qyro-api --lines 100
pm2 logs qyro-research-worker --lines 100
```

## 3) Start n8n

If using compose stack under `infra/`:

```bash
cd infra
docker compose up -d n8n
```

Verify n8n UI is reachable.

## 4) Import workflow

Import JSON file:

- `infra/n8n/workflows/nightly-lead-pipeline.json`
- `infra/n8n/workflows/morning-lead-digest.json`

In n8n UI:

1. Workflows -> Import from File.
2. Select both JSON files above.
3. Open each workflow and confirm env vars resolve.
4. Set desired schedules:
  - `Nightly Trigger`: cron currently `0 22 * * *`
  - `Morning Trigger`: cron currently `0 7 * * *`
5. Activate both workflows.

## 5) Test before overnight run

Manual run in n8n:

1. Open workflow.
2. Click `Execute workflow`.
3. Confirm HTTP node returns success payload with totals.

You should see response shape similar to:

```json
{
  "ok": true,
  "totalRuns": 1,
  "totalDiscovered": 12,
  "totalQueued": 8,
  "results": [
    {
      "tenantId": "...",
      "discovered": 12,
      "queued": 8,
      "skipped": 4
    }
  ]
}
```

## 6) Morning review checklist

- Check n8n execution succeeded.
- Confirm `QYRO Morning Lead Digest` ran and produced summary metrics.
- Open internal approvals queue and review pending items.
- Confirm no unusual duplicates.
- Approve or reject drafts.

## Security notes

- Keep `/webhooks/nightly/ingest` internal only.
- Use a strong `INTERNAL_WEBHOOK_SECRET`.
- Do not expose this endpoint publicly without additional controls (IP allowlist, private network, or gateway auth).
