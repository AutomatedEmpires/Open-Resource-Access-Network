# Repo Pipeline Reunification Plan

Date: 2026-03-08

Scope: second-pass architecture audit and reunification plan for all intake paths, scoring, taxonomy, search/chat filtering, review workflow, and HSDS / 211 interoperability.

This report is the decision document that follows `reports/repo_pipeline_consistency_audit.md`. The earlier audit established that the repo is inconsistent. This report audits the available unification options, weighs tradeoffs, and recommends the long-horizon architecture that best preserves longevity, reproducibility, consistency, and HSDS / 211 compatibility.

## Executive Decision

Recommended architecture:

- `assertion-first`
- `canonical-first`
- `review-overlay`
- `published-projection`

In plain terms:

1. Every input becomes an immutable source assertion first.
2. Assertions normalize into canonical ORAN entities.
3. Human and automated review act on canonical change sets, not on ad hoc live-table writes.
4. Seeker-facing tables remain a published projection for backward compatibility and retrieval performance.
5. HSDS / 211 import/export is generated from canonical state plus preserved external taxonomy and identifiers.

This is the only option that cleanly satisfies all of the following at once:

- multiple ingestion pipelines
- future deeper LLM assistance
- sitewide consistency across directory, chat, admin, and import/export
- round-trip fidelity for 211 / HSDS
- deterministic review and publish policy
- replayability and reproducibility

It also aligns with the architecture direction already captured in `hsds_211_integration_plan.md`: assertion-first intake, canonical normalization, and HSDS export from normalized state. The difference here is scope. This report applies that same decision consistently across the whole application, including host flows, search/chat contracts, taxonomy handling, and future LLM-assisted review.

## Final Recommendation In One Sentence

Do not unify around direct live writes, and do not unify around `submissions` alone. Unify around the existing `source_systems` / `source_feeds` / `source_records` plus `canonical_*` architecture, expand it to cover the full ORAN data model, and make it the mandatory path for every intake channel.

## Re-Audit Summary

The second pass confirms the original findings and adds a more important conclusion:

- the repo already contains the right architectural center of gravity
- that center is not yet wired end-to-end
- it is also not yet broad enough to represent the full ORAN + HSDS surface

The strongest evidence is:

- the source assertion layer exists in schema and persistence
- the canonical federation layer exists in schema and persistence
- the runtime still largely bypasses both
- search/chat/live publish still depend on older direct-to-live patterns

### What The Repo Already Gets Right

- `source_systems`, `source_feeds`, `source_records`, `entity_identifiers`, and `hsds_export_snapshots` are the right primitives for provenance and replay.
- `canonical_organizations`, `canonical_services`, `canonical_locations`, and `canonical_provenance` are the right primitives for normalization and merge decisions.
- `service_attributes` and the ORAN taxonomy SSOT are the right primitives for seeker-facing matching and filtering.
- `submissions` is the right primitive for human workflow, audit, and approvals.

### What Is Still Wrong

- runtime flows still write directly to live tables
- canonical tables exist but are not yet the operational center
- canonical coverage is too thin for real HSDS / ORAN parity
- multiple filter grammars still exist
- LLM capability is richer in prompts and docs than in actual pipeline outputs

## New Findings From The Second Pass

These are the additional architectural findings that matter for the reunification decision.

### 1. The assertion and canonical layers exist, but are mostly not driving runtime behavior

Evidence:

- `src/db/schema.ts`
- `src/agents/ingestion/persistence/sourceRecordStore.ts`
- `src/agents/ingestion/persistence/canonical*.ts`
- `src/agents/ingestion/persistence/storeFactory.ts`

Interpretation:

- this is not a greenfield architecture choice anymore
- the repo already committed to the right long-term center
- the correct decision is to complete and enforce that center, not replace it with a new one

### 2. The canonical layer is currently too thin for true ORAN-wide and HSDS-wide unification

Current canonical coverage:

- canonical organization
- canonical service
- canonical location
- canonical service-location junction
- field-level provenance

Missing canonical coverage for important operational and seeker-facing data:

- service areas
- languages
- schedules
- phones
- contacts
- eligibility
- required documents
- service attributes
- service adaptations
- dietary options
- accessibility
- external taxonomy mappings as first-class normalized relationships

Why this matters:

- HSDS v2 payloads in `211_info_001.md` contain far more than the core triad
- ORAN seeker surfaces already care about more than the core triad
- if canonical does not cover these fields, the system will keep leaking direct-to-live exceptions

### 3. `source_record_taxonomy` is not rich enough for full 211 / HSDS fidelity

Current shape preserves:

- taxonomy name
- code
- name
- URI

But 211 / HSDS taxonomy material in `211_info_001.md` includes more structure:

- hierarchical levels
- targets
- source-native taxonomy object shape
- profile and possibly licensing context

Without that, ORAN cannot reliably:

- round-trip 211 taxonomy detail
- justify crosswalk decisions later
- replay import normalization without re-fetching the partner source

### 4. The current import staging model is too narrow to become the universal intake center

`db/migrations/0003_import_staging.sql` stages:

- organizations
- locations
- services

It does not stage the rest of the data needed for a serious HSDS / ORAN import:

- service-location relations
- phones
- schedules
- service areas
- languages
- contacts
- accessibility
- taxonomy
- documents
- eligibility

Interpretation:

- staging tables are still useful for operator batch UX
- they are not sufficient to be the system of record for multi-channel ingestion
- they should become a review surface over assertions and canonical change sets, not the unification core

### 5. The repo already intends richer LLM extraction than the live pipeline stores

`src/services/ingestion/tagging-prompt.ts` supports extraction of:

- six ORAN attribute dimensions
- adaptations
- dietary data
- location accessibility
- transit
- parking
- service info
- eligibility
- languages

But the live URL ingestion pipeline still effectively centers on:

- categories
- geography
- verification checks
- a coarse score

Interpretation:

- the product intent is already broader than the current implementation
- reunification should not be designed around the narrow current pipeline output
- it should be designed around the broader, canonical ORAN taxonomy contract

### 6. Service area is structurally important but inconsistently treated across the repo

Observed state:

- `service_areas` exists in the schema and domain types
- UI components can display service areas
- ingestion checklist treats service area as required
- the pipeline may mark service area satisfied heuristically when an address or categories exist
- search retrieval does not treat service area as a first-class matching primitive

Interpretation:

- this is a direct integrity risk for 211 / HSDS integration because service areas are central in referral data
- reunification must promote service area from checklist heuristic to canonical, publishable, searchable data

## Design Criteria

I used the following criteria to evaluate the unification options.

### Non-negotiable criteria

- one enforced intake contract for every source family
- reproducible normalization and publish decisions
- no direct seeker-visible facts from LLM output alone
- sitewide taxonomy consistency for search, chat, admin, and import/export
- preserved source provenance and external taxonomy
- compatibility with HSDS import and export

### High-value criteria

- incremental migration without breaking the current app
- ability to fast-track trusted 211 partner feeds
- explainable admin review
- deterministic replay and regression testing
- future-safe LLM integration

## Options Audited

## Option A: Patch The Current Direct-to-Live Architecture

Description:

- keep live tables as the operational center
- tighten host and ingestion review gates
- keep source assertions and canonical tables as secondary or optional

### Pros

- lowest short-term engineering cost
- smallest migration blast radius
- fastest path to remove a few high-risk bypasses

### Cons

- provenance remains fragmented
- replays remain hard
- 211 / HSDS round-trip fidelity remains partial
- multi-source merge logic remains scattered
- search/chat consistency remains dependent on discipline rather than architecture
- future LLM integration becomes risky because there is no single normalized checkpoint before publish

### Longevity Verdict

Bad. This option reduces immediate damage but preserves the structural problem.

## Option B: Submission-Centric Unification

Description:

- force every intake path through `submissions`
- treat submissions as both workflow object and inbound data object

### Pros

- one human workflow table
- easy mental model for admins
- faster than building more canonical infrastructure

### Cons

- `submissions` is for review work, not immutable source persistence
- recurring partner feeds do not fit naturally into a submission lifecycle
- poor fit for re-ingest, replay, and source versioning
- external taxonomy and record fidelity become awkward payload blobs
- canonical merge decisions stay under-modeled

