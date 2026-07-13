# Chat-First Resource Navigator MVP

Status: protected-preview product direction and implementation note.

Brand line: **Building Bridges, Strengthening Communities**.

## Internal diagnosis

### What exists

- A retrieval-first `/chat` pipeline with deterministic crisis routing, intent classification, SQL/PostGIS matching, optional post-retrieval summarization, and session-scoped filters.
- Shared Directory, Map, and service-detail surfaces backed by the canonical service model.
- Anonymous listing reports, provider claim/update submissions, a community verification queue, ORAN-admin reports/triage, and a source-registry/ingestion pipeline.
- HSDS-aligned provider, service, eligibility, coverage, contact, schedule, document, confidence, submission, evidence, and source-provenance records.

### What was wrong for the founder vision

- The landing page made directory search the primary action and positioned chat as a secondary feature.
- Chat filters contained useful location and access constraints, but the first interaction did not explain a focused, minimum-necessary intake path.
- Compact recommendations showed basic contact data and a trust band, but did not consistently present a next step, what to ask, coverage, documents, or a source/freshness disclosure.
- Existing review, claim, report, and sourcing surfaces were operationally strong but not documented as one trust-maintenance loop around seeker matching.

### What is preserved

- Crisis routing before quota, rate limiting, intent detection, and retrieval.
- Deterministic retrieval/ranking; no LLM participates in matching.
- Canonical provider/service truth, the three-score trust/match contract, published-record filters, and the eligibility disclaimer.
- Existing report, provider-claim, volunteer review, admin triage, and source-registry workflows.

### What is replaced or corrected

- The landing-page directory-search hero is replaced by a plain-language guided intake. Directory and Map remain secondary, interoperable discovery surfaces.
- Chat's empty state now offers the same focused intake while preserving free text and quick-need shortcuts.
- Chat recommendations now expose an action panel and expandable source/verification details. Missing freshness data is shown as unknown instead of being inferred.

## Product location

- Primary entry: `/`
- Full intake and matching workspace: `/chat`
- Provider detail and action context: `/service/[id]`
- Correction loop: `/report?serviceId=[id]`
- Provider claim/update request: `/claim`
- Volunteer verification: `/queue` and `/verify`
- ORAN-admin report triage and sourcing: `/reports`, `/triage`, and `/ingestion`

## Audiences and mobile scope

The product language recognizes Government, Seekers, Admin, Business, Community Volunteers, and Partners. The protected authorization model remains intentionally narrower:

- Seekers use the seeker workspace.
- Government and Business publishers use the organization workspace.
- Community Volunteers use the community-review workspace.
- Admin refers to the ORAN-admin workspace.
- Partners use organization or partnership workflows until a distinct partner permission model is approved.

This mapping does not create new RBAC roles by implication. Mobile surfaces expose a fixed, safe-area-aware bottom navigation scoped to the current seeker, organization, community-volunteer, or ORAN-admin workspace; secondary actions remain available through each workspace menu.

The initial resource language explicitly covers government benefits (including SNAP, Medicaid, veteran, disability, and immigration services), community essentials (food banks, meal centers, and clothing banks), household stability (rent, housing, electricity, and utilities), and health/wellbeing (mental health and sliding-scale medical or dental care).

## Matching representation

Seeker recommendations remain adapters over canonical `EnrichedService` records. The presentation contract adds only stored or explicitly unknown fields:

- why the record may fit;
- distance and stored coverage area;
- stored eligibility and documents;
- the clearest stored contact/application next step;
- a safe question to ask the provider;
- trust band plus exact verification state when present;
- stored source link and checked dates when present;
- an explicit stale, disputed, unverified, retired, or unknown-freshness warning.

Trust and fit are separate. Missing inputs do not become negative eligibility facts, and an exact verification status is never derived from a confidence score.

## Geography and expansion

ORAN launches with nationwide United States coverage as a product requirement, not a later expansion phase. Intake accepts city, state, or ZIP as an approximate location, and the typed coverage model supports city, county, state, postal-code, nationwide, virtual, and custom areas. Local fixtures and canary records may be used to validate quality, but they do not define the platform boundary and no region is hard-coded into canonical matching.

## Source intent and recommendation boundaries

Source trust and source purpose are separate controls. A reputable source is not automatically a seeker-facing service catalog.

- `service_catalog` contains direct providers or services and may produce standalone recommendations after normal verification.
- `program_navigation` contains official benefit, application, or referral entry points and may produce standalone navigation results after normal verification.
- `supporting_reference` contains retailer acceptance, coverage, eligibility-reference, or enrichment data. It may improve a direct recommendation but cannot become a standalone service result.
- `excluded` is retained only when needed for audit or governance and cannot become a seeker-facing result.

For example, “stores that accept SNAP” is supporting context. ORAN should guide a seeker toward SNAP eligibility, application, case support, benefit troubleshooting, and nearby food assistance; it should not mistake a retailer list for the platform’s core service inventory.

## Safety and privacy

- Intake asks for the need first; location, urgency, audience, and access mode are optional and collapsed.
- The UI explicitly tells seekers not to enter Social Security numbers, full birth dates, or case numbers.
- No intake answer is persisted by this foundation; chat retains only the existing session-scoped behavior.
- ORAN remains a router to stored provider facts, not emergency response, a government authority, or medical/legal advice.
- Missing provenance or freshness is visible. The UI does not invent a checked date or exact verification workflow state.

## Protected preview acceptance

Before public launch, validate the flow with synthetic or approved preview records covering:

- a high-confidence provider with a verified date and application step;
- a record with unknown source freshness;
- stale, disputed, and retired warning fixtures;
- empty geography, no-match, temporary-unavailable, and crisis routes;
- keyboard and screen-reader operation at mobile and desktop widths.
