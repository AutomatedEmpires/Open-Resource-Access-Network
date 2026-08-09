# Runbook: CI/CD Pipeline Failure

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Security Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

Handle failures in GitHub checks, Vercel Git deployments, source-map upload, or
the manual Supabase migration workflow that block safe ORAN delivery.

## Triggers

- A required GitHub check fails on the release branch or pull request.
- Vercel fails to build or promote the intended commit.
- The deployed Vercel commit differs from the reviewed release commit.
- Sentry source-map upload fails during build.
- `Database Migration (Supabase)` fails or reports an unbaselined target.
- A retired-provider artifact or setting is introduced into the active deployment path.

## Diagnosis

1. Record the failing check/workflow, run ID, commit SHA, and target environment.
2. Determine whether production is affected or only release velocity.
3. Classify the failure as application, test, dependency, credential,
   environment contract, migration, or provider outage.
4. For Vercel, compare the Git commit, deployment state, build output, aliases,
   and `/api/health` response.
5. For Supabase migrations, preserve the fail-closed baseline guard. Never replay
   all historical migrations over an imported schema to make CI green.
6. Require `check:off-azure-runtime` to reject retired-provider artifacts and settings.

## Mitigation

1. If production is healthy, hold promotion and repair the pipeline on the
   reviewed branch.
2. If production is affected, use the deployment rollback runbook.
3. Re-run only after the underlying cause changes; avoid repeated secret-bearing
   provider calls.
4. Keep security, runbook-freshness, migration-baseline, and runtime-readiness
   checks fail closed.
5. Do not use force fixes, fabricated review dates, skipped tests, or a sibling
   portfolio project's credentials to clear a check.

## Validation

- Required GitHub checks pass for the exact intended commit.
- Vercel reports the deployment Ready and its alias points to that commit.
- `/api/health` is ready and connected on the candidate URL.
- Sentry associates the release and source maps when configured.
- Any migration appears once in `schema_migrations` and its focused validation
  passes.
- The retired-provider static and runtime policy passes.

## References

- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/a11y.yml`
- `.github/workflows/bundle-size.yml`
- `.github/workflows/visual-regression.yml`
- `.github/workflows/runbook-freshness.yml`
- `.github/workflows/db-migrate.yml`
- `vercel.json`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `docs/platform/STACK_MIGRATION.md`
