# Search Service (src/services/search)

## Contract

- Pure SQL/PostGIS retrieval only.
- No LLM, no vector similarity, no ML ranking.
- Queries must be parameterized.
- Authenticated chat may pass deterministic `profileSignals`, but they may only re-order already eligible results.
- Personalized chat retrieval must bypass the shared Redis cache.

Primary entry points:

- src/services/search/engine.ts (query builder + engine)
- src/app/api/search/route.ts (API boundary + Zod validation)

## Tests

- `src/services/search/__tests__/query-builder.test.ts`

## Update-on-touch

If you change the query builder, filters, ranking/order-by, or API parameters:

- Update docs/DATA_MODEL.md if schema assumptions change
- Update docs/SCORING_MODEL.md if ranking semantics change
- Update docs/SECURITY_PRIVACY.md if abuse/rate limit behavior changes
- Add/update targeted tests
