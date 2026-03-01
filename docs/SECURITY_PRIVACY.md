# ORAN Security & Privacy

---

## Implementation Status (Truth Contract)

This document includes both **Implemented** and **Planned** controls. When this file conflicts with executable behavior, follow docs/SSOT.md.

Implemented today:
- Zod validation exists at API boundaries for current endpoints.
- Chat pipeline includes quota/rate limiting logic.
- Protected route authentication gating exists in middleware when Clerk is configured (roles are still planned).
- DB schema exists in db/migrations/** (including feature_flags and verification_queue).

Planned / not yet enforced end-to-end:
- RBAC beyond “authenticated vs unauthenticated”.
- Comprehensive audit logging with before/after snapshots.
- Uniform per-endpoint rate limiting across all APIs (currently implemented for `/api/chat`, `/api/search`, `/api/feedback`).
- A restrictive Content-Security-Policy (CSP) rolled out safely.

## Authentication Model

ORAN can use **Clerk** for identity management when configured. Some environments may run without Clerk enabled.

### Session Validation
- Implemented: protected UI routes are gated by middleware when Clerk is configured.
- Implemented: in production, protected routes fail closed if auth is misconfigured or temporarily unavailable.
- Planned: protected API routes call `auth()` from `@clerk/nextjs/server`.
- Planned: unauthenticated requests return HTTP 401.
- Planned: role checks return HTTP 403 for insufficient permissions.

### Role Enforcement
- Planned: roles stored in Clerk `publicMetadata.role`.
- Implemented: middleware enforces authentication for protected routes.
- Planned: middleware enforces role-based route-level access.
- Planned: API handlers enforce resource-level permissions.

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

Status: Planned (not yet enforced uniformly in API responses).

---

## Audit Logging

Status: Planned.

Design intent (not yet implemented end-to-end):
- Log write operations with user identifier, action, resource identifiers, and timestamps.
- Avoid storing raw IP addresses; if needed, store a privacy-preserving digest.

---

## Rate Limiting

Status: Partially implemented.

- Implemented: basic in-memory rate limiting on:
	- POST /api/chat
	- GET /api/search
	- POST /api/feedback
- Planned: consistent per-endpoint limits across all APIs, plus a shared backing store (Redis) for multi-instance deployments.

---

## OWASP Notes

### Injection Prevention
- Implemented: input validation via Zod before processing.
- Planned: end-to-end DB execution wiring with consistent parameterization guarantees.

### Authentication & Authorization
- Planned: write endpoints require valid Clerk JWT.
- Planned: CSRF protection considerations per endpoint.

### Sensitive Data Exposure
- All API responses exclude internal scoring detail from seeker-facing endpoints
- Database connection strings never in client-side code
- Environment variables validated at startup

### Security Headers
Configured in `next.config.ts`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: disables camera/mic/geolocation and other sensitive capabilities by default

Planned:
- `Content-Security-Policy` rollout (careful to avoid breaking Next.js assets).

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
