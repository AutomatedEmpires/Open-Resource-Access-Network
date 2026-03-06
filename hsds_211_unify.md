# ORAN HSDS / 211 Unification Plan

Status: Draft architecture memo
Date: 2026-03-06
Scope: HSDS-compatible, taxonomy-federated, provenance-preserving, dedupe-capable, locally verifiable, nationally aggregatable resource pipeline for ORAN

## Purpose

This document defines how ORAN can integrate Open Referral HSDS, 211 ecosystem data, and related public resource datasets without discarding ORAN's existing strengths:

- evidence-backed ingestion
- trust-aware verification
- human review and publish gates
- deterministic confidence scoring
- merge and regression workflows
- seeker-oriented search tags and safety constraints

The goal is not to replace ORAN with a generic HSDS directory. The goal is to make ORAN:

- a high-quality HSDS consumer
- a high-quality HSDS publisher
- a federation and verification layer for national resource data

## Non-Negotiables

Any HSDS / 211 integration MUST preserve ORAN's existing safety contract.

- Retrieval-first: seeker-visible facts must come from stored records only.
- No hallucinated facts: names, addresses, phones, hours, eligibility, and URLs must originate from stored records.
- Crisis gate remains first: 911 / 988 / 211 routing still short-circuits normal retrieval.
- Eligibility caution remains: ORAN may suggest likely fit, but must not guarantee eligibility.
- Privacy remains intact: approximate location by default and explicit consent before persistent profile saves.
- No LLM in retrieval or ranking: LLM may assist ingestion, normalization, tagging, and post-retrieval summarization only.

## Working Thesis

ORAN should treat HSDS as the interoperability and exchange contract around a stronger internal trust system.

That means:

- ORAN keeps its internal review, evidence, scoring, and publication controls.
- ORAN adds a canonical federation layer that is HSDS-aligned.
- ORAN publishes a documented ORAN HSDS Profile for extensions that HSDS does not model directly.
- ORAN preserves external source assertions instead of flattening them into one "last import wins" record.

## Architecture Decisions Locked

The following decisions are accepted and should be treated as implementation constraints.

### 1. Canonical authority split

- ORAN owns internal trust, review state, scoring, provenance, moderation, and publish readiness.
- HSDS defines the interoperable resource structure and exchange surface.
- Base HSDS fields must remain exportable without leaking ORAN-only trust state into standard resource facts.

### 2. Standards strategy

- ORAN must support strict/base HSDS compatibility for import, export, and tool interoperability.
- ORAN must also define an ORAN HSDS Profile for trust, verification, provenance, and other ORAN-specific extensions.
- Base HSDS compatibility is the minimum bar; the ORAN profile is the long-term contract.

### 3. Taxonomy mediation strategy

- External HSDS / 211 taxonomy does not replace ORAN tags.
- ORAN tags do not become the canonical exchange taxonomy.
- The canonical bridge is:

`external taxonomy term -> ORAN canonical concept -> ORAN seeker tag(s) + ORAN scoring signals`

- Export to HSDS is derived from ORAN canonical concepts plus preserved external mappings.
- Confidence scoring, trust signals, and seeker tags remain ORAN-native and are not downgraded to raw HSDS taxonomy.

### 4. Intake unification rule

- Every intake path must land in the same source assertion model first.
- This includes HSDS feeds, 211 partner feeds, public-sector structured data, allowlisted scrape intake, and user-submitted/admin-submitted resources.
- No path may write directly to canonical entities or live ORAN service rows.

### 5. Round-trip fidelity rule

- ORAN must preserve source identifiers, source taxonomy codes, profile references, and field lineage wherever licensing permits.
- If ORAN ingests HSDS-native data, export should preserve enough lineage to round-trip cleanly into HSDS-oriented ecosystems.
- Tool compatibility with the HSDS ecosystem, including validator/debugging workflows, is a first-class requirement.

## Strategic Outcome

If executed well, ORAN becomes:

- HSDS-compatible
- taxonomy-federated
- provenance-preserving
- dedupe-capable
- locally verifiable
- nationally aggregatable

That is a stronger position than being only a scraper, only a 211 directory, or only a standards-compliant export.

## What We Learned From HSDS / Open Referral / 211 Research

