# Authz Contract

## Scope

Defines authentication, authorization, and route protection expectations.

## Inputs

- Session/token context
- Route and API access intent
- Role claims

## Required Guarantees

- Protected routes fail closed when auth dependencies are unavailable in production.
- Role checks enforce least privilege boundaries.
- Internal endpoints require valid internal authentication controls.

## Failure Modes

- Missing auth config in production -> protected path denial.
- Invalid or insufficient role -> explicit unauthorized/forbidden response.

## Validation

- Route-level and API-level auth tests.
- Role matrix verification against protected route families.

## References

- `docs/SECURITY_PRIVACY.md`
- `docs/governance/ROLES_PERMISSIONS.md`
- `src/services/auth/**`
- `src/proxy.ts`
