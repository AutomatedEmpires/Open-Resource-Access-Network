# ORAN Single Source of Truth (SSOT)

ORAN is safety-critical. When documents and code disagree, the repo must define exactly which artifact is *authoritative*.

This file defines ORAN’s SSOT hierarchy and the required alignment rules. If you touch code in an area, you must update the SSOT docs for that area.

## SSOT Hierarchy (precedence)

When two sources conflict, the higher-precedence source wins:

1. **Non-negotiables** (safety contract): `docs/VISION.md#non-negotiables`, `.github/PULL_REQUEST_TEMPLATE.md`
1. **Executable enforcement** (what actually runs): `src/**`, `src/services/**/__tests__/**`
1. **Data persistence truth** (schema): `db/migrations/**`, `src/domain/types.ts`
1. **System specs** (design contracts): `docs/CHAT_ARCHITECTURE.md`, `docs/SCORING_MODEL.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_PRIVACY.md`
1. **Operational workflow** (how humans operate): `docs/GOVERNANCE.md`, `docs/ROLES_PERMISSIONS.md`, `.github/ISSUE_TEMPLATE/**`

## SSOT Alignment Rules

- **No hallucinations**: any user-visible service facts must originate from stored records only. Exceptions are approved constants: 911/988/211.
- **Crisis gate is first**: crisis routing must happen before quota/rate limit/intent/retrieval.
- **No LLM in retrieval/ranking**: LLM can only run as post-retrieval summarization *and must not add facts*.
- **Schema is canonical**: if docs mention a table/column that doesn’t exist in db/migrations, the docs must label it “planned” or a migration must be added.

## “When you touch X, update Y” mapping

- Chat pipeline changes:
  - Update: `docs/CHAT_ARCHITECTURE.md`
  - Tests: `src/services/chat/__tests__/intent-schema.test.ts` (or add a new focused test)

- Search query/ranking changes:
  - Update: `docs/SCORING_MODEL.md` (if confidence/relevance changes) and `docs/SECURITY_PRIVACY.md` (if rate limits/abuse controls change)
  - Tests: `src/services/search/__tests__/query-builder.test.ts`

- Scoring changes:
  - Update: `docs/SCORING_MODEL.md`
  - Tests: `src/services/scoring/__tests__/scoring.test.ts`

- DB schema changes:
  - Update: `docs/DATA_MODEL.md`
  - Add: new migration in `db/migrations/**`

- Auth/roles/security changes:
  - Update: `docs/SECURITY_PRIVACY.md`, `docs/ROLES_PERMISSIONS.md`
  - Tests: add targeted tests for authorization boundaries

- Ingestion/verification agent changes:
  - Update: `docs/AGENTS_INGESTION_PIPELINE.md`
  - Tests: add targeted tests under `src/agents/ingestion/__tests__/` for invariants (dedupe, scoring bounds, publish gate)

## ADRs (decisions)

All safety-critical or contract changes require an ADR:

- Put ADRs under `docs/DECISIONS/`
- Use ISO date + sequential ID naming

See `docs/DECISIONS/README.md`.
