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

function createRequest(options: { jsonBody?: unknown; jsonError?: boolean; ip?: string } = {}) {
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

async function loadRoute() {
  return import('../route');
}

const ID_ONE = '11111111-1111-4111-8111-111111111111';
const ID_TWO = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
  requireMinRoleMock.mockReturnValue(true);
  advanceMock.mockResolvedValue({ success: true });
});

describe('PATCH /api/community/queue/bulk', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('enforces rate limiting and authz gates', async () => {
    const { PATCH } = await loadRoute();

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await PATCH(createRequest({ ip: '203.0.113.9' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauthenticated = await PATCH(createRequest());
    expect(unauthenticated.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await PATCH(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('returns 400 for invalid json and invalid payload', async () => {
    const { PATCH } = await loadRoute();

    const invalidJson = await PATCH(createRequest({ jsonError: true }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({ error: 'Invalid JSON body' });

    const invalidPayload = await PATCH(
      createRequest({
        jsonBody: { ids: ['bad-id'], decision: 'approved' },
      }),
    );
    expect(invalidPayload.status).toBe(400);
    const body = await invalidPayload.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('applies approved decisions and updates confidence scores when service ids exist', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([]) // notes update id 1
      .mockResolvedValueOnce([{ service_id: 'svc-1' }]) // service lookup id 1
      .mockResolvedValueOnce([]) // confidence upsert id 1
      .mockResolvedValueOnce([]) // notes update id 2
      .mockResolvedValueOnce([{ service_id: 'svc-2' }]) // service lookup id 2
      .mockResolvedValueOnce([]); // confidence upsert id 2

    const { PATCH } = await loadRoute();

    const res = await PATCH(
      createRequest({
        jsonBody: {
          ids: [ID_ONE, ID_TWO],
          decision: 'approved',
          notes: 'Bulk approval completed',
        },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      succeeded: [ID_ONE, ID_TWO],
      failed: [],
    });
    expect(dbMocks.executeQuery.mock.calls.some((call) => String(call[0]).includes('reviewer_notes'))).toBe(true);
    expect(dbMocks.executeQuery.mock.calls.some((call) => String(call[0]).includes('confidence_scores'))).toBe(true);
  });

  it('collects per-item failures without failing the whole request', async () => {
    advanceMock
      .mockResolvedValueOnce({ success: false, error: 'Transition denied' })
      .mockRejectedValueOnce(new Error('engine exploded'));

    const { PATCH } = await loadRoute();

    const res = await PATCH(
      createRequest({
        jsonBody: {
          ids: [ID_ONE, ID_TWO],
          decision: 'denied',
        },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      succeeded: [],
      failed: [
        { id: ID_ONE, error: 'Transition denied' },
        { id: ID_TWO, error: 'engine exploded' },
      ],
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