### 1. HSDS is an exchange model, not a mandated internal database

HSDS explicitly allows systems to maintain their own internal storage model as long as what they publish conforms to HSDS schemas and API expectations.

Implication for ORAN:

- ORAN does not need to abandon its current internal workflow.
- ORAN does need a normalization and publication layer that accurately maps internal records to HSDS.

### 2. Modern HSDS is profile-friendly

HSDS supports Profiles for domain-specific requirements, constraints, and extensions.

Implication for ORAN:

- ORAN should publish an ORAN HSDS Profile rather than overloading base HSDS informally.
- ORAN-specific trust, provenance, and verification extensions should be profile-defined and documented.

### 3. Taxonomy is flexible, but taxonomy governance matters

HSDS can carry taxonomy and taxonomy term information, but it does not force one taxonomy. Open Referral expects external taxonomies to be common.

Implication for ORAN:

- ORAN should support multiple taxonomy families.
- ORAN should not hard-replace its existing tags with one external taxonomy.
- ORAN needs a crosswalk and canonical concept layer.

### 4. Stable identifiers are essential for national federation

HSDS requires UUID object ids internally, but also strongly encourages publication of third-party identifiers and identifier schemes.

Implication for ORAN:

- national dedupe should not rely only on fuzzy matching
- source-specific identifiers, organization identifiers, and location identifiers must become first-class data

### 5. AIRS / 211 is operationally important, but not always operationally open

The AIRS / 211 taxonomy is widely used and should be treated as a high-value external taxonomy. Licensing and redistribution must be handled deliberately.

Implication for ORAN:

- ORAN should plan for crosswalking and licensed ingest where permitted
- ORAN should not assume all 211 ecosystem assets are freely redistributable

### 6. ServiceNet is useful as a pattern library

The ServiceNet repo shows practical patterns:

- source/provider-specific adapters
- preserving provider identifiers
- taxonomy import separate from service import
- scheduled feed updates
- public record and taxonomy APIs

Implication for ORAN:

- build connector-per-source-family adapters
- preserve source-system lineage throughout normalization and merge

## Current ORAN Strengths We Must Preserve

ORAN already has valuable infrastructure that many standards-compliant systems lack.

### Ingestion and provenance

- source registry / allowlist and quarantine logic
- evidence snapshots
- discovered-link and extraction workflows
- candidate staging and review state

### Verification and trust

- deterministic confidence scoring
- verification queue / submissions workflow
- review and publish gates
- confidence regression detection

### Dedupe and merge

- merge workflows for duplicate organizations and services
- transactional reassignment and archival patterns

### Search experience

- seeker-facing service attribute tags that are more operationally useful than raw taxonomy codes alone

The plan in this memo assumes ORAN keeps these capabilities and layers HSDS compatibility around them.

## Target Architecture

The target architecture is a six-layer model.

### Layer 1: Source Acquisition

Source families to support:

- HSDS JSON APIs
- HSDS Tabular Data Packages / CSV exports
- ServiceNet-style provider feeds
- 211 and AIRS-adjacent partner exports
- federal, state, county, and municipal open data portals
- curated partner lists
- ORAN allowlisted scrape sources
- manual and admin-submitted records

Each source MUST be registered with:

- source system name
- source family
- canonical source URL
- licensing / redistribution notes
- update frequency
- trust tier
- jurisdiction coverage
- field availability expectations
- contact / escalation owner

### Layer 2: Raw Source Assertions

Every inbound record should be stored as an immutable source assertion before canonicalization.

In this plan, "source assertion model" is the logical concept. The first physical implementation may use `source_records` and `source_record_fields` tables, but those tables together are the single required assertion layer for every intake path.

Recommended fields:

- source_assertion_id
- source_system
- source_record_type
- source_record_id
- fetched_at
- raw_payload
- parsed_payload
- content_hash
- source_license
- terms_of_use
- source_confidence_signals
- evidence_refs

Principle:

- never collapse directly from feed into live ORAN service rows

### Layer 3: Canonical Federation Model

Normalize source assertions into an ORAN Canonical Resource model that is HSDS-aligned.

Core canonical entities:

- canonical_organization
- canonical_service
- canonical_location
- canonical_service_at_location
- canonical_address
- canonical_phone
- canonical_schedule
- canonical_taxonomy
- canonical_taxonomy_term
- canonical_attribute_assignment
- canonical_identifier
- canonical_provenance_assertion
- canonical_cluster

This model should support both:

- direct publication to HSDS
- internal mapping to ORAN live services

### Layer 4: Taxonomy Federation Layer

Maintain three classification layers:

1. External taxonomy terms

- AIRS / 211
- partner-specific taxonomies
- domain-specific coded sets

1. ORAN canonical concepts

- internal, stable, license-safe concepts that act as the semantic bridge

1. ORAN seeker tags

- delivery
- cost
- access
- culture
- population
- situation
- adaptations
- dietary

This allows ORAN to federate nationally without degrading seeker usability.

Export and scoring rules:

- external taxonomy terms are preserved for interoperability and round-trip fidelity
- ORAN canonical concepts are the decision point for normalization and conflict resolution
- ORAN seeker tags and confidence logic are derived from canonical concepts plus evidence, not from raw external taxonomy alone

### Layer 5: Resolution, Verification, and Merge

Canonical entities should be clustered and reviewed before publication.

Resolution pipeline:

- deterministic identifier match
- deterministic source lineage match
- address / phone / domain / geo blocking
- similarity candidate generation
- model-assisted duplicate scoring
- human merge review where ambiguity remains

Verification pipeline:

- source trust
- evidence completeness
- cross-source agreement
- freshness
- local admin verification
- user-reported regressions

### Layer 6: Publication and Interoperability

Approved canonical records should publish to:

- ORAN live retrieval model
- ORAN public HSDS JSON export
- ORAN tabular export where useful
- ORAN read-only HSDS API surface
- ORAN HSDS Profile artifacts used by external validators and HSDS-oriented tooling

Minimum API conformance target:

- `GET /`
- `GET /services`
- `GET /services/{id}`

Optional endpoints to add after the minimum set stabilizes:

- `GET /organizations`
- `GET /organizations/{id}`
- `GET /taxonomies`
- `GET /taxonomy_terms`
- `GET /service_at_locations`

## Canonical Data Model Changes Recommended For ORAN

These are the most important additions or refinements.

### 1. Make external identifiers first-class

ORAN should store external identifiers for:

- organizations
- locations
- services
- taxonomies
- taxonomy terms
- source assertions

Recommended columns / objects:

- identifier_scheme
- identifier_value
- identifier_type
- issuing_authority
- source_system
- confidence
- active_flag

For organizations, use HSDS-style organization identifiers wherever possible.

### 2. Add a source assertion table family

ORAN currently has ingestion evidence and extracted candidates. Add persistent source assertion tables so that federation is not just a staging concern.

Suggested entities:

- source_systems
- source_feeds
- source_assertions
- source_assertion_fields
- canonical_entity_links
- canonical_merge_decisions

### 3. Separate canonical truth from source truth

Canonical records should not overwrite the raw incoming assertion history.

Instead:

- source says one thing
- another source says another thing
- ORAN canonical record reflects the reviewed best current understanding
- provenance records preserve the disagreement and reasoning

### 4. Expand HSDS-aligned structures where ORAN lags

Items to support more explicitly over time:

- organization_identifier
- location external identifiers
- richer taxonomy and taxonomy_term structures
- generic attribute assignments
- service capacities where relevant
- additional URLs
- metadata objects and profile declaration

### 5. Preserve ORAN-specific trust metadata separately

Do not pollute core service facts with trust state when publishing.

Keep ORAN trust extensions in profile-defined structures such as:

- verification_status
- verification_confidence
- evidence_count
- freshness_window
- cross_source_agreement_score
- locally_verified_by
- reverify_at

## Taxonomy Strategy

### Objective

Support national interoperability without sacrificing ORAN's seeker-first filtering model.

### Policy

- external taxonomies are ingested and preserved exactly where licensing permits
- ORAN canonical concepts mediate between taxonomies
- ORAN seeker tags remain the operational search layer

### Why this is necessary

Raw external taxonomies are often:

- too large for direct seeker use
- too licensing-sensitive to republish casually
- too provider-specific for consistent UX

