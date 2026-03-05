# SQL Audit Findings

Status: **in progress**

This log is the working record produced while following [SQL_AUDIT_PLAYBOOK.md](SQL_AUDIT_PLAYBOOK.md).


## Inventory

- SQL files in scope:
  - `db/migrations/0000_initial_schema.sql`
  - `db/migrations/0001_updated_at_triggers.sql`
  - `db/migrations/0002_audit_fields.sql`
  - `db/migrations/0003_import_staging.sql`
  - `db/migrations/0004_audit_logs.sql`
  - `db/migrations/0005_coverage_zones.sql`
  - `db/migrations/0006_org_members_and_profiles.sql`
  - `db/migrations/0007_schema_optimizations.sql`
  - `db/migrations/0008_rename_assigned_to.sql`
  - `db/migrations/0009_programs_eligibility_documents.sql`
  - `db/migrations/0010_service_areas_languages_accessibility.sql`
  - `db/migrations/0011_contacts_saved_services_evidence.sql`
  - `db/migrations/0012_service_attributes.sql`
  - `db/migrations/0013_comprehensive_coverage.sql`
  - `db/migrations/0014_ingestion_pipeline.sql`
  - `db/migrations/0015_admin_approval_workflow.sql`
  - `db/migrations/0016_admin_review_pipeline.sql`
  - `db/seed/demo.sql`

## Findings index

- Ingestion/admin workflow drift:
  - 0014 ingestion pipeline SQL vs ingestion agent Drizzle schema mismatch (tables/columns): see 0014 notes below.
  - 0015 routing function references non-existent columns; admin workflow tables vs code schema mismatch: see 0015 notes below.
  - 0016 duplicates/conflicts with 0015 workflow schema: see 0016 notes below.

## Migration-by-migration notes

### 0000_initial_schema.sql

- **Schema delta**:
  - Extensions: `postgis`, `uuid-ossp`
  - Functions/triggers:
    - Function `sync_location_geom()`
    - Trigger `trg_sync_location_geom` on `locations` (keeps `geom` in sync with `latitude`/`longitude`)
  - Tables created:
    - `organizations`
    - `locations`
    - `services`
    - `service_at_location`
    - `phones`
    - `addresses`
    - `schedules`
    - `taxonomy_terms`
    - `service_taxonomy`
    - `confidence_scores`
    - `verification_queue`
    - `seeker_feedback`
    - `chat_sessions`
    - `feature_flags` (with seed inserts)
  - Indexes:
    - Full text (GIN/tsvector): `organizations.name`, `services.name`, `services.description`, `taxonomy_terms.term`
    - Spatial (GiST): `locations.geom`
    - Various FK / ordering indexes (see file)

- **Tables (high-level intent + immediate alignment questions)**
  - `organizations`
    - Models the owning org for services/locations.
    - Privacy note: `tax_id` may be sensitive; confirm whether this is ever required in a civic directory.
    - Data-quality question: `tax_status`/`legal_status` are free-form TEXT; likely needs enum/controlled vocab if used for admin workflows.
  - `locations`
    - Models place-based delivery points.
    - `latitude`/`longitude` + `geom(Point,4326)` kept in sync via trigger.
    - Semantics question: if only `geom` is set (via import) but lat/lon are NULL, the trigger won’t backfill lat/lon; confirm intended directionality.
  - `services`
    - Core directory unit.
    - `program_id` exists but has no FK in this migration; confirm when programs are introduced and whether FK should be enforced later.
    - `status` CHECK enum is good; confirm whether “defunct” is distinct from “inactive” for seeker surfaces.
  - `service_at_location`
    - Junction of service ↔ location.
    - Only has `created_at` (no `updated_at`); confirm if edits are expected.
  - `phones`
    - Allows phone numbers to attach to org OR location OR service.
    - Integrity question: all three FK columns are nullable and there is no CHECK requiring at least one owner. This permits “ownerless” phone rows.
  - `addresses`
    - Address per location.
    - Many fields nullable; confirm whether `address_1`, `city`, `region/state_province`, `postal_code` are required for any real flows.
  - `schedules`
    - Schedules can reference service and/or location.
    - Integrity question: both FKs nullable and there is no CHECK requiring at least one parent.
    - Semantics question: fields like `dtstart`, `until`, `wkst`, `days TEXT[]` suggest an iCal-ish model; confirm how it’s produced/consumed.
  - `taxonomy_terms` and `service_taxonomy`
    - Taxonomy term hierarchy + junction to services.
    - Consistency question: `taxonomy` default is `custom`; confirm if external vocabularies exist and how they’re represented.
  - `confidence_scores`
    - Per-service computed scores, all CHECK-bounded to 0–100.
    - Alignment question: `score` vs `verification_confidence` vs `eligibility_match` vs `constraint_fit` must map to seeker/host/admin semantics; confirm which are used for filtering/ranking vs display.
  - `verification_queue`
    - Admin verification workflow queue.
    - Identity question: `submitted_by` and `assigned_to` are TEXT; confirm what identifier format is used (email? Entra object id?) and whether it should be normalized to a users table.
  - `seeker_feedback`
    - Session-based feedback, rating 1–5.
    - Privacy question: `session_id` is UUID, not linked to `chat_sessions.id` here; confirm relationship and retention expectations.
  - `chat_sessions`
    - Captures chat lifecycle; stores `service_ids_shown UUID[]`.
    - Data modeling question: array of service IDs can be convenient but makes analytics/audit harder; confirm expected queries.
  - `feature_flags`
    - Feature flag settings.
    - Seed inserts present; confirm whether flags are environment-scoped and if multi-tenant org scoping is ever expected.

