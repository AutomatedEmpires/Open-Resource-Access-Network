# ORAN Ingestion and Resource Sourcing Audit

Audit date: 2026-03-13
Scope: All verified ingestion and resource-sourcing methods in the repository, including feed ingestion, crawl/manual candidate ingestion, host portal intake, community/host submission flows, Azure Function execution adapters, APIs, and database schema.
Method: Code-grounded audit against the current repository state. This report distinguishes active production logic from helper layers, execution adapters, and partial or stubbed components.

---

## Executive Summary

ORAN does not have one single ingestion pipeline. It has four real ingestion families plus one older Function-oriented execution topology:

1. Feed-based source assertion and canonical federation.
   Current status: real, active, and the most unified path for external structured sources such as 211/HSDS.

2. URL and crawl-based candidate ingestion.
   Current status: real, active, and centered on evidence snapshots, extracted candidates, scoring, tagging, review readiness, and explicit candidate publication.

3. Host portal intake.
   Current status: real, active, and notable because it bridges source assertions and submission review in the same flow.

4. Universal resource submissions and claim workflows.
   Current status: real, active, and centered on submissions, forms, workflow transitions, and source assertion attachment.

5. Azure Functions queue topology.
   Current status: partly real as an execution layer, but mixed in maturity. Some Functions are active adapters over current domain logic, while some older Function-era entrypoints remain documented more strongly than they are actually wired.

The repository therefore has meaningful unification, but not total end-to-end convergence:

- Feed ingestion is unified around `source_systems`, `source_feeds`, `source_feed_states`, and `source_records`, then canonical federation and controlled publication.
- Crawl/manual ingestion is unified around `ingestion_jobs`, `evidence_snapshots`, `extracted_candidates`, tags, checks, confirmations, and publish readiness.
- Submission workflows are unified around `submissions`, `submission_transitions`, `submission_slas`, `form_templates`, and `form_instances`.
- Host portal intake is the strongest bridge between those worlds because it writes source assertions and reviewable submissions together.

The most important truth for operators is this: the codebase is not best described as one universal pipeline from every source to one publication lane. It is better described as one ingestion platform with multiple ingestion families sharing infrastructure, stores, safety rules, and publication surfaces, but not all sharing the same persistence path.

---

## Current-State Verdict

### What is operationally real

- Structured source-feed polling for external feeds, including `ndp_211`, via the ingestion service and authenticated internal poll route.
- URL-based ingestion through the canonical ingestion pipeline in `src/agents/ingestion/pipeline`.
- Candidate scoring, tag generation, tag confirmations, verification checks, publish readiness snapshots, and explicit candidate live-publish.
- Host portal write paths that create source assertions and queue review submissions.
- Community queue and workflow-engine review process over the universal submissions model.
- Canonical-to-live promotion for federated canonical entities.

### What is partially unified

- Feed ingestion and URL/candidate ingestion both land inside the ingestion domain, but they do not use the same exact persistence and publication lane.
- Resource submissions are attached to the source assertion model, but their primary workflow still runs through the submissions/form system rather than the candidate pipeline.

### What is not fully implemented as described in some older docs

- `functions/manualSubmit` is an explicit stub. It returns `501` and instructs callers to use `POST /api/admin/ingestion/process` instead.
- Some queue-first Function documentation still describes a more complete runtime topology than the current code wiring proves.
- The feed path does not currently route through the same candidate score/tag/submit-for-verification path used by crawl/manual candidate ingestion.

---

## Canonical Architecture by Ingestion Family

### 1. Feed-based external ingestion: HSDS and 211-style source feeds

This is the most mature unified external data-ingestion path.

Primary code:

- `src/agents/ingestion/service.ts`
- `src/agents/ingestion/ndp211Connector.ts`
- `src/agents/ingestion/ndp211Normalizer.ts`
- `src/agents/ingestion/hsdsFeedConnector.ts`
- `src/agents/ingestion/hsdsExportPipeline.ts`
- `src/agents/ingestion/autoPublish.ts`
- `src/agents/ingestion/promoteToLive.ts`
- `src/app/api/internal/ingestion/feed-poll/route.ts`
- `functions/pollSourceFeeds/index.ts`

