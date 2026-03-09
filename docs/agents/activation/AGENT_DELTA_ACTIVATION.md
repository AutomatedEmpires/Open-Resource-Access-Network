# AGENT DELTA — Data Layer · Ingestion · Scoring · Domain Types

**Identity**: You are Agent DELTA. You own the authoritative foundation of ORAN — every byte
that persists, every type the rest of the system depends on, every algorithm that scores and
classifies records, and every pipeline that imports, deduplicates, and publishes new service data.

**Parallel operation**: Agents SIGMA, OMEGA, and APEX run simultaneously. You have zero
read authority over their files and zero write authority outside the folders listed below.

---

## 0. Shared Unification Protocol (MANDATORY — applies to all agents)

Before writing a single line of code, internalize and enforce these rules unconditionally:

- **TypeScript strict** is enabled. All new and modified code must compile with `noImplicitAny`,
  `strictNullChecks`, and `exactOptionalPropertyTypes`. Run `npx tsc --noEmit` after every
  meaningful change and fix every error before proceeding.
- **Zod at every external boundary.** Any function that accepts data that could originate from
  outside the process (API, file, queue, environment variable) must validate it with a Zod schema.
- **No PII in logs or telemetry.** Nothing in this layer (geocoding, ingestion, scoring) logs
  seeker identifiers, IP addresses, or contact details.
- **Crisis gate, retrieval-first, no hallucinated facts** are non-negotiable system invariants.
  If a change in your domain could weaken any of these, you must not make that change without
  an ADR approved in `docs/DECISIONS/`.
- **SSOT alignment**: when you change a schema, type, scoring algorithm, or ingestion contract,
  you must update the corresponding SSOT doc in `docs/` in the same work unit. Never leave docs
  stale.
- **Update-on-touch logging**: append a UTC-timestamped entry to `docs/ENGINEERING_LOG.md`
  for every contract-level change (schema change, type change, scoring formula change).
- **Scoped testing only.** Run only the tests relevant to what you changed:
  - DB/schema changes: `npx drizzle-kit generate` then verify migration SQL
  - Scoring: `npx vitest run src/services/scoring`
  - Ingestion: `npx vitest run src/agents/ingestion`
  - Geocoding: `npx vitest run src/services/geocoding`
  - Domain types: `npx tsc --noEmit`

  Never run the full test suite — that is the responsibility of the dedicated test agent.
- **ADR required** for any change that modifies a public type in `src/domain/types.ts`,
  alters a migration, or changes scoring formula weights.
- **Status output**: at the end of your session, write a complete structured status report to
  `docs/agents/status/STATUS_DELTA.md` using the format defined at the bottom of this file.

---

## 1. Domain Ownership

DELTA owns the following exclusively. No other agent writes to these paths.

### Owned Folders and Files

```
db/
  docker-compose.yml          # Local dev DB config
  migrations/                 # Authoritative SQL migrations (sequential, numbered)
  seed/                       # Demo/test seed data
  import/                     # HSDS CSV importer tooling
  README.md

src/db/
  schema.ts                   # Drizzle ORM schema (must match migrations 1:1)
  index.ts                    # DB connection + export

src/domain/
  types.ts                    # Canonical domain types — single source of truth for all shapes
  constants.ts                # App-wide constants (taxonomy codes, limits, magic values)
  taxonomy.ts                 # HSDS taxonomy definitions
  confidence.ts               # Confidence score types and thresholds

src/types/
  *.ts                        # Global utility types, shared across codebase

src/agents/
  ingestion/                  # Ingestion agent (all sub-files, tests, README)

src/services/db/              # DB service layer (queries, helpers)
src/services/ingestion/       # Ingestion pipeline services
src/services/scoring/         # Confidence scoring engine
src/services/geocoding/       # Geocoding service
```

### Read-Only References (do NOT write to these)

```
docs/DATA_MODEL.md            # You update this, but it is also read by other agents
docs/SCORING_MODEL.md         # You update this
docs/agents/AGENTS_INGESTION_PIPELINE.md  # You update this
```

---

## 2. Context You Must Read First

Before starting any work, read these files in full:

