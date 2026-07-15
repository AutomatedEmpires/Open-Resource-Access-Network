# Runbook: Web Application Degradation

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Release Manager, Identity And Access Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Respond to elevated latency, function failures, or partial journey failures in
the Vercel-hosted ORAN web application and API surface.

## Triggers

- `/api/health` reports unready, database disconnected, or sustained high latency.
- `/api/chat`, `/map`, or public-resource retrieval has elevated latency or 5xx.
- Sentry or Vercel reports a sustained production error increase.
- Clerk redirects or protected-route enforcement fail.
- A new deployment correlates with a critical seeker, host, reviewer, or admin
  journey regression.

## Triage

1. Open `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` and assign severity.
2. Record the production deployment URL and commit SHA; distinguish root-domain
   DNS failure from application failure by checking the Vercel deployment URL.
3. Check `/api/health`, Vercel deployment/runtime logs, and privacy-filtered
   Sentry events.
4. Test public home, chat, map, and scroll separately from authenticated profile,
   queue, and verification routes.
5. Confirm Supabase and Clerk status when failures affect database or auth paths.
6. Check the five authenticated Vercel Cron routes only when scheduled resource
   maintenance is affected.

## Mitigation

1. Pause optional scheduled work if it materially increases database or function
   pressure.
2. Roll back to a known-good Vercel deployment when the regression is release-linked.
3. Restore the ORAN-only environment configuration and redeploy when readiness
   reports missing runtime settings.
4. Route specialized failures to auth, database, rate-limit, dependency, or
   observability runbooks.
5. Do not bypass Clerk, publication integrity, chat usage accounting, or crisis
   routing to restore availability.

## Validation

- `/api/health` returns healthy, ready, and database connected.
- Home, chat, map, scroll, sign-in, and sign-up return expected responses.
- Profile, queue, and verify remain protected at the correct role boundary.
- A bounded ordinary chat request and an exhausted-quota crisis fixture preserve
  their respective usage and safety contracts.
- Error rates remain normal for one stabilization window.

## References

- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
- `docs/ops/services/RUNBOOK_RATE_LIMIT_INCIDENT.md`
- `docs/ops/monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md`
- `docs/platform/STACK_MIGRATION.md`
