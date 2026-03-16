# Runbook: Ingestion Pipeline

Procedures for operating and troubleshooting the ingestion pipeline.

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

---

## Architecture Overview

```
Timer (scheduledCrawl) → ingestion-fetch → fetchPage → ingestion-extract
→ extractService → ingestion-verify → verifyCandidate → ingestion-route → routeToAdmin
```

All functions are Azure Functions (Consumption plan) triggered by Azure Storage Queues.

Queue and timer bindings are defined under `functions/*/function.json`.

Timer schedules (UTC):

- `scheduledCrawl`: `0 0 6 * * *` (daily at 06:00)
- `checkSlaBreaches`: `0 0 * * * *` (hourly)
- `alertCoverageGaps`: `0 0 8 * * *` (daily at 08:00)
- `scanConfidenceRegressions`: `0 0 */6 * * *` (every 6 hours)

---

## Routine Checks

### Daily

1. Check Application Insights → Logs for extraction/verification success rates
2. Review `[alertCoverageGaps]` log output (runs 8 AM UTC)
3. Confirm `[checkSlaBreaches]` ran (hourly — check last entry)

### Weekly

1. Review SLA breach trend (KQL: `docs/ops/monitoring/MONITORING_QUERIES.md` §2)
2. Check queue poison message counts:

   ```bash
   az storage queue list --account-name <storage> --query "[?contains(name,'poison')]" -o table
   ```

3. Review confidence regression scan output

### Runtime Queue Settings (from `functions/host.json`)

- `batchSize`: 4
- `maxDequeueCount`: 3
- `visibilityTimeout`: `00:05:00`
- `maxPollingInterval`: `00:00:30`

### Queue Depth Escalation Thresholds

Use queue depth trends over at least 3 consecutive checks (not one-off spikes):

| Signal | Warning | Critical |
| --- | --- | --- |
| `ingestion-fetch` depth | > 500 for 15 min | > 2000 for 30 min |
| `ingestion-extract` depth | > 300 for 15 min | > 1200 for 30 min |
| `ingestion-verify` depth | > 300 for 15 min | > 1200 for 30 min |
| Any `*-poison` queue | > 10 messages | > 50 messages |

At critical level, declare at least SEV-2 and follow `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`.

---

## Common Issues

### Queue messages stuck (poison queue)

**Symptom**: Messages appear in `*-poison` queues.

**Diagnosis**:

```bash
# List poison queues
az storage queue list --account-name <storage> --query "[?contains(name,'poison')].{name:name}" -o table

# Peek at poison messages
az storage message peek --queue-name ingestion-fetch-poison --account-name <storage> --num-messages 5
```

**Resolution**:

1. Check Application Insights for the error that caused the failure
2. Fix the root cause (usually a malformed URL or LLM parse failure)
3. Re-queue the message if appropriate:

   ```bash
   # Move message from poison back to main queue
   MSG=$(az storage message get --queue-name ingestion-fetch-poison --account-name <storage> --query "[0]" -o json)
   MSG_TEXT=$(echo "$MSG" | jq -r '.content')
   az storage message put --queue-name ingestion-fetch --content "$MSG_TEXT" --account-name <storage>
   az storage message delete --queue-name ingestion-fetch-poison --id <msg-id> --pop-receipt <receipt> --account-name <storage>
   ```

### Extraction failures (LLM errors)

**Symptom**: `[extractService] HTTP 429` or `[extractService] Failed` in logs.

**Diagnosis**:

```kql
traces
| where timestamp > ago(1h)
| where message has "[extractService]" and (message has "Failed" or message has "error" or message has "429")
| project timestamp, message
| order by timestamp desc
```

**Resolution**:

- **429 (rate limited)**: Azure OpenAI throttling. Check quota in Azure Portal → Azure OpenAI → Deployments. Consider reducing `scheduledCrawl` concurrency or increasing TPM quota.
- **Parse failure**: LLM returned non-JSON. Check the raw response in logs. Usually transient — message will retry automatically (3 attempts before poison queue).
- **Timeout**: Increase function timeout in `host.json` if consistently timing out.

### No candidates being processed

**Symptom**: No new candidates appearing in admin queues despite crawl running.

**Diagnosis**:

1. Check if `scheduledCrawl` ran:

   ```kql
   traces | where message has "[scheduledCrawl]" | take 5
   ```

2. Check if fetch queue has messages:

   ```bash
   az storage queue show --name ingestion-fetch --account-name <storage> --query "approximateMessageCount"
   ```

3. Check function execution history:

   ```bash
   az functionapp function show --resource-group <rg> --name <func-app> --function-name fetchPage
   ```

**Resolution**:

- If crawl didn't run: Check timer function is enabled and `host.json` has correct schedule
- If queue is empty but crawl ran: Check source registry — sources may be exhausted or all URLs already processed
- If queue has messages but no processing: Check function app is running (`az functionapp show --query state`)

---

## Manual Operations

### Trigger a manual crawl

Use the ORAN admin ingestion API (implemented path):

```bash
curl -X POST "https://<web-app>.azurewebsites.net/api/admin/ingestion/process" \
   -H "Authorization: Bearer <admin-session-token>" \
   -H "Content-Type: application/json" \
   -d '{"sourceUrl":"https://example.org/services","forceReprocess":false}'
```

Notes:

- This endpoint requires authenticated `oran_admin` role.
- The Azure Function `manualSubmit` currently returns 501 (stub).

### Trigger function endpoint directly (only if implemented in your environment)

```bash
# Route binding is /api/ingestion/submit with function auth level
curl -X POST "https://<func-app>.azurewebsites.net/api/ingestion/submit?code=<function-key>" \
  -H "Content-Type: application/json" \
   -d '{"sourceUrl":"https://example.org/services","sourceId":"manual","priority":5}'
```

### Force SLA check

```bash
curl -X POST "https://<web-app>.azurewebsites.net/api/internal/sla-check" \
  -H "Authorization: Bearer <INTERNAL_API_KEY>" \
  -H "Content-Type: application/json"
```

### Force coverage gap check

```bash
curl -X POST "https://<web-app>.azurewebsites.net/api/internal/coverage-gaps" \
  -H "Authorization: Bearer <INTERNAL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"thresholdHours": 24}'
```

### Force confidence regression scan

```bash
curl -X POST "https://<web-app>.azurewebsites.net/api/internal/confidence-regression-scan" \
   -H "Authorization: Bearer <INTERNAL_API_KEY>" \
   -H "Content-Type: application/json" \
   -d '{"limit": 100}'
```

### 211 feed diagnostics

When the issue is specific to HSDS / 211 feed polling rather than the generic queue pipeline, generate a feed-state report from persisted telemetry:

```bash
npm run report:211-feed-status -- --feed-id <source-feed-id> --hours 72 --format markdown --out reports/211-feed-status-<date>.md
```

Review:

- feed health classification and replay cursor state
- recent source-record counts and normalization outcome
- canonical entity counts tied to the feed via provenance
- publication reason and decision-reason aggregates from the latest poll summary

### Restart function app

```bash
az functionapp restart --resource-group <rg> --name <func-app>
```

### Re-enable scheduled crawl after pause

```bash
az functionapp config appsettings delete \
   --resource-group <rg> \
   --name <func-app> \
   --setting-names "AzureWebJobs.scheduledCrawl.Disabled"
```

---

## Escalation

If an issue cannot be resolved with this runbook:

1. Check `docs/ops/services/RUNBOOK_LLM_OUTAGE.md` for LLM-specific issues
2. Check `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md` for admin assignment problems
3. File a GitHub Issue with the `ops` label and include relevant KQL query output
