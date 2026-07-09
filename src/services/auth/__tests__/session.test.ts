import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));
const mutableEnv = process.env as Record<string, string | undefined>;

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));
vi.mock('@/services/db/postgres', () => dbMocks);

async function loadSessionModule() {
  return import('../session');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  authMock.mockResolvedValue({ userId: null });
  currentUserMock.mockResolvedValue(null);
  dbMocks.isDatabaseConfigured.mockReturnValue(false);
  dbMocks.executeQuery.mockResolvedValue([]);
  delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  vi.unstubAllEnvs();
});

describe('auth session helpers (Clerk-backed)', () => {
  it('returns null when there is no active Clerk session', async () => {
    const { getAuthContext } = await loadSessionModule();
    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('resolves oran_admin from the DB profile without querying org memberships', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'oran_admin', account_status: 'active' }]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-1',
      role: 'oran_admin',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
    // Only the profile query runs — no org lookup for platform admins.
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('resolves community_admin without querying org memberships', async () => {
    authMock.mockResolvedValue({ userId: 'user-2' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'community_admin', account_status: 'active' }]);
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
    authMock.mockResolvedValue({ userId: 'user-9' });
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      userId: 'user-9',
      role: 'seeker',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
  });

  it('creates a seeker profile on first sight and returns seeker', async () => {
    authMock.mockResolvedValue({ userId: 'new-user' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    currentUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'New@Example.org' },
      firstName: 'New',
      lastName: 'User',
    });
    // 1) profile select -> empty; 2) insert; 3) org-members exists check -> []
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { getAuthContext } = await loadSessionModule();

    const result = await getAuthContext();
    expect(result?.role).toBe('seeker');
    expect(result?.userId).toBe('new-user');
    // The insert ran (SELECT + INSERT).
    expect(dbMocks.executeQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('returns host_admin and org memberships when active rows exist', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ role: 'seeker', account_status: 'active' }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        { organization_id: 'org-1', role: 'host_member', status: 'active' },
        { organization_id: 'org-2', role: 'host_admin', status: 'active' },
        { organization_id: 'org-3', role: 'other', status: 'active' },
      ]);
    const { getAuthContext } = await loadSessionModule();

    expect(await getAuthContext()).toEqual({
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
    authMock.mockResolvedValue({ userId: 'user-1' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ role: 'host_member', account_status: 'active' }])
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

  it('returns null when Clerk auth() throws unexpectedly', async () => {
    authMock.mockRejectedValueOnce(new Error('auth failed'));
    const { getAuthContext } = await loadSessionModule();
    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('reports auth configuration based on the Clerk publishable key', async () => {
    mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_123';
    const { isAuthConfigured } = await loadSessionModule();
    expect(isAuthConfigured()).toBe(true);
  });

  it('enforces auth in production even without Clerk config', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { shouldEnforceAuth } = await loadSessionModule();
    expect(shouldEnforceAuth()).toBe(true);
  });

  it('does not enforce auth in non-production when unconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { shouldEnforceAuth } = await loadSessionModule();
    expect(shouldEnforceAuth()).toBe(false);
  });

  // B2: DB error must deny access (return null) instead of assuming active.
  it('returns null when the profile lookup throws (B2 — frozen on DB error)', async () => {
    authMock.mockResolvedValue({ userId: 'frozen-user' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection refused'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });
});
