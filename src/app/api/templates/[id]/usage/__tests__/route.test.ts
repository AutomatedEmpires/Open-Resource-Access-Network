import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const guardMocks = vi.hoisted(() => ({ requireMinRole: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn());
const templatesMocks = vi.hoisted(() => ({ recordTemplateUsage: vi.fn() }));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/templates/templates', () => templatesMocks);

function createContext(id = 'template-1') {
  return { params: Promise.resolve({ id }) } as never;
}

function createRequest(body: unknown, ip = '1.2.3.4') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    json: vi.fn().mockResolvedValue(body),
    nextUrl: new URL('http://localhost/api/templates/template-1/usage'),
  } as never;
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
  templatesMocks.recordTemplateUsage.mockResolvedValue(undefined);
});

describe('POST /api/templates/[id]/usage', () => {
  it('records usage and returns 204', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ action: 'view' }), createContext());

    expect(res.status).toBe(204);
    expect(templatesMocks.recordTemplateUsage).toHaveBeenCalledWith('template-1', 'view', 'host_admin');
  });

  it('returns 400 for invalid JSON', async () => {
    const request = {
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
      nextUrl: new URL('http://localhost/api/templates/template-1/usage'),
    } as never;
    const { POST } = await import('../route');
    const res = await POST(request, createContext());

    expect(res.status).toBe(400);
  });

  it('returns 422 for invalid action', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ action: 'invalid' }), createContext());

    expect(res.status).toBe(422);
  });

  it('returns 403 when role guard fails', async () => {
    guardMocks.requireMinRole.mockReturnValueOnce(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest({ action: 'copy' }), createContext());

    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 60 });
    const { POST } = await import('../route');
    const res = await POST(createRequest({ action: 'copy' }), createContext());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});