- **Immediate follow-ups to validate later migrations/code/docs**
  - Find where `program_id` is introduced and whether a FK is added.
  - Confirm whether “ownerless” rows are prevented later for `phones`/`schedules`.
  - Confirm privacy posture for `tax_id`, `email`, and any personal identifiers in verification/audit flows.
  - Confirm whether `chat_sessions.service_ids_shown` needs normalization for admin auditability.

### 0001_updated_at_triggers.sql

- **Schema delta**:
  - Function `set_updated_at()` sets `NEW.updated_at := now()`.
  - Idempotently creates triggers (if absent):
    - `trg_set_updated_at_organizations` on `organizations`
    - `trg_set_updated_at_locations` on `locations`
    - `trg_set_updated_at_services` on `services`
    - `trg_set_updated_at_verification_queue` on `verification_queue`
    - `trg_set_updated_at_feature_flags` on `feature_flags`

- **Alignment notes / questions**:
  - Many tables from `0000` do not have `updated_at` at all (`phones`, `addresses`, `schedules`, `service_at_location`, junction tables). If host/admin edits are expected on those, auditability may be limited unless later migrations add audit fields.
  - Trigger existence checks are by trigger name only; if a trigger exists but points at an old function version, this migration won’t correct it. (Probably fine, but worth noting.)

### 0002_audit_fields.sql

- **Schema delta**:
  - Adds `created_at`/`updated_at` to previously missing tables:
    - `phones`, `addresses`, `schedules`, `service_taxonomy`, `confidence_scores`
  - Adds `updated_at` to:
    - `service_at_location`, `taxonomy_terms`, `seeker_feedback`
  - Adds actor columns (`created_by_user_id`, `updated_by_user_id`) to many tables:
    - `organizations`, `locations`, `services`, `service_at_location`, `phones`, `addresses`, `schedules`, `taxonomy_terms`, `service_taxonomy`, `verification_queue`, `seeker_feedback`, `feature_flags`
  - Renames `verification_queue.submitted_by` → `submitted_by_user_id` if present.
  - Adds `set_updated_at()` triggers for newly updated tables:
    - `service_at_location`, `phones`, `addresses`, `schedules`, `taxonomy_terms`, `service_taxonomy`, `confidence_scores`, `seeker_feedback`

- **Alignment notes / questions**:
  - Backfilling behavior: adding `created_at`/`updated_at` with `DEFAULT now()` will assign “migration time” to existing rows. If historical fidelity matters (imports), ensure import pipeline sets explicit timestamps.
  - Actor fields are TEXT and described as pseudonymous IDs (Entra object IDs). Confirm whether:
    - these IDs are ever joined to a user profile table,
    - access controls prevent exposing them to seekers,
    - retention rules exist (esp. if these IDs are considered personal data).
  - Verification queue naming now supports consistent `*_user_id` semantics; check later migrations/code to ensure they use `submitted_by_user_id`.

### 0003_import_staging.sql

- **Schema delta**:
  - Creates import pipeline tables:
    - `import_batches`
    - `staging_organizations`
    - `staging_locations`
    - `staging_services`
  - Adds `set_updated_at()` triggers for all four.

- **Alignment notes / questions**:
  - `import_batches`
    - `batch_key` unique: good for idempotency.
    - `status` enum (`validated|staged|published|rejected`) suggests a multi-phase pipeline; confirm the actual pipeline stages in code/docs.
  - Staging tables include:
    - `import_status` enum (`pending|approved|rejected`) per row, plus `import_diff JSONB`.
    - Optional linkage columns (`organization_id`, `location_id`, `service_id`) but no FK constraints to the published tables.
      - This may be intentional to allow “new record” rows; confirm how “updates” are safely mapped.
  - Sensitive fields (e.g., `tax_id`) exist in staging. Confirm:
    - staging data access is admin-only,
    - staging rows are not returned by seeker endpoints,
    - retention/cleanup policy exists for rejected batches.
  - Locations staging lacks `geom` and the `sync_location_geom` trigger; if staging is later promoted to `locations`, ensure geo normalization happens during publish.
  - Indexes only exist on `import_batch_id` and `import_batches.status`; if UI frequently filters by `import_status`, consider an index later (validate with actual queries first).

