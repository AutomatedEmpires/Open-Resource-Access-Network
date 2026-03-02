# Ingestion Agent SQL Schema Audit Memo (handoff)

Audience: the engineer/agent authoring the ingestion-agent SQL migrations.

## TL;DR
There are currently **two competing ingestion-pipeline schemas** in this repo:

- **Schema A (implemented in code today):** `db/migrations/0002_ingestion_tables.sql` + Drizzle schema in `src/db/schema.ts` (and the ingestion persistence code that writes to these columns).
- **Schema B (new “complete pipeline” SQL):** `db/migrations/0014_ingestion_pipeline.sql` + workflow extensions in `db/migrations/0015_admin_approval_workflow.sql` and `db/migrations/0016_admin_review_pipeline.sql`.

Schema B **does not extend Schema A cleanly** — it introduces different table names, different column models, and (in `0015`) functions/views that reference columns that don’t exist in Schema B.

If you apply Schema B to a database and run the code that was written for Schema A, persistence will break (or silently drift). If you apply both, the `IF NOT EXISTS` patterns can hide partial application and leave you with a DB that “migrates” but doesn’t match what the code expects.

This memo focuses on what looks wrong, why it matters, and concrete options to reconcile.

---

## What I reviewed (evidence)

### SQL files
- `db/migrations/0002_ingestion_tables.sql` (tables that match the current Drizzle schema)
- `db/migrations/0014_ingestion_pipeline.sql` (alternate/expanded ingestion schema)
- `db/migrations/0015_admin_approval_workflow.sql` (admin profiles/assignments + routing functions)
- `db/migrations/0016_admin_review_pipeline.sql` (a second, different admin-review pipeline)

### Code files
- `src/db/schema.ts` (Drizzle schema; explicitly claims it corresponds to `0002_ingestion_tables.sql`)

---

## Finding 1 — Two “source registry” tables with different semantics

### Schema A (code-backed)
- Table: `ingestion_sources`
- Drizzle: `ingestionSources`
- Trust levels: `('vetted', 'community', 'quarantine', 'blocked')`

### Schema B (SQL-only)
- Table: `source_registry`
- Trust levels: `('allowlisted', 'quarantine', 'blocked')`

**Why this matters:**
- The code cannot use `source_registry` without a full rename/mapping.
- The enum values don’t overlap (`vetted/community` vs `allowlisted`), so even a naive rename would break logic unless the meaning is reconciled.

**Questions to ask yourself:**
- Are these actually different concepts (curated registry vs crawler allowlist)? If so, they should not be treated as the same table.
- If they’re the same concept, which naming/enum set is canonical?

---

## Finding 2 — Two different models for “evidence snapshots”

### Schema A (code-backed)
- Table: `evidence_snapshots` includes `evidence_id`, `blob_storage_key`, and also stores `html_raw` + `text_extracted` in-db.

### Schema B (SQL-only)
- Table: `evidence_snapshots` uses:
  - `source_url` and `canonical_url`
  - `blob_uri` + `blob_container`
  - `previous_snapshot_id`
  - no in-db raw content fields

**Why this matters:**
- These aren’t minor diffs: they reflect fundamentally different storage strategies.
- Storing `html_raw`/`text_extracted` in Postgres can bloat storage and can increase privacy risk if raw pages contain PII. Schema B seems to be moving toward “blob store for payload, DB for metadata,” which is usually a better long-term posture.

**Recommendation:**
- Pick one strategy explicitly and document it.
- If you keep raw content in the DB, add explicit retention/size constraints and ensure you’re not capturing user-submitted PII.

---

## Finding 3 — `extracted_candidates` shape drift (breaks routing + workflow)

### Schema A (code-backed)
`extracted_candidates` contains:
- `candidate_id` (TEXT unique)
- `extraction_id` (TEXT unique)
- `verification_checklist` (JSONB)
- `investigation_pack` (JSONB)
- `provenance_records` (JSONB)
- plus denormalized address fields

### Schema B (SQL-only)
`extracted_candidates` contains:
- no `candidate_id`/`extraction_id` fields
- includes `address` as a JSONB object
- includes `discovered_links` as JSONB on the candidate
- includes `provenance` JSONB (single object)

**Why this matters:**
- The Drizzle schema and any persistence code built on it will not map to Schema B.
- Even inside Schema B, `0015_admin_approval_workflow.sql` references an `extracted_candidates.extracted_data` JSON column that does **not** exist in Schema B (or Schema A).

**Concrete broken reference (in 0015):**
- `c.extracted_data->>'location'` and `c.extracted_data->>'location_id'` in `route_candidate_to_admins()`

This suggests `0015` was authored against an older/third candidate schema and not updated.

---

## Finding 4 — `resource_tags` model is inconsistent across migrations

### Schema A (code-backed)
`resource_tags` is modeled as a polymorphic tag table:
- `target_id` (TEXT)
- `target_type` (candidate/service)
- `tag_type`, `tag_value`, `confidence`, etc.

### Schema B (SQL-only)
`resource_tags` is modeled as a relational child of either:
- `candidate_id` (UUID FK to extracted_candidates)
- `service_id` (UUID FK to services)

