import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  getPgPool: vi.fn(),
  withTransaction: vi.fn(),
}));

const detectorMocks = vi.hoisted(() => ({
  detectRegressions: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/regression/detector', () => detectorMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(
  options: { apiKey?: string; body?: unknown; jsonError?: boolean } = {},
) {
  const headers = new Headers();
  if (options.apiKey) {
    headers.set('authorization', `Bearer ${options.apiKey}`);
  }
  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.body),
  } as never;
}

/**
 * Build a client mock for the batch write path (5 queries total, regardless of count).
 *
 * Query 2 (regression batch INSERT) uses mockImplementationOnce to read the
 * regressionId UUIDs from the call's first parameter and echo them back in
 * RETURNING rows — simulating Postgres actually inserting them.  This allows
 * the route's `insertedIds.has(p.regressionId)` filter to pass without needing
 * to know the randomly-generated UUIDs upfront.
 */
function makeClientForNewRegressions() {
  return vi
    .fn()
    // 1. Dedup check: no existing keys in window
    .mockResolvedValueOnce({ rows: [] })
    // 2. Regression batch INSERT: echo back the passed regressionIds as RETURNING rows
    .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({
      rows: (params[0] as string[]).map((id) => ({ id })),
    }))
    // 3. Submissions batch INSERT
    .mockResolvedValueOnce({ rows: [] })
    // 4. Transitions batch INSERT
    .mockResolvedValueOnce({ rows: [] })
    // 5. Notifications batch INSERT
    .mockResolvedValueOnce({ rows: [] });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('INTERNAL_API_KEY', 'secret-key');

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  // getPgPool returns a stub pool object; detectRegressions is mocked so pool.query is never called
  dbMocks.getPgPool.mockReturnValue({ query: vi.fn() });
  captureExceptionMock.mockResolvedValue(undefined);

  // Default: no regressions detected
  detectorMocks.detectRegressions.mockResolvedValue([]);

  // Default: transaction calls the callback with a no-op client
  dbMocks.withTransaction.mockImplementation(
    async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      return callback(client);
    },
  );
});

describe('POST /api/internal/confidence-regression-scan', () => {
  // ----------------------------------------------------------
  // Auth / guard checks
  // ----------------------------------------------------------

  it('returns 503 when INTERNAL_API_KEY is not configured', async () => {
    vi.stubEnv('INTERNAL_API_KEY', '');
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    expect(res.status).toBe(503);
  });

  it('returns 401 for a missing authorization header', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 for an incorrect bearer token', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'wrong-key' }));
    expect(res.status).toBe(401);
  });

  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    expect(res.status).toBe(503);
  });

  // ----------------------------------------------------------
  // Detection is called with correct arguments
  // ----------------------------------------------------------

  it('passes getPgPool() result and default limit (100) to detectRegressions', async () => {
    const { POST } = await import('../route');
    await POST(createRequest({ apiKey: 'secret-key', jsonError: true }));

    expect(detectorMocks.detectRegressions).toHaveBeenCalledWith(
      dbMocks.getPgPool.mock.results[0]?.value,
      100,
    );
  });

  it('clamps a limit of 0 up to 1', async () => {
    const { POST } = await import('../route');
    await POST(createRequest({ apiKey: 'secret-key', body: { limit: 0 } }));
    expect(detectorMocks.detectRegressions).toHaveBeenCalledWith(expect.any(Object), 1);
  });

  it('clamps a limit above 100 down to 100', async () => {
    const { POST } = await import('../route');
    await POST(createRequest({ apiKey: 'secret-key', body: { limit: 9999 } }));
    expect(detectorMocks.detectRegressions).toHaveBeenCalledWith(expect.any(Object), 100);
  });

  // ----------------------------------------------------------
  // Happy-path scan results
  // ----------------------------------------------------------

  it('returns success with createdCount 0 when detector finds nothing', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, createdCount: 0 });
    expect(typeof body.checkedAt).toBe('string');
  });

  it('returns createdCount 1 when one new regression is persisted', async () => {
    const candidate = {
      serviceId: 'svc-1',
      serviceName: 'Food Pantry',
      signalType: 'service_updated_after_verification',
      currentScore: 75,
      currentBand: 'LIKELY',
      reasons: ['Service data updated after score computed'],
      dedupeKey: 'svc-1:service_updated_after_verification:12345',
      notesText: 'Auto-flagged: re-review suggested.',
    };

    detectorMocks.detectRegressions.mockResolvedValue([candidate]);

    dbMocks.withTransaction.mockImplementation(
      async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        return callback({ query: makeClientForNewRegressions() });
      },
    );

    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.createdCount).toBe(1);
  });

  it('uses a pool (not a transaction client) for detection', async () => {
    const { POST } = await import('../route');
    await POST(createRequest({ apiKey: 'secret-key' }));

    // getPgPool must be called before withTransaction opens
    const pgPoolCallOrder = dbMocks.getPgPool.mock.invocationCallOrder[0];
    const txCallOrder = dbMocks.withTransaction.mock.invocationCallOrder[0];
    expect(pgPoolCallOrder).toBeLessThan(txCallOrder!);
  });

  it('skips candidates already present in the current dedup window', async () => {
    const existingKey = 'svc-1:service_updated_after_verification:12345';

    detectorMocks.detectRegressions.mockResolvedValue([
      {
        serviceId: 'svc-1',
        serviceName: 'Food Pantry',
        signalType: 'service_updated_after_verification',
        currentScore: 75,
        currentBand: 'LIKELY',
        reasons: [],
        dedupeKey: existingKey,
        notesText: 'text',
      },
    ]);

    dbMocks.withTransaction.mockImplementation(
      async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        // dedup check returns the key as already existing
        const queryMock = vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ dedupe_key: existingKey }] });
        return callback({ query: queryMock });
      },
    );

    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.createdCount).toBe(0);
  });

  it('handles a concurrent-insert race (ON CONFLICT returns no rows for regression INSERT)', async () => {
    detectorMocks.detectRegressions.mockResolvedValue([
      {
        serviceId: 'svc-1',
        serviceName: 'Food Pantry',
        signalType: 'feedback_severity',
        currentScore: 35,
        currentBand: 'POSSIBLE',
        reasons: [],
        dedupeKey: 'svc-1:feedback_severity:12345',
        notesText: 'text',
      },
    ]);

    dbMocks.withTransaction.mockImplementation(
      async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        const queryMock = vi
          .fn()
          .mockResolvedValueOnce({ rows: [] })  // dedup check: none existing
          .mockResolvedValueOnce({ rows: [] }); // regression batch INSERT: all conflicted
        return callback({ query: queryMock });
      },
    );

    const { POST } = await import('../route');
    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.createdCount).toBe(0);
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------

  it('returns 500 and captures exception when detection fails', async () => {
    detectorMocks.detectRegressions.mockRejectedValueOnce(new Error('db error'));
    const { POST } = await import('../route');

    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Regression scan failed' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'confidence_regression_scan',
    });
  });

  it('returns 500 and captures exception when the write transaction fails', async () => {
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('scan failed'));
    const { POST } = await import('../route');

    const res = await POST(createRequest({ apiKey: 'secret-key' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Regression scan failed' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'confidence_regression_scan',
    });
  });
});
