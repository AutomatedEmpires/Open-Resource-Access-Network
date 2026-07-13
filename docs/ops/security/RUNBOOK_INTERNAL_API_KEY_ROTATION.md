# Runbook: Scheduled Worker Secret Rotation

## Metadata

- Owner role: Security Lead
- Reviewers: Platform On-Call Lead, Ingestion Operations Lead
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Rotate `CRON_SECRET`, which authenticates Vercel Cron GET requests to ORAN's
internal routes. This runbook also covers the separate, optional
`INTERNAL_API_KEY` used only by approved rollback workers through the
`x-oran-internal-key` header.

## Triggers

- Suspected credential exposure.
- Scheduled credential hygiene rotation.
- Unauthorized access attempts against internal endpoints.

## Containment

If either credential may be exposed, treat it as a security incident. Disable
Vercel Cron Jobs before rotating a compromised `CRON_SECRET`; disable any
rollback worker before rotating `INTERNAL_API_KEY`. Do not print either value in
logs, screenshots, tickets, shell history, or chat.

## `CRON_SECRET` Rotation Procedure

1. Generate a dedicated random value of at least 32 characters in the ORAN-only
   secret manager.
2. Update `CRON_SECRET` in the ORAN Vercel Production environment without
   changing Preview or another portfolio application.
3. Redeploy the reviewed production commit so the new environment value is
   active.
4. Invoke one internal GET route with the new Bearer credential through a
   secret-safe client, then verify the response status and Sentry/runtime logs.
5. Re-enable Cron Jobs if containment disabled them. Verify all five jobs on
   their next scheduled run before closing the incident or change.
6. Revoke the prior value and record the rotation metadata without recording
   the secret.

## Rollback Credential Rotation

1. Generate a separate random value for `INTERNAL_API_KEY` in the ORAN-only
   secret manager. Never reuse `CRON_SECRET`.
2. Update the approved rollback worker and the target application as one
   controlled change.
3. Send the new value only in `x-oran-internal-key`; legacy Bearer support is a
   temporary rollback bridge, not the operating contract.
4. Verify the old value is rejected, then revoke it and record rotation
   metadata without the secret.

## Validation

- Missing or incorrect credentials return 401, or 503 when no internal
  credential is configured.
- `/api/internal/ingestion/feed-poll`, `/api/internal/sla-check`,
  `/api/internal/coverage-gaps`, `/api/internal/confidence-regression-scan`, and
  `/api/internal/resource-freshness-scan` accept the new Vercel Bearer
  credential through GET.
- The registered Vercel Cron Jobs show a successful invocation. No response is
  cached and no secret appears in logs.

## References

- `src/app/api/internal/sla-check/route.ts`
- `src/app/api/internal/coverage-gaps/route.ts`
- `src/app/api/internal/confidence-regression-scan/route.ts`
- `src/app/api/internal/ingestion/feed-poll/route.ts`
- `src/app/api/internal/resource-freshness-scan/route.ts`
- `src/services/auth/internalRequest.ts`
- `vercel.json`
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Vercel Cron management and security](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