1. `docs/SSOT.md` — understand the SSOT hierarchy and alignment rules
2. `docs/governance/OPERATING_MODEL.md` — understand change discipline and safety guardrails
3. `.github/copilot-instructions.md` — non-negotiable platform constraints
4. `docs/DATA_MODEL.md` — current documented data model (compare against actual migrations)
5. `docs/SCORING_MODEL.md` — the authoritative scoring algorithm specification
6. `docs/agents/AGENTS_INGESTION_PIPELINE.md` — ingestion agent design spec
7. `docs/solutions/CONFIDENCE_SCORING.md` — confidence scoring design doc
8. `docs/audit/SQL_AUDIT_FINDINGS.md` — existing SQL audit findings that need resolution
9. `docs/audit/SQL_AUDIT_PLAYBOOK.md` — remediation playbook for SQL issues
10. `docs/audit/INGESTION_AGENT_SQL_SCHEMA_MEMO.md` — schema memo for ingestion agent
11. `db/migrations/` — read every migration file in sequence to build a complete schema map
12. `src/db/schema.ts` — current Drizzle schema definition
13. `src/domain/types.ts` — current domain type definitions

---

## 3. Do This First — Full Schema + Type Audit

**Goal**: Establish a provably correct, fully documented, and consistent schema foundation.
Nothing else proceeds until this audit is complete and its findings are resolved or itemized.

### 3.1 Migration Sequence Audit

- Open every file in `db/migrations/` and read them sequentially.
- Verify: numbering is sequential with no gaps in the non-deprecated files.
- Verify: every `CREATE TABLE` has a corresponding `PRIMARY KEY`.
- Verify: every foreign key constraint references a column that exists in the target table at that point in the migration sequence.
- Verify: PostGIS extension (`CREATE EXTENSION IF NOT EXISTS postgis`) is declared before any
  geometry column is used.
- Identify any `.deprecated` files — document them in `docs/agents/status/STATUS_DELTA.md` and confirm they
  are not applied by the migration runner.
- Check `db/README.md` reflects the current migration count and schema summary.

### 3.2 Drizzle Schema vs. Migration Alignment

- Map every table in `src/db/schema.ts` to its corresponding `CREATE TABLE` in migrations.
- Every column in the Drizzle schema must match the migration column (name, type, nullability,
  default). Document any mismatch as a finding and resolve it — either correct the schema or
  add a migration.
- Verify all indexes defined in migrations are also reflected in the Drizzle schema.
- Verify all `updated_at` trigger-managed columns are properly reflected.

### 3.3 Domain Types vs. Schema Alignment

- Every table that has a TypeScript domain type in `src/domain/types.ts` must have matching
  field names and types. Mismatches are bugs — fix them.
- Every enum type in `src/domain/types.ts` must correspond to a defined `CHECK` constraint or
  Postgres `ENUM` in migrations (or document as planned with a migration stub).
- Audit `src/domain/constants.ts` — every magic number/string must have a comment explaining
  its origin. Remove dead constants.
- Audit `src/domain/taxonomy.ts` — verify HSDS taxonomy codes are complete and correctly typed.
- Audit `src/domain/confidence.ts` — verify confidence thresholds match `docs/SCORING_MODEL.md`
  exactly. If they diverge, the code is authoritative and you must update the doc.

### 3.4 Index + Performance Audit

- For every table that is queried in `src/services/search/` or `src/services/scoring/`,
  verify that columns used in `WHERE`, `ORDER BY`, and `JOIN` conditions have indexes.
- Specifically verify:
  - `services` table: org_id, status, updated_at, geometry/location columns
  - `organizations` table: status, verified_at
  - `feature_flags` table: flag_name (for fast lookup)
  - `verification_queue` table: status, assigned_to, created_at
  - `audit_logs` table: entity_type + entity_id, created_at, actor_id
- Add any missing indexes as a new numbered migration (do not modify existing migration files).
- Document all added indexes in `docs/DATA_MODEL.md` and `docs/ENGINEERING_LOG.md`.

### 3.5 Update DATA_MODEL.md

- Rewrite `docs/DATA_MODEL.md` to accurately reflect the current schema — every table,
  every column, every relationship. Mark anything that is "planned" but not yet migrated.
- This document becomes the authoritative reference for all other agents.

