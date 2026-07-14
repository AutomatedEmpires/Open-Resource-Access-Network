# Runbook: Incident Postmortem

## Metadata

- Owner role: Incident Commander
- Reviewers: Platform On-Call Lead, Security Lead, Data Platform Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Standardize post-incident review so corrective actions are clear, prioritized, and tracked.

## Required Timeline

- Draft postmortem within 24 hours for SEV-1/SEV-2.
- Finalized postmortem within 5 business days.

## Postmortem Template

1. Incident summary.
2. User and system impact.
3. Detection timeline (UTC).
4. Root cause and contributing factors.
5. What worked / what failed.
6. Corrective actions (owner + due date).
7. Runbook updates completed.
8. Safety/privacy assessment, including whether crisis routing, publication
   integrity, auth boundaries, or personal data were affected.
9. Exact Vercel release, Supabase migration range, and provider configuration
   changes involved, without secret values.

## Quality Bar

- Blameless analysis.
- Evidence-backed timeline.
- Action items mapped to prevention, detection, and response.
- User impact is described in plain language without exposing personal data.
- Corrective actions distinguish code, data, provider, process, and monitoring causes.

## References

- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/templates/INCIDENT_COMMS_TEMPLATE.md`
- `docs/ENGINEERING_LOG.md`
