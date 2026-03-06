import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
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

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  authMocks.getAuthContext.mockResolvedValue(null);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/saved route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Saved services unavailable.',
    });
  });

  it('returns 401 when saved service reads are unauthenticated', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns saved service ids for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      { service_id: '11111111-1111-4111-8111-111111111111' },
      { service_id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      savedIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    });
  });

  it('returns 429 with Retry-After when reads are rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '203.0.113.42, 10.0.0.1' }));

    expect(rateLimitMock).toHaveBeenCalledWith(
      'saved:ip:203.0.113.42',
      expect.any(Object),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
  });

  it('returns 500 and captures exceptions when reads fail', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    const dbError = new Error('read failed');
    dbMocks.executeQuery.mockRejectedValueOnce(dbError);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, {
      feature: 'api_saved_get',
      userId: 'user-1',
    });
  });

  it('returns 400 when saving a service has invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when saving a service has an invalid service id', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: { serviceId: 'not-a-uuid' },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('saves a service idempotently for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      saved: true,
      serviceId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('returns 429 for write requests when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 12 });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        ip: '198.51.100.8',
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('returns 401 for unauthenticated save requests', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 500 and captures exceptions when save insert fails', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    const dbError = new Error('insert failed');
    dbMocks.executeQuery.mockRejectedValueOnce(dbError);
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, {
      feature: 'api_saved_post',
      userId: 'user-1',
    });
  });

  it('removes a saved service idempotently for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { DELETE } = await loadRoute();

    const response = await DELETE(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      removed: true,
      serviceId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('returns 400 for invalid JSON body on remove', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    const { DELETE } = await loadRoute();

    const response = await DELETE(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for invalid service id on remove', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    const { DELETE } = await loadRoute();

    const response = await DELETE(
      createRequest({
        jsonBody: { serviceId: 'bad-id' },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 429 for remove requests when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const { DELETE } = await loadRoute();

    const response = await DELETE(
      createRequest({
        ip: '198.51.100.9',
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5');
  });

  it('returns 401 for unauthenticated remove requests', async () => {
    const { DELETE } = await loadRoute();

    const response = await DELETE(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 500 and captures exceptions when remove fails', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    const dbError = new Error('delete failed');
    dbMocks.executeQuery.mockRejectedValueOnce(dbError);
    const { DELETE } = await loadRoute();

    const response = await DELETE(
      createRequest({
        jsonBody: { serviceId: '11111111-1111-4111-8111-111111111111' },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(dbError, {
      feature: 'api_saved_delete',
      userId: 'user-1',
    });
  });
});
