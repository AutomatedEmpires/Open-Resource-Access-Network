import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(search = '') {
  const url = new URL(`https://oran.test${search}`);
  return {
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
  dbMocks.executeQuery.mockResolvedValue([]);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/taxonomy/terms route', () => {
  it('returns an empty term list when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      terms: [],
      warning: 'Taxonomy terms are unavailable because the database is not configured.',
    });
  });

  it('returns 400 for invalid query parameters', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest('?parentId=not-a-uuid'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid query parameters');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns terms with parsed serviceCount', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'a1000000-0000-0000-0000-000000000001',
        term: 'Food Assistance',
        description: 'Programs providing food or nutrition support',
        parent_id: null,
        taxonomy: 'demo',
        service_count: '12',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest('?q=food&limit=10'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      terms: [
        {
          id: 'a1000000-0000-0000-0000-000000000001',
          term: 'Food Assistance',
          description: 'Programs providing food or nutrition support',
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 12,
        },
      ],
    });

    expect(dbMocks.executeQuery).toHaveBeenCalledOnce();
    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(String(sql)).toContain('FROM taxonomy_terms');
    expect(params).toEqual(['food', null, null, 10]);
  });

  it('returns 500 and captures exception on query failure', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('db failed'));
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
