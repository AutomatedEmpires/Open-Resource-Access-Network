# ORAN Operating Model (Enterprise/Safety-Critical)

This repository is treated as **safety-critical** and **trust-centric**. The goal of this document is to keep the codebase secure, structured, and low-regression while minimizing wasted runtime.

## Guardrails (must always hold)

- Retrieval-first: service recommendations come from stored records only.
- No hallucinated facts: never invent services, phone numbers, addresses, hours, eligibility, or URLs.
- Crisis hard gate: imminent risk routes to 911/988/211 immediately.
- Eligibility caution: use “may qualify / confirm with provider.”
- Privacy: approximate location by default; explicit consent before profile saves.
- No LLM in retrieval/ranking. Optional LLM summarization only post-retrieval and must not add facts.

## Repository cleanliness rules

- Keep the architecture map current:
  - docs/UI_SURFACE_MAP.md (routes/surfaces)
  - docs/CHAT_ARCHITECTURE.md (chat)
  - docs/DATA_MODEL.md + db/migrations/** (data)

- Prefer small, composable modules under src/services/**.
- All API routes validate input with Zod.

## Change discipline (regression avoidance)

### 1) Write/align the contract first

- If changing a safety-critical behavior, update the SSOT doc first (or in the same PR).
- For significant changes, add an ADR under docs/DECISIONS/.

### 2) Targeted testing (don’t waste cycles)

Run the smallest test scope that proves the change:

- Chat: `npm run test:chat`
- Search: `npm run test:search`
- Scoring: `npm run test:scoring`

Only run full `npm run test:coverage` when:

- touching shared domain types/constants
- changing multiple service modules
- making safety-critical changes

### 3) CI is the arbiter

PRs must pass:

- lint
- typecheck
- test
- build

## “Update-on-touch” documentation

When you modify an area, you must also update the area README and the relevant SSOT docs:

- src/services/chat/README.md
- src/services/search/README.md
- src/services/scoring/README.md

Additionally, add a short entry to docs/ENGINEERING_LOG.md for any change that affects:

- safety contracts
- data model/migrations
- API schemas
- auth/roles

## Logging and telemetry

- Do not log PII.
- Use stable correlation IDs (sessionId) when needed.
- If adding Sentry events, confirm they do not include coordinates or message text.

## Timestamp expectations

- Persisted records must have `created_at` and `updated_at`.
- `updated_at` must auto-update on UPDATE (DB triggers or ORM).

## Quick links

- SSOT: docs/SSOT.md
- Audit baseline: docs/AUDIT_REPORT.md
- Security/privacy: docs/SECURITY_PRIVACY.md
- Governance: docs/GOVERNANCE.md
