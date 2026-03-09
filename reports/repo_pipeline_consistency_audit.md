# Repo Pipeline Consistency Audit

Date: 2026-03-08

Scope: repo-wide review of intake pipelines, confidence scoring, filtering/search, taxonomy usage, import/federation paths, and human review workflows.

This document is intentionally separate from `reports/ingestion_run_audit.md`. That other audit can stay focused on the ingestion run and 211/HSDS federation details. This report focuses on the larger repo-wide contract problem: the application is building toward one trustworthy system, but today it still behaves like several partially-overlapping systems.

## Intent Baseline

I aligned this review to the intent already visible in the repo and in your direction:

- one clean intake model, even if data enters from many channels
- one deterministic scoring language
- one canonical ORAN taxonomy for seeker-facing matching/filtering
- full preservation of source taxonomy and provenance for import/export
- one human-review model per service or change event
- fast-track only for explicitly approved, structurally trustworthy sources
- admin review surfaces that are concise, explainable, and reproducible

## Executive Assessment

The repo has strong pieces:

- a universal `submissions` workflow
- a strong public trust/match scoring contract
- a real source assertion layer and canonical federation layer
- a solid ORAN service-attribute taxonomy SSOT
- retrieval-first search/chat architecture

The problem is convergence. Today the repo still has:

- multiple intake paths that do not land in the same normalization contract
- multiple confidence systems with different meanings
- multiple taxonomies with unclear ownership boundaries
- multiple queue/triage systems
- partially-built import/feed paths that look live from the API surface but are not end-to-end

That is why the system feels inconsistent. The repo is not missing raw capability. It is missing a single enforced contract.

## What I Reviewed

- Intent/contracts/docs:
  - `docs/SSOT.md`
  - `docs/contracts/INGESTION_CONTRACT.md`
  - `docs/contracts/SCORING_CONTRACT.md`
  - `docs/SCORING_MODEL.md`
  - `docs/governance/TAGGING_GUIDE.md`
  - `docs/solutions/IMPORT_PIPELINE.md`
- Ingestion and publish:
  - `src/agents/ingestion/**`
  - `src/app/api/admin/ingestion/**`
- Search, chat, directory:
  - `src/services/search/**`
  - `src/services/chat/**`
  - `src/app/(seeker)/directory/**`
  - `src/app/api/search/route.ts`
  - `src/app/api/taxonomy/terms/route.ts`
- Host/community/admin submission flows:
  - `src/app/api/host/**`
  - `src/app/api/submissions/**`
  - `src/app/api/community/**`
  - `src/app/api/admin/triage/route.ts`
  - `src/app/api/reports/route.ts`
- Import/federation/schema:
  - `db/import/hsds-csv-importer.ts`
  - `src/db/schema.ts`

## Findings

### 1. There is no single intake-to-publish contract

Current behavior:

- URL ingestion goes through the agent pipeline and candidate materialization:
  - `src/app/api/admin/ingestion/process/route.ts`
  - `src/agents/ingestion/service.ts`
- Host org claims create live `organizations` and a placeholder live `services` row before review:
  - `src/app/api/host/claim/route.ts`
- Host service creation writes directly to live `services`, `phones`, and `schedules`, then opens a submission:
  - `src/app/api/host/services/route.ts`
- Host service updates write directly to live `services` and can set `status = 'active'` with no workflow gate:
  - `src/app/api/host/services/[id]/route.ts`
- Ingestion candidate publish writes to live tables first, then back-fills an already-approved `submission` after the fact:
  - `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts`
- Community reports and appeals do use the universal submission path:
  - `src/app/api/submissions/report/route.ts`
  - `src/app/api/submissions/appeal/route.ts`

Why this is a problem:

- review intent is not encoded once
- provenance is inconsistent by intake path
- some paths create live records first and ask workflow questions second
- service-level approval semantics are different depending on who created the record

Required correction:

- every inbound change must first be classified as one of:
  - source assertion
  - human submission
  - regression event
- no path should create or modify seeker-visible live service state without going through one shared publish policy
- `submissions` should represent review work
- `source_records` / `canonical_*` should represent data normalization and provenance
- live `services` / `organizations` / `locations` should represent only published state

Clean wiring:

1. URL ingestion and approved feeds create `source_records`, then canonical entities, then optionally a review task.
2. Host create/update flows create a submission plus a source/canonical assertion owned by `source_system = host_portal`; they do not write directly to live published state.
3. Community reports, appeals, and regression scans stay in `submissions`, but must link back to canonical/source context when available.
4. Admin publish should be the transition that creates or updates live published state, not a post-hoc mirror row.

### 2. Confidence semantics are split across the repo

Current systems:

- Public trust/match score:
  - `src/services/scoring/scorer.ts`
  - `docs/SCORING_MODEL.md`
- Ingestion candidate score:
  - `src/agents/ingestion/scoring.ts`
  - `src/agents/ingestion/pipeline/stages.ts`
- Publish readiness threshold:
  - `src/agents/ingestion/publish.ts`
  - `src/agents/ingestion/materialize.ts`
- Universal workflow auto-check thresholds:
  - `src/domain/constants.ts`
  - `src/services/workflow/engine.ts`
- Regression suppression logic:
  - `src/services/regression/detector.ts`
  - `src/services/regression/policy.ts`

Key inconsistencies:

- the public seeker contract says trust is `verification_confidence`, with overall score secondary
- search and chat mostly honor that
- ingestion uses a different "confidence score" meaning extraction completeness/readiness
- publish readiness uses still another boolean contract
- regression suppression uses `confidence_scores.score`, not seeker-facing trust (`verification_confidence`)
- `runAutoCheck()` exists, but I found no runtime caller outside tests
- `auto_checking` is a defined workflow state, but not an active path in the application

This means "confidence" currently means at least four different things:

- source trust / extraction confidence
- publish readiness proxy
- seeker trust
- admin regression severity

Required correction:

- keep only one public service confidence contract:
  - `verification_confidence`
  - `eligibility_match`
  - `constraint_fit`
  - `overall_score`
- rename ingestion-only scores so they stop pretending to be the same thing:
  - `extraction_confidence`
  - `completeness_score`
  - `source_reliability_score`
- make publish readiness a policy result, not a rival score family
- make regression and suppression use the same trust signal used by seeker-facing trust labels unless there is an explicit, documented reason not to

Recommended policy split:

- `verification_confidence`: seeker trust, search trust filters, regression thresholding
- `overall_score`: admin ranking only
- `publish_ready`: deterministic boolean from required data + hard anomalies + trust floor
- `fast_track_eligible`: deterministic boolean from source policy + trust floor + anomaly checks

### 3. The taxonomy model is fragmented and leaks across concerns

There are at least four taxonomy layers:

1. ORAN seeker taxonomy SSOT:
   - `src/domain/taxonomy.ts`
   - six dimensions: `delivery`, `cost`, `access`, `culture`, `population`, `situation`
2. HSDS/Open Referral terms:
   - `taxonomy_terms`
   - `service_taxonomy`
   - surfaced by `src/app/api/taxonomy/terms/route.ts`
3. Ingestion/admin operational tags:
   - `src/agents/ingestion/tags.ts`
   - `category`, `geographic`, `audience`, `verification_*`, `source_quality`, `program`
4. UI-only category presets:
   - `src/components/ui/category-picker.tsx`
   - `src/app/(seeker)/directory/DirectoryPageClient.tsx`
   - `src/services/profile/contracts.ts`
   - `src/services/chat/types.ts`

This is the most important taxonomy drift:

- the canonical ORAN taxonomy is rich and well-defined
- the URL ingestion pipeline only extracts category tags, not the six ORAN seeker dimensions
- live publish only auto-creates `delivery` attributes from address/phone/remote status
- host service entry uses a `CategoryPicker` vocabulary that does not match the canonical ORAN taxonomy and is not even persisted in the request payload
- search route accepts arbitrary `attributeFilters` by string length only; it does not validate keys/tags against the taxonomy SSOT
- importer supports ORAN extension CSVs but validates only taxonomy dimension names and tag length, not canonical tag membership

Concrete examples:

- `legal_aid` vs `legal`
- `substance_abuse` vs `substance_use`
- `senior_services` vs `seniors`
- `utility_assistance` vs `utilities`
- seeker directory quick chips use text search phrases like `"mental health"` and `"legal aid"` instead of canonical tags

