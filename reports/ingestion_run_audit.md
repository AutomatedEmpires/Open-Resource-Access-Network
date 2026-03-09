# Ingestion Run Audit

Date: 2026-03-08
Scope: Review of `reports/ingestion_agent_run_001.md`, `reports/ingestion_agent_output_001.md`, and the current ingestion pipeline implementation.

## Bottom Line

The current pipeline is a workable demo, not yet an operator-grade ingestion system.

Main problem: it is optimizing for "show that the stages ran" instead of "produce a decision-ready, reproducible intake packet."

The biggest defects are structural, not cosmetic:

- Multi-service pages are collapsed into a single candidate.
- Directory, referral-network, homepage, and article pages are treated too much like service-detail pages.
- Completeness and readiness are overstated by heuristic shortcuts.
- Human review output is mixed together with telemetry and raw table dumps.
- 211 / HSDS interoperability is present in the data model, but not yet expressed as a clean intake contract.

## What I See Now

### 1. The output is not role-shaped

`ingestion_agent_run_001.md` is a demo run report.
`ingestion_agent_output_001.md` is a mixed technical transcript.

Neither is the right artifact for a community admin making an approve / deny decision.

Current output mixes:

- stage timings
- raw LLM JSON
- table-shaped persistence dumps
- partial taxonomy notes
- score breakdowns

That is useful for engineering, but noisy for review.

### 2. Multi-service fidelity is broken

The pipeline records `servicesExtracted`, but Stage 5 stores only `result.data.services[0]` into `context.llmExtraction`, and Stage 9 still builds one candidate ID.

Impact:

- directory pages lose records
- source pages with multiple programs collapse into one row
- import/export fidelity is broken before review even starts
- scores and tags can describe a page while pretending to describe a single service

This is the first thing I would fix.

### 3. Page classes are too coarse

The pipeline needs to distinguish at least:

- service_detail
- program_overview
- location_detail
- organization_profile
- directory_or_listing
- referral_network
- policy_or_info_page
- document_pdf
- extraction_failed_or_js_shell

Right now pages like `211.org` and content-heavy government pages can still flow through as if they were normal service candidates, even when the evidence says they are not.

### 4. Readiness is overstated

Current scoring/checklist behavior is too optimistic:

- address presence can satisfy "physical_address_or_virtual" even when it is effectively empty
- `eligibility_criteria` can be satisfied by a long description
- `service_area` can be satisfied by weak heuristics
- `cross_source_agreement` is not true corroboration
- `source_provenance` is tied to allowlist trust instead of actual evidence linkage
- `duplication_review` is marked not applicable instead of being explicitly unresolved

This makes the packet look cleaner than the underlying evidence warrants.

### 5. Fetch quality is not driving routing hard enough

Example: a page with 22 extracted words should not proceed as a normal service extraction path without escalation.

Low-text, JS-heavy, or document-driven pages should trigger:

- browser-render fetch
- PDF / document extraction
- linked-page acquisition
- hold-for-review with "insufficient evidence"

### 6. Taxonomy work is too shallow

Current categorization is mostly top-level category labeling.

Needed instead:

- preserve external taxonomy terms as received
- crosswalk external terms into ORAN canonical concepts
- derive ORAN seeker-facing tags from canonical concepts
- keep field-level reasons and evidence for each mapped term

The repo already points in this direction through `source_records`, `source_record_taxonomy`, `entity_identifiers`, and `hsds_export_snapshots`. The run output does not yet reflect that design.

## What I Would Improve

## Decisions Confirmed

- Minimum publishable / relevant fields will be determined by ORAN, not deferred to source systems.
- 211 homepages and similar referral-network landing pages should not become seeker-facing service listings; they should be extracted, normalized, and re-listed as discrete service records downstream.
- Review happens per service.
- Approved source APIs / feeds should use a fast-track pipeline, but ORAN must still keep the full source record, identifiers, and replayable evidence.

### 1. Replace the current output with 3 intentional artifacts

For each ingestion run, generate:

1. `ingestion_decision_brief.md`
   Human-first, one-screen summary for admins.

2. `ingestion_review_packet.json`
   Stable machine contract for UI, audits, retries, and tests.

3. `ingestion_exchange_snapshot.json`
   Structured normalized record for HSDS / 211 import-export workflows.

