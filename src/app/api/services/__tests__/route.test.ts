import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeCount: vi.fn(),
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const searchByIdsMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/search/engine', () => ({
  ServiceSearchEngine: class {
    searchByIds = searchByIdsMock;
  },
}));

function createRequest(options: {
  search?: string;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    nextUrl: url,
  } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  searchByIdsMock.mockResolvedValue([]);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/services route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Service lookup is temporarily unavailable (database not configured).',
    });
  });

  it('returns 429 when rate limiting blocks service lookup', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 15,
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '203.0.113.6', search: '?ids=11111111-1111-4111-8111-111111111111' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('15');
  });

  it('returns 400 when ids is missing', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'ids parameter is required' });
  });

  it('returns 400 when ids contains invalid uuids', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ search: '?ids=bad-id' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns services matching the requested ids', async () => {
    searchByIdsMock.mockResolvedValueOnce([
      { service: { id: 'svc-1', name: 'Food Pantry' } },
      { service: { id: 'svc-2', name: 'Housing Desk' } },
    ]);
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({
        search:
          '?ids=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
      }),
    );

    expect(response.status).toBe(200);
    expect(searchByIdsMock).toHaveBeenCalledWith([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    await expect(response.json()).resolves.toEqual({
      results: [
        { id: 'svc-1', name: 'Food Pantry' },
        { id: 'svc-2', name: 'Housing Desk' },
      ],
    });
  });

  it('returns 500 when the search engine throws', async () => {
    searchByIdsMock.mockRejectedValueOnce(new Error('lookup failed'));
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({
        search: '?ids=11111111-1111-4111-8111-111111111111',
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
