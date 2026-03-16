# ORAN Ingestion / Verification Agent (SSOT)

This document is the **system specification** for the ingestion agent(s) that locate, extract, verify, score, and (only after approval) publish service records.

## Non‑negotiables (ORAN safety contract)

- **Seekers only see stored records**. The agent must never inject user-visible “facts” directly into seeker chat/search.
- **No LLM in retrieval/ranking**. LLMs may assist *only* with extraction/summarization during ingestion and must be treated as **unverified** output.
- **Auditability required**. Every action must emit an audit event (who/what/when/why) and retain evidence links.
- **Idempotent + deduped**. The agent must not run extraction twice for the same source snapshot.
- **Known sources only** by default. Crawling is allowlisted. Anything outside allowlist is rejected or quarantined.

## Pipeline overview

### 1) Locate candidates (non-user-facing)

Input examples:

- Curated source lists (official directories, government listings, partner feeds)
- Manual submissions (staff/partner)
- Allowed scrapes (allowlist)

Output:

- A **Candidate** record + evidence pointer(s), in a staging area.

### 2) Fetch evidence (immutable snapshot)

- Store raw HTML/PDF (or normalized text) in Blob Storage.
- Compute:
  - `sourceUrl`
  - `fetchTimestamp`
  - `contentHash`
  - `canonicalUrl` (after redirects)

### 3) Extract structured fields (UNVERIFIED)

- Parse evidence into a normalized “extracted candidate” shape.
- Attach provenance: field-level “where did this come from?” when possible.

### 4) Verify (repeatable checks)

Verification is a set of independent checks producing evidence and pass/fail/unknown:

- **Domain allowlist**: must match an allowed domain pattern.
- **Contact validity**: phone/email format checks; optionally confirm phone line type.
- **Hours stability**: detect frequent changes; flag if unstable.
- **Cross-source agreement**: compare multiple sources (when available).
- **Location plausibility**: geocode + bounding-box checks for known service area.
- **Policy constraints**: ensure no disallowed claims are shown.

### 5) Confidence scoring (internal signal)

- Score is computed deterministically from verification results + provenance.
- Score is used to prioritize review and set reverification cadence.
- Score does **not** auto-publish.

### 6) Publish gate (human-in-the-loop)

- Records become “public” only after a reviewer approves.
- The agent may propose changes, but approval is required.

Source-aware publication policy:

- Trusted, policy-approved machine sources may auto-publish after source assertion, canonical federation, confidence evaluation, and safety checks.
- Host-controlled listing submissions may auto-publish when submitted by an authenticated organization operator through the managed host workflow.
- Allowlisted crawl/manual candidates may auto-publish when they satisfy the publish-readiness threshold; otherwise they remain in the human review lane.
- Community/public submissions remain review-required.
- Low-confidence, policy-failed, or flagged items always route to human review.
- Every live publication lane must take the same transaction-scoped merge lock and resolve existing active organization/service/location rows before inserting, so simultaneous host, crawler, and feed events converge on one live identity instead of creating duplicates.
- Host-controlled ownership is preserved at the workflow layer; non-host lanes may refresh an existing live record but must not implicitly seize control by creating a parallel live listing.
- After identity convergence, every lane must apply the same source-authority ranking before overwriting the current live snapshot. Current precedence is: `host_submission` > `community_review` > `canonical_feed` > `candidate_allowlisted` > `unknown`.
- A weaker incoming source may attach provenance, linkage, and lifecycle events to an existing published record, but it must not silently downgrade stronger current seeker-visible data.
- Incoming omissions or nulls must not erase existing live fields during update flows. Publication refreshes are non-destructive by default, and destructive removals should be treated as explicit reviewable changes rather than accidental blanks.

Integrity and resilience extensions:

- High-risk mutations must be protected against compromised or conflicted actors. Source trust changes, bulk suppression, threshold changes, ownership transfer, and other integrity-sensitive actions should require stronger controls than ordinary review.
- ORAN should treat repeated flags, clustered complaints, repeated contact reuse, suspicious evidence reuse, and bursty actor behavior as abuse signals that can narrow automation and raise review priority.
- Silence is a signal. Long-silent organizations, long-silent host owners, long-silent reviewers, and long-silent sources should be surfaced explicitly and may downgrade trust or force re-review.
- Dependency outages must narrow automation. When critical verification dependencies degrade, ORAN should preserve last-known-good data and reduce autonomous mutation scope instead of acting as if checks still passed.
- Review, audit, and lifecycle history for high-risk decisions should be tamper-evident or versioned so reversals and overrides remain forensically understandable.
- Replay and recovery logic must not allow infrastructure retries to outrank newer human decisions.

Current implemented tranche:

- High-risk ingestion control mutations now route through `submission_type='ingestion_control_change'` with `pending_second_approval` status instead of applying directly when they change source trust, source-system trust tier, source-feed auto-publish posture, or deactivate ingestion authorities.
- ORAN-admin ingestion overview now surfaces silent-feed counts plus a degraded-mode recommendation so operators can narrow automation when active or auto-publish feeds fall behind health expectations.
- ORAN-admin ingestion overview now also surfaces silent-reviewer backlog and silent owner-organization coverage gaps so long-inactive human operators are treated as integrity risk, not just staffing noise.
- The internal SLA/escalation job now reassigns stalled submissions away from silent reviewers and sends owner-continuity outreach alerts when active live listings sit under silent host-admin coverage.

### 7) Reverification

- Scheduled re-checks on a cadence.
- Drift triggers:
  - downgrade confidence
  - flag for review
  - optionally unpublish if critical data becomes invalid
- Every publish path that materializes a live listing must stamp deterministic `lastVerifiedAt` and `reverifyAt` metadata so feed, crawler, and submission-origin records can be re-checked on the same operational cadence.

## When the agent operates (triggers)

The ingestion system must be explicit and deterministic about **when it runs**.

Supported trigger classes:

- **Manual seed submission** (primary nationwide bootstrap):
  - A staff/admin/partner submits a URL or feed.
  - The agent validates the URL against the Source Registry and either fetches it (allowlisted/quarantine) or refuses (unregistered/blocked).

- **Scheduled reverification** (post-publish + pre-expiry):
  - A scheduler periodically selects records whose `reverifyAt` is due.
  - Reverification produces new evidence snapshots + new verification checks and may downgrade confidence.

- **Registry change trigger** (config-driven):
  - If a domain is promoted/demoted in the Source Registry, the agent may enqueue impacted staged items for re-review.

- **Content drift trigger** (optional, conservative):
  - If a fetch detects a material change (`contentHash` changes) for an allowlisted source, enqueue a review.
  - Drift is never auto-publish.

Hard rule: every triggered run must create a `correlationId` and emit audit events.

## Scrubbing, redaction, and privacy rules

The ingestion agent must treat all fetched content as untrusted.

Minimum required scrubbing behaviors:

- **No credentials / no authenticated scraping**:
  - Do not log in to sites.
  - Do not store cookies or session tokens.

- **PII minimization**:
  - Only store what is needed to represent a service listing.
  - Never store end-user-submitted sensitive details in evidence snapshots.

- **Secret-safe telemetry**:
  - Audit logs and telemetry must not contain secrets.
  - Avoid storing raw contact form submissions or any tokens embedded in URLs.

- **URL hygiene**:
  - Strip URL fragments.
  - Remove common tracking parameters when persisting canonical URLs (implementation detail; enforced in code/DB layer).

## Copilot Studio / assistant agents (optional, admin-only)

It is acceptable to use Microsoft Copilot Studio (or similar) as an **internal reviewer assistant** to:

- summarize already-stored evidence snapshots
- help a reviewer complete checklists
- draft reviewer notes

It must not:

- crawl the public web directly outside the Source Registry
- write to published ORAN tables
- generate or inject new “facts” into seeker chat/search

## Minimal publish criteria (baseline)

A candidate is eligible to be approved for publish only if:

- Source is allowlisted OR explicitly overridden by an admin reviewer.
- Evidence snapshot exists and is linked.
- Required fields exist (minimum):
  - organization name
  - service name/category
  - service description (can be brief)
  - at least one contact method (phone or official web page)
  - at least one location OR explicitly “remote/virtual”
