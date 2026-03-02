# SQL Audit Playbook (Prompt + Record-Keeping)

This document is a **self-audit prompt** for reviewing every `.sql` file in this repository (migrations + seed) to ensure:

- Tables/columns represent **real data** for **real use-cases** (Seeker, Host, Admin).
- Field names, types, constraints, and relationships are **internally consistent**.
- DB structure aligns with **application behavior**, API contracts, and docs SSOT.
- Record keeping is meticulous: every finding is written down with evidence and an outcome.

## Non‑negotiables (from repo operating rules)

- **Retrieval-first**: user-facing discovery/search should rely on stored records and deterministic logic.
- **No hallucinated facts**: do not infer real-world provider facts from schema; validate using only repo artifacts (SQL, code, docs).
- **Eligibility caution**: schema should not imply eligibility guarantees; model “signals” and “claims” carefully.
- **Privacy-first**: treat any personal/contact fields as sensitive. Default to minimizing storage and access.
- **Security**: avoid designing/accepting patterns that would leak PII to logs/telemetry.

## Scope

Included:
- `db/migrations/**/*.sql`
- `db/seed/**/*.sql`

Excluded (but cross-check for usage):
- SQL embedded in TypeScript and query builders (reviewed during cross-check phase).

## Output artifacts (what you must produce while auditing)

1) **Schema inventory** (tables, columns, constraints, indexes, triggers)
2) **Use-case mapping** (Seeker / Host / Admin CRUD + read patterns)
3) **Alignment notes** (code/docs references; any drift)
4) **Risk log** (privacy/security/data quality risks)
5) **Decision log** (what changed vs what stayed; follow-ups)

Recommended file for findings (create/update as you go):
- `docs/SQL_AUDIT_FINDINGS.md`

If changes affect contracts or behavior (DB schema → API/contracts), append a short UTC entry to:
- `docs/ENGINEERING_LOG.md`

## Working definition: “Align to real data”

A table/column “aligns to real data” if:

- There is a **clear producer** (import pipeline, admin entry, host claim/verification) and a **clear consumer** (search, directory, admin workflows, chat summarization).
- The field has a **meaningful domain definition** (what it represents, permissible values, nullability rationale).
- Constraints match reality (e.g., “unknown” vs NULL vs empty string; time zones; multi-lingual values).
- It does not encode speculative/LLM-only data as authoritative without provenance.

## Audit procedure (follow this exactly)

### Phase 0 — Inventory

For each SQL file:
- Record path + purpose (migration number + summary).
- Identify whether it is DDL (schema), DML (seed), or both.
- Note dependencies: extensions (PostGIS), triggers, functions.

### Phase 1 — Extract the schema delta

From the SQL file, extract and list:
- Tables created/altered/dropped
- Columns added/changed (type/nullability/default)
- Constraints (PK, FK, UNIQUE, CHECK)
- Indexes (BTREE/GiST/Gin, partial indexes)
- Triggers/functions

**Rule:** Don’t rely on memory. Copy exact identifiers into the inventory.

### Phase 2 — Table-by-table semantic audit

For each touched table, fill this template.

#### Table audit template

- **Table**: `<schema>.<table>`
- **Purpose**: What real-world concept it models (1–2 sentences).
- **Primary user(s)**:
  - Seeker: Yes/No (how?)
  - Host: Yes/No (how?)
  - Admin: Yes/No (how?)
- **Producers**: What writes rows? (import job / admin UI / host workflow / automation)
- **Consumers**: What reads rows? (search / directory / approvals / audit / chat summaries)
- **Lifecycle**:
  - Created when…
  - Updated when…
  - Soft-deleted? Archived? Versioned?
- **Cardinality/scale expectations**: rows per org/service; expected growth.
- **Privacy class**: Public / Sensitive / Highly sensitive (and why).

##### Columns

Create a mini row for each column (especially new/changed):

- `<column>`
  - **Type**: `...`
  - **Nullability**: nullable / not null (why?)
  - **Default**: `...` (why?)
  - **Meaning**: domain definition
  - **Source of truth**: who/what sets it?
  - **Validation**: what constraints ensure correctness?
  - **Used by**: seeker/host/admin + which feature
  - **Risk**: privacy/security/data quality (if any)

##### Constraints & indexes

- **PK/FK**: Are relationships correct and required? Any orphan risks?
- **UNIQUE**: Does it match real uniqueness?
- **CHECK**: Are enums/score ranges properly bounded?
- **Indexes**:
  - Does each index match a real query pattern?
  - Any missing index for common filters/order-by?
  - Any redundant index?

### Phase 3 — Cross-file consistency checks

Across *all* migrations:
- Naming consistency: `snake_case`, `*_id` conventions, timestamps, status enums.
- Timestamp consistency: `created_at`, `updated_at` triggers, time zone usage.
- Geography consistency: location fields (lat/lon/geometry), SRID, coverage areas.
- Confidence/score consistency: ranges (0–100), semantic meaning, column names.
- Evidence/provenance consistency: any “verified” fields should have a linked evidence trail.

### Phase 4 — Cross-check against code and docs (alignment)

For each table/column:
- Find where it’s referenced in the app:
  - SQL queries in `src/app/api/**`
  - Search logic in `src/services/search/**`
  - Scoring logic in `src/services/scoring/**`
  - Admin workflows in `src/app/(oran-admin)/**` and services
- Cross-check docs:
  - `docs/DATA_MODEL.md`
  - `docs/IMPORT_PIPELINE.md`
  - `docs/CHAT_ARCHITECTURE.md`
  - `docs/SECURITY_PRIVACY.md`
  - Any ADRs in `docs/DECISIONS/**`

Record any drift:
- Column exists in DB but unused in code/docs
- Code expects column that doesn’t exist
- Docs define semantics that don’t match constraints/types

### Phase 5 — Risk review (must do)

For each table, ask:
- Does it store PII? If yes, is it necessary? Is access controlled?
- Are there audit logs for admin actions on sensitive records?
- Are we logging any sensitive values in app code/telemetry?
- Are there obvious foot-guns (e.g., free-form status strings, ambiguous null semantics)?

### Phase 6 — Findings + actions

Every issue must be categorized and resolved to a disposition:

- **OK**: aligned; no changes.
- **Fix now**: safe, small change (schema/constraints/index/doc).
- **Needs decision**: requires product/security decision; create ADR if architectural.
- **Remove**: unused / incorrect / hazardous.

Each finding must include:
- What’s wrong
- Why it matters (use-case impact)
- Evidence (file + object names; code usage)
- Proposed remediation
- Owner + next step

## Quality bar

- No “hand-wavy” semantics: every important column has a purpose, producer, and consumer.
- No silent range mismatches (scores/confidence/bands).
- No admin workflow fields without auditability.
- No seeker-facing data without provenance and privacy classification.

## Quick prompts to use while reading a migration

- “What real user story requires this column?”
- “Who writes it and when?”
- “Who reads it and how does it affect search/ranking/display?”
- “If it’s NULL, what does that mean?”
- “If it’s wrong, how do we detect and correct it?”
- “Is this a claim, an observation, or a verified fact?”
