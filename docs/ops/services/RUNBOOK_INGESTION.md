# Runbook: Azure Queue Ingestion Pipeline (Rollback Only)

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Operational status: rollback-only
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-07-28
- Severity scope: SEV-2 to SEV-3
- Active replacement: `docs/ops/services/RUNBOOK_211_API_INGESTION.md` and Vercel internal-route operations
- Retirement trigger: Archive after Azure Functions, Storage Queue resources, deployment identity, settings, and rollback credentials are decommissioned.
- Validation status: code-aligned-unvalidated
- Retirement deadline (UTC): 2026-08-15

## Status And Scope

This document describes retained Azure rollback code, not the active ingestion
architecture. A 2026-07-14 code review and local bundle build confirmed the
bindings below; no Azure queue, timer, deployment, or end-to-end record was
exercised. Activation requires the decision and preconditions in
`RUNBOOK_FUNCTION_APP_FAILURE.md`.

## Retained Pipeline Contract

```text
scheduledCrawl (daily 06:00 UTC)
  -> ingestion-fetch -> fetchPage
  -> ingestion-extract -> extractService
  -> ingestion-verify -> verifyCandidate
  -> ingestion-route -> routeToAdmin
```

Additional timers retained in function bindings:

- `checkSlaBreaches`: hourly
- `alertCoverageGaps`: daily at 08:00 UTC
- `scanConfidenceRegressions`: every six hours
- `pollSourceFeeds`: hourly

Queue configuration in `functions/host.json`:

- batch size 4; new-batch threshold 2
- three dequeue attempts before poison handling
- five-minute visibility timeout
- 30-second maximum polling interval

`manualSubmit` is bound to `POST /api/ingestion/submit` with Function auth but
the handler intentionally returns 501 and enqueues nothing. Use the authenticated
active endpoint `POST /api/admin/ingestion/process` for an approved manual intake.

## Safety Constraints

- Do not run active Vercel polling and Azure scheduled ingestion against the same
  source/feed concurrently.
- Do not discard, mass-requeue, or edit queue payloads without preserving IDs,
  evidence, and an audited reason.
- Never bypass verification, provenance, reviewer assignment, or publication
  gates to drain a backlog.
- Sample poison payloads without copying secrets or sensitive content into logs.
- Keep merchant-only benefit-acceptance datasets out of the service catalog.

## Known Blockers To Live Rollback

- The Function runtime settings contract does not require the `LLM_ENDPOINT` and
  `LLM_API_KEY` consumed by `extractService`; deployment validation can pass while
  extraction cannot run.
- No live Azure infrastructure/settings inventory or successful deployment is
  recorded in the repository.
- The HTTP `manualSubmit` Function is not implemented.
- Build/unit results do not prove database compatibility, queue authorization,
  timer execution, LLM access, or active-web endpoint authentication.

Until all four are resolved and drilled, this path remains
`code-aligned-unvalidated`.

## Triage After Explicit Activation

1. Record the deployed commit, source/feed, correlation IDs, queue counts, poison
   counts, and the first/last successful stage.
2. Confirm the Function host and every expected binding is loaded.
3. Compare approximate counts across `ingestion-fetch`, `ingestion-extract`,
   `ingestion-verify`, `ingestion-route`, and their poison queues.
4. Inspect Application Insights/Function logs for the correlation ID and classify
   the failure as fetch, LLM extraction, persistence, verification, routing, or
   active-app callback.
5. Confirm the active Vercel scheduler remains paused before retrying work.

Example Azure inspection, only after rollback activation:

```bash
az storage queue list --account-name <storage-account> --query "[].{name:name,count:approximateMessageCount}" -o table
az webapp log tail --resource-group <resource-group> --name <function-app>
```

## Mitigation

1. Stop new `scheduledCrawl` work when queue growth or duplicate intake is unsafe.
2. Fix the deterministic failing stage before replay. Use
   `RUNBOOK_LLM_OUTAGE.md` or `RUNBOOK_QUEUE_BACKLOG.md` for those failure classes.
3. Requeue only bounded, sampled messages whose prior failure is understood and
   safe to repeat. Preserve the original correlation/evidence relationship.
4. Use active ORAN admin/API workflows for reviewed manual processing; never call
   the 501 Function endpoint expecting recovery.
5. Resume the timer gradually and watch all four stages plus publication evidence.

## Live Validation Gate

Before calling Azure ingestion usable, execute one non-sensitive synthetic record
and prove:

- exactly one fetch, extraction, verification, and route outcome
- persisted evidence, provenance, candidate, and assignment link by correlation ID
- no unexpected poison message or duplicate canonical/public record
- an authorized reviewer can see and act on the assignment
- active source polling stayed off for the test window
- queue depths return to baseline and scheduled timers are deliberately controlled

No such evidence is recorded as of the review date.

## Code Validation Commands

```bash
npm run build:functions
npx vitest run functions/alertCoverageGaps/__tests__/index.test.ts functions/pollSourceFeeds/__tests__/index.test.ts functions/routeToAdmin/__tests__/index.test.ts src/services/runtime/__tests__/envContract.test.ts
npm run typecheck
```

## References

- `functions/host.json`
- `functions/*/function.json`
- `functions/manualSubmit/index.ts`
- `scripts/build-functions.mjs`
- `.github/workflows/deploy-azure-functions.yml`
- `docs/ops/services/RUNBOOK_FUNCTION_APP_FAILURE.md`
- `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
- `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
