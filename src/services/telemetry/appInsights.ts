/**
 * ORAN Azure Application Insights Telemetry
 *
 * Provides typed wrappers around Azure Monitor for error tracking, metrics,
 * and custom events. Works alongside (or as replacement for) the Sentry wrapper.
 *
 * Initialization happens in src/instrumentation.ts via the `applicationinsights`
 * package (OpenTelemetry-based). This module provides convenience helpers for
 * custom tracking beyond automatic HTTP/dependency collection.
 *
 * Privacy rules: same as sentry.ts — no user PII in events.
 */

import type { ErrorContext, SeverityLevel } from './sentry';

// ============================================================
// APP INSIGHTS WRAPPER
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = undefined; // undefined = not yet tried; null = tried but unavailable

/**
 * Get the default Application Insights TelemetryClient if available.
 * Returns null when App Insights is not configured (e.g., local dev).
 *
 * Uses `undefined` as the "not yet tried" sentinel so the env-var check and
 * dynamic import are executed at most once per process, not on every call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getClient(): Promise<any | null> {
  if (_client !== undefined) return _client;

  if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    _client = null;
    return null;
  }

  try {
    const ai = await import('applicationinsights');
    _client = ai.defaultClient ?? null;
    return _client;
  } catch {
    _client = null;
    return null;
  }
}

/**
 * Map ORAN severity levels to Application Insights severity numbers.
 */
function mapSeverity(level: SeverityLevel): number {
  switch (level) {
    case 'debug':
      return 0; // Verbose
    case 'info':
      return 1; // Information
    case 'warning':
      return 2; // Warning
    case 'error':
      return 3; // Error
    case 'fatal':
      return 4; // Critical
    default:
      return 1;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Track an exception in Application Insights.
 */
export async function trackException(
  error: unknown,
  context?: ErrorContext
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const properties: Record<string, string> = {};

  if (context?.sessionId) properties.sessionId = context.sessionId;
  if (context?.userId) properties.userId = context.userId;
  if (context?.feature) properties.feature = context.feature;

  client.trackException({
    exception: err,
    properties,
    severity: mapSeverity('error'),
  });
}

/**
 * Track a custom event (e.g., "search_performed", "chat_message_sent").
 */
export async function trackEvent(
  name: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  client.trackEvent({ name, properties, measurements });
}

/**
 * Track an AI integration event with mixed property types.
 *
 * Automatically splits the payload into App Insights `properties` (strings) and
 * `measurements` (numbers).  Boolean values are converted to "true"/"false" strings.
 *
 * Always fail-open — telemetry errors must never affect core functionality.
 *
 * Privacy rule: callers MUST NOT include message content, user queries, or any PII.
 * Acceptable fields: duration_ms, token counts, model names, flag states, severity scores.
 *
 * @example
 * await trackAiEvent('llm_summarize', { duration_ms: 420, tokens_used: 87, model: 'gpt-4o-mini', success: true });
 */
export async function trackAiEvent(
  name: string,
  payload: Record<string, string | number | boolean | undefined | null>
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;

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

    client.trackEvent({ name, properties, measurements });
  } catch {
    // Intentionally swallowed — telemetry must never affect core functionality
  }
}

/**
 * Track a custom metric.
 */
export async function trackMetric(
  name: string,
  value: number
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  client.trackMetric({ name, value });
}

/**
 * Track a trace message (structured log).
 */
export async function trackTrace(
  message: string,
  level: SeverityLevel = 'info',
  properties?: Record<string, string>
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  client.trackTrace({
    message,
    severity: mapSeverity(level),
    properties,
  });
}

/**
 * Flush pending telemetry (useful before process exit).
 */
export async function flush(): Promise<void> {
  const client = await getClient();
  if (!client) return;

  return new Promise<void>((resolve) => {
    client.flush({ callback: () => resolve() });
  });
}
