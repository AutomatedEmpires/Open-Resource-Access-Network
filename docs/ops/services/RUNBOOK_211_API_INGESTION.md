# Runbook: 211 API Ingestion Rollout

## Metadata

- Runbook ID: `RUNBOOK_211_API_INGESTION`
- Owner role: Data Platform Lead
- Reviewers: Ingestion Operations Lead, Platform On-Call Lead, ORAN Admin Lead
- Last reviewed (UTC): 2026-03-13
- Next review due (UTC): 2026-06-13
- Severity scope: SEV-2 to SEV-4

## Purpose And Scope

This runbook is the phased execution plan for turning the existing HSDS / 211 federation code into a repeatable production 211 API ingestion workflow.

It covers:

- 211 source bootstrap and feed registration
- staging and production runtime configuration
- staged rollout from source records to canonical entities to live publication
- auto-publish policy design for trusted 211 feeds
- incremental sync, observability, and rollback controls

It does not replace the general ingestion incident procedure in `docs/ops/services/RUNBOOK_INGESTION.md`. Use that runbook for active incidents, queue failures, or poison-message recovery.

## Safety Constraints (Must Always Hold)

- Seekers only see stored records; 211 API responses must never bypass stored persistence.
- 211 ingestion must enter the source assertion layer first, then canonical federation, then human-governed or policy-governed publication.
- No source may auto-publish without explicit trust-tier and publication-policy approval.
- Source identifiers, taxonomy references, and provenance must be preserved for round-trip export and auditability.
- Crisis routing, privacy controls, and seeker retrieval constraints must remain unchanged.

## Current State Snapshot

As of 2026-03-13, the repository has the following 211 / HSDS implementation status:

Implemented:

- explicit `source_systems`, `source_feeds`, `source_records`, taxonomy, canonical federation, and HSDS export persistence
- unified feed polling in `src/agents/ingestion/service.ts`
- 211 NDP connector with Zod-validated schemas and bundle decomposition
- 211-specific normalizer with eligibility, cost, language, and taxonomy enrichments
- manual admin route to trigger feed polling: `POST /api/admin/ingestion/feeds/poll`
- operator bootstrap surface for pollable `source_systems` + `source_feeds`
- source-system and source-feed detail APIs for update and deactivation
- scheduled source-feed poller via internal route + Azure Function timer
- fail-closed runtime gating for 211 polling when enabled in production
- idempotent source/feed bootstrap script for staging and production seeding
- durable `source_feed_states` persistence for publication mode, emergency pause, data-owner filters, replay cursors, and sync attempt summaries
- `winningSourceSystemId` assignment during normalization for canonical orgs, services, and locations
- feed-poll audit events (`feed.poll_started`, `feed.poll_completed`, `normalize.failed`) plus monitoring queries
- `feed.poll_completed` now records `publicationReason` and optional `decisionReasons` so operators can distinguish approval-gate fallback, missing-location fallback, and policy-threshold filtering without replaying code paths manually
- publication-mode routing in the poll loop for `canonical_only`, `review_required`, and controlled `auto_publish`
- replay-safe checkpoint advancement for discovered 211 organization batches
- admin replay-from-checkpoint and bulk feed-state operations for large-scale rollout and recovery

Not yet operationally complete:

- production publication rights and approved data-owner scope still require explicit owner sign-off
- staging canary execution and human spot-check sign-off remain required before enabling any broad-scope production auto-publish

## Rollout Objective

The target operating model is:

1. ORAN registers approved 211 source systems and feed definitions.
2. Scheduled and manual feed polling fetches 211 source data into `source_records`.
3. Normalization creates canonical organizations, services, and locations with provenance.
4. Publication policy decides whether records remain canonical-only, require review, or auto-publish.
5. Incremental sync and observability maintain freshness, safety, and operator trust.

The chosen rollout target for this plan is:

- environment strategy: staging and production in parallel, but with stricter production gates
- source scope target: broad nationwide 211 scope
- publication target: eventual auto-publish for trusted 211 feeds after staged validation

Best-practice constraint: even with a broad-scope end goal, rollout must still progress through bounded canary phases before enabling production auto-publish.

## Phase Plan

### Phase 0: Decision Lock And Source Approval

Objective: confirm the non-code prerequisites so engineering does not operationalize an undefined source policy.

Required outputs:

- approved list of 211 data owners and/or nationwide access scope
- legal confirmation for storage, normalization, and publication rights
- trust-tier decision for each 211 source system (`trusted_partner`, `curated`, or stronger)
- publication posture decision per source: `canonical-only`, `manual publish`, or `auto-publish eligible`
- rollback owner and communications owner for 211 ingestion changes

