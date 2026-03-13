import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const credentialsProviderMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const googleProviderMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('next-auth/providers/azure-ad', () => ({
  default: providerMock,
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: credentialsProviderMock,
}));
vi.mock('next-auth/providers/google', () => ({
  default: googleProviderMock,
}));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));
vi.mock('@/services/db/postgres', () => ({
  getPgPool: () => ({ query: mockPoolQuery }),
}));

const originalEnv = {
  clientId: process.env.AZURE_AD_CLIENT_ID,
  clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
  tenantId: process.env.AZURE_AD_TENANT_ID,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleAuthEnabled: process.env.ORAN_ENABLE_GOOGLE_AUTH,
  credentialsAuthEnabled: process.env.ORAN_ENABLE_CREDENTIALS_AUTH,
  testAuthEnabled: process.env.ORAN_TEST_AUTH_ENABLED,
  nodeEnv: process.env.NODE_ENV,
};

const mutableEnv = process.env as Record<string, string | undefined>;

async function loadAuthModule() {
  return import('../auth');
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.AZURE_AD_CLIENT_ID;
  delete mutableEnv.AZURE_AD_CLIENT_SECRET;
  delete mutableEnv.AZURE_AD_TENANT_ID;
  delete mutableEnv.GOOGLE_CLIENT_ID;
  delete mutableEnv.GOOGLE_CLIENT_SECRET;
  delete mutableEnv.ORAN_ENABLE_GOOGLE_AUTH;
  delete mutableEnv.ORAN_ENABLE_CREDENTIALS_AUTH;
  delete mutableEnv.ORAN_TEST_AUTH_ENABLED;
  delete mutableEnv.NODE_ENV;
  // Default: DB returns no role (null result)
  mockPoolQuery.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  if (originalEnv.clientId === undefined) {
    delete mutableEnv.AZURE_AD_CLIENT_ID;
  } else {
    mutableEnv.AZURE_AD_CLIENT_ID = originalEnv.clientId;
  }

  if (originalEnv.clientSecret === undefined) {
    delete mutableEnv.AZURE_AD_CLIENT_SECRET;
  } else {
    mutableEnv.AZURE_AD_CLIENT_SECRET = originalEnv.clientSecret;
  }

  if (originalEnv.tenantId === undefined) {
    delete mutableEnv.AZURE_AD_TENANT_ID;
  } else {
    mutableEnv.AZURE_AD_TENANT_ID = originalEnv.tenantId;
  }

  if (originalEnv.googleClientId === undefined) {
    delete mutableEnv.GOOGLE_CLIENT_ID;
  } else {
    mutableEnv.GOOGLE_CLIENT_ID = originalEnv.googleClientId;
  }

  if (originalEnv.googleClientSecret === undefined) {
    delete mutableEnv.GOOGLE_CLIENT_SECRET;
  } else {
    mutableEnv.GOOGLE_CLIENT_SECRET = originalEnv.googleClientSecret;
  }

  if (originalEnv.googleAuthEnabled === undefined) {
    delete mutableEnv.ORAN_ENABLE_GOOGLE_AUTH;
  } else {
    mutableEnv.ORAN_ENABLE_GOOGLE_AUTH = originalEnv.googleAuthEnabled;
  }

  if (originalEnv.credentialsAuthEnabled === undefined) {
    delete mutableEnv.ORAN_ENABLE_CREDENTIALS_AUTH;
  } else {
    mutableEnv.ORAN_ENABLE_CREDENTIALS_AUTH = originalEnv.credentialsAuthEnabled;
  }

  if (originalEnv.testAuthEnabled === undefined) {
    delete mutableEnv.ORAN_TEST_AUTH_ENABLED;
  } else {
    mutableEnv.ORAN_TEST_AUTH_ENABLED = originalEnv.testAuthEnabled;
  }

  if (originalEnv.nodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalEnv.nodeEnv;
  }
});

describe('resolveOranRole', () => {
  it('returns seeker for missing or unknown roles', async () => {
    const { resolveOranRole } = await loadAuthModule();

    expect(resolveOranRole()).toBe('seeker');
    expect(resolveOranRole([])).toBe('seeker');
    expect(resolveOranRole(['UnknownRole'])).toBe('seeker');
  });

  it('returns the highest mapped role when multiple roles are present', async () => {
    const { resolveOranRole } = await loadAuthModule();

    expect(resolveOranRole(['Seeker', 'HostMember'])).toBe('host_member');
    expect(resolveOranRole(['HostMember', 'CommunityAdmin'])).toBe('community_admin');
    expect(resolveOranRole(['Seeker', 'OranAdmin'])).toBe('oran_admin');
  });
});

