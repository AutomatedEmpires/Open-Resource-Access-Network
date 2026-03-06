# Runbook: Key Vault Access Failure

## Metadata

- Owner role: Security Lead
- Reviewers: Platform On-Call Lead, Release Manager
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Handle incidents where applications cannot read secrets via Key Vault references or managed identity permissions.

## Triggers

- Startup/runtime failures linked to missing secrets.
- Auth failures from missing `NEXTAUTH_SECRET` or Entra client secret.
- Internal API failures from missing `INTERNAL_API_KEY`.

## Diagnosis

1. Validate managed identity is enabled for affected app.
2. Validate Key Vault access policy/RBAC grants.
3. Validate secret names and reference syntax.
4. Correlate with recent infra/config changes.

## Mitigation

1. Restore identity permissions.
2. Correct broken secret references.
3. Restart affected app(s).
4. Validate dependent endpoints and workflows.

## Validation

- Critical secrets resolve correctly.
- Auth and internal API checks recover.
- No recurring secret-resolution errors in logs.

## References

- `docs/platform/DEPLOYMENT_AZURE.md`
- `docs/platform/PLATFORM_AZURE.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
