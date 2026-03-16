# ORAN Security & Privacy

---

## Implementation Status (Truth Contract)

This document includes both **Implemented** and **Planned** controls. When this file conflicts with executable behavior, follow docs/SSOT.md.

Implemented today:

- Zod validation at API boundaries for all endpoints (all 34+ API routes).
- Chat pipeline includes crisis-first gate (before quota and rate limiting), quota/rate limiting logic.
- Chat requests are capped at 20 messages per 24-hour identity/device window, with an additional matching session-scoped cap for local resilience.
- Rate limiting on all API routes, including auth endpoints, with `Retry-After` headers on 429 responses.
- Same-origin protection for authenticated, cookie-based write APIs enforced centrally in `src/proxy.ts` for `/api/profile`, `/api/saved`, `/api/user/**`, `/api/host/**`, `/api/community/**`, `/api/admin/**`, `/api/templates/**`, and `/api/submissions/appeal`.
- Protected route authentication gating via middleware (JWT extraction + role enforcement via `isRoleAtLeast()`).
- All protected API routes enforce auth server-side via `getAuthContext()` + role guards.
- Host API routes fail-closed in production—return 401 even if Entra ID is not configured.
- Content Security Policy (CSP) header applied sitewide via `next.config.mjs` (see ADR-0005).
- No CORS wildcard (`Access-Control-Allow-Origin: *`) on any route—default same-origin policy.
- Feature flags with typed constants, fail-closed semantics (unknown flag → off).
- PII redaction in Sentry/telemetry—verified by automated tests.
- Redis-backed shared rate limiting is available for high-value endpoints when `REDIS_URL` is configured, with in-memory fallback retained for local/test resilience.
- DB schema exists in db/migrations/** (including feature flags, submissions/workflow tables, and the legacy `verification_queue` compatibility view).

Planned / not yet enforced end-to-end:

- Comprehensive audit logging with before/after snapshots.
- Nonce-based CSP to replace `script-src 'unsafe-inline'` (see ADR-0005).

## Authentication Model

ORAN uses **Microsoft Entra ID** for identity management via NextAuth.js with the Azure AD provider.

Optional providers:

- Apple OAuth is supported only when `ORAN_ENABLE_APPLE_AUTH=1` is set alongside valid Apple client credentials.
- Google OAuth is supported only when explicitly enabled with `ORAN_ENABLE_GOOGLE_AUTH=1` and matching Google client credentials.
- Credentials auth accepts email, username, or phone number plus password. It is available in local or test environments and is disabled in production unless `ORAN_ENABLE_CREDENTIALS_AUTH=1` is set deliberately.
- Credentials auth may coexist with Microsoft Entra on the same account when an existing profile also carries a password hash; this does not introduce SMS/OTP or phone-based MFA.
- Phone sign-in currently means password-based identifier login against a stored phone number. SMS/OTP phone auth is not implemented.

### Session Validation

- Implemented: protected UI routes are gated by middleware when Entra is configured (`AZURE_AD_CLIENT_ID`).
- Implemented: in production, protected routes fail closed if auth is misconfigured or temporarily unavailable (middleware returns 503; API routes return 401).
- Implemented: protected API routes validate NextAuth.js session server-side via `getAuthContext()`.
- Implemented: unauthenticated requests to protected routes return HTTP 401.
- Implemented: role checks return HTTP 403 for insufficient permissions.
- Implemented: optional non-Entra providers fail closed in production unless explicitly enabled.
- Implemented: first successful non-credentials OAuth sign-in upserts a `user_profiles` row so role/profile hydration remains stable across providers.

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

### What ORAN Does NOT Store (current implementation)

- Full name (managed by Entra ID)
- Email address in ORAN DB (managed by Entra ID)
- Precise GPS coordinates of seekers (see Approximate Location section)
- Chat message content beyond session metadata
- Sensitive inferences (health conditions, immigration status, etc.)

> Note: This reflects current technical implementation. Data collection and retention
> practices may expand as the platform evolves. Any changes will be reflected in the
> published Privacy Policy.

### Prohibited Inferences

ORAN explicitly prohibits:

- Inferring immigration status from service queries
- Inferring health conditions from service categories
- Profiling users based on chat history
- Disclosing seeker data to third parties without a lawful basis or explicit user consent

---

## Consent Flows

### Location Consent

- Approximate location (city/ZIP level) shown to user before use
- User must explicitly grant or deny location sharing
- IP-based geolocation: city-level only, never stored
- Device geolocation: requested only on explicit user action, used in-session only, never stored

### Profile Save Consent

- Profile saving is **opt-in**, not default
- Consent toggle clearly labeled: "Save my preferences to improve future results"
- Signed-in users remain local-only until they explicitly enable cross-device sync
- Enabling sync performs a best-effort save of current city, locale, and seeker profile context to the authenticated account
- Disabling sync stops future `/api/profile` writes from the current device without silently deleting existing account data
- Saved-service bookmarks follow the same device consent boundary: local by default, optional `/api/saved` sync only after cross-device sync is enabled
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
| Browser geolocation | Rounded (~0.01° ≈ 1km) | Opt-in only (explicit user action); used to center the map/search; never stored |
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
  - GET/POST /api/admin/scopes (platform scope management)
  - GET/POST /api/admin/scopes/grants (scope grant requests)
  - GET/PUT/DELETE /api/admin/scopes/grants/[id] (grant decisions)
  - GET /api/user/scopes (user scope listing)
  - GET /api/user/notifications (notification listing)
  - PUT /api/user/notifications/[id]/read (mark read)
  - PUT /api/user/notifications/read-all (mark all read)
  - GET/PUT /api/user/notifications/preferences (notification preferences)
  - GET/POST /api/admin/appeals (appeal review queue + decisions)
  - POST/GET /api/submissions/appeal (submit appeal + list own appeals)
  - POST/GET /api/submissions/report (listing reports; POST allows anonymous, GET requires auth)
- Implemented: all 429 responses include `Retry-After` header with seconds until window reset.
- Planned: Redis-backed rate limiting for multi-instance deployments.
- Implemented: authenticated privacy endpoints (`/api/user/data-export`, `/api/user/data-delete`) rate-limit by authenticated user context instead of shared IP alone.

---

## OWASP Notes

### Injection Prevention

- Implemented: input validation via Zod before processing.
- Planned: end-to-end DB execution wiring with consistent parameterization guarantees.

### Authentication & Authorization

- Implemented: write endpoints require valid Entra ID / NextAuth.js session via `getAuthContext()`.
- Implemented: role-based access control via `isRoleAtLeast()`, `requireMinRole()`, `requireOrgRole()`.
- Implemented: scope-based access control via `platform_scopes`, `user_scope_grants`, and two-person approval workflow.
- Implemented: same-origin write enforcement for authenticated cookie-based APIs; cross-site state-changing requests are rejected before route handlers execute.
- Implemented: error boundary hierarchy — root `global-error.tsx`, app-level `error.tsx`, per-route-group boundaries (`(seeker)`, `(host)`, `(community-admin)`, `(oran-admin)`), and custom `not-found.tsx`.
- Planned: extend same-origin/CSRF-style protection to any future authenticated write routes that fall outside the current protected prefixes.

### Sensitive Data Exposure

- All API responses exclude internal scoring detail from seeker-facing endpoints
- Database connection strings never in client-side code
- Environment variables validated at startup
- Azure Maps shared subscription keys are not returned to the browser; interactive map auth uses a scoped server-brokered token.

### Security Headers

Configured in `next.config.mjs`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HSTS — enforces HTTPS for 2 years with preload eligibility)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: disables camera/mic and other sensitive capabilities by default; allows geolocation for same-origin consent-based flows

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
