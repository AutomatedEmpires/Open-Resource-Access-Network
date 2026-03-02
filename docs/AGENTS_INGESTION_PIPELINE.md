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

### 7) Reverification

- Scheduled re-checks on a cadence.
- Drift triggers:
  - downgrade confidence
  - flag for review
  - optionally unpublish if critical data becomes invalid

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

Canonical statuses (align to `verification_queue` in `docs/DATA_MODEL.md`):

- `pending` — newly extracted/verified; needs review
- `in_review` — assigned and actively reviewed
- `verified` — approved for publish (publish is a separate action)
- `rejected` — rejected (with reason)
- `escalated` — requires ORAN-admin attention

Hard rule: every status transition MUST emit an audit event.

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

The ingestion pipeline may compute an **internal intake confidence** used for:

- review priority
- routing/escalation
- reverification cadence

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
