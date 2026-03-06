# Runbook: External Dependency Outage

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Data Platform Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Handles outages and degradations in external/platform dependencies required by ORAN (Azure OpenAI for ingestion, Entra auth, Azure Storage Queues, Azure Maps, Translator, email services).

## Safety Constraints (Must Always Hold)

- Core seeker experience must remain factual and retrieval-first.
- Optional integrations may degrade, but must not create fabricated data.
- Do not disable auth boundaries to compensate for dependency failures.

## Dependency Classes

1. Identity: Microsoft Entra / NextAuth.
2. Ingestion AI: Azure OpenAI (extraction only).
3. Queueing: Azure Storage Queues.
4. Geocoding: Azure Maps.
5. Translation: Azure AI Translator.
6. Notifications: Azure Communication Services email.

## Diagnosis

1. Confirm affected dependency and blast radius.
2. Check Azure service health and regional status.
3. Correlate errors in Application Insights.
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