### Longevity Verdict

Insufficient. Good workflow primitive, wrong system center.

## Option C: Assertion-First + Canonical + Review Overlay + Published Projection

Description:

- every intake path creates assertions
- assertions normalize into canonical entities
- review operates on canonical change sets
- published tables remain the seeker-facing read model

### Pros

- strongest provenance model
- strongest replay and reproducibility model
- best fit for 211 / HSDS import and export
- allows many adapters without changing downstream retrieval contracts
- provides safe place for future LLM assistance
- supports fast-track trusted sources without special-case bypasses
- keeps current seeker/search architecture stable through a projection layer

### Cons

- highest upfront refactor cost
- requires more schema work because canonical coverage is incomplete
- migration has to be phased carefully

### Longevity Verdict

Best option. This is the only option that scales cleanly as more adapters, more AI assistance, and more interoperability obligations are added.

## Option D: Full Event-Sourced Platform

Description:

- store every mutation as a domain event stream and derive all read models from it

### Pros

- maximum auditability
- maximal replay and debugging power

### Cons

- much more complex than the repo needs
- would slow delivery significantly
- does not leverage the architecture already built
- would create a new migration and operational burden with limited product upside right now

### Longevity Verdict

Overbuilt for current needs. Not justified.

## Recommended Target Architecture

The target architecture is Option C, implemented as a strict layered model.

## Layer 1: Intake Adapters

All inputs become adapters into the same contract.

Supported adapter families:

- `hsds_api`
- `hsds_csv`
- `partner_api`
- `partner_export`
- `government_open_data`
- `allowlisted_scrape`
- `host_portal`
- `admin_manual`
- `community_report`
- `regression_event`

Each adapter must produce:

- `source_system`
- `source_feed`
- `source_record`
- optional `evidence_snapshot`
- adapter metadata:
  - adapter name
  - adapter version
  - schema/profile URI
  - fetch timestamp
  - source-native identifiers

### Rule

No adapter may write directly to live published tables.

## Layer 2: Assertion Layer

The assertion layer is the immutable truth of what was received.

Core tables already present:

- `source_systems`
- `source_feeds`
- `source_records`
- `source_record_taxonomy`
- `entity_identifiers`
- `lifecycle_events`

### Required enhancements

`source_records`

- add explicit adapter version if not already represented in payload metadata
- require source schema/profile version metadata
- require source license / reuse policy metadata for partner feeds

`source_record_taxonomy`

- extend to preserve:
  - taxonomy authority
  - taxonomy version
  - hierarchy path or level fields
  - targets / audience targeting
  - raw taxonomy payload
  - rights / publication allowance if relevant

### Longevity principle

If a future mapping decision is disputed, ORAN must be able to re-open the exact assertion that caused it.

## Layer 3: Canonical Normalization Layer

The canonical layer is the operational source of truth for normalized service facts before publication.

Core rule:

- canonical is not the same thing as source
- canonical is not the same thing as workflow
- canonical is the resolved ORAN interpretation of one or more assertions

### Current canonical coverage is incomplete

The current `canonical_*` triad is a good start but not enough.

### Recommended canonical shape

Keep the current core tables and add canonical child structures for all stable, queryable, publishable data:

- `canonical_service_areas`
- `canonical_languages`
- `canonical_contacts`
- `canonical_phones`
- `canonical_schedules`
- `canonical_eligibility`
- `canonical_required_documents`
- `canonical_service_attributes`
- `canonical_service_adaptations`
- `canonical_dietary_options`
- `canonical_accessibility`
- `canonical_external_taxonomy_links`

### Typed tables vs JSONB sidecars

I audited three approaches.

#### Option 1: typed tables only

Pros:

- strongest queryability
- strongest validation
- easiest to use in seeker retrieval

Cons:

- more schema work
- slower to onboard rare upstream fields

#### Option 2: JSONB sidecars only

Pros:

- faster to implement
- flexible for partner-specific shapes

Cons:

- weaker validation
- harder retrieval consistency
- easier taxonomy drift
- less durable for long-term product evolution

#### Option 3: hybrid typed + JSONB overflow

Pros:

- typed for search/filter/ranking/export-critical fields
- JSONB overflow for low-frequency source-specific fields
- best balance of speed and durability

Cons:

- slightly more complex than either extreme

### Recommendation

Use the hybrid approach:

- typed canonical structures for fields that affect seeker retrieval, trust, publish, or HSDS fidelity
- JSONB overflow only for rare, source-specific details that do not drive core behavior

## Layer 4: Review Overlay

`submissions` remains the workflow layer, but it no longer carries the burden of being the intake truth.

### Recommended model

- each reviewable event references:
  - canonical entity
  - canonical change set
  - source record(s)
  - publish policy result
- review unit is per service change event
- batch imports can still be reviewed in batch UX, but approval resolves to per-service outcomes

### Why this is the right split

- assertions preserve what arrived
- canonical preserves what ORAN thinks is true
- submissions preserve what humans did about it

Those are three different concerns and should stay three different concerns.

## Layer 5: Published Projection

The existing live tables should remain a projection for seeker-facing reads during migration and probably long-term.

This means:

- `services`, `organizations`, `locations`, `service_at_location`, `service_attributes`, `service_areas`, `languages`, `contacts`, `phones`, `schedules`, `service_taxonomy`, and `confidence_scores` stay useful
- but they become downstream published state, not the origin of truth

### Why keep a projection

- minimizes migration risk for search/chat/UI
- preserves current query performance and compatibility
- makes rollback and dual-run comparison easier

### Hard rule

No route should create or mutate seeker-visible published state except the publish projector.

## Unified Taxonomy Model

This must be explicit and enforced.

### Taxonomy class 1: external taxonomy

Purpose:

- preserve HSDS / AIRS / 211 / partner classification as received
- enable round-trip export
- support analyst and admin inspection

Storage:

- `source_record_taxonomy`
- normalized external taxonomy registry and crosswalk tables
- published `service_taxonomy` as a downstream projection when needed

### Taxonomy class 2: canonical ORAN taxonomy

Purpose:

- seeker matching
- search filters
- chat intent resolution
- profile preference signals
- trust and routing logic when appropriate

Storage:

- `service_attributes`
- related ORAN native structures for adaptations, dietary, accessibility, and service area semantics

### Taxonomy class 3: operational routing tags

Purpose:

- admin review
- source quality routing
- missing-data and anomaly tagging

Storage:

- ingestion/admin operational tag system

### Rule set

- external taxonomy is never overwritten by ORAN tags
- ORAN tags are never inferred from free-text UI categories alone
- chat, directory, and search presets must resolve to canonical ORAN taxonomy
- external taxonomy filters are advanced filters, not the primary seeker vocabulary

## Crosswalk Strategy For 211 / HSDS

The 211 taxonomy examples in `211_info_001.md` show that ORAN must preserve both:

- the specific taxonomy term/code hierarchy
- the ORAN-native seeker meaning of that term

### Recommended crosswalk flow

`source_record_taxonomy -> external taxonomy registry -> crosswalk decision -> canonical ORAN concepts -> published ORAN filters and optional published external taxonomy`

### Why this is better than direct term-name mapping

- term names change
- synonyms differ by source
- hierarchical context matters
- targets matter
- licensing and republishing rights may differ from internal use rights

### Required new artifact

Add a crosswalk registry with versioned mappings:

- external taxonomy authority
- external code
- mapping version
- mapped ORAN concept(s)
- mapping method:
  - manual
  - approved rules
  - LLM suggested, human approved
- confidence
- valid-from / retired-at

## Unified Scoring Model

The repo should not continue using one overloaded word, "confidence", for different layers.

### Recommended score families

`assertion_quality`

- internal only
- how trustworthy a single inbound record and extraction are

`resolution_confidence`

- internal/admin only
- how confident ORAN is in the canonical decision across one or more assertions

`verification_confidence`

- public/admin
- seeker trust
- used by search/chat trust filters and regression policy

`eligibility_match`

- seeker/admin
- fit signal

`constraint_fit`

- seeker/admin
- fit signal

`overall_score`

- admin ordering only

`publish_ready`

- not a score
- deterministic policy result

`fast_track_eligible`

- not a score
- deterministic policy result

### Important rule

