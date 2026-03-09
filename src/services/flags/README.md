# ORAN Feature Flags

Hybrid feature flag service with a DB-backed authoritative catalog when `DATABASE_URL`
is configured, plus an in-memory fallback for local development and runtime recovery.
The `feature_flags` table exists in the DB schema (migration `0000_initial_schema.sql`)
and the expanded catalog is maintained by `db/migrations/0035_feature_flag_catalog.sql`.

## Flag Registry

| Flag Name         | Default  | Rollout | Purpose                                  | Toggle Owner  | Safety Notes                                           |
|-------------------|----------|---------|------------------------------------------|---------------|--------------------------------------------------------|
| `llm_summarize`   | **off**  | 0 %     | Enable LLM post-retrieval summarization  | `oran_admin`  | **Fail-closed**: defaults to off; must never synthesize data |
| `map_enabled`     | on       | 100 %   | Show map surface in navigation           | `oran_admin`  | Disabling hides the map tab                            |
| `feedback_form`   | on       | 100 %   | Allow seeker feedback submission          | `oran_admin`  | Disabling removes the feedback button                  |
| `host_claims`     | on       | 100 %   | Allow new host organization claims        | `oran_admin`  | Disabling blocks new claim submissions                 |

## Typed Constants

All flag names are defined in `src/domain/constants.ts` under the `FEATURE_FLAGS` object.
Application code must reference these constants — never use raw string literals.

```typescript
import { FEATURE_FLAGS } from '@/domain/constants';

const enabled = await flagService.isEnabled(FEATURE_FLAGS.LLM_SUMMARIZE);
```

## Runtime Semantics

The flag service preserves a few hard guarantees:

- Unknown flag name -> `false`
- Partial rollout without a subject key -> `false`
- `llm_summarize` defaults to `false` / 0 %
- Writes only persist to the DB when the DB is configured; in-memory writes are local-only

When the DB is configured, reads use the stored catalog and merge any missing defaults from
code. If a later DB read fails, the service reuses the last known good DB snapshot before
falling back to the local in-memory catalog. Safety-critical AI flags still default off.

Admin updates written through the DB-backed path also emit a best-effort `audit_logs`
record so feature flag changes become attributable.

## Seed Data

Flags are seeded in three places:

1. **Migration** (`db/migrations/0000_initial_schema.sql`): `INSERT INTO feature_flags ... ON CONFLICT DO NOTHING`
2. **Catalog migration** (`db/migrations/0035_feature_flag_catalog.sql`): expands descriptions and backfills the enterprise catalog
3. **Demo seed** (`db/seed/demo.sql`): Same baseline values for local development

## Adding a New Flag

1. Add the flag name to `FEATURE_FLAGS` in `src/domain/constants.ts`.
2. Add a `makeFlag(...)` entry to `DEFAULT_FLAGS` in `src/services/flags/flags.ts`.
3. Add an `INSERT` row to `db/migrations/0000_initial_schema.sql` (or a new migration).
4. Add an `INSERT` row to `db/seed/demo.sql`.
5. Update the table in this README.
6. If safety-critical, create an ADR in `docs/DECISIONS/`.
