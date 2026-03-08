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

describe('api/profile route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Profile service is temporarily unavailable.',
    });
  });

  it('returns 429 when rate limiting blocks profile reads', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 12,
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '203.0.113.8' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('returns 401 when profile reads are unauthenticated', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns null when the authenticated user has no profile row', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profile: null });
  });

  it('returns a mapped profile payload for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        preferred_locale: 'es',
        approximate_city: 'Denver',
      },
    ]);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        userId: 'user-1',
        displayName: null,
        email: null,
        phone: null,
        authProvider: null,
        preferredLocale: 'es',
        approximateCity: 'Denver',
        seekerProfile: null,
      },
    });
  });

  it('returns 400 when profile updates have invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { PUT } = await loadRoute();

    const response = await PUT(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when profile updates fail validation', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    const { PUT } = await loadRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          approximateCity: 'x'.repeat(101),
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('upserts and returns the authenticated user profile', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        preferred_locale: 'fr',
        approximate_city: 'Paris',
      },
    ]);
    const { PUT } = await loadRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          preferredLocale: 'fr',
          approximateCity: 'Paris',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        userId: 'user-1',
        displayName: null,
        email: null,
        phone: null,
        authProvider: null,
        preferredLocale: 'fr',
        approximateCity: 'Paris',
        seekerProfile: null,
      },
    });
  });
});