Verified flow:

1. A source system is registered in `source_systems`.
2. One or more feeds are registered in `source_feeds`.
3. Operational controls for each feed live in `source_feed_states`.
4. The internal feed-poll route authenticates with `INTERNAL_API_KEY`, validates env, and enforces feature gates.
5. The ingestion service polls active feeds, normalizes upstream records, and writes immutable assertions into `source_records`.
6. The service uses canonical federation stores to upsert or reconcile canonical organizations, services, locations, taxonomy, and identifiers.
7. Publication policy is applied from feed state and system trust signals.
8. Eligible canonical services can be auto-published through `autoPublish(...)`.
9. Actual seeker-visible publication occurs through `promoteToLive(...)`, which writes live Zone C tables and export snapshots.

What is unified here:

- Source registry.
- Feed configuration.
- Feed-level operational state.
- Immutable source assertions.
- Canonical federation.
- Controlled publication.

What is not reused here:

- The crawl/manual candidate materialization path.
- The community submissions queue as the normal default for feed records.

Key operational hard gates verified in code:

- `SOURCE_FEED_POLLING_ENABLED`
- `INTERNAL_API_KEY`
- `DATABASE_URL`
- `NDP_211_POLLING_ENABLED` for active `ndp_211` feeds
- per-feed publication mode and emergency pause
- explicit feed approval before auto-publish

Assessment:

This is the current canonical answer to "unified HSDS/211 ingestion" in the repository.

### 2. URL, crawl, and admin-triggered candidate ingestion

This is the current evidence-to-candidate pipeline.

Primary code:

- `src/agents/ingestion/pipeline/orchestrator.ts`
- `src/agents/ingestion/materialize.ts`
- `src/agents/ingestion/sourceRegistry.ts`
- `src/agents/ingestion/scoring.ts`
- `src/agents/ingestion/livePublish.ts`
- `src/agents/ingestion/publish.ts`
- `src/app/api/admin/ingestion/process/route.ts`
- `src/app/api/admin/ingestion/batch/route.ts`
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts`

Verified flow:

1. A URL is submitted through the admin ingestion route or batch route.
2. The source registry applies domain and trust rules.
3. An ingestion job is created.
4. Fetch/extract stages create evidence and extracted text artifacts.
5. LLM extraction, categorization, verification, and scoring build a candidate artifact.
6. `materializePipelineArtifacts(...)` persists:
   - evidence snapshots
   - extracted candidates
   - confidence scores
   - tags
   - verification checks
   - tag confirmations
   - publish readiness snapshot
7. The candidate is routed for human review or admin action.
8. An ORAN admin can explicitly publish via `publishCandidateToLiveService(...)`.
9. Candidate publication writes directly into live seeker tables, export snapshots, identifiers, and lifecycle events.

This lane is real and materially complete, but it is not the same as the feed federation lane. It is a candidate-first staging and review pipeline.

What is unified here:

- evidence capture
- candidate staging
- scoring and confidence tiers
- tagging and tag confirmation queue
- readiness evaluation
- explicit human publish route

What is distinct here:

- publication writes straight from candidate staging to live tables
- it does not require canonical federation first
- it uses the candidate review model rather than feed publication policy

Assessment:

This is the path that most closely matches "score, tag, verify, then publish". It is real, but it is not the same path used by the structured 211 feed service.

### 3. Host portal intake

This is a real dual-write bridge between source assertions and review workflow.

Primary code:

- `src/services/ingestion/hostPortalIntake.ts`
- `src/app/api/host/claim/route.ts`
- `src/app/api/host/services/route.ts`
- `src/app/api/host/services/[id]/route.ts`
- `src/app/api/community/queue/[id]/route.ts`

Verified flow:

1. Host-authenticated users create, update, archive, or claim organizations and services.
2. The host portal helper ensures a `source_system` and `source_feed` for host portal intake.
3. Each action writes a `source_records` assertion with a deterministic payload hash.
4. Service create, update, and archive actions queue a `service_verification` row in `submissions`.
5. `submission_transitions` records the workflow move from `draft` to `submitted`.
6. Community or ORAN admins review through `/api/community/queue` and `/api/community/queue/[id]`.
7. On approval, `applyApprovedServiceVerification(...)` mutates the live service if the submission is a host service change request.

Why this matters:

Host portal intake is already doing something the broader ingestion platform still only partly achieves elsewhere: it records source provenance and puts material changes into a formal review workflow in the same path.

Assessment:

This is not a stub or placeholder. It is one of the strongest implemented ingestion surfaces in the repository.

### 4. Universal resource submissions and claims

This is the structured submission family for community and host channels.

Primary code:

- `src/services/resourceSubmissions/service.ts`
- `src/app/api/community/queue/route.ts`
- `src/app/api/community/queue/[id]/route.ts`
- `src/app/api/community/queue/bulk/route.ts`
- `src/services/workflow/engine`

Verified flow:

1. A submission draft is created using the forms and submissions subsystem.
2. `form_templates` and `form_instances` hold the structured intake surface.
3. `submissions` holds the queueable workflow record.
4. `submission_transitions` records each status move.
5. `attachSourceAssertion(...)` writes the intake as a `source_records` assertion tied to a manual submission feed.
6. For approved outcomes, `attachApprovedProjectionAssertion(...)` records a source assertion for the approved projection as well.
7. Community admins review, claim, approve, deny, escalate, or return through the queue APIs.

What is unified here:

- workflow engine
- queue and lock semantics
- submission SLAs
- source assertion attachment for intake provenance

What is distinct here:

- this family is centered on submissions and forms, not candidate staging
- seeker-visible publication behavior depends on the specific submission type and downstream projection logic

Assessment:

This is a real ingestion and sourcing family, but it is not the same runtime model as crawl candidates or feed federation.

### 5. Azure Functions runtime and execution adapters

The Functions layer is real, but maturity varies by Function.

Verified active or meaningful Functions:

- `functions/pollSourceFeeds`
  - active timer adapter calling the internal feed poll route
- `functions/fetchPage`
  - queue stage in the crawl pipeline topology
- `functions/extractService`
  - runs extraction stages and persists a candidate
- `functions/verifyCandidate`
  - re-loads candidate, optionally verifies against live source content, updates confidence, enqueues routing
- `functions/routeToAdmin`
  - assigns candidate review work

Verified stub or partial entrypoint:

- `functions/manualSubmit`
  - explicitly marked as a stub and returns `501`
  - repository comments direct callers to `POST /api/admin/ingestion/process`

Assessment:

The queue topology is real and deployable as an execution model. It is not correct to describe every Function entrypoint as equally production-ready.

---

## How the Pipelines Actually Unify

### Layer 1. Shared ingestion domain

Most ingestion code now centers on `src/agents/ingestion/**`. That is the correct organizing principle for the current codebase.

Shared elements across families include:

- store interfaces in `src/agents/ingestion/stores.ts`
- audit events
- source provenance concepts
- confidence and verification concepts
- publication artifacts such as identifiers, snapshots, and lifecycle events

### Layer 2. Shared source assertion model

The source assertion layer is real and important:

- `source_systems`
- `source_feeds`
- `source_feed_states`
- `source_records`

Feed ingestion uses this model as its primary backbone.

Host portal and resource submissions also attach into this model.

The strongest design principle in the repo is that provenance should be expressed as immutable source assertions. The code materially reflects that principle, though not every family uses it in the same way.

### Layer 3. Shared publication surfaces, but different publication lanes

There are at least two real publication lanes:

1. Canonical federation publication.
   - `autoPublish(...)`
   - `promoteToLive(...)`

2. Candidate live publish.
   - `publishCandidateToLiveService(...)`
   - invoked by `POST /api/admin/ingestion/candidates/[id]/publish`

Both eventually write seeker-visible live data and export snapshots, but they do not begin from the same staging model.

### Bottom-line unification assessment

The system is unified by platform concepts and partially unified by data model, not by one universal identical end-to-end flow.

That distinction matters. The codebase is stronger than a collection of disconnected experiments, but it is not yet one single universal ingestion conveyor belt.

---

## Verified Ingestion Entrypoints

This section separates true ingestion entrypoints from adjacent review or operator APIs.

### Structured feed federation entrypoints

- `POST /api/internal/ingestion/feed-poll`
  - authenticated internal trigger for feed polling
  - current production-intent trigger surface for scheduled structured-feed ingestion
- `functions/pollSourceFeeds`
  - timer-based runtime adapter that invokes the internal feed-poll route

### URL and crawl candidate entrypoints

- `POST /api/admin/ingestion/process`
  - primary manual URL intake route for operators
- `POST /api/admin/ingestion/batch`
  - batch manual URL intake route for operators
- queue-driven crawl stages under `functions/fetchPage`, `functions/extractService`, `functions/verifyCandidate`, and `functions/routeToAdmin`
  - runtime execution path for the queue-oriented candidate topology

### Host portal entrypoints

- `POST /api/host/claim`
- `POST /api/host/services`
- `PUT /api/host/services/[id]`
- `DELETE /api/host/services/[id]`

These are not generic ingestion triggers. They are authenticated self-service intake and change-management entrypoints that create provenance plus workflow records.

### Community and manual submission entrypoints

The submission family is partially represented by creation APIs outside the queue routes, but its review and progression surfaces are verified here through:

- `GET/POST/DELETE /api/community/queue`
- `GET/PUT /api/community/queue/[id]`
- `PATCH /api/community/queue/bulk`

These are governance and review entrypoints, not raw extraction entrypoints. They matter architecturally because they are the operational control surface for one ingestion family.

### Explicit non-entrypoint or stub clarification

- `functions/manualSubmit`
  - not a valid production ingestion entrypoint today
  - explicitly returns `501`
  - code comments direct callers to `POST /api/admin/ingestion/process`

---

## Verified API Surface

### Feed and ingestion control plane

- `POST /api/internal/ingestion/feed-poll`
  - authenticated internal trigger for source-feed polling
- `POST /api/admin/ingestion/source-systems`
  - bootstrap source systems and optional feeds
- `PATCH /api/admin/ingestion/source-feeds/[id]`
  - feed control-plane updates
- `POST /api/admin/ingestion/source-feeds/bulk`
  - bulk feed operations
- feed state helpers in `src/app/api/admin/ingestion/source-feeds/state.ts`

### Candidate ingestion and publication

- `POST /api/admin/ingestion/process`
  - admin URL ingestion trigger
- `POST /api/admin/ingestion/batch`
  - multi-URL batch ingestion
- `GET/PATCH /api/admin/ingestion/candidates/[id]`
  - candidate review and mutation
- `POST /api/admin/ingestion/candidates/[id]/publish`
  - explicit candidate-to-live publish

### Host portal intake

- `POST /api/host/claim`
  - organization claim submission
- `POST /api/host/services`
  - service creation with source assertion plus submission review
- `PUT /api/host/services/[id]`
  - live service change request routed to review when appropriate
- `DELETE /api/host/services/[id]`
  - archive request routed to review

### Community queue and review workflow

- `GET/POST/DELETE /api/community/queue`
  - list, claim, and unclaim submissions
- `GET/PUT /api/community/queue/[id]`
  - inspect a submission and apply a decision
- `PATCH /api/community/queue/bulk`
  - bulk queue decisions

### Important API truth

The current production-intent manual URL intake entrypoint is the Next.js admin route, not the HTTP Azure Function stub.

---

## Cross-Family Inconsistencies

These are the most important inconsistencies verified in the current repository.

### Inconsistency 1. Two publication lanes with different staging models

Affected families:

- structured feed federation
- URL and crawl candidate pipeline

Affected tables:

- canonical entities and publication metadata tables
- live publication tables
- `hsds_export_snapshots`
- `lifecycle_events`

Affected APIs:

- `POST /api/internal/ingestion/feed-poll`
- `POST /api/admin/ingestion/candidates/[id]/publish`

Verified inconsistency:

- feed ingestion reaches live publication through canonical federation and `promoteToLive(...)`
- candidate ingestion reaches live publication through `publishCandidateToLiveService(...)`

Architectural consequence:

- publication governance is conceptually shared, but not implemented as one common publish contract
- downstream seeker tables receive data from two different staging philosophies

### Inconsistency 2. Review workflow is mandatory in some families but optional or separate in others

Affected families:

- host portal intake
- community and manual submissions
- structured feed federation
- candidate ingestion

Affected tables:

- `submissions`
- `submission_transitions`
- `source_feed_states`
- candidate readiness and review tables

Affected APIs:

- host service routes
- community queue routes
- admin candidate publish route
- feed control-plane APIs

Verified inconsistency:

- host portal service changes are explicitly routed through submissions review
- community/manual submissions are explicitly review-workflow centric
- candidate ingestion has readiness plus explicit admin publication
- feed ingestion can be policy-routed to auto-publish without entering the submissions queue

Architectural consequence:

- review governance exists across the platform, but not as one common workflow object shared by all families

### Inconsistency 3. Source assertion is strongly present but not uniformly first-class in every family’s operator story

Affected families:

- structured feed federation
- host portal intake
- community and manual submissions
- URL and crawl candidate pipeline

Affected tables:

- `source_systems`
- `source_feeds`
- `source_feed_states`
- `source_records`
- `ingestion_jobs`
- `evidence_snapshots`
- `extracted_candidates`

Verified inconsistency:

- feed ingestion, host portal intake, and resource submissions are explicitly source-assertion-centric
- the candidate pipeline is evidence-centric and source-registry-aware, but it is not described or governed through the same source-feed operational object model

Architectural consequence:

- provenance exists across the platform, but operators do not yet manage every family through one common intake envelope or registry abstraction

### Inconsistency 4. Runtime narratives differ between code and older operational docs

Affected families:

- candidate pipeline
- Azure Functions execution layer

Affected artifacts:

- `functions/manualSubmit`
- older queue-first runbook narratives
- current admin ingestion APIs

Verified inconsistency:

- current code makes the Next.js admin process route the operator-facing manual URL intake path
- some older documentation still implies a more complete Function-first ingestion surface than the repo currently proves

Architectural consequence:

- documentation drift creates real risk of operator confusion and incorrect refactor assumptions

---

## Publication Lane Analysis

### Lane A. Canonical federation publication

Primary code:

- `src/agents/ingestion/autoPublish.ts`
- `src/agents/ingestion/promoteToLive.ts`

Entry conditions:

- source-feed ingestion has already normalized into canonical entities
- publication mode and trust policy allow progression
- environment and feed approval gates are satisfied for auto-publish

Governance characteristics:

- feed-level policy controlled
- can remain canonical-only
- can route to review-required publication state
- can auto-publish under explicit policy constraints

Strengths:

- strongest structured-source governance model
- best provenance continuity from source feed to canonical to live
- best fit for external federation and replay-safe operations

Weaknesses:

- does not reuse the candidate readiness and tag-confirmation model
- not the same human review surface as the submissions family

### Lane B. Candidate live publish

Primary code:

- `src/agents/ingestion/livePublish.ts`
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts`

Entry conditions:

- evidence and extraction already materialized into a candidate
- readiness threshold met
- ORAN admin explicitly invokes publish

Governance characteristics:

- readiness-driven
- explicit human publish action
- direct write into seeker-visible live tables with export and lifecycle side effects

Strengths:

- close fit for discovery, crawling, and operator-guided staging
- clear human checkpoint before publication
- uses scoring, tags, and accepted suggestion data already created in the candidate lane

Weaknesses:

- separate from canonical federation publish policy
- creates a second path into live tables that operators must understand independently

### Lane C. Submission-approved live mutation

Primary code:

- `src/app/api/community/queue/[id]/route.ts`
- `src/services/ingestion/hostPortalIntake.ts`

Entry conditions:

- an existing service or claim has entered the submissions workflow
- reviewer approval applies an approved payload or status change

Governance characteristics:

- workflow-engine centric
- human review centric
- applies live changes without going through candidate publish or canonical federation publish

Strengths:

- strong governance for host-managed edits
- direct alignment with accountability and reviewer traceability

Weaknesses:

- introduces a third way that live data can change
- publication and mutation reasoning is spread across different abstractions

### Publication-lane conclusion

ORAN does not merely have two publish paths in practice. It has:

- canonical federation publish
- candidate live publish
- submission-approved live mutation

The first two are explicit publication lanes. The third is a governed mutation lane that still affects seeker-visible truth. Any future convergence work must treat all three as part of publication governance.

---

## Observability And Operator Control Gaps

The repository has meaningful operator controls, but observability is still fragmented by family.

### Gap 1. No unified ingestion status object across families

Verified condition:

- feed families expose feed state, checkpoint, and attempt summaries
- candidate families expose jobs, stages, and review artifacts
- submissions expose workflow status and transitions

Gap:

- there is no single repository-wide intake status envelope that lets operators compare one feed poll, one candidate ingestion job, and one submission using a shared lifecycle vocabulary

### Gap 2. Admin UI is strongest for feed controls, weaker as a cross-family operations console

Verified condition:

- the ORAN admin ingestion surface contains source, feed, job, candidate, and process controls

Gap:

- there is no single operator dashboard that unifies feed health, candidate backlog, submission backlog, publish outcomes, and replay operations across all families

### Gap 3. Existing runbooks are still split by runtime topology rather than by ingestion governance model

Verified condition:

- the 211 rollout runbook is strong on source-feed governance
- the generic ingestion runbook remains queue-topology oriented

Gap:

- operational documentation does not yet present one coherent governance view spanning feeds, candidates, and submissions

### Gap 4. Publication analytics are not yet expressed as one cross-family control surface

Verified condition:

- feed polling now records publication reasons and decision reasons
- candidate publish and submission decisions are review-driven but live in separate pathways

Gap:

- there is no single report or dashboard answering: what became live today, from which ingestion family, under which governance path, with which confidence or approval basis

### Gap 5. Replay and failure recovery are stronger for feeds than for the other families

Verified condition:

- feed states include checkpoint and replay controls
- queue runbooks exist for poison-message handling in the Function topology

Gap:

- there is not yet one comparable operator-grade replay story spanning candidate restaging, submission reprojection, and publication rollback in a common control plane

---

## Architectural Risks

### Risk 1. False unification assumptions could cause damaging refactors

If future work assumes every family already uses one universal pipeline, it is likely to break feed publication policy, host review governance, or candidate scoring behavior.

Severity: high

### Risk 2. Multiple live mutation paths increase governance complexity

Live seeker data can currently be affected by:

- canonical federation promotion
- candidate live publish
- submission-approved host changes

This is not inherently wrong, but it raises the burden on auditability, analytics, and rollback discipline.

Severity: high

### Risk 3. Documentation drift can lead to incorrect operator or engineering choices

Older queue-first descriptions can still mislead contributors into treating Function entrypoints as the primary canonical operating model.

Severity: medium

### Risk 4. Family-specific observability makes it harder to reason about platform integrity

Each family has meaningful status artifacts, but there is no single governance view showing provenance, evidence, workflow, and publication state together.

Severity: medium

### Risk 5. Provenance is preserved, but governance semantics are not yet normalized across families

The platform preserves source assertions well. What differs by family is how verification state, review state, and publish eligibility are represented.

Severity: medium

---

## Recommended Convergence Roadmap

These recommendations are intentionally governance-first and backward-compatible. They are designed to improve cross-family consistency without collapsing the existing ingestion families into one premature pipeline.

### Recommendation 1. Define a common ingestion governance envelope

Objective:

- introduce one shared status projection for provenance, evidence presence, extraction state, verification state, workflow state, confidence state, and publication eligibility

Affected families:

- all four ingestion families

Affected tables:

- no initial replacement of existing tables
- projection would derive from `source_records`, candidate tables, canonical publication tables, and submission tables

Affected APIs:

- new read-model API or admin dashboard aggregation layer

Migration risk:

- low if implemented as read model only

Backward compatibility:

- preserve current write paths
- do not replace family-specific stores initially

### Recommendation 2. Add a cross-family publication ledger view

Objective:

- provide one auditable operator surface for every seeker-visible publish or mutation event, regardless of family

Affected families:

- structured feed federation
- candidate pipeline
- host portal and submissions workflow

Affected tables:

- `lifecycle_events`
- `hsds_export_snapshots`
- live publication tables
- `submission_transitions`

Affected APIs:

- admin reporting APIs or dashboard aggregation

Migration risk:

- low

Backward compatibility:

- derived reporting layer only
- no change to existing write contracts required initially

### Recommendation 3. Standardize review-governance metadata across families

Objective:

- normalize how "requires review", "approved by policy", "approved by human", and "mutated live" are represented across feeds, candidates, and submissions

Affected families:

- all families except the execution-adapter-only layer

Affected tables:

- `source_feed_states`
- candidate readiness or review tables
- `submissions`
- `submission_transitions`

Affected APIs:

- feed control-plane APIs
- candidate review APIs
- community queue APIs

Migration risk:

- medium

Backward compatibility:

- add normalized metadata fields or projections before changing behavior
- do not collapse workflow engines together as a first step

### Recommendation 4. Unify operator observability before unifying write paths

Objective:

- build one ORAN ingestion operations dashboard spanning feed health, queue health, candidate backlog, submission backlog, publication outcomes, and replay controls

Affected families:

- all families

Affected tables:

- read-only aggregation from existing stores

Affected APIs:

- ORAN admin ingestion APIs and dashboard UI

Migration risk:

- low

Backward compatibility:

- fully backward-compatible if implemented as read-model aggregation

### Recommendation 5. Introduce a family-neutral replay and recovery catalog

Objective:

- make replay and recovery procedures discoverable across feeds, queue-driven candidates, and submission projections

Affected families:

- structured feed federation
- candidate pipeline
- submissions workflow

Affected tables:

- feed state tables
- ingestion jobs and evidence tables
- submissions and transition tables

Affected APIs:

- admin control-plane and runbook surfaces

Migration risk:

- low to medium depending on whether write controls are added

Backward compatibility:

- start with documentation plus admin read-model support
- add mutation controls only after operator semantics are clear

### Recommendation 6. Remove documentation ambiguity about execution entrypoints

Objective:

- align runbooks and architecture docs so contributors do not mistake stubs for current production entrypoints

Affected families:

- candidate pipeline
- Azure Functions execution layer

Affected tables:

- none

Affected APIs:

- documentation only

Migration risk:

- low

Backward compatibility:

- no runtime change

---

## Guardrails For Future Changes

Any future ingestion work in ORAN should preserve the following:

- every family must retain provenance through source assertion, evidence, or both
- no family should gain a shortcut that writes directly to live seeker tables without its established governance path
- convergence should happen first at read-model, observability, and governance-metadata layers
- convergence should happen later, and only carefully, at write-path orchestration layers
- Azure Functions should continue to be treated as execution adapters unless the code explicitly re-establishes them as primary entrypoints

---

## Verified Schema Surface

### Candidate pipeline tables

- `ingestion_jobs`
- `evidence_snapshots`
- `extracted_candidates`
- candidate review and routing support tables
- verification and readiness support tables

Purpose:

- job tracking
- immutable evidence capture
- extracted staging records
- confidence, checklist, tag, and routing state

### Source assertion and feed registry tables

- `source_systems`
- `source_feeds`
- `source_feed_states`
- `source_records`
- `source_record_taxonomy`

Purpose:

- source registry and operational registry
- feed config and run-state management
- immutable source assertions
- feed-level publication and replay controls

### Canonical federation and export tables

- canonical organizations, services, locations, and relationship tables
- `entity_identifiers`
- `hsds_export_snapshots`
- `lifecycle_events`

Purpose:

- federated normalized service graph
- identifier preservation and publication mapping
- export snapshot versioning
- entity lifecycle history

### Universal submission and form tables

- `submissions`
- `submission_transitions`
- `submission_slas`
- `form_templates`
- `form_instances`

Purpose:

- reviewable workflow record
- audit trail of workflow status changes
- SLA enforcement
- reusable structured intake forms
- saved submission drafts and payloads

### Live seeker-facing publication tables

- `organizations`
- `services`
- `locations`
- `service_at_location`
- `addresses`
- `phones`
- `confidence_scores`
- taxonomy and tag tables referenced by live-publish logic

Important publication truth:

Both the canonical publication lane and the candidate publication lane ultimately materialize into seeker-visible live tables. They just get there differently.

---

## Active, Partial, and Legacy Classification

### Active and current

- `src/agents/ingestion/service.ts`
- `src/agents/ingestion/pipeline/orchestrator.ts`
- `src/agents/ingestion/materialize.ts`
- `src/agents/ingestion/livePublish.ts`
- `src/agents/ingestion/autoPublish.ts`
- `src/agents/ingestion/promoteToLive.ts`
- `src/services/ingestion/hostPortalIntake.ts`
- `src/services/resourceSubmissions/service.ts`
- `src/app/api/internal/ingestion/feed-poll/route.ts`
- `functions/pollSourceFeeds/index.ts`
- admin candidate publish route
- community queue routes
- host service routes

### Active but separate family, not fully converged

- candidate publish/readiness path versus canonical auto-publish path
- submissions workflow versus candidate pipeline
- host portal intake versus crawl candidate intake

### Partial, adapter-only, or overstated in old docs

- `functions/manualSubmit/index.ts`
- older queue-first documentation that implies all Function entrypoints are equally current

### Audit conclusion on legacy risk

The repository has some documentation drift. The code itself is more reliable than the older narrative around it. The safest mental model is to trust the current `src/agents/ingestion/**` domain and current API routes over older claims that all ingestion still centers on Azure Functions HTTP and queue entrypoints.

---

## Readiness Assessment for Nationwide Ingestion

### Ready in code

- source feed polling service
- feed admin controls and operational state
- replay and bulk feed operations
- candidate ingestion and admin publication path
- host portal review queue path
- community review workflow
- export snapshot generation
- publication event tracking

### Not proven in this audit session

- live runtime execution against a configured production database
- live 211 feed credential and environment validation in this workspace
- end-to-end canary against real external feeds from this session

Reason:

This environment does not currently prove `DATABASE_URL` and the required runtime configuration needed to execute the real ingestion loops here.

### Most important architectural gap still remaining

If the desired future state is: every source, including 211 feeds, should pass through one identical score, tag, submit-for-verification or auto-publish lane, that is not fully true yet.

Today the platform supports both:

- feed federation and canonical publication
- candidate staging and candidate publication

Those are both real. They are not identical.

An equally important second gap is that the governance layer is still distributed across three abstractions:

- feed publication policy
- candidate readiness and explicit publish
- submission workflow approval

That distribution is manageable today, but it is the main reason ORAN still behaves as a multi-family ingestion platform rather than a single governed intake envelope.

---

## Final Audit Judgment

The repository contains a serious ingestion platform, not a mockup.

It already supports:

- structured feed ingestion
- manual and batch URL ingestion
- host portal-originated resource changes
- community and host submission review
- explicit candidate publication
- canonical publication
- provenance recording through source assertions

What it does not yet support is a single universal end-to-end ingestion lane that every source family uses identically.

The most accurate high-level statement is:

ORAN has a real multi-family ingestion platform with shared provenance, review, and publication infrastructure. The structured feed path is operational and unified around the source assertion plus canonical federation model. The crawl/manual candidate path is operational and unified around evidence plus candidate staging. Host and community submissions are operational and unified around submissions plus workflow. These families interoperate, but they do not all converge on one identical runtime path.

That is the code-verified current truth of the system as of 2026-03-13.
