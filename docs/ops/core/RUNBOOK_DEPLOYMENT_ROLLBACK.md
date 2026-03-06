# Runbook: Deployment Rollback

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Data Platform Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

This runbook defines rollback procedures for failed or risky production deployments affecting web app, functions, infrastructure configuration, or database migration compatibility.

## Safety Constraints (Must Always Hold)

- Maintain crisis routing behavior and retrieval-first guarantees.
- Never roll back to a build that is known to violate safety or privacy controls.
- Avoid schema/code version mismatches that break production reads/writes.
- Preserve auditability of all rollback actions.

## Triggers

- Elevated 5xx/error rates immediately after deployment.
- Authentication failures or authorization boundary regressions.
- Severe latency regressions with no quick mitigation.
- Broken critical journeys: seeker search, admin routing, ingestion verification.

## Pre-Rollback Checklist

1. Confirm incident severity and appoint IC.
2. Confirm issue correlates with latest deployment window.
3. Capture current health snapshot for postmortem.
4. Confirm rollback target version and artifact integrity.
5. Validate DB migration compatibility with rollback target.

Record rollback target details before execution:
- Previous known-good commit SHA
- Previous successful workflow run ID
- Environment and timestamp of known-good deploy

## Rollback Paths

### A. Application Rollback (Web App / Functions)

1. Pause ongoing deploy workflows.
2. Redeploy last known good build artifact or previous release ref.
3. Restart affected service if needed.
4. Validate health checks and critical API routes.

### B. Infrastructure Rollback

1. Identify failing infra change set.
2. Re-apply last known good infrastructure parameters/state.
3. Validate app settings, secrets references, identity bindings.

### C. Data/Migration Risk

1. If schema migration is backward compatible, roll back application first.
2. If schema migration is not backward compatible, execute forward-fix migration plan.
3. Never drop/alter critical tables under emergency pressure without explicit approval.

## Validation Checklist

1. `CI` and deployment checks are green for rollback target.
2. p95 latency and error rates return to baseline.
3. Auth and role-guarded routes behave correctly.
4. Ingestion and admin routing pipelines process normally.
5. No active SEV-level alerts remain.

Stabilization window:
- Monitor for at least 30 minutes after rollback before declaring resolved.

## Communications

- Announce rollback start and expected duration.
- Publish mitigation completion with user impact summary.
- Share known residual risks and monitoring window.

## Post-Rollback Follow-Up

1. Lock further deploys until corrective patch is reviewed.
2. Open corrective issue with clear root cause and tests.
3. Update runbook with any missing pre-check or validation step.
4. Log the event in `docs/ENGINEERING_LOG.md` when operational contracts changed.

## References

- `.github/workflows/deploy-infra.yml`
- `.github/workflows/deploy-azure-appservice.yml`
- `.github/workflows/deploy-azure-functions.yml`
- `docs/platform/DEPLOYMENT_AZURE.md`
- `db/migrations/`