- No failing critical verification checks.

## Work item lifecycle (human-manageable, timestamped)

The ingestion system must maintain a **single source of truth status** for each candidate/extraction so admins can filter and act deterministically.

Canonical workflow statuses align to the universal `submissions` pipeline, not the legacy `verification_queue` shape:

- `draft` / `submitted` — newly captured or manually created work item
- `auto_checking` — automated checks are running
- `needs_review` — ready for human intake/review
- `under_review` — assigned and actively reviewed
- `pending_second_approval` — waiting for a distinct reviewer when two-person approval applies
- `approved` — approved for publish or downstream action
- `denied` / `returned` / `withdrawn` / `expired` / `archived` — terminal or non-publish outcomes
- `escalated` — requires ORAN-admin attention

Community queue and ingestion views may project these into simpler lane-specific labels, but the submission status model remains canonical. Hard rule: every status transition MUST emit an audit event.

## SLA timers + re-review

Every work item must have deterministic timers so nothing “falls through the cracks”:

- `reviewBy` — when human review should happen by (SLA)
- `reverifyAt` — next scheduled reverification time
- `lastVerifiedAt` — when the last successful verification occurred

Default rules (can be parameterized per source):

- If any **critical** check is `fail` → status `escalated`, `reviewBy = now + 24h`
- If overall intake confidence < 60 → status `pending`, `reviewBy = now + 7d`
- If overall intake confidence 60–79 → status `pending`, `reviewBy = now + 72h`
- If overall intake confidence ≥ 80 → status `pending`, `reviewBy = now + 7d` (still requires review; higher score affects priority and reverification cadence)

Reverification cadence (post-publish):

- High band (≥80) → `reverifyAt = now + 180d`
- Likely band (60–79) → `reverifyAt = now + 90d`
- Possible (<60) → `reverifyAt = now + 30d` OR keep in review until improved

Silence-sensitive follow-on policy:

- A published listing that repeatedly misses reverification, accumulates unresolved complaints, or loses all responsive owner contact should move through explicit risk states such as watched, at-risk, dormant, or integrity-hold rather than remaining silently trusted.
- A source feed that stays silent or degraded past its expected heartbeat should be downgraded operationally and may lose auto-publish eligibility until revalidated.
- A reviewer or admin whose assignments remain untouched past operational thresholds should lose assignment priority and trigger supervisor visibility.

## Jurisdiction + routing (right admin for the right area)

The agent must compute a **jurisdiction hint** so the system can route items to the correct admin group.

Rules:

- Jurisdiction is derived from explicit evidence (address, stated service area). It is never guessed.
- If the service is remote/virtual and has no geographic boundary, mark it `virtual`.

Routing intent:

- `pending` items are assigned to a `community_admin` for the derived region/state.
- `escalated` items route to `oran_admin`.

## Investigation packs (deep capture of forms/links)

To support nationwide accuracy, the agent must capture “supporting navigation” alongside the extracted fields.

Each extraction should produce an **Investigation Pack**:

- `canonicalUrl` (the primary page)
- `discoveredLinks[]` with types:
  - `home`, `contact`, `apply`, `eligibility`, `intake_form`, `hours`, `pdf`, `privacy`, `other`
- `importantArtifacts[]` pointing to evidence snapshots (PDFs, application forms)

Hard rule: discovered links must be tied back to `evidenceId` and a content hash.

## Confidence scoring coherence (internal vs public)

The ingestion pipeline computes an **internal intake confidence** (0-100) used for:

- review priority
- routing/escalation
- reverification cadence
- color-coded status tier (green/yellow/orange/red)

### Confidence tiers

| Tier | Score Range | Meaning | UI Color |
|------|-------------|---------|----------|
| Green | 80-100 | Ready for publication | #22c55e |
| Yellow | 60-79 | Likely good, needs review | #eab308 |
| Orange | 40-59 | Needs additional verification | #f97316 |
| Red | 0-39 | Insufficient data | #ef4444 |

The tier updates live as the agent completes verification steps and admin fills in missing data.