Required correction:

- define three intentional taxonomy classes and keep them separate:
  - external taxonomy: HSDS/AIRS/Open Referral terms preserved exactly for source fidelity/export
  - canonical ORAN seeker taxonomy: `service_attributes` and related ORAN-native seeker filtering
  - operational routing tags: review/admin-only labels like `verification_missing`, `source_quality`, `geographic`
- do not use operational tags as seeker filters
- do not use free-text category chips as a persistence vocabulary
- do not rely on term-name string matching to crosswalk ORAN categories to HSDS terms

Sitewide rule:

- every seeker-facing filter/search/profile intent must resolve to canonical ORAN taxonomy keys and tags
- every imported external taxonomy term must be preserved separately and cross-walked, never overwritten

### 4. Filtering semantics differ by surface

Current behavior:

- search API accepts:
  - `taxonomyIds` -> HSDS term UUIDs
  - `attributes` -> ORAN attribute taxonomy JSON
  - `minConfidenceScore` / legacy `minConfidence`
  - presets
  - `organizationId`
- directory UI mixes:
  - free-text category chips
  - HSDS term selection dialog
  - ORAN attribute chips
  - trust filters
- chat only accepts:
  - `taxonomyTermIds`
  - trust filter
  - profile-based soft ordering signals from ORAN attributes
- search presets are ORAN attribute + text based, not HSDS-term based

That means the repo currently exposes three different filter grammars to users:

- text categories
- HSDS term IDs
- ORAN attribute tags

Additional defect:

- `src/app/api/taxonomy/terms/route.ts` says `onlyUsed=true` means terms used by active services, but the query counts `st.service_id`, not `s.id`, so inactive/defunct service links still contribute to `service_count`

Required correction:

- create one shared filter contract used by search, chat, directory, and map:
  - `trust`
  - `oranAttributes`
  - optional `externalTaxonomyTerms`
  - geo inputs
  - sort
- category chips should become thin UI presets that resolve into canonical ORAN filters
- HSDS term filters should be advanced/narrowing filters, not the primary seeker taxonomy
- chat and directory should consume the same shared filter serializer/parser

### 5. Queue and review models overlap instead of composing

Current systems:

- community queue uses `src/services/queue/triage.ts`
  - simple priority based on SLA, escalated status, staleness, DB priority
- ORAN admin triage uses `src/services/triage/triage.ts`
  - richer anomaly model based on trust, traffic, feedback, crisis adjacency, staleness, SLA
- universal workflow engine has:
  - `auto_checking`
  - `needs_review`
  - `under_review`
  - `pending_second_approval`
  - `approved`
  - etc.
- runtime producers are not aligned to those states

Observed drift:

- `runAutoCheck()` exists but is not wired into runtime flows
- `new_service`, `data_correction`, and `removal_request` exist as submission types but have little or no actual production path outside tests and helper mappings
- ingestion publish can insert an already-approved submission directly after publish

Required correction:

- choose one queue scoring model and explicitly define whether the simpler one is:
  - deprecated, or
  - a community-admin subset view over the richer triage model
- remove dead states/types or wire them fully
- stop creating "approved" submission records after the fact
- require every reviewable event to have one causal submission trail from creation to resolution

### 6. Import/feed/federation paths are only partially real

Current state:

- `db/import/hsds-csv-importer.ts` validates rows and emits reports
- `docs/solutions/IMPORT_PIPELINE.md` explicitly says staging/diff/publish wiring is still planned
- `src/agents/ingestion/service.ts::pollFeeds()` only marks feeds as polled; it does not fetch, parse, diff, or ingest records
- `src/app/api/admin/ingestion/feeds/poll/route.ts` exposes that polling path as if it is a real ingest path
- the repo has both old `ingestion_sources` and new `source_systems` / `source_feeds` / `source_records`
- the URL source registry store still reads from legacy `ingestion_sources`

This is not just "unfinished." It is contract confusion:

- new federation/source-assertion architecture exists
- runtime URL allowlisting still relies on the legacy registry
- feed polling API exists but does not ingest
- CSV importer supports ORAN extension files but docs still present a more HSDS-core view

Required correction:

- pick one source registry:
  - `source_systems` + `source_feeds` should win
  - `ingestion_sources` should become legacy-only and then be retired
