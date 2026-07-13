import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetry = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('../sentry', () => telemetry);

import {
  flush,
  trackAiEvent,
  trackEvent,
  trackException,
  trackMetric,
  trackTrace,
} from '../events';

beforeEach(() => {
  vi.clearAllMocks();
  telemetry.addBreadcrumb.mockResolvedValue(undefined);
  telemetry.captureException.mockResolvedValue(undefined);
  telemetry.captureMessage.mockResolvedValue(undefined);
});

describe('provider-neutral telemetry events', () => {
  it('routes exceptions through the privacy-safe Sentry wrapper', async () => {
    const error = new Error('boom');
    const context = { feature: 'search', sessionId: 'session-1' };

    await trackException(error, context);

    expect(telemetry.captureException).toHaveBeenCalledWith(error, context);
  });

  it('records structural events and metrics as breadcrumbs', async () => {
    await trackEvent('search_completed', { result_tier: 'verified' }, { count: 2 });
    await trackMetric('latency_ms', 125);

    expect(telemetry.addBreadcrumb).toHaveBeenNthCalledWith(1, {
      message: 'search_completed',
      category: 'app.event',
      level: 'info',
      data: { result_tier: 'verified', count: 2 },
    });
    expect(telemetry.addBreadcrumb).toHaveBeenNthCalledWith(2, {
      message: 'latency_ms',
      category: 'app.metric',
      level: 'info',
      data: { value: 125 },
    });
  });

  it('drops nullish AI fields and keeps telemetry failures fail-open', async () => {
    await trackAiEvent('llm_summary', {
      duration_ms: 300,
      success: true,
      model: 'model-a',
      omitted: undefined,
      empty: null,
    });

    expect(telemetry.addBreadcrumb).toHaveBeenCalledWith({
      message: 'llm_summary',
      category: 'ai.event',
      level: 'info',
      data: { duration_ms: 300, success: true, model: 'model-a' },
    });

    telemetry.addBreadcrumb.mockRejectedValueOnce(new Error('Sentry unavailable'));
    await expect(trackAiEvent('llm_summary', { success: false })).resolves.toBeUndefined();
  });

  it('captures error traces and breadcrumbs lower-severity traces', async () => {
    await trackTrace('operation failed', 'error', { feature: 'ingestion' });
    await trackTrace('operation started', 'debug', { feature: 'ingestion' });

    expect(telemetry.captureMessage).toHaveBeenCalledWith('operation failed', 'error', {
      extra: { feature: 'ingestion' },
    });
    expect(telemetry.addBreadcrumb).toHaveBeenCalledWith({
      message: 'operation started',
      category: 'app.trace',
      level: 'debug',
      data: { feature: 'ingestion' },
    });
  });

  it('retains a no-op flush hook for existing shutdown callers', async () => {
    await expect(flush()).resolves.toBeUndefined();
  });
});
