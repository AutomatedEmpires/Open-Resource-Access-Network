import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    trackException: vi.fn(),
    trackEvent: vi.fn(),
    trackMetric: vi.fn(),
    trackTrace: vi.fn(),
    flush: vi.fn(({ callback }: { callback: () => void }) => callback()),
  },
}));

vi.mock('applicationinsights', () => ({
  defaultClient: mockClient,
}));

const originalConnectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

async function loadAppInsightsModule() {
  return import('../appInsights');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
});

afterEach(() => {
  if (originalConnectionString === undefined) {
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    return;
  }

  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = originalConnectionString;
});

describe('appInsights telemetry wrapper', () => {
  it('is a no-op when Application Insights is not configured', async () => {
    const appInsights = await loadAppInsightsModule();

    await appInsights.trackException(new Error('boom'), { feature: 'search' });
    await appInsights.trackEvent('search_performed', { locale: 'en' }, { count: 1 });
    await appInsights.trackMetric('latency_ms', 120);
    await appInsights.trackTrace('hello');
    await appInsights.flush();

    expect(mockClient.trackException).not.toHaveBeenCalled();
    expect(mockClient.trackEvent).not.toHaveBeenCalled();
    expect(mockClient.trackMetric).not.toHaveBeenCalled();
    expect(mockClient.trackTrace).not.toHaveBeenCalled();
    expect(mockClient.flush).not.toHaveBeenCalled();
  });

  it('tracks exceptions with normalized errors and filtered context', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const appInsights = await loadAppInsightsModule();

    await appInsights.trackException('boom', {
      sessionId: 'session-1',
      userId: 'user-1',
      feature: 'chat',
    });

    expect(mockClient.trackException).toHaveBeenCalledOnce();
    const payload = mockClient.trackException.mock.calls[0]?.[0] as {
      exception: Error;
      properties: Record<string, string>;
      severity: number;
    };
    expect(payload.exception).toBeInstanceOf(Error);
    expect(payload.exception.message).toBe('boom');
    expect(payload.properties).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      feature: 'chat',
    });
    expect(payload.severity).toBe(3);
  });

  it('tracks events, metrics, and traces with the expected payloads', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const appInsights = await loadAppInsightsModule();

    await appInsights.trackEvent('search_performed', { locale: 'en' }, { count: 2 });
    await appInsights.trackMetric('latency_ms', 250);
    await appInsights.trackTrace('warning trace', 'warning', { area: 'search' });
    await appInsights.trackTrace('default trace');

    expect(mockClient.trackEvent).toHaveBeenCalledWith({
      name: 'search_performed',
      properties: { locale: 'en' },
      measurements: { count: 2 },
    });
    expect(mockClient.trackMetric).toHaveBeenCalledWith({
      name: 'latency_ms',
      value: 250,
    });
    expect(mockClient.trackTrace).toHaveBeenNthCalledWith(1, {
      message: 'warning trace',
      severity: 2,
      properties: { area: 'search' },
    });
    expect(mockClient.trackTrace).toHaveBeenNthCalledWith(2, {
      message: 'default trace',
      severity: 1,
      properties: undefined,
    });
  });

  it('tracks AI events by splitting properties and measurements', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const appInsights = await loadAppInsightsModule();

    await appInsights.trackAiEvent('content_safety_check', {
      duration_ms: 123,
      severity: 4,
      success: true,
      model: 'safety-v1',
      skipped: undefined,
      note: null,
    });

    expect(mockClient.trackEvent).toHaveBeenCalledWith({
      name: 'content_safety_check',
      properties: {
        success: 'true',
        model: 'safety-v1',
      },
      measurements: {
        duration_ms: 123,
        severity: 4,
      },
    });
  });

  it('supports debug/fatal trace severities and swallows AI-event telemetry errors', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const appInsights = await loadAppInsightsModule();

    await appInsights.trackTrace('debug trace', 'debug');
    await appInsights.trackTrace('fatal trace', 'fatal');

    expect(mockClient.trackTrace).toHaveBeenNthCalledWith(1, {
      message: 'debug trace',
      severity: 0,
      properties: undefined,
    });
    expect(mockClient.trackTrace).toHaveBeenNthCalledWith(2, {
      message: 'fatal trace',
      severity: 4,
      properties: undefined,
    });

    mockClient.trackEvent.mockImplementationOnce(() => {
      throw new Error('telemetry down');
    });
    await expect(
      appInsights.trackAiEvent('content_safety_check', { duration_ms: 20 }),
    ).resolves.toBeUndefined();
  });

  it('fails open when app insights import cannot be loaded at runtime', async () => {
    vi.resetModules();
    vi.doMock('applicationinsights', () => {
      throw new Error('module missing');
    });
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';

    const appInsights = await loadAppInsightsModule();
    await expect(appInsights.trackEvent('event_after_import_fail')).resolves.toBeUndefined();
    await expect(appInsights.trackMetric('m', 1)).resolves.toBeUndefined();

    // Restore the default module mock for subsequent tests.
    vi.doMock('applicationinsights', () => ({
      defaultClient: mockClient,
    }));
  });

  it('flushes pending telemetry through the client callback', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const appInsights = await loadAppInsightsModule();

    await expect(appInsights.flush()).resolves.toBeUndefined();
    expect(mockClient.flush).toHaveBeenCalledOnce();
  });
});
