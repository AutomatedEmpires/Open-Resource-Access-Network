import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeCount: vi.fn(),
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/search/engine', () => ({
  ServiceSearchEngine: class {
    search = searchMock;
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
  searchMock.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    hasMore: false,
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/search route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Search is temporarily unavailable (database not configured).',
    });
  });

  it('returns 429 when rate limiting blocks search', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 9,
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '203.0.113.4' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
  });

  it('returns 400 for invalid query parameters', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ search: '?limit=101' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid query parameters');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 400 when taxonomyIds contains invalid uuids', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ search: '?taxonomyIds=bad-id' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid query parameters',
      details: [{ message: 'taxonomyIds must be UUIDs' }],
    });
  });

  it('executes a structured search and returns results', async () => {
    searchMock.mockResolvedValueOnce({
      results: [{ service: { id: 'svc-1', name: 'Food Pantry' } }],
      total: 1,
      page: 2,
      hasMore: false,
    });
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({
        search:
          '?q=food&lat=39.7&lng=-104.9&radius=1000&page=2&minConfidence=0.8',
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith({
      text: 'food',
      filters: {
        status: 'active',
        minConfidenceScore: 80,
        organizationId: undefined,
        taxonomyTermIds: undefined,
      },
      pagination: {
        page: 2,
        limit: 20,
      },
      sortBy: 'relevance',
      geo: {
        type: 'radius',
        lat: 39.7,
        lng: -104.9,
        radiusMeters: 1000,
      },
    });
    await expect(response.json()).resolves.toEqual({
      results: [{ service: { id: 'svc-1', name: 'Food Pantry' } }],
      total: 1,
      page: 2,
      hasMore: false,
    });
  });

  it('returns 500 when the search engine throws', async () => {
    searchMock.mockRejectedValueOnce(new Error('db failed'));
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ search: '?q=food' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it('passes parsed attribute filters to search engine', async () => {
    const { GET } = await loadRoute();
    const attrs = JSON.stringify({ delivery: ['virtual'], cost: ['free'] });

    const response = await GET(
      createRequest({ search: `?q=food&attributes=${encodeURIComponent(attrs)}` }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          attributeFilters: { delivery: ['virtual'], cost: ['free'] },
        }),
      }),
    );
  });

  it('returns 400 for invalid attributes JSON', async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({ search: '?q=food&attributes=not-json' }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details[0].message).toContain('valid JSON');
  });

  it('returns 400 when attributes is not an object of string arrays', async () => {
    const { GET } = await loadRoute();
    const attrs = JSON.stringify({ delivery: 'virtual' }); // string, not array

    const response = await GET(
      createRequest({ search: `?q=food&attributes=${encodeURIComponent(attrs)}` }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details[0].message).toContain('JSON object mapping taxonomy');
  });

  it('returns 400 when attribute filter keys exceed max length', async () => {
    const { GET } = await loadRoute();
    const longKey = 'x'.repeat(51);
    const attrs = JSON.stringify({ [longKey]: ['value'] });

    const response = await GET(
      createRequest({ search: `?q=food&attributes=${encodeURIComponent(attrs)}` }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when attribute filter tags exceed max length', async () => {
    const { GET } = await loadRoute();
    const longTag = 'x'.repeat(101);
    const attrs = JSON.stringify({ delivery: [longTag] });

    const response = await GET(
      createRequest({ search: `?q=food&attributes=${encodeURIComponent(attrs)}` }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when attribute filter has empty tag array', async () => {
    const { GET } = await loadRoute();
    const attrs = JSON.stringify({ delivery: [] });

    const response = await GET(
      createRequest({ search: `?q=food&attributes=${encodeURIComponent(attrs)}` }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 for an unknown preset ID', async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({ search: '?preset=nonexistent_xyz' }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details[0].message).toContain('Unknown preset');
  });

  it('applies preset text and attribute filters when no user query', async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({ search: '?preset=low_cost_dental' }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'dental',
        filters: expect.objectContaining({
          attributeFilters: expect.objectContaining({
            cost: expect.arrayContaining(['free']),
          }),
        }),
      }),
    );
  });

  it('user query overrides preset text', async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      createRequest({ search: '?q=orthodontist&preset=low_cost_dental' }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'orthodontist',
        filters: expect.objectContaining({
          attributeFilters: expect.objectContaining({
            cost: expect.arrayContaining(['free']),
          }),
        }),
      }),
    );
  });

  it('user attribute filters override preset attribute filters on same key', async () => {
    const { GET } = await loadRoute();
    const attrs = JSON.stringify({ cost: ['medicaid'] });

    const response = await GET(
      createRequest({
        search: `?preset=low_cost_dental&attributes=${encodeURIComponent(attrs)}`,
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          attributeFilters: expect.objectContaining({
            cost: ['medicaid'],
          }),
        }),
      }),
    );
  });
});
