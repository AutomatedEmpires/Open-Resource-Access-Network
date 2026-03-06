<!-- markdownlint-disable MD013 -->

# ORAN HSDS / 211 Concrete Integration Plan

Status: Phase 1 implemented
Date: 2026-03-06
Updated: 2026-03-07 — Phase 1 source assertion layer code complete
Depends on: `hsds_211_unify.md`

## Purpose

This document turns the HSDS / 211 unification memo into an implementation plan tied to ORAN's current codebase.

It answers two questions:

1. How do we implement HSDS / 211 federation inside ORAN without breaking the current ingestion and trust pipeline?
2. What do we concretely know today about where HSDS / 211 data may come from, and what still needs source discovery or partner confirmation?

## Short Answer

### Implementation

We will not replace ORAN's current ingestion pipeline. We will extend it with:

- source assertion persistence
- canonical federation tables
- external identifiers
- taxonomy registry and crosswalks
- entity resolution / clustering
- HSDS profile export and API publication

### Sources

We do **not** yet have a fully confirmed production source list for nationwide HSDS / 211 ingestion.

What is confirmed today:

- the HSDS standard reference and canonical OpenAPI definition are public
- a public 211 developer portal exists at `https://apiportal.211.org/`
- a Connect211 HSDS profile repository exists
- public-sector human-services datasets exist on government catalogs such as Data.gov
- ORAN already has an allowlisted source-registry model that can safely absorb both feeds and scrape targets

What is **not** confirmed yet:

- which 211 APIs are anonymously consumable versus partner-gated
- which live HSDS publisher endpoints are stable and suitable for ingestion at scale
- which licensed AIRS / 211 taxonomy assets ORAN may store and republish

That means the technical integration path is clear, but the production source inventory still needs a structured discovery and onboarding pass.

## Decision Lock

The following architecture decisions are confirmed and should drive implementation order.

### 1. ORAN owns trust, HSDS owns exchange shape

- ORAN remains the operational system of record for trust, verification, scoring, moderation, provenance, and publish state.
- HSDS is the normalized interoperability contract for ingest/export and ecosystem compatibility.

### 2. Support both base HSDS compatibility and an ORAN HSDS Profile

- Base HSDS compatibility is required for clean import/export and ecosystem tool usage.
- The ORAN HSDS Profile is also required now so ORAN-specific trust and provenance metadata remain explicit and standards-coherent.

### 3. Taxonomy is mediated through ORAN canonical concepts

The normalization chain is:

`HSDS / 211 taxonomy or other external taxonomy -> ORAN canonical concept -> ORAN tags and scoring signals`

That means:

- ORAN tags and confidence scoring remain authoritative for ORAN behavior.
- External taxonomy remains preserved for interoperability and round-trip export.
- Export to HSDS is generated from canonical concepts and preserved external mappings.

### 4. Every intake path uses the same source assertion model first

This applies to:

- direct HSDS feeds
- 211 partner feeds
- structured public-sector datasets
- allowlisted scrape ingestion
- user/admin submitted resources

No intake path may bypass the assertion layer and write directly to canonical or live records.

### 5. Round-trip fidelity is a first-class requirement

- Preserve source identifiers, taxonomy references, field lineage, and profile hints wherever licensing permits.
- Design imports so ORAN can export coherent HSDS-compatible records later without losing essential source context.
- Maintain compatibility with HSDS-oriented debugging/validation tools as a product requirement, not a documentation afterthought.

## Current ORAN Integration Points

These are the current places in ORAN where HSDS / 211 federation should attach.

### Existing ingestion pipeline

Current files and contracts:

- `docs/agents/AGENTS_INGESTION_PIPELINE.md`
- `docs/agents/AGENTS_SOURCE_REGISTRY.md`
- `src/agents/ingestion/contracts.ts`
- `src/agents/ingestion/sourceRegistry.ts`
- `src/agents/ingestion/publish.ts`
- `db/migrations/0002_ingestion_tables.sql`
- `src/db/schema.ts`

These already provide:

- source allowlist / quarantine behavior
- evidence snapshots
- extracted candidates
- jurisdiction hints
- confidence tiers
- publish-readiness checks

### Existing merge and trust workflow

Current files and contracts:

- `src/services/merge/service.ts`
- `src/services/regression/detector.ts`
- `docs/SCORING_MODEL.md`

These already provide:

- merge mechanics for organizations and services
- trust regression detection
- deterministic scoring constraints

### Existing import path

Current files and contracts:

- `db/import/hsds-csv-importer.ts`
- `docs/solutions/IMPORT_PIPELINE.md`
- `db/migrations/0003_import_staging.sql`

This already gives ORAN a batch-oriented import/staging path that can be reused for structured feeds.

## Confirmed Source Facts As Of Today

This section separates standards references from actual ingestible sources.

### A. Confirmed standards and schema references

These are not production data feeds, but they are the canonical interoperability contracts ORAN should code against.

- HSDS overview:
  - `https://docs.openreferral.org/en/latest/hsds/overview.html`
- HSDS schema reference:
  - `https://docs.openreferral.org/en/latest/hsds/schema_reference.html`
- HSDS API reference:
  - `https://docs.openreferral.org/en/latest/hsds/api_reference.html`
- Canonical HSDS OpenAPI definition:
  - `https://raw.githubusercontent.com/openreferral/specification/3.2/schema/openapi.json`

Important note:

- this OpenAPI file is a **contract reference**, not a live public publisher API endpoint

### B. Confirmed ecosystem implementation signals

- Open Referral specification repo exists
- Open Referral ServiceNet repo exists
- Connect211 HSDS profile repo exists: `211-Connect/hsds_profile_connect211`
- Connect211 image-to-HSDS repo exists: `211-Connect/image-to-hsds`

Important note:

- these repositories prove ecosystem activity and implementation patterns
- they do **not** automatically give ORAN a production data feed

### C. Confirmed public 211 developer portal signal

Confirmed public URL:

- `https://apiportal.211.org/`

Observed today:

- the portal is public and reachable
- it advertises an APIs section
- the simple anonymous HTML response does not expose a concrete API catalog in an immediately machine-readable form

Working assumption:

- the 211 API ecosystem likely exists, but access details may be partially gated by auth, subscription, or partner approval

Operational conclusion:

- ORAN should treat `apiportal.211.org` as a discovery lead, not yet as a fully confirmed ingest source

### D. Confirmed public-sector dataset channel

Confirmed discovery channel:

- `https://catalog.data.gov/api/3/action/package_search`

Observed today:

- public-sector human-services-adjacent datasets exist
- they are not consistently branded as HSDS
- they are likely to arrive as CSV, ArcGIS, JSON, XML, or portal-managed APIs rather than HSDS-native feeds

Example dataset lead found today:

- `Mental Health Treatement Facilities Locator`
  - organization: U.S. Department of Health & Human Services

Operational conclusion:

- Data.gov and similar public catalogs are valid source-discovery channels for ORAN
- most such sources will need normalization into ORAN canonical objects rather than direct HSDS ingestion

### E. Confirmed ORAN scrape/fetch channel

ORAN already supports:

- allowlisted and quarantined source rules
- evidence snapshots
- seeded discovery
- within-host expansion under registry control

Operational conclusion:

- if a source is not available as an HSDS or partner feed, ORAN can still ingest it through the existing source-registry and evidence pipeline

## Source Status Matrix

This is the current truth state.

| Source family | Status today | How ORAN would ingest it | Notes |
| --- | --- | --- | --- |
| Open Referral HSDS schema / API reference | Confirmed | Contract reference only | Not a live publisher feed |
| Live public HSDS publishers | Partially unconfirmed | Connector or import once discovered | Needs active source inventory work |
| 211 API portal | Confirmed portal, unconfirmed feed details | Partner/API connector | Likely requires auth or onboarding |
| Connect211 profile / tools repos | Confirmed | Pattern library, profile reference | Not a feed by itself |
| Data.gov human-services datasets | Confirmed | Structured feed connectors | Usually non-HSDS normalization required |
| Official `.gov` / `.edu` directories | Confirmed channel | Existing ORAN allowlisted scrape pipeline | Best fallback when no feed exists |
| Licensed AIRS / 211 exports | Unconfirmed for ORAN | Partner import connector | Requires legal / commercial confirmation |

## What We Need To Discover Next

This is the explicit source-discovery backlog.

### Discovery task 1: Live HSDS publisher inventory

We need a maintained inventory of real publisher endpoints, not just the spec.

Target fields:

- publisher name
- endpoint base URL
- `GET /` availability
- `GET /services` availability
- profile URI
- auth required or not
- pagination behavior
- rate limits
- geography covered
- freshness cadence
- license / reuse terms

### Discovery task 2: 211 ecosystem access model

We need to determine:

- whether `apiportal.211.org` supports anonymous API exploration
- which APIs are public versus subscriber-only
- whether data export is available directly or only through vendor agreements
- what rate limits, auth mechanisms, and terms apply

