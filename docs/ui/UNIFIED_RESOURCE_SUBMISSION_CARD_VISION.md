# Unified Resource Submission Card Vision

## Why this matters

The unified resource submission card is the canonical intake, edit, review, and publication contract for ORAN. If it is weak, every downstream experience becomes weak: public contribution, host publishing, community review, ORAN oversight, and live seeker trust all degrade together.

The goal is one submission system that:

- accepts public suggestions and authenticated host submissions through the same canonical draft shape
- lets community admins and ORAN admins review the exact same structured record instead of retyping information into a second system
- gives AI a constrained assist role that only proposes evidence-backed field fills, tags, and review cues
- produces a defensible live publication record with reverification timers, confidence, and source assertions

## What already exists in the repo

Current foundation already present in code:

- Canonical draft model in [src/domain/resourceSubmission.ts](src/domain/resourceSubmission.ts)
- Shared multi-portal workspace in [src/components/resource-submissions/ResourceSubmissionWorkspace.tsx](src/components/resource-submissions/ResourceSubmissionWorkspace.tsx)
- Shared public and host submission APIs in [src/app/api/resource-submissions/route.ts](src/app/api/resource-submissions/route.ts) and [src/app/api/resource-submissions/[id]/route.ts](src/app/api/resource-submissions/[id]/route.ts)
- AI/source assist patching in [src/services/resourceSubmissions/assistShared.ts](src/services/resourceSubmissions/assistShared.ts)
- Co-tag suggestion panel in [src/components/resource-submissions/CoTagSuggestionPanel.tsx](src/components/resource-submissions/CoTagSuggestionPanel.tsx)
- Publication lifecycle and reverification support wired through the resource-submission service layer

Current canonical cards already cover:

- organization identity
- listing basics
- locations and hours
- taxonomy and tags
- access and eligibility
- evidence and source
- review and trust

## End-state product standard

The card should behave like a world-class operations document, not a form. Every section should answer one operational question.

### 1. Identity and ownership

Purpose: establish who owns the record and whether ORAN can trust the submitter-provider relationship.

Required core fields:

- organization legal/display name
- organization description
- submitter relationship to provider
- at least one verification path: canonical URL, organization email, or organization phone

Needed next:

- structured ownership type: provider staff, partner, volunteer, resident, reviewer-entered, system-imported
- domain match signals between submitter email and provider website
- organization identity confidence with explicit evidence reasons

### 2. Service definition

Purpose: define the seeker-visible service without ambiguity.

Required core fields:

- service name
- service description
- primary category/taxonomy assignment
- how to access the service

Needed next:

- delivery mode: in-person, phone, web, mobile, outreach, hybrid
- appointment requirement, walk-in support, referral requirement
- structured fee model instead of free-text only
- structured intake channel and intake latency

### 3. Coverage and location

Purpose: make the resource mappable, searchable, and reviewable by geography.

Required core fields:

- at least one location or clear service-area definition
- city/state or address-level coverage data
- hours or explicit always-open / appointment-only state

Needed next:

- service-area geometry support, not just free-text service areas
- geocode confidence and map preview in-card
- location-level verification status
- transit, accessibility, remote-only, and mobile-site flags as structured fields

### 4. Eligibility and access

Purpose: prevent false seeker expectations.

Required core fields:

- eligibility description
- service area

Needed next:

- structured eligibility dimensions: age, gender, veteran status, family status, income band, housing status, language requirement, disability accommodation
- required documents as structured checklist values plus free-text notes
- waitlist state, capacity state, and intake closure flags

### 5. Verification and evidence

Purpose: give reviewers concrete proof instead of forcing them to infer trustworthiness.

Required core fields:

- evidence notes
- source URL or alternate evidence path

Needed next:

- separate verification tracks for URL, email, and phone
- verification method per channel: fetched page, domain check, manual call, email challenge, reviewer confirmation, external dataset match
- last verified at, verified by, and verification result per channel
- support for attaching screenshots, documents, and call notes to the same evidence card

### 6. Taxonomy and discovery

Purpose: guarantee every resource lands in the right seeker lanes and exports cleanly to downstream systems.

Required core fields:

- at least one unified taxonomy category or approved custom term

Needed next:

- taxonomy hierarchy with primary vs secondary category
- seeker intent tags, delivery tags, audience tags, and urgency tags
- admin-only discoverability warnings when categories conflict with evidence
- canonical HSDS/211 crosswalk preview where applicable

### 7. AI assist and AI review

Purpose: make AI useful without letting it invent facts.

AI may:

- extract candidate fields from a source URL
- suggest taxonomy, co-tags, and missing-card recovery hints
- flag contradictions between text, URLs, phone numbers, and service area
- draft reviewer summaries from already extracted or stored evidence

