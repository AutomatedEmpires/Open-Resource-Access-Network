# Runbook: Deployment Rollback

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Data Platform Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Rollback a failed or unsafe Vercel production release while preserving Supabase
schema compatibility, Clerk authorization, resource integrity, and auditability.
Retired provider platforms are not an application rollback mechanism.

## Safety Constraints

- Maintain deterministic crisis routing and provenance-backed retrieval.
- Never restore a build known to weaken privacy, auth, publication, or usage limits.
- Confirm schema compatibility before moving an alias to older code.
- Do not reverse an applied data migration by deleting history or replaying the
  migration directory.
- Record the deployment ID, commit SHA, operator, reason, and validation outcome.

## Triggers

- A critical journey regresses immediately after production promotion.
- Auth or role boundaries fail.
- Publication or resource-integrity controls regress.
- Error rate or latency rises materially and correlates with the release.
- Database or configuration changes leave the new release unsafe.

## Pre-Rollback Checklist

1. Assign the incident commander and freeze unrelated releases.
2. Identify the current Vercel deployment, commit SHA, aliases, and incident start.
3. Select a previously successful, reviewed deployment as the rollback target.
4. Compare all database migrations between target and current commits.
5. Confirm the target expects the current Clerk, Supabase, Sentry, Resend, cron,
   and environment-variable contract.
6. Capture `/api/health`, critical journey status, and privacy-filtered Sentry
   evidence before changing the alias.

## Rollback Paths

### Application-only rollback

1. Promote or re-alias the known-good Vercel deployment through the ORAN project.
2. Confirm root, `www`, and the stable Vercel alias resolve to the intended deployment.
3. Do not change DNS when a deployment alias rollback is sufficient.

### Configuration rollback

1. Restore the last reviewed ORAN-only environment values without printing them.
2. Redeploy the known-good commit; existing immutable deployments do not receive
   every configuration change automatically.
3. Revoke any credential involved in a suspected exposure.

### Database/migration incompatibility

1. Prefer application rollback when the schema remains backward compatible.
2. Use a reviewed forward-fix migration when data/schema changes are not reversible.
3. Stop and escalate if the older application would write invalid data against
   the current schema.

## Validation

- `/api/health` is healthy, ready, and database connected.
- Home, chat, map, scroll, sign-in, and sign-up respond correctly.
- Profile, queue, verify, host, and admin boundaries deny unauthorized users.
- Ordinary chat usage and exhausted-quota crisis routing both behave correctly.
- Published search excludes quarantined/supporting-reference records.
- All five Vercel Cron routes retain authentication and bounded behavior.
- Sentry associates events with the rollback release and no secret enters logs.

Monitor for at least 30 minutes before declaring the rollback stable.

## Post-Rollback

1. Keep the release freeze until the corrective change is reviewed.
2. Record root cause, user impact, rollback deployment, and residual risks.
3. Update affected tests/runbooks and complete a postmortem when severity requires it.

## References

- `docs/platform/STACK_MIGRATION.md`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/services/RUNBOOK_WEB_APP_DEGRADATION.md`
- `vercel.json`
- `db/migrations/`