### Discovery task 3: AIRS / 211 taxonomy rights

We need to confirm:

- whether ORAN can ingest raw taxonomy codes
- whether ORAN can store the full term definitions
- whether ORAN can republish those codes publicly
- whether only internal crosswalk use is permitted

### Discovery task 4: government and partner source inventory

We need to prioritize target sources by value and quality:

- federal directories
- statewide resource directories
- municipal human-services indexes
- campus basic-needs and community assistance directories
- partner exports from nonprofits and coalitions

## Concrete Integration Architecture

This is the implementation plan tied to ORAN's current system.

## Canonical Intake Rule

The phrase "source assertion model" is the logical rule for the system.

- The first implementation may realize that model as `source_records` plus `source_record_fields`.
- Scrape evidence, structured feed records, and user-submitted resources all become assertions before normalization.
- Existing ORAN extracted candidates and manual submissions should be adapted to produce assertions rather than bypass them.

## Phase 1: Source Assertion Foundation

### Phase 1 goal

Persist all inbound source records as auditable assertions before they become candidates or canonical records.

### Why this comes first

Without source assertions ORAN cannot safely:

- preserve provenance
- compare conflicting sources
- support re-ingest and replay
- justify canonical merge decisions

### Phase 1 tables

Add a migration introducing:

- `source_systems`
  - one row per source family or publisher
- `source_feeds`
  - one row per feed or endpoint
- `source_records`
  - immutable record payloads from a source
- `source_record_fields`
  - optional flattened field assertions for diffing and provenance

### Phase 1 required columns

`source_systems`

- `id`
- `name`
- `family` (`hsds_api`, `hsds_tabular`, `partner_api`, `partner_export`, `government_open_data`, `allowlisted_scrape`, `manual`)
- `homepage_url`
- `license_notes`
- `terms_url`
- `trust_tier`
- `active`

`source_feeds`

- `id`
- `source_system_id`
- `feed_name`
- `feed_type` (`api`, `csv`, `json`, `jsonl`, `xml`, `arcgis`, `scrape_seed`)
- `base_url`
- `healthcheck_url`
- `auth_type`
- `profile_uri`
- `jurisdiction_scope`
- `refresh_interval_hours`
- `last_seen_at`
- `active`

`source_records`

- `id`
- `source_feed_id`
- `source_record_type` (`organization`, `service`, `location`, `taxonomy`, `taxonomy_term`, `mixed_bundle`)
- `source_record_id`
- `source_version`
- `fetched_at`
- `canonical_source_url`
- `payload_sha256`
- `raw_payload`
- `parsed_payload`
- `evidence_id`
- `correlation_id`
- unique constraint on (`source_feed_id`, `source_record_type`, `source_record_id`, `payload_sha256`)

### Phase 1 code touchpoints

- extend `src/agents/ingestion/contracts.ts`
- extend `src/db/schema.ts`
- add persistence under `src/agents/ingestion/persistence/**`

### Phase 1 implementation status — COMPLETE

Delivered:

- **Migration**: `db/migrations/0032_source_assertion_layer.sql` — 7 tables (`source_systems`, `source_feeds`, `source_records`, `source_record_taxonomy`, `entity_identifiers`, `hsds_export_snapshots`, `lifecycle_events`) plus data migration from `ingestion_sources` → `source_systems` with trust-tier mapping, default feeds per system, FK backfill on `ingestion_jobs`.
- **Drizzle schema**: `src/db/schema.ts` extended with all 7 table definitions, type exports, and relation declarations. `sourceSystemId` FK added to `ingestionJobs`.
- **Contracts**: `src/agents/ingestion/contracts.ts` expanded with `SourceSystemFamilySchema`, `TrustTierSchema`, and 5 new `SourceKindSchema` values (`hsds_api`, `hsds_tabular`, `partner_api`, `partner_export`, `government_open_data`).
- **Store interfaces**: `src/agents/ingestion/stores.ts` extended with `SourceSystemStore`, `SourceFeedStore`, `SourceRecordStore`, `EntityIdentifierStore`, `HsdsExportSnapshotStore`, `LifecycleEventStore` interfaces and added to `IngestionStores` composite.
- **Persistence implementations**: 6 new Drizzle store files under `src/agents/ingestion/persistence/` (`sourceSystemStore.ts`, `sourceFeedStore.ts`, `sourceRecordStore.ts`, `entityIdentifierStore.ts`, `hsdsExportSnapshotStore.ts`, `lifecycleEventStore.ts`).
- **Factory + exports**: `storeFactory.ts` and `persistence/index.ts` updated to compose and export all new stores.

