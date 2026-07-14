# Runbook: Azure Ingestion LLM Outage (Rollback Only)

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Operational status: rollback-only
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-07-28
- Severity scope: SEV-2 to SEV-3
- Active replacement: `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md` and the active source-feed controls
- Retirement trigger: Archive after the Azure queue ingestion path, LLM/Foundry deployments, credentials, and rollback settings are decommissioned.
- Validation status: code-aligned-unvalidated
- Retirement deadline (UTC): 2026-08-15

## Status And Scope

This runbook applies only if the retained Azure queue ingestion path has been
explicitly activated. It does not govern active seeker chat or search; use
`RUNBOOK_DEPENDENCY_OUTAGE.md` for current provider degradation. The retained
code was reviewed and bundled locally on 2026-07-14, but no Azure LLM request,
quota failure, queue retry, or recovery drill was executed.

## Code-Aligned Behavior

`functions/extractService` consumes `ingestion-extract`, enables the LLM
extraction/categorization pipeline, persists a candidate, and returns a message
for `ingestion-verify`. The LLM client implementation reads:

- `LLM_PROVIDER` (defaults to `azure_openai`)
- `LLM_MODEL` (defaults to `gpt-4o`)
- `LLM_ENDPOINT` and `LLM_API_KEY`
- optional API version, temperature, and timeout values

`functions/verifyCandidate` separately uses paired `FOUNDRY_ENDPOINT` and
`FOUNDRY_KEY` when configured for discrepancy checking; it can continue with
deterministic verification when that optional pair is absent.

The comments in `extractService` mention routing extraction through Foundry with
`FOUNDRY_*`, but the invoked LLM client reads `LLM_*`. Treat the implementation,
not the comment, as authoritative until that mismatch is fixed.

## Known Rollback Risks

- The Function runtime contract does not require `LLM_ENDPOINT` or `LLM_API_KEY`,
  so the deployment settings check can pass without usable extraction.
- When an extraction stage returns a failed stage result, `extractService`
  returns `null`. That may complete the queue invocation without a downstream
  message instead of producing the retry/poison behavior older guidance assumed.
  Live failure semantics have not been verified.
- No live model deployment, quota, identity/network path, data-retention setting,
  or safe logging behavior has been validated.

Because of these risks, never claim that “messages will simply wait and nothing
is lost” during an LLM outage.

## Detection After Explicit Activation

- extraction-stage failure or missing downstream `ingestion-verify` message
- provider 401/403/404/429/5xx or request timeout
- growing `ingestion-extract` depth, or unexpectedly flat depth with no candidate
- candidate/output counts lower than extract input counts for the same window
- LLM configuration absent even though the Function runtime validator passed

Correlate by input message/correlation ID, not only aggregate Function success.

## Containment

1. Disable `scheduledCrawl` and any Azure source-feed timer so no new records enter
   the uncertain extraction path.
2. Keep active Vercel polling off for the same source until ownership of every
   in-flight record is reconciled.
3. Snapshot queue counts and audit input/candidate/output IDs. Do not bulk-requeue.
4. Check provider status, deployment name, endpoint, credential presence, quota,
   and network access without printing credential values.
5. If records may have been consumed with a `null` result, identify them from
   evidence/correlation records before any bounded replay.

## Recovery

1. Fix configuration or provider capacity in an isolated environment first.
2. Run one synthetic extraction and verify structured output, deterministic
   checks, candidate persistence, and exactly one verify-queue output.
3. Replay a small, documented set of failed records and compare input, candidate,
   verify, and poison counts one-for-one.
4. Confirm no service was published as a side effect and no sensitive content or
   credential was logged.
5. Re-enable the timer only after two stable samples and explicit Ingestion
   Operations Lead approval.

If recovery is uncertain, keep Azure ingestion paused. Existing reviewed public
resources can remain available through the active web stack.

## Live Exit Gate

Evidence must include the provider/deployment identifier, deployed commit,
settings names, test correlation IDs, queue counts before/after, one controlled
failure, its observed retry/consumption behavior, and one successful recovery.
No such evidence is recorded as of the review date.

## Code Validation Commands

```bash
npm run build:functions
npx vitest run src/agents/ingestion/llm/__tests__/client.test.ts src/services/runtime/__tests__/envContract.test.ts
npm run typecheck
```

These checks do not contact Azure or validate live queue semantics.

## References

- `functions/extractService/index.ts`
- `functions/extractService/function.json`
- `functions/verifyCandidate/index.ts`
- `src/agents/ingestion/llm/client.ts`
- `src/agents/ingestion/pipeline/stages.ts`
- `src/services/runtime/envContractCore.js`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
