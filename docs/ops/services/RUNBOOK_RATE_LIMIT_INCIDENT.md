# Runbook: Rate Limit Incident

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Product Operations Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

Address incidents where rate limiting is either too permissive (abuse risk) or too restrictive (legitimate users blocked).

## Code-Verified Context

- Rate limiter implemented in `src/services/security/rateLimit.ts`.
- API routes return `Retry-After` header on 429 responses.

## Triggers

- 429 spikes on critical user endpoints.
- Evidence of abuse traffic bypassing effective throttling.
- Support reports of legitimate users repeatedly blocked.

## Diagnosis

1. Identify affected endpoints.
2. Confirm whether 429s include expected `Retry-After` values.
3. Determine if traffic is abusive or organic growth.

## Mitigation

1. For false positives, tune endpoint-specific limits cautiously.
2. For abuse spikes, tighten limits and monitor collateral impact.
3. Validate protected/internal/admin endpoints remain controlled.

## Validation

- 429 rate returns to acceptable range.
- Legitimate user flows recover.
- Abuse indicators decline.

## References

- `src/services/security/rateLimit.ts`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
- `docs/SECURITY_PRIVACY.md`
