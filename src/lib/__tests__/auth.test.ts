import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const credentialsProviderMock = vi.hoisted(() =>
  vi.fn((config: Record<string, unknown>) => config),
);
const appleProviderMock = vi.hoisted(() =>
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
vi.mock('next-auth/providers/apple', () => ({
  default: appleProviderMock,
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
  appleClientId: process.env.APPLE_CLIENT_ID,
  appleClientSecret: process.env.APPLE_CLIENT_SECRET,
  appleAuthEnabled: process.env.ORAN_ENABLE_APPLE_AUTH,
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
  delete mutableEnv.APPLE_CLIENT_ID;
  delete mutableEnv.APPLE_CLIENT_SECRET;
  delete mutableEnv.ORAN_ENABLE_APPLE_AUTH;
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

  if (originalEnv.appleClientId === undefined) {
    delete mutableEnv.APPLE_CLIENT_ID;
  } else {
    mutableEnv.APPLE_CLIENT_ID = originalEnv.appleClientId;
  }

  if (originalEnv.appleClientSecret === undefined) {
    delete mutableEnv.APPLE_CLIENT_SECRET;
  } else {
    mutableEnv.APPLE_CLIENT_SECRET = originalEnv.appleClientSecret;
  }

  if (originalEnv.appleAuthEnabled === undefined) {
    delete mutableEnv.ORAN_ENABLE_APPLE_AUTH;
  } else {
    mutableEnv.ORAN_ENABLE_APPLE_AUTH = originalEnv.appleAuthEnabled;
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
    expect(appleProviderMock).not.toHaveBeenCalled();
    expect(googleProviderMock).not.toHaveBeenCalled();
  });

  it('requires an explicit flag before enabling Apple auth', async () => {
    mutableEnv.APPLE_CLIENT_ID = 'apple-client-id';
    mutableEnv.APPLE_CLIENT_SECRET = 'apple-client-secret';

    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toHaveLength(1);
    expect(appleProviderMock).not.toHaveBeenCalled();
  });

  it('configures Apple auth only when explicitly enabled', async () => {
    mutableEnv.APPLE_CLIENT_ID = 'apple-client-id';
    mutableEnv.APPLE_CLIENT_SECRET = 'apple-client-secret';
    mutableEnv.ORAN_ENABLE_APPLE_AUTH = '1';

    const { authOptions } = await loadAuthModule();

    expect(authOptions.providers).toHaveLength(2);
    expect(appleProviderMock).toHaveBeenCalledOnce();
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
    mockPoolQuery.mockResolvedValue({ rows: [{ role: 'host_admin', account_status: 'active' }] });
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
      accountStatus: 'active',
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
      accountStatus: 'active',
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
        accountStatus: 'active',
      },
    });
  });

  it('signIn callback syncs OAuth users into user_profiles', async () => {
    const { authOptions } = await loadAuthModule();
    const signIn = authOptions.callbacks?.signIn;

    await expect(signIn?.({
      user: { id: 'oauth-user', name: 'OAuth User', email: 'oauth@example.com', role: 'seeker' },
      account: { provider: 'apple' },
    } as never)).resolves.toBe(true);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_profiles'),
      ['oauth-user', 'OAuth User', 'oauth@example.com', 'apple', 'seeker'],
    );
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

  it('session callback defaults role to seeker when token has no role', async () => {
    const { authOptions } = await loadAuthModule();
    const session = authOptions.callbacks?.session;

    const result = await session?.({
      session: { user: { name: 'Test User' } },
      token: { sub: 'user-no-role' },
    } as never);

    expect(result).toEqual({
      user: {
        name: 'Test User',
        id: 'user-no-role',
        role: 'seeker',
        accountStatus: 'active',
      },
    });
  });

  it('jwt callback falls back to user.role when getDbRole fails', async () => {
    mockPoolQuery.mockRejectedValue(new Error('DB connection lost'));
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: {},
      user: { id: 'user-dbfail', role: 'host_member' },
      account: null,
    } as never);

    expect(token).toMatchObject({
      sub: 'user-dbfail',
      role: 'host_member',
    });
  });

  it('jwt callback defaults to seeker when getDbRole fails and user has no role', async () => {
    mockPoolQuery.mockRejectedValue(new Error('DB unavailable'));
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    const token = await jwt?.({
      token: {},
      user: { id: 'user-norole' },
      account: null,
    } as never);

    expect(token).toMatchObject({
      sub: 'user-norole',
      role: 'seeker',
    });
  });

  it('jwt callback bootstraps Entra role from id_token when token has no role', async () => {
    const { authOptions } = await loadAuthModule();
    const jwt = authOptions.callbacks?.jwt;

    // Simulate a subsequent call (no user) where token lacks a role
    // and account has Entra id_token with roles
    const token = await jwt?.({
      token: { sub: 'entra-user' },
      account: {
        id_token: encodeJwtPayload({ roles: ['HostAdmin'] }),
      },
    } as never);

    expect(token).toMatchObject({
      sub: 'entra-user',
      role: 'host_admin',
    });
  });

  it('Entra profile callback prefers sub over oid', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.AZURE_AD_CLIENT_SECRET = 'client-secret';
    const { authOptions } = await loadAuthModule();

    const azureAdProvider = authOptions.providers[0] as unknown as {
      profile: (profile: Record<string, unknown>) => Record<string, unknown>;
    };

    const result = azureAdProvider.profile({
      sub: 'sub-value',
      oid: 'oid-value',
      name: 'User',
      email: 'user@example.com',
      roles: [],
    });

    expect(result.id).toBe('sub-value');
  });
});