Execution tasks:

1. Create a source onboarding sheet with: provider name, access model, `dataOwners` scope, rate limits, freshness expectations, legal notes, and trust tier.
2. Refuse production auto-publish until licensing and publication terms are explicitly recorded.
3. Define the initial canary subset even if the end-state target is nationwide.

Exit criteria:

- every launch source has a named owner, trust tier, and allowed publication mode
- production publication rights are documented, not implied

### Phase 1: Bootstrap And Runtime Parity

Objective: make 211 ingestion deployable and repeatable in both staging and production.

Required engineering work:

1. Add an operator-safe bootstrap path for `source_systems` and `source_feeds`.
2. Register a first-class feed configuration surface with the following fields:
   - source system name
   - `family`
   - trust tier
   - feed name
   - feed type
   - `feed_handler`
   - `base_url`
   - `refresh_interval_hours`
   - active/inactive toggle
   - jurisdiction scope
   - profile / terms / notes metadata
3. Add staging and production seed/bootstrap records for approved 211 sources.
4. Add deployment-time validation for 211 runtime requirements when a 211 feed is enabled:
   - `DATABASE_URL`
   - `NDP_211_SUBSCRIPTION_KEY`
   - `NDP_211_DATA_OWNERS`
   - app/function URL and auth requirements for scheduled triggers
5. Add a dedicated feed-poll scheduler for source feeds instead of relying only on the admin button.

Best-practice defaults:

- use Key Vault references for all 211 credentials
- keep staging and production scopes separate
- keep bootstrap idempotent so feeds can be reapplied safely
- stamp every bootstrapped feed with explicit `feed_handler`

Exit criteria:

- staging and production can both list approved 211 feeds from the database
- source-feed polling can be triggered manually and on schedule
- runtime validation fails closed when 211 polling is enabled without required credentials

### Phase 2: Canonical Ingestion Canary

Objective: prove that 211 polling and normalization behave correctly before any live publication.

Execution tasks:

1. Run staging polls against a bounded canary data-owner scope.
2. Capture metrics for:
   - organizations fetched
   - source records created
   - duplicates skipped
   - normalization failures
   - canonical entities created
   - taxonomy crosswalk hit rate
3. Add explicit audit events for feed-poll start, feed-poll completion, normalization failure, and feed-level error summaries.
4. Add operator dashboards or KQL baselines for:
   - feed success/failure rate
   - per-feed latency
   - source-record backlog
   - normalization error distribution
   - data-owner volume and drift
5. Reconcile canonical outputs against sample 211 source records for field fidelity.

Staging canary execution sequence:

1. Narrow the staging feed to the approved canary `includedDataOwners` set and keep `publicationMode='review_required'`.
2. Trigger a poll with the scheduled poller or `POST /api/admin/ingestion/feeds/poll`.
3. Generate a reconciliation artifact from persisted data:

   `npm run report:211-canary -- --feed-id <source-feed-id> --hours 24 --sample-size 10 --format markdown --out reports/211-canary-<date>.md`

4. Review the artifact for:
   - normalization coverage percent
   - top processing errors
   - canonical entity counts by type
   - service publication-status distribution
   - sample organization-name, service-name, and city matches between source records and canonical outputs
5. Sign off on the artifact before widening the canary scope or changing publication policy.

Best-practice constraints:

- no auto-publish in this phase
- do not widen source scope until normalization and provenance quality are stable
- inspect the canonical output shape, not just HTTP success

Exit criteria:

- canonical ingestion succeeds for the canary set with stable error rates
- feed observability exists and is actionable
- provenance and taxonomy fidelity pass human spot-checks

### Phase 3: Publication Policy And Trust Controls

Objective: convert 211 canonical data into a governed publish model.

Required engineering work:

1. Decide how `winningSourceSystemId` is assigned for 211-normalized canonical entities.
2. Wire publication decisions to source trust tier and evidence quality.
3. Define auto-publish eligibility rules specifically for 211, including:
   - required trust tier
   - minimum canonical confidence
   - higher minimum canonical confidence for `trusted_partner` feeds than for `curated`
   - required field completeness
   - exclusion conditions (inactive, deleted, ambiguous, missing location logic, weak taxonomy)
4. Add a production-safe review mode:
   - staging: allow test auto-publish
   - production: start with manual publish or narrow auto-publish canary
5. Define suppression and unpublish behavior when source quality regresses.

Recommended policy:

- treat 211 feeds as `trusted_partner` or `curated` until production quality is proven
- require manual publish first for the broad-scope rollout
- enable auto-publish only after review metrics and regression behavior are verified
- when `trusted_partner` feeds are allowed to auto-publish, require both explicit feed approval and a stricter confidence floor than `curated`

Exit criteria:

- publication policy is documented and testable
- canonical rows can be deterministically routed to review or publish
- rollback path exists for accidental over-publication

### Phase 4: Incremental Sync And Nationwide Scale Hardening

Objective: replace broad repeated scans with a sustainable sync model.

Required engineering work:

1. Add a persisted feed-state model for 211 sync checkpoints.
2. Prefer upstream incremental query parameters or updated-since semantics if supported.
3. If upstream does not support checkpoints, add bounded pagination and partitioned polling by data owner or geography.
4. Record last successful sync window, last attempted sync window, and replay markers.
5. Add idempotent retry logic for partial poll failures.
6. Add rate-limit aware concurrency controls and backoff specific to the 211 API.

Required operator controls:

- per-feed enable/disable
- per-data-owner throttle or exclusion list
- per-feed emergency pause
- replay-from-checkpoint operation

Exit criteria:

- sync can recover from partial failure without full re-scan
- poll volume and latency stay within upstream limits
- operators can pause, replay, or narrow scope without code changes

### Phase 5: Staging And Production Go-Live Gates

Objective: make the rollout auditable and reversible.

Staging gate:

- bootstrap path works end to end
- scheduled poller works
- canonical data quality is acceptable
- feed metrics and alerts are visible
- manual or auto-publish path has been exercised successfully
- latest staging canary artifact exists and has human reconciliation sign-off

Production gate:

- source licensing and publication rights documented
- feed bootstrap is idempotent and reviewed
- runtime secrets are present and validated
- rollback procedure tested
- alert routing and on-call ownership confirmed
- initial production scope is explicitly smaller than the maximum supported scope, even if the target is nationwide

Rollback plan:

1. disable affected 211 feeds
2. disable 211 auto-publish policy
3. suppress or unpublish affected live services if trust regression is confirmed
4. keep source records and canonical provenance intact for forensic review

### Phase 6: Steady-State Operations

Objective: keep 211 ingestion reliable after launch.

Recurring tasks:

- daily feed success-rate review
- weekly duplicate and normalization drift review
- weekly source-owner coverage review
- monthly publication-quality audit against randomly sampled live services
- quarterly licensing and trust-tier revalidation for 211 sources

Required runbook follow-ons:

- add 211-specific alerts and KQL references to `docs/ops/monitoring/MONITORING_QUERIES.md`
- extend `docs/ops/services/RUNBOOK_INGESTION.md` with 211-specific poller diagnostics once scheduler work exists
- record measured RTO/RPO for 211 ingest rollback and replay drills
- retain the latest `report:211-canary` artifact for each staging scope expansion and production go-live review

## Workstreams And Deliverables

### Engineering

- source-system / source-feed bootstrap API or CLI
- scheduled source-feed poller
- feed-state checkpoint model
- publish-policy wiring and tests
- audit events and observability additions

### Data Governance

- source inventory
- data-owner scope plan
- trust-tier assignment
- publication-rights approval

### Operations

- staging and production run sequences
- alert thresholds
- rollback drill
- on-call ownership

### QA / Validation

- connector fixtures for real 211 response variants
- normalization fidelity regression suite
- publish-policy tests
- staging dry-run and replay validation

## Immediate Execution Backlog

These are the first repository work items to execute next:

1. Lock the initial nationwide canary scope by approved `dataOwners` and publication rights.
2. Keep production 211 publication in `review_required` or narrowly canaried `auto_publish` mode until the feed carries an explicit auto-publish approval stamp (`auto_publish_approved_at` + `auto_publish_approved_by`) from an ORAN admin.
3. Run a staging canary with the new `report:211-canary` artifact and sign off on canonical field fidelity before widening production scope.
4. Define the production operator run sequence for using bulk pause/review/replay controls during incident rollback and replay drills.

## Questions Still Requiring Explicit Owner Decisions

1. Which exact data-owner scopes are approved for first production launch, even if the eventual target is nationwide?
2. What legal/publication terms govern seeker-visible republication of 211-derived content?
3. Who owns the go/no-go decision for switching from canonical-only or manual publish to auto-publish?

## References

- `docs/DECISIONS/ADR-0007-hsds-211-federation-canonical-model.md`
- `hsds_211_integration_plan.md`
- `docs/contracts/INGESTION_CONTRACT.md`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/core/OPERATIONS_READINESS.md`
- `docs/ENGINEERING_LOG.md`
