# ORAN Data Model

ORAN implements the [Open Referral Human Services Data Specification (HSDS)](https://docs.openreferral.org/en/latest/hsds/) as its foundational schema with ORAN-specific extensions for confidence scoring, verification workflows, and chat analytics.

---

## Core HSDS Entities

### `organizations`
The top-level entity representing a service-providing entity.

| Field            | Type         | Description |
|------------------|--------------|-------------|
| id               | UUID PK      | Unique identifier |
| name             | TEXT NOT NULL| Legal or operating name |
| description      | TEXT         | Brief description of the organization |
| url              | TEXT         | Official website URL (must be from DB record, never hallucinated) |
| email            | TEXT         | Primary contact email |
| tax_status       | TEXT         | IRS tax-exempt status (e.g. "501c3") |
| tax_id           | TEXT         | Employer Identification Number |
| year_incorporated| INT          | Year the organization was incorporated |
| legal_status     | TEXT         | Legal form (e.g. "nonprofit", "government") |
| logo_url         | TEXT         | URL to organization logo |
| uri              | TEXT         | Persistent URI for linked-data use |
| status           | TEXT         | "active", "inactive", "defunct" |
| updated_at       | TIMESTAMPTZ  | Last update timestamp |
| created_at       | TIMESTAMPTZ  | Record creation timestamp |

### `locations`
Physical or virtual places where services are delivered.

| Field            | Type         | Description |
|------------------|--------------|-------------|
| id               | UUID PK      | Unique identifier |
| organization_id  | UUID FK      | Parent organization |
| name             | TEXT         | Location name |
| alternate_name   | TEXT         | Alternate or colloquial name |
| description      | TEXT         | Description of the location |
| transportation   | TEXT         | Public transit directions |
| latitude         | DOUBLE       | WGS84 latitude (approximate for privacy) |
| longitude        | DOUBLE       | WGS84 longitude (approximate for privacy) |
| geom             | POINT        | PostGIS geometry point (SRID 4326) |
| status           | TEXT         | "active", "inactive", "defunct" |
| created_at       | TIMESTAMPTZ  | Record creation timestamp |
| updated_at       | TIMESTAMPTZ  | Last update timestamp |

### `services`
Specific services offered by an organization.

| Field                   | Type        | Description |
|-------------------------|-------------|-------------|
| id                      | UUID PK     | Unique identifier |
| organization_id         | UUID FK     | Parent organization |
| program_id              | UUID FK     | Optional program grouping |
| name                    | TEXT NOT NULL | Service name |
| alternate_name          | TEXT        | Alternate name |
| description             | TEXT        | Detailed description |
| url                     | TEXT        | Service-specific URL |
| email                   | TEXT        | Service contact email |
| status                  | TEXT        | "active", "inactive", "defunct" |
| interpretation_services | TEXT        | Languages available for interpretation |
| application_process     | TEXT        | How to apply |
| wait_time               | TEXT        | Typical wait time |
| fees                    | TEXT        | Fee structure description |
| accreditations          | TEXT        | Relevant accreditations |
| licenses                | TEXT        | Required licenses |
| updated_at              | TIMESTAMPTZ | Last update timestamp |
| created_at              | TIMESTAMPTZ | Record creation timestamp |

### `service_at_location`
Junction table linking services to locations.

| Field          | Type        | Description |
|----------------|-------------|-------------|
| id             | UUID PK     | Unique identifier |
| service_id     | UUID FK     | Reference to service |
| location_id    | UUID FK     | Reference to location |
| description    | TEXT        | Any location-specific service notes |
| created_at     | TIMESTAMPTZ | Record creation timestamp |

### `phones`
Phone numbers associated with organizations, locations, or services.

| Field          | Type        | Description |
|----------------|-------------|-------------|
| id             | UUID PK     | Unique identifier |
| location_id    | UUID FK     | Associated location (nullable) |
| service_id     | UUID FK     | Associated service (nullable) |
| organization_id| UUID FK     | Associated organization (nullable) |
| number         | TEXT NOT NULL | Phone number (from DB record only, never invented) |
| extension      | TEXT        | Phone extension |
| type           | TEXT        | "voice", "fax", "tty", "hotline", "sms" |
| language       | TEXT        | Language spoken |
| description    | TEXT        | Additional context |

### `addresses`
Physical addresses for locations.

| Field          | Type        | Description |
|----------------|-------------|-------------|
| id             | UUID PK     | Unique identifier |
| location_id    | UUID FK     | Associated location |
| attention      | TEXT        | Attention line |
| address_1      | TEXT        | Street address |
| address_2      | TEXT        | Suite, unit, etc. |
| city           | TEXT        | City |
| region         | TEXT        | Region/county |
| state_province | TEXT        | State or province code |
| postal_code    | TEXT        | ZIP/postal code |
| country        | TEXT        | ISO 3166 country code |

### `schedules`
Operating hours using RFC 5545 iCalendar RRULE semantics.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| service_id  | UUID FK     | Associated service (nullable) |
| location_id | UUID FK     | Associated location (nullable) |
| valid_from  | DATE        | Schedule validity start |
| valid_to    | DATE        | Schedule validity end |
| dtstart     | TEXT        | iCal DTSTART |
| until       | TEXT        | iCal UNTIL |
| wkst        | TEXT        | Week start day |
| days        | TEXT[]      | Array of days (MO, TU, WE, TH, FR, SA, SU) |
| opens_at    | TIME        | Opening time |
| closes_at   | TIME        | Closing time |
| description | TEXT        | Human-readable schedule description |

### `taxonomy_terms`
Classification terms (AIRS/211 taxonomy or custom).

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| term        | TEXT NOT NULL | Term label |
| description | TEXT        | Term description |
| parent_id   | UUID FK     | Parent term for hierarchical taxonomy |
| taxonomy    | TEXT        | Taxonomy name (e.g. "211", "AIRS", "custom") |
| created_at  | TIMESTAMPTZ | Record creation timestamp |

### `service_taxonomy`
Junction table linking services to taxonomy terms.

| Field            | Type    | Description |
|------------------|---------|-------------|
| id               | UUID PK | Unique identifier |
| service_id       | UUID FK | Reference to service |
| taxonomy_term_id | UUID FK | Reference to taxonomy term |

---

## ORAN Extensions

### `confidence_scores`
Computed confidence score for each service record.

| Field                | Type        | Description |
|----------------------|-------------|-------------|
| id                   | UUID PK     | Unique identifier |
| service_id           | UUID FK     | Associated service |
| score                | NUMERIC(5,2)| Final confidence score 0–100 |
| verification_confidence | NUMERIC(5,2)| ORAN sub-score: verification confidence (0–100) |
| eligibility_match    | NUMERIC(5,2)| ORAN sub-score: eligibility match (0–100) |
| constraint_fit       | NUMERIC(5,2)| ORAN sub-score: constraint fit (0–100) |
| computed_at          | TIMESTAMPTZ | When score was last computed |

### `verification_queue`
Workflow queue for record verification.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| service_id  | UUID FK     | Service under review |
| status      | TEXT        | "pending", "in_review", "verified", "rejected", "escalated" |
| submitted_by| TEXT        | User ID who submitted |
| assigned_to | TEXT        | Community admin user ID |
| notes       | TEXT        | Reviewer notes |
| created_at  | TIMESTAMPTZ | Submission timestamp |
| updated_at  | TIMESTAMPTZ | Last status change timestamp |

### `seeker_feedback`
User-submitted feedback on service encounters.

| Field           | Type        | Description |
|-----------------|-------------|-------------|
| id              | UUID PK     | Unique identifier |
| service_id      | UUID FK     | Service feedback is about |
| session_id      | UUID        | Chat session that surfaced this service |
| rating          | INT         | 1–5 star rating |
| comment         | TEXT        | Optional free text (no PII) |
| contact_success | BOOLEAN     | Whether user successfully contacted the service |
| created_at      | TIMESTAMPTZ | Submission timestamp |

### `chat_sessions`
Analytics log of chat interactions.

| Field             | Type        | Description |
|-------------------|-------------|-------------|
| id                | UUID PK     | Unique session identifier |
| user_id           | TEXT        | Entra Object ID (nullable for anonymous) |
| started_at        | TIMESTAMPTZ | Session start |
| ended_at          | TIMESTAMPTZ | Session end (nullable if active) |
| intent_summary    | TEXT        | Detected intent category |
| service_ids_shown | UUID[]      | Array of service IDs presented |
| message_count     | INT          | Number of messages in session |

### `feature_flags`
Runtime feature toggle configuration.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| name        | TEXT UNIQUE | Flag identifier (e.g. "llm_summarize") |
| enabled     | BOOLEAN     | Master on/off switch |
| description | TEXT        | Human-readable description |
| rollout_pct | INT         | Percentage rollout (0–100) |
| created_at  | TIMESTAMPTZ | Creation timestamp |
| updated_at  | TIMESTAMPTZ | Last update timestamp |

---

## Programs, Eligibility & Documents (Migration 0009)

### `programs`
Organizational programs that group related services.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| organization_id | UUID FK | Parent organization |
| name        | TEXT NOT NULL | Program name |
| alternate_name | TEXT     | Alternate name |
| description | TEXT        | Program description |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

### `eligibility`
Eligibility criteria for services.

| Field          | Type        | Description |
|----------------|-------------|-------------|
| id             | UUID PK     | Unique identifier |
| service_id     | UUID FK     | Associated service |
| eligibility    | TEXT        | Eligibility rule description |
| minimum_age    | INT         | Minimum age requirement |
| maximum_age    | INT         | Maximum age requirement |
| gender         | TEXT        | Gender requirement |
| income_limit   | TEXT        | Income limit description |
| residency      | TEXT        | Residency requirement |
| citizenship    | TEXT        | Citizenship requirement |
| created_at     | TIMESTAMPTZ | Record creation |
| updated_at     | TIMESTAMPTZ | Last update |

### `required_documents`
Documents needed to access a service.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| service_id  | UUID FK     | Associated service |
| document    | TEXT NOT NULL | Document name/type |
| type        | TEXT        | Document category |
| uri         | TEXT        | Link to document info |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

---

## Service Areas, Languages & Accessibility (Migration 0010)

### `service_areas`
Geographic coverage areas for services.

| Field              | Type        | Description |
|--------------------|-------------|-------------|
| id                 | UUID PK     | Unique identifier |
| service_id         | UUID FK     | Associated service |
| name               | TEXT        | Area name |
| description        | TEXT        | Area description |
| extent_type        | TEXT        | "city", "county", "state", "national" |
| extent             | TEXT        | Geographic extent value |
| uri                | TEXT        | URI for the area |
| created_at         | TIMESTAMPTZ | Record creation |
| updated_at         | TIMESTAMPTZ | Last update |

### `languages`
Languages available for services.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| service_id  | UUID FK     | Associated service |
| location_id | UUID FK     | Associated location (nullable) |
| language    | TEXT NOT NULL | Language name |
| code        | TEXT        | ISO 639 language code |
| note        | TEXT        | Notes on availability |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

### `accessibility_for_disabilities`
Accessibility accommodations at service locations.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| location_id | UUID FK     | Associated location |
| accessibility | TEXT NOT NULL | Accessibility feature description |
| details     | TEXT        | Implementation details |
| url         | TEXT        | More information link |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

---

## Contacts, Saved Services & Evidence (Migration 0011)

### `contacts`
Contact persons for organizations/services.

| Field            | Type        | Description |
|------------------|-------------|-------------|
| id               | UUID PK     | Unique identifier |
| organization_id  | UUID FK     | Associated organization (nullable) |
| service_id       | UUID FK     | Associated service (nullable) |
| name             | TEXT NOT NULL | Contact name |
| title            | TEXT        | Job title |
| department       | TEXT        | Department |
| email            | TEXT        | Contact email |
| phone            | TEXT        | Contact phone |
| created_at       | TIMESTAMPTZ | Record creation |
| updated_at       | TIMESTAMPTZ | Last update |

### `saved_services`
User-saved service bookmarks.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| user_id     | TEXT NOT NULL | User identifier |
| service_id  | UUID FK     | Saved service |
| created_at  | TIMESTAMPTZ | When saved |

### `verification_evidence`
Evidence artifacts supporting service verification.

| Field          | Type        | Description |
|----------------|-------------|-------------|
| id             | UUID PK     | Unique identifier |
| service_id     | UUID FK     | Associated service |
| evidence_type  | TEXT NOT NULL | Type (screenshot, document, API, etc.) |
| source_url     | TEXT        | Source URL of evidence |
| content_hash   | TEXT        | SHA-256 hash of content |
| verified_at    | TIMESTAMPTZ | When verified |
| verified_by    | TEXT        | Verifier identifier |
| created_at     | TIMESTAMPTZ | Record creation |

---

## Service Attributes & Extensions (Migrations 0012–0013)

### `service_attributes`
Flexible tag-based attributes for services.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| service_id  | UUID FK     | Associated service |
| taxonomy    | TEXT NOT NULL | Attribute taxonomy (delivery, cost, access, culture, population, situation) |
| tag         | TEXT NOT NULL | Attribute tag value |
| details     | TEXT        | Additional details |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

### `service_adaptations`
Adaptations for specific populations/conditions.

| Field           | Type        | Description |
|-----------------|-------------|-------------|
| id              | UUID PK     | Unique identifier |
| service_id      | UUID FK     | Associated service |
| adaptation_type | TEXT NOT NULL | Type (disability, health_condition, age_group, learning) |
| adaptation_tag  | TEXT NOT NULL | Specific tag |
| details         | TEXT        | Details |
| created_at      | TIMESTAMPTZ | Record creation |
| updated_at      | TIMESTAMPTZ | Last update |

### `dietary_options`
Dietary accommodations for food services.

| Field         | Type        | Description |
|---------------|-------------|-------------|
| id            | UUID PK     | Unique identifier |
| service_id    | UUID FK     | Associated service |
| dietary_type  | TEXT NOT NULL | Diet type (halal, kosher, vegan, etc.) |
| availability  | TEXT        | always, by_request, limited, seasonal |
| details       | TEXT        | Additional details |
| created_at    | TIMESTAMPTZ | Record creation |
| updated_at    | TIMESTAMPTZ | Last update |

---

## Governance & Members (Migrations 0004–0006)

### `audit_logs`
System-wide audit trail for data changes.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| table_name  | TEXT NOT NULL | Affected table |
| record_id   | UUID        | Affected record |
| action      | TEXT NOT NULL | INSERT, UPDATE, DELETE |
| old_data    | JSONB       | Previous state |
| new_data    | JSONB       | New state |
| performed_by | TEXT       | Actor identifier |
| performed_at | TIMESTAMPTZ | When action occurred |
| ip_address  | TEXT        | Request origin (no PII beyond IP) |
| user_agent  | TEXT        | Request user agent |

### `coverage_zones`
Geographic coverage zones for admin assignment and routing.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| name        | TEXT NOT NULL | Zone name |
| zone_type   | TEXT NOT NULL | city, county, state, region |
| state       | TEXT        | State code |
| county      | TEXT        | County name |
| geometry    | GEOMETRY    | PostGIS polygon boundary |
| parent_zone_id | UUID FK  | Parent zone for hierarchy |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

### `organization_members`
Members/staff of organizations with role assignments.

| Field            | Type        | Description |
|------------------|-------------|-------------|
| id               | UUID PK     | Unique identifier |
| organization_id  | UUID FK     | Associated organization |
| user_id          | TEXT NOT NULL | User identifier |
| role             | TEXT NOT NULL | Role within organization |
| invited_by       | TEXT        | Who invited this member |
| accepted_at      | TIMESTAMPTZ | When invitation was accepted |
| created_at       | TIMESTAMPTZ | Record creation |
| updated_at       | TIMESTAMPTZ | Last update |

### `user_profiles`
User profile data (minimal PII, pseudonymous).

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| user_id     | TEXT UNIQUE | External user identifier |
| display_name | TEXT       | Display name |
| preferred_locale | TEXT   | Preferred language/locale |
| notification_prefs | JSONB | Notification settings |
| created_at  | TIMESTAMPTZ | Record creation |
| updated_at  | TIMESTAMPTZ | Last update |

---

## Import & Staging (Migration 0003)

### `import_batches`
Track each bulk import operation.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| source      | TEXT NOT NULL | Import source identifier |
| status      | TEXT        | pending, processing, completed, failed |
| record_count | INT        | Number of records in batch |
| error_count | INT         | Count of validation errors |
| created_at  | TIMESTAMPTZ | When import started |

### `staging_organizations` / `staging_locations` / `staging_services`
Temporary staging tables that hold imported data before admin review and promotion to live tables. Schema mirrors the corresponding live table plus import metadata fields (`batch_id`, `import_status`, `diff_json`).

---

## Ingestion Pipeline (Migration 0002)

### `ingestion_sources`
Registry of crawl sources (domains, feeds, APIs).

### `ingestion_jobs`
Tracks individual crawl/extraction jobs with status, stats, and timestamps.

### `evidence_snapshots`
Raw HTML/content snapshots captured during crawls with content hashing.

### `extracted_candidates`
Full candidate records extracted from crawled pages, 45 columns including all HSDS fields, review status, jurisdiction hints, and confidence scores.

### `resource_tags`
Tags assigned to candidates (by LLM or human) with confidence and source metadata.

### `discovered_links`
Sub-links found during page crawls, classified by type (contact, hours, apply, etc.).

### `ingestion_audit_events`
Event log for ingestion pipeline actions (fetch, extract, verify, etc.).

### `llm_suggestions`
LLM-generated field value suggestions pending admin review.

---

## Admin Review & Publish (Migrations 0018–0019)

### `admin_review_profiles`
Reviewer profiles with expertise, capacity, and geographic assignment.

### `candidate_admin_assignments`
Links candidates to assigned admin reviewers with SLA tracking.

### `tag_confirmation_queue`
Queue of tags awaiting admin confirmation/rejection.

### `publish_criteria`
Configurable thresholds for auto-publish and publish readiness by category/jurisdiction.

### `candidate_readiness`
Computed readiness status for each candidate (all criteria met, score, tier).

---

## Key Relationships

```
organizations ──< locations ──< addresses
organizations ──< services ──< service_at_location >── locations
organizations ──< phones
locations ──< phones
services ──< phones
services ──< schedules
locations ──< schedules
services ──< service_taxonomy >── taxonomy_terms
taxonomy_terms ──< taxonomy_terms (self-referential parent)
services ──< confidence_scores
services ──< verification_queue
services ──< seeker_feedback
services ──< eligibility
services ──< required_documents
services ──< service_areas
services ──< languages
services ──< service_attributes
services ──< service_adaptations
services ──< dietary_options
services ──< contacts
organizations ──< contacts
organizations ──< programs ──< services
organizations ──< organization_members
locations ──< languages
locations ──< accessibility_for_disabilities
services ──< saved_services
services ──< verification_evidence
coverage_zones ──< coverage_zones (self-referential parent)
ingestion_sources ──< ingestion_jobs
ingestion_jobs ──< extracted_candidates
extracted_candidates ──< resource_tags
extracted_candidates ──< discovered_links
extracted_candidates ──< candidate_admin_assignments >── admin_review_profiles
extracted_candidates ──< tag_confirmation_queue
extracted_candidates ──< candidate_readiness
```

---

## Data Integrity Rules

1. **No hallucinated data**: All records must have a traceable source (import file, host submission, or manual admin entry).
2. **Phone numbers**: Stored exactly as submitted. Display logic adds formatting. Never generated.
3. **URLs**: Stored as-is. Validated at import but not rewritten.
4. **Geolocation**: Stored at full precision internally; API responses return approximate coordinates (rounded to ~0.01 degree ≈ 1km) unless user explicitly requests precise navigation.
5. **Soft deletes**: Records are marked `status = 'defunct'` rather than hard-deleted to preserve audit history.

---

## Audit Fields (ORAN Convention)

Most mutable tables include:

- `created_at`, `updated_at` (TIMESTAMPTZ)
- `created_by_user_id`, `updated_by_user_id` (TEXT, nullable; pseudonymous identifiers like Entra Object IDs)

These fields support governance workflows without storing PII (see `docs/SECURITY_PRIVACY.md`).