Do not make one markdown file serve all three jobs.

### 2. Make the decision brief extremely tight

The admin-facing brief should answer:

- What is this page really?
- Is it publishable as a service candidate?
- What evidence supports that?
- What is missing?
- What should the reviewer do next?

Recommended shape:

```md
# Intake Brief

Decision Class: Needs follow-up
Source Type: referral_network_homepage
Publishable As Service: No
Reason: page describes a navigation network, not a discrete service record

Keep:
- organization / network identity
- source trust
- canonical URL
- linked state/local entry points

Missing:
- service-level eligibility
- service area
- hours
- discrete service boundary

Next Acquisition:
- follow state/local 211 links
- ingest structured 211 / HSDS feed if available
- do not send this page to normal service approval
```

### 3. Promote record class to a first-class pipeline outcome

The pipeline should produce one of:

- `service_candidate`
- `organization_candidate`
- `source_directory`
- `referral_network`
- `non_resource_content`
- `needs_fetch_escalation`

That one decision will tighten everything:

- review queue routing
- score rules
- required fields
- export behavior
- admin expectations

### 4. Switch from single-candidate to candidate-set processing

Replace the current single `llmExtraction` shape with:

- `extractions[]`
- `candidatePackets[]`
- one packet per extracted service or record-class outcome

Rules:

- one page may produce zero, one, or many candidates
- directory/listing pages may produce child candidates plus a parent source packet
- referral networks should usually produce a source packet, not a seeker-facing service

### 5. Make provenance field-level and reviewable

Every extracted field should carry:

- value
- status: `exact | normalized | inferred | missing`
- evidence refs
- source snippet
- acquisition method: `html | rendered_html | pdf | api | csv | manual`

This is the core of reproducibility.

### 6. Tighten the minimum required data contract

Define a strict "decision-ready" service packet:

- organization name
- service name
- short neutral description
- at least one valid contact method
- explicit service area or explicit remote/national scope
- record class
- source provenance
- external IDs if present

Optional but strongly preferred:

- eligibility
- hours
- fees
- languages
- physical address

If the packet does not meet the minimum contract, the system should not pretend it is approval-ready.

### Minimum publishable contract

I would make publishability depend on these hard requirements:

- discrete service boundary
  The record must describe one actual service, not just an organization, homepage, article, or referral hub.

- organization identity
  Organization name must be explicit.

- service identity
  Service name or a normalized service label must be explicit.

- neutral service description
  A concise description grounded in source evidence, not promo copy.

- contactability
  At least one valid contact path:
  phone, website URL, intake URL, verified email, or verified in-person location.

- service area
  Explicit local, regional, statewide, national, or virtual scope.

- provenance
  Canonical source URL, evidence ID, fetched timestamp, acquisition method, and field-level evidence refs.

- record class
  The packet must be classified as `service_candidate`.

- identifier retention when present
  External API/feed IDs, HSDS IDs, 211 IDs, or source-native record IDs must be preserved.

Hard blockers for publish:

- record class is not `service_candidate`
- cannot verify source URL or canonical URL
- no valid contact path
- no explicit service area
- insufficient evidence to separate the service from the organization/page
- anomaly on external identifier, source provenance, or payload integrity

Allowed but not required for first publish:

- hours
- fees
- eligibility
- languages
- physical address

These should lower readiness and confidence, but not automatically block publish if the hard requirements are satisfied.

### 7. Separate confidence domains

Use separate scores for:

- extraction quality
- evidence sufficiency
- taxonomy confidence
- source trust
- publish readiness

Do not let a single green score hide gaps in evidence.

## How I Would Wire It Up

### Pipeline changes

1. Add a `classify_record` stage before extraction finalization.
2. Add fetch escalation rules after `extract_text`.
3. Replace single-record `llm_extract` materialization with multi-record packets.
4. Add `taxonomy_crosswalk` as a deterministic stage after extraction.
5. Add `readiness` as its own explicit stage, not just a derived score.
6. Generate separate engineering telemetry and review artifacts.

### Acquisition methods

Use acquisition in this order:

1. Structured source first
   HSDS CSV, HSDS API, 211 partner API, partner export.

2. Semi-structured source next
   PDFs, data tables, document pages, linked contact pages.

3. Scrape only when no structured feed exists
   HTML page extraction, then browser-render fallback if needed.

