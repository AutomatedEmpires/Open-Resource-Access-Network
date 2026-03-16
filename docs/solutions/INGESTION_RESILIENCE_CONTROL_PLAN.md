# Ingestion Resilience Control Plan

This document turns scenarios 301-500 into an actionable hardening program for ORAN's ingestion, review, publication, and lifecycle systems.

It is intentionally additive. The current publication controls remain in place:

1. Identity convergence
2. Advisory locking
3. Source-authority ranking
4. Non-destructive updates
5. Review fallback
6. Provenance and lifecycle capture
7. Linkage backfill

The work below adds integrity and resilience around those controls.

## New Control Families

### 1. Actor Trust and Attestation

Add risk-aware controls for every mutation actor:

- Host operators
- Reviewers
- ORAN admins
- Anonymous/public submitters
- Partner feeds and service principals

Recommended additions:

- recent-auth or MFA freshness for high-impact actions
- actor reputation and anomaly scoring
- source assertion signatures or equivalent trust attestation for feeds
- per-actor velocity limits for creates, edits, flags, suppressions, and approvals

### 2. Review Integrity Controls

High-risk review actions should not rely on one actor alone.

Recommended additions:

- two-person approval for source trust changes, suppression, zone changes, threshold changes, ownership transfers, and high-risk reversals
- append-only or versioned review notes
- conflict-of-interest detection between reviewers and organizations
- stale-view / stale-version rejection for approval actions

### 3. Abuse-Resistant Flagging and Feedback

Flagging should be useful without being a weapon.

Recommended additions:

- reporter reputation weighting
- diversity/quorum requirements before suppression
- cluster detection for coordinated flag waves
- protection against false spam moderation on valid reports

### 4. Silent Resource and Silent Owner Policies

ORAN needs a formal policy for silence.

Recommended additions:

- `at_risk`, `dormant`, and `integrity_hold` states
- separate silence tracking for organization, branch, and host owner
- silence escalations based on complaint volume, missed reverification, and owner inactivity
- scheduled outreach and verification attempts with recorded outcome

### 5. Degraded-Mode Automation

When key dependencies fail, ORAN should narrow automation instead of pretending everything is fine.

Recommended additions:

- dependency heartbeat monitoring
- per-dependency degraded-mode policy table
- narrower auto-publish categories during outages
- stronger review requirements for multilingual, geospatial, and crisis-adjacent fields when those checks degrade

### 6. Fraud Clustering and Investigation Packs

Multiple suspicious resources often belong to one campaign.

Recommended additions:

- cluster by phones, domains, attachments, text similarity, and timing
- investigator view that groups suspicious submissions into one campaign
- resource-level and campaign-level risk scores

### 7. Replay-Safe Recovery and Integrity Scans

Infrastructure failures should be repairable without duplication or rollback.

Recommended additions:

- workflow version guards on all high-impact writes
- durable heartbeats for polls, reverification, scans, and notifications
- integrity scanners for missing lifecycle events, missing snapshots, missing audit rows, and overdue reverifications
- bounded replay windows with checkpoint repair

## Priority Order

### Immediate

- dual control for trust/suppression/threshold changes
- silent-owner and silent-reviewer detection
- cluster detection for repeated phones, URLs, and attachments
- degraded-mode policy switches for feed, geocode, translation, and safety dependency failures
- stale-view protection on reviewer actions

Implemented in the current tranche:

- dual control for source trust changes, source-system trust-tier changes, source-feed auto-publish rollout, and ingestion source/system/feed deactivation through `ingestion_control_change`
- active feed silence metrics and degraded-mode recommendation surfaced in the ORAN-admin ingestion overview
- reviewer-silence and owner-organization silence metrics surfaced in the ORAN-admin ingestion overview so stale human governance is visible alongside feed degradation
- runtime enforcement for human-governance silence through the internal SLA/escalation job: stalled assignments are reassigned away from silent reviewers and silent owner organizations with active listings trigger continuity outreach

### Near-Term

- actor-risk scoring
- append-only review-note ledger
- campaign investigation surfaces
- `at_risk`, `dormant`, `integrity_hold` lifecycle states
- queue-health SLOs and assignment lease reclamation

### Later

- signed source assertions for trusted feeds
- advanced contact reputation checks
- adversarial replay harness for scenarios 301-500
- incident-mode control bundles by category and geography

## Detection and Monitoring

Track these signals explicitly:

- source heartbeat age
- reviewer inactivity age
- assignment age
- overdue reverification count
- suppression decision count by source and by reviewer
- trust-tier change count
- cluster count for repeated phone or attachment reuse
- complaint burst rate by service and by region
- percentage of high-risk items waiting beyond SLA
- dependency degraded minutes by control family

## Safe Failure Rules

When uncertainty rises, ORAN should follow these rules:

1. Preserve the last known-good public state whenever possible.
2. Do not let weaker or degraded inputs erase stronger verified fields.
3. Narrow automation before broadening review debt into public harm.
4. Escalate unresolved conflicts rather than flattening them into seeker-visible certainty.
5. Never let one actor or one dependency become the sole authority on a high-risk change.

## Relationship To Existing Proof Harness

The current executable harness covers documented scenarios 1-300 at the control-coverage level.

Scenarios 301-500 should be treated as the next resilience tranche. They should enter the executable harness only after the corresponding runtime controls are implemented and regression-tested.
