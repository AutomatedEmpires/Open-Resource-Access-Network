# FLOW AGENT — Comprehensive Submission Flow Audit

> **Generated**: 2025 · **Scope**: Every submission_type in the universal pipeline
> **Methodology**: Full source-code trace — seeker UI → API route → DB → admin review → notification → outcome

---

## Table of Contents

1. [Appeal Flow](#1-appeal-flow)
2. [Community Report Flow](#2-community-report-flow)
3. [Organization Claim Flow](#3-organization-claim-flow)
4. [Community Queue (Generic Review) Flow](#4-community-queue-generic-review-flow)
5. [Admin Approvals (Org Claims) Flow](#5-admin-approvals-org-claims-flow)
6. [Legacy Reports API](#6-legacy-reports-api)
7. [Submission Types Without Dedicated UI](#7-submission-types-without-dedicated-ui)
8. [Cross-Cutting: Workflow Engine](#8-cross-cutting-workflow-engine)
9. [Cross-Cutting: Notification Service](#9-cross-cutting-notification-service)
10. [Cross-Cutting: Database Schema](#10-cross-cutting-database-schema)
11. [Unified Gap List](#11-unified-gap-list)
12. [Priority Matrix](#12-priority-matrix)

---

## 1. Appeal Flow

### 1.1 When does a seeker file an appeal?

A seeker files an appeal when one of their **own** submissions has been **denied**. The flow is reachable via `/appeal?submissionId=<uuid>` — the `submissionId` query parameter pre-fills the form.

**Entry points (current)**:

- Direct URL: `/appeal?submissionId=<uuid>`
- "Back to profile" link on the appeal page
- Success message after appeal submission says "you will be notified when it is reviewed"

**Missing entry points**:

- ❌ No link from the denied submission itself (e.g., profile → my submissions → denied → "Appeal" button)
- ❌ No browse-denied-submissions picker — the seeker must already know the UUID
- ❌ No navigation link in the seeker menu/nav to the appeal page

### 1.2 What is the complete flow?

```
Seeker visits /appeal?submissionId=<uuid>
  ↓ (AppealPageClient.tsx)
Fills in "reason" (textarea, 10-2000 chars)
  ↓
POST /api/submissions/appeal
  ↓ (submissions/appeal/route.ts)
  1. Rate limit check (user:appeal:write:${ip})
  2. Auth required (getAuthContext)
  3. Zod validation: submissionId (UUID), reason (10-2000), evidence[] (optional, max 10)
  4. Transaction:
     a. Fetch original submission (FOR SHARE lock)
     b. Verify ownership (submitted_by_user_id === userId) → 403
     c. Verify status === 'denied' → 409
     d. Check no pending appeal exists → 409
     e. INSERT into submissions (type='appeal', status='submitted', priority=1)
     f. INSERT submission_transition (draft → submitted)
     g. Notify original reviewer (IF assigned_to_user_id exists)
  5. Return { appealId, message } 201
  ↓
Appeal appears in admin queue at /appeals
  ↓ (oran-admin/appeals/page.tsx → GET /api/admin/appeals)
Admin reviews, clicks "Review" → expanded decision panel
  ↓
Admin clicks Approve or Deny
  ↓ (POST /api/admin/appeals)
  1. Rate limit, auth (community_admin+), Zod (appealId UUID, decision, notes)
  2. Transaction:
     a. SELECT FOR UPDATE (lock appeal row)
     b. Verify status IN (submitted, under_review) → 409
     c. UPDATE appeal status, set reviewer, timestamps
     d. INSERT submission_transition
     e. IF approved + original_submission_id exists:
        - Re-open original to 'needs_review'
        - INSERT transition on original
     f. INSERT notification_event for appeal submitter
  3. Return success
```

### 1.3 Form fields

| Field | Source | Required | Validation | Storage |
|-------|--------|----------|------------|---------|
| submissionId | URL query param | Yes | UUID format (Zod) | `payload.original_submission_id` |
| reason | Textarea | Yes (min 10 chars) | min 10, max 2000 | `notes` column + `payload.appeal_reason` |
| evidence[] | API accepts, UI does NOT expose | No | array of {type, description?, fileUrl?}, max 10 | `evidence` JSONB column |

### 1.4 Where is the data stored?

| Data Point | Column | Table |
|------------|--------|-------|
| Appeal record | `submissions` | `submission_type = 'appeal'` |
| Original submission ref | `payload->>'original_submission_id'` | JSONB |
| Original submission type | `payload->>'original_submission_type'` | JSONB |
| Appeal reason (full) | `notes` | TEXT |
| Appeal reason (in payload) | `payload->>'appeal_reason'` | JSONB (duplicated) |
| Evidence attachments | `evidence` | JSONB |
| Title | `title` | Auto-generated: `Appeal: ${originalTitle}` |
| Priority | `priority` | Hardcoded to `1` |
| Status | `status` | `submitted` initially |
| State changes | `submission_transitions` | Full audit trail |
| Notification to reviewer | `notification_events` | On submit, if assigned |
| Notification to submitter | `notification_events` | On decision |

### 1.5 User-to-DB correlation

- `submitted_by_user_id` = `authCtx.userId` (the seeker who files the appeal)
- `target_type` / `target_id` = copied from original submission
- `service_id` = copied from original submission
- Ownership check: POST verifies `original.submitted_by_user_id === authCtx.userId`

✅ **Correlation is correct** — appeal is tied to the seeker, and ownership is enforced.

### 1.6 Notification process

**On appeal submission (POST /api/submissions/appeal)**:

- Recipient: **original reviewer** (`assigned_to_user_id` on the denied submission)
- Event type: `submission_status_changed`
- Title: `Appeal filed on your decision`
- Action URL: `/appeals?id=${appealId}`
- ⚠️ If the original submission was **never assigned** (assigned_to_user_id IS NULL), **no notification is sent to anyone**
- ⚠️ No notification goes to any admin pool (community_admin / oran_admin)

**On appeal decision (POST /api/admin/appeals)**:

- Recipient: **appeal submitter** (`submitted_by_user_id`)
- Event type: `submission_status_changed`
- Title: `Your appeal has been ${decision}`
- Action URL: `/profile`
- ✅ Always fires — submitter is always known

**Gaps**:

- ❌ If no reviewer was assigned to the original submission, appeal creation is a silent event — no admin learns about it until they manually check the queue
- ❌ No broadcast to admin pool when appeal arrives
- ❌ No SLA is applied to appeals (no applySla() call)

### 1.7 Admin selection — who reviews appeals?

- **GET /api/admin/appeals**: Any `community_admin+` can view the appeal queue
- **POST /api/admin/appeals**: Any `community_admin+` can decide
- No assignment/claim mechanism for appeals (unlike community queue which has lock+assign)
- No round-robin or workload balancing
- No auto-assign on submission
- First admin who opens the decision panel and clicks can decide

**Gap**: ❌ No locking — two admins could simultaneously review the same appeal. The POST uses `FOR UPDATE` row lock within the transaction, but there's no UI-level claim or lock indicator.

### 1.8 Two-person approval for appeals?

- `TWO_PERSON_REQUIRED_TYPES` = `['org_claim', 'removal_request']`
- `appeal` is **NOT** in this list
- The admin appeals POST route **does not use WorkflowEngine.advance()** — it does raw SQL
- Therefore: ❌ No two-person approval for appeals
- ❌ No gate checks at all (transition validity, lock check, etc.)
- The admin appeals route operates independently of the WorkflowEngine

### 1.9 Deny flow

- Admin clicks "Deny Appeal"
- UI requires `decisionNotes.trim()` to be non-empty (front-end only — **API does not enforce this**)
- Appeal status → `denied`
- `reviewer_notes` set to notes (or null)
- `resolved_at` set
- Transition recorded
- Submitter notified: "Your appeal has been denied"
- Original submission stays in `denied` status (unchanged)

**Gap**: ❌ API allows denial with empty/no notes (notes is optional in DecisionSchema). UI enforces this but API doesn't = inconsistency.

### 1.10 Approved appeal → what happens to original?

- Original submission re-opened: status changed from `denied` → `needs_review`
- `reviewer_notes` set to "Re-opened after successful appeal"
- Transition recorded on original: `denied → needs_review`
- Original goes back into the community queue for re-review
- ✅ This loop is correctly implemented

### 1.11 Can admin request more info?

- ❌ No "Return" / "Request More Info" action in the appeal flow
- The `returned` status exists in the state machine, but the admin appeals route only supports `approved` / `denied`
- No way for admin to ask seeker for clarification/evidence

### 1.12 Required fields and validation summary

| Validation | UI | API | Match? |
|------------|----|----|--------|
| submissionId required | Yes (from URL) | Yes (UUID) | ✅ but no picker |
| reason min 10 chars | Partial (canSubmit guard) | Yes (Zod) | ⚠️ UI only checks length > 0 for canSubmit |
| reason max 2000 chars | Yes (maxLength) | Yes (Zod) | ✅ |
| UUID format | No format validation in UI | Yes (Zod) | ❌ mismatch |
| evidence upload | Not in UI | Accepted in API | ❌ gap |
| Deny requires notes | Yes (disable button) | No (notes optional) | ❌ mismatch |

### 1.13 Missing: Contact validation

- ❌ No name field on appeal form
- ❌ No email field
- ❌ No phone field
- The seeker is identified solely by their auth session (userId)
- Notification goes to their in-app inbox — no email delivery (stubbed)
- No way for admin to contact the seeker outside the platform

---

## 2. Community Report Flow

### 2.1 When does a user file a report?

Any user (authenticated OR anonymous) can report a service listing. Entry via `/report?serviceId=<uuid>`.

**Entry points**:

- Direct URL: `/report?serviceId=<uuid>`
- Expected: service detail page should link here (not verified in this audit)

### 2.2 Complete flow

```
User visits /report?serviceId=<uuid>
  ↓ (ReportPageClient.tsx)
Selects reason (dropdown, 10 options), fills details (5-2000 chars), optional email
  ↓
POST /api/submissions/report
  ↓
  1. Rate limit (report:write:${ip}, max 10)
  2. Auth optional — userId = authCtx.userId OR 'anon_${ip}'
  3. Zod: serviceId (UUID), reason (enum), details (5-2000), contactEmail (email, optional)
  4. Transaction:
     a. Verify service exists → 404
     b. Check for duplicate (same user, same service, not denied/withdrawn/archived, <24h) → 409
     c. INSERT submission (type='community_report', status='submitted')
        - Priority = 2 if suspected_fraud, else 0
     d. INSERT submission_transition (draft → submitted)
  5. Return { reportId, message } 201
  ↓
Report appears in community queue (/community/queue filtered by type='community_report')
  ↓
Community admin claims (POST /api/community/queue) → lock + assign + advance to under_review
  ↓
Community admin reviews details (GET /api/community/queue/[id])
  ↓
Community admin decides (PUT /api/community/queue/[id])
  → Uses WorkflowEngine.advance() with full gate checks
```

### 2.3 Form fields

| Field | Required | Validation | Storage |
|-------|----------|------------|---------|
| serviceId | Yes (from URL) | UUID (Zod) | `service_id` + `target_id` |
| reason | Yes | enum (10 values) | `payload.reason` |
| details | Yes (min 5) | min 5, max 2000 | `notes` + `payload.details` |
| contactEmail | No | email format | `payload.contact_email` |

### 2.4 Notification process

- ❌ **No notification** on report submission — no one is notified when a report is filed
- When a community admin decides (via WorkflowEngine.advance() → fireStatusChangeNotification):
  - Submitter receives in-app notification IF `submitted_by_user_id !== actorUserId`
  - BUT: if the reporter was anonymous (`anon_${ip}`), notification goes to a non-existent user

**Gaps**:

- ❌ No admin notification when report is filed
- ❌ Anonymous reporter can never be notified of outcome
- ❌ contactEmail field is stored but never used for follow-up
- ❌ No SLA applied to reports

### 2.5 Key strengths

- ✅ Anonymous reporting supported
- ✅ Duplicate prevention (24h window)
- ✅ Fraud priority escalation (priority=2)
- ✅ Uses WorkflowEngine for admin review (gate checks, transitions, notifications)
- ✅ Service existence validation

---

## 3. Organization Claim Flow

### 3.1 When does a host submit a claim?

Authenticated host-level users claim an organization via `/claim` (3-step wizard).

### 3.2 Complete flow

```
Host visits /claim
  ↓ (host/claim/page.tsx — 3-step wizard)
  Step 1: Organization name (required), description
  Step 2: Website, email, phone, reviewer notes
  Step 3: Review & submit
  ↓
POST /api/host/claim
  ↓
  1. Rate limit (host:claim:write:${ip})
  2. Auth required
  3. Zod: organizationName (1-500), description (max 5000), url, email, phone (30), claimNotes (2000)
  4. Transaction:
     a. INSERT organization (name, description, url, email)
     b. INSERT placeholder service (inactive)
     c. INSERT submission (type='org_claim', status='submitted')
        - Records phone in payload JSON
  5. Return { orgId, serviceId, message } 201
  ↓
Claim appears in /approvals (ORAN admin only)
  ↓ (GET /api/admin/approvals)
ORAN admin reviews
  ↓
POST /api/admin/approvals (decision: approved/denied)
  → Uses WorkflowEngine.advance() with full gate checks
  → On approve: activates the service (status='active')
```

### 3.3 Form fields

| Field | Required | Validation | Storage |
|-------|----------|------------|---------|
| organizationName | Yes | min 1, max 500 | `organizations.name` + `submissions.title` |
| description | No | max 5000 | `organizations.description` |
| url | No | URL format, max 2000 | `organizations.url` |
| email | No | email format, max 500 | `organizations.email` |
| phone | No | max 30 | `submissions.payload.phone` (NOT in organizations table) |
| claimNotes | No | max 2000 | `submissions.notes` |

### 3.4 Notification process

- ❌ **No notification** when claim is submitted — ORAN admins are not alerted
- On decision: WorkflowEngine.advance() → fireStatusChangeNotification → submitter notified
- ✅ Submitter notification on decision works correctly
- ❌ No SLA applied

### 3.5 Two-person approval

- `org_claim` IS in `TWO_PERSON_REQUIRED_TYPES`
- Admin approvals route uses `WorkflowEngine.advance()` which checks the two-person gate
- ✅ Two-person rule is enforced for org claims (if feature flag enabled)

### 3.6 Key gaps

- ❌ Phone number stored in `payload` JSON but not in `organizations.phone` (if such column existed) — phone is effectively lost after submission
- ❌ No notification to admins on new claim submission
- ❌ Organization is created immediately (before approval) in inactive state — could lead to orphaned orgs if claim is denied
- ❌ No cleanup of org/service on denial
- ❌ `submitted_at` is set manually (NOW()) but the claim API does NOT use WorkflowEngine — transition/gates are skipped for creation
- ❌ No submission_transition recorded on creation (unlike appeal and report which record draft→submitted)

**WAIT** — re-reading the code: the host/claim route does NOT insert a `submission_transition` record. This breaks the audit trail for org claims. Appeal and report both insert `draft → submitted` transitions, but claim does not.

---

## 4. Community Queue (Generic Review) Flow

### 4.1 What it does

The community queue is the universal review interface for ALL submission types. Community admins (and above) use it to claim, review, and decide on any submission.

### 4.2 Complete flow

```
GET /api/community/queue — List all submissions (filterable by type, status)
  ↓
Community admin views queue at /community/queue (page.tsx)
  ↓
POST /api/community/queue — Claim a submission:
  1. acquireLock(submissionId, userId)
  2. advance(submitted → under_review) via WorkflowEngine
  ↓
GET /api/community/queue/[id] — Full detail view + service + org + locations + phones + confidence + transitions
  ↓ Displayed at /community/verify
PUT /api/community/queue/[id] — Submit decision:
  1. Zod: decision (approved/denied/escalated/returned/pending_second_approval), notes (max 5000)
  2. advance() via WorkflowEngine with full gate checks
  3. On approve: bump confidence score
```

### 4.3 Decision options

| Decision | Next Status | Side Effect |
|----------|-------------|-------------|
| approved | approved | Confidence score bumped to 80 |
| denied | denied | None |
| escalated | escalated | For ORAN admin review |
| returned | returned | Back to submitter for revision |
| pending_second_approval | pending_second_approval | Two-person rule (notifies other admins) |

### 4.4 Strengths

- ✅ Full WorkflowEngine integration (gate checks, transitions, locks)
- ✅ Lock/claim mechanism prevents concurrent review
- ✅ All 5 decision options available
- ✅ Transition history visible in detail view
- ✅ Service/org/location/phone/confidence data loaded for context
- ✅ Notifications via WorkflowEngine.fireStatusChangeNotification

### 4.5 Gaps

- ❌ No filter for "assigned to me" — admin must scan full list
- ❌ No SLA badge or deadline indicator in the queue UI
- ❌ No bulk operations exposed in UI (engine supports bulkAdvance)

---

## 5. Admin Approvals (Org Claims) Flow

### 5.1 What it does

Dedicated ORAN-admin-only view for org_claim type submissions. Separate from the generic community queue.

### 5.2 Flow

- GET /api/admin/approvals — Lists `submission_type='org_claim'` with joined org data
- POST /api/admin/approvals — Uses WorkflowEngine.advance() for decision
- On approve: activates the service (`services.status = 'active'`)

### 5.3 Differences from community queue

| Feature | Community Queue | Admin Approvals |
|---------|----------------|-----------------|
| Access level | community_admin+ | oran_admin only |
| Submission types | All | org_claim only |
| Locking | Yes (claim mechanism) | No |
| Decision options | 5 (incl. escalate, return) | 2 (approve/deny) |
| Side effects | Confidence score bump | Activate service |
| WorkflowEngine | Yes | Yes |

### 5.4 Gaps

- ❌ No lock/claim mechanism — concurrent review possible
- ❌ Only approve/deny — no escalate, return, or request-more-info
- ❌ Duplicate pathway: org claims appear in both /admin/approvals AND /community/queue — potential confusion

---

## 6. Legacy Reports API

### 6.1 What it is

`POST /api/reports` — an older endpoint that writes to `audit_log` instead of the submissions table.

### 6.2 Key differences from /api/submissions/report

| Feature | Legacy /api/reports | Universal /api/submissions/report |
|---------|--------------------|---------------------------------|
| Storage | `audit_log` table | `submissions` table |
| Auth | Anonymous only | Anonymous + authenticated |
| Fields | serviceId, issueType, comment | serviceId, reason, details, contactEmail |
| Transitions | None | Yes (draft→submitted) |
| Duplicate check | None | 24h per user per service |
| Priority | None | Fraud = priority 2 |
| Reviewable | ❌ No queue | ✅ Community queue |

### 6.3 Recommendation

⚠️ **DEPRECATE** `/api/reports` and migrate any UI that calls it to use `/api/submissions/report`. The legacy endpoint stores data in `audit_log` which is disconnected from the universal pipeline.

---

## 7. Submission Types Without Dedicated UI

The following submission types are defined in the schema and constants but have **no dedicated seeker-facing form**:

| Submission Type | Has Seeker UI? | Has Admin Review? | Created By |
|----------------|---------------|-------------------|------------|
| `service_verification` | ❌ | ✅ (community queue) | Legacy migration from verification_queue |
| `data_correction` | ❌ | ✅ (community queue) | No creation path exists |
| `new_service` | ❌ | ✅ (community queue) | No creation path exists |
| `removal_request` | ❌ | ✅ (community queue) | No creation path exists |

### 7.1 Impact

- The community queue can list and review these types, but there's no way for users to create them
- `removal_request` requires two-person approval (in TWO_PERSON_REQUIRED_TYPES) but has no intake form
- `data_correction` and `new_service` were likely planned for future phases

---

## 8. Cross-Cutting: Workflow Engine

### 8.1 Which flows use WorkflowEngine?

| Flow | Uses Engine? | Notes |
|------|-------------|-------|
| Appeal submission | ❌ | Raw SQL insert |
| Appeal review | ❌ | Raw SQL update |
| Report submission | ❌ | Raw SQL insert (but does insert transition) |
| Report review | ✅ | Via community queue PUT |
| Org claim submission | ❌ | Raw SQL insert (NO transition recorded) |
| Org claim review | ✅ | Via admin approvals POST |
| Community queue claim | ✅ | Lock + advance |
| Community queue decision | ✅ | Full advance with gates |

### 8.2 Gap Analysis

The WorkflowEngine is the right way to advance submissions, but **only admin-side review routes use it**. All submission-creation routes do raw SQL inserts. This is **acceptable** for creation (draft→submitted is a simple initial transition), but:

- ❌ Org claim doesn't record ANY transition — breaks audit trail
- ❌ Appeal review (admin/appeals POST) does NOT use the engine — bypasses all gates
- ⚠️ Appeal review has no transition validity check, no lock check, no two-person check

### 8.3 Recommendation

Appeal admin review should use `WorkflowEngine.advance()` like the community queue and admin approvals do. This would get gates, locks, notifications, and audit trail for free.

---

## 9. Cross-Cutting: Notification Service

### 9.1 Notification inventory

| Event | Who creates it | Recipient | Channel | Idempotency? |
|-------|---------------|-----------|---------|---------------|
| Appeal filed | submissions/appeal POST | Original reviewer (if assigned) | in_app | ✅ `appeal_filed_${appealId}` |
| Appeal decided | admin/appeals POST | Appeal submitter | in_app | ✅ `appeal_decided_${appealId}_${decision}` |
| Status change (engine) | WorkflowEngine.advance() | Submitter (if actor≠submitter) | in_app | ✅ `status_${submissionId}_${toStatus}_${timestamp}` |
| Two-person needed | WorkflowEngine.advance() | All community_admin/oran_admin except actor | in_app | ✅ `two_person_${submissionId}_${userId}_${timestamp}` |
| Submission assigned | WorkflowEngine.assignSubmission() | Assignee | in_app | ✅ `assign_${submissionId}_${userId}_${timestamp}` |
| SLA breach | WorkflowEngine.checkSlaBreaches() | Assignee or submitter | in_app | ✅ `sla_breach_${submissionId}_${timestamp}` |

### 9.2 Notification gaps

| Missing Notification | Impact |
|---------------------|--------|
| Report submitted → admin pool | Reports sit unnoticed until admin manually checks queue |
| Org claim submitted → admin pool | Claims sit unnoticed |
| Appeal submitted → admin pool (when no reviewer assigned) | Appeal is invisible |
| Anonymous report outcome | Anonymous reporters never learn what happened |
| Email delivery | All notifications are in-app only; email is stubbed |
| SLA warning (pre-breach) | Only breaches are notified, not approaching deadlines |

---

## 10. Cross-Cutting: Database Schema

### 10.1 Submissions table audit

The `submissions` table (migration 0022) is well-designed:

- ✅ UUID primary keys
- ✅ Polymorphic `submission_type` + `target_type` with CHECK constraints
- ✅ 13-state status machine with CHECK constraint
- ✅ JSONB `payload` for type-specific data (validated at app layer by Zod)
- ✅ JSONB `evidence` for attachments
- ✅ Locking fields (`is_locked`, `locked_at`, `locked_by_user_id`)
- ✅ SLA tracking (`sla_deadline`, `sla_breached`)
- ✅ Full timestamp tracking (submitted_at, reviewed_at, resolved_at, created_at, updated_at)
- ✅ Jurisdiction routing fields (state, county)

### 10.2 Schema gaps

| Issue | Description |
|-------|-------------|
| No FK on submitted_by_user_id | TEXT type, not UUID, no FK to user_profiles |
| No FK on assigned_to_user_id | Same — TEXT type, no FK |
| No FK on locked_by_user_id | Same |
| No FK on target_id | UUID but no FK (by design — polymorphic reference) |
| payload not indexed | No GIN index on payload JSONB for JSON path queries |
| Reason duplication | Appeal stores reason in BOTH `notes` AND `payload.appeal_reason` |

### 10.3 Transition table

- ✅ Full audit trail with actor, role, reason, gates_checked, gates_passed, metadata
- ✅ Captures both successful and failed transitions
- ❌ Org claim POST doesn't insert a transition (gap)

---

## 11. Unified Gap List

### Critical (C) — Must fix

| ID | Flow | Gap | Impact |
|----|------|-----|--------|
| C1 | Appeal admin | Does NOT use WorkflowEngine — bypasses gates, locks, transition validation | An appeal could be decided from an invalid status; no gate protection |
| C2 | Appeal admin | API allows deny with no notes (schema: notes optional) but UI requires it | Programmatic callers can deny without justification |
| C3 | Org claim | No submission_transition recorded on creation | Breaks audit trail — no draft→submitted entry |
| C4 | Appeal notify | If original had no assigned reviewer, no one is notified of new appeal | Appeals can sit indefinitely unseen |

### High (H) — Should fix soon

| ID | Flow | Gap | Impact |
|----|------|-----|--------|
| H1 | All submissions | No admin notification on new submission creation | Admins must poll the queue manually |
| H2 | Appeal UI | No evidence upload UI (API supports it) | Seekers can't attach supporting docs |
| H3 | Appeal UI | No browse-denied-submissions picker | Seekers must know UUID to appeal |
| H4 | Report | Anonymous reporters can't be notified of outcome | No accountability loop |
| H5 | All | No SLA applied on submission creation | No deadline pressure for review |
| H6 | Appeal admin | No "return" / "request more info" action | Admin can only approve or deny — no middle ground |
| H7 | Legacy reports | /api/reports still exists, writes to audit_log not submissions | Dual pathway creates data fragmentation |

### Medium (M) — Improve when possible

| ID | Flow | Gap | Impact |
|----|------|-----|--------|
| M1 | Appeal admin | No claim/lock mechanism for appeals | Two admins could try to decide simultaneously |
| M2 | Admin approvals | No claim/lock mechanism | Same concurrent review risk |
| M3 | Admin approvals | Org claims appear in both /admin/approvals AND /community/queue | Confusion about which queue to use |
| M4 | Appeal UI | submissionId format not validated client-side | User could type garbage before API rejects it |
| M5 | Org claim | Orphaned org/service on denial — no cleanup | DB accumulates inactive entities |
| M6 | Community queue | No "assigned to me" filter | Admins waste time scanning |
| M7 | All | Email notifications stubbed, not implemented | Users must check in-app inbox |
| M8 | 4 sub types | No seeker UI for data_correction, new_service, removal_request, service_verification | Types exist but can't be created |
| M9 | Appeal | Dual storage of reason (notes + payload.appeal_reason) | Possible drift if one is updated |
| M10 | Schema | submitted_by_user_id is TEXT not UUID, no FK | No referential integrity |

### Low (L) — Nice to have

| ID | Flow | Gap | Impact |
|----|------|-----|--------|
| L1 | Appeal UI | Only 4 status styles (submitted, under_review, approved, denied) | Other statuses show as "Unknown" |
| L2 | Report UI | No "my reports" list on the page (API GET exists) | Users can't see their report history |
| L3 | Org claim | Phone in payload JSON, not indexed | Can't search or report by phone |
| L4 | SLA | checkSlaBreaches() exists but no scheduler calls it | SLA breach detection is dead code |
| L5 | Workflow | bulkAdvance() exists but no UI exposes it | Batch operations unavailable |

---

## 12. Priority Matrix

### Wave 3 Recommended (Critical + High)

1. **C1**: Refactor `POST /api/admin/appeals` to use `WorkflowEngine.advance()`
2. **C2**: Make `notes` required for denial in DecisionSchema (add `.min(1)` when decision is `denied`)
3. **C3**: Add `submission_transition` insert to `POST /api/host/claim`
4. **C4 + H1**: Add admin-pool notification on ALL new submission creation (appeal, report, claim)
5. **H2**: Add evidence upload UI to appeal form
6. **H3**: Build "My Denied Submissions" picker component for appeal page
7. **H5**: Call `applySla()` after every submission creation
8. **H6**: Add `returned` as valid decision in admin appeals DecisionSchema
9. **H7**: Deprecate `/api/reports`, ensure all UIs use `/api/submissions/report`

### Wave 4 Recommended (Medium)

1. **M1 + M2**: Add lock/claim mechanism to admin appeals and admin approvals
2. **M3**: Decide single canonical review path for org claims
3. **M4**: Add UUID format validation on client for submissionId
4. **M5**: Add cleanup logic when org claim is denied
5. **M6**: Add "assigned to me" filter to community queue
6. **M8**: Build remaining seeker forms (data_correction, new_service, removal_request)

---

*End of audit. All findings are derived from source code as of the current commit.*
