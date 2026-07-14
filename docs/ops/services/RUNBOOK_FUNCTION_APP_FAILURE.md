# Runbook: Azure Function App Failure (Rollback Only)

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Operational status: rollback-only
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-07-28
- Severity scope: SEV-2 to SEV-3
- Active replacement: `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md` and Vercel scheduled routes
- Retirement trigger: Archive after Azure Functions resources, deployment identity, settings, queues, and credentials are decommissioned and catalog links are removed.
- Validation status: code-aligned-unvalidated
- Retirement deadline (UTC): 2026-08-15

## Status And Authority

This is not an active production incident route. The retained code and deployment
workflow were reviewed and the local function bundle was built on 2026-07-14;
no live Azure Function App deployment, startup, timer, queue, or failover drill
was executed. Use this document only after an explicit Release Manager rollback
activation decision.

The manual GitHub workflow is additionally gated by
`AZURE_ROLLBACK_DEPLOY_ENABLED == 'true'`. Do not enable that variable merely to
test whether Azure still exists.

## Code-Aligned Inventory

`scripts/build-functions.mjs` bundles ten retained Functions into `dist`:

- queue pipeline: `fetchPage`, `extractService`, `verifyCandidate`, `routeToAdmin`
- timers: `scheduledCrawl` (06:00 UTC daily), `checkSlaBreaches` (hourly),
  `alertCoverageGaps` (08:00 UTC daily), `scanConfidenceRegressions` (every six hours),
  and `pollSourceFeeds` (hourly)
- HTTP: `manualSubmit`, which is a 501 no-op and must not be treated as a working
  submission path

The actual supported manual path is the active authenticated Next.js endpoint
`POST /api/admin/ingestion/process`.

Queue behavior retained in `functions/host.json` is `batchSize=4`,
`newBatchThreshold=2`, `maxDequeueCount=3`, five-minute visibility timeout, and
30-second maximum polling interval.

## Known Configuration Gap

The Function runtime validator requires `AzureWebJobsStorage`,
`FUNCTIONS_WORKER_RUNTIME`, `ORAN_APP_URL`, and `INTERNAL_API_KEY`; it warns about
Sentry and paired `FOUNDRY_ENDPOINT`/`FOUNDRY_KEY` values. However,
`extractService` executes the ingestion LLM pipeline, whose implementation reads
`LLM_ENDPOINT` and `LLM_API_KEY`. Those are not required by the Function runtime
contract. A green settings-contract step can therefore precede an extraction
failure. This must be repaired and tested before any live rollback claim.

## Preconditions For Activation

1. Release Manager records why the active Vercel path cannot be recovered safely.
2. Azure subscription, Function App, Storage account/queues, OIDC deployment
   identity, Application Insights, and runtime settings are confirmed to exist.
3. Database and `ORAN_APP_URL` targets are proven compatible with the retained
   Function build; no environment may point at an unintended production system.
4. LLM configuration for extraction and optional Foundry verification is checked
   separately from the runtime-contract script.
5. Source-feed polling is paused on the active stack to avoid duplicate work.
6. Security and Data Platform leads approve the rollback data-flow boundary.

If any precondition fails, keep Azure disabled and operate the active degraded
mode under `RUNBOOK_DEPENDENCY_OUTAGE.md`.

## Triage After Explicit Activation

```bash
az functionapp show --resource-group <resource-group> --name <function-app> --query state
az functionapp function list --resource-group <resource-group> --name <function-app> --query "[].name" -o tsv
az webapp log tail --resource-group <resource-group> --name <function-app>
```

Confirm the deployed functions match the inventory, then inspect timer execution,
queue/poison depth, startup/configuration errors, database connectivity, and the
first failing pipeline stage. Do not use the `manualSubmit` endpoint as a smoke
test because 501 is its expected retained behavior.

## Mitigation

1. Pause `scheduledCrawl` before restart if the host is creating duplicate or
   unsafe queue pressure.
2. Correct the smallest reversible settings or identity defect; rotate exposed
   credentials rather than reusing them.
3. Restart only after configuration is reconciled:

   ```bash
   az functionapp restart --resource-group <resource-group> --name <function-app>
   ```

4. If the deployment is incompatible, disable rollback processing and return to
   the active-stack incident plan; do not improvise another Azure release.

## Live Exit Gate

The path remains unvalidated until evidence shows:

- expected functions load and every timer fires at its binding cadence
- one synthetic, non-sensitive record traverses fetch → extract → verify → route
- queue and poison counts remain bounded with no duplicate publication
- active Next.js internal endpoints accept rollback-worker authentication
- routing produces a reviewable assignment without bypassing publication gates
- Azure is disabled again or the Release Manager explicitly accepts continued use

Record timestamps, correlation ID, queue deltas, deployed commit, settings names
(never values), and the rollback decision.

## Code Validation Commands

```bash
npm run build:functions
npx vitest run functions/alertCoverageGaps/__tests__/index.test.ts functions/pollSourceFeeds/__tests__/index.test.ts functions/routeToAdmin/__tests__/index.test.ts src/services/runtime/__tests__/envContract.test.ts
npm run typecheck
```

These checks prove build and unit contracts only, not Azure operability.

## References

- `.github/workflows/deploy-azure-functions.yml`
- `scripts/build-functions.mjs`
- `scripts/validate-runtime-env.mjs`
- `src/services/runtime/envContractCore.js`
- `functions/host.json`
- `functions/manualSubmit/index.ts`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
