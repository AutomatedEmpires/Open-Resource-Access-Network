import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const guardMocks = vi.hoisted(() => ({ requireMinRole: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const templatesMocks = vi.hoisted(() => ({ listTemplates: vi.fn() }));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/templates/templates', () => templatesMocks);

function createRequest(url = 'http://localhost/api/templates?limit=5&offset=1&tags=food,shelter') {
  const headers = new Headers();
  headers.set('x-forwarded-for', '1.2.3.4');
  return { headers, nextUrl: new URL(url) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  authMocks.getAuthContext.mockResolvedValue({
    userId: 'u1',
    role: 'host_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  templatesMocks.listTemplates.mockResolvedValue({ templates: [], total: 0 });
});

describe('GET /api/templates', () => {
  it('lists templates with host admin scopes and parsed filters', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('http://localhost/api/templates?category=faq&language=en&tags=food,%20shelter&limit=10&offset=2'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(templatesMocks.listTemplates).toHaveBeenCalledWith({
      visibleScopes: ['shared', 'host_admin'],
      category: 'faq',
      language: 'en',
      tags: ['food', 'shelter'],
      publishedOnly: true,
      limit: 10,
      offset: 2,
    });
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 42 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(401);
  });

  it('returns 403 when role guard fails', async () => {
    guardMocks.requireMinRole.mockReturnValueOnce(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid query', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('http://localhost/api/templates?limit=200'));

    expect(res.status).toBe(400);
  });

  it('maps service failures to 500', async () => {
    templatesMocks.listTemplates.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
