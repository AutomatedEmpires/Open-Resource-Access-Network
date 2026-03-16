import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSessionMock = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));
const mutableEnv = process.env as Record<string, string | undefined>;

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));
vi.mock('@/services/db/postgres', () => dbMocks);

async function loadSessionModule() {
  return import('../session');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  getServerSessionMock.mockResolvedValue(null);
  dbMocks.isDatabaseConfigured.mockReturnValue(false);
  dbMocks.executeQuery.mockResolvedValue([]);
  delete mutableEnv.AZURE_AD_CLIENT_ID;
  vi.unstubAllEnvs();
});

describe('auth session helpers', () => {
  it('returns null when there is no active session', async () => {
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('returns null when the session has no usable user id', async () => {
    getServerSessionMock.mockResolvedValue({
      user: {},
    });
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('returns oran_admin without querying org memberships', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'oran_admin' },
    });
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-1',
      role: 'oran_admin',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns community_admin without querying org memberships', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { sub: 'user-2', role: 'community_admin' },
    });
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-2',
      role: 'community_admin',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
  });

  it('falls back to seeker when the database is unavailable', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'user@example.org' },
    });
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user@example.org',
      role: 'seeker',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
  });

  it('returns host_admin and org memberships when active rows exist', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'seeker' },
    });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ account_status: 'active' }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        { organization_id: 'org-1', role: 'host_member', status: 'active' },
        { organization_id: 'org-2', role: 'host_admin', status: 'active' },
        { organization_id: 'org-3', role: 'other', status: 'active' },
      ]);
    const { getAuthContext } = await loadSessionModule();

    const result = await getAuthContext();

    expect(result).toEqual({
      userId: 'user-1',
      role: 'host_admin',
      accountStatus: 'active',
      orgIds: ['org-1', 'org-2'],
      orgRoles: new Map([
        ['org-1', 'host_member'],
        ['org-2', 'host_admin'],
      ]),
    });
  });

  it('falls back gracefully when the org-members table lookup fails', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'host_member' },
    });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ account_status: 'active' }])
      .mockRejectedValueOnce(new Error('no table'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-1',
      role: 'host_member',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
  });

  it('returns null when session retrieval throws unexpectedly', async () => {
    getServerSessionMock.mockRejectedValueOnce(new Error('auth failed'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('reports auth configuration based on env vars', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    const { isAuthConfigured } = await loadSessionModule();

    expect(isAuthConfigured()).toBe(true);
  });

  it('enforces auth in production even without Entra config', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { shouldEnforceAuth } = await loadSessionModule();

    expect(shouldEnforceAuth()).toBe(true);
  });

  it('does not enforce auth in non-production when unconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { shouldEnforceAuth } = await loadSessionModule();

    expect(shouldEnforceAuth()).toBe(false);
  });
});