## Phase 2: Canonical Federation Layer

### Phase 2 goal

Normalize source assertions into a canonical model that can publish to HSDS and feed ORAN live tables.

### Phase 2 tables

- `canonical_organizations`
- `canonical_services`
- `canonical_locations`
- `canonical_service_locations`
- `canonical_identifiers`
- `canonical_provenance`

### Phase 2 required columns

Each canonical entity should include:

- ORAN UUID
- lifecycle status
- canonical data fields
- freshness timestamps
- publication status
- current winning source confidence summary

`canonical_identifiers` should include:

- `id`
- `canonical_entity_type`
- `canonical_entity_id`
- `identifier_scheme`
- `identifier_value`
- `identifier_type`
- `source_system_id`
- `is_primary`
- `confidence`

`canonical_provenance` should include:

- `id`
- `canonical_entity_type`
- `canonical_entity_id`
- `field_name`
- `source_record_id`
- `asserted_value`
- `evidence_id`
- `selector_or_hint`
- `confidence_hint`
- `decision_status` (`candidate`, `accepted`, `superseded`, `rejected`)

### Phase 2 code touchpoints

- new normalization services under `src/services/ingestion` or `src/agents/ingestion/normalization`
- adapt publish flow so canonical entities become the source of truth for live publication

## Phase 3: Taxonomy Federation

### Phase 3 goal

Add explicit support for external taxonomies and ORAN crosswalks.

### Phase 3 tables

- `taxonomy_registries`
- `taxonomy_terms_ext`
- `canonical_concepts`
- `taxonomy_crosswalks`
- `concept_tag_derivations`

### Phase 3 required behavior

- preserve external taxonomy terms when permitted
- link each external term to zero or more ORAN canonical concepts
- derive ORAN seeker tags from canonical concepts plus evidence
- derive ORAN scoring/classification inputs from canonical concepts, not directly from raw external taxonomy

### Initial policy

- ORAN seeker tags remain the retrieval layer
- external taxonomies become interoperability inputs and reporting outputs
- no raw taxonomy term should automatically override ORAN field evidence
- HSDS export taxonomy is generated from canonical concepts plus preserved external mappings

## Phase 4: Resolution and Clustering

### Phase 4 goal

Match incoming source assertions to existing canonical entities safely.

### Phase 4 tables

- `entity_clusters`
- `entity_cluster_members`
- `resolution_candidates`
- `resolution_decisions`

### Phase 4 deterministic match keys

Implement first:

- source system + source record id
- official organization identifier match
- location external identifier match
- canonical URL + phone match
- exact normalized org name + address match

### Phase 4 model-assisted matching

Add later behind review gates:

- name similarity
- address similarity
- geo distance
- taxonomy overlap
- ORAN tag overlap
- source trust weighting

### Phase 4 code touchpoints

- extend `src/services/merge/service.ts`
- add resolution service under `src/services/merge` or `src/services/community`

## Phase 5: Verification and Publish Integration

### Phase 5 goal

Feed federated canonical entities into ORAN's current publish controls.

### Phase 5 required behavior

- source assertions may auto-ingest, but never auto-publish
- canonical conflicts trigger review
- low-risk exact updates may bypass only the earliest ingestion steps, not final publication controls
- publish readiness remains deterministic

### Phase 5 existing contracts to preserve

- `src/agents/ingestion/publish.ts`
- `docs/SCORING_MODEL.md`
- review status workflow from ingestion and submissions systems

### Phase 5 new verification signals

- `cross_source_agreement`
- `identifier_strength`
- `source_license_ok`
- `taxonomy_mapping_reviewed`

## Phase 6: HSDS Profile Publication

### Phase 6 goal

Expose ORAN-approved records in a profile-documented HSDS-compatible form.

### Phase 6 deliverables

- ORAN HSDS Profile repository or profile directory
- generated schema artifacts
- public profile URI
- export pipeline from canonical tables to profile-compliant JSON and tabular outputs
- validation/debugging workflow proving compatibility with HSDS-oriented toolchains

### Phase 6 minimum API output

Implement read-only endpoints:

- `GET /`
- `GET /services`
- `GET /services/{id}`

### Phase 6 publication rule

Publish only canonical approved records, never raw `source_records` or `extracted_candidates`.

## Source Acquisition Implementation Plan

This section answers how ORAN will source data operationally.

## Track A: Direct HSDS connectors

Use when a publisher already exposes HSDS API or tabular exports.

### Track A connector requirements