4. Manual review when evidence remains insufficient

### 211 / HSDS integration path

Use the existing source assertion layer directly:

- `source_systems` defines the publisher/network
- `source_feeds` defines the feed or endpoint
- `source_records` stores immutable inbound payloads
- `source_record_taxonomy` preserves external taxonomy
- `entity_identifiers` preserves external IDs
- `hsds_export_snapshots` publishes normalized outputs

Recommended rule:

- structured 211 / HSDS intake should bypass page-scrape heuristics
- scraped pages should only create service candidates when they meet the service-detail contract
- taxonomy mapping should be `external term -> canonical concept -> ORAN tags`

### 211 / NDP schema audit

Audited against `211_info_001.md`, the 211 NDP v2 organization export is not a single record. It is a structured bundle containing:

- `organization`
- `services[]`
- `programs[]`
- `locations[]`
- `servicesAtLocations[]`
- bundle-level `dataOwner` and `dataSteward`
- per-entity `meta`
- per-service `taxonomy[]` with AIRS code, label, hierarchy levels 1-6, and `targets[]`
- per-service `serviceAreas[]` with typed geography, geo-components, and optional geoJson

This matters because ORAN currently has the right high-level federation direction, but not yet a clean operational contract for this bundle shape.

### What 211 gives us that we must preserve exactly

- source-native IDs for organization, service, location, and service-at-location
- `dataOwner` and `dataSteward`
- `meta.status`, `meta.reasonInactive`, `meta.lastUpdated`, `meta.lastVerified`, `meta.created`, `meta.temporaryMessage`
- taxonomy code, label, hierarchy path, and targets
- access controls on phones, contacts, and addresses
- service areas with both typed geography and optional geometry
- service-at-location overrides for contact, phone, schedule, url, and email

If we flatten these too early, we lose replayability, taxonomy fidelity, and clean per-service approval.

### Current ORAN fit

Already aligned:

- source-system lineage via `source_systems` and `source_feeds`
- immutable assertion capture via `source_records`
- external ID retention via `entity_identifiers`
- canonical organization / service / location layer
- HSDS export versioning via `hsds_export_snapshots`
- field-level lineage direction via `canonical_provenance`

Currently lossy or under-modeled:

- `source_record_taxonomy` is too thin for full AIRS hierarchy plus `targets[]`
- `canonical_service_locations` is only a thin junction, but 211 `serviceAtLocation` is a real resource
- ORAN phones / contacts / schedules cannot attach to a specific service-location pair
- the current pipeline artifact model still assumes one candidate per page/run

### Required schema changes for clean 211 ingest

I would explicitly add these before calling the integration "clean":

1. `source_record_edges` or `parent_source_record_id`
   Needed so one raw 211 bundle can be decomposed into child source records without losing bundle lineage.

2. richer source taxonomy retention
   Either extend `source_record_taxonomy` or add companion tables so ORAN keeps:
   `taxonomy_code`, `taxonomy_term`, full level path, target terms, and raw taxonomy snapshot JSON.

3. service-at-location overlay support
   Add pair-level storage for:
   `url`, `email`, `phones`, `contacts`, `schedules`, `meta`, and optional override notes.

4. crosswalk tables
   Add:
   - `taxonomy_registries`
   - `canonical_taxonomy_concepts`
   - `taxonomy_crosswalks`
   - optional `crosswalk_versions`

Without these, ORAN can ingest 211 data, but not with the fidelity and auditability you asked for.

### Clean mapping contract

The cleanest contract is three layers, always in this order:

1. Assertion layer
   Preserve exact upstream data.

2. Canonical ORAN layer
   Normalize for dedupe, review, trust, and publish decisions.

3. Published ORAN display layer
   Render imported and non-imported data through the same ORAN-native service model sitewide.

### Source-to-ORAN mapping

