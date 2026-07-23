import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authSessionMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const guardsMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));
const mergeServiceMocks = vi.hoisted(() => ({
  mergeOrganizations: vi.fn(),
  previewOrganizationMerge: vi.fn(),
  mergeServices: vi.fn(),
}));
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authSessionMocks);
vi.mock('@/services/auth/guards', () => guardsMocks);
vi.mock('@/services/merge/service', () => mergeServiceMocks);

type RequestOptions = {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
};

function createRequest(options: RequestOptions = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadOrgMergeRoute() {
  return import('../merge/organizations/route');
}

async function loadServiceMergeRoute() {
  return import('../merge/services/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authSessionMocks.getAuthContext.mockResolvedValue({
    userId: 'oran-admin-1',
    role: 'oran_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardsMocks.requireMinRole.mockReturnValue(true);

  mergeServiceMocks.previewOrganizationMerge.mockResolvedValue({
    targetId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    movedServices: 2,
  });
  mergeServiceMocks.mergeOrganizations.mockResolvedValue({ success: true });
  mergeServiceMocks.mergeServices.mockResolvedValue({ success: true });
});

describe('admin organization merge route', () => {
  it('rejects unavailable DB, rate limits, and invalid preview params', async () => {
    const { GET } = await loadOrgMergeRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const unavailable = await GET(createRequest());
    expect(unavailable.status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 19 });
    const limited = await GET(
      createRequest({
        search: '?targetId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('19');

    rateLimitMock.mockReturnValueOnce({ exceeded: false, retryAfterSeconds: 0 });
    const invalid = await GET(createRequest({ search: '?targetId=bad-id' }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual(
      expect.objectContaining({ error: 'Validation failed' }),
    );
  });

  it('enforces auth/role and returns preview payload', async () => {
    const { GET } = await loadOrgMergeRoute();

    authSessionMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(createRequest());
    expect(unauth.status).toBe(401);

    authSessionMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'community-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    guardsMocks.requireMinRole.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);

    const ok = await GET(
      createRequest({
        search: '?targetId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({
      targetId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      movedServices: 2,
    });
  });

  it('executes merge on POST and handles domain + server failures', async () => {
    const { POST } = await loadOrgMergeRoute();

    const ok = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ success: true });

    mergeServiceMocks.mergeOrganizations.mockResolvedValueOnce({
      success: false,
      error: 'cannot merge archived source',
    });
    const unprocessable = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(unprocessable.status).toBe(422);
    await expect(unprocessable.json()).resolves.toEqual({
      error: 'cannot merge archived source',
    });

    mergeServiceMocks.mergeOrganizations.mockRejectedValueOnce(new Error('merge exploded'));
    const failed = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

describe('admin service merge route', () => {
  it('validates auth, input, and executes merge', async () => {
    const { POST } = await loadServiceMergeRoute();

    const badBody = await POST(createRequest({ jsonBody: { targetId: 'bad' } }));
    expect(badBody.status).toBe(400);

    const ok = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ success: true });

    mergeServiceMocks.mergeServices.mockResolvedValueOnce({
      success: false,
      error: 'source already merged',
    });
    const unprocessable = await POST(
      createRequest({
        jsonBody: {
          targetId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    );
    expect(unprocessable.status).toBe(422);
  });
});

// Admin bulk advance coverage moved to src/app/api/admin/bulk/advance/__tests__/route.test.ts
// alongside the preflight-guard rewrite of that route.