However, **public ORAN confidence messaging** must follow the SSOT in `docs/SCORING_MODEL.md`:

- 3 sub-scores only (Verification Confidence / Eligibility Match / Constraint Fit)
- fixed weights
- no additional hidden “agent score” driving seeker-facing messaging

## Dedupe rules (“never run the same site 2x for extraction”)

Two levels of dedupe are required:

- **Fetch dedupe**: do not re-fetch the same canonical URL inside a short TTL unless forced.
- **Extraction dedupe**: do not re-run extraction when `canonicalUrl + contentHash` is already processed.

Recommended keys:

- `fetchKey = sha256(canonicalUrl)`
- `extractKey = sha256(canonicalUrl + "|" + contentHash)`

Operational follow-through:

- Ingestion dedupe prevents re-processing the same evidence snapshot.
- Published-listing dedupe is a separate concern:
  - suspected duplicates are surfaced through embeddings-based duplicate review
  - merges remain human-approved so ORAN-native fields and HSDS export mappings are not silently collapsed
- Approved structured submissions must also run deterministic collision resolution before projection:
  - first reuse an explicitly linked org/service when present
  - otherwise attempt active-record matching by official URL, then normalized exact name within the organization
  - if a collision is found, update the existing listing instead of creating a second live row

## Published listing hygiene (staleness, flags, and suppression)

Published listings must not remain seeker-visible when trust signals degrade.

Current enforcement policy:

- `service_updated_after_verification` -> keep listed, route to `reverify`
- `score_staleness` at 90-179 days -> keep listed, route to `reverify`
- `score_staleness` at 180+ days -> suppress from seeker service until reverification
- `score_degraded` below 40 -> suppress from seeker service until reverification
- `feedback_severity` -> suppress from seeker service until reverification when any of these hold:
  - 3+ negative feedback/community reports in 30 days
  - 1 suspected fraud report in 14 days
  - 2 closure reports in 14 days

Implementation notes:

- Suppression means `services.status = 'inactive'`; seeker search already excludes inactive listings.
- Suppression does not delete the record. It creates/maintains an admin review trail and keeps the listing recoverable after reverification.
- `duplicate_listing` reports should route into merge review, not automatic suppression of both records.

## Audit log requirements

Every step emits an audit event with:

- `eventType` (e.g., `candidate.located`, `evidence.fetched`, `extract.completed`, `verify.completed`, `publish.approved`, `publish.rejected`, `reverify.completed`)
- `correlationId` (workflow run id)
- `actor` (service principal / system / human reviewer id)
- `target` (candidate id, service id, evidence id)
- `timestamp`
- `inputs` (safe metadata; no secrets)
- `outputs` (safe metadata)
- `evidenceRefs` (blob URIs, hashes)

## Real-time updates

The agent should publish state transitions so the admin UI can update in near-real-time.

Recommended pattern:

- DB state tables + status columns
- Optional: Postgres `LISTEN/NOTIFY` or Service Bus topic for UI workers

## Database integration (design intent)

The agent writes ONLY to staging + audit tables unless a human approves publish.

Design intent tables (names are illustrative):

- `import_candidates`
- `import_evidence`
- `import_extractions`
- `verification_checks`
- `audit_log`

The SQL agent should implement schema + constraints to enforce:

- unique `extractKey`
- append-only audit log
- foreign key integrity between candidate/evidence/extraction

## Testing strategy

- Unit tests:
  - schema validation
  - dedupe key determinism
  - scoring is stable and bounded (0–100)
- Integration tests (student Azure):
  - queue → worker → DB staging writes → audit log emission
  - idempotency: replay same message does not re-extract
- Smoke tests (prod):
  - can enqueue a no-op candidate and observe audit events

## Deployment separation (student → prod)

- Build/test in student subscription with cheap SKUs.
- Promote by redeploying the same agent code + IaC to prod subscription.
- Do not promote unverified candidate data automatically.

---

## Implementation Reference

### Database schema (`db/migrations/0012_ingestion_pipeline.sql`)

