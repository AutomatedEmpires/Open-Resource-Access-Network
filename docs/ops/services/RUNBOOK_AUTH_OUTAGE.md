# Runbook: Authentication And Authorization Outage

## Metadata

- Owner role: Identity And Access Lead
- Reviewers: Platform On-Call Lead, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

This runbook handles outages or degradations affecting Microsoft Entra ID auth, NextAuth session handling, route-level enforcement, and role-based access controls.

## Safety Constraints (Must Always Hold)

- Protected routes must fail closed in production when auth is unavailable.
- Admin and internal endpoints must not be exposed through auth bypass.
- No emergency change may weaken role enforcement semantics.
- No sensitive identity data should be logged in incident channels.

## Code-Verified Behavior

- Route enforcement is implemented in `src/proxy.ts`.
- If `AZURE_AD_CLIENT_ID` is missing in production, protected routes return 503.
- Session context extraction uses `getAuthContext()` in `src/services/auth/session.ts`.
- API routes enforce auth and roles via `getAuthContext()` and `requireMinRole()`.
- Auth endpoint (`/api/auth/[...nextauth]`) is rate-limited and returns `Retry-After` on 429.

## Triggers

- Sudden spike in 401/403/503 on protected routes.
- Sign-in redirect loops or callback failures.
- Token parsing/session extraction failures.
- Role mismatches causing widespread forbidden responses.

## Diagnosis

1. Confirm blast radius:
   - UI route protection failures (`src/proxy.ts` patterns).
   - API auth failures (`src/app/api/**/route.ts`).
2. Check app configuration:
   - `AZURE_AD_CLIENT_ID`
   - `AZURE_AD_CLIENT_SECRET`
   - `AZURE_AD_TENANT_ID`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - If optional providers are enabled, also verify:
     - `APPLE_CLIENT_ID`
     - `APPLE_CLIENT_SECRET`
     - `ORAN_ENABLE_APPLE_AUTH`
     - `GOOGLE_CLIENT_ID`
     - `GOOGLE_CLIENT_SECRET`
     - `ORAN_ENABLE_GOOGLE_AUTH`
     - `ORAN_ENABLE_CREDENTIALS_AUTH`
3. Verify deploy/environment changes around incident time.
4. Validate session handling in logs for `getServerSession()` or JWT parsing failures.

## Mitigation Paths

### A. Entra Configuration Drift

1. Verify app settings and Key Vault references in App Service.
2. Correct invalid/missing auth settings.
3. Restart web app after config correction.

### B. Session/JWT Failure

1. Confirm `NEXTAUTH_SECRET` exists and is valid.
2. Verify callback URL (`NEXTAUTH_URL`) matches deployed hostname.
3. Re-test sign-in flow and protected route access.

### D. Optional Provider Regression

1. Confirm the enabled provider has a complete env set, not only the gate flag.
2. For credentials auth, determine whether the failure is specific to email, username, or phone identifier lookup.
3. Remember that phone login is password-based identifier auth, not SMS/OTP.
4. If the affected account is primarily Entra-backed, verify whether a `password_hash` exists on the same `user_profiles` row before assuming the account cannot use credentials sign-in.
5. Re-test Microsoft Entra login separately to confirm the outage is isolated to an optional provider.

### C. Role Mapping Issues

1. Validate role claims and mapping in `src/lib/auth.ts` (`ENTRA_ROLE_MAP`).
2. Confirm role expectations for affected routes.
3. Apply minimal correction and revalidate API + UI access matrix.

## Rollback Criteria

- Auth outage persists after configuration correction and restart.
- Protected routes cannot enforce safe access boundaries.
- Widespread admin access regressions continue for 15+ minutes.

Use `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` for rollback execution.

## Validation

1. Sign-in flow succeeds.
2. Protected route matrix works (seeker, host, community admin, oran admin).
3. Admin APIs return expected 401/403 behavior for unauthorized/forbidden users.
4. 5xx and 503 auth-related errors return to baseline.

### Route-Role Quick Verification Matrix

| Route family | Expected minimum role |
| --- | --- |
| `/saved`, `/profile` | `seeker` |
| `/claim`, `/org`, `/locations`, `/services`, `/admins` | `host_member` |
| `/queue`, `/verify`, `/coverage` | `community_admin` |
| `/approvals`, `/rules`, `/audit`, `/zone-management`, `/ingestion` | `oran_admin` |

Confirm both behaviors:

- Authenticated and authorized user succeeds.
- Unauthorized/underprivileged user receives redirect or 403 as expected.

## References

- `src/proxy.ts`
- `src/lib/auth.ts`
- `src/services/auth/session.ts`
- `src/services/auth/guards.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `docs/SECURITY_PRIVACY.md`