| 211 / NDP object | Preserve exactly in source assertion | Normalize into ORAN canonical | Publish / display in ORAN |
|---|---|---|---|
| `organization` | raw object, source ID, `dataOwner`, `dataSteward`, `meta`, contacts, phones | `canonical_organizations` + `entity_identifiers` | `organizations`, public phones/contacts, provenance badge |
| `service` | raw object, source ID, taxonomy, eligibility, fees, serviceAreas, documents, `locationIds`, `meta` | `canonical_services` + taxonomy crosswalk outputs | `services`, `eligibility`, `required_documents`, `service_areas`, `languages`, tags |
| `location` | raw object, source ID, addresses, geocode, accessibility, languages, `serviceIds`, `meta` | `canonical_locations` + `entity_identifiers` | `locations`, `addresses`, `accessibility`, `languages` |
| `serviceAtLocation` | raw object, source ID, phones, contacts, schedules, url, email, `meta` | `canonical_service_locations` plus new pair-level override data | location-specific delivery card / detail panel with override precedence |
| `taxonomy[]` | exact AIRS code, label, level1-6, targets, raw snapshot | taxonomy registry + canonical concept mapping + `service_taxonomy` | ORAN seeker tags, facets, and optional admin taxonomy breadcrumbs |
| `meta` | exact raw lifecycle/access snapshot | freshness, active/inactive state, anomaly signals, temporary availability notes | publish gating, stale badges, temporary message display where allowed |

### Recommended ingest method for the 211 API

For a 211 export payload:

1. Persist the entire organization export response as one immutable bundle source record.
   Type example:
   `211_ndp.organization_export_bundle`

2. Decompose that bundle into child source records:
   - `211_ndp.organization`
   - `211_ndp.service`
   - `211_ndp.location`
   - `211_ndp.service_at_location`
   - `211_ndp.program`

3. Preserve source IDs and relationships as identifiers and edges.

4. Normalize child records into canonical org/service/location entities.

5. Materialize pair-level delivery data from `serviceAtLocation` without overwriting the base service.

6. Run deterministic taxonomy crosswalks.

7. Publish only from canonical entities after dedupe, anomaly checks, and lane assignment.

This is the cleanest method because it preserves the upstream contract and still honors your requirement that review and publish happen per service.

### Source system and feed modeling

I would model 211 ingestion this way:

- one `source_system` per approved 211 center / data owner
  Example:
  `211 Monterey`, `211 Ventura`

- one or more `source_feeds` under that source system
  Example:
  `ndp_export_organizations`, `ndp_query_locations`, `ndp_query_services_at_locations`

- the network-level fact that these are served through 211 NDP is retained in notes/profile/feed metadata

Justification:

- trust may differ by center
- jurisdiction is center-specific
- `dataOwner` is operationally meaningful
- replay, troubleshooting, and suspension decisions are cleaner per center than at one giant national bucket

### Taxonomy retention and crosswalk method

This part needs to be deterministic and versioned.

For every 211 taxonomy assertion:

1. Preserve the exact external record
   Keep code, term, level path, targets, and raw taxonomy JSON.

2. Register the exact external term
   Create or reuse a `taxonomy_terms` entry for the AIRS code/path.

3. Map to an ORAN canonical concept
   Crosswalk example:
   `LF-4900.1700` -> canonical concept `diabetes_screening`

4. Derive ORAN seeker-facing tags
   Example:
   canonical concept `diabetes_screening` may derive:
   - category: `healthcare`
   - service attribute / program concepts as applicable
   - audience tags from `targets[]`

5. Keep crosswalk provenance
   For every derived concept/tag, record:
   - source taxonomy code
   - crosswalk version
   - mapping type: `exact | narrower | broader | manual`
   - confidence

Recommended rule:

- external taxonomy is never overwritten
- ORAN canonical concepts are the seeker-facing authority
- every derived ORAN tag must be traceable back to source taxonomy and crosswalk version

### Clean taxonomy handling by field

- `taxonomy.taxonomyCode`
  Primary external classification key. Preserve exactly and attach to the service source record.

- `taxonomy.taxonomyTermLevel1..6`
  Preserve as hierarchy path; do not discard after deriving top-level ORAN category.

- `taxonomy.targets[]`
  Treat as source audience assertions. Crosswalk to ORAN audience/population tags, but preserve exact Y code and term.

- `eligibility.types[]`
  Map to ORAN eligibility signals and/or service-attribute tags through explicit crosswalks.
  Example:
  `veteran`, `senior`, `low_income`, `homelessness`

- `fees.type`
  Map to ORAN cost concepts.
  Example:
  `no_fee` -> `free`
  `partial_fee` -> fee-required partial support concept
  `full_fee` -> fee-required concept

- `documents.types[]`
  Write to `required_documents`, and optionally derive access-friction tags only through explicit rules.

