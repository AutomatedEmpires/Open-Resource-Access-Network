# ADR-0002: UI/UX Contract + Vertical Shells

Status: **Accepted**

## Context

ORAN currently has a working seeker chat surface and multiple stubbed dashboard pages. Without a consistent design contract, pages will drift (spacing, component patterns, navigation, accessibility, safety messaging), causing rework and trust risks.

ORAN is also multi-role (seeker, host, community admin, ORAN admin). A single shell for all roles tends to produce confusing navigation and access-control leakage.

## Decision

Adopt a sitewide UI/UX contract and implement role-based “vertical shells”:

1. Establish the following contract docs as UI SSOT once accepted:
   - `docs/UI_UX_CONTRACT.md`
   - `docs/UI_UX_TOKENS.md`
   - `docs/UX_FLOWS.md`
   - `docs/PAGE_DEFINITION_OF_DONE.md`

2. Define vertical shells (separate layouts) for:
   - Seeker (public)
   - Host (authenticated)
   - Community Admin (authenticated)
   - ORAN Admin (authenticated)

3. Require every page implementation PR to meet the Page DoD checklist, include mobile screenshots, and avoid violating ORAN safety constraints.

## Consequences

Positive:
- Pages become consistent by default (mobile-first, accessible, standardized states).
- Reduced rework and fewer UI regressions.
- Clearer information architecture per role.
- Safety messaging (crisis/eligibility/trust) remains consistent across surfaces.

Tradeoffs:
- Slight overhead for each PR to meet the checklist.
- Some refactors may be required to align existing pages with tokens/shells.

## Alternatives considered

1. Single unified shell for all roles
   - Rejected: higher risk of nav confusion and access leakage.

2. Ad-hoc implementation per page
   - Rejected: inconsistent UX and difficult to enforce safety/privacy conventions.

## Rollout / verification plan

1. Update `docs/SSOT.md` and `docs/UI_SURFACE_MAP.md` (done in same change set).
2. For the next UI PRs:
   - Start with seeker navigation/home → directory (most visible surfaces).
   - Add vertical layouts (`src/app/(...)/layout.tsx`) as the first implementation step.
3. Testing:
   - Continue logic tests via Vitest.
   - Add UI interaction tests (Playwright) when we implement the first complex dashboard workflow.

## Timestamp

2026-03-02T00:00:00Z
