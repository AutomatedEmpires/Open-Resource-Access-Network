# Runbook: Azure Storage Queue Backlog (Rollback Only)

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Operational status: rollback-only
- Last reviewed (UTC): 2026-07-29
- Next review due (UTC): 2026-08-12
- Severity scope: SEV-2 to SEV-4
- Active replacement: `docs/ops/services/RUNBOOK_211_API_INGESTION.md` and persisted feed-state operations
- Retirement trigger: Archive after Azure Storage Queues, Function bindings, storage credentials, and rollback deployment resources are decommissioned.
- Validation status: code-aligned-unvalidated
- Retirement deadline (UTC): 2026-08-15

## Status And Scope

Use this only after explicit activation of the retained Azure rollback stack. It
does not apply to active Vercel feed polling, whose progress and replay state are
persisted in Supabase rather than carried through this four-queue chain. Bindings
and host settings were reviewed on 2026-07-14; no live queue-depth, poison,
throughput, scale, or replay drill was executed.

2026-07-29 review note: the off-Azure archival (#82) stubbed
`functions/host.json` to an empty function list, so the batch/visibility
settings described below no longer exist in the working tree — they survive
only in git history (parent of commit 26b90cb). Activating this rollback now
additionally requires restoring `functions/host.json` from that history before
any queue behavior described here applies. Retirement deadline 2026-08-15 is
approaching; the founder decision to decommission would archive this runbook.

## Retained Queue Contract

| Queue | Consumer | Output |
| --- | --- | --- |
| `ingestion-fetch` | `fetchPage` | `ingestion-extract` |
| `ingestion-extract` | `extractService` | `ingestion-verify` |
| `ingestion-verify` | `verifyCandidate` | `ingestion-route` |
| `ingestion-route` | `routeToAdmin` | assignment/database side effects |

`functions/host.json` configures batch size 4, new-batch threshold 2, three
dequeue attempts, a five-minute visibility timeout, and a 30-second maximum
polling interval. Those are code defaults, not validated production capacity or
SLOs.

## Safety Constraints

- Stop new intake before attempting aggressive burn-down.
- Preserve source/evidence/correlation identity and queue ordering assumptions.
- Never delete or mass-requeue messages merely to make a graph green.
- Fix a deterministic failure before replaying its poison messages.
- Do not increase concurrency until database, provider, and review capacity are
  known to tolerate it.
- Do not bypass extraction, verification, assignment, or publication gates.

## Detection After Explicit Activation

Escalate when one stage grows over consecutive samples, poison counts increase,
downstream output stops, end-to-end age grows, or input/output/candidate counts
cannot be reconciled. Establish observed baseline during the activation; the old
hard-coded queue thresholds were not backed by a load test and are not retained.

Inspect only after rollback activation:

```bash
az storage queue list --account-name <storage-account> --query "[].{name:name,count:approximateMessageCount}" -o table
az functionapp show --resource-group <resource-group> --name <function-app> --query state
az webapp log tail --resource-group <resource-group> --name <function-app>
```

Approximate message count is directional, not a transaction ledger. Correlate it
with Function executions, persisted evidence/candidates/assignments, and poison
samples.

## Diagnosis

1. Record three timestamped queue samples and the active timer/deployment state.
2. Identify the first stage whose input grows while downstream output stalls.
3. Sample a small number of poison messages without copying credentials or
   sensitive content into the incident record.
4. Classify the bottleneck: upstream source volume, HTTP fetch, LLM extraction,
   database persistence, verification, routing/capacity, or host/config failure.
5. Check for the `extractService` null-result risk described in
   `RUNBOOK_LLM_OUTAGE.md`; a falling queue with missing downstream records can be
   data loss, not recovery.
6. Confirm the active Vercel scheduler is not ingesting the same source in parallel.

## Mitigation

1. Disable `scheduledCrawl` and other Azure intake timers responsible for new
   work. Preserve the setting change and actor in the incident timeline.
2. Fix the earliest failing stage and validate one synthetic message end to end.
3. Replay only a bounded set whose original state is reconciled. Record message
   IDs/correlation IDs and expected downstream effects before replay.
4. Keep concurrency at the checked-in host settings unless a reviewed capacity
   experiment justifies a change. A config edit requires a new build/deployment.
5. Resume intake gradually after queue age and stage counts trend toward baseline
   without poison growth or duplicate persistence.

## Live Exit Gate

The backlog is resolved only when:

- each stage's input/output can be reconciled for the recovery sample
- all four queue depths and oldest-message age show a sustained safe trend
- poison growth has stopped and each replay has a documented outcome
- a synthetic record reaches a qualified reviewer exactly once
- no duplicate or unreviewed public service was created
- the activation owner decides whether Azure remains enabled or returns to standby

No live evidence currently satisfies this gate.

## Code Validation Commands

```bash
npm run build:functions
npx vitest run functions/pollSourceFeeds/__tests__/index.test.ts functions/routeToAdmin/__tests__/index.test.ts src/services/runtime/__tests__/envContract.test.ts
npm run typecheck
```

## References

- `functions/host.json`
- `functions/fetchPage/function.json`
- `functions/extractService/function.json`
- `functions/verifyCandidate/function.json`
- `functions/routeToAdmin/function.json`
- `docs/ops/services/RUNBOOK_FUNCTION_APP_FAILURE.md`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
