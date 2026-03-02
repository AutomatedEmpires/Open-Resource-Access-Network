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
let _client: any = null;

/**
 * Get the default Application Insights TelemetryClient if available.
 * Returns null when App Insights is not configured (e.g., local dev).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getClient(): Promise<any | null> {
  if (_client !== undefined && _client !== null) return _client;

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