ORAN tags are better for retrieval-time decision support, but they are not a sufficient exchange standard by themselves.

### Proposed mapping chain

`external taxonomy term -> ORAN canonical concept -> ORAN seeker tag(s)`

Examples:

- AIRS / 211 term for emergency food assistance -> canonical concept `food.emergency_pantry` -> seeker tags `free`, `walk_in`, `in_person`, `ebt_snap` if supported by evidence
- provider-specific housing placement code -> canonical concept `housing.rapid_rehousing` -> seeker tags driven by access and eligibility facts

### Crosswalk table requirements

Recommended crosswalk attributes:

- external_taxonomy_id
- external_term_code
- external_term_name
- canonical_concept_id
- mapping_type (`exact`, `broader`, `narrower`, `approximate`, `manual_review_required`)
- evidence_basis
- reviewer_id
- reviewed_at
- confidence

### Licensing rules

Before operationalizing AIRS / 211 taxonomy ingest:

- verify license rights for storage
- verify license rights for redistribution
- verify whether ORAN may expose raw codes publicly or only internal mappings

## Identifier Strategy

### Internal identifiers

Use UUIDs for canonical HSDS-facing entities.

### External identifiers

Preserve all useful identifiers with scheme metadata.

Priority order for organizations:

1. primary legal identifiers
2. secondary official identifiers
3. trusted third-party identifiers
4. local source identifiers

### Location identity

Location matching should use:

- external location ids where available
- normalized address fingerprint
- geo point
- building / suite / access point detail

### Service identity

Service identity is often the hardest problem. ORAN should not define service equality by name alone.

Service identity should consider:

- parent organization identity
- normalized service concept
- service-at-location relationship
- jurisdiction / coverage
- access modality
- source lineage

## Dedupe and Entity Resolution Strategy

### Dedupe goal

Detect duplicates accurately enough for national aggregation without over-merging distinct local services.

### Resolution stages

#### Stage 1: Deterministic resolution

Auto-link when any of these match strongly:

- same source system and same source record id
- same official organization identifier
- same location external identifier
- same canonical URL plus same normalized phone
- same exact organization name plus same normalized address

#### Stage 2: Candidate generation

Generate possible duplicates using:

- name similarity
- token overlap
- TF-IDF similarity
- shared domain
- shared phone
- shared address
- same city / state / postal code
- geo distance
- taxonomy overlap
- ORAN seeker tag overlap

#### Stage 3: Model-assisted scoring

Potential useful features from HSDS-oriented dedupe models and ORAN-specific features:

- Jaro-Winkler and Levenshtein ratios
- token sort and token overlap
- TF-IDF weighted text similarity
- normalized address equality
- geo distance bucket
- same city / state / ZIP flags
- same domain flag
- same phone flag
- taxonomy overlap score
- source trust score
- cross-source agreement count

The Connect211 LightGBM HSDS dedupe model is useful as a reference for feature families, but ORAN should treat it as one component rather than final truth.

#### Stage 4: Outcome routing

Possible outcomes:

- exact match, auto-link
- likely duplicate, review queue
- same organization but distinct service
- related but not mergeable
- no match, create new canonical entity

#### Stage 5: Merge lineage preservation

After merge, ORAN must preserve:

- source records that fed the merged entity
- prior canonical ids
- merge reason
- actor / workflow path
- superseded lineage

## Verification Strategy

Verification must combine national federation with local trust.

### Verification signals

Positive signals:

- official or strongly trusted source
- multiple independent agreeing sources
- recent source update
- provider-verified details
- local admin confirmation
- stable website and contact evidence

Negative signals:

- stale records
- conflicting phones / addresses / hours
- repeated user reports
- broken URLs or invalid contacts
- mismatch between external taxonomy claim and evidence

### ORAN trust model in a federated context

Recommended public trust framing:

- nationally aggregated
- evidence-backed
- locally verified
- stale or conflicting

This preserves ORAN's differentiator: federation is not enough, trust must still be earned.

### Verification queue integration

Federated records should flow into ORAN's existing review systems, not bypass them.

Routing principles:

