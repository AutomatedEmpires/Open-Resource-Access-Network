import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  getPgPool: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const compareMock = vi.hoisted(() => vi.fn());
const hashMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('bcryptjs', () => ({
  default: {
    compare: compareMock,
    hash: hashMock,
  },
}));

function createRequest(jsonBody?: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(jsonBody),
  } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.getPgPool.mockReturnValue({ query: queryMock });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  compareMock.mockResolvedValue(true);
  hashMock.mockResolvedValue('new-hash');
  queryMock.mockResolvedValue({ rows: [] });
});

describe('api/user/security/password route', () => {
  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));

    expect(response.status).toBe(401);
  });

  it('rejects non-credentials accounts', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ auth_provider: 'google', password_hash: null }] });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('email/password accounts');
  });

  it('rejects an incorrect current password', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ auth_provider: 'credentials', password_hash: 'hash-1' }] });
    compareMock.mockResolvedValueOnce(false);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ currentPassword: 'wrong-pass', newPassword: 'new-pass-2' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Current password is incorrect.');
  });

  it('updates the password for credentials accounts', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ auth_provider: 'credentials', password_hash: 'hash-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hashMock).toHaveBeenCalledWith('new-pass-2', 12);
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE user_profiles'),
      ['user-1', 'new-hash'],
    );
    expect(body.success).toBe(true);
  });
});