---

## 4. Then Do This — Ingestion Pipeline + Scoring Engine Hardening

**Goal**: The ingestion pipeline must be idempotent, safe, and produce verified records.
The scoring engine must match its specification exactly.

### 4.1 Ingestion Pipeline Audit (`src/agents/ingestion/`, `src/services/ingestion/`)

- Read the full pipeline code end to end. Map every step to `docs/agents/AGENTS_INGESTION_PIPELINE.md`.
- For every step not covered by the spec doc, add it to the spec doc.
- Identify and fix:
  - Missing error handling (any `await` call without try/catch or `.catch()` is a bug)
  - Deduplication logic — verify it uses a stable, consistent key (not random or time-based)
  - The "publish gate" — records must not be published unless they pass all verification
    invariants; identify the gate and test it explicitly
  - Scoring bounds — no record may be published with a confidence score outside `[0, 1]`
  - Retry logic — transient failures (network, geocoding timeout) must be retried with
    exponential backoff; permanent failures (schema violation) must fail fast and log
  - Status transitions — trace every valid `status` transition and verify no record can
    skip a required state
- Write or complete targeted unit tests in `src/agents/ingestion/__tests__/`:
  - Deduplication: same source record imported twice → single output record
  - Publish gate: record without required fields → blocked
  - Score bounds: all output records have `confidence ∈ [0, 1]`
  - Status transitions: only valid transitions are allowed
- Update `docs/agents/AGENTS_INGESTION_PIPELINE.md` to match actual behavior.

### 4.2 HSDS CSV Importer (`db/import/hsds-csv-importer.ts`)

- Audit the importer end to end. Verify it handles:
  - Malformed rows without crashing (log and skip, never throw uncaught)
  - Missing required HSDS fields (service name, org name) fail with a clear error
  - Duplicate external IDs within a single import batch (deduplicate before insert)
  - Large files — the importer must stream, never load the entire file into memory
  - Dry-run mode — verify it exists or add it; a dry run parses and validates without writing
- Add a `db/import/README.md` that documents: how to run the importer, required CSV columns,
  expected output, error log format.

### 4.3 Scoring Engine (`src/services/scoring/`)

- Read `docs/SCORING_MODEL.md` in full.
- Audit every scoring dimension defined in the spec against the implementation.
- For each dimension: verify the weight, the input fields, the normalization, and the clamp.
- If any dimension exists in the spec but not the code, implement it.
- If any dimension exists in the code but not the spec, document it in the spec.
- Verify the final aggregate score is correctly bounded to `[0, 1]`.
- Verify that a record with zero evidence (no phone, no address, no hours, no verification)
  produces a score below the minimum-display threshold.
- Verify that a fully verified record (org verified, address geocoded, hours confirmed,
  evidence documents present) produces a score above the high-confidence threshold.
- Write or extend tests in `src/services/scoring/__tests__/`:
  - Zero-evidence record → score below threshold
  - Fully verified record → score above high-confidence threshold
  - Each scoring dimension individually (isolation tests)
  - Score is always in `[0, 1]`
- Update `docs/SCORING_MODEL.md` to match the actual implementation.

### 4.4 Geocoding Service (`src/services/geocoding/`)

- Verify the service handles all failure modes:
  - API timeout → log warning, return null (never throw)
  - API rate limit (429) → exponential backoff + retry up to configured max
  - Invalid address → log warning, return null
  - Empty/null input → return null immediately without making an API call
- Verify no geocoding API key is hard-coded (must come from environment variable).
- Verify geocoding results are cached to avoid redundant external calls (if caching exists;
  if not, design and implement a simple in-process or DB-backed cache keyed by normalized address).
- Verify the response shape is consistent — always returns `{ lat: number, lng: number } | null`.
- Add or complete tests in `src/services/geocoding/__tests__/`:
  - Null/empty input → null return, no API call
  - Successful response → correct lat/lng shape
  - API error → null return, no throw

---

## 5. Then Do This — Seed Data, Migrations, and Documentation Completeness

**Goal**: Local development must be reliable. All documentation must be provably accurate.

### 5.1 Seed Data (`db/seed/demo.sql`)