- low-risk exact source updates can update assertion state automatically
- medium-risk changes go to admin review
- high-risk conflicts trigger escalation or re-verification
- duplicate candidates route into merge workflow
- user-submitted resources must enter the same assertion, normalization, and review pipeline as external feeds

## Provenance Model

Every canonical fact should be traceable.

### Provenance requirements

For each field-level assertion, store:

- source system
- source record id
- source URL
- evidence id
- extractor / adapter version
- extracted_at
- asserted value
- confidence hint
- reviewer decision if human-curated

### Canonical field decisioning

For each canonical field, ORAN should be able to answer:

- what sources asserted this value
- what conflicting values exist
- why this value won
- when it must be re-verified

### Minimum field-level provenance for critical facts

Critical facts requiring strongest provenance:

- organization name
- service name
- phone numbers
- address
- service URL
- hours
- eligibility-critical constraints
- taxonomy assignment used for routing or ranking

## Source Acquisition Priorities

The most useful source families to prioritize are the ones that improve national coverage without destroying trust quality.

### Priority 1: Structured standards-aligned sources

- Open Referral HSDS publishers
- partner-maintained HSDS exports
- ServiceNet-like structured feeds

### Priority 2: Official public sector sources

- federal agencies
- state agencies
- county and municipal human services directories
- public health departments
- housing authorities
- official 211 partnership exports where permitted

### Priority 3: Trusted community and nonprofit partners

- large nonprofit resource directories
- statewide coalitions
- regional continuums of care
- food bank networks
- domestic violence coalitions

### Priority 4: Curated scrape targets

- allowlisted `.gov`, `.edu`, and selected `.org` sources already aligned with ORAN ingestion rules

## Standards and Reference Sources To Verify Against

These are the primary standards and reference materials ORAN should use as verification anchors.

### Core interoperability references

- Open Referral HSDS overview
- Open Referral HSDS schema reference
- Open Referral HSDS API reference
- Open Referral HSDS identifiers guidance
- Open Referral HSDS profiles guidance
- Open Referral HSDS conformance guidance
- Open Referral HSDS mapping guidance
- Open Referral HSDS field guidance
- Open Referral HSDS database schema references

### Ecosystem and implementation references

- Open Referral specification GitHub repository
- Open Referral ServiceNet GitHub repository
- Open Referral technology overview and design principles

### Taxonomy and 211 references

- AIRS / 211 taxonomy documentation and licensing materials
- 211HSIS materials where accessible through permitted channels
- partner 211 export specifications and field dictionaries

### Identifier and registry references

- org-id.guide for organization identifier schemes
- official location identifier schemes where applicable in target jurisdictions

### Adjacent open data sources

- Data.gov and equivalent state / municipal catalogs
- agency-specific open data APIs and CSV exports

## ORAN Integration Plan

This should be executed in phases.

### Phase 0: Research and governance baseline

Deliverables:

- source licensing matrix
- taxonomy licensing matrix
- target-source inventory
- profile decision memo

Key questions to resolve:

- which AIRS / 211 assets can ORAN legally store and publish
- which partners can provide direct exports
- which states / metros have structured public resource data

### Phase 1: Canonical federation schema

Deliverables:

- source assertion schema
- canonical identifier schema
- taxonomy registry and crosswalk schema
- provenance schema
- cluster / merge lineage schema

Expected repo impact:

- new DB migrations
- `docs/DATA_MODEL.md` update
- targeted ingestion tests

### Phase 2: Connector framework

Deliverables:

- HSDS JSON connector
- HSDS tabular package connector
- structured partner feed connector interface
- connector validation and normalization contracts

Expected repo impact:

- new ingestion adapters under `src/agents/ingestion/**`
- source registry expansion
- feed-level validation reports

### Phase 3: Taxonomy federation and crosswalks

Deliverables:

- canonical concept registry
- external-term crosswalk tables
- mapping review workflow
- ORAN tag derivation rules

Expected repo impact:

- taxonomy services
- admin tools for mapping review
- docs for taxonomy governance

### Phase 4: Dedupe and cluster resolution

Deliverables:

- deterministic matcher
- candidate generator
- model-assisted resolver
- merge queue integration
- cluster decision audit trail

Expected repo impact:

- merge-service enhancements
- review workflow integration
- regression-safe merge tests

