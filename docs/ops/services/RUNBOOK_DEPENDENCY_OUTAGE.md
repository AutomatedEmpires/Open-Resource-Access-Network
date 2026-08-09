# Runbook: External Dependency Outage

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Data Platform Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Handles outages and degradations in external/platform dependencies required by
ORAN: Clerk, Supabase, Vercel, Sentry, OpenStreetMap tiles, Resend, and optional
provider-neutral integrations.

## Safety Constraints (Must Always Hold)

- Core seeker experience must remain factual and retrieval-first.
- Optional integrations may degrade, but must not create fabricated data.
- Do not disable auth boundaries to compensate for dependency failures.
- Crisis routing must remain deterministic and independent of an external model.
- Do not copy credentials or data from another portfolio application as a
  dependency workaround.

## Dependency Classes

1. Identity: Clerk.
2. Data: Supabase PostgreSQL and pooler.
3. Hosting: Vercel application/functions.
4. Observability: Sentry.
5. Mapping: OpenStreetMap tile service and provider-neutral geocoding.
6. Communications: Resend transactional email.
7. Optional capabilities: provider-neutral AI, cache, translation, speech, and
   future job providers. These are not required for deterministic chat safety.

## Diagnosis

1. Confirm affected dependency and blast radius.
2. Check the affected provider's status and the dedicated ORAN project.
3. Correlate privacy-filtered errors in Sentry.
4. Determine degraded-mode path:
   - Continue with reduced capability
   - Pause affected pipeline segment
   - Roll back the latest ORAN deployment
   - Fail closed when identity, authorization, publication integrity, or usage
     accounting cannot be trusted

## Mitigation Routing

- Auth issues: `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- Database issues: `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
- Rate-limit or quota issues: `docs/ops/services/RUNBOOK_RATE_LIMIT_INCIDENT.md`
- Telemetry blind spots: `docs/ops/monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md`
- Optional AI failure: keep deterministic navigation active and pause only the
  affected ingestion/language task
- Resend failure: preserve the underlying workflow/audit event, suppress retry
  storms, and restore delivery without treating email as the source of truth
- Broad platform impact: `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`

Retired Azure and Foundry systems are not recovery targets. Do not restore a
removed provider to mitigate an outage in the active stack.

## Validation

1. Dependency error rates return toward baseline.
2. Degraded controls are reverted safely.
3. Backlogs are drained where applicable.
4. No safety/privacy contract violations occurred.
5. `/api/health`, Clerk route protection, one bounded chat request, and the
   affected integration's focused test or provider-safe smoke check succeed.

## References

- `docs/platform/INTEGRATIONS.md`
- `docs/platform/STACK_MIGRATION.md`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
- `docs/ops/services/RUNBOOK_RATE_LIMIT_INCIDENT.md`