### 0004_audit_logs.sql

- **Schema delta**:
  - Creates `audit_logs` append-only table with JSONB `before`/`after` snapshots.
  - Indexes on `created_at DESC`, `(resource_type, resource_id)`, and `actor_user_id`.

- **Alignment notes / questions**:
  - The comment says “Avoid PII” but `before`/`after` are arbitrary JSONB. This only works if the application layer strictly filters/redacts sensitive fields before writing audit rows.
  - `actor_role` is free-form TEXT. If used for compliance reporting, consider constraining to known roles (or storing role IDs) in future migrations.
  - `ip_digest` suggests hashed IP storage; confirm hashing strategy is consistent and not reversible.

### 0005_coverage_zones.sql

- **Schema delta**:
  - Creates `coverage_zones` with PostGIS `GEOMETRY(Polygon, 4326)` and assignment fields.
  - Indexes:
    - `assigned_user_id`, `status`, GiST on `geometry`
  - Adds `updated_at` trigger `trg_set_updated_at_coverage_zones`.

- **Alignment notes / questions**:
  - `geometry` is nullable; if zone-based routing is required, confirm whether NULL is ever valid.
  - Geometry type is `Polygon`; if zones can be disjoint/multi-part, `MultiPolygon` may be a better fit. Verify real zone-management UI expectations first.
  - `assigned_user_id` is a raw Entra object ID (TEXT). Confirm whether reassignment history is required (audit trail beyond `updated_at`).

### 0006_org_members_and_profiles.sql

- **Schema delta**:
  - Creates:
    - `organization_members` (user↔org membership, role/status)
    - `user_profiles` (pseudonymous preferences + role)
  - Adds `updated_at` triggers for both.

- **Alignment notes / questions**:
  - `organization_members.role` is constrained to host-only roles (`host_member|host_admin`), while `user_profiles.role` includes `community_admin` and `oran_admin`.
    - Confirm how admin roles are granted (profile role alone vs separate RBAC tables).
  - `user_id` is stored as Entra object ID (TEXT): confirm consistent format across all tables using `*_user_id`.
  - Privacy posture is explicit and good (no IdP PII). Ensure app code never populates `display_name` from IdP claims without consent.
  - Membership lifecycle:
    - `invited_at` defaults now; `activated_at` optional.
    - Confirm whether “deactivated” is reversible and whether historical membership is needed for audit.

### 0007_schema_optimizations.sql

- **Schema delta**:
  - Adds soft-delete-ish `status` columns with CHECK constraints to:
    - `organizations.status` in (`active|inactive|defunct`)
    - `locations.status` in (`active|inactive|defunct`)
  - Adds indexes:
    - `organizations.status`, `locations.status`
    - Composite indexes for common pages:
      - `verification_queue(status, created_at ASC)` (queue oldest-first)
      - `services(organization_id, status)` (host services)
      - `locations(organization_id, name)` (host locations)
    - Additional FTS indexes:
      - `organizations.description`, `locations.name`
  - Adds `feature_flags.description`.

- **Alignment notes / questions**:
  - “Defunct vs inactive” semantics now exist for orgs and locations too. Confirm how each status affects:
    - seeker search results,
    - host manage views,
    - admin verification/approval workflows.
  - The embedded note about `verification_queue.assigned_to` naming divergence is a useful reminder: if later migrations rename it to `assigned_to_user_id`, the API code must be updated in the same deployment.

### 0008_rename_assigned_to.sql

- **Schema delta**:
  - Renames `verification_queue.assigned_to` → `assigned_to_user_id` (if old exists and new doesn’t).
  - Drops old index `idx_vq_assigned` and creates `idx_vq_assigned_user` on `assigned_to_user_id`.

- **Alignment notes / questions**:
  - Migration `0007_schema_optimizations.sql` contains a note implying renaming `assigned_to` would break a live app, but `0008` performs the rename. Confirm code expectations:
    - If the application still queries `assigned_to`, it will break after applying 0008.
    - If the app was updated in tandem, the note in 0007 is stale and should be treated as historical.
  - Code cross-check: current code consistently uses `assigned_to_user_id` (not `assigned_to`).
    - Evidence (non-exhaustive):
      - [src/app/(community-admin)/queue/page.tsx](src/app/(community-admin)/queue/page.tsx)
      - [src/app/api/community/queue/route.ts](src/app/api/community/queue/route.ts)
      - [src/app/api/community/queue/[id]/route.ts](src/app/api/community/queue/[id]/route.ts)
    - Implication: treat the warning note in 0007 as historical; 0008’s rename matches current implementation.

