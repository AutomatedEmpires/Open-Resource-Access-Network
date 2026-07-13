# Runbook: External Dependency Outage

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Data Platform Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Handles outages and degradations in external/platform dependencies required by ORAN (Clerk, Supabase, Vercel, Sentry, map tiles, and optional AI or communications providers).

## Safety Constraints (Must Always Hold)

- Core seeker experience must remain factual and retrieval-first.
- Optional integrations may degrade, but must not create fabricated data.
- Do not disable auth boundaries to compensate for dependency failures.

## Dependency Classes

1. Identity: Clerk.
2. Data: Supabase PostgreSQL and pooler.
3. Hosting: Vercel application/functions.
4. Observability: Sentry.
5. Mapping: OpenStreetMap tile service and provider-neutral geocoding.
6. Optional capabilities: direct OpenAI/provider-neutral AI, cache, jobs, and communications providers.

## Diagnosis

1. Confirm affected dependency and blast radius.
2. Check the affected provider's status and the dedicated ORAN project.
3. Correlate privacy-filtered errors in Sentry.
4. Determine degraded-mode path:
   - Continue with reduced capability
   - Pause affected pipeline segment

## Mitigation Routing

- Auth issues: `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- OpenAI extraction issues: `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
- Queue issues/backlog: `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
- Broad platform impact: `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`

## Validation

1. Dependency error rates return toward baseline.
2. Degraded controls are reverted safely.
3. Backlogs are drained where applicable.
4. No safety/privacy contract violations occurred.

## References

- `docs/platform/INTEGRATIONS.md`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md`