### Phase 5: Verification and publication

Deliverables:

- canonical-to-live publish path
- re-verification triggers for conflicts and staleness
- ORAN trust extensions for public surfaces
- ORAN HSDS export builder

### Phase 6: ORAN HSDS Profile and API

Deliverables:

- profile URI and profile docs
- generated profile schema artifacts
- read-only HSDS endpoints
- conformance validation tooling

## What ORAN Should Publish Publicly

ORAN should publish only approved canonical records.

Publication outputs:

- HSDS JSON export for interoperability
- optional Tabular Data Package export
- read-only HSDS API endpoints
- internal ORAN retrieval records with trust and review metadata

ORAN should avoid publishing:

- raw unresolved source assertions
- unreviewed candidate records
- source records whose licensing terms forbid redistribution
- internal-only evidence that may expose sensitive details or non-public operational notes

## Build vs. Buy vs. Partner

### Build in ORAN

- canonical federation model
- source assertion persistence
- provenance and field-decision engine
- trust scoring and local verification workflows
- ORAN seeker tag derivation

### Reuse / learn from open ecosystem

- Open Referral schemas and profile tooling concepts
- ServiceNet adapter patterns
- HSDS validation models
- dedupe feature ideas from Connect211 model card

### Partner rather than rebuild where possible

- 211 export access
- licensed taxonomy access
- national partner feeds
- public-sector bulk data sharing agreements

## Risks

### Technical risks

- over-merging distinct services
- under-merging near-duplicate records
- taxonomy drift between partners
- unstable source identifiers
- stale data overwhelming local verification capacity

### Legal / governance risks

- taxonomy licensing restrictions
- feed redistribution restrictions
- source terms that prohibit republishing
- varying public-data quality across jurisdictions

### Product risks

- seeker UX degradation if external taxonomy leaks directly into end-user surfaces
- trust dilution if national imports bypass review gates
- admin overload if too many low-quality records route into review queues

## Success Metrics

The program should be measured on both interoperability and trust quality.

### Interoperability metrics

- number of structured source systems integrated
- percentage of live records with preserved external identifiers
- percentage of live records exportable to ORAN HSDS Profile
- API/profile conformance checks passing

### Quality metrics

- duplicate rate before and after resolution
- merge precision and merge recall from reviewed samples
- percentage of records with field-level provenance on critical facts
- stale-record rate by source family
- cross-source agreement rate on critical fields

### Trust metrics

- percentage of nationally aggregated records locally verified
- false-positive user reports per 1,000 surfaced services
- time-to-review for conflicting records
- trust-band distribution of surfaced services

## Immediate Next Moves

### Recommendation

Start with the minimum irreversible foundation:

1. source assertions
2. external identifiers
3. taxonomy registry plus crosswalk tables
4. canonical cluster / merge lineage

Do not start by rewriting all live retrieval logic.

### Suggested first implementation slice

Pilot one narrow but representative integration path:

- one HSDS feed
- one public-sector structured source
- one quasi-211 or partner taxonomy source

Build the full path for those pilots:

- ingest
- normalize
- crosswalk
- dedupe
- review
- publish
- export as ORAN HSDS Profile

That will expose the real gaps before wide rollout.

## Open Questions

These are not blockers for planning, but they do affect the implementation path.

1. Which 211 or partner datasets can ORAN legally ingest, store, and republish?
2. Should ORAN publish a public ORAN HSDS Profile immediately, or after the first source pilots stabilize?
3. Which jurisdictions should be the initial geographic pilot for local verification capacity?
4. What subset of AIRS / 211 taxonomy should be crosswalked first if full licensed access is obtained?
5. Which external identifier schemes matter most in ORAN's first target geographies?

## Summary

ORAN should unify with HSDS / 211 by becoming a federation and trust layer, not by flattening itself into a generic directory schema.

The correct design is:

- preserve source assertions
- normalize into HSDS-aligned canonical entities
- crosswalk taxonomies instead of replacing ORAN tags
- resolve duplicates with identifiers first and models second
- route conflicts through ORAN's local verification workflows
- publish approved records through an ORAN HSDS Profile

That path preserves ORAN's differentiators while making the system nationally interoperable.
