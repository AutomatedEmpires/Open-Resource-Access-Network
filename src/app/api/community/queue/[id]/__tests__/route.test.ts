import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const advanceMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/workflow/engine', () => ({
  advance: advanceMock,
}));

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

async function loadRoute() {
  return import('../route');
}

const VALID_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'community-1',
    role: 'community_admin',
  });
  requireMinRoleMock.mockReturnValue(true);
  advanceMock.mockResolvedValue({
    success: true,
    fromStatus: 'submitted',
    toStatus: 'approved',
    transitionId: 'tx-1',
  });
});

describe('api/community/queue/[id] route', () => {
  it('returns GET guard responses for db, id, rate, auth, and role checks', async () => {
    const { GET } = await loadRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(503);

    expect((await GET(createRequest(), ctx('bad-id'))).status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 15 });
    const limited = await GET(createRequest({ ip: '203.0.113.8' }), ctx(VALID_ID));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('15');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), ctx(VALID_ID))).status).toBe(403);
  });

  it('returns 404 when submission does not exist', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const response = await GET(createRequest(), ctx(VALID_ID));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Submission not found' });
  });

  it('returns GET details for submissions without a linked service', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: VALID_ID,
          service_id: null,
          status: 'submitted',
          payload: {},
        },
      ])
      .mockResolvedValueOnce([{ id: 'tr-1', to_status: 'submitted' }]);

    const response = await GET(createRequest(), ctx(VALID_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.locations).toEqual([]);
    expect(body.phones).toEqual([]);
    expect(body.confidenceScore).toBeNull();
    expect(body.transitions).toEqual([{ id: 'tr-1', to_status: 'submitted' }]);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('returns GET details including locations, phones, confidence score, and transitions', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: VALID_ID,
          service_id: 'service-1',
          status: 'under_review',
          payload: { name: 'Service' },
        },
      ])
      .mockResolvedValueOnce([{ id: 'loc-1', city: 'Seattle' }])
      .mockResolvedValueOnce([{ id: 'ph-1', number: '555-123-4567' }])
      .mockResolvedValueOnce([{ score: 88 }])
      .mockResolvedValueOnce([{ id: 'tr-2', to_status: 'approved' }]);

    const response = await GET(createRequest(), ctx(VALID_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.locations).toEqual([{ id: 'loc-1', city: 'Seattle' }]);
    expect(body.phones).toEqual([{ id: 'ph-1', number: '555-123-4567' }]);
    expect(body.confidenceScore).toEqual({ score: 88 });
    expect(body.transitions).toEqual([{ id: 'tr-2', to_status: 'approved' }]);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(5);
  });

  it('returns 500 on GET errors and captures telemetry', async () => {
    const { GET } = await loadRoute();
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));

    const response = await GET(createRequest(), ctx(VALID_ID));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_verify_get',
    });
  });

  it('returns PUT guard responses for db, id, rate, auth, and role checks', async () => {
    const { PUT } = await loadRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(503);

    expect((await PUT(createRequest(), ctx('bad-id'))).status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await PUT(createRequest({ ip: '198.51.100.9' }), ctx(VALID_ID));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), ctx(VALID_ID))).status).toBe(403);
  });

  it('returns 400 on invalid PUT JSON body and schema validation failures', async () => {
    const { PUT } = await loadRoute();

    const badJson = await PUT(createRequest({ jsonError: true }), ctx(VALID_ID));
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ error: 'Invalid JSON body' });

    const invalid = await PUT(
      createRequest({
        jsonBody: { decision: 'invalid-status' },
      }),
      ctx(VALID_ID),
    );
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error).toBe('Validation failed');
    expect(Array.isArray(invalidBody.details)).toBe(true);
  });

  it('saves reviewer notes and returns 409 when workflow transition is denied', async () => {
    const { PUT } = await loadRoute();
    advanceMock.mockResolvedValueOnce({ success: false, error: 'Transition denied' });

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'denied',
          notes: 'Need more proof',
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Transition denied' });
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(
      'UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2',
      ['Need more proof', VALID_ID],
    );
  });

  it('updates confidence score for approved decisions when service exists', async () => {
    const { PUT } = await loadRoute();
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ service_id: 'svc-1' }])
      .mockResolvedValueOnce([]);

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'approved',
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Record approved. Confidence score updated.');
    expect(dbMocks.executeQuery.mock.calls[1]?.[0]).toContain('INSERT INTO confidence_scores');
    expect(dbMocks.executeQuery.mock.calls[1]?.[1]).toEqual(['svc-1']);
  });

  it('skips confidence score update when approved decision has no linked service', async () => {
    const { PUT } = await loadRoute();
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'approved',
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(200);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on PUT exceptions and captures telemetry', async () => {
    const { PUT } = await loadRoute();
    advanceMock.mockRejectedValueOnce(new Error('engine failed'));

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'returned',
        },
      }),
      ctx(VALID_ID),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_verify_decision',
    });
  });
});
