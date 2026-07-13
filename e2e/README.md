# End-to-End Tests (Playwright)

This folder contains Playwright end-to-end tests.

## Run

- `npm run test:e2e`
- `npm run test:e2e:ui`
- `npm run test:e2e:headed`

Authenticated suites use Clerk's Playwright testing token and pre-provisioned,
ORAN-only development users. Provide `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, and one role-specific email variable for each role under
test (`ORAN_E2E_SEEKER_EMAIL`, `ORAN_E2E_HOST_ADMIN_EMAIL`,
`ORAN_E2E_COMMUNITY_ADMIN_EMAIL`, and `ORAN_E2E_ORAN_ADMIN_EMAIL`). Two-person
approval coverage additionally requires `ORAN_E2E_ORAN_ADMIN_ALT_EMAIL`.
Each user's role must be provisioned in the ORAN database; tests never inject
authorization claims or reuse accounts from another business.

## Scope

E2E tests should cover cross-page flows and role-gated surfaces at a high level (smoke + regression), not deep unit logic.
