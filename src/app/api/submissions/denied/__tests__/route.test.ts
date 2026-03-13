import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);

async function loadRoute() {
  return import('../route');
}

function createGetRequest(ip?: string) {
  const headers = new Headers();
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }
  return { headers } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);

  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });

  authMocks.getAuthContext.mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'seeker',
  });

  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/submissions/denied', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest('10.0.0.1'));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());
    expect(response.status).toBe(401);
  });

  it('returns denied submissions with private cache headers', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'sub-1',
        title: 'Denied claim',
        submission_type: 'org_claim',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0].id).toBe('sub-1');
  });

  it('returns empty array when user has no denied submissions', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submissions).toEqual([]);
  });

  it('returns 500 and captures exception on failure', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
