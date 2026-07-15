/**
 * Provider-neutral telemetry events backed by Sentry.
 *
 * Callers must only pass structural metadata. Search terms, chat text, precise
 * location, contact details, and resource-application content are prohibited.
 */

import {
  addBreadcrumb,
  captureException,
  captureMessage,
  type ErrorContext,
  type SeverityLevel,
} from './sentry';

type Scalar = string | number | boolean | undefined | null;

function compact(values: Record<string, Scalar>): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }),
  );
}

export async function trackException(error: unknown, context?: ErrorContext): Promise<void> {
  await captureException(error, context);
}

export async function trackEvent(
  name: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): Promise<void> {
  await addBreadcrumb({
    message: name,
    category: 'app.event',
    level: 'info',
    data: { ...properties, ...measurements },
  });
}

export async function trackAiEvent(
  name: string,
  payload: Record<string, Scalar>,
): Promise<void> {
  try {
    await addBreadcrumb({
      message: name,
      category: 'ai.event',
      level: 'info',
      data: compact(payload),
    });
  } catch {
    // Telemetry must never affect resource navigation or safety flows.
  }
}

export async function trackMetric(name: string, value: number): Promise<void> {
  await addBreadcrumb({
    message: name,
    category: 'app.metric',
    level: 'info',
    data: { value },
  });
}

export async function trackTrace(
  message: string,
  level: SeverityLevel = 'info',
  properties?: Record<string, string>,
): Promise<void> {
  if (level === 'error' || level === 'fatal') {
    await captureMessage(message, level, { extra: properties });
    return;
  }

  await addBreadcrumb({
    message,
    category: 'app.trace',
    level,
    data: properties,
  });
}

/** Sentry manages delivery; retained as a no-op compatibility hook for callers. */
export async function flush(): Promise<void> {}
