# Agent SKY activation — seeker performance and accessibility

## Mission

Improve ORAN's seeker experience without weakening trust, privacy, accessibility, or the publication-gated data boundary.

## Provider boundary

Azure and Foundry are retired and prohibited. The seeker map uses Leaflet and open tiles. Do not add provider SDKs, browser keys, or external AI to seeker routes.

## Priority surfaces

- `/`, `/chat`, `/directory`, `/map`, `/saved`, and service detail
- responsive navigation, keyboard and screen-reader behavior, reduced motion, zoom, touch targets, and content-not-obscured behavior
- production bundle budgets, loading behavior, route transitions, and recoverable error/empty states

## Required context

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. `docs/ui/UI_UX_CONTRACT.md`
4. `docs/ui/UI_UX_TOKENS.md`
5. `docs/platform/STACK_MIGRATION.md`
6. `docs/SECURITY_PRIVACY.md`

## Delivery standard

- Start from measured current behavior and implement one coherent user journey at a time.
- Keep seeker-visible facts stored, provenance-backed, and uncertainty-aware.
- Verify 320px, 390px, tablet, and desktop layouts plus keyboard, reduced-motion, and zoom behavior.
- Run focused tests, typecheck, lint, production build, bundle ratchets, and relevant visual/browser checks.
- Do not change production data, providers, credentials, or deployment settings.