describe('authOptions', () => {
  it('has only the credentials provider when Azure AD and Google are not configured outside production', async () => {
    const { authOptions } = await loadAuthModule();

    // Email/password credentials provider is always present
    expect(authOptions.providers).toHaveLength(1);
    expect(credentialsProviderMock).toHaveBeenCalledOnce();
    expect(providerMock).not.toHaveBeenCalled();
    expect(googleProviderMock).not.toHaveBeenCalled();
  });

  it('requires an explicit flag before enabling Google auth', async () => {
    mutableEnv.GOOGLE_CLIENT_ID = 'google-client-id';
    mutableEnv.GOOGLE_CLIENT_SECRET = 'google-client-secret';

    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toHaveLength(1);
    expect(googleProviderMock).not.toHaveBeenCalled();
  });

  it('configures Google auth only when explicitly enabled', async () => {
    mutableEnv.GOOGLE_CLIENT_ID = 'google-client-id';
    mutableEnv.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    mutableEnv.ORAN_ENABLE_GOOGLE_AUTH = '1';

    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toHaveLength(2);
    expect(googleProviderMock).toHaveBeenCalledOnce();
  });

  it('configures the Azure AD provider when env vars are present', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.AZURE_AD_CLIENT_SECRET = 'client-secret';
    mutableEnv.AZURE_AD_TENANT_ID = 'tenant-id';
    const { authOptions } = await loadAuthModule();

    expect(providerMock).toHaveBeenCalledOnce();
    // Azure AD + credentials (email/password)
    const azureAdProvider = authOptions.providers[0] as unknown as {
      clientId: string;
      clientSecret: string;
      tenantId: string;
      authorization: { params: { scope: string } };
      profile: (profile: Record<string, unknown>) => Record<string, unknown>;
    };

    expect(azureAdProvider.clientId).toBe('client-id');
    expect(azureAdProvider.clientSecret).toBe('client-secret');
    expect(azureAdProvider.tenantId).toBe('tenant-id');
    expect(azureAdProvider.authorization.params.scope).toBe('openid profile email');

    expect(
      azureAdProvider.profile({
        oid: 'fallback-oid',
        name: 'A User',
        email: 'user@example.com',
        roles: ['HostMember', 'Seeker'],
      }),
    ).toEqual({
      id: 'fallback-oid',
      name: 'A User',
      email: 'user@example.com',
      role: 'host_member',
    });
  });

  it('jwt callback seeds token state from the user (DB returns no role)', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: {},
      user: { id: 'user-1', role: 'seeker' },
      account: {
        id_token: encodeJwtPayload({ roles: ['CommunityAdmin'] }),
      },
    } as never);

    // DB had no role → uses user.role ('seeker')
    // id_token Entra roles are not checked when token.role is already set
    expect(token).toMatchObject({
      sub: 'user-1',
      role: 'seeker',
    });
  });

  it('jwt callback uses DB role when available', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ role: 'host_admin' }] });
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: {},
      user: { id: 'user-1', role: 'seeker' },
      account: null,
    } as never);

    expect(token).toMatchObject({
      sub: 'user-1',
      role: 'host_admin',
    });
  });

  it('jwt callback preserves the current role if id token decoding fails', async () => {
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: { role: 'host_admin', sub: 'user-2' },
      account: {
        id_token: 'invalid-token',
      },
    } as never);

    expect(token).toMatchObject({
      sub: 'user-2',
      role: 'host_admin',
    });
  });

  it('session callback exposes id and role on session.user', async () => {
    const { authOptions } = await loadAuthModule();
    const session = authOptions.callbacks?.session;

    const result = await session?.({
      session: { user: { name: 'A User' } },
      token: { sub: 'user-3', role: 'oran_admin' },
    } as never);

    expect(result).toEqual({
      user: {
        name: 'A User',
        id: 'user-3',
        role: 'oran_admin',
      },
    });
  });

  it('adds ORAN test credentials provider outside production', async () => {
    mutableEnv.ORAN_TEST_AUTH_ENABLED = '1';
    mutableEnv.NODE_ENV = 'test';
    const { authOptions } = await loadAuthModule();

    // test provider + email/password provider
    expect(credentialsProviderMock).toHaveBeenCalledTimes(2);
    expect(authOptions.providers).toHaveLength(2);

    const providerConfig = authOptions.providers[0] as unknown as {
      authorize: (credentials?: { userId?: string; role?: string }) => Promise<unknown>;
    };

    await expect(providerConfig.authorize({ userId: '  abc123 ', role: ' host_admin ' })).resolves.toEqual({
      id: 'abc123',
      name: 'Test host_admin',
      email: 'abc123@oran.test',
      role: 'host_admin',
    });
    await expect(providerConfig.authorize({ role: 'invalid' })).resolves.toBeNull();
  });

  it('does not include ORAN test credentials provider in production', async () => {
    mutableEnv.ORAN_TEST_AUTH_ENABLED = '1';
    mutableEnv.NODE_ENV = 'production';

    const { authOptions } = await loadAuthModule();
    expect(authOptions.providers).toHaveLength(0);
    expect(credentialsProviderMock).not.toHaveBeenCalled();
  });

  it('requires an explicit flag before enabling credentials auth in production', async () => {
    mutableEnv.NODE_ENV = 'production';
    mutableEnv.ORAN_ENABLE_CREDENTIALS_AUTH = '1';

    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toHaveLength(1);
    expect(credentialsProviderMock).toHaveBeenCalledOnce();
  });

  it('jwt and session callbacks preserve defaults without optional fields', async () => {
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;
    const session = authOptions.callbacks?.session;

    const token = await jwt?.({ token: { sub: 'existing-sub' } } as never);
    expect(token).toMatchObject({ sub: 'existing-sub' });

    const result = await session?.({ session: {}, token: {} } as never);
    expect(result).toEqual({});
  });
});
