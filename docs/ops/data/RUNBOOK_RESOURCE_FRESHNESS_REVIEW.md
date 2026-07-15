# Runbook: Resource Freshness Review

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Platform On-Call Lead, Community Operations Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-10-14
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
- **Reverification due:** a candidate that completed the reviewed publication
  workflow has an explicit `reverify_at` in the past and no newer
  source/manual verification exists. Pending, escalated, rejected, or merely
  re-extracted candidates are not verification evidence; extraction alone
  never advances `last_verified_at` or `reverify_at`.
- **Stale source:** a published canonical source has not been refreshed or
  otherwise verified for 180 days.
- **Unknown source:** a host/manual live service without canonical provenance
  has no update or verification signal for 365 days.

For ordinary resources, all four findings fail closed for seeker publication
by setting the existing `services.integrity_hold_*` fields. A service governed
by an active verified-hotline or quarantine authority is never mutated by this
scanner; it is counted and emitted as a non-suppressing protected-authority
warning for owner action. The scanner never deletes or rewrites canonical
service content.

## Review And Reversibility

Each hold has a private audit row in
`oran_internal.resource_freshness_findings`. The scanner creates a
`service_verification` submission in `needs_review`, or links to an existing
active verification for the same service. A partial unique index permits only
one open freshness finding per service, and a transaction advisory lock makes
scheduled retries idempotent.

The review decision and freshness reconciliation run in one database
transaction. An approved review clears only the scanner's exact hold. For
explicit expiry, the schedule must first be corrected; approval alone cannot
override a past `valid_to`. A denied review records `confirmed_unavailable`,
moves an active service to the reversible `inactive` lifecycle state, and
clears only the scanner's exact hold; any unrelated hold remains. A later
verified provider-return review can deliberately reactivate the service through
the normal publication workflow. A later scan provides bounded catch-up for a
previously committed review that still needs reconciliation, but is not the
normal decision path. All findings remain as audit history.

Freshness packets use structured outcomes and evidence. A malformed legacy
packet fails closed and can be repaired only by an ORAN administrator from the
matching private finding; community reviewers cannot reconstruct or overwrite
that evidence. Freshness decisions never use the generic service projection
path and therefore cannot reactivate a service that another lifecycle or
integrity policy marked inactive or defunct.

Community reports are not automatically attributed to freshness findings.
They remain independent evidence in the existing `community_report` pipeline,
which avoids treating an unrelated user report as expiry confirmation.

## Operations

Migrations `0063_resource_freshness_review_lane.sql`,
`0066_backend_runtime_capability.sql`, and the production capability patch
`0069_freshness_and_merge_runtime_capability.sql` must be applied before the
cron is enabled on an upgraded environment. Validate the backend-role manifest
after applying them. A successful response includes checked (the combined
catch-up and discovery budget), blocked, per-signal blocked, enqueued, linked,
resolved, and confirmed-unavailable counts. Scanner failures
are reported to Sentry under `resource_freshness_scan` and return a generic
500.

Any nonzero `protectedAuthoritySkippedCount` is actionable, not a successful
review outcome. The route emits a privacy-safe Sentry warning under
`resource_freshness_protected_authority`. The Data Platform Lead must
acknowledge it immediately, identify the active verified-hotline or quarantine
batch through the protected database operations path, and use that owner-only
maintenance workflow for re-verification or deactivation. Do not send the
record to ordinary community review or clear its authority as a shortcut.

Monitor both the count and oldest age of open findings. A rising count with a
growing oldest age is a queue-health incident even when each daily scan
succeeds. Operators may use this read-only query through the approved database
operations path:

```sql
SELECT signal_type,
       count(*) AS open_findings,
       min(blocked_at) AS oldest_opened_at,
       max(extract(epoch FROM (now() - blocked_at)) / 3600) AS oldest_open_hours
FROM oran_internal.resource_freshness_findings
WHERE status = 'open'
GROUP BY signal_type
ORDER BY signal_type;
```

Discovery uses weighted-fair ordering across explicit expiry, reverification,
stale-source, and unknown-source lanes; explicit expiry receives two slots per
round and every other non-empty lane receives one. Alert when `checkedCount`
repeatedly reaches 100, when any per-signal count stops progressing, or when an
open signal lane's oldest age continues increasing. Those are saturation or
routing symptoms even when the cron itself returns 200.

Investigate scanner failures, reviewer-capacity loss, geographic routing gaps,
and an increasing `pending_second_approval` age before changing scan volume.
Never publish or clear holds merely to reduce the backlog.

## Validation

Run the deterministic service and route suites:

```bash
npx vitest run src/services/freshness/__tests__/resourceFreshness.test.ts src/services/freshness/__tests__/resourceFreshnessRepair.test.ts src/services/community/__tests__/scope.test.ts src/app/api/internal/resource-freshness-scan/__tests__/route.test.ts 'src/app/api/community/queue/[id]/__tests__/route.test.ts' 'src/app/api/admin/resource-freshness/[id]/repair/__tests__/route.test.ts' src/components/community-admin/__tests__/ResourceFreshnessReviewPanel.test.tsx
```

Then run the read-only capability audit with the protected migration
connection, followed by the normal typecheck, lint, test, and production-build
gates:

```bash
psql "$SUPABASE_DB_URL" -f scripts/validate-backend-runtime.sql
```

Then verify an unauthenticated production request returns `401` and an
authorized Vercel Cron request returns a bounded result without seeker data or
secret values in the response.

## References

- `db/migrations/0063_resource_freshness_review_lane.sql`
- `db/migrations/0066_backend_runtime_capability.sql`
- `db/migrations/0069_freshness_and_merge_runtime_capability.sql`
- `src/services/freshness/resourceFreshness.ts`
- `src/services/freshness/resourceFreshnessRepair.ts`
- `src/domain/resourceFreshnessReview.ts`
- `src/app/api/internal/resource-freshness-scan/route.ts`
- `vercel.json`