### 0009_programs_eligibility_documents.sql

- **Schema delta**:
  - Creates HSDS-adjacent tables:
    - `programs` (FKed from `services.program_id`)
    - `eligibility` (structured criteria per service)
    - `required_documents` (documents/proofs per service)
  - Adds FK `services.program_id` → `programs.id` (ON DELETE SET NULL) if missing.
  - Adds updated_at triggers for all three.
  - Indexes:
    - `programs.organization_id` and FTS on `programs.name`
    - `eligibility.service_id` + GIN on `eligibility.eligible_values`
    - `required_documents.service_id`

- **Alignment notes / questions**:
  - `eligibility`
    - No CHECK constraints for `minimum_age <= maximum_age`; consider adding if age ranges are used in queries.
    - `eligible_values TEXT[]` is powerful but can drift; confirm controlled vocabulary and where it’s validated (import/admin UI).
  - `required_documents`
    - `type` is free-form; if used for filtering/scoring, consider CHECK enum later.
    - `uri` may point to forms; confirm link validation and whether external URLs are allowed.
  - `programs`
    - No uniqueness constraint on `(organization_id, name)`; confirm whether duplicates are acceptable.
  - These tables are explicitly tied to scoring semantics; ensure the scoring implementation treats them as “signals” and not eligibility guarantees.

### 0010_service_areas_languages_accessibility.sql

- **Schema delta**:
  - Creates:
    - `service_areas` (service coverage polygons + extent_type)
    - `languages` (service/location language availability)
    - `accessibility_for_disabilities` (location accessibility feature tags)
  - Adds updated_at triggers for all three.
  - Adds integrity constraint:
    - `languages_parent_check` enforces at least one of `service_id` or `location_id`.
  - Indexes:
    - `service_areas`: `service_id`, GiST on `extent`, `extent_type`
    - `languages`: `service_id`, `location_id`, `language`
    - `accessibility_for_disabilities`: `location_id`, `accessibility`

- **Alignment notes / recommended changes**:
  - `service_areas.extent` is `GEOMETRY(Polygon, 4326)` and nullable.
    - Recommendation: consider `MultiPolygon` if real service areas can be disjoint; keep nullable if extent_type = nationwide/state/county via non-polygon representation is planned.
    - Justification: reduces future migration churn if zone shapes are multi-part.
  - `languages.language` is TEXT with a comment “ISO 639-1”.
    - Recommendation: add a CHECK to enforce a sane format (`^[a-z]{2}(-[A-Z]{2})?$` if you want optional region), or validate at write-time in app.
    - Justification: prevents data drift (e.g., “English”, “EN”, “eng”).
  - `accessibility_for_disabilities.accessibility` is free-form TEXT.
    - Recommendation: either constrain to a known enum (CHECK) or create a reference table of allowed tags.
    - Justification: if used for filtering/scoring/matching, uncontrolled text will fragment and degrade recall.

### 0011_contacts_saved_services_evidence.sql

- **Schema delta**:
  - Creates:
    - `contacts` (org/service/location contacts; requires at least one parent)
    - `saved_services` (per-user service bookmarks)
    - `verification_evidence` (evidence metadata for verification queue entries)
  - Adds updated_at trigger for `contacts`.
  - Constraints:
    - `contacts_parent_check`
    - `saved_services` UNIQUE(user_id, service_id)
    - `verification_evidence.evidence_type` CHECK enum
  - Indexes on parent pointers and lookup fields.

- **Alignment notes / recommended changes**:
  - `contacts` is described as “No PII concern” but it stores `name` and `email` of staff.
    - Recommendation: classify this as “public contact info” but still sensitive operationally (spam/abuse). Ensure access rules for host/admin edits are clear, and do not copy these values into telemetry.
    - Justification: still personal data in many jurisdictions even if public-facing.
  - `saved_services.notes` comment says “encrypted at rest in production” but Postgres column is plain TEXT.
    - Recommendation: document the encryption mechanism (app-level encryption + key mgmt) and add a constraint/limit (e.g., max length) to reduce risk.
    - Justification: personal notes can become highly sensitive; schema should prevent unbounded PII accumulation.
  - `verification_evidence.file_url` is a raw URL.
    - Recommendation: store a blob key (container + path) instead of a full URL, or enforce that URL is an expected storage host.
    - Justification: prevents injection of arbitrary third-party URLs and helps with storage migrations and access signing.

### 0012_service_attributes.sql