Do not expose `assertion_quality` or `resolution_confidence` to seekers. They are internal pipeline signals, not user-facing truth labels.

## Unified Query Contract For Search, Chat, And Directory

There should be one shared filter grammar.

### Recommended request contract

- `trust`
- `oranAttributes`
- `serviceAreas`
- `geo`
- `externalTaxonomyTerms`
- `sort`
- `availability`

### UI behavior

- category chips become presets that compile into canonical ORAN filters
- chat intent categories become the same presets, not a separate taxonomy
- advanced filters may include external HSDS taxonomy terms when useful

### Why this matters

The user should not get a different service universe depending on whether they searched in directory, chat, or admin preview.

## LLM Integration Strategy For Longevity

Future deeper LLM use is reasonable, but only if the system keeps deterministic control points.

### Safe LLM roles

- extraction from source records
- taxonomy suggestion
- crosswalk suggestion
- duplicate clustering suggestion
- reviewer summary generation
- seeker response synthesis after retrieval

### Unsafe LLM roles

- direct publish authority
- direct trust scoring without deterministic validators
- direct retrieval ranking
- direct canonical overwrite with no review or policy checks

### Persistence requirements for every LLM output

- model name
- model version
- prompt version
- input hash
- output hash
- source record references
- evidence references
- temperature / deterministic settings
- schema version for expected output

### Rule

All LLM outputs enter as suggestions or assertions. None may bypass normalization and policy.

## Fast-Track Policy For Approved 211 / HSDS Sources

Your earlier direction still holds, but it needs to be grounded in the unified model.

### Recommended fast-track decision path

Fast-track is a publish policy outcome on a per-service change set.

Inputs:

- source system approval state
- schema/profile conformance
- stable external identifiers
- canonical URL validity
- structural completeness
- taxonomy crosswalk coverage
- service area presence
- anomaly scan result
- verification confidence floor

### Recommended lanes

- `auto_publish`
- `light_review`
- `full_review`

### Important rule

Fast-track never means provenance bypass. It only changes review intensity, not data lineage requirements.

## Migration Plan

This should be done in phases, not as a big-bang rewrite.

## Phase 0: Decision Lock

- add an ADR selecting assertion-first canonical unification
- define official vocabulary:
  - source assertion
  - canonical entity
  - review event
  - published projection
  - public trust score names

## Phase 1: Stop The Worst Bypasses

- remove direct host writes to live published service state
- stop back-filling already-approved submissions after publish
- route host portal and admin manual entry through assertion creation
- block any new ingestion work from using `ingestion_sources` as the long-term registry

## Phase 2: Make Assertion Mandatory

- every adapter writes `source_records`
- feed polling creates real source records or is hidden until it does
- CSV import becomes assertion ingest, not just validator output
- host portal creates synthetic structured source records under `source_system = host_portal`

## Phase 3: Expand Canonical Coverage

- add the missing canonical child structures
- promote service area, languages, taxonomy links, and seeker filterable data into canonical form
- add change-set generation between current and next canonical state

## Phase 4: Build The Publish Projector

- canonical accepted state projects into live tables
- dual-run projection comparison against current behavior
- no more direct live writes outside projector

## Phase 5: Unify Query Grammar

- shared filter parser/serializer for directory, chat, admin preview
- category and intent enums become UI presets over ORAN taxonomy
- trust filters use the same public semantics everywhere

## Phase 6: Finish 211 / HSDS Integration

- assertion adapters for approved 211 APIs and HSDS files
- external taxonomy preservation and crosswalk registry
- ORAN HSDS profile export from canonical published state
- contract tests using fixture payloads based on `211_info_001.md`

## Phase 7: Retire Legacy Paths

- retire `ingestion_sources`
- retire legacy report endpoint or fully reconcile it
- retire direct-to-live host patterns
- retire any duplicate filter grammars

## Verification Strategy

This plan only works if it is verified with replayable contracts.

### 1. Adapter replay tests

For each intake family:

- replay fixed payloads
- assert created source assertions
- assert deterministic canonical outputs
- assert stable publish policy results

### 2. Projection parity tests

During migration:

- compare current live result vs projector result
- diff service cards, trust, taxonomy, service areas, links, and export payloads

### 3. Query parity tests

For the same logical filter:

- directory
- chat retrieval
- admin preview

must return the same eligible service universe modulo UI-specific formatting.

### 4. Taxonomy crosswalk tests

- fixture external taxonomy term in
- expected ORAN concepts out
- round-trip preservation still intact

### 5. HSDS contract tests

For imported and exported records:

- validate against chosen HSDS profile
- verify service areas, languages, taxonomy, identifiers, and meta snapshots are preserved

### 6. LLM reproducibility tests

- frozen source input
- frozen prompt version
- expected schema-valid output
- deterministic validator outcome

### 7. Operational invariants

- no seeker-visible record without provenance
- no publish without projector
- no direct host/admin publish bypass
- no partner fast-track without recorded source system and source record

## Documentation To Update

If this direction is adopted, these docs should change together.

- `docs/DECISIONS/`:
  - add ADR for assertion-first canonical reunification
- `docs/contracts/INGESTION_CONTRACT.md`
- `docs/contracts/SCORING_CONTRACT.md`
- `docs/DATA_MODEL.md`
- `docs/SSOT.md`
- `docs/SCORING_MODEL.md`
- `docs/agents/AGENTS_INGESTION_PIPELINE.md`
- `docs/governance/TAGGING_GUIDE.md`
- `docs/CHAT_ARCHITECTURE.md` or equivalent search/chat contract doc
- `docs/solutions/IMPORT_PIPELINE.md`

## Concrete Repo Implications

These are the highest-value implementation targets implied by this plan.

