/**
 * Unit tests for POST /api/internal/coverage-gaps
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));

const gapsMocks = vi.hoisted(() => ({
  getCoverageGapSummaries: vi.fn(),
  alertOranAdminsAboutGaps: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/coverage/gaps', () => gapsMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(options: {
  apiKey?: string;
  body?: unknown;
  jsonError?: boolean;
} = {}) {
  const headers = new Headers();
  if (options.apiKey) {
    headers.set('authorization', `Bearer ${options.apiKey}`);
  }
  headers.set('content-type', 'application/json');

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.body ?? { thresholdHours: 24 }),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('INTERNAL_API_KEY', 'test-secret');
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  gapsMocks.getCoverageGapSummaries.mockResolvedValue([]);
  gapsMocks.alertOranAdminsAboutGaps.mockResolvedValue(0);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('POST /api/internal/coverage-gaps', () => {
  it('returns 503 when INTERNAL_API_KEY is not configured', async () => {
    vi.stubEnv('INTERNAL_API_KEY', '');
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret' }));
    expect(res.status).toBe(503);
  });

  it('returns 401 when authorization header is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when authorization header has wrong key', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'wrong-key' }));
    expect(res.status).toBe(401);
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret' }));
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret', jsonError: true }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid thresholdHours', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret', body: { thresholdHours: -1 } }));
    expect(res.status).toBe(400);
  });

  it('returns gap report on success with no gaps', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.unroutedCount).toBe(0);
    expect(body.gapStates).toEqual([]);
    expect(body.alertsSent).toBe(0);
    expect(body.checkedAt).toBeDefined();
  });

  it('returns gap report on success with gaps', async () => {
    gapsMocks.getCoverageGapSummaries.mockResolvedValueOnce([
      { state: 'NV', county: null, unroutedCount: 5, oldestHoursWaiting: 72 },
      { state: 'AZ', county: 'Maricopa', unroutedCount: 2, oldestHoursWaiting: 30 },
    ]);
    gapsMocks.alertOranAdminsAboutGaps.mockResolvedValueOnce(3);

    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.unroutedCount).toBe(7);
    expect(body.gapStates).toContain('NV');
    expect(body.gapStates).toContain('AZ');
    expect(body.alertsSent).toBe(3);
  });

  it('passes custom thresholdHours to the gap service', async () => {
    const { POST } = await import('../route');
    await POST(createRequest({ apiKey: 'test-secret', body: { thresholdHours: 48 } }));

    expect(gapsMocks.getCoverageGapSummaries).toHaveBeenCalledWith(48);
  });

  it('returns 500 when gap check fails', async () => {
    gapsMocks.getCoverageGapSummaries.mockRejectedValueOnce(new Error('DB error'));
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'test-secret' }));

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
