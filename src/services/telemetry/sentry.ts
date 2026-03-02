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
  userId?: string; // Entra object ID (pseudonymous — not PII)
  feature?: string;
  extra?: Record<string, unknown>;
}

export interface BreadcrumbEntry {
  message: string;
  category?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === 'string' && error.name.trim()) {
    return error.name.trim().slice(0, 120);
  }
  if (typeof error === 'string' && error.trim()) {
    return 'StringError';
  }
  if (error && typeof error === 'object') {
    return (error as { name?: unknown }).name && typeof (error as { name?: unknown }).name === 'string'
      ? ((error as { name: string }).name.trim().slice(0, 120) || 'UnknownError')
      : 'UnknownError';
  }
  return 'UnknownError';
}

function redactIfSensitiveString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Very small heuristic redaction to prevent obvious PII from landing in telemetry.
  // Prefer dropping/redacting over fidelity.
  const looksLikeEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed);
  const looksLikePhone = /\+?\d[\d\s().-]{7,}\d/.test(trimmed);
  if (looksLikeEmail || looksLikePhone) return '[redacted]';
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function sanitizeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extra)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('message') ||
      lowerKey.includes('comment') ||
      lowerKey.includes('body') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token')
    ) {
      continue;
    }

    if (value === null) {
      sanitized[key] = null;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const redacted = redactIfSensitiveString(value);
      if (redacted) sanitized[key] = redacted;
      continue;
    }

    // Drop objects/arrays/functions to avoid accidentally serializing user input.
  }

  return sanitized;
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
    console.error('[Sentry] captureException', {
      errorName: getErrorName(error),
      sessionId: context?.sessionId,
      userId: context?.userId,
      feature: context?.feature,
      // Do not log the raw error or context.extra; they may contain PII.
    });
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
      const safeExtra = sanitizeExtra(context.extra);
      for (const [key, value] of Object.entries(safeExtra)) {
        scope.setExtra(key, value);
      }
    }

    // Privacy-first: avoid sending raw error messages/stacks that could include user-provided content.
    // Capture a sanitized error with a safe name only.
    const sanitizedError = new Error(getErrorName(error));
    sanitizedError.name = getErrorName(error);
    sentry.captureException(sanitizedError);
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
  const safeMessage = redactIfSensitiveString(message);
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Sentry] captureMessage [${level}]:`, safeMessage, {
      sessionId: context?.sessionId,
      feature: context?.feature,
      // Do not log context.extra in development; it can accidentally contain PII.
    });
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
    sentry.captureMessage(safeMessage, level);
  });
}

/**
 * Add a breadcrumb for context in error reports.
 */
export async function addBreadcrumb(entry: BreadcrumbEntry): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    message: redactIfSensitiveString(entry.message),
    category: entry.category,
    level: entry.level,
    data: entry.data ? sanitizeExtra(entry.data) : undefined,
  });
}
