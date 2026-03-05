import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(ip?: string) {
  const headers = new Headers();
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }
  return {
    headers,
    url: 'https://oran.test/api/organizations/11111111-1111-4111-8111-111111111111',
    nextUrl: new URL('https://oran.test/api/organizations/11111111-1111-4111-8111-111111111111'),
  } as never;
}

function createContext(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

async function loadRoute() {
  return import('../[id]/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  dbMocks.executeQuery.mockResolvedValue([]);
});

describe('public organization profile route', () => {
  it('handles infra + validation failures', async () => {
    const { GET } = await loadRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const unavailable = await GET(createRequest(), createContext('11111111-1111-4111-8111-111111111111'));
    expect(unavailable.status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 25 });
    const limited = await GET(createRequest('203.0.113.10'), createContext('11111111-1111-4111-8111-111111111111'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('25');

    rateLimitMock.mockReturnValueOnce({ exceeded: false, retryAfterSeconds: 0 });
    const invalid = await GET(createRequest(), createContext('bad-id'));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'Invalid organization ID' });
  });

  it('returns not-found and internal-error states', async () => {
    const { GET } = await loadRoute();

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const notFound = await GET(createRequest(), createContext('11111111-1111-4111-8111-111111111111'));
    expect(notFound.status).toBe(404);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('db exploded'));
    const failed = await GET(createRequest(), createContext('11111111-1111-4111-8111-111111111111'));
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('returns organization profile, active services, and grouped locations', async () => {
    const { GET } = await loadRoute();

    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: 'org-1',
          name: 'Helping Hands',
          description: 'desc',
          url: null,
          email: null,
          status: 'active',
          year_incorporated: 2001,
          logo_url: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'svc-1',
          name: 'Food Pantry',
          description: null,
          url: null,
          status: 'active',
          capacity_status: 'open',
        },
        {
          id: 'svc-2',
          name: 'Shelter',
          description: null,
          url: null,
          status: 'active',
          capacity_status: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          service_id: 'svc-1',
          address: '123 Main',
          city: 'Seattle',
          state: 'WA',
          postal_code: '98101',
        },
      ]);

    const response = await GET(createRequest(), createContext('11111111-1111-4111-8111-111111111111'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Helping Hands',
        description: 'desc',
        url: null,
        email: null,
        status: 'active',
        year_incorporated: 2001,
        logo_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      services: [
        {
          id: 'svc-1',
          name: 'Food Pantry',
          description: null,
          url: null,
          status: 'active',
          capacity_status: 'open',
          locations: [
            {
              service_id: 'svc-1',
              address: '123 Main',
              city: 'Seattle',
              state: 'WA',
              postal_code: '98101',
            },
          ],
        },
        {
          id: 'svc-2',
          name: 'Shelter',
          description: null,
          url: null,
          status: 'active',
          capacity_status: null,
          locations: [],
        },
      ],
      serviceCount: 2,
    });
  });
});
