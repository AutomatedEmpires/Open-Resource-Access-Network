/**
 * Next.js Instrumentation Hook
 *
 * Initializes server-side error/trace telemetry on startup. ORAN's observability
 * is aligned with the Automated Empires portfolio stack: Sentry for errors and
 * traces (PostHog handles product analytics on the client).
 *
 * Sentry is an OPTIONAL, code-ready integration. This hook never imports an
 * uninstalled package, so it is safe in every runtime (including Edge) and never
 * breaks the build. When `@sentry/nextjs` is installed and NEXT_PUBLIC_SENTRY_DSN
 * is set, the Sentry setup wizard's generated `sentry.server.config` initialises
 * the SDK here; until then this hook simply reports telemetry status.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  // Only run on the server (Node.js runtime), not in Edge or browser.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log('[instrumentation] NEXT_PUBLIC_SENTRY_DSN not set — telemetry disabled.');
    return;
  }

  console.log('[instrumentation] Sentry DSN present — install @sentry/nextjs to activate server telemetry.');
}