- **Schema delta**:
  - Creates `service_attributes` as a service↔(taxonomy,tag) tag table.
  - Constraints:
    - UNIQUE(`service_id`, `taxonomy`, `tag`)
  - Indexes:
    - (`taxonomy`, `tag`)
    - (`service_id`)
    - (`tag`)
  - Adds updated_at trigger `trg_set_updated_at_service_attributes`.

- **Alignment notes / recommended changes**:
  - `taxonomy` is free-form TEXT with a comment listing expected values.
    - Recommendation: add CHECK constraint to bound taxonomy to the six declared namespaces.
    - Justification: without it, taxonomy drift breaks deterministic filtering and makes admin QA harder.
  - `tag` is also free-form TEXT, with long “canonical tags” listed only in comments.
    - Recommendation: keep tags flexible (so the system can evolve), but add:
      - either per-taxonomy tag reference tables, or
      - app-layer validation + an admin-controlled registry of allowed tags.
    - Justification: prevents fractured synonyms (e.g., `walkin` vs `walk_in`) that reduce recall.
  - Index note: comment claims “GIN index on the tuple for fast containment checks” but index `idx_service_attributes_tag` is a plain index on `tag`.
    - Recommendation: correct the comment, or implement an actual GIN strategy only if query patterns demand it.
    - Justification: keeps record-keeping accurate and avoids misleading future maintainers.

### 0013_comprehensive_coverage.sql

- **Schema delta**:
  - Alters `eligibility`:
    - Adds `household_size_min INT`, `household_size_max INT`
  - Alters `services`:
    - Adds `estimated_wait_days INT`
    - Adds `capacity_status TEXT DEFAULT 'available'` + CHECK enum (`available|limited|waitlist|closed`)
    - Index `services.capacity_status`
  - Alters `locations`:
    - Adds `transit_access TEXT[]` + GIN index
    - Adds `parking_available TEXT DEFAULT 'unknown'` + CHECK enum (`yes|no|street_only|paid|unknown`)
  - Creates:
    - `service_adaptations` (service-level adaptations; UNIQUE(service_id, adaptation_type, adaptation_tag))
    - `dietary_options` (food-specific dietary options; UNIQUE(service_id, dietary_type))
  - Adds updated_at triggers for both new tables.

- **Alignment notes / recommended changes**:
  - New “canonical tag” values are specified only in comments for several fields (`service_adaptations.*`, `dietary_options.dietary_type`, `locations.transit_access`).
    - Recommendation: decide where canonical vocabularies live (DB constraints vs app validation vs admin registry) and make it explicit.
    - Justification: comments don’t prevent drift and will not keep import/admin UI consistent.
  - `eligibility.household_size_min/max` and earlier age min/max have no cross-field CHECKs.
    - Recommendation: add CHECKs for `min <= max` where both are non-null.
    - Justification: prevents impossible ranges that would mis-score match signals.
  - `services.estimated_wait_days` is nullable with no bounds.
    - Recommendation: consider CHECK `estimated_wait_days >= 0`.
    - Justification: avoids negative values and supports stable sorting/UX.
  - `service_adaptations.adaptation_type` is free-form.
    - Recommendation: add CHECK to bound to the declared namespaces (`disability|health_condition|age_group|learning`).
    - Justification: prevents namespace drift that breaks filtering.

### 0014_ingestion_pipeline.sql

- **Schema delta**:
  - Creates ingestion pipeline tables:
    - `source_registry`
    - `ingestion_jobs`
    - `evidence_snapshots`
    - `extracted_candidates`
    - `resource_tags`
    - `verification_checks`
    - `checklist_items`
    - `verified_service_links`
    - `ingestion_audit_log`
    - `feed_subscriptions`
    - `admin_routing_rules`
  - Triggers (updated_at):
    - `source_registry`, `ingestion_jobs`, `extracted_candidates`, `checklist_items`, `verified_service_links`, `feed_subscriptions`, `admin_routing_rules`
  - Key constraints/invariants:
    - `extracted_candidates.extract_key_sha256` UNIQUE
    - `extracted_candidates.confidence_score` CHECK 0–100
    - `extracted_candidates.confidence_tier` GENERATED from score
    - `resource_tags_parent_check` ensures candidate_id OR service_id
    - `resource_tags_unique_candidate` and `_service` uniqueness per (parent, type, value)
    - `verification_checks.check_type`, `severity`, `status` CHECK enums
    - `checklist_items.item_key`, `status` CHECK enums + UNIQUE(candidate_id, item_key)
    - `verified_links_parent_check` ensures candidate_id OR service_id
    - `ingestion_audit_log.event_type`, `actor_type`, `target_type` CHECK enums
    - `admin_routing_rules` UNIQUE(jurisdiction_country, jurisdiction_state, jurisdiction_county)
  - Notable indexes:
    - Many operational indexes on status, jurisdiction, assignment, timestamps.
    - GIN index on `source_registry.domain_rules` (JSONB).
  - Bootstrap data inserts:
    - Default `source_registry` entries for `.gov`, `.edu`, `.mil`
    - Default `admin_routing_rules` catch-all for ORAN admin

