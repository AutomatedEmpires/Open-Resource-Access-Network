# Runbook: Change Freeze And Go/No-Go

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Security Lead, Data Platform Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Defines when to declare a temporary change freeze and how to execute go/no-go release decisions for production.

## Freeze Triggers

- Active SEV-1/SEV-2 incident.
- Elevated error rates with unknown root cause.
- Security incident containment window.
- Unresolved migration risk before deployment.

## Freeze Procedure

1. Declare freeze in incident/release channel.
2. Pause non-essential deploy workflows.
3. Allow only approved emergency fixes.
4. Track exception approvals and rationale.

## Go/No-Go Checklist

1. CI status healthy on release candidate.
2. No active high-severity security alerts affecting release scope.
3. Database migration compatibility reviewed.
4. Rollback target identified and validated.
5. On-call coverage confirmed for deployment window.
6. Communication plan prepared.

## Hard No-Go Criteria

Declare `NO-GO` if any are true:
- Active SEV-1/SEV-2 unresolved.
- Unknown root cause for elevated 5xx/latency trend.
- Migration compatibility unresolved.
- Security incident still in containment or investigation phase.
- No validated rollback target available.

## Emergency Exception Path

If a deployment is required during freeze:
1. Incident Commander and Release Manager jointly approve.
2. Scope is limited to minimal-risk corrective change.
3. Rollback target is validated before deployment starts.
4. Incident channel logs rationale and approvals.

## Decision Outcomes

- `GO`: proceed with deploy and active monitoring window.
- `NO-GO`: hold release, open blocker issue, set re-evaluation time.

## Post-Decision Actions

- Document decision rationale.
- If no-go, define remediation owner and ETA.
- If go, monitor key signals for at least one stabilization window.

## References

- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `.github/workflows/deploy-azure-appservice.yml`
- `.github/workflows/deploy-azure-functions.yml`
- `.github/workflows/deploy-infra.yml`
