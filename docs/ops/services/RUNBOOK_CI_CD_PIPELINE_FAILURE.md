# Runbook: CI/CD Pipeline Failure

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

Handle failures in build, test, or deployment workflows that block safe delivery.

## Triggers

- CI workflow failures on main branch.
- Deploy workflow failures in production environment.
- Pipeline auth failures (OIDC/login).

## Diagnosis

1. Identify failing workflow and stage.
2. Determine whether failure is code, infra, auth, or environment configuration.
3. Check if current production is impacted or only release velocity.

## Mitigation

1. If production impacted, invoke rollback runbook.
2. If production healthy, pause release and fix pipeline issue.
3. Re-run failed workflow once fix is applied.

## Validation

- Required workflows pass (`ci.yml`, deploy workflows).
- Deployment readiness restored.
- No unresolved high-severity warnings remain.

## References

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-infra.yml`
- `.github/workflows/deploy-azure-appservice.yml`
- `.github/workflows/deploy-azure-functions.yml`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
