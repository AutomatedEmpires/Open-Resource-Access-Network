# Runbook: account, onboarding, and form resilience

## Metadata

- Owner role: Identity and Access Lead
- Reviewers: Platform On-Call Lead, Data Platform Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Scope

This runbook covers Clerk account entry, ORAN profile/onboarding persistence, and
managed-form draft creation. Clerk owns credentials and verification; the
application must not implement a parallel registration or password endpoint.

## Safety constraints

- Self-service account creation can produce only a `seeker` ORAN profile.
- Roles, freezes, and memberships are database-owned and cannot come from an
  identity-provider claim.
- Sensitive onboarding fields are optional, purpose-limited, and stored only
  after an explicit `Save to profile` decision.
- Account linking requires an explicit Clerk ID and is never inferred by email.
- Organization- or community-scoped forms cannot cross their authorized scope.
- Duplicate retries cannot create uncontrolled managed-form drafts.

## Account and onboarding checks

1. Confirm `/auth/signup` loads the dedicated ORAN Clerk application and returns
   to `/onboarding` after account creation.
2. Confirm `/api/auth/context` resolves the Clerk identity to an active ORAN
   profile with the expected database-owned role.
3. Confirm new profiles store `auth_provider='clerk'` and the explicit
   `clerk_user_id`; no password hash is created or changed.
4. Verify `Use once` onboarding choices remain session-only and do not appear in
   URLs, logs, or telemetry.
5. Verify `Save to profile` records consent metadata and only the fields selected
   by the seeker.
6. Test export/deletion separately; do not treat Clerk account deletion and ORAN
   data deletion as the same operation without an explicit coordinated flow.

## Managed-form controls

- `host_member` minimum authorization is required.
- Organization ownership and recipient access are enforced.
- Organization-scoped templates require `ownerOrganizationId`.
- Community-scoped templates require an active `coverageZoneId`.
- Direct routing requires an explicit recipient role.
- Oversized form data and attachment manifests are rejected.
- Attachment count and MIME rules are enforced before draft creation.
- Identical draft requests take an advisory lock and reuse an existing draft
  where safe.
- Review actions use the shared submission workflow and reviewer authorization.

Primary implementation:

- `src/app/auth/signup/[[...signup]]/page.tsx`
- `src/app/(seeker)/onboarding/OnboardingPageClient.tsx`
- `src/app/api/auth/context/route.ts`
- `src/app/api/profile/route.ts`
- `src/app/api/forms/instances/route.ts`
- `src/services/forms/vault.ts`

## Diagnosis

1. For sign-up failures, check the ORAN Clerk instance, domain, redirect URLs,
   and Vercel environment scope.
2. For wrong roles, inspect the explicit identity mapping and ORAN database role;
   do not change Clerk metadata as a shortcut.
3. For onboarding persistence issues, compare the `Use once`/`Save to profile`
   choice, request payload, consent fields, and profile API response.
4. For duplicate drafts, reproduce `POST /api/forms/instances` and inspect
   `reusedExistingDraft` plus actor/template/scope inputs.
5. For scope leakage, inspect `getAuthContext()` and `requireOrgAccess()` before
   changing storage queries.

## Focused validation

```bash
npx vitest run src/app/auth/__tests__/pages.test.tsx src/app/\(seeker\)/__tests__/onboarding-page-client.test.tsx src/app/api/profile/__tests__/route.test.ts src/app/api/forms/instances/__tests__/route.test.ts src/services/forms/__tests__/vault-core.test.ts
```

Then run `npm run typecheck` and the authenticated Clerk E2E suite with dedicated
ORAN test users.