- **Alignment notes / recommended changes**:
 **Alignment notes / recommended changes**:
  - **Schema ↔ code mismatch (high priority)**
    - The ingestion agent persistence layer and Drizzle schema expect different table/column names than this migration creates.
      - Code evidence:
        - Drizzle ingestion schema: [src/db/schema.ts](src/db/schema.ts)
        - Ingestion persistence uses those tables/columns:
          - Evidence: [src/agents/ingestion/persistence/evidenceStore.ts](src/agents/ingestion/persistence/evidenceStore.ts)
          - Candidates: [src/agents/ingestion/persistence/candidateStore.ts](src/agents/ingestion/persistence/candidateStore.ts)
    - Key mismatches (examples that would break runtime if DB is created from 0014 as-is):
      - Source registry table name:
        - SQL: `source_registry`
        - Code: `ingestion_sources`
      - Evidence snapshots identity & storage fields:
        - SQL: `evidence_snapshots.id` (UUID PK) and `blob_uri`/`blob_container`
        - Code: `evidence_snapshots.evidence_id` (TEXT unique) and `blob_storage_key` + optional `html_raw`/`text_extracted`
      - Extracted candidates identifiers + shape:
        - SQL: `extracted_candidates.id` UUID PK, `primary_evidence_id UUID`, `address JSONB`, `emails JSONB`, `provenance JSONB`, `discovered_links JSONB`
        - Code: `extracted_candidates.candidate_id` (TEXT unique) + `extraction_id` (TEXT unique) + `primary_evidence_id` (TEXT), plus flattened `address_*` fields and `verification_checklist`/`investigation_pack`/`provenance_records` JSONB.
      - Tags schema:
        - SQL: `resource_tags` uses `(candidate_id UUID, service_id UUID)` parents
        - Code: `resource_tags` uses `(target_id TEXT, target_type TEXT)` parents
      - Audit/events schema:
        - SQL: `ingestion_audit_log` (target_type/event_type enums; payload JSONB)
        - Code: `ingestion_audit_events` with `candidate_id TEXT`, `event_type TEXT`, `actor_type TEXT`, `details JSONB`
      - Discovered links:
        - SQL: no `discovered_links` table (links are represented as `verified_service_links` + JSON arrays)
        - Code: expects a `discovered_links` table keyed by `evidence_id`.
    - Recommended change: choose a canonical ingestion schema and align either SQL→code or code→SQL.
      - If the ingestion agent (TypeScript) is the SSOT, add a new migration to rename/reshape tables created by 0014 to match [src/db/schema.ts](src/db/schema.ts).
      - If SQL is the SSOT, refactor [src/db/schema.ts](src/db/schema.ts) + persistence stores to match 0014’s table/column names and JSON shapes.
    - Justification: as written, 0014/0015/0016 cannot all be true simultaneously; leaving this drift means the ingestion agent cannot safely persist/operate against a migrated DB.
  - **PII & privacy**
    - `extracted_candidates` stores `phones JSONB`, `emails JSONB`, `address JSONB`.
      - Recommendation: explicitly classify these as “service contact info” (not seeker PII) but still sensitive operationally; ensure access is admin/host-only until published.
      - Justification: these fields can contain personal/staff identifiers and should not leak to telemetry or unauthorized roles.
    - `ingestion_audit_log.inputs/outputs` are arbitrary JSONB.
      - Recommendation: define a redaction contract for audit writes (e.g., never store raw page text, never store credentials/tokens, limit email/phone exposure).
      - Justification: append-only logs become permanent liability if they store sensitive payloads.
  - **Data integrity**
    - `extracted_candidates.description` is NOT NULL, but extracted text may be missing or low quality.
      - Recommendation: consider allowing NULL + using checklist_items to represent missingness, or enforce non-empty string via CHECK.
      - Justification: avoids placeholder garbage and keeps “missingness” explicit and measurable.
    - `evidence_snapshots` is “immutable” by comment but has no guard against UPDATE.
      - Recommendation: consider a trigger to prevent updates/deletes (or enforce immutability in app with strict RBAC + code discipline).
      - Justification: provenance chain is only trustworthy if snapshots can’t be mutated silently.
  - **URL / blob fields**
    - Several tables store `blob_uri`, `file_url`, and `url` fields.
      - Recommendation: prefer storage keys + signed access rather than permanent URLs; if keeping URLs, validate scheme/host.
      - Justification: mitigates arbitrary URL injection and simplifies storage migration.
  - **Domain rules JSONB**
    - `source_registry.domain_rules` is JSONB with a GIN index.
      - Recommendation: confirm query patterns (containment vs full scan). If queries are frequent and structured, consider normalizing to rows (`source_registry_domain_rules`).
      - Justification: keeps enforcement logic reliable and avoids brittle JSON querying.
  - **Jurisdiction routing**
    - `admin_routing_rules` uniqueness on (country,state,county) prevents multiple active rules per jurisdiction.
      - Recommendation: if priority-based overrides are expected, uniqueness may need to include `is_active` or be removed in favor of a partial unique index.
      - Justification: real-world routing often needs overrides (temporary coverage) without deleting old rules.

