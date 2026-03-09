# Runbook: Queue Backlog And Throughput Degradation

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

This runbook addresses Azure Storage Queue backlog growth, poison queue accumulation, and ingestion stage throughput drops.

## Safety Constraints (Must Always Hold)

- Do not discard queue messages without documented reason.
- Preserve chain integrity: fetch -> extract -> verify -> route.
- Do not bypass verification to clear backlog quickly.
- Maintain crisis and retrieval-first safeguards.

## Code-Verified Pipeline

- `ingestion-fetch` -> `fetchPage`
- `ingestion-extract` -> `extractService`
- `ingestion-verify` -> `verifyCandidate`
- `ingestion-route` -> `routeToAdmin`

Bindings are defined in:

- `functions/fetchPage/function.json`
- `functions/extractService/function.json`
- `functions/verifyCandidate/function.json`
- `functions/routeToAdmin/function.json`

Queue runtime defaults in `functions/host.json`:

- `batchSize: 4`
- `maxDequeueCount: 3`
- `visibilityTimeout: 00:05:00`
- `maxPollingInterval: 00:00:30`

## Backlog Burn-Down Targets

- Warning: queue depth should trend down within 30 minutes of mitigation.
- Critical: queue depth should drop by at least 25% per hour after pressure is reduced.
- Poison queue target: no net growth over 2 consecutive checks.

## Triggers

- Queue depth increasing over multiple polling windows.
- Poison queue growth (`*-poison`).
- End-to-end ingestion latency exceeding normal window.
- Admin queue receives candidates much later than expected.

## Diagnosis

1. List queue depths:

   ```bash
   az storage queue list --account-name <storage> --query "[].{name:name,count:approximateMessageCount}" -o table
   ```

2. Inspect poison queues:

   ```bash
   az storage queue list --account-name <storage> --query "[?contains(name,'poison')].{name:name,count:approximateMessageCount}" -o table
   ```

3. Check function app state:

   ```bash
   az functionapp show --resource-group <rg> --name <func-app> --query state
   ```

4. Check recent errors in Application Insights for failing stage.

## Mitigation Paths

### A. Trigger Is Healthy, Stage Is Slow

1. Identify bottleneck stage (fetch, extract, verify, route).
2. If extract is bottleneck, evaluate `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`.
3. Temporarily reduce new ingest pressure by pausing timer-triggered crawl.

### B. Poison Queue Growth

1. Sample poison messages to determine dominant failure reason.
2. Fix deterministic root cause first.
3. Re-queue only messages that are safe to retry.

### C. Full Backlog Risk

1. Pause scheduled crawl to stop backlog growth:

   ```bash
   az functionapp config appsettings set \
     --resource-group <rg> \
     --name <func-app> \
     --settings "AzureWebJobs.scheduledCrawl.Disabled=true"
   ```

2. Drain existing backlog.
3. Re-enable timer once throughput recovers.

## Rollback Criteria

- Backlog growth continues after staged mitigation.
- Recent deployment is correlated with throughput collapse.
- Message loss risk emerges due to repeated processing failures.

Use `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` if deployment regression is suspected.

## Validation

1. Queue depths trend down toward steady state.
2. Poison queue growth stops.
3. New messages move through all stages within expected time.
4. Admin routing receives newly verified candidates.

Validation metrics to capture:

- Queue depth at start vs end of incident window.
- Time to first sustained downward trend.
- Poison queue growth delta.

## References

- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
- `functions/host.json`
- `functions/*/function.json`
