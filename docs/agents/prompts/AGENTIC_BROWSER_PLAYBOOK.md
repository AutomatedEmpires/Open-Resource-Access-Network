# Agentic Browser Playbook (ORAN)

This repo is safety-critical. Browser-driven verification is meant to **prove the UX and safety invariants** after changes, not replace unit tests.

## What this enables

- Full-app UI smoke coverage across:
  - seeker flows
  - host / organization flows
  - ORAN admin flows
  - community admin flows
- Runs in either environment:
  - **DB seeded/present** (preferred; validates real retrieval + forms)
  - **DB absent** (verifies graceful degradation and clear errors)

## Golden invariants (must always hold)

- Retrieval-first: no invented provider facts.
- Crisis hard gate: crisis signals route to 911 / 988 / 211 and short-circuit.
- Eligibility caution: never guarantees eligibility; prompts to confirm with provider.
- Privacy-first: do not collect/store unnecessary PII.

## Recommended workflow (agent + browser)

1. Change code.
2. Run `npx tsc --noEmit` and `npm run test`.
3. Run browser smoke: `npm run test:e2e`.
4. If a regression is found, fix and repeat.

## E2E setup

### Install dependencies

- `npm install`

### Browser binaries

Playwright may require browser binaries on first use:

- `npx playwright install --with-deps chromium`

## Running with a seeded DB

- Start DB: `docker compose -f db/docker-compose.yml up -d`
- Apply migrations (if needed): `npx drizzle-kit migrate`
- (Optional) seed: `psql "$DATABASE_URL" -f db/seed/demo.sql`

Then run:

- `npm run test:e2e`

## Running with NO DB

Unset `DATABASE_URL` and run:

- `npm run test:e2e`

Expected behavior in this mode:

- Seeker chat still responds (but results may be empty)
- Directory search shows a clear failure state (503 surfaced as a user-visible error)
- Host/org pages show DB-not-configured failure states

## Auth for portal flows (dev/test only)

Some portals and APIs require authentication (ORAN admin, community admin). To let browser automation verify them without real Entra ID logins, we include a **dev-only** test auth provider.

- It is enabled only when:
  - `ORAN_TEST_AUTH_ENABLED=1`, and
  - `NODE_ENV !== 'production'`

Playwright is configured to set `ORAN_TEST_AUTH_ENABLED=1` automatically when starting `npm run dev` via `webServer`.

## What the smoke suite covers

Tests live under `e2e/`.

- Seeker smoke:
  - landing page emergency resources
  - chat crisis flow banner and links
  - directory search branches (DB present vs absent)
- Portal smoke:
  - host portal route crawl + org edit form flow (when DB is configured)
  - community admin route crawl (authenticated)
  - ORAN admin route crawl + feature flag edit (authenticated)

## Extending coverage safely

When adding new agentic browser checks:

- Prefer stable selectors:
  - `aria-label`, `role`, visible button text
- Avoid brittle selectors:
  - DOM position, deep CSS selectors
- Add at least one assertion per page that confirms:
  - page shell rendered (`#main-content`), and
  - critical safety UX did not regress (crisis/eligibility messaging where relevant)
