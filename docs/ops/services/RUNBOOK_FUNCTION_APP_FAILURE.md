# Runbook: Function App Failure

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Handle Azure Function App failures affecting ingestion, timers, and workflow automation.

## Triggers

- Function host not running.
- Queue-triggered functions not processing.
- Timer-triggered jobs missing expected cadence.

## Triage Steps

1. Check function app state:

   ```bash
   az functionapp show --resource-group <rg> --name <func-app> --query state
   ```

2. Check logs for startup/runtime errors:

   ```bash
   az webapp log tail --resource-group <rg> --name <func-app>
   ```

3. Check queue depths and poison growth.
4. Confirm critical timer schedules are active (`functions/*/function.json`).

## Mitigation

1. Restart Function App:

   ```bash
   az functionapp restart --resource-group <rg> --name <func-app>
   ```

2. If ingestion pressure is high, pause scheduled crawl temporarily.
3. If failure follows deployment, rollback function deployment.

## Validation

- Function app state is `Running`.
- Queue depths stabilize or decline.
- Timer-triggered logs resume (`checkSlaBreaches`, `alertCoverageGaps`, `scanConfidenceRegressions`).

## References

- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
