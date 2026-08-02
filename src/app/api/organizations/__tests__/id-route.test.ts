import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  executeCount: vi.fn(),
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
  dbMocks.executeCount.mockResolvedValue({ count: 0 });
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

    // Query order in getPublishedOrganizationDetail:
    // organization -> services -> per-service locations -> org phones.
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: 'org-1',
          name: 'Helping Hands',
          description: 'desc',
          url: null,
          email: null,
          status: 'active',
          tax_id: '91-0000000',
          year_incorporated: 2001,
          logo_url: null,
          verified_at: null,
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
        },
        {
          id: 'svc-2',
          name: 'Shelter',
          description: null,
          url: null,
          status: 'active',
        },
      ])
      .mockResolvedValueOnce([
        {
          service_id: 'svc-1',
          address_1: '123 Main',
          city: 'Seattle',
          state_province: 'WA',
          postal_code: '98101',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'phone-1',
          number: '555-0100',
          extension: null,
          type: 'voice',
          language: null,
          description: null,
        },
      ]);

    const response = await GET(createRequest(), createContext('11111111-1111-4111-8111-111111111111'));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      organization: {
        id: 'org-1',
        name: 'Helping Hands',
        description: 'desc',
        url: null,
        email: null,
        status: 'active',
        year_incorporated: 2001,
        logo_url: null,
        verified_at: null,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      services: [
        {
          id: 'svc-1',
          name: 'Food Pantry',
          description: null,
          url: null,
          status: 'active',
          locations: [
            {
              address_1: '123 Main',
              city: 'Seattle',
              state_province: 'WA',
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
          locations: [],
        },
      ],
      phones: [{ id: 'phone-1', number: '555-0100' }],
      serviceCount: 2,
    });

    // The public profile payload must not republish registry identifiers.
    expect(body.organization).not.toHaveProperty('tax_id');
    expect(body.organization).not.toHaveProperty('tax_status');
    expect(body.organization).not.toHaveProperty('legal_status');
    expect(body.organization).not.toHaveProperty('uri');
  });
});
