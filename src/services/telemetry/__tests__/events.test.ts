import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException, captureMessage } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(async () => {}),
  captureException: vi.fn(async () => {}),
  captureMessage: vi.fn(async () => {}),
}));

vi.mock('../sentry', () => ({
  addBreadcrumb,
  captureException,
  captureMessage,
}));

async function loadEvents() {
  return import('../events');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  delete (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__;
});

describe('telemetry events facade (Sentry-backed)', () => {
  it('routes trackException to the Sentry wrapper with context', async () => {
    const events = await loadEvents();
    await events.trackException('boom', { sessionId: 's1', feature: 'chat' });
    expect(captureException).toHaveBeenCalledWith('boom', { sessionId: 's1', feature: 'chat' });
  });

  it('records events as breadcrumbs merging properties and measurements', async () => {
    const events = await loadEvents();
    await events.trackEvent('search_performed', { locale: 'en' }, { count: 2 });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      message: 'search_performed',
      category: 'event',
      level: 'info',
      data: { locale: 'en', count: 2 },
    });
  });

  it('splits AI event payloads into string properties and numeric measurements', async () => {
    const events = await loadEvents();
    await events.trackAiEvent('llm_summarize', {
      duration_ms: 123,
      severity: 4,
      success: true,
      model: 'gpt-4o-mini',
      skipped: undefined,
      note: null,
    });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      message: 'llm_summarize',
      category: 'event',
      level: 'info',
      data: { success: 'true', model: 'gpt-4o-mini', duration_ms: 123, severity: 4 },
    });
  });

  it('records metrics as breadcrumbs', async () => {
    const events = await loadEvents();
    await events.trackMetric('latency_ms', 250);
    expect(addBreadcrumb).toHaveBeenCalledWith({
      message: 'latency_ms',
      category: 'metric',
      level: 'info',
      data: { value: 250 },
    });
  });

  it('forwards warning/error traces to Sentry as captured messages', async () => {
    const events = await loadEvents();
    await events.trackTrace('slow query', 'warning', { area: 'search' });
    expect(captureMessage).toHaveBeenCalledWith('slow query', 'warning', { extra: { area: 'search' } });
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('keeps info/debug traces as breadcrumbs', async () => {
    const events = await loadEvents();
    await events.trackTrace('hello');
    expect(addBreadcrumb).toHaveBeenCalledWith({
      message: 'hello',
      category: 'trace',
      level: 'info',
      data: undefined,
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('fails open when the underlying Sentry wrapper throws', async () => {
    addBreadcrumb.mockRejectedValueOnce(new Error('telemetry down'));
    const events = await loadEvents();
    await expect(events.trackEvent('event_after_failure')).resolves.toBeUndefined();
  });

  it('flushes through an injected Sentry client when present', async () => {
    const flush = vi.fn(async () => true);
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = { flush };
    const events = await loadEvents();
    await expect(events.flush()).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledWith(2_000);
  });

  it('flush is a no-op when no Sentry client is injected', async () => {
    const events = await loadEvents();
    await expect(events.flush()).resolves.toBeUndefined();
  });
});