AI may not:

- invent provider facts
- publish unverified data
- overwrite human-entered values silently

Needed next:

- field-by-field provenance badges: human entered, AI suggested, reviewer corrected, imported from source
- AI warning rail for suspicious claims, missing evidence, or risky category choices
- reviewer-side accept/reject per AI suggestion rather than patch-all behavior only

## Scope-aware requirements

The card should change requiredness by actor and workflow, not by forking into separate forms.

### Public submitter

Must provide:

- organization name
- service name
- service description
- service area or location
- one evidence path
- enough notes for a reviewer to verify the listing

Should not be forced to provide:

- internal ownership fields
- publication cadence
- advanced compliance metadata

### Host organization operator

Must provide:

- owner organization
- structured service definition
- location and contact details
- taxonomy
- eligibility/access data
- authoritative evidence summary

Should additionally see:

- freshness/reverification expectations
- unresolved reviewer returns
- duplicate-match warnings against existing live records

### Community admin reviewer

Must see:

- all submitter-entered fields
- evidence and verification trails
- card completeness and contradictions
- approve, return, deny, escalate controls

Must capture:

- reviewer notes
- reason codes for return/deny
- verification outcome per evidence channel

### ORAN admin

Must additionally control:

- exception overrides
- policy or rule conflicts
- sensitive integrity holds
- global taxonomy / publication consequences

## Verification system design

### URL verification

The card should store:

- raw URL
- canonical URL after redirects
- fetch status
- title/meta snapshot
- content hash / last fetch timestamp
- domain ownership hints
- mismatch warnings when org name and domain diverge

### Email verification

The card should store:

- contact email
- domain
- whether the domain matches the org website
- verification status: untested, challenge sent, confirmed, bounced, reviewer-confirmed
- last verification timestamp

### Phone verification

The card should store:

- normalized E.164 number alongside display value
- line type when known: voice, text, hotline, tty, fax
- verification status: untested, reviewer-called, provider-confirmed, unreachable
- notes from verification attempts

### Map and coverage verification

The card should store:

- geocode result confidence
- location precision: exact, approximate, city-level, region-level
- service area type: point, polygon, county list, state list, remote-only
- downstream map preview before approval

## Publication lifecycle and reverification

Publication should not end at approval. The unified card should own ongoing trust maintenance.

Needed lifecycle fields:

- approved at
- published at
- last verified at
- reverification due at
- verification cadence policy
- risk tier
- current freshness state

Suggested cadence model:

- high-risk or rapidly changing services: 30 to 60 days
- standard community resources: 90 to 180 days
- stable institutional resources: 180 to 365 days

Triggers that should shorten the timer:

- public report volume
- failed URL fetches
- bounced email verification
- disconnected phone verification
- repeated reviewer returns
- detected mismatch between live record and current source page

## UI and UX blueprint

### Left rail

- completion status by card
- trust score / evidence health
- duplicate match warnings
- reverification timer when live

### Main canvas

- one card per operational question
- sticky in-card section summaries
- AI suggestion trays embedded near the fields they affect
- inline map preview for coverage/location cards

### Reviewer mode

- diff view between live record and submitted proposal
- evidence tray with source fetch snapshot and reviewer notes
- explicit approve / return / deny / escalate footer with reason-code capture

### Publish mode

- preflight checklist: required complete, verification path present, taxonomy valid, map valid, no blocking contradictions
- projected live changes preview before final approval

## Implementation roadmap

### Phase 1

- Make public workspace initialization fail visibly and recoverably
- Keep public, host, and reviewer flows on the same shared workspace shell
- Expose current completion, evidence, and AI assist more clearly

### Phase 2

- Extend the canonical draft with structured verification objects for URL, email, phone, and geo
- Add scope-aware required-field policies by actor and submission mode
- Add map preview and structured service-area modeling

### Phase 3

- Add reviewer-side AI suggestion acceptance and contradiction detection
- Add duplicate-record intelligence against live orgs/services/locations
- Add publication preflight and live-diff preview

### Phase 4

- Add lifecycle policy controls for reverify timers, freshness risk tiers, and escalation triggers
- Add analytics for submitter completion drop-off, reviewer return reasons, and verification failure rates

## Product bar

This card is done when:

- a public resident can submit a credible resource without getting lost
- a host operator can publish with less back-and-forth because the card captures everything reviewers need
- a community admin can approve or return a listing without opening parallel tools
- an ORAN admin can trace exactly why a record was published, held, or scheduled for reverification
- AI increases throughput without ever becoming an origin of unverified facts