- do not expose feed polling as a meaningful ingest path until it actually creates `source_records`
- treat CSV importer, feed importer, API importer, URL scraper, host portal, and manual admin entry as different adapters into the same normalization contract

## Concrete Defects Found During Audit

These are not just architecture notes. They are specific inconsistencies or bugs.

1. Host service updates can directly set `status = 'active'`, bypassing any shared review gate.
   - `src/app/api/host/services/[id]/route.ts`

2. Host service entry presents category selection UI, but the selected categories are not sent in the save payload at all.
   - `src/app/(host)/services/ServicesPageClient.tsx`

3. Legacy `POST /api/reports` inserts `submitted_by_user_id = NULL` into `submissions`, while the schema defines that column as `NOT NULL`.
   - `src/app/api/reports/route.ts`
   - `src/db/schema.ts`

4. `GET /api/taxonomy/terms` claims active-only counts, but the SQL counts `service_taxonomy.service_id`, not active `services.id`.
   - `src/app/api/taxonomy/terms/route.ts`

5. URL ingestion publishes category tags to `service_taxonomy` by matching `LOWER(taxonomy_terms.term)` to ORAN category strings.
   - `src/agents/ingestion/livePublish.ts`
   - This is not a stable crosswalk.

6. URL ingestion publish creates only inferred `delivery` service attributes (`virtual`, `in_person`, `phone`) and loses the richer ORAN taxonomy.
   - `src/agents/ingestion/livePublish.ts`

7. Search route and importer do not actually validate ORAN attribute keys/tags against `src/domain/taxonomy.ts`, despite the SSOT claiming that taxonomy should drive validation.
   - `src/app/api/search/route.ts`
   - `db/import/hsds-csv-importer.ts`
   - `src/domain/taxonomy.ts`

## Recommended Repo-Wide Target Model

### 1. Separate the system into four explicit layers

Layer A: Source assertions

- external APIs
- CSV/HSDS/NDP files
- scraper outputs
- host portal submitted data
- manual admin entry

Storage:

- `source_systems`
- `source_feeds`
- `source_records`
- `source_record_taxonomy`
- raw evidence

Layer B: Canonical ORAN entities

- `canonical_organizations`
- `canonical_services`
- `canonical_locations`
- `canonical_service_locations`
- `canonical_provenance`

Layer C: Review tasks

- `submissions`
- `submission_transitions`
- triage scores
- notifications

Layer D: Published seeker-facing state

- `organizations`
- `services`
- `locations`
- `service_at_location`
- `service_attributes`
- `service_taxonomy`
- `confidence_scores`

Rule:

- Layers A and B preserve source truth and normalization
- Layer C manages human/system decisions
- Layer D is only the published projection

### 2. Canonicalize confidence vocabulary

Keep and document exactly these families:

- `verification_confidence`
- `eligibility_match`
- `constraint_fit`
- `overall_score`
- `publish_ready`
- `fast_track_eligible`

Rename or isolate ingestion-only measures:

- `extraction_confidence`
- `source_reliability_score`
- `candidate_completeness_score`

Do not call those values just `confidenceScore` once they leave the ingestion module.

### 3. Canonicalize taxonomy vocabulary

Use this split:

- External taxonomy:
  - preserved exactly from upstream
  - used for audit, HSDS export, partner round-trip, 211/NDP traceability
- Canonical ORAN taxonomy:
  - `service_attributes`
  - related ORAN-native structured seeker filters
- Operational taxonomy:
  - review/admin routing tags only

Implementation rule:

- every seeker-facing UI, profile signal, preset, and import validator must use the canonical ORAN taxonomy module as the validation source
- every external source taxonomy must be snapshotted and cross-walked, not normalized away

### 4. Canonicalize intake adapters

Each intake path should be reduced to an adapter:

- `url_scrape_adapter`
- `approved_feed_adapter`
- `csv_hsds_adapter`
- `host_portal_adapter`
- `manual_admin_adapter`
- `community_report_adapter`
- `appeal_adapter`
- `regression_adapter`

Each adapter produces one of:

- source assertion(s)
- submission(s)
- both

No adapter should publish directly.

## Implementation Sequence

### Phase 1: Contract hardening

