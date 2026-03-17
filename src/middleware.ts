/**
 * Next.js Middleware — defense-in-depth auth layer.
 *
 * Delegates to src/proxy.ts which implements:
 *  - Route-level role gating (seeker, host_member, community_admin, oran_admin)
 *  - CSRF protection for state-changing API writes
 *  - Fail-closed auth in production
 *
 * This file re-exports the proxy as the default middleware export,
 * which Next.js discovers at src/middleware.ts.
 */

export { proxy as middleware, config } from './proxy';