### 0015_admin_approval_workflow.sql

- **Schema delta**:
  - Creates admin workflow tables:
    - `admin_profiles` (capacity + geo routing point)
    - `admin_assignments` (candidate→admin assignments + decisions)
    - `tag_confirmations` (human approval queue for low-confidence tags)
    - `llm_suggestions` (human review queue for LLM-suggested missing fields)
    - `publish_thresholds` (configurable readiness thresholds; includes a default insert)
  - Creates views:
    - `admin_pending_counts`
    - `candidate_publish_readiness`
  - Creates functions (plpgsql):
    - `find_closest_admins_with_capacity(...)`
    - `route_candidate_to_admins(p_candidate_id, p_target_count)`
    - `candidate_meets_publish_threshold(p_candidate_id)`
  - Triggers (updated_at):
    - `admin_profiles`, `admin_assignments`, `tag_confirmations`, `llm_suggestions`, `publish_thresholds`
  - Alters constraints on `ingestion_audit_log`:
    - Replaces `event_type` CHECK with an expanded list
    - Replaces `target_type` CHECK with an expanded list

- **Alignment findings (high priority)**:
 **Alignment findings (high priority)**:
  - **Schema/function drift: references to non-existent columns**
    - `route_candidate_to_admins` references:
      - `extracted_candidates.extracted_data` (does not exist in 0014 schema; 0014 uses explicit columns like `address`, `phones`, `emails`, etc.)
      - `locations l.point` (locations table uses `geom`, not `point`)
      - `resource_tags rt WHERE rt.target_id = c.id` (resource_tags schema uses `candidate_id` and `service_id`, not `target_id`)
    - Recommended change: update the function implementation to match the actual 0014 schema (or add the missing columns if they truly exist and are needed).
    - Justification: as written, this migration will fail at CREATE FUNCTION time or at runtime, blocking deployments and breaking admin routing.

  - **Schema ↔ code mismatch (high priority)**
    - The ingestion agent domain models align more closely with 0015’s *intent* (admin profiles, assignments, tag confirmations, LLM suggestions, thresholds), but the concrete SQL column naming diverges from currently implemented Drizzle tables.
      - Code evidence:
        - Admin workflow domain types:
          - [src/agents/ingestion/adminProfiles.ts](src/agents/ingestion/adminProfiles.ts)
          - [src/agents/ingestion/adminAssignments.ts](src/agents/ingestion/adminAssignments.ts)
          - [src/agents/ingestion/tagConfirmations.ts](src/agents/ingestion/tagConfirmations.ts)
          - [src/agents/ingestion/llmSuggestions.ts](src/agents/ingestion/llmSuggestions.ts)
        - Current Drizzle table definition for `llm_suggestions`:
          - [src/db/schema.ts](src/db/schema.ts)
      - Example mismatch:
        - SQL (0015): `llm_suggestions` uses columns like `field_name`, `llm_confidence`, `suggestion_status`, `prompt_context`, `source_evidence_refs`.
        - Code (Drizzle): `llm_suggestions` is defined with columns like `field`, `confidence`, `status`, `reasoning`, `original_value`.
      - Recommended change: once a canonical ingestion schema is chosen, update Drizzle schema + persistence (or SQL) so that:
        - table/column names match,
        - enum value sets match (status/field names),
        - any routing/publish views/functions are consistent with how candidates/tags are actually stored.
      - Justification: admin approval workflow cannot be implemented safely if the “queue tables” don’t match the domain contracts.

- **Other alignment notes / recommended changes**:
  - `admin_profiles.email` is stored.
    - Recommendation: confirm this is necessary (it is IdP-linked PII). If it’s required for admin ops, classify it, restrict access, and avoid logging it.
    - Justification: aligns with privacy-first posture elsewhere.
  - `publish_thresholds.required_checklist_items` is an array of keys.
    - Recommendation: ensure keys correspond exactly to `checklist_items.item_key` allowed values; consider a FK-like enforcement strategy (hard in SQL) or validate in app.
    - Justification: prevents configuration drift causing false publish readiness.
  - `candidate_publish_readiness` counts “confirmed” tags only, not “modified” or “auto_approved”.
    - Recommendation: confirm intended semantics; if “auto_approved” should count as confirmed, adjust the view.
    - Justification: avoids deadlocks where high-confidence tags never satisfy thresholds.