- `languages.codes[]`
  Normalize into ORAN `languages` records and search/display filters.

- `meta.tags[]`
  Preserve as source metadata, not as authoritative seeker taxonomy.

### Service area mapping

`serviceAreas[]` is one of the most valuable parts of the 211 payload and should drive routing and display.

Recommended mapping:

- `postal_code` -> ORAN service area extent `postal_code`
- `locality` / `place` -> ORAN extent `city`
- `county` -> ORAN extent `county`
- `state` -> ORAN extent `state`
- `country` -> ORAN extent `national` or country-level scope depending on source

Also preserve:

- original `value`
- all `geoComponents`
- optional `geoJson`

Use `geoComponents` for admin routing and normalized display.
Use `geoJson` for map/coverage only when trusted and valid.

### Meta and access mapping

`meta` and `access` should affect trust and display, not just sit in raw JSON.

Recommended rules:

- `meta.status = active`
  eligible for fast-track, subject to other checks

- `meta.status in (inactive, deleted, draft)`
  never auto-publish

- `meta.reasonInactive`
  preserve as lifecycle note and seeker-facing status only when appropriate

- `meta.lastVerified` and `meta.lastUpdated`
  feed freshness and reverification timers

- `meta.temporaryMessage`
  store as time-bounded operational message; can surface on service/location views if still valid

- `access = public`
  eligible for seeker-facing use

- `access = private`
  preserve for admins only, do not publish

- `access in (referral, directory, research, website)`
  preserve as source metadata; do not treat as verified public contactability by default

### Service-at-location precedence rules

To make imported data display correctly sitewide while still matching ORAN schemas, I would use this precedence when rendering a service for a specific location:

1. service-at-location override
2. service-level value
3. location-level value
4. organization-level fallback

Apply that precedence to:

- url
- email
- phone/contact
- schedules
- temporary operational message

Do not overwrite the base canonical service with location-specific overrides.
Keep them as delivery-context data.

### Sitewide ORAN display contract

Imported 211 / HSDS data should never render directly from source payload JSON on seeker surfaces.

Instead:

- all seeker-facing pages query ORAN-native published schemas and view models
- imported data populates those schemas through the same canonical publish projector as scraped/manual data
- raw 211-specific details remain available in admin/audit panels and provenance views

This gives you:

- one consistent UI contract sitewide
- one search/filter model
- one review/publish workflow
- source fidelity without source-shaped UI leakage

### Fast-track scoring for approved 211 APIs

For approved structured sources, confidence should come from structured-source integrity, not page heuristics.

I would compute fast-track confidence from:

- schema validity: 20
- referential integrity across org/service/location/service-at-location IDs: 20
- canonical URL / public contact verification: 15
- taxonomy resolution coverage: 15
- freshness from `lastVerified` / `lastUpdated`: 10
- dedupe certainty: 10
- mapping completeness into ORAN canonical fields: 10

Total: 100

This makes the `>= 92` auto-publish threshold defensible.
It is not a vibes score; it is a structural integrity score.

### Hard anomalies for 211 / HSDS imports

These should force light review or full review even for approved APIs:

- source bundle fails schema validation
- child entity IDs conflict or relationships break
- `serviceAtLocation` references missing service or location
- canonical URL cannot be verified
- only private/referral/directory contacts are present
- taxonomy code is present but crosswalk is missing or ambiguous
- service area is missing or contradictory
- `meta.status` is inactive/deleted/draft
- dedupe conflicts with a published ORAN entity
- source payload changes in a way that removes previously published required data

### Why this is the cleanest approach

- It keeps the upstream 211 contract lossless.
- It preserves per-service review and publish, which matches your workflow.
- It lets imported data appear sitewide through ORAN-native schemas instead of bespoke 211 render paths.
- It makes taxonomy explainable and reproducible.
- It supports round-trip HSDS export without throwing away ORAN review/trust logic.

### Fast-track policy for approved APIs / feeds

For approved structured publishers, I would add three lanes:

1. Auto-publish lane
   Requirements:
   source trust tier is approved, confidence score is `>= 92`, record class is `service_candidate`, and no hard anomalies are present.

2. Light-review lane
   Requirements:
   confidence score is `80-91`, or soft anomalies are present.
   Outcome:
   queue for quick community-admin review per service.