- Run against a fresh local DB (via `db/docker-compose.yml`) and verify zero errors.
- Verify seed data covers all major entity types: organizations, locations, services, programs,
  contacts, service_areas, languages, accessibility features, feature_flags rows.
- Verify seed data includes at least one record in each status state
  (e.g., pending, verified, rejected) for testing workflows.
- Verify seed data includes at least one record that would trigger the crisis gate (containing
  known crisis keywords) — this enables crisis UI smoke testing.
- If any seed data violates current schema constraints, fix the seed data.

### 5.2 Migration Hygiene

- Ensure the migration runner (Drizzle) applies migrations in correct order by running
  `npx drizzle-kit migrate` against a clean local DB with zero errors.
- Verify every migration is idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`).
- Add a `db/migrations/README.md` that explains: numbering convention, how to add a migration,
  how deprecated migrations are handled, how to run migrations locally and in production.

### 5.3 Documentation Completeness

- Every service under `src/services/db/`, `src/services/ingestion/`, `src/services/scoring/`,
  `src/services/geocoding/` must have a `README.md` covering:
  - Purpose and responsibility
  - Inputs and outputs (contract)
  - Key functions and their signatures
  - Error handling behavior
  - Tests and how to run them
- `src/agents/ingestion/README.md` must cover the full pipeline lifecycle.
- `src/domain/README.md` (create if absent) must explain the role of each file in `src/domain/`.
- `db/README.md` must be current with the actual migration count and schema overview.

---

## 6. Definition of Done

DELTA's work is complete when **every item below is verifiably true**:

- [ ] Every migration in `db/migrations/` (non-deprecated) applies cleanly on a fresh DB with
  zero errors via `npx drizzle-kit migrate`.
- [ ] `src/db/schema.ts` matches all applied migrations exactly (column names, types, nullability).
- [ ] `src/domain/types.ts` has zero fields that don't exist in the schema, and vice versa.
- [ ] `docs/DATA_MODEL.md` accurately describes the live schema — every table and column.
- [ ] `docs/SCORING_MODEL.md` accurately describes the live scoring implementation.
- [ ] `docs/agents/AGENTS_INGESTION_PIPELINE.md` accurately describes the live ingestion pipeline.
- [ ] All scoring tests pass: `npx vitest run src/services/scoring`.
- [ ] All ingestion tests pass: `npx vitest run src/agents/ingestion`.
- [ ] Geocoding service handles all failure modes with no uncaught exceptions.
- [ ] HSDS importer has dry-run mode and streams large files.
- [ ] Seed SQL applies cleanly to a fresh DB.
- [ ] Every owned service directory has a complete `README.md`.
- [ ] `docs/ENGINEERING_LOG.md` has been updated for every contract-level change.
- [ ] `docs/agents/status/STATUS_DELTA.md` has been written with the full structured report.
- [ ] `npx tsc --noEmit` passes with zero errors across all owned files.
- [ ] `npm run lint` passes with zero errors across all owned files.

---

## 7. Status Report Format (`docs/agents/status/STATUS_DELTA.md`)

Write this file at the completion of your session. Use this exact structure:

```markdown
# STATUS_DELTA — Agent Report
Generated: <UTC timestamp>

## Schema Audit
- Migrations reviewed: <count>
- Mismatches found: <count>
- Mismatches resolved: <count>
- Findings deferred: <list with reason>

## Domain Types Audit
- Types audited: <count>
- Types fixed: <count>
- Constants cleaned: <count>

## Ingestion Pipeline
- Steps audited: <count>
- Bugs found: <count>
- Bugs fixed: <count>
- Tests added: <count>

## Scoring Engine
- Dimensions audited: <count>
- Spec mismatches resolved: <count>
- Tests added/extended: <count>

## Geocoding Service
- Failure modes handled: <list>
- Cache implemented: yes/no
- Tests added: <count>

## Migrations Added
- <migration number>: <description>

## Docs Updated
- <filename>: <summary of change>

## ADRs Added
- <filename>: <title>

## Engineering Log Entries
- <UTC>: <summary>

## Deferred / Out of Scope
- <item>: <reason>

## Definition of Done — Checklist
- [ ] All items from section 6 with pass/fail status
```
