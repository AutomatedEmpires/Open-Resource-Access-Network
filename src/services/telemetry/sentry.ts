/**
 * ORAN Sentry Telemetry Wrapper
 *
 * Provides typed wrappers around Sentry for error tracking and monitoring.
 * Privacy rules: no user PII in events; sessionId (UUID) allowed as correlation ID.
 */

// ============================================================
// TYPES
// ============================================================

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface ErrorContext {
  sessionId?: string;
  userId?: string; // Clerk user ID (pseudonymous — not PII)
  feature?: string;
  extra?: Record<string, unknown>;
}

export interface BreadcrumbEntry {
  message: string;
  category?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
}

// ============================================================
// SENTRY WRAPPER
// ============================================================

/**
 * Lazy Sentry loader — only imports Sentry if DSN is configured.
 * This prevents build failures when NEXT_PUBLIC_SENTRY_DSN is not set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSentry(): Promise<any | null> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = await import('@sentry/nextjs' as any);
    return Sentry;
  } catch {
    return null;
  }
}

/**
 * Report an exception to Sentry.
 * No PII should be included in the context.
 */
export async function captureException(
  error: unknown,
  context?: ErrorContext
): Promise<void> {
  // Always log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[Sentry] captureException:', error, context);
  }

  const sentry = await getSentry();
  if (!sentry) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sentry.withScope((scope: any) => {
    if (context?.sessionId) {
      scope.setTag('sessionId', context.sessionId);
    }
    if (context?.userId) {
      scope.setUser({ id: context.userId });
    }
    if (context?.feature) {
      scope.setTag('feature', context.feature);
    }
    if (context?.extra) {
      for (const [key, value] of Object.entries(context.extra)) {
        scope.setExtra(key, value);
      }
    }
    sentry.captureException(error);
  });
}

/**
 * Report a message to Sentry.
 */
export async function captureMessage(
  message: string,
  level: SeverityLevel = 'info',
  context?: ErrorContext
): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Sentry] captureMessage [${level}]:`, message, context);
  }

  const sentry = await getSentry();
  if (!sentry) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sentry.withScope((scope: any) => {
    if (context?.sessionId) {
      scope.setTag('sessionId', context.sessionId);
    }
    if (context?.feature) {
      scope.setTag('feature', context.feature);
    }
    sentry.captureMessage(message, level);
  });
}

/**
 * Add a breadcrumb for context in error reports.
 */
export async function addBreadcrumb(entry: BreadcrumbEntry): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    message: entry.message,
    category: entry.category,
    level: entry.level,
    data: entry.data,
  });
}