- create a single shared intake ADR:
  - "all inbound data enters via source assertions and/or submissions; no direct publish writers"
- create a single shared confidence dictionary module for public/admin/ingestion naming
- create a shared taxonomy validation module used by:
  - search route
  - importer
  - host forms
  - ingestion publish
  - profile/retrieval mappings

### Phase 2: Stop the biggest bypasses

- change host service update so `active` is not directly settable by hosts unless a verified-fast-track policy explicitly allows it
- replace host live-write create/update with:
  - submission creation
  - source/canonical draft write
  - later publish projection
- remove post-hoc approved submission insertion from ingestion publish; create the workflow record before publish decision
- disable or clearly mark stub feed polling until real ingestion exists

### Phase 3: Taxonomy unification

- replace `CategoryPicker` vocabulary with canonical ORAN taxonomy-backed input components
- make seeker category chips resolve into ORAN attribute presets, not raw text search
- add a canonical ORAN taxonomy API for UI consumption
- keep HSDS taxonomy browsing as a secondary, advanced filter path
- add an explicit HSDS/AIRS crosswalk table rather than string-matching ORAN category tags to `taxonomy_terms.term`

### Phase 4: Review and triage unification

- choose whether `services/queue/triage.ts` is deprecated or becomes a simplified view over `services/triage/triage.ts`
- wire `runAutoCheck()` or remove it
- remove dead submission types/statuses or add real producers
- make one review page model that can explain:
  - why this item exists
  - what source created it
  - what trust score means
  - what taxonomy was retained
  - what anomaly or blocker prevents publish

### Phase 5: Import/federation completion

- finish CSV staging/diff/publish or stop representing it as a near-complete path
- make feed polling create immutable `source_records`
- move URL allowlisting from `ingestion_sources` to `source_systems` / `source_feeds`
- ensure imported and ORAN-native records both converge on canonical ORAN display models

## Verification Plan

### Contract tests

- add repo-level tests that assert every write path lands in the intended layer
- add tests that no host/community/api route can publish a seeker-visible active service without going through publish policy
- add tests that no legacy endpoint violates `submissions` schema constraints

### Taxonomy tests

- validate all host/search/import/chat inputs against `src/domain/taxonomy.ts`
- add cross-surface snapshot tests ensuring directory/chat/profile/service-entry use the same canonical tag IDs
- add tests for HSDS term crosswalk behavior so there is no term-name guessing

### Confidence tests

- assert seeker trust labels always derive from `verification_confidence`
- assert regression suppression thresholds use the documented trust contract
- assert ingestion-specific scores cannot leak into seeker trust surfaces

### Workflow tests

- assert runtime producers exist for every active submission status/type
- assert dead types/states are removed or intentionally unreachable
- assert ingestion publish cannot create an `approved` submission retroactively

### End-to-end tests

- host creates service -> enters review -> reviewer approves -> published service appears
- approved feed import -> fast-track decision -> published service appears with preserved source metadata
- community report -> regression/review -> service suppressed or reverified
- appeal -> review -> final decision with auditable transition chain

## Docs To Update After Implementation

- `docs/DATA_MODEL.md`
- `docs/SCORING_MODEL.md`
- `docs/contracts/INGESTION_CONTRACT.md`
- `docs/contracts/SCORING_CONTRACT.md`
- `docs/contracts/SEARCH_CONTRACT.md`
- `docs/governance/TAGGING_GUIDE.md`
- `docs/agents/AGENTS_INGESTION_PIPELINE.md`
- `docs/solutions/IMPORT_PIPELINE.md`
- one ADR for:
  - intake unification
  - taxonomy ownership boundaries
  - confidence vocabulary and suppression policy

## Bottom Line

The repo is not inconsistent because it lacks architecture. It is inconsistent because the newer architecture has not yet been allowed to replace the older direct-write and per-feature contracts.

The right move is not another narrow feature pass. The right move is to enforce one repo-wide rule:

- all intake paths become adapters
- all review paths become one workflow
- all seeker filtering uses one canonical ORAN taxonomy
- all source taxonomies are preserved separately
- all publish decisions come from one shared policy

That will make the system cleaner, more accurate, easier to review, easier to explain to community admins, and much safer to extend into the 211/HSDS federation model.
