# Runbook: LLM Outage (Azure OpenAI)

Procedures for when Azure OpenAI is unavailable or degraded.

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

---

## Impact Assessment

The LLM is used **only** for extraction and categorization in the ingestion pipeline. It does **not** affect:
- Search (pure SQL + PostGIS)
- Scoring (deterministic algorithm)
- Admin workflows (queue, review, approve/reject)
- Seeker-facing directory browsing
- Authentication or authorization

**Severity**: Medium — new candidate ingestion is paused, but existing published services remain fully operational.

---

## Detection

### Automated

- Function App failure alerts fire when `extractService` error count > 3 in 15 minutes
- Application Insights shows failed dependency traces to Azure OpenAI

### Manual check

```kql
dependencies
| where timestamp > ago(1h)
| where type == "HTTP" and target has "openai.azure.com"
| summarize
    total = count(),
    succeeded = countif(success),
    failed = countif(not(success)),
    avgDuration = avg(duration)
| extend failRate = round(100.0 * failed / total, 1)
```

```bash
# Check Azure OpenAI service health
az rest --method get \
  --url "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.CognitiveServices/locations/<region>/operationStatuses?api-version=2023-05-01"
```

---

## Immediate Response

### Outage Mode Decision Table

| Condition | Action |
| --- | --- |
| Fail rate < 10% and stable queue | Continue with close monitoring |
| Fail rate 10-40% for > 30 min | Reduce crawl pressure and monitor backlog |
| Fail rate > 40% or sustained 429/5xx | Pause scheduled crawl and protect queue health |

Always preserve ingestion queue integrity and avoid destructive message handling.

### 1. Confirm the outage scope

Is it a regional Azure OpenAI outage or a quota/deployment issue?

```bash
# Check deployment status
az cognitiveservices account deployment list \
  --resource-group <rg> \
  --name <openai-resource> \
  -o table
```

### 2. Pause ingestion (optional)

If the outage is expected to last > 1 hour, disable the timer trigger to prevent queue buildup:

```bash
# Disable scheduledCrawl timer
az functionapp config appsettings set \
  --resource-group <rg> \
  --name <func-app> \
  --settings "AzureWebJobs.scheduledCrawl.Disabled=true"
```

Queue messages will remain in the storage queue with visibility timeout — they will not be lost.

### 3. Monitor queue depth

```bash
az storage queue show --name ingestion-extract --account-name <storage> --query "approximateMessageCount"
az storage queue show --name ingestion-extract-poison --account-name <storage> --query "approximateMessageCount"
```

---

## Recovery

### When LLM is back online

1. Re-enable the timer (if disabled):
   ```bash
   az functionapp config appsettings delete \
     --resource-group <rg> \
     --name <func-app> \
     --setting-names "AzureWebJobs.scheduledCrawl.Disabled"
   ```

2. Check for poison messages accumulated during outage:
   ```bash
   az storage queue show --name ingestion-extract-poison --account-name <storage> --query "approximateMessageCount"
   ```

3. Re-queue poison messages if they failed due to the LLM outage (not due to bad data):
   ```bash
   # Peek to confirm they are LLM-timeout failures
   az storage message peek --queue-name ingestion-extract-poison --account-name <storage> --num-messages 5

   # If appropriate, move them back (see docs/ops/services/RUNBOOK_INGESTION.md for procedure)
   ```

4. Verify extraction is succeeding:
   ```kql
   traces
   | where timestamp > ago(1h)
   | where message has "[extractService]"
   | summarize count() by success = message has "Completed"
   ```

5. Validate end-to-end progression resumes:
  - `ingestion-extract` depth declines
  - `ingestion-verify` receives new messages
  - `ingestion-route` receives new messages

---

## Mitigation Options

### Rate limiting (429 errors)

If the issue is Azure OpenAI quota throttling (HTTP 429):

1. Check current quota usage in Azure Portal → Azure OpenAI → Deployments → your model
2. Request a quota increase via Azure Portal → Quotas
3. Reduce crawl concurrency in `functions/host.json`:
   ```json
   {
     "extensions": {
       "queues": {
         "batchSize": 1,
         "maxPollingInterval": "00:00:30",
         "maxDequeueCount": 3
       }
     }
   }
   ```

### Model deployment issue

If the GPT-4o deployment is deleted or misconfigured:

1. Verify deployment exists:
   ```bash
   az cognitiveservices account deployment show \
     --resource-group <rg> \
     --name <openai-resource> \
     --deployment-name <deployment-name>
   ```
2. Recreate if needed (see Azure OpenAI documentation)
3. Update the `AZURE_OPENAI_DEPLOYMENT_NAME` app setting on the Function App if the deployment name changed

---

## Key Point

The LLM handles extraction only. Published services, active search, and admin workflows are **completely unaffected** by an LLM outage. The ingestion queue will back up but nothing is lost — messages persist in Azure Storage Queues with retry.