3. Full-review lane
   Requirements:
   confidence score is `< 80`, source integrity is unclear, canonical URL cannot be verified, identifiers conflict, dedupe conflict exists, or extraction produces ambiguous service boundaries.

Hard anomalies that must block auto-publish:

- cannot verify canonical URL
- source payload hash mismatch
- missing or conflicting source-native identifier
- dedupe conflict with existing published service
- record classified as referral network / directory / organization page instead of service
- contact path is invalid or missing
- service area is missing

Even in the auto-publish lane, always persist:

- `source_systems` link
- `source_feeds` link
- immutable `source_records` payload
- `source_record_taxonomy`
- `entity_identifiers`
- generated `hsds_export_snapshots` when published

That keeps the fast path fast without losing replayability or auditability.

### Community admin review flow

Community admins should review a compact packet with:

- record class
- publishability status
- top evidence snippets
- missing blockers
- source trust and acquisition method
- candidate vs canonical diff
- taxonomy crosswalk preview
- approve / deny / route-back / request-better-acquisition

They should not need to parse stage timings or raw DB row dumps.

## Verification Changes

### Replace weak heuristics with explicit checks

Examples:

- `physical_address_or_virtual`
  Pass only if full address is present or remote scope is explicitly evidenced.

- `service_area`
  Pass only if explicit geography, jurisdiction, or national/virtual language is evidenced.

- `eligibility_criteria`
  Pass only if explicit criteria or explicit open-access language is present.

- `cross_source_agreement`
  Pass only if corroborated by an independent source, structured feed, or stable secondary evidence.

- `duplication_review`
  Never mark not applicable when dedupe has not run.

- `source_provenance`
  Pass when evidence lineage exists, regardless of trust tier.

### Add hard routing gates

Examples:

- low extracted word count
- JS shell with missing main content
- homepage/listing without service boundary
- multi-record page collapsed to one output
- national referral network treated as single local service

## What Docs I Would Update

- `docs/contracts/INGESTION_CONTRACT.md`
  Add record classes, packet types, readiness contract, and structured-source priority rules.

- `docs/solutions/IMPORT_PIPELINE.md`
  Update from "planned CSV flow" to unified intake paths: HSDS/211 structured feed, scrape, document, manual.

- `docs/DECISIONS/ADR-0007-hsds-211-federation-canonical-model.md`
  Add the operational crosswalk and review-packet implications.

- `docs/DATA_MODEL.md`
  Document source assertion, crosswalk, candidate-set processing, and export packet shapes.

- `docs/ops/services/RUNBOOK_INGESTION.md`
  Add fetch escalation, low-evidence handling, and replay/repro guidance.

- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
  Add route-back states like `needs_better_acquisition` and `needs_crosswalk_review`.

- `docs/governance/TAGGING_GUIDE.md`
  Clarify external taxonomy preservation vs ORAN tag derivation.

## How I Would Verify The Redesign

### Contract tests

- one service-detail page -> one candidate packet
- one directory page -> many candidate packets or source packet + children
- one referral homepage -> source packet, not seeker-facing service
- one JS-heavy page -> fetch escalation outcome
- one HSDS/211 import -> source record preserved with external taxonomy intact

### Regression tests

- no packet can be marked ready when required evidence is missing
- dedupe status must be explicit
- field provenance must exist for decision-ready packets
- export snapshot round-trips external IDs and taxonomy references

### Golden files

Create stable fixtures for:

- government service page
- 211 referral network page
- HSDS CSV import batch
- partner API payload
- low-evidence bad page

This should become the main reproducibility harness.

## Recommended Implementation Order

1. Fix multi-record extraction and packetization.
2. Add record classification and fetch escalation.
3. Split engineering output from admin decision brief.
4. Tighten readiness/checklist semantics.
5. Add deterministic taxonomy crosswalk.
6. Wire structured 211 / HSDS intake into the same packet contract.
7. Update community-admin review UI to consume the new packet.

## Taxonomy Authority Recommendation

Preserve the external HSDS / 211 taxonomy exactly, but use ORAN canonical concepts and ORAN seeker-facing tags as the display/search authority sitewide.

That is the cleanest boundary:

- source taxonomy remains lossless and exportable
- ORAN display remains consistent across imported, scraped, and manual data
- every displayed ORAN tag remains explainable back to the original source assertion
