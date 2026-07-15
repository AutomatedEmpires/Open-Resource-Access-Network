import { beforeEach, describe, expect, it, vi } from 'vitest';

const clerkAuthMock = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));
const mutableEnv = process.env as Record<string, string | undefined>;

vi.mock('@clerk/nextjs/server', () => ({
  auth: clerkAuthMock,
}));
vi.mock('@/services/db/postgres', () => dbMocks);

async function loadSessionModule() {
  return import('../session');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();

  mutableEnv.NODE_ENV = 'test';
  mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_oran';
  mutableEnv.CLERK_SECRET_KEY = 'sk_test_oran';
  clerkAuthMock.mockResolvedValue({ userId: null });
  dbMocks.isDatabaseConfigured.mockReturnValue(false);
  dbMocks.executeQuery.mockResolvedValue([]);
});

describe('Clerk auth session helpers', () => {
  it('returns null when there is no active Clerk identity', async () => {
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
    expect(clerkAuthMock).toHaveBeenCalledOnce();
  });

  it('uses a new Clerk subject as the canonical ORAN id for a new seeker', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_new' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      clerkUserId: 'user_clerk_new',
      userId: 'user_clerk_new',
      role: 'seeker',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
  });

  it('keeps the ORAN database id distinct for a migrated Clerk identity', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_migrated' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([{
        user_id: 'legacy-oran-user',
        role: 'oran_admin',
        account_status: 'active',
      }]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      clerkUserId: 'user_clerk_migrated',
      userId: 'legacy-oran-user',
      role: 'oran_admin',
      accountStatus: 'active',
      orgIds: [],
      orgRoles: new Map(),
    });
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('takes community admin authority from the ORAN profile, not Clerk claims', async () => {
    clerkAuthMock.mockResolvedValue({
      userId: 'user_clerk_admin',
      sessionClaims: { role: 'oran_admin' },
    });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([{
        user_id: 'oran-admin-record',
        role: 'community_admin',
        account_status: 'active',
      }]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toMatchObject({
      clerkUserId: 'user_clerk_admin',
      userId: 'oran-admin-record',
      role: 'community_admin',
      accountStatus: 'active',
    });
  });

  it('resolves active organization membership and highest host role', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_host' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([{
        user_id: 'oran-host-record',
        role: 'host_member',
        account_status: 'active',
      }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        { organization_id: 'org-1', role: 'host_member', status: 'active' },
        { organization_id: 'org-2', role: 'host_admin', status: 'active' },
        { organization_id: 'org-3', role: 'other', status: 'active' },
      ]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toEqual({
      clerkUserId: 'user_clerk_host',
      userId: 'oran-host-record',
      role: 'host_admin',
      accountStatus: 'active',
      orgIds: ['org-1', 'org-2'],
      orgRoles: new Map([
        ['org-1', 'host_member'],
        ['org-2', 'host_admin'],
      ]),
    });
  });

  it('fails closed when the security record cannot be read', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_db_error' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection refused'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('fails closed when organization authorization cannot be read', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_host' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([{
        user_id: 'oran-host-record',
        role: 'host_member',
        account_status: 'active',
      }])
      .mockRejectedValueOnce(new Error('authorization query unavailable'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('denies a frozen ORAN account even with an active Clerk session', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_frozen' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ erased: false }])
      .mockResolvedValueOnce([{
        user_id: 'oran-frozen-record',
        role: 'oran_admin',
        account_status: 'frozen',
      }]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('allows a local seeker fallback without a database', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_local' });
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toMatchObject({
      clerkUserId: 'user_clerk_local',
      userId: 'user_clerk_local',
      role: 'seeker',
      accountStatus: 'active',
    });
  });

  it('blocks a queued or completed erasure before profile fallback', async () => {
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_erased' });
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ erased: true }]);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
    expect(dbMocks.executeQuery).toHaveBeenCalledOnce();
    expect(String(dbMocks.executeQuery.mock.calls[0]?.[0])).toContain(
      'is_account_erased',
    );
  });

  it('fails closed in production when the authorization database is missing', async () => {
    mutableEnv.NODE_ENV = 'production';
    clerkAuthMock.mockResolvedValue({ userId: 'user_clerk_prod' });
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('returns null when Clerk session resolution throws', async () => {
    clerkAuthMock.mockRejectedValueOnce(new Error('Clerk unavailable'));
    const { getAuthContext } = await loadSessionModule();

    await expect(getAuthContext()).resolves.toBeNull();
  });

  it('requires both Clerk runtime keys for auth configuration', async () => {
    const { isAuthConfigured } = await loadSessionModule();
    expect(isAuthConfigured()).toBe(true);

    delete mutableEnv.CLERK_SECRET_KEY;
    expect(isAuthConfigured()).toBe(false);
  });

  it('enforces auth in production even when Clerk is misconfigured', async () => {
    mutableEnv.NODE_ENV = 'production';
    delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete mutableEnv.CLERK_SECRET_KEY;
    const { shouldEnforceAuth } = await loadSessionModule();

    expect(shouldEnforceAuth()).toBe(true);
  });

  it('does not enforce auth in non-production when Clerk is unconfigured', async () => {
    mutableEnv.NODE_ENV = 'development';
    delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete mutableEnv.CLERK_SECRET_KEY;
    const { shouldEnforceAuth } = await loadSessionModule();

    expect(shouldEnforceAuth()).toBe(false);
  });
});