| Table | Purpose |
|-------|---------|
| `source_registry` | Persisted domain allowlist/quarantine/blocked rules |
| `ingestion_jobs` | Tracks crawl/extraction jobs with correlation IDs |
| `evidence_snapshots` | Immutable records of fetched pages/documents |
| `extracted_candidates` | Staging table for extracted service records |
| `resource_tags` | Unified tagging (category, geographic, audience, verification, program) |
| `verification_checks` | Individual check results per candidate |
| `checklist_items` | Required items and their status per candidate |
| `verified_service_links` | Deep links discovered and verified during ingestion |
| `ingestion_audit_log` | Complete audit trail (append-only) |
| `feed_subscriptions` | RSS/sitemap feeds the agent monitors |
| `admin_routing_rules` | Maps jurisdictions to admin reviewers |

Key features:

- `extracted_candidates.confidence_tier` is a **generated column** that auto-updates based on `confidence_score`
- All tables have appropriate indexes for query performance
- Audit log is append-only with correlation ID linking

### TypeScript contracts (`src/agents/ingestion/`)

| Module | Exports |
|--------|---------|
| `contracts.ts` | Core schemas: `EvidenceSnapshot`, `ExtractedCandidate`, `DiscoveredLink`, `InvestigationPack`, `AuditEvent`, etc. |
| `jobs.ts` | `IngestionJob` and helpers: `createIngestionJob()`, `transitionJobStatus()` |
| `tags.ts` | `ResourceTag` and predefined tag values: `CATEGORY_TAGS`, `AUDIENCE_TAGS`, `PROGRAM_TAGS`, etc. |
| `stores.ts` | Store interfaces: `JobStore`, `CandidateStore`, `TagStore`, `VerifiedLinkStore`, etc. |
| `scoring.ts` | Confidence scoring: `computeConfidenceScore()`, `getConfidenceTier()`, `isReadyForPublish()` |
| `sourceRegistry.ts` | Source Registry contracts and `matchSourceForUrl()` |
| `checklist.ts` | Verification checklist management |
| `dedupe.ts` | Deduplication key generation |
| `audit.ts` | Audit writer interface |

### Tagging taxonomy

The agent uses a structured tagging system:

```
tag_type: category
  → food, housing, healthcare, legal, employment, ...

tag_type: geographic
  → us_id_kootenai (country_state_county)
  → us_wa_king_seattle (country_state_county_city)

tag_type: audience
  → veteran, senior, family, youth, disabled, ...

tag_type: verification_missing
  → missing_phone, missing_hours, needs_geocoding, ...

tag_type: program
  → snap, wic, section8, medicaid, ...

tag_type: source_quality
  → gov_source, edu_source, mil_source, quarantine_source
```

### Admin routing

The agent routes candidates to the appropriate admin based on jurisdiction:

1. Extract jurisdiction from evidence (address, stated service area)
2. Query `admin_routing_rules` for best match (most specific wins)
3. Assign to `community_admin` for the region, or `oran_admin` for escalation

Default rule: unassigned jurisdictions route to `oran_admin`.

### Admin review pipeline (`db/migrations/0013_admin_review_pipeline.sql`)

The admin review pipeline extends the ingestion pipeline with capacity-limited routing, tag confirmation, and publish threshold logic.

#### Flow overview

```
[Candidate Created]
       ↓
[Route to ~5 closest admins/orgs]  ← capacity-limited
       ↓
[Admin claims assignment]
       ↓
[Admin reviews: confirm tags, accept/edit field suggestions]
       ↓
[System computes publish readiness]
       ↓
[If ready] → [Publish to live DB] → [Seekers + LLM can see]
```

#### Additional tables

| Table | Purpose |
|-------|---------|
| `admin_review_capacity` | Admin capacity tracking (pending count, limits, coverage zones) |
| `candidate_assignments` | Tracks which admins are assigned to which candidates |
| `tag_confirmations` | Queue for uncertain tags needing human confirmation |
| `field_suggestions` | LLM-generated suggestions for missing fields |
| `field_provenance` | Lightweight evidence: hash + CSS selector + URL per field |
| `publish_readiness` | Aggregated "is ready?" status with all criteria |
| `review_actions` | Audit log for admin review actions |

