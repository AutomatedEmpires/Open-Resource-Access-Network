# Runbook: authentication and authorization outage

## Ownership

- Owner: Identity and Access Lead
- Reviewers: Platform On-Call Lead, Security Lead
- Severity: SEV-1 through SEV-3
- Stack: dedicated ORAN Clerk application, Vercel project, and Supabase database

## Safety constraints

- Protected routes and APIs must fail closed.
- Do not introduce a development bypass, provider fallback, or temporary role claim.
- Clerk owns identity; ORAN's database owns roles, account status, and memberships.
- Do not link an account by email or copy an identity from another business.
- Never place secret values, session tokens, or personal data in incident notes.

## Expected behavior

- `src/proxy.ts` uses Clerk middleware for identity and same-origin write protection.
- `src/services/auth/session.ts` maps `Clerk user ID -> ORAN user profile` and
  resolves database-owned authorization.
- Production requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `CLERK_SECRET_KEY`; missing keys make readiness fail.
- A database error while reading account status or role denies access.
- New identities receive only the `seeker` role until ORAN governance grants
  something higher.

## Triggers

- Sign-in/sign-up cannot load or loops.
- Protected surfaces return an unusual spike of 401, 403, or 503 responses.
- `/api/auth/context` cannot resolve authenticated users.
- A valid identity receives the wrong ORAN role or organization scope.
- Clerk custom domain or JWKS checks fail.

## Diagnosis

1. Confirm the impact separately for public pages, sign-in, seeker routes, host
   routes, community routes, and ORAN-admin routes.
2. Check the latest Vercel deployment and ORAN-only environment-variable change
   history. Confirm both Clerk keys exist without copying their values.
3. Verify `https://clerk.openresourceaccessnetwork.com/.well-known/jwks.json`
   returns a successful JSON response.
4. Check the dedicated Clerk instance status and recent authentication events.
5. Check Supabase connectivity, then inspect the affected user's explicit
   `clerk_user_id`, `account_status`, `role`, and active organization memberships.
6. Verify the public domain, Clerk issuer, and configured redirect URLs belong to
   ORAN and not a sibling portfolio application.
7. Review Sentry using request/release identifiers only; do not search by raw PII.

## Mitigation

### Clerk configuration or domain failure

1. Restore the last known-good ORAN Vercel environment configuration.
2. Repair ORAN Clerk DNS/redirect settings if verification failed.
3. Redeploy the last known-good candidate and re-test sign-in before promoting.

### Authorization-store failure

1. Restore Supabase connectivity or roll back the responsible migration/release.
2. Keep administrative access denied while role/account state cannot be read.
3. Do not move roles into Clerk claims as an outage workaround.

### Incorrect identity mapping

1. Freeze the affected privileged account if unauthorized access is possible.
2. Compare the explicitly recorded Clerk ID with the intended ORAN user profile.
3. Correct mappings through a reviewed database change with an audit record.
4. Never infer the replacement mapping from email alone.

## Validation matrix

| Route family | Minimum role |
| --- | --- |
| `/saved`, `/profile` | `seeker` |
| Host portal routes | `host_member` |
| `/queue`, `/verify`, `/coverage` | `community_admin` |
| ORAN operations/admin routes | `oran_admin` |

For every family, verify an authorized user succeeds, an unauthenticated user is
redirected or receives 401, and an underprivileged user receives 403. Confirm
account freezes and organization-scope restrictions also take effect.

## Rollback criteria

Roll back when protected routes cannot enforce the correct boundary, sign-in is
still broadly unavailable after restoring configuration, or a release created
incorrect identity mappings. Follow `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`.

## References

- `src/proxy.ts`
- `src/services/auth/session.ts`
- `src/services/auth/guards.ts`
- `src/app/api/auth/context/route.ts`
- `docs/SECURITY_PRIVACY.md`
