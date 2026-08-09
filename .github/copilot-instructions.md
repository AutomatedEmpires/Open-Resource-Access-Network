# ORAN Copilot Instructions

This repository is **ORAN (Open Resource Access Network)** — a civic-grade, safety-critical platform for locating verified services.

## Non‑negotiables (must always hold)

1. **Retrieval-first**: chat/search results must come from stored records only.
2. **No hallucinated facts**: never invent service names, phone numbers, addresses, hours, eligibility, or URLs.
3. **Crisis hard gate**: if imminent-risk indicators are detected, return **911 / 988 / 211** routing immediately and stop.
4. **Eligibility caution**: never guarantee eligibility. Use “may qualify” + “confirm with provider”.
5. **Privacy-first**: approximate location by default; explicit consent before saving profile details.
6. **Security**: avoid PII in logs/telemetry. Follow `docs/SECURITY_PRIVACY.md`.

If any requested change conflicts with these constraints, propose a safer alternative.

## SSOT + Operating Model

- SSOT hierarchy: docs/SSOT.md
- Engineering operating model: docs/governance/OPERATING_MODEL.md
- For safety-critical changes, add an ADR: docs/DECISIONS/

Update-on-touch rule:

- If you modify chat/search/scoring contracts, also update the relevant docs/**SSOT files and the area README under src/services/**.
- For contract-level changes, append a short UTC entry to docs/ENGINEERING_LOG.md.

## Architecture map (where things live)

- App Router pages: `src/app/**`
- API routes: `src/app/api/**/route.ts`
- Core domain types/constants: `src/domain/**`
- Services (business logic): `src/services/**`
  - Chat pipeline orchestration: `src/services/chat/**`
  - Search engine/contracts: `src/services/search/**`
  - Scoring: `src/services/scoring/**`
  - Feature flags: `src/services/flags/**`
  - Telemetry wrapper: `src/services/telemetry/sentry.ts`
- Database & migrations: `db/**`
  - SQL migrations: `db/migrations/**`
  - Import tooling: `db/import/**`
- Design/behavior specs: `docs/**` (authoritative)

## Key integration contracts

- Auth: Clerk owns identity and sessions; ORAN's database owns roles, account status, and memberships. Legacy providers are retired.
- Platform target: Vercel + Supabase + Clerk + Sentry. Azure and Foundry are retired and prohibited; there is no rollback activation path.
- DB: Supabase PostgreSQL + PostGIS + pgvector via `pg` and Drizzle ORM.
- Telemetry: Sentry is the production backend and must not receive PII.
- Feature flags gate risky/optional features (e.g., `llm_summarize`).

## Platform migration rules

- Do not add or re-enable Azure/Foundry dependencies, settings, endpoints, workflows, or fallbacks.
- Prefer Vercel, Supabase, Clerk, and Sentry where the platform capability fits.
- Treat `docs/platform/STACK_MIGRATION.md` as the active stack decision; older platform documents are historical evidence only, never operating instructions.
- Do not expose Supabase tables through the Data API until every exposed table has reviewed RLS.

## Chat behavior rules

- The pipeline is defined in `docs/CHAT_ARCHITECTURE.md`.
- **No LLM** participates in retrieval/ranking.
- If `llm_summarize` is enabled, an LLM may only summarize *already retrieved records* and must not add facts.

## Coding conventions

- TypeScript `strict` is enabled.
- Prefer small, composable functions under `src/services/**`.
- Validate untrusted input (API routes) with Zod.
- Keep changes minimal and aligned with existing patterns.
- Don’t add dependencies unless clearly justified.

## Common commands

- Dev server: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Tests: `npm run test` / `npm run test:coverage`

## What to do when uncertain

- Ask 1–3 clarifying questions when requirements are ambiguous.
- Point to the relevant doc in `docs/**` and follow it.
- Prefer safer defaults: no new data collection, no new external calls, no weakening of crisis/eligibility/privacy rules.