- support `GET /`
- detect profile URI
- support paginated `/services`
- fetch services and supporting referenced entities
- preserve source identifiers
- store raw response bodies in `source_records`

### Track A output path

HSDS connector -> `source_records` -> canonical normalization -> resolution -> review -> publish

## Track B: Partner API / export connectors

Use when a partner exposes data that is not HSDS-native but is structured.

Examples:

- 211 APIs
- vendor exports
- ServiceNet-style exports
- ArcGIS and CKAN-backed public data

### Track B connector requirements

- source-specific adapter
- deterministic field mapping
- identifier preservation
- source license capture
- schema-versioned parsing

### Track B output path

partner connector -> `source_records` -> canonical normalization -> taxonomy crosswalk -> resolution -> review -> publish

## Track C: Allowlisted scrape ingestion

Use when no direct feed exists.

### Track C existing ORAN behavior

- seeded discovery
- allowlisted or quarantined domain control
- evidence snapshots
- extraction and verification pipeline

### Track C output path

seed URL -> evidence snapshot -> assertion creation -> canonical normalization -> review -> publish

Important note:

- scrape ingestion remains the fallback path, not the preferred path, when a structured feed exists

## Track D: Manual / partner-submitted imports

Use for:

- data onboarding pilots
- emergency backfills
- coalition uploads
- local admins providing export bundles

### Track D output path

batch import or user/admin submission -> staging/assertion creation -> canonical normalization -> review -> publish

## What We Can Say Today About Source URLs

This is the current precise answer.

### We know the standards URLs

Yes. We know the canonical specification URLs and API contract URLs and can build against them now.

### We know at least one 211 discovery URL

Yes. We have confirmed a live public 211 developer portal URL:

- `https://apiportal.211.org/`

But we have **not** yet confirmed the specific feed endpoints ORAN can consume without additional onboarding.

### We know the categories of URLs ORAN can safely crawl

Yes. ORAN already has a clear source-registry model for:

- allowlisted official domains
- quarantined seeded domains
- partner seeds
- manual seeds

That means we already know how to ingest when a source is available only as a website.

### We do not yet have a confirmed nationwide publisher list

No. That list still has to be built.

That is normal. The implementation should explicitly include source discovery as a workstream rather than pretending a national HSDS feed registry already exists.

## Immediate Execution Backlog

This is the concrete first build sequence.

### Sprint 1

- add `source_systems`, `source_feeds`, `source_records` tables
- add source assertion persistence in code
- add one direct structured feed adapter interface
- add source inventory admin or config file format
- adapt scrape/manual/user-submitted intake to emit assertions into the same model

### Sprint 2

- add canonical entities and identifiers
- add normalization mappers for one HSDS-like feed and one non-HSDS structured feed
- add provenance persistence for core fields

### Sprint 3

- add taxonomy registry and crosswalk tables
- derive ORAN seeker tags from canonical concepts
- add review-facing taxonomy mapping status

### Sprint 4

- add deterministic entity resolution
- add cluster / merge decision tables
- integrate with existing merge service

### Sprint 5

- feed canonical entities into current publish-readiness workflow
- add cross-source verification checks
- build pilot export as ORAN HSDS Profile JSON

## Recommended Pilot Sources

For the first pilot, use exactly three source patterns.

### Pilot source 1: one structured HSDS-compatible source

Goal:

- validate direct standards-aligned ingestion and publication mapping

### Pilot source 2: one public-sector non-HSDS structured source

Goal:

- validate normalization from a common real-world public dataset shape

### Pilot source 3: one allowlisted official website source

Goal:

- validate fallback scrape path into the same canonical model

This trio will prove the architecture across the three most important acquisition modes.

## Risks If We Skip Source Discovery Discipline

- we may build a connector model around feeds we cannot legally consume
- we may overfit to the HSDS spec while most real sources arrive as non-HSDS data
- we may assume 211 APIs are public when they are actually partner-gated
- we may lose time mapping taxonomy before licensing is clear

## Final Position

Yes, I understand how ORAN will source this data.

The answer is:

- direct HSDS feeds where available
- partner and 211 APIs where access is permitted
- public-sector structured datasets normalized into HSDS-aligned canonical objects
- allowlisted scrape ingestion where no feed exists
- manual and batch onboarding for pilot or partner data

What I cannot honestly claim yet is that the nationwide source list is already confirmed. It is not. We have enough confirmed endpoints and channels to design the system correctly, but not enough confirmed publisher inventory to say source onboarding is finished.

That should be treated as an explicit implementation track, not an unknown afterthought.
