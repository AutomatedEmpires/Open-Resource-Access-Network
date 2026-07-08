/**
 * ORAN Telemetry Events Facade
 *
 * Portfolio-standard, provider-neutral event/metric/trace helpers backed by the
 * Sentry wrapper (see ./sentry). Replaces the former Azure Application Insights
 * adapter — ORAN's observability now aligns with the rest of the Automated
 * Empires stack (Sentry for errors/traces, PostHog for product analytics).
 *
 * Design rules (unchanged from the previous adapter — this is a drop-in):
 * - Same public surface: trackException / trackEvent / trackAiEvent /
 *   trackMetric / trackTrace / flush.
 * - ALWAYS fail-open: telemetry must never affect core functionality.
 * - Privacy-first: callers MUST NOT pass message content, user queries, search
 *   terms, or any PII. Acceptable fields are structural metadata only
 *   (duration_ms, token counts, model names, flag states, severity scores).
 *
 * When NEXT_PUBLIC_SENTRY_DSN is unset (and/or @sentry/nextjs is not installed)
 * every function degrades to a no-op (plus a dev-only console line), exactly
 * like the previous adapter did when APPLICATIONINSIGHTS_CONNECTION_STRING was
 * absent.
 */

import {
  addBreadcrumb,
  captureException as sentryCaptureException,
  captureMessage,
  type ErrorContext,
  type SeverityLevel,
} from './sentry';

export type { ErrorContext, SeverityLevel } from './sentry';

// ============================================================
// EXCEPTIONS
// ============================================================

/**
 * Track an exception. Routes to Sentry with PII-safe context.
 */
export async function trackException(
  error: unknown,
  context?: ErrorContext,
): Promise<void> {
  try {
    await sentryCaptureException(error, context);
  } catch {
    // Fail-open — telemetry must never affect core functionality.
  }
}

// ============================================================
// STRUCTURED EVENTS
// ============================================================

/**
 * Track a custom event (e.g., "search_performed", "chat_message_sent").
 *
 * Recorded as a Sentry breadcrumb so it attaches context to the next error
 * event without issuing a standalone network request. `measurements` are merged
 * into the breadcrumb data.
 */
export async function trackEvent(
  name: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): Promise<void> {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[telemetry] event', name, { properties, measurements });
    }
    await addBreadcrumb({
      message: name,
      category: 'event',
      level: 'info',
      data: { ...(properties ?? {}), ...(measurements ?? {}) },
    });
  } catch {
    // Fail-open.
  }
}

/**
 * Track an AI integration event with mixed property types.
 *
 * Splits the payload into string `properties` and numeric `measurements`
 * (booleans become "true"/"false"); null/undefined are dropped. Always
 * fail-open.
 *
 * Privacy rule: callers MUST NOT include message content, user queries, or any
 * PII. Acceptable fields: duration_ms, token counts, model names, flag states,
 * severity scores.
 *
 * @example
 * await trackAiEvent('llm_summarize', { duration_ms: 420, tokens_used: 87, model: 'gpt-4o-mini', success: true });
 */
export async function trackAiEvent(
  name: string,
  payload: Record<string, string | number | boolean | undefined | null>,
): Promise<void> {
  try {
    const properties: Record<string, string> = {};
    const measurements: Record<string, number> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'number') {
        measurements[key] = value;
      } else if (typeof value === 'boolean') {
        properties[key] = value ? 'true' : 'false';
      } else {
        properties[key] = String(value);
      }
    }

    await trackEvent(name, properties, measurements);
  } catch {
    // Intentionally swallowed — telemetry must never affect core functionality.
  }
}

// ============================================================
// METRICS + TRACES
// ============================================================

/**
 * Track a custom numeric metric.
 */
export async function trackMetric(name: string, value: number): Promise<void> {
  try {
    await addBreadcrumb({
      message: name,
      category: 'metric',
      level: 'info',
      data: { value },
    });
  } catch {
    // Fail-open.
  }
}

/**
 * Track a trace message (structured log breadcrumb).
 *
 * `warning`/`error`/`fatal` levels are additionally forwarded to Sentry as a
 * captured message so they surface as issues; `info`/`debug` stay breadcrumbs.
 */
export async function trackTrace(
  message: string,
  level: SeverityLevel = 'info',
  properties?: Record<string, string>,
): Promise<void> {
  try {
    if (level === 'warning' || level === 'error' || level === 'fatal') {
      await captureMessage(message, level, properties ? { extra: properties } : undefined);
      return;
    }
    await addBreadcrumb({
      message,
      category: 'trace',
      level,
      data: properties,
    });
  } catch {
    // Fail-open.
  }
}

/**
 * Flush pending telemetry. Sentry's transport auto-flushes; this is retained
 * for API compatibility and to allow an explicit flush before process exit.
 */
export async function flush(): Promise<void> {
  try {
    const injected = (globalThis as { __ORAN_SENTRY__?: { flush?: (t?: number) => Promise<boolean> } }).__ORAN_SENTRY__;
    if (injected?.flush) {
      await injected.flush(2_000);
    }
  } catch {
    // Fail-open.
  }
}
