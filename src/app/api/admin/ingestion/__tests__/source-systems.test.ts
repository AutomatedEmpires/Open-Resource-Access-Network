import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({
  createIngestionStores: vi.fn(),
}));
const sourceSystemsStore = vi.hoisted(() => ({
  listActive: vi.fn(),
  create: vi.fn(),
}));
const sourceFeedsStore = vi.hoisted(() => ({
  listBySystem: vi.fn(),
  create: vi.fn(),
}));
const sourceFeedStatesStore = vi.hoisted(() => ({
  getByFeedId: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();

  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadRoute() {
  return import('../source-systems/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbConfigMock.mockReturnValue(true);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue({
    sourceSystems: sourceSystemsStore,
    sourceFeeds: sourceFeedsStore,
    sourceFeedStates: sourceFeedStatesStore,
  });

  sourceSystemsStore.listActive.mockResolvedValue([]);
  sourceSystemsStore.create.mockResolvedValue({ id: 'sys-1', name: '211 National' });
  sourceFeedsStore.listBySystem.mockResolvedValue([]);
  sourceFeedsStore.create.mockResolvedValue({ id: 'feed-1', feedName: '211 Export' });
  sourceFeedStatesStore.getByFeedId.mockResolvedValue(null);
  sourceFeedStatesStore.upsert.mockResolvedValue({ sourceFeedId: 'feed-1' });
});

describe('admin ingestion source system routes', () => {
  it('requires authentication before listing source systems', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('lists active source systems with feeds for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    sourceSystemsStore.listActive.mockResolvedValueOnce([
      { id: 'sys-1', name: '211 National', trustTier: 'trusted_partner' },
    ]);
    sourceFeedsStore.listBySystem.mockResolvedValueOnce([
      { id: 'feed-1', sourceSystemId: 'sys-1', feedName: '211 Export V2' },
    ]);
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '198.51.100.10' }));

    expect(rateLimitMock).toHaveBeenCalledWith('198.51.100.10', expect.any(Object));
    expect(sourceSystemsStore.listActive).toHaveBeenCalledOnce();
    expect(sourceFeedsStore.listBySystem).toHaveBeenCalledWith('sys-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceSystems: [
        {
          id: 'sys-1',
          name: '211 National',
          trustTier: 'trusted_partner',
          feeds: [{ id: 'feed-1', sourceSystemId: 'sys-1', feedName: '211 Export V2', state: null }],
        },
      ],
    });
  });

  it('validates creation input before persisting', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          name: '',
          family: 'partner_api',
          trustTier: 'trusted_partner',
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(sourceSystemsStore.create).not.toHaveBeenCalled();
    expect(sourceFeedsStore.create).not.toHaveBeenCalled();
  });

  it('creates a source system and initial feed', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    sourceSystemsStore.create.mockResolvedValueOnce({ id: 'sys-211', name: '211 National' });
    sourceFeedsStore.create.mockResolvedValueOnce({ id: 'feed-211', sourceSystemId: 'sys-211' });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        ip: '203.0.113.11',
        jsonBody: {
          name: '211 National',
          family: 'partner_api',
          trustTier: 'trusted_partner',
          homepageUrl: 'https://apiportal.211.org/',
          termsUrl: 'https://apiportal.211.org/terms',
          licenseNotes: 'Licensed for ORAN ingestion and governed publication review.',
          notes: 'Production approved nationwide 211 feed.',
          hsdsProfileUri: 'https://api.211.org/hsds-profile',
          jurisdictionScope: { kind: 'national', country: 'US' },
          isActive: false,
          domainRules: [{ type: 'suffix', value: '211.org' }],
          initialFeed: {
            feedName: '211 Export V2',
            feedType: 'api',
            feedHandler: 'ndp_211',
            baseUrl: 'https://api.211.org/resources/v2',
            healthcheckUrl: 'https://api.211.org/health',
            authType: 'api_key',
            profileUri: 'https://api.211.org/profile',
            jurisdictionScope: { kind: 'national', country: 'US' },
            refreshIntervalHours: 12,
            isActive: false,
          },
        },
      }),
    );

    expect(sourceSystemsStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '211 National',
        family: 'partner_api',
        trustTier: 'trusted_partner',
        termsUrl: 'https://apiportal.211.org/terms',
        hsdsProfileUri: 'https://api.211.org/hsds-profile',
        isActive: false,
        jurisdictionScope: { kind: 'national', country: 'US' },
        domainRules: [{ type: 'suffix', value: '211.org' }],
      }),
    );
    expect(sourceFeedsStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSystemId: 'sys-211',
        feedName: '211 Export V2',
        feedType: 'api',
        feedHandler: 'ndp_211',
        baseUrl: 'https://api.211.org/resources/v2',
        healthcheckUrl: 'https://api.211.org/health',
        authType: 'api_key',
        profileUri: 'https://api.211.org/profile',
        jurisdictionScope: { kind: 'national', country: 'US' },
        refreshIntervalHours: 12,
        isActive: false,
      }),
    );
    expect(sourceFeedStatesStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFeedId: 'feed-211',
        publicationMode: 'review_required',
        emergencyPause: false,
      }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      sourceSystemId: 'sys-211',
      initialFeedId: 'feed-211',
      created: true,
    });
  });

  it('creates a source system without an initial feed', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          name: 'Manual Source',
          family: 'manual',
          trustTier: 'curated',
        },
      }),
    );

    expect(sourceSystemsStore.create).toHaveBeenCalledOnce();
    expect(sourceFeedsStore.create).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
  });
});
