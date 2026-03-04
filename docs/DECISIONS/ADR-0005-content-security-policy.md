# ADR-0005 — Content Security Policy (CSP)

**Status**: Accepted
**Date**: 2026-03-03T01:00:00Z
**Author**: Agent SIGMA

## Context

ORAN had no Content-Security-Policy header. Without CSP, the application is exposed
to cross-site scripting (XSS) and data injection attacks. The OWASP Top 10 recommends
a restrictive CSP as a defense-in-depth layer.

## Decision

Apply a baseline restrictive CSP via `next.config.mjs` `headers()`. The policy:

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Restrict all resource loading to same origin by default |
| `script-src` | `'self' 'unsafe-inline'` (prod) / `+ 'unsafe-eval'` (dev) | Next.js requires `unsafe-inline` for inline scripts; `unsafe-eval` only in dev for HMR |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind CSS injects styles that require `unsafe-inline` |
| `img-src` | `'self' data: https: blob:` | Azure Maps tiles, data URI icons, HTTPS images |
| `connect-src` | `'self'` + Azure Maps, Azure AD, App Insights, Sentry domains | Necessary API and telemetry connections |
| `font-src` | `'self'` | Only self-hosted fonts |
| `object-src` | `'none'` | Block all plugins (Flash, Java, etc.) |
| `frame-ancestors` | `'none'` | Prevent framing (augments X-Frame-Options: DENY) |
| `base-uri` | `'self'` | Prevent `<base>` tag hijacking |
| `form-action` | `'self'` | Restrict form submissions to same origin |
| `upgrade-insecure-requests` | (present) | Force HTTPS for all sub-resource loads |

### `unsafe-inline` justification

- **`script-src 'unsafe-inline'`**: Next.js generates inline `<script>` tags for page
  data (e.g., `__NEXT_DATA__`). Nonce-based CSP requires custom Next.js middleware
  integration (`@next/csp`), which is planned as a follow-up but not available today.
  Risk is mitigated by `default-src 'self'` preventing external script loading.

- **`style-src 'unsafe-inline'`**: Tailwind CSS compiles to a single `<style>` block
  injected in the `<head>`. Removing `unsafe-inline` would require extracting all
  styles to external files, which conflicts with Tailwind's design.

## Consequences

- All pages now receive a CSP header, reducing XSS attack surface.
- External scripts/styles not allowlisted will be blocked.
- `unsafe-inline` for scripts is a known limitation; nonce-based CSP is future work.
- If new external services are added (e.g., analytics, CDN fonts), their domains must
  be added to the appropriate CSP directive.

## Alternatives Considered

1. **Nonce-based CSP** (`script-src 'nonce-...'`): More secure, eliminates
   `unsafe-inline`. Requires runtime nonce generation per request and Next.js
   integration. Deferred to a follow-up ADR due to complexity.
2. **Meta tag CSP**: Weaker than header-based CSP; does not support `frame-ancestors`
   or `report-uri`. Rejected.
3. **No CSP**: Rejected — unacceptable for a safety-critical platform.

## Verification

- Inspect response headers for `Content-Security-Policy` in production.
- Verify pages load correctly (no CSP violations in browser console).
- Run Lighthouse security audit to confirm CSP presence.
