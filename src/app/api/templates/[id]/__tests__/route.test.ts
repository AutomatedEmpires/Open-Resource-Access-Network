import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const guardMocks = vi.hoisted(() => ({ requireMinRole: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const templatesMocks = vi.hoisted(() => ({ getTemplate: vi.fn() }));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/templates/templates', () => templatesMocks);

function createRequest() {
  const headers = new Headers();
  headers.set('x-forwarded-for', '1.2.3.4');
  return { headers, nextUrl: new URL('http://localhost/api/templates/template-1') } as never;
}

function createContext(id = 'template-1') {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  authMocks.getAuthContext.mockResolvedValue({
    userId: 'u1',
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  templatesMocks.getTemplate.mockResolvedValue({ id: 'template-1', is_published: true });
});

describe('GET /api/templates/[id]', () => {
  it('returns template when visible and published', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(templatesMocks.getTemplate).toHaveBeenCalledWith('template-1', ['shared', 'host_admin', 'community_admin']);
  });

  it('returns 404 for missing template', async () => {
    templatesMocks.getTemplate.mockResolvedValueOnce(null);
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(404);
  });

  it('returns 404 for unpublished template', async () => {
    templatesMocks.getTemplate.mockResolvedValueOnce({ id: 'template-1', is_published: false });
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(404);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 15 });
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('15');
  });

  it('returns 403 when role guard fails', async () => {
    guardMocks.requireMinRole.mockReturnValueOnce(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(403);
  });

  it('returns 500 when service throws', async () => {
    templatesMocks.getTemplate.mockRejectedValueOnce(new Error('boom'));
    const { GET } = await import('../route');
    const res = await GET(createRequest(), createContext());

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
