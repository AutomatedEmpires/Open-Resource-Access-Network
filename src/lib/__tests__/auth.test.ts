import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const credentialsProviderMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);

vi.mock('next-auth/providers/azure-ad', () => ({
  default: providerMock,
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: credentialsProviderMock,
}));

const originalEnv = {
  clientId: process.env.AZURE_AD_CLIENT_ID,
  clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
  tenantId: process.env.AZURE_AD_TENANT_ID,
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
  delete mutableEnv.ORAN_TEST_AUTH_ENABLED;
  delete mutableEnv.NODE_ENV;
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
  it('has no providers when Azure AD is not configured', async () => {
    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toEqual([]);
    expect(providerMock).not.toHaveBeenCalled();
  });

  it('configures the Azure AD provider when env vars are present', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.AZURE_AD_CLIENT_SECRET = 'client-secret';
    mutableEnv.AZURE_AD_TENANT_ID = 'tenant-id';
    const { authOptions } = await loadAuthModule();

    expect(providerMock).toHaveBeenCalledOnce();
    const providerConfig = authOptions.providers[0] as unknown as {
      clientId: string;
      clientSecret: string;
      tenantId: string;
      authorization: { params: { scope: string } };
      profile: (profile: Record<string, unknown>) => Record<string, unknown>;
    };

    expect(providerConfig.clientId).toBe('client-id');
    expect(providerConfig.clientSecret).toBe('client-secret');
    expect(providerConfig.tenantId).toBe('tenant-id');
    expect(providerConfig.authorization.params.scope).toBe('openid profile email');

    expect(
      providerConfig.profile({
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

  it('jwt callback seeds token state from the user and id token roles', async () => {
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: {},
      user: { id: 'user-1', role: 'seeker' },
      account: {
        id_token: encodeJwtPayload({ roles: ['CommunityAdmin'] }),
      },
    } as never);

    expect(token).toMatchObject({
      sub: 'user-1',
      role: 'community_admin',
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

    expect(credentialsProviderMock).toHaveBeenCalledOnce();
    expect(authOptions.providers).toHaveLength(1);

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
    expect(authOptions.providers).toEqual([]);
    expect(credentialsProviderMock).not.toHaveBeenCalled();
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