### Concrete broken reference (in 0015):
`route_candidate_to_admins()` does:
- `WHERE rt.target_id = c.id AND rt.tag_type = 'category'`

…but in Schema B, there is **no** `target_id` column (and `c.id` is UUID, not TEXT).

**Why this matters:**
- If `0014` is the canonical ingestion schema, `0015` needs to be rewritten to join `resource_tags` using `candidate_id`.
- If `0002` is canonical, `0014` needs refactoring or removal.

---

## Finding 5 — `0015` assumes a `locations.point` geometry column

In `route_candidate_to_admins()` (0015), there is:
- `LEFT JOIN locations l ON l.id = (c.extracted_data->>'location_id')::UUID`
- `l.point AS location_geom`

**Why this matters:**
- This is a hard dependency on a `locations.point` geometry column.
- If your locations model uses a different column name/type (or you don’t persist location per candidate that way), routing can’t work as authored.

**Recommendation:**
- Decide where candidate geometry lives:
  - Option A: persist candidate `address` + geocode to a `candidate_location` geometry column.
  - Option B: reference an existing `locations` row, but then candidates must store that `location_id` in a real column.

---

## Finding 6 — `0015` and `0016` are competing designs, not additive

Both `0015_admin_approval_workflow.sql` and `0016_admin_review_pipeline.sql` define overlapping concepts:
- assignments tables (`admin_assignments` vs `candidate_assignments`)
- capacity (`admin_profiles` + `admin_pending_counts` vs `admin_review_capacity`)
- a `tag_confirmations` table — but with different columns/enums

Because both migrations use `CREATE TABLE IF NOT EXISTS`, whichever migration runs first “wins,” and the other becomes a no-op (leaving missing columns and silent drift).

**Why this matters:**
- This is the kind of drift that’s extremely hard to debug later: the migration logs say “success,” but the schema is incomplete.

**Recommendation:**
- Pick one workflow design (0015-style or 0016-style), and rewrite the other as either:
  - a true extension via `ALTER TABLE ADD COLUMN IF NOT EXISTS ...`, or
  - a separate experimental branch not applied to shared DBs.

---

## Suggested resolution paths (pick one)

### Path 1 — Keep Schema A as SSOT (code-first)
Use this if the ingestion agent is already running/writing data via Drizzle.

- Treat `0002_ingestion_tables.sql` + `src/db/schema.ts` as canonical.
- Rewrite `0014/0015/0016` as **ALTER migrations** that extend Schema A.
- Delete/replace broken SQL in `0015`:
  - remove `extracted_data` references
  - replace `resource_tags.target_id` logic with the actual Schema A model
  - replace `locations.point` dependency with whatever the actual locations schema is

### Path 2 — Make Schema B canonical (SQL-first)
Use this if `0014` is your intended final ingestion architecture.

- Write a new reconciliation migration that:
  - renames tables (`ingestion_sources` → `source_registry`, etc.) or creates compatibility views
  - migrates data from Schema A tables to Schema B tables (including mapping trust levels)
- Update `src/db/schema.ts` and persistence to match Schema B.
- Fix `0015` to join on Schema B `resource_tags(candidate_id)` and replace `extracted_data` usage with real columns.

### Path 3 — Explicit split: “operational now” vs “future aspirational”
If Schema B is intentionally a future design:

- Do not ship/apply `0014–0016` into environments where Schema A-backed code runs.
- Move `0014–0016` into an `/experimental` folder or rename with a clear prefix.
- Add a short doc explaining the split and the exact steps needed before Schema B can go live.

---

## Checklist for authoring future SQL migrations (to prevent drift)

1. **One schema model at a time:** if you change a table’s conceptual model (polymorphic vs FK, JSON vs columns), do it deliberately and migrate data.
2. **Avoid `CREATE TABLE IF NOT EXISTS` for evolving tables:** use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so changes actually apply.
3. **Every function/view must be validated against the tables it references:**
   - Search within the migration for `->>` JSON extraction and ensure that JSON column exists.
   - Search for `table.column` references and ensure those columns exist.
4. **Run migrations from scratch on a blank DB:** a migration that “works” on an already-mutated schema can be broken for new deploys.
5. **Keep the code contract in sync:**
   - If the ingestion agent writes via Drizzle, update `src/db/schema.ts` and any persistence modules at the same time.
6. **Document intentional divergence:** if a migration is “draft,” mark it as such and ensure it won’t be applied automatically.

---

## Suggested next conversation (questions)

If I were you, I’d answer these before changing anything:

- Did you intentionally create **two ingestion schemas** (`0002` and `0014`) or did one supersede the other?
- Should tags be **polymorphic** (`target_id/target_type`) or **relational** (`candidate_id/service_id`)?
- Should evidence payloads live in **blob storage** (preferred) or in Postgres?
- Which admin workflow is real: `0015` (profiles + assignments) or `0016` (capacity + candidate_assignments)?

Once you decide those, the reconciliation is straightforward but needs to be done as an explicit migration + code update, not “parallel migrations that both create tables.”
