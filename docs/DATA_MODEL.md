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

### `feature_flags`
Runtime feature toggle configuration.

| Field       | Type        | Description |
|-------------|-------------|-------------|
| id          | UUID PK     | Unique identifier |
| name        | TEXT UNIQUE | Flag identifier (e.g. "llm_summarize") |
| enabled     | BOOLEAN     | Master on/off switch |
| rollout_pct | INT         | Percentage rollout (0–100) |
| created_at  | TIMESTAMPTZ | Creation timestamp |
| updated_at  | TIMESTAMPTZ | Last update timestamp |

---

## Key Relationships

```
organizations ──< locations ──< addresses
organizations ──< services
services ──< service_at_location >── locations
services ──< phones
locations ──< phones
organizations ──< phones
services ──< schedules
locations ──< schedules
services ──< service_taxonomy >── taxonomy_terms
taxonomy_terms ──< taxonomy_terms (self-referential parent)
services ──< confidence_scores
services ──< verification_queue
services ──< seeker_feedback
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
