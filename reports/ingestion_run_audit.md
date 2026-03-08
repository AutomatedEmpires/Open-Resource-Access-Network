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

## Remaining Open Question

When external HSDS / 211 taxonomy conflicts with ORAN tags, I recommend preserving the external term exactly, but using ORAN canonical concepts as the seeker-facing authority. If you want the opposite behavior, that should be an explicit product decision.
