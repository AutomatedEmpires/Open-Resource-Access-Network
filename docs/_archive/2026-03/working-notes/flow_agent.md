# FLOW AGENT — Every Form & Submission, End-to-End

> **Updated**: 2026-03 · **Scope**: Every interactive form in the app, traced from the user's perspective
> **Methodology**: "I am the user" — how do I find this form, what do I fill in, what happens next, who reviews it, and how do I hear back?
> **Previous version**: `docs/_archive/2026-03/flow-audit/flow_agent_v1.md`

---

## Table of Contents

### Seeker Flows

1. [Chat Search](#1-chat-search)
2. [Directory Browse](#2-directory-browse)
3. [Map View](#3-map-view)
4. [Service Detail — Save/Unsave](#4-service-detail--saveunsave)
5. [Service Detail — Report Problem Dialog](#5-service-detail--report-problem-dialog)
6. [Service Detail — Feedback Form](#6-service-detail--feedback-form)
7. [Report a Listing (Universal Pipeline)](#7-report-a-listing-universal-pipeline)
8. [Appeal a Denied Submission](#8-appeal-a-denied-submission)
9. [Saved Services](#9-saved-services)
10. [Profile & Preferences](#10-profile--preferences)
11. [Notification Preferences](#11-notification-preferences)

### Host Flows

1. [Organization Claim (3-Step Wizard)](#12-organization-claim-3-step-wizard)
2. [Organization Edit/Delete](#13-organization-editdelete)
3. [Service Create/Edit/Delete](#14-service-createeditdelete)
4. [Location Create/Edit/Delete](#15-location-createeditdelete)
5. [Team Management (Admins)](#16-team-management-admins)

### Community Admin Flows

1. [Verification Queue — Claim](#17-verification-queue--claim)
2. [Verification — Review & Decide](#18-verification--review--decide)
3. [Coverage Dashboard](#19-coverage-dashboard)

### ORAN Admin Flows

1. [Org Claim Approvals](#20-org-claim-approvals)
2. [Appeal Decisions](#21-appeal-decisions)
3. [Scope Management](#22-scope-management)
4. [Scope Grant — Two-Person Approval](#23-scope-grant--two-person-approval)
5. [Zone Management](#24-zone-management)
6. [Feature Flags / Rules](#25-feature-flags--rules)
7. [Audit Trail](#26-audit-trail)
8. [Ingestion Pipeline](#27-ingestion-pipeline)

### Cross-Cutting Systems

1. [Workflow Engine](#28-workflow-engine)
2. [Notification Service](#29-notification-service)
3. [SLA Enforcement](#30-sla-enforcement)
4. [Crisis Detection](#31-crisis-detection)

### Gap Analysis

1. [Unified Gap List](#32-unified-gap-list)

---

## 1. Chat Search

### How do I find it?

- Top nav → **Chat** (`/chat`)
- Landing page CTA → "Chat with ORAN"
- Always visible in `AppNav` for all users (no auth required)

### What do I see?

- `ChatPageClient.tsx` → `ChatWindow.tsx`
- Message input at bottom, conversation history above
- Suggestion chips for first-time users (pre-fill prompts)
- Quota indicator showing remaining messages
- Crisis banner shown immediately if crisis keywords detected

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| message | text input | Yes | min 1 char | — |

### What happens when I submit?

```
User types message → Enter / click Send
  ↓
POST /api/chat
  Body: { message, sessionId, locale }
  ↓
1. Rate limit check (chat:user:{userId} or chat:ip:{ip})
2. Crisis detection (CRISIS_KEYWORDS constant)
   → If crisis: STOP. Return 911 / 988 / 211 immediately
3. Load user profile (locale, approximate city)
4. orchestrateChat() — pure SQL retrieval, NO LLM in retrieval
5. Score & rank services
6. If llm_summarize flag ON: LLM summarizes ALREADY-RETRIEVED records only
  ↓
Response: { services[], isCrisis?, crisisResources?, quotaRemaining, disclaimer }
  ↓
UI renders ServiceCards with Save + Feedback buttons
```

### Where does data go?

- Messages are NOT persisted to the database
- `sessionId` stored in `sessionStorage` key `oran_chat_session_id`
- Feedback on results goes to `seeker_feedback` table (see [§6](#6-service-detail--feedback-form))

### Who gets notified?

- Nobody — this is a read-only search operation

### Return communication

- Inline results in the chat window
- Crisis banner if triggered (non-dismissible)

### Gaps

- ❌ No message history persistence (by design for privacy)
- ❌ No per-message feedback — feedback is per-service-card only

---

## 2. Directory Browse

### How do I find it?

- Top nav → **Directory** (`/directory`)
- Landing page CTA
- No auth required

### What do I see?

- Search input + category filters + pagination
- Grid of `ServiceCard` components
- Each card has: name, org, description, status, "Save" button, "Feedback" toggle, "Report" button

### What do I fill in?

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| search query | text input | No | max 500 chars |
| category filter | dropdown/chips | No | from taxonomy |

### What happens when I submit?

```
User types search / selects filter → auto-fetch
  ↓
GET /api/search?q=...&status=active&page=1&limit=20
  ↓
1. Rate limit check (search:ip:{ip})
2. Text search (tsvector) + optional geo (PostGIS)
3. Pagination (page/limit)
  ↓
Response: { results[], total, page, hasMore }
  ↓
UI renders paginated ServiceCard grid
```

### Where does data go?

- Read-only — no writes

### Gaps

- None — clean discovery interface

---

## 3. Map View

### How do I find it?

- Top nav → **Map** (`/map`)
- Gated by `map_enabled` feature flag

### What do I see?

- `MapContainer` component with interactive map
- Service pins based on location data
- Click pin → service detail popup

### What do I fill in?

- Pan/zoom/click — no form fields
- Optional: location filter (bbox sent as query params)

### What happens?

```
Map loads → GET /api/search?minLat=...&maxLat=...&minLng=...&maxLng=...&status=active
Map token → GET /api/maps/token (if external map provider)
```

### Gaps

- ❌ Feature-flagged — may not be visible to all users

---

## 4. Service Detail — Save/Unsave

### How do I find it?

- Click any service card (directory, chat, map) → `/service/[id]`
- Direct URL with service UUID

### What do I see?

- `ServiceDetailClient.tsx`
- Full service info: name, org, description, phones, hours, locations, eligibility, accessibility, languages
- **Save/Unsave** heart/bookmark button
- **Report problem** button (opens dialog)
- **Feedback** toggle (opens inline form)

### Save flow

```
User clicks Save button
  ↓
1. Update localStorage: oran:saved-service-ids (always)
2. If authenticated: POST /api/saved { serviceId }
   → Inserts into saved_services; ON CONFLICT DO NOTHING
  ↓
Button toggles to "Saved" state
```

### Unsave flow

```
User clicks Unsave button
  ↓
1. Remove from localStorage
2. If authenticated: DELETE /api/saved { serviceId }
  ↓
Button toggles back to "Save" state
```

### Where does data go?

- `localStorage` key `oran:saved-service-ids` (always)
- `saved_services` table (authenticated users only)

### Gaps

- ⚠️ Dual storage (localStorage + DB) means sync can drift if user clears browser data

---

## 5. Service Detail — Report Problem Dialog

### How do I find it?

- Service detail page → **"Report a problem"** button
- Service card in directory → inline **"Report"** button
- No auth required

### What do I see?

- `ReportProblemDialog.tsx` — modal dialog
- Grid of 9 radio-button reason types
- Required details textarea (min 5 chars)

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| reason | radio (9 options) | Yes | must select one | — |
| details | textarea | Yes | min 5 chars | 2000 |

**Reason types**: `incorrect_info`, `permanently_closed`, `wrong_hours`, `wrong_address`, `wrong_phone`, `wrong_eligibility`, `suspected_fraud`, `duplicate_listing`, `other`

### What happens when I submit?

```
User selects reason → enters details → Submit
  ↓
POST /api/submissions/report   ← MODERN ENDPOINT (migrated 2026-03-05)
  Body: { serviceId, reason, details }
  ↓
1. Rate limit check
2. Zod validation
3. Transaction:
   a. INSERT INTO submissions (type='community_report', status='submitted')
   b. INSERT INTO submission_transitions (draft → submitted)
   c. Broadcast notification_events to all community_admin + oran_admin
   d. Apply SLA deadline
  ↓
Response: 201 { message, submissionId }
  ↓
UI: Green celebration box "Thank you for your report!"
```

### Where does data go?

- ✅ `submissions` table (type='community_report') — universal pipeline
- ✅ `submission_transitions` (draft → submitted)
- ✅ `notification_events` — all admins notified
- ✅ `submission_slas` — deadline applied

### Who gets notified?

- ✅ All community_admin and oran_admin users via `notification_events`
- ✅ Email dispatch via Azure Communication Services (when configured + user preference enabled)

### Review path

- Submission appears in `/community/queue` AND admins are notified immediately

### Return communication

- ❌ No notification to reporter on outcome (same issue as anonymous reports — M2)

### Legacy endpoint

- The old `/api/reports` endpoint is **deprecated** (marked 2026-03-05) and archived at `docs/_archive/2026-03/legacy-api/reports_route.ts`
- It is no longer called by any UI component
- ✅ **GAP C1: RESOLVED** — ReportProblemDialog migrated to modern endpoint with full notification pipeline

---

## 6. Service Detail — Feedback Form

### How do I find it?

- Service detail page → **"Give feedback"** toggle
- Chat service card → **"Feedback"** link
- Directory card → **"Give feedback"** button
- No auth required

### What do I see?

- `FeedbackForm.tsx` — inline expandable panel (not a modal)
- Star rating, contact success toggle, optional comment

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| rating | 1–5 stars | Yes | must select | — |
| contactSuccess | Yes/No pills | No | boolean or null | — |
| comment | textarea | No | — | 500 |

**Rating labels**: 1=Not helpful, 2=Slightly helpful, 3=Helpful, 4=Very helpful, 5=Extremely helpful

### What happens when I submit?

```
User rates + optional comment → Submit
  ↓
POST /api/feedback
  Body: { serviceId, sessionId, rating, comment?, contactSuccess? }
  ↓
1. Rate limit check (10 per 5 min per IP)
2. Zod validation
3. INSERT INTO seeker_feedback (service_id, session_id, rating, comment, contact_success)
  ↓
Response: 201
  ↓
UI: Green box "Thank you for your feedback!" → auto-close 2 seconds
```

### Where does data go?

- `seeker_feedback` table
- `contact_success` field feeds into confidence scoring

### Who gets notified?

- Nobody directly — feedback aggregates influence confidence scores

### Return communication

- Inline success message, auto-dismisses after 2 seconds

### Gaps

- None — clean standalone flow

---

## 7. Report a Listing (Universal Pipeline)

### How do I find it?

- Direct URL: `/report?serviceId=<uuid>`
- **Not linked** in top nav (no AppNav item)
- Intended entry: service detail page report flow (currently the dialog calls `/api/reports` — see [§5](#5-service-detail--report-problem-dialog))

### What do I see?

- `ReportPageClient.tsx` in `(seeker)/report/`
- Reason dropdown (10 options), details textarea, optional email
- "My Reports" section below the form (authenticated users only)

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| serviceId | text (from URL or manual) | Yes | UUID format | — |
| reason | dropdown (10 options) | Yes | enum validated | — |
| details | textarea | Yes | min 5 chars | 2000 |
| contactEmail | email input | No | email format | — |

**Reason options**: `incorrect_info`, `permanently_closed`, `temporarily_closed`, `wrong_location`, `wrong_phone`, `wrong_hours`, `wrong_eligibility`, `suspected_fraud`, `duplicate_listing`, `other`

### What happens when I submit?

```
User fills form → Submit
  ↓
POST /api/submissions/report
  Body: { serviceId, reason, details, contactEmail? }
  ↓
1. Rate limit (report:write:{ip}, max 10/min)
2. Auth check (optional — anonymous allowed, attributed as anon_{ip})
3. Zod validation
4. Transaction:
   a. Verify service exists
   b. Check duplicate (24h window, same user + service)
   c. INSERT INTO submissions (type='community_report', status='submitted')
      → priority = 2 if suspected_fraud, else 0
   d. INSERT INTO submission_transitions (draft → submitted)
   e. INSERT INTO notification_events for all community_admin + oran_admin
5. applySla(reportId, 'community_report') — best-effort
  ↓
Response: 201 { reportId, message }
  ↓
Report enters community admin queue at /community/queue
```

### Where does data go?

| Data | Table | Column |
|------|-------|--------|
| Report record | `submissions` | type='community_report' |
| Reason | `submissions` | `payload->>'reason'` |
| Details | `submissions` | `notes` + `payload->>'details'` |
| Contact email | `submissions` | `payload->>'contact_email'` |
| Service ref | `submissions` | `service_id`, `target_id` |
| Reporter | `submissions` | `submitted_by_user_id` (userId or anon_{ip}) |
| Transition | `submission_transitions` | draft → submitted |
| SLA deadline | `submissions` | `sla_deadline` |

### Who gets notified?

- ✅ All `community_admin` + `oran_admin` via `notification_events` broadcast
- Idempotency key: `new_report_{reportId}_{userId}`

### Review path

1. Community admin sees report in `/community/queue`
2. Claims it → POST `/api/community/queue` (lock + advance to `under_review`)
3. Reviews at `/verify?id={submissionId}`
4. Decides → PUT `/api/community/queue/{id}` via `WorkflowEngine.advance()`
5. Options: approve / deny / escalate / return / pending_second_approval

### Return communication

- ✅ If authenticated: in-app notification on status change (via `fireStatusChangeNotification()`)
- ❌ If anonymous: no way to notify (anon_{ip} is not a real user)
- ❌ `contactEmail` stored but never used for email follow-up

### Gaps

- ❌ No direct nav link to `/report` in AppNav
- ❌ Anonymous reporters cannot be notified of outcome
- ❌ `contactEmail` is captured but unused

---

## 8. Appeal a Denied Submission

### How do I find it?

- Direct URL: `/appeal?submissionId=<uuid>`
- **Denied submissions picker** on the appeal page (dropdown populated from API)
- Auth required

### What do I see?

- `AppealPageClient.tsx`
- Denied submissions dropdown (fetched from `/api/submissions/denied`)
- Manual submissionId input (disabled if prefilled from URL)
- Reason textarea (min 10, max 2000)
- Evidence upload section (add up to 10 items with description + URL)
- "My Appeals" list below the form

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| submissionId | dropdown or text | Yes | UUID format | — |
| reason | textarea | Yes | min 10 chars | 2000 |
| evidence[].description | text | No | — | — |
| evidence[].fileUrl | url | No | valid URL | — |

### What happens when I submit?

```
User selects denied submission + writes reason → Submit Appeal
  ↓
POST /api/submissions/appeal
  Body: { submissionId, reason, evidence? }
  ↓
1. Rate limit (user:appeal:write:{ip})
2. Auth check (required)
3. Zod validation
4. Transaction:
   a. Verify original exists, is 'denied', and belongs to this user (FOR SHARE)
   b. Check no pending appeal already exists
   c. INSERT INTO submissions (type='appeal', status='submitted', priority=1)
   d. INSERT INTO submission_transitions (draft → submitted)
   e. Notify original reviewer (if assigned_to_user_id exists)
   f. Notify admin pool (all community_admin + oran_admin)
5. applySla(appealId, 'appeal') — best-effort
  ↓
Response: 201 { appealId, message }
  ↓
UI: Green celebration "Appeal submitted. You will be notified when it is reviewed."
My Appeals list refreshes
```

### Where does data go?

| Data | Table | Column |
|------|-------|--------|
| Appeal record | `submissions` | type='appeal', priority=1 |
| Original ref | `submissions` | `payload->>'original_submission_id'` |
| Reason (full) | `submissions` | `notes` + `payload->>'appeal_reason'` |
| Evidence | `submissions` | `evidence` JSONB array |
| Transition | `submission_transitions` | draft → submitted |

### Who gets notified?

- ✅ Original reviewer (if the denied submission had `assigned_to_user_id`)
- ✅ Admin pool broadcast (all community_admin + oran_admin)
- Idempotency: `appeal_filed_{appealId}` + `new_appeal_{appealId}_{userId}`

### Review path

1. Admin sees appeal in `/appeals` queue
2. GET /api/admin/appeals lists appeals with status filter
3. Admin clicks Review
4. POST /api/admin/appeals with decision:
   - `acquireLock()` prevents concurrent review
   - `advance()` via WorkflowEngine (full gate checks)
   - Options: **approved**, **denied**, **returned**
5. On approve: original submission reopened (denied → needs_review)
6. On deny: appeal stays denied, original unchanged
7. Lock released on failure/completion

### Return communication

- ✅ In-app notification to appeal submitter on any decision
- ✅ Reviewer notes visible in "My Appeals" list

### Gaps

- ❌ No nav link to `/appeal` in AppNav (user must know about it or go via profile)
- ⚠️ Reason duplication: stored in both `notes` and `payload.appeal_reason`

---

## 9. Saved Services

### How do I find it?

- Top nav → **Saved** (`/saved`)
- Always visible in AppNav

### What do I see?

- `SavedPageClient.tsx`
- Grid of saved service cards
- Unsave button per card
- Empty state with CTAs to Chat / Directory / Map

### How it works

```
Page loads
  ↓
1. Read localStorage: oran:saved-service-ids
2. If authenticated: GET /api/saved → { savedIds[] }
3. Merge & deduplicate
4. Fetch details: GET /api/services?ids=id1,id2,id3
5. Clean up any notFound IDs from localStorage
  ↓
Display grid of ServiceCards (with unsave button)
```

### Remove flow

```
User clicks Unsave
  ↓
1. Remove from localStorage array
2. If authenticated: DELETE /api/saved { serviceId }
  ↓
Card removed from grid
```

### Gaps

- ⚠️ localStorage / server sync can drift on browser data clear

---

## 10. Profile & Preferences

### How do I find it?

- Top nav → **Profile** (`/profile`)
- Always visible in AppNav

### What do I see?

- `ProfilePageClient.tsx`
- Approximate city input
- Language preference dropdown (10 languages)
- Saved services count
- Notification preferences (if authenticated)
- Sign-in link (if not authenticated)
- Delete all data button

### What do I fill in?

| Field | Type | Required | Validation | Storage |
|-------|------|----------|------------|---------|
| approximateCity | text input | No | — | `user_profiles.approximate_city` + localStorage |
| preferredLocale | dropdown | No | 10 options | `user_profiles.preferred_locale` + localStorage |

**Languages**: en, es, zh, vi, ko, ar, fr, ht, pt, ru

### What happens when I save?

```
User changes city or language → auto-save or Save button
  ↓
1. Update localStorage: oran:preferences
2. If authenticated: PUT /api/profile { approximateCity, preferredLocale }
   → UPSERT to user_profiles (ON CONFLICT user_id)
  ↓
Toast: "Preferences saved"
```

### Delete All Data flow

```
User clicks "Delete all data"
  ↓
1. Clear localStorage keys: oran:preferences, oran:saved-service-ids
2. Reset in-memory state
  ↓
UI: Confirmation message
```

### Gaps

- ❌ "Delete all data" only clears localStorage — does NOT delete server-side `user_profiles` or `saved_services` records
- ❌ No GDPR-style data export

---

## 11. Notification Preferences

### How do I find it?

- Profile page → **Notification Preferences** section (auth required)
- No standalone page

### What do I see?

- Grid of event types × channels (in_app, email)
- Toggle switches per cell

### Event types

| Event Type | Description |
|------------|-------------|
| submission_assigned | Submission assigned to you |
| submission_status_changed | Status changed on your submission |
| submission_sla_warning | SLA nearing deadline |
| submission_sla_breach | SLA deadline exceeded |
| scope_grant_requested | Scope grant pending your decision |
| scope_grant_decided | Your scope request decided |
| scope_grant_revoked | Scope grant revoked |
| two_person_approval_needed | Two-person approval pending |
| system_alert | System-wide alert |

### What happens when I toggle?

```
User toggles a switch
  ↓
PUT /api/user/notifications/preferences
  Body: { preferences: [{ eventType, channel, enabled }] }
  ↓
1. Auth check (required)
2. Zod validation against NOTIFICATION_EVENT_TYPES
3. setPreferences(userId, prefs) → UPSERT notification_preferences
  ↓
Optimistic UI update (toggle moves immediately)
```

### Gaps

- ❌ Email channel is stubbed — toggles are shown but email delivery does not exist
- ❌ No notification bell/inbox in AppNav — user must go to profile to see preferences

---

## 12. Organization Claim (3-Step Wizard)

### How do I find it?

- Host nav → **Claim** (`/claim`)
- Empty state on `/org` dashboard links to `/claim`
- Auth required (host_member or above)

### What do I see?

- 3-step `FormStepper` wizard inside `page.tsx`
- Unsaved changes guard active

### Step 0 — Identity

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| orgName | text (autofocus) | Yes | min 1 char | 500 |
| description | textarea w/ charCount | No | — | 5000 |
| url | url input | No | valid URL | 2000 |

### Step 1 — Contact & Details

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| email | email input | No | valid email | 500 |
| phone | tel input | No | — | 30 |
| claimNotes | textarea w/ charCount | No | — | 2000 |

### Step 2 — Review & Submit

- Review card showing all entered values
- "What happens next?" info box (3-bullet SLA explanation)
- Submit button

### What happens when I submit?

```
User reviews → Submit
  ↓
POST /api/host/claim
  Body: { organizationName, description?, url?, email?, phone?, claimNotes? }
  ↓
1. Rate limit (host:claim:write:{ip})
2. Auth check (required — no bypass)
3. Zod validation
4. Transaction:
   a. INSERT INTO organizations (name, description, url, email)
   b. INSERT INTO services (org_id, name, status='inactive') — placeholder
   c. INSERT INTO submissions (type='org_claim', status='submitted', target_type='organization')
   d. INSERT INTO submission_transitions (draft → submitted)
   e. INSERT INTO notification_events for community_admin + oran_admin
5. applySla(submissionId, 'org_claim') — best-effort
  ↓
Response: 201 { success, organizationId, serviceId, message }
  ↓
UI: SuccessCelebration → Link to /org dashboard
```

### Where does data go?

| Data | Table | Column |
|------|-------|--------|
| Organization | `organizations` | name, description, url, email |
| Placeholder service | `services` | status='inactive', org_id=orgId |
| Claim submission | `submissions` | type='org_claim', target_type='organization' |
| Phone | `submissions` | `payload->>'phone'` (NOT in organizations table) |
| Transition | `submission_transitions` | draft → submitted |
| SLA | `submissions` | `sla_deadline` |

### Who gets notified?

- ✅ All community_admin + oran_admin via notification_events

### Review path

1. ORAN admin sees claim in `/approvals` queue
2. Also appears in `/community/queue` (community admins)
3. Decision via POST /api/admin/approvals using WorkflowEngine.advance()
4. Two-person approval enforced (org_claim in TWO_PERSON_REQUIRED_TYPES)
5. On approve: service activated (status = 'active')
6. On deny: submission denied, org/service remain (inactive/orphaned)

### Return communication

- ✅ Submitter notified via fireStatusChangeNotification() on decision

### Gaps

- ❌ Phone stored in `payload` JSON — not in `organizations` table. Lost after submission
- ❌ On denial, org and placeholder service are not cleaned up (orphaned records)
- ❌ Duplicate pathway: org claims appear in BOTH `/admin/approvals` AND `/community/queue`

---

## 13. Organization Edit/Delete

### How do I find it?

- Host nav → **Organization** (`/org`)
- Card grid with search + pagination
- Click **Edit** on any org card → modal

### What do I fill in? (Edit modal)

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| name | text w/ charCount | Yes | min 1 char | 500 |
| description | textarea w/ charCount | No | — | 5000 |
| url | url input | No | valid URL | 2000 |
| email | email input | No | valid email | 500 |
| taxStatus | text | No | — | 200 |
| taxId | text | No | — | 20 |
| yearIncorporated | number | No | 1800–present | — |
| legalStatus | dropdown | No | 7 options | — |

**Legal status options**: Nonprofit, Government, For-profit, LLC, Partnership, Sole Proprietorship, Other

### What happens on save?

```
User edits fields → Save
  ↓
PUT /api/host/organizations/{id}
  Body: { name, description, url, email, ... }
  ↓
1. Auth check + org access verification
2. Zod validation
3. UPDATE organizations SET ... WHERE id = $1
  ↓
Response: 200 { updated organization }
  ↓
UI: Success toast, modal closes, list refreshes
```

### Delete flow

```
User clicks Delete → Confirmation dialog → Confirm
  ↓
DELETE /api/host/organizations/{id}
  ↓
Archives the org (does not hard-delete)
  ↓
UI: Card removed from list
```

### Who gets notified?

- Nobody — this is direct CRUD

### Gaps

- ⚠️ HSDS fields (taxStatus, taxId, yearIncorporated, legalStatus) appear in edit modal UI but may not be persisted by PUT endpoint (need to verify DB columns exist)

---

## 14. Service Create/Edit/Delete

### How do I find it?

- Host nav → **Services** (`/services`)
- Card grid with search + org filter + pagination
- Click **Edit** → modal; or **+ Create** button → modal

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| organizationId | dropdown [create only] | Yes | valid UUID, user has access | — |
| name | text w/ charCount | Yes | min 1 char | 500 |
| description | textarea w/ charCount | No | — | 5000 |
| categories | CategoryPicker | No | max 5 | — |
| url | url input | No | valid URL | — |
| email | email input | No | valid email | — |
| phones | PhoneEditor | No | array of {number, type} | — |
| status | dropdown | No | active/inactive/defunct | — |
| fees | text | No | — | 1000 |
| applicationProcess | textarea | No | — | 2000 |
| waitTime | text | No | — | 500 |
| schedule | ScheduleEditor | No | weekly hour slots | — |
| interpretationServices | textarea | No | — | 1000 |
| accreditations | text | No | — | 1000 |
| licenses | text | No | — | 1000 |

### What happens on create?

```
Host fills service details → Submit
  ↓
POST /api/host/services
  Body: { organizationId, name, description, ... }
  ↓
1. Auth check + org access
2. Zod validation
3. Org exists and not defunct
4. Transaction:
   a. INSERT INTO services
   b. Auto-enqueue: INSERT INTO submissions (type='service_verification', status='submitted')
      → Service enters community queue for verification
  ↓
Response: 201 { service }
  ↓
UI: Modal closes, list refreshes with new service
```

### Who gets notified?

- ⚠️ No explicit admin notification on service creation — it just appears in queue on next refresh

### Gaps

- ⚠️ No explicit admin notification on service creation — it just appears in queue on next refresh

---

## 15. Location Create/Edit/Delete

### How do I find it?

- Host nav → **Locations** (`/locations`)
- Card grid with org filter + pagination
- Click **Edit** → modal; or **+ Create** → modal

### What do I fill in?

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| organizationId | dropdown [create only] | Yes | valid UUID, user has access | — |
| name | text w/ charCount | Yes | min 1 char | 500 |
| alternateName | text | No | — | 500 |
| description | textarea w/ charCount | No | — | 5000 |
| phones | PhoneEditor | No | array | — |
| address1 | text | No | — | 500 |
| address2 | text | No | — | 500 |
| city | text | No | — | 200 |
| stateProvince | text | No | — | 200 |
| postalCode | text | No | — | 20 |
| latitude | number | No | -90 to 90 | — |
| longitude | number | No | -180 to 180 | — |
| schedule | ScheduleEditor | No | weekly hours | — |
| transportation | text | No | — | 1000 |

### What happens on create?

```
Host fills location details → Submit
  ↓
POST /api/host/locations
  Body: { organizationId, name, ..., latitude?, longitude?, address1?, city?, ... }
  ↓
1. Auth check + org access
2. Zod validation (coords range-checked)
3. Org exists, not defunct
4. Transaction:
   a. INSERT INTO locations
   b. If address fields provided: INSERT INTO addresses
  ↓
Response: 201 { location }
```

### Gaps

- ⚠️ Coordinates labeled "Approximate, rounded for privacy" but rounding not enforced server-side

---

## 16. Team Management (Admins)

### How do I find it?

- Host nav → **Team** (`/admins`)
- Requires host_admin role for the org

### What do I see?

- Org selector (if user has multiple orgs)
- "Add team member" form
- Member list with role badges + remove button

### Add Member form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| inviteUserId | text | Yes | valid UUID (validated on keystroke) |
| inviteRole | dropdown | No | host_member / host_admin |

### What happens when I invite?

```
Admin enters UUID + role → Submit
  ↓
POST /api/host/admins
  Body: { organizationId, userId, role }
  ↓
1. Auth check (host_admin of org, or oran_admin)
2. Zod validation (UUID)
3. Check org exists
4. Check user not already active member (reactivate if deactivated)
5. INSERT INTO organization_members
  ↓
Response: 201 { member }
  ↓
UI: Member appears in list with role badge
```

### Change Role

```
Admin clicks role dropdown → selects new role → Confirmation dialog → Confirm
  ↓
PUT /api/host/admins/{memberId} { role }
```

### Remove Member

```
Admin clicks Remove → Confirmation dialog → Confirm
  ↓
DELETE /api/host/admins/{memberId}
```

### Gaps

- ❌ Invite by UUID is user-hostile — admins must somehow know the target user's UUID
- ❌ No email invite flow or username lookup

---

## 17. Verification Queue — Claim

### How do I find it?

- Community admin nav → **Queue** (`/queue`)
- Requires community_admin role

### What do I see?

- `QueuePageClient.tsx`
- Status tabs: All / Submitted / Under Review / Approved / Denied / Escalated
- Table: service name, organization, status badge, submitted date (amber warning if >14 days), assigned reviewer
- **Claim** button on `submitted` status rows
- **Review** button → navigates to `/verify?id={submissionId}`

### Claim flow

```
Admin clicks Claim on a submission
  ↓
POST /api/community/queue
  Body: { submissionId }
  ↓
1. Auth check (community_admin+)
2. acquireLock(submissionId, userId)
3. advance() → submitted → under_review
   ↓ If lock fails:
   Release lock, return 409
  ↓
Response: 200 { success }
  ↓
UI: Status changes to "Under Review", shows reviewer name
```

### Who gets notified?

- ✅ Submitter notified of status change (via fireStatusChangeNotification)

---

## 18. Verification — Review & Decide

### How do I find it?

- `/verify?id={submissionId}` — linked from queue table
- Requires community_admin role

### What do I see?

- `VerifyPageClient.tsx`
- **Left column**: Full read-only service detail (org, locations, phones, eligibility, documents, languages, accessibility)
- **Right column**: Confidence score + decision form

### Confidence display

- Overall score (0–100) with color indicator
- Sub-scores: Verification %, Eligibility Match %, Constraint Fit %
- Last computed timestamp

### Decision form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| decision | radio cards | Yes | approved / denied / escalated |
| notes | textarea w/ charCount | Depends | Required for deny/escalate; optional for approve |

Max notes: 5000 chars

### What happens when I decide?

```
Admin selects decision + notes → Submit
  ↓
PUT /api/community/queue/{id}
  Body: { decision, notes, reviewerUserId }
  ↓
1. Auth check (community_admin+)
2. Zod validation (decision enum, notes max 5000)
3. Save reviewer_notes to submission
4. advance() via WorkflowEngine:
   a. Gate checks (lock, transition validity, two-person if applicable)
   b. UPDATE submission status
   c. Record transition
   d. Fire notification to submitter
5. On approve: bump confidence score to 80
6. Release lock on failure
  ↓
Response: 200 { success, fromStatus, toStatus, transitionId }
  ↓
UI: Status updates, admin redirected to queue
```

### Decision outcomes

| Decision | Status Transition | Side Effect |
|----------|------------------|-------------|
| approved | under_review → approved | Confidence score → 80 |
| denied | under_review → denied | None |
| escalated | under_review → escalated | Visible to ORAN admins |
| returned | under_review → returned | Submitter can revise and re-submit |
| pending_second_approval | under_review → pending_second_approval | Two-person gate; notifies other admins |

### Return communication

- ✅ Submitter notified of status change (if actor ≠ submitter)
- ✅ On pending_second_approval: broadcast to all community_admin + oran_admin (except actor)

---

## 19. Coverage Dashboard

### How do I find it?

- Community admin nav → **Coverage** (`/coverage`)
- Read-only dashboard — no forms

### What do I see?

- **7 stat cards**: pending, in-review, verified, rejected, escalated, total, stale (>14 days)
- **Recent activity table**: daily breakdown of verified/rejected/escalated (past 30 days)
- **Top organizations needing review**: org name + pending count
- **Coverage zone map placeholder**: dashed border, not yet implemented

### Data source

```
GET /api/community/coverage
→ { summary, recentActivity[], topOrganizations[] }
```

### Navigation

- Stat cards link to `/queue?status=...` for drill-down

---

## 20. Org Claim Approvals

### How do I find it?

- ORAN admin nav → **Approvals** (`/approvals`)
- Requires oran_admin role

### What do I see?

- `ApprovalsPageClient.tsx`
- Status filter tabs: submitted, under_review, approved, denied
- Table: organization, claimed by, status, submitted date
- Approve / Deny action buttons

### Decision form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| decision | button | Yes | approved / denied |
| notes | inline textarea | Depends | Required for deny (schema .refine) |

Max notes: 5000 chars

### What happens when I decide?

```
Admin clicks Approve or Deny (+ notes if deny)
  ↓
POST /api/admin/approvals
  Body: { submissionId, decision, notes? }
  ↓
1. Auth check (oran_admin only)
2. Zod validation
3. Save reviewer_notes
4. advance() via WorkflowEngine (gates, transitions, notifications)
5. If approved: UPDATE services SET status = 'active' WHERE id = service_id
  ↓
Response: 200 { success }
  ↓
UI: Status badge updates, row reflects new state
```

### Two-person approval

- `org_claim` is in `TWO_PERSON_REQUIRED_TYPES`
- WorkflowEngine enforces: final approver ≠ submitter, final approver ≠ all prior reviewers
- Gated by `FEATURE_FLAGS.TWO_PERSON_APPROVAL`

### Gaps

- ❌ No lock/claim mechanism — two admins could open the same claim simultaneously
- ❌ Only approve/deny — no escalate, return, or request-more-info (unlike community queue)
- ❌ Duplicate pathway: org claims appear in both `/admin/approvals` AND `/community/queue`

---

## 21. Appeal Decisions

### How do I find it?

- ORAN admin nav → **Appeals** (`/appeals`)
- Requires community_admin or oran_admin role

### What do I see?

- `AppealsPageClient.tsx`
- Table: title, status, submitter, assigned to, priority badge
- Decision panel for each row

### Decision form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| decision | button group | Yes | approved / denied / returned |
| notes | textarea | Depends | Required for deny/return (schema .refine) |

Max notes: 5000 chars

### What happens when I decide?

```
Admin clicks decision → provides notes → Submit
  ↓
POST /api/admin/appeals
  Body: { appealId, decision, notes? }
  ↓
1. Auth check (community_admin+)
2. Zod validation (notes required for deny/return)
3. acquireLock(appealId, userId) — prevents concurrent review
4. Save reviewer_notes
5. advance() via WorkflowEngine (gates, transitions, notifications)
6. If approved:
   a. Fetch original_submission_id from appeal payload
   b. UPDATE original submission: denied → needs_review
   c. INSERT transition on original (denied → needs_review)
   d. Original re-enters community queue for fresh review
7. Release lock on failure
  ↓
Response: 200 { success, fromStatus, toStatus, transitionId }
```

### Return communication

- ✅ Appeal submitter notified of decision (via WorkflowEngine)
- ✅ Reviewer notes visible in "My Appeals" on appeal page

---

## 22. Scope Management

### How do I find it?

- ORAN admin nav → **Scopes** (`/scopes`)
- Tab 1 of 3: Scopes list + creation
- Requires oran_admin role

### Create Scope form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | text | Yes | lowercase, alphanumeric, dots/underscores |
| description | textarea w/ charCount | Yes | max 2000 chars |
| risk | dropdown | No | low / medium / high / critical |
| approval | checkbox | No | "Requires approval?" |

### What happens?

```
Admin fills form → Submit
  ↓
POST /api/admin/scopes
  Body: { name, description, riskLevel, requiresApproval }
  ↓
INSERT INTO scopes
  ↓
UI: Scope appears in list with risk badge
```

---

## 23. Scope Grant — Two-Person Approval

### How do I find it?

- `/scopes` → **Pending Grants** tab (Tab 2)
- Shows grants awaiting a second person's decision

### What do I see?

- Table: User ID, Scope, Requested By, Justification, Expires At
- Expand row → decision form

### Decision form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| decision | radio | Yes | approved / denied |
| reason | textarea w/ charCount | Yes | max 5000 chars |

### What happens?

```
Admin B reviews grant requested by Admin A → Approve/Deny
  ↓
PUT /api/admin/scopes/grants/{id}
  Body: { decision, reason }
  ↓
1. Lock pending_scope_grants row
2. Check still pending + not expired
3. Enforce: decidedByUserId ≠ requestedByUserId (two-person rule)
4. UPDATE pending_scope_grants (status → approved/denied)
5. If approved: INSERT INTO user_scope_grants
6. Audit to scope_audit_log
7. Notify requester + admins
  ↓
Response: 200 { success }
```

### Gaps

- ❌ Audit log tab (Tab 3) is placeholder (endpoint pending)

---

## 24. Zone Management

### How do I find it?

- ORAN admin nav → **Zones** (`/zone-management`)
- Requires oran_admin role

### Create / Edit Zone form

| Field | Type | Required | Validation | Max |
|-------|------|----------|------------|-----|
| name | text | Yes | — | 500 |
| description | textarea | No | — | 5000 |
| assignedUserId | text | No | UUID or blank | — |
| status | dropdown | No | active / inactive | — |

### What happens?

```
Admin fills zone details → Save
  ↓
POST /api/admin/zones (create) or PUT /api/admin/zones/{id} (update)
  ↓
CRUD on coverage_zones table
  ↓
UI: Zone appears/updates in list
```

### Delete flow

```
DELETE /api/admin/zones/{id} → removes zone
```

---

## 25. Feature Flags / Rules

### How do I find it?

- ORAN admin nav → **Rules** (`/rules`)
- Requires oran_admin role

### What do I see?

- Card per flag showing name, enabled toggle, rollout percentage
- Click Edit → inline edit panel

### Edit form

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| enabled | toggle switch | Yes | boolean |
| rolloutPct | slider | Yes | 0–100, step=1 |

### What happens?

```
Admin toggles switch or adjusts slider → Save Changes
  ↓
PUT /api/admin/rules
  Body: { name, enabled, rolloutPct }
  ↓
UPDATE feature_flags
  ↓
UI: Card reflects new state
```

### Known flags

| Flag | Description |
|------|-------------|
| `llm_summarize` | LLM summarization of already-retrieved records |
| `map_enabled` | Map view visibility |
| `feedback_form` | Feedback form visibility |
| `host_claims` | Host claim wizard |
| `two_person_approval` | Two-person gate on org_claim/removal_request |
| `sla_enforcement` | SLA deadline enforcement |
| `auto_check_gate` | Auto-check threshold gate |
| `notifications_in_app` | In-app notification delivery |

---

## 26. Audit Trail

### How do I find it?

- ORAN admin nav → **Audit** (`/audit`)
- Read-only view (no forms)
- Requires oran_admin role

### What do I see?

- `AuditPageClient.tsx`
- Filters: action type dropdown (9 types), table name input
- Paginated table: action badge, table, record ID, timestamp
- Expandable rows: previous data / new data (JSON diff), user ID, IP

### Action types

`create`, `update`, `delete`, `approve`, `deny`, `escalate`, `login`, `logout`, `flag_change`

### Data source

```
GET /api/admin/audit?page=1&limit=25&action=&tableName=
→ { results: AuditRow[], total, page, hasMore }
```

---

## 27. Ingestion Pipeline

### How do I find it?

- ORAN admin nav → **Ingestion** (`/ingestion`)
- 4-tab interface, requires oran_admin role

### Tab 1 — Sources (read-only list)

- Table: displayName, trustLevel badge, domainRules, updatedAt
- `GET /api/admin/ingestion/sources`

### Tab 2 — Jobs (read-only list)

- Status filter buttons: All / queued / running / completed / failed / cancelled
- Table: jobType, status, URLs counts, candidates, errors, timing
- `GET /api/admin/ingestion/jobs?limit=50&status=X`

### Tab 3 — Candidates (read-only list)

- Filters: reviewStatus tabs + confidence tier tabs
- Table: sourceUrl, status, tier, confidenceScore
- Paginated (limit=20)
- `GET /api/admin/ingestion/candidates?page=X&limit=20&status=X&tier=X`

### Tab 4 — Process (action forms)

**Single URL form**:

| Field | Type | Required |
|-------|------|----------|
| sourceUrl | url input | Yes |

→ `POST /api/admin/ingestion/process { sourceUrl }`

**Batch form**:

| Field | Type | Required |
|-------|------|----------|
| urls | textarea (one per line) | Yes, max 100 |

→ `POST /api/admin/ingestion/batch { urls }`

**Poll feeds button**:
→ `POST /api/admin/ingestion/feeds/poll`

Results display as JSON or error alert.

---

## 28. Workflow Engine

### Location

- `src/services/workflow/engine.ts`
- Used by: community queue, admin approvals, admin appeals

### Core function: `advance()`

```
advance({ submissionId, toStatus, actorUserId, actorRole, reason?, metadata? })
  ↓
1. Lock submission row (SELECT ... FOR UPDATE)
2. Run gate checks:
   a. checkTransitionGate() — validate against SUBMISSION_TRANSITIONS state machine
   b. checkLockGate() — only lock holder can transition
   c. checkTwoPersonGate() — for org_claim/removal_request → approved only
3. If any gate fails:
   → Record failed transition (gates_passed=false)
   → Return { success: false, error, gateResults }
4. If all pass:
   → UPDATE submission status + timestamps
   → Release lock if terminal status
   → Record successful transition
   → fireStatusChangeNotification()
   → Return { success: true, fromStatus, toStatus, transitionId }
```

### State machine

```
draft                   → submitted, withdrawn
submitted               → auto_checking, needs_review, withdrawn
auto_checking           → needs_review, approved, denied
needs_review            → under_review, expired
under_review            → escalated, pending_second_approval, approved, denied, returned
escalated               → under_review, approved, denied
pending_second_approval → approved, denied, returned
approved                → archived
denied                  → archived
returned                → submitted, withdrawn
withdrawn               → archived
expired                 → archived
archived                → (terminal)
```

### Which flows use the engine?

| Flow | Creation | Review |
|------|----------|--------|
| Appeal | Raw SQL + transition | ✅ advance() with lock |
| Community report | Raw SQL + transition | ✅ advance() |
| Org claim | Raw SQL + transition | ✅ advance() |
| Service verification | Auto-enqueued on service create | ✅ advance() |
| Community queue claim | — | ✅ acquireLock() + advance() |

---

## 29. Notification Service

### Location

- `src/services/notifications/service.ts`

### Functions

- `send()` — single notification with idempotency key
- `broadcast()` — send to multiple recipients
- `getUnread()` / `listNotifications()` — read inbox
- `markRead()` / `markAllRead()` — mark as read
- `getPreferences()` / `setPreferences()` — user prefs

### Channels

- `in_app` — works (stored in notification_events table)
- `email` — **stubbed** (writes record but no delivery)

### Notification inventory

| Event | Trigger | Recipients | Idempotency Key |
|-------|---------|------------|-----------------|
| Appeal filed | POST /api/submissions/appeal | Original reviewer + admin pool | `appeal_filed_{id}` + `new_appeal_{id}_{userId}` |
| Report filed | POST /api/submissions/report | Admin pool | `new_report_{id}_{userId}` |
| Claim filed | POST /api/host/claim | Admin pool | `new_claim_{id}_{userId}` |
| Status changed | WorkflowEngine.advance() | Submitter (if actor ≠ submitter) | `status_{id}_{status}_{timestamp}` |
| Two-person needed | advance() to pending_second_approval | All community_admin + oran_admin (except actor) | `two_person_{id}_{userId}_{timestamp}` |
| Submission assigned | WorkflowEngine.assignSubmission() | Assignee | `assign_{id}_{userId}_{timestamp}` |
| SLA breach | checkSlaBreaches() | Assignee or submitter | `sla_breach_{id}_{timestamp}` |
| Scope grant requested | requestGrant() | Other admins | Via scope service |
| Scope grant decided | decideGrant() | Requester + admins | Via scope service |

### Where is the inbox?

- API endpoints exist: `GET /api/user/notifications`, `PUT /api/user/notifications/[id]/read`, `PUT /api/user/notifications/read-all`
- Bell icon imported in ProfilePageClient (lucide-react)
- **No standalone inbox page** — notifications are stored but users have no dedicated list view
- No notification bell in AppNav header

### Gaps

- ❌ No notification inbox/list UI page
- ❌ No notification bell in AppNav header
- ❌ Email delivery stubbed
- ❌ No push notification channel

---

## 30. SLA Enforcement

### How it works

```
On submission creation: applySla(submissionId, submissionType, jurisdictionState?)
  ↓
1. Query submission_slas for matching type + jurisdiction
2. Calculate deadline: now + review_hours
3. UPDATE submissions SET sla_deadline = deadline
```

### Which flows apply SLA?

- ✅ Appeal: `applySla(appealId, 'appeal')`
- ✅ Report: `applySla(reportId, 'community_report')`
- ✅ Claim: `applySla(submissionId, 'org_claim')`
- All are best-effort (catch + ignore errors)

### Breach detection

```
checkSlaBreaches() — scheduled or manual
  ↓
1. Find submissions where sla_deadline < NOW() AND sla_breached = false
   AND status IN ('needs_review', 'under_review', 'pending_second_approval')
2. Mark sla_breached = true
3. Fire notification for each breached submission
```

### Gaps

- ❌ No pre-breach warning (only fires after breach)
- ❌ No visible SLA badge in queue UI
- ❌ `checkSlaBreaches()` must be called externally (no cron/scheduler wired up)

---

## 31. Crisis Detection

### How it works

- Hardcoded `CRISIS_KEYWORDS` in `src/domain/constants.ts` (50+ keywords)
- Checked on every chat message BEFORE any retrieval
- Examples: "suicide", "suicidal", "kill myself", "self harm", "overdose", "being attacked", "domestic violence", "child abuse", "sleeping outside tonight", "mental breakdown", "withdrawals"
- All are case-insensitive surface-level matches

### Response

- Returns immediately: `{ isCrisis: true, crisisResources: { emergency: 911, crisisLine: 988, communityLine: 211 } }`
- UI shows non-dismissible crisis banner with call links
- **No further processing** — stops the pipeline

### Non-negotiable

- This is a safety-critical hard gate per SSOT
- Must never be disabled by feature flags

---

## 32. Unified Gap List

### Critical

| ID | Flow | Gap | Status |
|----|------|-----|--------|
| C1 | Report Dialog (§5) | `ReportProblemDialog.tsx` called `/api/reports` without notifications | ✅ RESOLVED — migrated to `/api/submissions/report`; legacy endpoint archived |
| C2 | Notifications (§29) | No notification inbox/list UI page | ✅ RESOLVED — NotificationBell component + /notifications inbox page created |

### High

| ID | Flow | Gap | Status |
|----|------|-----|--------|
| H1 | Email (§29) | Email delivery via Azure Communication Services | ✅ RESOLVED — fully implemented in `src/services/email/azureEmail.ts` |
| H2 | Profile (§10) | "Delete all data" only clears localStorage, not server data | ✅ RESOLVED — /api/user/data-delete endpoint + data export download + ProfilePageClient updated |
| H3 | Org Claim (§12) | Phone stored in payload JSON not in organizations table | ✅ RESOLVED — migration 0024 adds phone column; claim INSERT updated |
| H4 | Org Claim (§20) | No lock/claim on approvals page | ✅ RESOLVED — acquireLock/releaseLock already used in POST /api/admin/approvals |
| H5 | Org Claim (§12) | Denied claims leave orphaned org + service records | ✅ RESOLVED — denial handler now marks org/service as defunct |
| H6 | Org Claim (§20) | Appears in BOTH `/admin/approvals` AND `/community/queue` | ✅ RESOLVED — role scope badges added ("ORAN Admin" / "Community Admin") with clarified descriptions |
| H7 | Team (§16) | Invite by UUID only — no email invite or user lookup | ✅ RESOLVED — API accepts email, UI has email/UUID toggle, invite notification sent |
| H8 | Report (§7) | No nav link to `/report` in AppNav | ✅ RESOLVED — added Report link with Flag icon to SEEKER_NAV |
| H9 | SLA (§30) | `checkSlaBreaches()` not wired to any scheduler | ✅ RESOLVED — Azure Functions timer trigger (hourly) at `functions/checkSlaBreaches/` |

### Medium

| ID | Flow | Gap | Status |
|----|------|-----|--------|
| M1 | Appeal (§8) | Reason duplicated in `notes` and `payload.appeal_reason` | ✅ RESOLVED — removed duplicate `appeal_reason` from payload JSON |
| M2 | Report (§7) | Anonymous reporters can't be notified of outcome | ✅ RESOLVED — contact_email from payload used for terminal-status email via workflow engine |
| M3 | Report (§7) | `contactEmail` captured but unused | ✅ RESOLVED — see M2; `contact_email` now triggers email on terminal status changes |
| M4 | Queue (§17) | No "assigned to me" filter | ✅ RESOLVED — "Assigned to me" filter tab added to community queue UI |
| M5 | Queue (§17) | No SLA badge/deadline indicator in UI | ✅ RESOLVED — SLA column with breach badge and deadline date added to queue table |
| M6 | Location (§15) | Coordinates "rounded for privacy" hint but no server-side rounding | ✅ RESOLVED — server-side rounding to 3 decimals (~111m) in POST and PATCH handlers |
| M7 | Scopes (§22) | Audit log tab is placeholder | ✅ RESOLVED — new `/api/admin/scopes/audit` endpoint; AuditTab wired to real data |
| M8 | Coverage (§19) | Zone map is placeholder | ⏸️ DEFERRED — `coverage_zones` table does not exist yet; blocked on DB schema |
| M9 | Notification (§11) | Email toggles shown but email is stubbed | ✅ RESOLVED — email fully functional via Azure Communication Services |
| M10 | Saved (§9) | localStorage/server sync can drift | ✅ RESOLVED — server is source of truth for authenticated users; local-only IDs pushed to server |
| M11 | Service (§14) | No notification on service creation | ✅ RESOLVED — admin pool notified via `notification_events` on service submission |
| M12 | Org (§13) | HSDS fields in edit modal may not persist | ✅ RESOLVED — edit modal initializes from org record; PUT body includes HSDS fields |

---

*End of audit. 27 flows traced, 32 sections. 22 resolved (C1, C2, H1–H9, M1–M7, M9–M12). 1 deferred (M8 — coverage_zones table). Remaining: 0 critical, 0 high, 0 medium open gaps.*
