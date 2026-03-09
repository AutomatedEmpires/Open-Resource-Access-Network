# Repository Pipeline Unification Enhancement Audit

Date: 2026-03-08

This report complements:

- `reports/repo_pipeline_consistency_audit.md`
- `reports/repo_pipeline_reunification_plan.md`

This pass is narrower and more operational. It focuses on what should be improved next so intake, review, taxonomy, chat, profile, search, and HSDS/211 integration all converge on one reproducible system.

## Decision

The repo should unify around one center:

- `source_records` as the immutable inbound assertion ledger
- canonical ORAN entities as the normalized system of record
- `submissions` as workflow and review state
- published live tables as seeker-facing projections

That means:

- no intake path should write seeker-facing live data as its primary storage contract
- no review action should mutate confidence by hard-coded score bumps
- no UI selector should be “personal” in one layer and “untyped string hint” in another
- no HSDS/211 import should bypass source retention, taxonomy retention, crosswalk retention, and canonical merge logic

## Findings

### 1. Intake paths still terminate in different systems

Evidence:

- `src/app/api/host/claim/route.ts:107` inserts live `organizations` and `services` first, then creates a `submissions` row.
- `src/app/api/host/services/route.ts:249` inserts live `services` first, then enqueues verification.
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts:84` publishes ingestion candidates directly to live tables, then backfills `submissions`.
- `docs/solutions/IMPORT_PIPELINE.md:10` still marks staging/diff/publish wiring as planned.

Why this matters:

- the same entity can enter the system with different provenance quality
- review sees different artifacts depending on entry point
- publish behavior is harder to reproduce because there is no single pre-publish contract

Improvement:

- every intake surface should first produce an immutable inbound record
- `source_systems` should represent not only external APIs but also `host_portal`, `community_report`, `manual_admin`, `csv_import`, and `scrape`
- `submissions` should reference reviewable work generated from those assertions, not stand in for them

### 2. Taxonomy is still split across multiple incompatible vocabularies

Evidence:

- `src/domain/taxonomy.ts:1` defines ORAN service-attribute taxonomies
- `src/components/ui/category-picker.tsx:24` exposes a separate preset category vocabulary
- `src/services/profile/contracts.ts:4` defines app-specific `serviceInterests`
- `src/services/chat/types.ts:14` defines chat intent categories that do not match the ORAN taxonomy contract one-to-one
- `src/app/(seeker)/directory/DirectoryPageClient.tsx:76` still uses text-based category chips like `food` and `mental health`

Why this matters:

- “food”, “food_assistance”, a taxonomy UUID, and an AIRS/211 code can all mean the same thing in different parts of the app
- mappings become hidden, brittle, and impossible to audit at scale
- HSDS alignment remains lossy because external taxonomy is being squeezed into UI categories and lowercased term-name matching

Improvement:

- create one formal taxonomy registry with namespaces:
- `external.airs_211`
- `oran.service_attributes`
- `oran.persona_filters`
- `oran.query_macros`
- every selector, filter, chat intent, and import crosswalk should reference canonical IDs from that registry
- human-readable labels can vary by UI, but the IDs cannot

### 3. Profile personalization is not yet a canonical retrieval contract

Evidence:

- `src/services/profile/contracts.ts:27` stores several fields as loose strings or generic string arrays
- `src/app/(seeker)/profile/ProfilePageClient.tsx:83` defines personable UI options, but they are still app-defined enums
- `src/services/profile/chatHydration.ts:80` hydrates them directly into chat context as generic tags
- `src/services/chat/retrievalProfile.ts:11` then remaps them again into ORAN-like attributes with hard-coded lookup tables

Why this matters:

- the user sees a personal profile experience, but the system underneath still treats much of it as lossy hints
- chat relevance becomes hard to explain because there is no stable “profile selector -> canonical filter” record
- profile improvements risk breaking chat retrieval unless multiple mapping tables are updated together

Improvement:

- split profile data into three explicit lanes:
- personal expression
- matching preferences
- optional sensitive assistance flags
- store matching preferences and optional assistance flags as canonical taxonomy or facet IDs, not loose strings
- keep expressive UI copy separate from storage IDs

### 4. Chat still uses a narrower and different query grammar than search and directory

Evidence:

- `src/services/chat/types.ts:60` only supports `taxonomyTermIds` and `trust`
- `src/components/chat/ChatWindow.tsx:200` only exposes trust and taxonomy filters
- `src/services/chat/orchestrator.ts:120` uses keyword-based intent categories
- `src/services/chat/intentEnrich.ts:45` enriches only into those same categories
- `src/services/chat/retrievalProfile.ts:149` builds a query that still depends on category text and profile-derived remaps
- `src/services/search/types.ts:20` already supports richer `attributeFilters`

Why this matters:

- chat, directory, and map are not guaranteed to retrieve the same service set for the same need
- chat is still partially category-driven while search is more filter-driven
- future LLM integration would amplify inconsistency unless the underlying query contract is unified first

Improvement:

- define one shared `ServiceQuery` grammar for search, map, chat, profile-based retrieval, imports, and review previews
- it should support trust floor, explicit taxonomy terms, ORAN attribute filters, service-area filters, language filters, delivery/access filters, location bias, and deterministic query macros

### 5. Confidence and publish readiness are still not one auditable system

Evidence:

- `src/services/scoring/scorer.ts:4` defines seeker-facing trust and blended scores
- `src/agents/ingestion/scoring.ts:46` defines a different ingestion confidence model
- `src/agents/ingestion/publish.ts:72` uses a publish threshold based on readiness plus score
- `src/app/api/community/queue/[id]/route.ts:311` can hard-code an approval outcome into `confidence_scores` as `80/80/50/50`

Why this matters:

- review decisions are not fully reproducible from structured evidence
- two identical services can end up with different trust semantics depending on the path that approved them
- confidence becomes a workflow convenience rather than an auditable product contract

Improvement:

- collapse scoring into one evidence-driven trust model
- review should append verification events and anomaly resolutions
- confidence recomputation should derive from those events, never from route-level constants

### 6. HSDS and 211 fidelity is still incomplete in both schema and publish logic

Evidence:

- `211_info_001.md:143` shows taxonomy hierarchy and `targets`
- `src/db/schema.ts:1270` stores only `taxonomy_name`, `term_code`, `term_name`, `term_uri`, and `is_primary`
- `src/db/schema.ts:1520` models `canonical_service_locations` too thinly for true location-specific service behavior
- `src/agents/ingestion/livePublish.ts:360` maps categories to `service_taxonomy` by lowercased term-name matching
- `src/agents/ingestion/livePublish.ts:124` builds a minimal HSDS payload that does not preserve the full 211 object richness

Why this matters:

- AIRS/211 data cannot be round-tripped cleanly
- imported `serviceAtLocation`, `serviceAreas`, `languages`, `documents`, `eligibility`, and `meta` can be flattened or lost
- downstream export fidelity degrades as soon as data enters the current publish path

Improvement:

- preserve the full external taxonomy hierarchy and target terms
- expand canonical child structures so HSDS concepts map cleanly before publication
- generate HSDS exports from canonical and published ORAN data, not from a minimal side payload

### 7. Review surfaces are still live-record centric instead of provenance centric

Evidence:

- `src/app/api/community/queue/[id]/route.ts:119` loads submission plus live service plus live organization
- `src/app/(community-admin)/verify/VerifyPageClient.tsx:211` presents review as a live detail screen
- `src/app/(oran-admin)/approvals/ApprovalsPageClient.tsx:237` is optimized for claim rows, not assertion provenance or field-level diff evidence

Why this matters:

- reviewers are not consistently shown what came from where
- external-source fast-track review is harder to justify because the dossier is not source-aware
- field-level approval, denial, and anomaly resolution are harder to operationalize

Improvement:

- move review UI to a provenance-first dossier
- every dossier should show inbound assertion snapshot, canonical merge diff, taxonomy crosswalk decisions, anomalies, prior verification history, and resulting publish projection preview

### 8. Privacy and trust contracts drift from implementation in profile and reporting flows

Evidence:

- `src/app/(seeker)/profile/ProfilePageClient.tsx:7` claims local-only storage and explicit consent before server sync
- `src/app/(seeker)/profile/ProfilePageClient.tsx:597` auto-syncs authenticated seeker profile changes
- `docs/SECURITY_PRIVACY.md:93` documents opt-in profile saving
- `src/app/api/submissions/report/route.ts:74` synthesizes `anon_${ip}` as a submitter identifier for anonymous reports

Why this matters:

- consent expectations and actual persistence behavior are misaligned
- anonymous reporting and identity modeling are not cleanly separated
- future deeper personalization or LLM support will be hard to defend unless storage and consent semantics are explicit

Improvement:

- make sync consent explicit in product and storage
- separate anonymous reporter fingerprinting from user identity
- ensure profile hydration only uses fields the user actually consented to persist server-side

### 9. Performance and operational maturity are uneven across pipelines

Evidence:

- `src/services/search/cache.ts:55` skips cache for personalized queries entirely
- `src/agents/ingestion/service.ts:198` feed polling currently just marks feeds as polled
- `src/agents/ingestion/persistence/sourceRegistryStore.ts:1` still uses legacy `ingestion_sources`

Why this matters:

- personalized retrieval cannot scale as efficiently as it should
- approved feeds are not yet real first-class ingestion lanes
- legacy registry paths can undermine source policy consistency

Improvement:

- use normalized query signatures for low-risk personalized cache reuse
- fully migrate source policy reads to `source_systems` and `source_feeds`
- make feed polling delta-aware, idempotent, and hash-driven

## Recommended Enhancement Model

### A. Make all intake paths assertion-first

Apply this contract to:

- host organization claims
- host service submissions and edits
- ingestion agent scrape runs
- partner APIs
- 211 and HSDS APIs
- CSV imports
- community reports
- admin manual corrections

Required behavior:

- every inbound payload produces a `source_records` row or equivalent immutable assertion record
- `source_systems.family` identifies the origin class and policy lane
- `submissions` references reviewable work generated from those assertions
- canonical merge happens before any seeker-facing publish

Result:

- one reproducible intake contract
- one provenance model
- one audit trail across all channels

### B. Distinguish four data layers clearly

Layer 1: `source`

- immutable inbound assertions
- raw payload
- parsed payload
- source taxonomy snapshot
- external IDs

Layer 2: `canonical`

- ORAN-normalized organizations, services, locations, service-location relationships, schedules, contacts, service areas, languages, eligibility, documents, and attributes
- field-level provenance

Layer 3: `workflow`

- reviewer assignment
- anomalies
- approvals and denials
- SLA and escalation
- fast-track policy state

Layer 4: `published`

- seeker-facing tables
- search projection
- map projection
- HSDS export snapshots

### C. Expand the canonical model before trying to perfect import or chat behavior

The current canonical layer is not rich enough yet. At minimum add child tables for:

- canonical service taxonomy links
- canonical service areas
- canonical languages
- canonical eligibility
- canonical documents
- canonical schedules
- canonical phones and contacts
- canonical temporary messages
- canonical service-location overrides
- canonical fees and funding notes

Without these, HSDS fidelity and profile/chat matching will continue to flatten too much meaning.

## Taxonomy Unification Plan

### 1. Create a formal taxonomy registry and crosswalk ledger

Add a unified taxonomy model with:

- namespace
- stable term ID
- display label
- parent term
- version
- effective dates
- source system
- deprecation status

Add a crosswalk ledger with:

- external taxonomy term ID
- canonical ORAN term or facet IDs
- mapping type: exact, broader, narrower, composite, unsupported
- rationale
- reviewer
- mapping confidence
- version

### 2. Expand `source_record_taxonomy`

The current table is too thin for 211 fidelity. Add support for:

- external taxonomy namespace and version
- full hierarchy path
- level fields
- target code and target term
- raw external taxonomy object snapshot
- order and cardinality metadata

### 3. Stop using term-name matching as the bridge

`livePublish.ts` currently bridges categories to `service_taxonomy` by lowercased term-name equality. Replace that with:

- explicit external ID retention
- explicit crosswalk lookup
- explicit fallback state when no approved mapping exists

That change is mandatory for accuracy and reproducibility.

## Intake and Review Enhancements by Channel

### Host Portal

Problems:

- creates live records too early
- permits direct status writes
- category UI is not tied to canonical taxonomy IDs

Improvements:

- host creates or edits a draft assertion bundle, not live rows
- host status becomes workflow status, not publication status
- category selection uses canonical taxonomy IDs and ORAN facets
- preview shows the exact seeker-facing result before review

### Community Reports

Problems:

- reporting is submission-centric but not assertion-centric
- approval can hard-code confidence outcomes

Improvements:

- reports create issue assertions attached to canonical or published entities
- reviewer outcomes append verification events and anomaly resolutions
- trust recalculation becomes deterministic from evidence and outcomes

### Ingestion Agent Pipeline

Problems:

- pipeline still terminates in a direct live publish path
- feed polling and source registry are not fully converged on the new source layer

Improvements:

- treat scrape extraction as one adapter into the same assertion-first path
- keep LLM output as suggestions with evidence references only
- require publish to flow through canonical merge and projection publishing, not raw row insertion

### Approved APIs and 211/HSDS Feeds

Problems:

- approved feeds are not yet first-class operational lanes
- HSDS fidelity is not preserved end-to-end

Improvements:

- create approved feed adapters that ingest to `source_records`
- preserve external IDs and full taxonomy structure
- use fast-track rules only after structural validation, identifier validation, source policy validation, and anomaly detection

## Shared Scoring and Trust Model

Use one trust contract with explicit subscores:

- source integrity
- structural completeness
- canonical mapping fidelity
- operational verifiability
- human review state
- anomaly penalty

Derived outputs:

- `trust_score`: seeker-facing verification trust
- `publish_decision`: unpublished, review, fast-track, publishable, quarantined
- `match_score`: search and chat relevance fit, computed separately from trust

Rules:

- trust never includes personalization
- match never overrides trust
- review decisions never write raw trust numbers directly
- all trust changes must be explainable from evidence and events

## Profile and Personalization Redesign

### 1. Separate personal expression from matching cleanly

Personal expression:

- display name
- pronouns
- profile headline
- avatar
- theme

Matching preferences:

- preferred language
- location bias
- preferred delivery
- schedule preference
- documentation barriers
- transportation barriers
- urgency

Optional assistance flags:

- veteran
- refugee or asylum seeker
- domestic violence survivor
- disability-related access needs
- pregnancy or postpartum
- caregiver

### 2. Store canonical IDs under human copy

The user should see:

- “I need help today”
- “Phone or online only”
- “No ID with me right now”
- “Show me places with interpretation”

The system should store:

- canonical ORAN facet IDs
- explicit macro expansion records
- consent state for each stored preference lane

### 3. Make current-services and benefits more structured

`currentServices` should not remain a loose app list. It should become a structured benefits and enrollment vocabulary so the system can make better suggestions such as:

- complementary services
- renewal help
- document help
- upstream referral sequencing

## Chat Unification Plan

### 1. Replace category-only intent with a structured intent envelope

Minimum structured intent fields:

- need taxonomy candidates
- action intent
- urgency
- location cue
- delivery constraint
- language cue
- explicit exclusions
- trust floor

### 2. Make chat use the same retrieval grammar as search and directory

Chat should call the same query engine with the same normalized filter object as other seeker surfaces. The differences should be:

- different default sort weights
- conversational explanation
- optional LLM summarization after retrieval

### 3. Keep LLMs inside bounded roles

Allowed future roles:

- intent suggestion
- taxonomy suggestion
- anomaly suggestion
- reviewer draft notes
- seeker-facing summarization

Disallowed roles:

- publishing records
- writing trust scores directly
- inventing taxonomy assignments without evidence
- bypassing canonical merge

### 4. Add why-this-matched explanations

Each chat result should be able to explain itself from stored facts:

- matched your same-day help preference
- offers phone intake
- marked no referral needed
- tagged for veterans

That explanation should come from canonical facts and trusted crosswalks, not from LLM invention.

### Phase 5 Re-Audit Checkpoint

Date: 2026-03-08

The seeker/profile/chat Phase 5 work is now substantially tighter than the original audit baseline.

Implemented in the repo:

- one shared discovery grammar across directory, map, chat, saved, service detail, report, and seeker fallback links
- one shared discovery-need registry across seeker profile interests, quick chips, and chat intent categories
- stored seeker discovery preferences now seed blank directory, map, and chat entry points without overriding explicit URLs
- chat fit explanations now come from stored taxonomy, stored attributes, and explicit browse/profile context rather than LLM narration

Re-audit result:

- the admin-side preview gap is now closed with a first-class ORAN-admin consumer of the same discovery compiler
- the shared compiler now rejects unsupported attribute selector dimensions/tags deterministically instead of letting them drift through free-form URL state
- there is no longer a remaining seeker-surface continuity break large enough to justify another Phase 5 seeker rewrite before moving on
- explicit profile save consent and saved-bookmark sync semantics are now aligned to one device-level consent boundary instead of drifting between profile and bookmark surfaces
- seeker personalization writes are now local-first by default; authenticated server writes only begin after explicit cross-device sync opt-in
- same-tab seeker shell continuity is now materially tighter: saved counts, approximate city, personalization cues, and sync-state chips update immediately from shared client events instead of waiting for route changes
- bookmark behavior is now unified across directory, map, chat, detail, and saved flows instead of splitting browse surfaces from account-aware surfaces
- save controls now explain their scope consistently at the point of action, using one shared wording contract for local-only versus synced-account effects
- explicit account actions remain server-backed by design: notification preferences, password change, export, and delete are still authenticated account operations rather than silent personalization sync
- the current blocker to calling the broader repo green is outside this lane: parallel ingestion and taxonomy-federation work still owns the repo-wide `tsc` failures

## HSDS and 211 Integration Refinement

### 1. Preserve source truth losslessly

For each inbound 211 bundle:

- store organization, service, location, and `serviceAtLocation` source assertions
- store external IDs in `entity_identifiers`
- store `meta.lastUpdated`, `meta.lastVerified`, `meta.status`, and temporary messages
- store taxonomy hierarchy and targets

### 2. Map into richer canonical ORAN entities

Map these explicitly:

- organization -> canonical organization
- service -> canonical service
- location -> canonical location
- `serviceAtLocation` -> canonical service-location row plus location-specific overrides
- taxonomy -> canonical taxonomy links plus crosswalk ledger
- service areas -> canonical service-area rows
- languages -> canonical language rows
- eligibility -> canonical eligibility rows
- documents -> canonical document rows

### 3. Publish all sitewide data through the same ORAN model

Imported 211 data and ORAN-native data should both render from the same published ORAN projection. That is the only way to keep:

- uniform seeker display
- uniform search behavior
- uniform trust messaging
- uniform export generation

## Performance and Reproducibility Enhancements

### 1. Introduce deterministic artifacts per pipeline run

Every intake path should be able to emit:

- raw assertion snapshot
- normalized assertion JSON
- crosswalk result JSON
- canonical merge decision JSON
- publish projection snapshot
- trust explanation snapshot

This becomes the replayable unit for debugging, auditing, and regression testing.

### 2. Build a shared search projection

Use a published read model optimized for:

- directory
- map
- chat retrieval
- admin preview

That projection should precompute:

- trust band
- searchable text
- common filter facets
- service area coverage summary
- canonical and published IDs

### 3. Add low-risk personalized cache signatures

Do not cache against raw full profiles. Instead cache against:

- normalized filter signature
- city bias
- trust floor
- stable preference macro IDs

This preserves privacy while recovering cache efficiency for repeatable personalized paths.

## Security and Trust Hardening

Required changes:

- explicit profile sync consent in product and docs
- separate anonymous reporter fingerprinting from user identity
- no route-level hard-coded trust writes
- reviewer actions must append auditable events
- approved source tiers must be policy-driven from `source_systems`
- LLM suggestions must be stored as suggestions with model metadata, prompt version, and evidence refs

## Alternatives Considered

### Option 1. Keep separate pipelines and patch inconsistencies

Pros:

- fastest short-term
- smallest immediate refactor

Cons:

- inconsistency becomes permanent
- every new channel adds another translation layer
- HSDS and profile/chat drift continue

Verdict:

- reject

### Option 2. Use `submissions` as the main intake store

Pros:

- simpler workflow story
- easier reviewer queue integration

Cons:

- weak source retention
- poor external feed fidelity
- wrong abstraction for immutable source assertions

Verdict:

- reject

### Option 3. Full event-sourced redesign

Pros:

- maximum replayability
- maximum audit depth

Cons:

- too large for current repo maturity
- slows down delivery of HSDS/211 and seeker improvements

Verdict:

- reject for now

### Recommended option

- assertion-first
- canonical-first
- workflow-overlay
- published-projection

This is the strongest balance of correctness, longevity, reproducibility, and implementation realism.

## Near-Term Corrections Before Larger Refactor

Make these first:

- stop direct confidence bumping in `src/app/api/community/queue/[id]/route.ts`
- stop direct-to-live as the primary contract for host create and edit flows
- unify category selection on canonical taxonomy IDs
- align profile sync implementation with documented consent behavior
- replace lowercased taxonomy term-name matching in ingestion publish with explicit crosswalk lookups
- migrate source policy reads away from legacy `ingestion_sources`

## Verification Plan

### Contract Tests

- one golden fixture per intake type
- the same fixture must produce the same canonical result and publish projection every run

### Taxonomy Tests

- crosswalk snapshot tests
- unsupported-term tests
- hierarchy and target retention tests for 211 fixtures

### Pipeline Replay Tests

- replay saved assertions through canonical merge and publish
- confirm stable outputs when code and mapping versions are unchanged

### Search and Chat Parity Tests

- the same normalized query must produce the same eligible service set in directory, map, and chat
- only sort and explanation may differ

### Trust Tests

- every trust change must be explainable from source evidence, verification events, and anomaly state
- no direct score mutation allowed in routes

### Review UX Tests

- per-service review dossier must display source snapshot, canonical diff, anomalies, and resulting publish preview

## Docs to Update Together

- `docs/SECURITY_PRIVACY.md`
- `docs/CHAT_ARCHITECTURE.md`
- `docs/SCORING_MODEL.md`
- `docs/solutions/IMPORT_PIPELINE.md`
- `src/services/profile/README.md`
- `src/services/chat/README.md`
- a new taxonomy crosswalk and HSDS mapping spec
- a new source policy and fast-track ingestion spec

## Final Recommendation

Do not treat this as a chat problem, an import problem, or a 211 problem separately.

The repo needs one disciplined data contract:

- all inputs become assertions
- all assertions merge into canonical ORAN entities
- all review happens against provenance-aware diffs
- all seeker surfaces read from one published ORAN projection
- all HSDS and 211 interoperability is retained upstream and exported downstream from that same unified model

That is the path that best supports longevity, reproducibility, accuracy, trust, performance, and future LLM-assisted workflows without turning the system into an opaque black box.

## Current Repo Movement And Next-Phase Boundary

Date: 2026-03-08

I reviewed the current repo state again before extending the plan.

### What has actually moved

The repo now contains the start of a real assertion-first correction:

- host portal intake has a dedicated synthetic assertion adapter
- host service create / active edit / active archive now create source assertions and workflow payloads
- service-verification approval can apply approved payloads to live services
- source policy reads now bridge through `source_systems`
- ingestion publish no longer creates a fake already-approved submission after publishing

This means the reunification plan is no longer purely theoretical. Phase 1 has visible code movement.

### What should happen next

The next planning focus should not be “more host portal cleanup.” It should be:

- make assertions mandatory for every remaining intake family
- define explicit trust lanes for:
  - verified publisher auto-approve
  - high-confidence quick-review
  - user-submitted review
  - organization-submitted trust escalation
- ensure those lanes are policy outputs, not route-level branching lore

### Why this boundary matters

Another agent can work on canonical coverage and projector work in parallel.

To avoid collision:

- this lane should own adapter contracts, source policy, feed ingest, CSV ingest, and assertion coverage
- that other lane should own canonical schema expansion, canonical merge, entity resolution, and live projection

### Objective restated

The objective is still one unified system:

- every input becomes an assertion
- every assertion gets a deterministic trust lane
- canonical and live layers can then assume consistent upstream structure

The detailed Phase 2 plan now lives in:

- `reports/repo_pipeline_reunification_plan.md`