### 0016_admin_review_pipeline.sql

- **Schema delta**:
  - Creates additional admin review pipeline tables:
    - `admin_review_capacity`
    - `candidate_assignments`
    - `tag_confirmations` (again; `CREATE TABLE IF NOT EXISTS`)
    - `field_suggestions`
    - `field_provenance`
    - `publish_readiness`
    - `review_actions`
  - Creates views:
    - `v_available_admins`
    - `v_candidates_ready`
    - `v_pending_tags_by_color`
    - `v_candidate_dashboard`
  - Creates functions:
    - `find_nearest_admins(...)`
    - `assign_candidate_to_admins(...)`
    - `compute_publish_readiness(p_candidate_id)`
  - Triggers (updated_at):
    - `admin_review_capacity`, `tag_confirmations`, `field_suggestions`, `publish_readiness`

- **Alignment findings (high priority)**:
  - **Duplicate / conflicting workflow schemas vs 0015**
    - 0015 already introduced admin workflow tables and views (`admin_profiles`, `admin_assignments`, `tag_confirmations`, `llm_suggestions`, `publish_thresholds`, etc.).
    - 0016 introduces a parallel set (`admin_review_capacity`, `candidate_assignments`, `field_suggestions`, `publish_readiness`) and also attempts to create `tag_confirmations` again with a *different* shape.
    - Because `CREATE TABLE IF NOT EXISTS` will no-op if the table exists, 0016’s views/functions may not match the actual existing table definitions.
    - Recommended change: pick ONE workflow schema and remove/merge the other.
      - Option A: keep 0015 as canonical; refactor or delete 0016.
      - Option B: keep 0016 as canonical; refactor or delete 0015.
    - Justification: two competing pipelines will inevitably break at runtime and make “meticulous alignment” impossible.

  - **Views/functions assume specific `tag_confirmations` columns**
    - 0016’s `v_pending_tags_by_color` assumes `confidence_color` and `status` columns.
    - 0015’s `tag_confirmations` uses different naming (`confidence_tier`, `confirmation_status`, `suggested_confidence`, etc.).
    - Recommended change: unify column names and statuses across migrations, then update all dependent views/functions.
    - Justification: prevents silent miscounts (publish readiness wrong) and broken dashboards.

  - **Routing functions update capacity counts unsafely**
    - `assign_candidate_to_admins` increments `admin_review_capacity.pending_count` even if the INSERT did nothing due to conflict.
    - Recommended change: increment only when the assignment row was inserted (e.g., via `GET DIAGNOSTICS row_count`, or update with a join on inserted rows).
    - Justification: prevents capacity counters drifting upward and blocking future assignments.

- **Other recommended changes**:
  - `field_provenance.extracted_text` stores raw extracted text.
    - Recommendation: define retention/size limits, and ensure it never stores full page dumps.
    - Justification: provenance is valuable, but raw text can become sensitive and high-volume.
  - `publish_readiness` duplicates confidence tier logic from 0014 (`confidence_score` → tier).
    - Recommendation: ensure a single source of truth for tier thresholds.
    - Justification: prevents “green” meaning different things in different parts of the pipeline.

### seed/demo.sql

- **Type**: DML seed data (explicitly fictional).

- **Data inserted / touched tables**:
  - `taxonomy_terms`
  - `organizations`, `locations`, `addresses`, `phones`, `services`, `service_at_location`, `service_taxonomy`, `schedules`
  - `confidence_scores`
  - `coverage_zones`
  - `organization_members`, `user_profiles`
  - `programs`, `eligibility`, `required_documents`
  - `service_areas`, `languages`, `accessibility_for_disabilities`
  - `contacts`, `saved_services`
  - `service_attributes`, `service_adaptations`, `dietary_options`
  - Updates to:
    - `services` (`estimated_wait_days`, `capacity_status`)
    - `locations` (`transit_access`, `parking_available`)
    - `eligibility` (`household_size_min/max`)

- **Alignment notes / recommended changes**:
  - The “DEMO ONLY / FICTIONAL” disclaimer and use of `555-` numbers is excellent and aligns with “no hallucinated facts.”
  - Seed references migrations through 0013 (capacity/transit/household size), which is good coverage.
  - Recommendation: add a short guard comment at top describing intended environments (dev only) and the order of migrations required.
    - Justification: prevents accidental execution against partially migrated databases.
  - Recommendation: if future migrations add strict CHECK constraints (e.g., bounded taxonomy namespaces), ensure seed stays compliant.
    - Justification: seed is part of developer workflow; it should be an early warning for drift.
