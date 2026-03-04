# ORAN Feature Flags

Lightweight in-memory feature flag service. The `feature_flags` table exists in the DB
schema (migration `0000_initial_schema.sql`) and is seeded by the migration itself.
Runtime flag evaluation currently uses `InMemoryFlagService`; DB-backed reads are planned.

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

## Fail-Closed Semantics

The `InMemoryFlagService.isEnabled()` method returns `false` for any unknown flag name.
Combined with the `llm_summarize` default of `false` / 0 % rollout, LLM summarization
is **guaranteed off** unless explicitly enabled.

If a DB-backed flag service is wired in the future, it must preserve this contract:
- Unknown flag → `false`
- DB unreachable → `false` (fail-closed)
- `llm_summarize` must never default to `true`

## Seed Data

Flags are seeded in two places:
1. **Migration** (`db/migrations/0000_initial_schema.sql`): `INSERT INTO feature_flags ... ON CONFLICT DO NOTHING`
2. **Demo seed** (`db/seed/demo.sql`): Same values for local development

## Adding a New Flag

1. Add the flag name to `FEATURE_FLAGS` in `src/domain/constants.ts`.
2. Add a `makeFlag(...)` entry to `DEFAULT_FLAGS` in `src/services/flags/flags.ts`.
3. Add an `INSERT` row to `db/migrations/0000_initial_schema.sql` (or a new migration).
4. Add an `INSERT` row to `db/seed/demo.sql`.
5. Update the table in this README.
6. If safety-critical, create an ADR in `docs/DECISIONS/`.