- `src/app/api/host/claim/route.ts`
- `src/app/api/host/services/route.ts`
- `src/app/api/host/services/[id]/route.ts`
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts`
- `src/app/api/admin/ingestion/feeds/poll/route.ts`
- `src/agents/ingestion/service.ts`
- `src/agents/ingestion/livePublish.ts`
- `src/agents/ingestion/pipeline/*`
- `src/agents/ingestion/persistence/sourceRegistryStore.ts`
- `src/services/search/*`
- `src/services/chat/*`
- `src/app/(seeker)/directory/*`
- `db/import/hsds-csv-importer.ts`
- `src/db/schema.ts`

## Bottom Line

The repo does not need a brand new architecture. It needs to finish the architecture it already started and make it mandatory.

The most justified unification plan is:

- assertions first
- canonical second
- review third
- publish projection fourth
- shared query grammar everywhere
- HSDS preservation and export as a built-in requirement
- LLM assistance only inside auditable, replayable boundaries

That path is more work than patching direct writes, but it is the only path that will still look correct after:

- more ingestion sources
- more partner APIs
- deeper LLM integration
- stricter admin review needs
- broader HSDS / 211 interoperability
- future auditing of why a published service said what it said

## Phase 2 Extension: Make Assertion Mandatory

Date: 2026-03-08

This section extends `Phase 2: Make Assertion Mandatory` based on the current repo state after the first reunification movement.

### Current repo alignment

The repo now shows real movement toward the target contract:

- host-portal intake now has a synthetic assertion adapter in `src/services/ingestion/hostPortalIntake.ts`
- host service create, active update, and active archive paths now record `source_records` and queue review payloads
- community approval of `service_verification` can now apply approved payloads back onto live service state
- the legacy source-registry adapter now bridges to `source_systems`
- ingestion candidate publish no longer fabricates a post-hoc approved submission

That is useful progress, but it is still only a partial Phase 2 slice.

### What is still missing

Assertions are still not mandatory for several intake families:

- feed polling still only marks feeds as polled in `src/agents/ingestion/service.ts`
- CSV / HSDS import still validates and reports only in `db/import/hsds-csv-importer.ts`
- scrape pipeline still materializes candidates without also creating first-class `source_records`
- user-submitted and community report lanes are still workflow-first, not assertion-first
- admin manual correction / manual entry does not yet have a dedicated assertion adapter
- host organization detail update / archive remains outside the new assertion pattern

### Phase 2 objective lock

Phase 2 should do one thing completely:

- every intake adapter must produce immutable assertions first

Phase 2 should explicitly not do these things yet unless already claimed by another agent:

- expand canonical schema coverage
- implement canonical merge and entity resolution
- implement the live publish projector
- redesign seeker-facing read surfaces

Those belong to later phases and should not be mixed into adapter work.

### Required adapter families

The repo should keep `source_system.family`, source kind, and trust lane as separate concepts.

Current code already defines these `source_system.family` values in `SourceSystemFamilySchema`:

- `hsds_api`
- `hsds_tabular`
- `partner_api`
- `partner_export`
- `government_open_data`
- `allowlisted_scrape`
- `manual`

That family layer should remain coarse. More specific intake identities such as host portal, community submission, manual admin correction, reverification, or regression-origin changes should be represented through source kind, feed identity, policy lane, and metadata rather than by exploding the family enum for every workflow.

The important rule is not inventing more family labels. It is that every intake path must have:

- one source system family
- one source feed
- one immutable source record per inbound object or change event
- one deterministic policy lane

### Assertion envelope requirements

Every `source_record` created in Phase 2 should carry enough structure to drive later canonical merge and review without fetching the original source again.

Minimum required fields:

- `source_feed_id`
- `source_record_type`
- `source_record_id`
- `canonical_source_url` when the concept exists
- `payload_sha256`
- `raw_payload`
- `parsed_payload`
- `correlation_id`
- `source_confidence_signals`
- `processing_status`

Minimum `source_confidence_signals` contract:

- `origin_family`
- `ingest_method`
- `authenticated_source`
- `domain_verified`
- `url_verified`
- `structural_completeness`
- `anomaly_flags`
- `fast_track_candidate`
- `policy_lane`
- `prompt_version` when LLM extraction or classification participates

### Trust lanes and approval policy

The repo should implement explicit policy lanes on top of assertions, not inside UI conditionals or route-local heuristics.

#### Lane 1: Verified publisher fast-track

This lane applies when the record arrives through:

- a preapproved URL in the source registry, or
- an approved linked API / feed connection

Required conditions:

- source policy lane is trusted for auto-publish
- confidence is above the configured floor
- no hard anomalies are present
- URLs validate and match source policy
- required fields are complete
- taxonomy is retained and crosswalked
- dedupe / identity checks do not produce unresolved conflicts

Result:

- auto-approve / auto-publish
- no normal admin review required
- provenance, anomaly result, and policy decision must still be recorded

#### Lane 2: High-confidence discovered source

This lane applies when the agent discovers a service from a non-registered source but deterministic checks are strong.

Required conditions:

- confidence is above the quick-review floor
- no hard anomalies are present
- the source is not yet in the preapproved registry

Result:

- route to admin queue
- mark as `quick_approve_candidate`
- show a high-confidence badge
- always attach a machine-generated note explaining what is still missing

The note should name the blocking gaps precisely, for example:

- source not yet allowlisted
- canonical URL could not be verified
- taxonomy crosswalk incomplete
- organization identity unresolved

#### Lane 3: User-submitted

This lane applies to seeker or public user-submitted records.

Required behavior:

- create a source assertion for the submitted payload
- run the AI / pipeline pass against that assertion
- send the result to community admin review with explicit confidence and anomaly badges

Allowed outcomes:

- approve
- deny
- edit and approve
- return to submitter for more information

#### Lane 4: Organization-submitted

This lane applies to approved organizations or approved organization domains.

Policy:

- org submission should become auto-approvable only when the organization itself is already trusted and its domain/feed is recorded in source policy
- approval of the organization should add or update the corresponding allowlisted source policy entry

Result:

- before organization trust is established: normal review lane
- after organization trust is established: fast-track lane with anomaly fallback

### Phase 2 implementation order

This is the safest order for parallel work.

#### Step 1. Finish adapter contract definitions

Add the written contract first:

- source system families
- source record type vocabulary
- policy lane vocabulary
- anomaly vocabulary
- fast-track decision rules

Primary docs:

- `docs/contracts/INGESTION_CONTRACT.md`
- new source policy / fast-track spec

#### Step 2. Convert feed polling from heartbeat to assertion ingest

Current state:

- `pollFeeds()` only updates timestamps

Required state:

- each feed poll writes `source_records`
- records are deduped by feed + record type + record id + payload hash
- due-feed polling becomes a real source assertion producer

Important boundary:

- it is acceptable in Phase 2 to stop after assertion creation plus queueing
- it is not acceptable to keep pretending polling is ingestion if no assertion is created

#### Step 3. Convert CSV / HSDS import into assertion ingest

Current state:

- CSV importer validates files and produces reports only

Required state:

- each imported HSDS object becomes a `source_record`
- external identifiers are preserved
- taxonomy terms are stored in `source_record_taxonomy`
- the batch report references created source record ids

Important rule:

- CSV import should not insert directly into live HSDS tables as its primary contract

#### Step 4. Create first-class adapters for user, community, and admin manual submissions

Required adapters:

- `community_submission`
- `manual_admin`
- `org_submission`

These may still create `submissions`, but they must also create corresponding `source_records`.

#### Step 5. Make scrape pipeline assertion-aware

Current state:

- URL ingestion creates evidence snapshots and extracted candidates

Required state:

- each fetched resource or extracted record produces a first-class assertion object
- evidence remains linked, but the assertion becomes the normalized upstream contract

This is important for later replay, canonical merge, and LLM reproducibility.

### Non-overlap guidance for parallel work

If another agent is already implementing canonical or live projection work, Phase 2 should not compete with that lane.

Phase 2 may safely touch:

- `src/agents/ingestion/service.ts`
- `src/app/api/admin/ingestion/feeds/poll/route.ts`
- `db/import/hsds-csv-importer.ts`
- source adapter helpers
- intake route payload contracts
- source policy docs

Phase 2 should avoid owning:

- canonical child table expansion
- publish projector internals
- seeker query grammar refactor
- HSDS export projector logic

### Verification requirements for Phase 2

Each adapter family should have replayable fixture coverage.

Minimum test pattern:

1. fixed input fixture
2. created `source_system` / `source_feed` if needed
3. created `source_record`
4. preserved external IDs and taxonomy
5. deterministic policy lane result
6. deterministic anomaly set

Minimum repo invariants after Phase 2:

- no new intake adapter lands outside `source_records`
- no approved source bypass lacks a recorded source policy decision
- no fast-track publish occurs without immutable source retention
- no manual or user submission exists without an assertion counterpart

### Phase 2 exit criteria

Phase 2 is complete when:

- every active intake surface creates assertions first
- feed polling is real ingestion or is disabled
- CSV / HSDS import creates assertion records
- source policy lanes are explicit and testable
- quick-approve and fast-track badges are driven by policy data, not UI guesswork
- later canonical/projector work can safely assume `source_records` is the universal intake ledger

## Phase 3 Extension: Expand Canonical Coverage

Date: 2026-03-08

This section extends `Phase 3: Expand Canonical Coverage` against the current repo state after the source assertion layer and first canonical federation slice landed.

### Current repo alignment

The repo now has a real canonical base:

- `0033_canonical_federation_layer.sql` created `canonical_organizations`, `canonical_services`, `canonical_locations`, `canonical_service_locations`, and `canonical_provenance`
- Drizzle schema and persistence stores exist for those tables
- Phase 2 follow-up work added missing store parity and test coverage, per `docs/ENGINEERING_LOG.md`
- `entity_identifiers` is already available as the cross-system identity layer

That means Phase 3 is no longer about inventing canonical storage. It is about expanding it from a parent-entity skeleton into an operational truth model that can actually support HSDS fidelity, ORAN taxonomy, review, chat, search, dedupe, and future LLM assistance.

### Why Phase 3 is mandatory

The current canonical layer is still too thin for the actual data model already implied by the repo and by `211_info_001.md`.

What the repo needs to reason about:

- multiple phones and contacts with access/privacy semantics
- multiple addresses and service-location relationships
- schedules and temporary availability messaging
- eligibility and required-document structure
- languages and interpretation availability
- service areas and geographic coverage
- external taxonomy plus ORAN concept derivation
- field-level winner selection with replayable provenance

What the current canonical layer can represent directly:

- one organization row
- one service row
- one location row
- one service-location join row
- provenance rows attached to fields already materialized elsewhere

That gap is exactly where later inconsistency will come from if Phase 3 is underspecified.

### Canonical design rules

Phase 3 should follow these rules strictly:

1. Source losslessness stays upstream. `source_records` and `source_record_taxonomy` preserve what arrived.
2. Canonical only normalizes what ORAN needs to reason over deterministically.
3. Fields that drive search, trust, review, export, or dedupe must not live only in opaque JSON.
4. Provenance must be field-level for winning values and list-member level for repeated structures.
5. Canonical is the only place where ORAN-only semantics and HSDS-aligned semantics meet.
6. LLM output may propose canonical values, but canonical acceptance remains rule-driven and auditable.

### Required canonical expansion

The next canonical slice should add child structures in two groups.

#### Group A: must become first-class canonical tables

These structures are operationally important and cannot remain implicit:

- `canonical_addresses`
- `canonical_phones`
- `canonical_contacts`
- `canonical_schedules`
- `canonical_languages`
- `canonical_service_areas`
- `canonical_service_taxonomy_links` or equivalent concept-link table

Reason:

- they are repeated structures
- they drive search, trust, export, and review
- they need provenance and diffing
- they appear directly in HSDS/211 source material

#### Group B: can remain scalar fields or constrained JSON on canonical parents

These fields matter, but they do not all need full child-table treatment on day one:

- `application_process`
- `interpretation_services`
- `wait_time`
- `fees_type`
- `fees_description`
- `eligibility_description`
- `document_requirements_description`
- `document_requirement_types`
- `temporary_message`
- `source_meta_status`
- `source_meta_last_verified`
- `source_meta_last_updated`

Rule:

- if a field becomes filterable, comparable, or independently reviewed later, it should graduate from scalar/JSON to a first-class canonical child model

### Canonical taxonomy contract

Phase 3 should not treat taxonomy as a side table attached late in publish.

It should create one deterministic concept bridge:

- external taxonomy terms remain preserved in `source_record_taxonomy`
- canonical concept links attach services to ORAN-operational meaning
- seeker-facing tags, search presets, profile selectors, and chat hints are derived from canonical concepts, not from ad hoc string chips

This is the critical rule for longevity:

- HSDS codes are preserved
- ORAN concepts are operational
- seeker labels are projections

That prevents the repo from choosing between “HSDS correctness” and “ORAN usability.” It keeps both.

### Normalization and merge contract

Phase 3 should build a deterministic `source_record -> canonical graph` normalizer with these stages:

1. Parse source family specific payload shape.
2. Produce a normalized entity graph for org, service, locations, and child records.
3. Attach preserved external identifiers.
4. Link retained external taxonomy payload.
5. Run deterministic identity resolution.
6. Apply winner selection into canonical rows and provenance.

Identity resolution should stay deterministic first:

- exact external identifier match
- source-system scoped identifier match
- exact canonical URL match where policy allows it
- exact normalized org/service/location tuple match

LLMs may assist later with review suggestions, but they should not become merge authority.

### Phase 3 implementation order

#### Step 1. Expand canonical schema and stores

Add the canonical child tables first, with:

- lifecycle and publication fields only where they are genuinely needed
- foreign keys back to canonical parent entities
- indexes aligned to projected reads and merge lookups
- store interfaces and tests at parity with existing canonical stores

#### Step 2. Build family-specific normalizers

Prioritize in this order:

- `hsds_api` sources with `verified_publisher` trust
- `partner_export` sources with approved policy lanes
- host portal assertions
- community/manual submission assertions
- allowlisted or discovered scrape assertions

Reason:

- HSDS/211 must define the structure target
- host/community paths should converge toward the same shape
- scrape paths are the noisiest and benefit from a clear target schema

#### Step 3. Build canonical merge + provenance writes

For each field family:

- record proposed value
- decide accepted or superseded value deterministically
- record why the winner won
- record which source record supplied it

#### Step 4. Derive ORAN concept links from canonical truth

Do not derive seeker-facing chips directly from raw source payloads once canonical concept links exist.

#### Step 5. Feed publish readiness from canonical completeness

Publish readiness should start reading canonical completeness and provenance quality instead of candidate-only staging artifacts.

### Non-overlap guidance for Phase 3

Phase 3 safely owns:

- canonical schema expansion
- canonical stores and tests
- normalizers
- deterministic merge logic
- provenance enrichment
- canonical concept-link derivation

Phase 3 should avoid owning:

- live-table projector cutover
- seeker UI filter rewrites
- final HSDS export endpoints
- adapter-family assertion coverage already claimed in Phase 2

### Verification requirements for Phase 3

Each canonical family needs replayable fixture coverage.

Minimum pattern:

1. fixed `source_record` fixture in
2. normalized canonical graph out
3. deterministic merge result
4. deterministic provenance rows
5. idempotent second replay
6. stable identifiers after replay

Additional required checks:

- repeated child items do not duplicate on replay
- superseded values are retained in provenance
- ambiguous identity collisions route to review, not silent merge
- canonical concept derivation is deterministic from the same canonical input

### Phase 3 exit criteria

Phase 3 is complete when:

- canonical parents plus required child families exist and are tested
- at least HSDS/211, host, and user/community input families can normalize into canonical form
- provenance can explain every accepted canonical field that matters for publish/search/review
- ORAN concept derivation is attached to canonical truth, not candidate strings
- later projector work can consume canonical state without consulting raw source payloads for common fields

## Phase 4 Extension: Build The Publish Projector

Date: 2026-03-08

This section extends `Phase 4: Build The Publish Projector` against the current repo state.

### Current repo alignment

The repo already has the published read model and active read surfaces:

- Zone C live tables are defined in `src/db/schema.ts`
- search, directory, chat, and public organization/service routes already read from those tables
- `livePublish.ts` currently writes directly from ingestion candidates into live tables
- regression scans and suppression logic already mutate live lifecycle state
- `hsds_export_snapshots` exists, but is currently generated from the direct publish path rather than a canonical projector

So Phase 4 is not “create live storage.” It is “replace direct write paths with one canonical-to-live projector.”

### Publish projector objective lock

Phase 4 should do one thing clearly:

- accepted canonical state becomes the only source for seeker-visible live records

That means:

- projector writes published HSDS-shaped rows
- all direct candidate-to-live writes are deprecated
- live tables remain a read model, not an intake model

### Projector responsibilities

The projector should own these responsibilities and nothing more:

- upsert `organizations`, `services`, `locations`, and `service_at_location`
- upsert dependent child rows: phones, addresses, contacts, schedules, eligibility, service areas, service taxonomy, languages, and accessibility-related rows where they are part of the published model
- set or update live status fields based on canonical publication decisions
- invalidate and replace derived export snapshots
- emit lifecycle/audit events for publish, update, suppress, withdraw, and republish

The projector should not own:

- source trust policy
- anomaly detection
- admin review routing
- canonical winner selection

Those decisions happen before the projector runs.

### Projector design rules

Phase 4 should follow these rules:

1. Projector input is canonical state plus publication decision, not raw candidate data.
2. Projector output is idempotent. Replaying the same canonical snapshot produces the same live state.
3. Live rows are a projection and may be rebuilt from canonical + source evidence.
4. Publish and update should be transactionally consistent per service graph.
5. Projector should diff child rows instead of append-only duplication.
6. Fast-track and manual review both end in the same projector path.

### Direct-write paths that must be retired behind the projector

Priority targets:

- `src/agents/ingestion/livePublish.ts`
- any remaining host/admin route that mutates published service content directly
- ad hoc `hsds_export_snapshots` generation disconnected from canonical publish

### Phase 4 implementation order

#### Step 1. Define the projector contract

Write the canonical-to-live mapping before implementation:

- canonical field source
- live target table/column
- transform rules
- nullability behavior
- child-row replacement semantics
- export snapshot triggers

#### Step 2. Implement projector writes in shadow mode

Before cutover:

- compute projector output from canonical state
- compare to current live result for the same logical entity
- log structured diffs for taxonomy, location, phones, schedules, service areas, and trust display inputs

#### Step 3. Cut ingestion publish over first

Replace candidate direct publish with:

- canonical acceptance
- projector execution
- live read model update

This is the highest-value cutover because it removes the most structurally incorrect path first.

#### Step 4. Cut manual/admin/host publication paths over

Once the projector is stable, all human-approved publish/update actions should end there too.

#### Step 5. Rebuild export snapshots from projected live state

The same publication event that updates live rows should also refresh the export snapshot tied to the published service graph.

### Performance and reliability requirements

The projector should be built for replay and scale, not just happy-path insert.

Required properties:

- hash or version-based no-op detection for unchanged projections
- per-entity transactional writes
- deterministic ordering of repeated children
- retry-safe upserts
- structured diff logs for failure triage
- ability to reproject a service graph from canonical state without rereading source feeds

### Non-overlap guidance for Phase 4

Phase 4 safely owns:

- projector contract
- projector implementation
- shadow diff tooling
- cutover of publish routes to projector
- export snapshot generation from projected state

Phase 4 should avoid owning:

- source assertion adapter expansion
- canonical schema expansion beyond what projector needs to consume
- query grammar redesign
- seeker-facing filter UX redesign

### Verification requirements for Phase 4

Minimum test matrix:

1. canonical fixture -> live table graph
2. second replay -> no duplicate children
3. canonical update -> correct live diff
4. canonical withdraw/suppress -> correct live lifecycle change
5. export snapshot refresh -> current snapshot only
6. shadow diff against legacy publish behavior for representative records

Critical invariants:

- no seeker-visible record exists without canonical provenance behind it
- no publish path bypasses the projector after cutover
- no child table silently accumulates stale rows after projection updates
- regression suppression remains compatible with projector-owned publication status

### Phase 4 exit criteria

Phase 4 is complete when:

- ingestion publish no longer writes live tables directly
- approved publish/update flows all converge through the projector
- projector replays are idempotent
- export snapshots are refreshed from projected state
- live rows can be regenerated from canonical state without relying on staging candidates

## Phase 5 Extension: Unify Query Grammar

Date: 2026-03-08

This section extends `Phase 5: Unify Query Grammar` against the current repo state.

### Current repo alignment

The repo currently has multiple overlapping query grammars:

- `GET /api/search` accepts `taxonomyIds`, `attributes`, `preset`, confidence, geo, and organization filters
- chat requests accept only `taxonomyTermIds` and a `trust` band, then rely on `retrievalProfile.ts` to inject additional signals
- seeker profile stores `serviceInterests`, `selfIdentifiers`, `accessibilityNeeds`, delivery preferences, urgency, and documentation barriers as app-defined enums/strings
- the directory UI still exposes string category chips like `food`, `housing`, `legal aid`, and a separate taxonomy dialog
- search presets are curated in code, not attached to a canonical concept registry

The search engine is already capable of more than the public/query-layer contracts admit. The inconsistency is at the API and selector layer.

### Phase 5 objective lock

Phase 5 should create one shared discovery contract for:

- directory
- chat retrieval
- admin preview/review surfaces
- saved searches and future notifications

That does not mean every UI must expose UUIDs or raw taxonomy trees. It means every UI should compile into the same canonical filter grammar.

### Target query model

The unified query grammar should have two layers.

#### Layer A: canonical filter envelope

This is the machine contract:

- `needConceptIds`
- `populationConceptIds`
- `situationConceptIds`
- `accessTags`
- `deliveryTags`
- `cultureTags`
- `costTags`
- `taxonomyTermIds` for HSDS compatibility and advanced admin use
- `trustMinBand`
- `organizationId`
- `geo`
- `sort`

#### Layer B: seeker-facing selector bundles

This is the human contract:

- “Food”
- “Need help today”
- “No ID”
- “By phone”
- “Veteran-friendly”
- “Spanish”

Those are labels and presets that compile down into Layer A.

That is the important unification move:

- keep UX simple
- keep query semantics strict

### Profile selector redesign

The current seeker profile mixes two different concerns:

- retrieval-relevant selectors
- expressive personal/profile fields

Phase 5 should separate them cleanly.

Retrieval-relevant selectors should move toward canonical concept-backed IDs for:

- primary needs
- populations/identities relevant to service fit
- barriers and access constraints
- delivery preferences
- urgency
- language/cultural preferences

Expressive profile fields should remain distinct and optional:

- pronouns
- profile headline
- avatar theme
- contact details
- freeform context

Rule:

- expressive fields may inform conversation tone or UI personalization later
- they should not silently alter retrieval unless explicitly mapped and consented

### Chat alignment rule

Chat should stop relying on one-off vocabulary bridges as the long-term contract.

Target behavior:

- profile hydration loads selector IDs or canonical concept refs
- intent enrichment may suggest additional query constraints
- chat retrieval compiles into the same search envelope the directory uses
- LLM output may suggest filters, but a deterministic compiler validates and canonicalizes them before retrieval

This preserves future LLM flexibility without letting prompt behavior redefine the search contract.

### Directory alignment rule

The directory should keep human-readable chips and presets, but those chips should come from the same registry that chat/profile/admin use.

That means:

- no permanent free-text category chip vocabulary living only in the page client
- taxonomy dialog terms should be resolved through the same concept registry/crosswalk
- preset definitions should be data-backed or registry-backed rather than hardcoded in multiple places

### Admin and review alignment rule

Admin review surfaces need the same grammar for two reasons:

- preview what seekers/chat will actually retrieve
- explain why a service matched or failed

That means review tools should be able to render:

- canonical concepts attached to the service
- derived seeker labels
- HSDS taxonomy terms retained upstream
- trust and anomaly badges using the same public semantics

### Performance and privacy requirements

Phase 5 should improve consistency without making retrieval slower or more invasive.

Required properties:

- compile selectors to a stable cache key where personalization is allowed
- preserve chat cache bypass for authenticated personalized turns
- keep location approximate unless explicit higher-precision consent exists
- avoid hydrating unnecessary personal fields into retrieval
- precompile selector registries and label bundles instead of resolving them ad hoc per request

### Phase 5 implementation order

#### Step 1. Define a shared discovery contract

Create one written contract for:

- canonical filter envelope
- public trust band semantics
- selector bundle serialization
- URL/query param encoding rules

#### Step 2. Introduce a canonical selector registry

This registry should bind:

- ORAN concept IDs
- optional linked HSDS taxonomy terms
- seeker-facing labels
- profile selector availability
- directory chip/preset membership

#### Step 3. Migrate chat/profile/directory compilers

Move each surface from local mapping logic to the shared compiler:

- profile selectors -> discovery envelope
- directory chips/presets -> discovery envelope
- chat intent/profile hints -> discovery envelope

#### Step 4. Add admin preview using the same compiler

Admins should be able to preview seeker-visible matching logic from the same query model.

### Non-overlap guidance for Phase 5

Phase 5 safely owns:

- discovery contract definitions
- selector registry
- query parser/serializer/compiler
- profile-to-query mapping
- chat/directory/admin query convergence

Phase 5 should avoid owning:

- source adapter work
- canonical merge internals
- live projector internals
- HSDS import connector specifics beyond selector/crosswalk needs

### Verification requirements for Phase 5

Minimum parity suite:

1. the same logical selector bundle compiled from directory, chat, and profile yields the same discovery envelope
2. the same discovery envelope produces the same eligible service universe across directory and chat retrieval
3. trust bands resolve to the same numeric floor everywhere
4. selector serialization round-trips through URL/query params without drift
5. unrecognized LLM-proposed selectors are rejected or downgraded deterministically

### Phase 5 exit criteria

Phase 5 is complete when:

- directory, chat, and admin preview use the same underlying filter grammar
- seeker profile retrieval selectors are canonical-registry backed
- human-friendly chips/presets are projections, not separate truth systems
- trust filtering semantics are consistent everywhere
- future LLM retrieval assistance can only operate through the shared compiler

### Phase 5 execution checkpoint

Date: 2026-03-08

After the implementation and re-audit pass, the seeker-side Phase 5 lane is materially complete:

- discovery need IDs are now the shared selector registry for seeker interests, chat intent categories, and quick category chips
- directory, map, and chat now compile and preserve the same canonical discovery URL grammar
- service detail, report, saved, and chat result links now carry the same discovery context instead of resetting users into blank browse states
- blank seeker entry points now seed from the stored canonical discovery preference when no explicit discovery URL is present
- chat result cards now explain fit from stored taxonomy, stored attribute facts, and explicit browse/profile context rather than opaque retrieval behavior

The re-audit result is:

- seeker/profile/chat query convergence is now in place
- trust floor semantics are consistent across browse and chat retrieval
- selector serialization round-trips cleanly through canonical URL state
- ORAN admin now has a thin `discovery-preview` consumer of the same grammar, so phase-level compiler parity now extends to review tooling as intended
- unsupported attribute selectors are rejected deterministically at the shared compiler boundary instead of leaking through URL state or future LLM suggestions

Phase 5 can now be treated as complete in this lane. The next seeker-side follow-on is no longer query grammar; it is privacy/trust alignment for profile save consent and cross-device sync behavior.

### Seeker Privacy And Sync Checkpoint

Date: 2026-03-08

The immediate privacy/trust follow-on to Phase 5 is now materially complete in this lane:

- device-level sync consent is centralized in one shared helper rather than embedded ad hoc in individual seeker pages
- profile writes to `/api/profile` are local-first by default and only persist cross-device after explicit sync opt-in
- saved-service bookmark flows now respect the same consent boundary; saved page, service detail, and chat save toggles no longer silently call `/api/saved` when sync is off
- explicit account actions remain intentionally server-backed: notification preferences, password change, export, and delete are still authenticated account operations

Re-audit result:

- seeker personalization now follows one auditable persistence rule instead of separate profile-vs-bookmark behavior
- user-facing copy, privacy docs, and flow evidence now match the implemented consent model
- account-state and sync-state explanation is now materially stronger: the seeker shell updates same-tab for saved-state, city, personalization, and sync toggles instead of waiting for navigation
- bookmark flows are now unified across browse and detail/chat surfaces through one saved-client contract plus one device sync policy
- point-of-action save-scope explanation is now also unified across high-frequency bookmark controls, with one wording contract for local-only versus synced-account outcomes
- the next seeker-side follow-on is no longer basic consent drift; it is deepening result-trust explanation inside cards and preview surfaces without expanding data collection

## Phase 6 Extension: Finish 211 / HSDS Integration

Date: 2026-03-08

This section extends `Phase 6: Finish 211 / HSDS Integration` against the current repo state and `211_info_001.md`.

### Current repo alignment

The repo now has meaningful HSDS groundwork:

- source assertion layer exists
- canonical parent layer exists
- live read model already resembles HSDS tables
- `hsds_export_snapshots` exists
- `source_record_taxonomy` preserves some external taxonomy data

But several integration gaps remain:

- `db/import/hsds-csv-importer.ts` still validates more than it ingests
- no official HSDS API connector writes assertions yet
- `source_record_taxonomy` is too thin for the hierarchy/target payload in `211_info_001.md`
- there is no deterministic external-term to canonical-concept crosswalk yet
- export snapshots are not yet driven from canonical/projected truth

### HSDS/211 integration objective lock

Phase 6 should guarantee dual conformance:

- ORAN operational semantics stay in canonical
- HSDS interoperability stays intact on import and export

That means the repo must preserve the source standard without forcing the rest of the app to speak raw HSDS everywhere.

### Import contract from `211_info_001.md`

The 211 export shape shown in `211_info_001.md` carries nested:

- organization
- services
- locations
- contacts
- phones
- schedules
- taxonomy with hierarchy levels and targets
- application process
- fees
- languages
- eligibility
- service areas
- documents
- meta status/timestamps

Phase 6 should import that shape with these rules:

- preserve the raw payload in `source_records`
- create per-object assertion boundaries for organization, service, and location entities where useful for replay and merge
- derive service-location links from `locationIds`
- preserve nested contacts/phones/schedules/taxonomy/service-area structures either as child assertion payloads or structured parsed payload fragments
- preserve `meta` timestamps and status values upstream even if ORAN uses different live/public status semantics

### Taxonomy preservation contract

`source_record_taxonomy` needs a richer contract than “name + code + label”.

At minimum, Phase 6 should preserve:

- taxonomy registry name
- source term ID if present
- external code
- preferred label
- hierarchy levels 1-6
- target codes/labels
- source record linkage
- source feed / source system lineage
- mapping status to canonical concept

If the current table cannot carry that cleanly, Phase 6 should extend it or add dedicated external taxonomy registry tables. The repo should not flatten AIRS/211 structure into ORAN tags and call that fidelity.

### Crosswalk contract

The external-to-canonical taxonomy bridge should be explicit and versioned.

Required properties:

- one external term may map to one or more canonical concepts
- ambiguous mappings must be reviewable and cannot be silently forced
- canonical concept derivations should record mapping version
- unchanged external term mappings should be replay-stable

This is where reproducibility comes from:

- fixed source term
- fixed crosswalk version
- fixed derived canonical concepts

### Programs and not-yet-operational entities

`211_info_001.md` includes `programs`, even if the example is empty.

The repo should not throw that away just because the current seeker model is service-centric.

Recommended rule:

- preserve program payloads upstream immediately
- only normalize into canonical program entities when there is an operational use case
- do not block Phase 6 on a full program domain model if the app does not use it yet

That keeps import fidelity high without forcing premature product surface area.

### Export contract

Export should be rebuilt from canonical truth plus preserved external mappings, not from ad hoc live-write side effects.

Preferred behavior:

- live tables remain the published HSDS-shaped read model
- `hsds_export_snapshots` are generated from the projector output and canonical lineage
- when an original trusted external taxonomy code exists and remains valid for the published service, export should preserve it
- ORAN-only semantics such as internal trust reasoning, anomaly flags, or review notes should stay out of the public HSDS payload unless the profile explicitly supports them

### Fast-track policy for approved HSDS/211 sources

Verified publisher auto-approval should be policy-driven and deterministic.

Required gates:

- `source_system.trust_tier` supports fast-track
- authenticated feed or allowlisted domain verified
- payload structure validates against the accepted HSDS profile
- required publish fields are complete after normalization
- canonical URL and source URL checks pass where applicable
- entity resolution produces no unresolved conflict
- taxonomy crosswalk coverage meets the configured threshold
- no hard anomalies remain

Any failure should downgrade to review rather than partially auto-publish.

### Phase 6 implementation order

#### Step 1. Finish HSDS assertion adapters

Build:

- verified HSDS API fetch adapter
- CSV/partner export assertion ingest
- record batching with correlation IDs

#### Step 2. Expand taxonomy preservation and crosswalk storage

Do this before mass import so the repo does not ingest lossy external taxonomy from day one.

#### Step 3. Normalize HSDS assertions into canonical graphs

Use the Phase 3 canonical model as the target and keep registry/version metadata attached.

#### Step 4. Project canonical publish state back into HSDS-shaped live/export state

This is where dual conformance becomes real rather than aspirational.

### Non-overlap guidance for Phase 6

Phase 6 safely owns:

- HSDS connectors
- HSDS import mapping specs
- external taxonomy retention and crosswalk registry
- HSDS export contract tests

Phase 6 should avoid owning:

- generic query grammar work outside taxonomy/crosswalk needs
- non-HSDS adapter families already covered by Phase 2
- projector internals beyond required export hooks

### Verification requirements for Phase 6

Minimum contract suite:

1. replay fixed HSDS/211 fixtures from `211_info_001.md`-style payloads
2. assert preserved raw payload + source lineage
3. assert preserved taxonomy hierarchy and targets
4. assert deterministic canonical normalization
5. assert deterministic projector output into live HSDS-shaped tables
6. assert export snapshot shape and retained identifiers/taxonomy/meta

Critical checks:

- service areas survive import and export
- languages and interpretation data do not collapse into one vague tag
- location links survive through `service_at_location`
- export never invents unsupported HSDS fields
- approved-source fast-track and downgrade-to-review decisions are reproducible

### Phase 6 exit criteria

Phase 6 is complete when:

- approved HSDS/211 feeds can ingest into assertions cleanly
- external taxonomy is preserved with hierarchy and mapping lineage
- canonical truth can represent the imported HSDS fields ORAN actually uses
- published live/export state can be regenerated deterministically from canonical state
- fast-track decisions for verified publishers are policy-backed and auditable

## Phase 7 Extension: Retire Legacy Paths

Date: 2026-03-08

This section extends `Phase 7: Retire Legacy Paths` against the current repo state.

### Current repo alignment

The repo is already partway through a transition, which means retirement must be managed carefully.

Still-live legacy or duplicate paths include:

- legacy `ingestion_sources` compatibility thinking, even though `source_systems` now exists
- direct candidate-to-live publishing in `livePublish.ts`
- duplicated category/filter vocabularies across directory, chat, profile, and ingestion tags
- importer flows that still behave like validators more than ingestion
- review surfaces that still think in terms of live-row mutation more than source/canonical provenance

### Retirement rules

Phase 7 should follow strict rules:

1. no legacy path is removed until the replacement path is live, tested, and observed
2. compatibility shims get explicit expiration criteria
3. no new code is allowed to target retired contracts once replacement exists
4. all cutovers are measurable via metrics and audit logs

### Retirement order

#### Step 1. Freeze legacy truth expansion

Before deletion:

- block new architecture work from landing on legacy contracts
- mark deprecated adapters/routes/docs clearly
- keep read compatibility where needed

#### Step 2. Retire direct-to-live publish paths

Once Phase 4 projector is live:

- remove or hard-disable candidate direct publish
- remove route-local live mutation shortcuts
- route all publish/update operations through canonical + projector

#### Step 3. Retire duplicate selector vocabularies

Once Phase 5 shared discovery grammar is live:

- remove page-local category vocabularies where possible
- deprecate hardcoded profile selector enums that no longer map directly
- keep UX labels, but source them from the shared registry

#### Step 4. Retire HSDS-lossy import shortcuts

Once Phase 6 is live:

- stop any import path that discards external taxonomy structure
- stop treating validation-only import scripts as production ingestion

#### Step 5. Retire stale docs and drifted contracts

All historical docs can remain, but current docs must stop implying obsolete paths are authoritative.

### Observability and rollback

Retirement is only safe if the repo can detect bad cutovers quickly.

Required signals:

- count of writes per legacy path
- count of writes per new path
- shadow diff counts during overlap windows
- publish failures by phase/projector step
- search/chat retrieval parity checks after query-grammar cutover
- HSDS import/export contract failures by source family

Rollback rule:

- rollback may restore the prior write path temporarily
- rollback must not discard source assertions or canonical state already captured

### Non-overlap guidance for Phase 7

Phase 7 safely owns:

- deprecation flags
- compatibility shims
- cutover metrics
- route/doc retirement
- cleanup sequencing

Phase 7 should avoid owning:

- net-new schema design
- net-new search semantics
- net-new publish logic outside final cutover and cleanup

### Verification requirements for Phase 7

Minimum checks:

1. no writes hit retired paths in normal operation
2. all legacy compatibility layers log usage until removed
3. cutover metrics show the new path serving all intended traffic
4. docs and ADRs reflect the new source->canonical->live contract

### Phase 7 exit criteria

Phase 7 is complete when:

- deprecated direct-write and duplicate-grammar paths are either removed or hard-disabled
- legacy compatibility layers are no longer needed for active workflows
- docs no longer present retired paths as current architecture
- audits can explain the entire journey from source assertion to published read model without legacy exceptions

## Verification Matrix Extension

The earlier verification strategy remains correct, but the repo now needs a phase-indexed matrix so implementation and audit can stay synchronized.

### Phase 2 matrix

- adapter fixture replay
- source policy lane assertions
- fast-track vs quick-review decision tests
- assertion idempotency tests

### Phase 3 matrix

- canonical normalization fixture replay
- deterministic merge tests
- provenance winner/supersede tests
- child-row idempotency tests

### Phase 4 matrix

- projector parity/shadow tests
- live child-row diff tests
- publish/update/withdraw lifecycle tests
- export snapshot refresh tests

### Phase 5 matrix

- query compiler parity tests across directory/chat/admin
- selector registry round-trip tests
- trust-band parity tests
- personalized retrieval cache-behavior tests

### Phase 6 matrix

- HSDS fixture import tests
- taxonomy hierarchy/target preservation tests
- canonical crosswalk determinism tests
- HSDS export contract tests

### Phase 7 matrix

- deprecation path usage tests
- cutover metric assertions
- compatibility shim expiry checks
- documentation/ADR alignment review

## Validation Performed For This Completion Pass

This completion pass was re-checked against the current repo before the re-audit sections were finalized.

Validated directly in code/docs:

- Phase 1 and Phase 2 movement recorded in `docs/ENGINEERING_LOG.md`
- source assertion primitives and canonical federation tables in `src/db/schema.ts`
- current family/trust contracts in `src/agents/ingestion/contracts.ts`
- feed polling still acting as heartbeat rather than assertion ingest in `src/agents/ingestion/service.ts`
- direct candidate-to-live publish path and snapshot generation in `src/agents/ingestion/livePublish.ts`
- current search grammar in `src/app/api/search/route.ts` and `src/services/search/types.ts`
- current chat retrieval/profile compiler in `src/services/chat/retrievalProfile.ts` and `src/services/profile/chatHydration.ts`
- current seeker selector and chip drift in `src/app/(seeker)/profile/ProfilePageClient.tsx` and `src/app/(seeker)/directory/DirectoryPageClient.tsx`
- current HSDS/211 example shape in `211_info_001.md`

Purpose of this section:

- confirm which earlier assumptions were still true
- correct stale assumptions before finalizing the plan
- anchor the later-phase recommendations to the actual repo baseline, not the earlier audit baseline

## Re-Audit Pass 1: Internal Consistency

Date: 2026-03-08

After completing the detailed Phase 3-7 plan, I re-audited the document against the repo and corrected several weak points.

### Findings from pass 1

- Earlier repo-wide assessment language could be misread as “Zone C has no Drizzle coverage.” Current code proves live tables are defined in `src/db/schema.ts`; the real gap is projector ownership, not schema absence.
- Phase 3 originally risked over-normalizing every HSDS field immediately. The revised plan now distinguishes must-normalize child structures from scalar/JSON fields that can wait.
- Phase 5 originally risked forcing raw taxonomy complexity directly into seeker UI. The revised plan keeps human labels and presets, but makes them projections over one canonical discovery grammar.
- Phase 6 originally risked treating `programs` as either mandatory now or irrelevant forever. The revised plan preserves program payloads upstream immediately without blocking the rest of the integration on a full program model.

### Adjustments made after pass 1

- clarified that live tables already exist and are the read/export model
- tightened the canonical expansion scope to the structures the repo must reason about operationally
- clarified the two-layer query model: strict machine envelope, simple human selector bundles
- added an explicit preservation-first rule for not-yet-operational HSDS entities

## Re-Audit Pass 2: Longevity, Reproducibility, And Parallel Safety

Date: 2026-03-08

I then re-audited the completed plan again with four stress questions:

- Will this still work after more ingestion sources land?
- Will this still work after deeper LLM assistance is introduced?
- Can two agents work in parallel without architectural collision?
- Can a future audit reconstruct why a published record looked the way it did?

### Findings from pass 2

- The plan is only durable if all policy decisions become data-backed and versioned. That includes fast-track thresholds, crosswalk versions, prompt versions, anomaly vocabularies, and selector registries.
- The plan is only reproducible if LLMs never become direct truth setters. They can suggest, classify, or summarize, but every retrieval, merge, and publish decision must flow back through deterministic validators and versioned contracts.
- The plan is only parallel-safe if work ownership stays separated by phase boundary: adapter/assertion work, canonical/merge work, projector work, query grammar work, and HSDS connector/crosswalk work.
- The plan is only audit-safe if source assertions, canonical provenance, publish events, and export snapshots can be replayed together for the same entity graph.

### Adjustments made after pass 2

- strengthened versioning requirements for policy lanes, crosswalks, prompts, and selector registries
- reinforced that LLM participation stays inside auditable suggestion/validation boundaries
- made non-overlap guidance explicit in every major phase section
- emphasized replayability from `source_records` through canonical truth to live/export projection

### Final completion statement

This document is complete for the current planning objective when read together with the earlier sections.

Its recommended end-state remains:

- one database
- immutable source assertions first
- canonical ORAN + HSDS-aligned truth second
- explicit review and policy lanes third
- one projector into the seeker-facing HSDS-shaped read model fourth
- one shared discovery grammar for directory, chat, profile, and admin preview
- preserved HSDS/211 fidelity and deterministic export built into the architecture, not added later
