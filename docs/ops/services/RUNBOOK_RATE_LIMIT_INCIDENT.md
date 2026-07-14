# Runbook: Rate Limit And Chat Usage Incident

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Product Operations Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

Respond when ORAN usage controls are too permissive, incorrectly block a
legitimate seeker, or become unavailable. The primary production control is the
atomic PostgreSQL reservation implemented by migration
`0062_atomic_chat_usage_controls.sql`. Other protected route families use the
private atomic PostgreSQL limiter from `0068_shared_rate_limit_windows.sql` as
their production authority. Redis and process-local limiting are database-less
local/test options, not production failover counters.

## Production Contract

- Anonymous devices receive 10 successful non-crisis messages per rolling 24 hours.
- Authenticated accounts receive 20 successful non-crisis messages per rolling
  24 hours, constrained by both account and device history.
- Ordinary chat traffic is limited to six requests per minute.
- One request per identity may be in flight; an abandoned lease expires after
  five minutes.
- A successful ordinary response consumes quota. Errors, temporary retrieval
  outages, and non-chargeable responses release the reservation.
- Explicit self-crisis messages bypass usage controls and continue to the
  deterministic 911/988/211 safety path.
- When PostgreSQL is configured but usage reservation fails, chat fails closed
  with `503` and `Retry-After: 30`.
- When the shared PostgreSQL function fails, generic production route limiting
  fails closed instead of switching to a fresh provider or per-instance counter.
- Quota and limiter responses are private, non-cacheable, and include an
  appropriate `Retry-After` header.

## Triggers

- Unexpected spikes in `429` or `503` from `/api/chat`.
- Quota counts exceed the configured anonymous or authenticated ceiling.
- Concurrent requests both consume the final available slot.
- A successful response is returned after persistent finalization fails.
- Crisis routing is blocked by ordinary quota state.
- Supabase/PostgreSQL errors affect `oran_internal.reserve_chat_request`,
  `check_chat_quota`, `finalize_chat_request`, or
  `consume_shared_rate_limit`.

## Diagnosis

1. Confirm whether the response is `quota_exceeded`, `rate_limited`,
   `in_flight`, or `unavailable`; do not ask for raw chat text or identifiers.
2. Check the current Vercel release and Supabase health before changing limits.
3. Review privacy-filtered Sentry events for `chat_usage_reserve`,
   `chat_usage_finalize`, and `api_chat_usage_release`.
4. Confirm migrations `0062_atomic_chat_usage_controls.sql` and
   `0068_shared_rate_limit_windows.sql` are applied and the dedicated
   `oran_backend_runtime` role can execute only the required functions.
5. Reproduce with opaque test identities. Verify the anonymous and authenticated
   rolling windows separately and then test account/device rotation.
6. Send an explicit crisis fixture while quota is exhausted and verify the
   deterministic safety response still succeeds without consuming quota.

## Mitigation

### Persistent controls unavailable

1. Keep the fail-closed `503` posture; do not enable a per-instance production
   fallback.
2. Restore Supabase connectivity or the runtime function grants.
3. Redeploy only when configuration changed, then verify one reservation,
   successful finalization, and released finalization.

### Legitimate traffic incorrectly blocked

1. Determine whether the block comes from the rolling quota, minute rate, or
   in-flight lease.
2. Correct clock, identity, or reservation defects before considering a limit
   increase.
3. Do not delete usage rows or weaken account/device coupling as a convenience
   workaround.

### Limit bypass or overshoot

1. Preserve relevant audit and Sentry evidence without raw identity values.
2. Disable the affected release or roll back if atomic reservation/finalization
   changed.
3. Verify concurrency at the database boundary before restoring traffic.

## Validation

```bash
npx vitest run src/services/security/__tests__/rateLimit.test.ts src/services/security/__tests__/shared-rate-limit-migration.test.ts src/services/chat/__tests__/quota-usage-controls.test.ts src/app/api/chat/__tests__/route.test.ts src/app/api/chat/quota/__tests__/route.test.ts
```

Confirm all of the following:

- a blocked request returns `429` with `Retry-After`
- configured database failure returns `503`, not an in-memory allowance
- only successful ordinary responses decrement daily quota
- a finalization failure cannot ship a successful response
- explicit crisis routing remains available at exhausted quota

## References

- `db/migrations/0062_atomic_chat_usage_controls.sql`
- `db/migrations/0068_shared_rate_limit_windows.sql`
- `src/domain/constants.ts`
- `src/services/chat/quota.ts`
- `src/app/api/chat/route.ts`
- `src/services/security/rateLimit.ts`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
