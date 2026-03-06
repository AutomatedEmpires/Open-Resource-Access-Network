# Runbook: INTERNAL_API_KEY Rotation

## Metadata

- Owner role: Security Lead
- Reviewers: Platform On-Call Lead, Ingestion Operations Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Rotate `INTERNAL_API_KEY` used by internal web endpoints and timer-triggered Azure Functions.

## Triggers

- Suspected key exposure.
- Scheduled key hygiene rotation.
- Unauthorized access attempts against internal endpoints.

## Rotation Procedure

1. Generate new secret value in Key Vault.
2. Update Web App and Function App settings to reference new key.
3. Restart services in controlled order.
4. Verify internal endpoints succeed only with new key.

## Validation

- `/api/internal/sla-check` rejects old key, accepts new key.
- `/api/internal/coverage-gaps` and `/api/internal/confidence-regression-scan` behave similarly.
- Timer functions continue successful execution.

## References

- `src/app/api/internal/sla-check/route.ts`
- `src/app/api/internal/coverage-gaps/route.ts`
- `src/app/api/internal/confidence-regression-scan/route.ts`
