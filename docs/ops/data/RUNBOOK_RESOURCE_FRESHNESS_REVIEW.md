# Runbook: Resource Freshness Review

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Platform On-Call Lead, Community Operations Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

ORAN runs a deterministic daily scan at
`GET /api/internal/resource-freshness-scan`. The route requires the shared
internal-request gate (`CRON_SECRET` for Vercel Cron or the separate internal
rollback credential), uses no LLM/API key, and processes at most 100 services
per run.

## Signals

- **Explicit expiry:** every schedule attached directly to a service or through
  one of its locations has a non-null `valid_to`, and the latest date is in the
  past. A single undated or current schedule prevents this classification.
- **Reverification due:** an extracted candidate's explicit `reverify_at` has
  passed and no newer source/manual verification exists.
- **Stale source:** a published canonical source has not been refreshed or
  otherwise verified for 180 days.
- **Unknown source:** a host/manual live service without canonical provenance
  has no update or verification signal for 365 days.

All four findings fail closed for seeker publication by setting the existing
`services.integrity_hold_*` fields. The scanner never deletes or rewrites
canonical service content.

## Review And Reversibility

Each hold has a private audit row in
`oran_internal.resource_freshness_findings`. The scanner creates a
`service_verification` submission in `needs_review`, or links to an existing
active verification for the same service. A partial unique index permits only
one open freshness finding per service, and a transaction advisory lock makes
scheduled retries idempotent.

On the next scheduled (or manually invoked) scan, an approved review clears
only the scanner's exact hold. For explicit expiry, the schedule must first be
corrected; approval alone cannot override a past `valid_to`. A denied review
records `confirmed_unavailable` and retains the publication hold. All findings
remain as audit history.

Community reports are not automatically attributed to freshness findings.
They remain independent evidence in the existing `community_report` pipeline,
which avoids treating an unrelated user report as expiry confirmation.

## Operations

Migration `0063_resource_freshness_review_lane.sql` must be applied before the
cron is enabled. A successful response includes checked, blocked, enqueued,
linked, resolved, and confirmed-unavailable counts. Scanner failures are
reported to Sentry under `resource_freshness_scan` and return a generic 500.

## Validation

Run the deterministic service and route suites:

```bash
npx vitest run src/services/freshness/__tests__/resourceFreshness.test.ts src/app/api/internal/resource-freshness-scan/__tests__/route.test.ts
```

Then verify an unauthenticated production request returns `401` and an
authorized Vercel Cron request returns a bounded result without seeker data or
secret values in the response.

## References

- `db/migrations/0063_resource_freshness_review_lane.sql`
- `src/services/freshness/resourceFreshness.ts`
- `src/app/api/internal/resource-freshness-scan/route.ts`
- `vercel.json`