describe('credentials authorize', () => {
  it('returns user on valid credentials', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'u1',
          display_name: 'Alice',
          email: 'alice@example.com',
          username: 'alice',
          phone: '+15551234567',
          password_hash: '$2a$10$hash',
          role: 'seeker',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'Alice@Example.com',
      password: 'password123',
    });

    expect(result).toEqual({
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'seeker',
      accountStatus: 'active',
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(password_hash, '') <> ''"),
      ['alice@example.com', 'alice@example.com', '__oran_no_phone__'],
    );
  });

  it('accepts username as the credentials identifier', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'u2',
          display_name: null,
          email: 'alice@example.com',
          username: 'alice',
          phone: null,
          password_hash: '$2a$10$hash',
          role: 'host_member',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'Alice',
      password: 'password123',
    });

    expect(result).toEqual({
      id: 'u2',
      name: 'alice',
      email: 'alice@example.com',
      role: 'host_member',
      accountStatus: 'active',
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('regexp_replace'),
      ['alice', 'alice', '__oran_no_phone__'],
    );
  });

  it('accepts phone as the credentials identifier', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'u3',
          display_name: 'Phone User',
          email: null,
          username: null,
          phone: '+15551234567',
          password_hash: '$2a$10$hash',
          role: 'seeker',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: '(555) 123-4567',
      password: 'password123',
    });

    expect(result).toEqual({
      id: 'u3',
      name: 'Phone User',
      email: undefined,
      role: 'seeker',
      accountStatus: 'active',
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('regexp_replace'),
      ['(555) 123-4567', '(555) 123-4567', '5551234567'],
    );
  });

  it('returns null when user is not found', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({ rows: [] });
    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'nobody@example.com',
      password: 'password',
    });

    expect(result).toBeNull();
  });

  it('returns null on password mismatch', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(false as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'u1',
          display_name: 'Alice',
          email: 'alice@example.com',
          password_hash: '$2a$10$hash',
          role: 'seeker',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'alice@example.com',
      password: 'wrongpassword',
    });

    expect(result).toBeNull();
  });

  it('returns null when DB query throws', async () => {
    mockPoolQuery.mockRejectedValue(new Error('DB connection error'));
    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'alice@example.com',
      password: 'password',
    });

    expect(result).toBeNull();
  });

  it('returns null when credentials are missing', async () => {
    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds?: { identifier?: string; password?: string }) => Promise<unknown>;
    };

    expect(await credProvider.authorize({})).toBeNull();
    expect(await credProvider.authorize({ identifier: 'a@b.com' })).toBeNull();
    expect(await credProvider.authorize({ password: 'p' })).toBeNull();
  });

  it('accepts password sign-in for an azure-ad profile when a password hash exists', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'account_status' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'owner-1',
          display_name: 'Owner',
          email: 'jackson@automatedempires.com',
          username: 'jackson',
          phone: '+15098508326',
          password_hash: '$2a$10$hash',
          role: 'oran_admin',
          account_status: 'active',
          auth_provider: 'azure-ad',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'jackson@automatedempires.com',
      password: 'Spaceman.0812!',
    });

    expect(result).toEqual({
      id: 'owner-1',
      name: 'Owner',
      email: 'jackson@automatedempires.com',
      role: 'oran_admin',
      accountStatus: 'active',
    });
  });

  it('defaults legacy schemas without account_status to active', async () => {
    const bcrypt = await import('bcryptjs');
    vi.mocked(bcrypt.default.compare).mockResolvedValue(true as never);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'email' }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'legacy-owner',
          display_name: 'Legacy Owner',
          email: 'jackson@automatedempires.com',
          username: 'jackson',
          phone: '+15098508326',
          password_hash: '$2a$10$hash',
          role: 'oran_admin',
        }],
      });

    const { authOptions } = await loadAuthModule();
    const credProvider = authOptions.providers.find(
      (p) => (p as unknown as { id: string }).id === 'credentials',
    ) as unknown as {
      authorize: (creds: { identifier: string; password: string }) => Promise<unknown>;
    };

    const result = await credProvider.authorize({
      identifier: 'jackson@automatedempires.com',
      password: 'Spaceman.0812!',
    });

    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.not.stringContaining('account_status'),
      ['jackson@automatedempires.com', 'jackson@automatedempires.com', '__oran_no_phone__'],
    );
    expect(result).toEqual({
      id: 'legacy-owner',
      name: 'Legacy Owner',
      email: 'jackson@automatedempires.com',
      role: 'oran_admin',
      accountStatus: 'active',
    });
  });
});
