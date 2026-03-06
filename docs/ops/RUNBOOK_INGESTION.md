# Runbook: Ingestion Pipeline

Procedures for operating and troubleshooting the ingestion pipeline.

---

## Architecture Overview

```
Timer (scheduledCrawl) → ingestion-fetch → fetchPage → ingestion-extract
→ extractService → ingestion-verify → verifyCandidate → ingestion-route → routeToAdmin
```

All functions are Azure Functions (Consumption plan) triggered by Azure Storage Queues.

---

## Routine Checks

### Daily

1. Check Application Insights → Logs for extraction/verification success rates
2. Review `[alertCoverageGaps]` log output (runs 8 AM UTC)
3. Confirm `[checkSlaBreaches]` ran (hourly — check last entry)

### Weekly

1. Review SLA breach trend (KQL: `docs/ops/MONITORING_QUERIES.md` §2)
2. Check queue poison message counts:
   ```bash
   az storage queue list --account-name <storage> --query "[?contains(name,'poison')]" -o table
   ```
3. Review confidence regression scan output

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

```bash
# Submit a single URL for processing
curl -X POST "https://<func-app>.azurewebsites.net/api/manualSubmit" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.org/services", "submittedByUserId": "<user-id>"}'
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

### Restart function app

```bash
az functionapp restart --resource-group <rg> --name <func-app>
```

---

## Escalation

If an issue cannot be resolved with this runbook:

1. Check `docs/ops/RUNBOOK_LLM_OUTAGE.md` for LLM-specific issues
2. Check `docs/ops/RUNBOOK_ADMIN_ROUTING.md` for admin assignment problems
3. File a GitHub Issue with the `ops` label and include relevant KQL query output
