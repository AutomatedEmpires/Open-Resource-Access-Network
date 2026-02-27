# ORAN Security & Privacy

---

## Authentication Model

ORAN uses **Clerk** for identity management. All API routes that write data require a valid Clerk session token.

### Session Validation
- All protected API routes call `auth()` from `@clerk/nextjs/server`
- Unauthenticated requests to protected routes return HTTP 401
- Role checks return HTTP 403 for insufficient permissions
- JWT tokens are short-lived (1 hour) with automatic refresh

### Role Enforcement
- Roles stored in Clerk `publicMetadata.role`
- Middleware (`src/middleware.ts`) enforces route-level access
- API handlers enforce resource-level permissions
- Defense in depth: both middleware AND API handler check roles

---

## Data Classification

| Classification | Examples | Handling |
|----------------|----------|----------|
| Public         | Service names, addresses, phone numbers, hours | Served to all; cached at CDN |
| Internal       | Confidence scores, verification notes | Authenticated users only |
| Sensitive      | Seeker profiles, chat history, feedback | Owner-only access; encrypted at rest |
| Restricted     | Audit logs, IP addresses, admin actions | oran_admin only; 90-day retention |

---

## PII Handling

### What ORAN Stores
- Clerk User ID (pseudonymous identifier, not PII by itself)
- Approximate location preference (city/county level, not precise coordinates)
- Service category preferences
- Feedback ratings (no identifying info required)

### What ORAN Does NOT Store
- Full name (managed by Clerk)
- Email address in ORAN DB (managed by Clerk)
- Precise GPS coordinates of seekers
- Chat message content beyond session metadata
- Sensitive inferences (health conditions, immigration status, etc.)

### Prohibited Inferences
ORAN explicitly prohibits:
- Inferring immigration status from service queries
- Inferring health conditions from service categories
- Profiling users based on chat history
- Selling or sharing seeker data with service providers

---

## Consent Flows

### Location Consent
- Approximate location (city/ZIP level) shown to user before use
- User must explicitly grant or deny location sharing
- IP-based geolocation: city-level only, never stored
- Precise GPS coordinates: never requested

### Profile Save Consent
- Profile saving is **opt-in**, not default
- Consent toggle clearly labeled: "Save my preferences to improve future results"
- User can delete saved profile at any time via `/profile` → "Delete My Data"

### Cookie Consent
- Session cookies: required for functionality, no consent prompt needed
- Analytics cookies: require explicit consent
- No third-party tracking cookies

---

## Approximate Location

**Core privacy principle**: ORAN uses approximate location only.

| Source          | Precision Used | Notes |
|-----------------|---------------|-------|
| IP geolocation  | City-level     | Used as default if user consents |
| User-entered ZIP| ZIP code area  | Centroid of ZIP for queries |
| User-entered city| City centroid | Used for queries |
| Browser GPS     | Never requested| Not used in current implementation |
| Saved preference| City/county    | Stored as city name, not coordinates |

API responses round coordinates to ~0.01 degree precision (~1km) even when internal storage is precise.

---

## Audit Logging

All write operations are logged with:
- `user_id` (Clerk ID)
- `action` (create/update/delete/verify/reject)
- `resource_type` (organization/service/location/etc.)
- `resource_id`
- `before_state` (JSON snapshot)
- `after_state` (JSON snapshot)
- `ip_address` (hashed)
- `timestamp`

Audit logs are:
- Write-once (append only)
- Retained for 2 years
- Accessible to oran_admin only

---

## Rate Limiting

| Endpoint          | Limit              | Window |
|-------------------|--------------------|--------|
| POST /api/chat    | 20 requests        | 1 min  |
| GET /api/search   | 60 requests        | 1 min  |
| POST /api/feedback| 10 requests        | 1 min  |
| POST /api/claim   | 3 requests         | 1 hour |
| All other APIs    | 100 requests       | 1 min  |

Rate limiting is implemented per IP + per authenticated user ID (whichever is more restrictive).

---

## OWASP Notes

### Injection Prevention
- All DB queries use parameterized queries via Drizzle ORM or `pg` parameterized statements
- No string concatenation in SQL queries
- Input sanitized via Zod validation before processing

### Authentication & Authorization
- All write endpoints require valid Clerk JWT
- CSRF protection via Clerk's built-in mechanisms
- No session tokens in URLs

### Sensitive Data Exposure
- All API responses exclude internal scoring detail from seeker-facing endpoints
- Database connection strings never in client-side code
- Environment variables validated at startup

### Security Headers
Configured in `next.config.ts`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy`: restrictive policy (configured per environment)

### Dependency Management
- Automated security scanning via `npm audit` in CI
- Dependabot alerts enabled on repository
- No direct use of `eval()` or `Function()` constructor

---

## Incident Response

1. **Detection**: Sentry alert or user report
2. **Triage**: oran_admin reviews audit log
3. **Containment**: Disable affected feature flag immediately
4. **Assessment**: Determine scope of data affected
5. **Notification**: Users notified within 72 hours if PII involved
6. **Remediation**: Fix deployed, post-mortem documented
