# ORAN Security & Privacy

---

## Implementation Status (Truth Contract)

This document includes both **Implemented** and **Planned** controls. When this file conflicts with executable behavior, follow docs/SSOT.md.

Implemented today:
- Zod validation at API boundaries for all endpoints (all 25 API routes).
- Chat pipeline includes crisis-first gate (before quota and rate limiting), quota/rate limiting logic.
- Rate limiting on all API routes, including auth endpoints, with `Retry-After` headers on 429 responses.
- Protected route authentication gating via middleware (JWT extraction + role enforcement via `isRoleAtLeast()`).
- All protected API routes enforce auth server-side via `getAuthContext()` + role guards.
- Host API routes fail-closed in production—return 401 even if Entra ID is not configured.
- Content Security Policy (CSP) header applied sitewide via `next.config.mjs` (see ADR-0005).
- No CORS wildcard (`Access-Control-Allow-Origin: *`) on any route—default same-origin policy.
- Feature flags with typed constants, fail-closed semantics (unknown flag → off).
- PII redaction in Sentry/telemetry—verified by automated tests.
- DB schema exists in db/migrations/** (including feature_flags and verification_queue).

Planned / not yet enforced end-to-end:
- Comprehensive audit logging with before/after snapshots.
- Nonce-based CSP to replace `script-src 'unsafe-inline'` (see ADR-0005).
- Redis-backed rate limiting for multi-instance deployments.

## Authentication Model

ORAN uses **Microsoft Entra ID** for identity management via NextAuth.js with the Azure AD provider. Some environments may run without Entra configured.

### Session Validation
- Implemented: protected UI routes are gated by middleware when Entra is configured (`AZURE_AD_CLIENT_ID`).
- Implemented: in production, protected routes fail closed if auth is misconfigured or temporarily unavailable (middleware returns 503; API routes return 401).
- Implemented: protected API routes validate NextAuth.js session server-side via `getAuthContext()`.
- Implemented: unauthenticated requests to protected routes return HTTP 401.
- Implemented: role checks return HTTP 403 for insufficient permissions.

### Role Enforcement
- Implemented: middleware extracts JWT via `getToken()` and enforces role-based route-level access via `isRoleAtLeast()`.
- Implemented: API handlers enforce resource-level permissions via `requireMinRole()`, `requireOrgAccess()`, `requireOrgRole()`.
- Planned: roles provisioned as Entra ID app roles (currently derived from org memberships).

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
- Entra Object ID (pseudonymous identifier, not PII by itself)
- Approximate location preference (city/county level, not precise coordinates)
- Service category preferences
- Feedback ratings (no identifying info required)

### What ORAN Does NOT Store
- Full name (managed by Entra ID)
- Email address in ORAN DB (managed by Entra ID)
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

Status: Planned (not yet enforced uniformly in API responses).

---

## Audit Logging

Status: Planned.

Design intent (not yet implemented end-to-end):
- Log write operations with user identifier, action, resource identifiers, and timestamps.
- Avoid storing raw IP addresses; if needed, store a privacy-preserving digest.

---

## Rate Limiting

Status: Implemented.

- Implemented: in-memory sliding-window rate limiting on all API routes, including:
	- POST /api/chat (via orchestrator, after crisis+quota)
	- GET /api/search
	- POST /api/feedback
	- GET /api/services
	- GET /api/maps/token
	- GET/PUT /api/profile
	- GET/POST/DELETE /api/saved
	- GET/POST /api/auth/[...nextauth]
	- All /api/admin/** routes
	- All /api/community/** routes
	- All /api/host/** routes
- Implemented: all 429 responses include `Retry-After` header with seconds until window reset.
- Planned: Redis-backed rate limiting for multi-instance deployments.

---

## OWASP Notes

### Injection Prevention
- Implemented: input validation via Zod before processing.
- Planned: end-to-end DB execution wiring with consistent parameterization guarantees.

### Authentication & Authorization
- Implemented: write endpoints require valid Entra ID / NextAuth.js session via `getAuthContext()`.
- Implemented: role-based access control via `isRoleAtLeast()`, `requireMinRole()`, `requireOrgRole()`.
- Planned: CSRF protection considerations per endpoint.

### Sensitive Data Exposure
- All API responses exclude internal scoring detail from seeker-facing endpoints
- Database connection strings never in client-side code
- Environment variables validated at startup

### Security Headers
Configured in `next.config.mjs`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: disables camera/mic/geolocation and other sensitive capabilities by default

Planned:
- Nonce-based `Content-Security-Policy` (see ADR-0005 for current baseline CSP).

Implemented:
- `Content-Security-Policy` with restrictive baseline (see ADR-0005 and `next.config.mjs`).

### Dependency Management
- Planned: automated security scanning (`npm audit`) in CI.
- Planned: Dependabot alerts (repository setting).

---

## Incident Response

1. **Detection**: Sentry alert or user report
2. **Triage**: oran_admin reviews audit log
3. **Containment**: Disable affected feature flag immediately
4. **Assessment**: Determine scope of data affected
5. **Notification**: Users notified within 72 hours if PII involved
6. **Remediation**: Fix deployed, post-mortem documented