#### Key features

**Geographic routing with capacity limits**:

- Each candidate is routed to ~5 closest admins based on jurisdiction
- Admins have a max pending reviews limit (default: 10)
- Priority: exact county match > state match > zone match > fallback
- SQL functions: `find_nearest_admins()`, `assign_candidate_to_admins()`

**Tag confidence colors**:

- Tags extracted with low confidence go to a confirmation queue
- Color-coded by tier: green (≥80), yellow (60-79), orange (40-59), red (<40)
- `confidence_color` is a generated column (auto-updates)
- Admins confirm/modify/reject with one click
- Category + geographic tags always require human confirmation

**Field suggestions (LLM-assisted gap filling)**:

- When fields are missing, the agent stores LLM suggestions
- Suggestions include: `suggestedValue`, `reasoning`, `evidenceRefs`
- Admins accept (one click), modify (edit), or reject
- Never auto-applied; always requires human action

**Field-level provenance (lightweight proof)**:

- Instead of full snapshots, store per-field provenance
- Includes: `source_url`, `content_hash`, `css_selector`, `extracted_text`
- Reproducible verification without expensive blob storage

**Publish readiness (deterministic threshold)**:

- `publish_readiness` table tracks all criteria
- `is_ready_for_publish` is a generated column (auto-computed)
- Required criteria:
  - Organization name, service name, description ✓
  - Contact method (phone OR email OR website) ✓
  - Location OR marked as virtual/remote ✓
  - Category tag confirmed ✓
  - Geographic tag confirmed ✓
  - No pending red (low-confidence) tags ✓
  - Domain verification passed ✓
  - Confidence score ≥60 ✓
- SQL function: `compute_publish_readiness()`

**Admin decision flow**:

1. Admin sees candidate in their queue (assignment status: `pending`)
2. Admin claims assignment (status: `pending` → `claimed`)
3. Admin reviews: confirms tags, accepts field suggestions
4. System auto-computes readiness after each action
5. When ready, admin approves → candidate publishes to live DB
6. Live DB feeds seekers + LLM recommendations

**Views for common queries**:

- `v_available_admins` — admins with capacity
- `v_candidates_ready` — ready for publish
- `v_pending_tags_by_color` — tag counts by color per candidate
- `v_candidate_dashboard` — review queue dashboard

#### TypeScript contracts (`src/agents/ingestion/`)

| Module | Exports |
|--------|---------|
| `routing.ts` | `AdminCapacity`, `CandidateAssignment`, `sortAdminsByPriority()`, `createAssignment()`, `claimAssignment()` |
| `confirmations.ts` | `TagConfirmation`, `FieldSuggestion`, `confirmTag()`, `modifyTag()`, `sortTagsByUrgency()` |
| `publish.ts` | `PublishReadiness`, `isReadyForPublish()`, `getReadinessBreakdown()`, `createPublishDecision()` |

#### Store interfaces

| Interface | Location | Purpose |
|-----------|----------|---------|
| `AdminCapacityStore` | `routing.ts` | Capacity queries, increment/decrement pending |
| `AssignmentStore` | `routing.ts` | Assignment CRUD, expiration |
| `TagConfirmationStore` | `confirmations.ts` | Tag confirmation queue |
| `FieldSuggestionStore` | `confirmations.ts` | Field suggestions |
| `PublishReadinessStore` | `publish.ts` | Readiness status |
| `ReviewActionStore` | `publish.ts` | Review audit log |
| `PublishWorkflowStore` | `publish.ts` | Complete publish workflow |

### Chat integration (architecture boundary)

The ingestion agent **writes to DB**. The chat interface **reads from DB**.

```
[Ingestion Agent] → writes → [DB: verified_service_links, services, etc.]
                              ↓
[Chat Interface] → reads  → [DB] → returns stored URLs only
```

The chat service queries `verified_service_links` filtered by:

- `service_id` (must be published)
- `is_verified = true`
- `is_link_alive = true`

This maintains the "stored URLs only" safety gate without any direct coupling between ingestion and chat code.
