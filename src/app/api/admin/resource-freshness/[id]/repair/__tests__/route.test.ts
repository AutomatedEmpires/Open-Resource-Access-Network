import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  requireMinRole: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const repairMocks = vi.hoisted(() => {
  class ConflictError extends Error {}
  return {
    repair: vi.fn(),
    ConflictError,
  };
});

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => ({
  getAuthContext: authMocks.getAuthContext,
}));
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: authMocks.requireMinRole,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/freshness/resourceFreshnessRepair', () => ({
  RESOURCE_FRESHNESS_REPAIR_REASON_MIN_LENGTH: 10,
  RESOURCE_FRESHNESS_REPAIR_REASON_MAX_LENGTH: 500,
  ResourceFreshnessRepairConflictError: repairMocks.ConflictError,
  repairResourceFreshnessPacketInTransaction: repairMocks.repair,
}));

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const FINDING_ID = '22222222-2222-4222-8222-222222222222';

function request(options: {
  body?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.body),
  } as never;
}

function ctx(id = SUBMISSION_ID) {
  return { params: Promise.resolve({ id }) } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: object) => Promise<unknown>) => (
    callback({ query: vi.fn() })
  ));
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'oran-admin-1',
    role: 'oran_admin',
  });
  authMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  repairMocks.repair.mockResolvedValue({
    kind: 'repaired',
    submissionId: SUBMISSION_ID,
    serviceId: '33333333-3333-4333-8333-333333333333',
    findingId: FINDING_ID,
    packet: {},
  });
});

describe('POST /api/admin/resource-freshness/[id]/repair', () => {
  it('fails closed for database, UUID, shared limiter, authentication, and ORAN role guards', async () => {
    const { POST } = await loadRoute();
    const body = { reason: 'Rebuild packet from the private finding.' };

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await POST(request({ body }), ctx())).status).toBe(503);

    expect((await POST(request({ body }), ctx('not-a-uuid'))).status).toBe(400);

    rateLimitMock.mockResolvedValueOnce({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 60,
    });
    const unavailable = await POST(request({ body, ip: '203.0.113.5' }), ctx());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('Retry-After')).toBe('60');

    rateLimitMock.mockResolvedValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await POST(request({ body }), ctx());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await POST(request({ body }), ctx())).status).toBe(401);

    authMocks.requireMinRole.mockReturnValueOnce(false);
    expect((await POST(request({ body }), ctx())).status).toBe(403);
    expect(authMocks.requireMinRole).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'oran_admin' }),
      'oran_admin',
    );
    expect(repairMocks.repair).not.toHaveBeenCalled();
  });

  it('accepts only strict JSON with a trimmed bounded reason', async () => {
    const { POST } = await loadRoute();

    expect((await POST(request({ jsonError: true }), ctx())).status).toBe(400);
    expect((await POST(request({ body: {} }), ctx())).status).toBe(400);
    expect((await POST(request({ body: { reason: 'short' } }), ctx())).status).toBe(400);
    expect((await POST(request({ body: { reason: 'x'.repeat(501) } }), ctx())).status).toBe(400);
    expect((await POST(request({
      body: {
        reason: 'A sufficiently detailed repair reason.',
        status: 'approved',
      },
    }), ctx())).status).toBe(400);
    expect(repairMocks.repair).not.toHaveBeenCalled();
  });

  it('runs the repair once in one transaction and returns no-store success', async () => {
    const { POST } = await loadRoute();
    const client = { query: vi.fn() };
    dbMocks.withTransaction.mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => Promise<unknown>) => callback(client),
    );

    const response = await POST(request({
      body: { reason: '  Restore from the authoritative private finding.  ' },
      ip: '198.51.100.7',
    }), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      id: SUBMISSION_ID,
      findingId: FINDING_ID,
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rateLimitMock).toHaveBeenCalledWith(
      'admin:resource-freshness:repair:198.51.100.7',
      expect.objectContaining({ maxRequests: 30 }),
    );
    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(repairMocks.repair).toHaveBeenCalledWith(client, {
      submissionId: SUBMISSION_ID,
      actorUserId: 'oran-admin-1',
      actorRole: 'oran_admin',
      reason: 'Restore from the authoritative private finding.',
    });
  });

  it('returns 409 for unreconstructable, mismatched, or guarded-update conflicts', async () => {
    const { POST } = await loadRoute();
    const body = { reason: 'Restore from the authoritative private finding.' };

    repairMocks.repair.mockResolvedValueOnce({
      kind: 'conflict',
      reason: 'packet_already_valid',
    });
    const unreconstructable = await POST(request({ body }), ctx());
    expect(unreconstructable.status).toBe(409);

    dbMocks.withTransaction.mockRejectedValueOnce(new repairMocks.ConflictError());
    const raced = await POST(request({ body }), ctx());
    expect(raced.status).toBe(409);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('captures unexpected transaction errors without disclosing internals', async () => {
    const { POST } = await loadRoute();
    const error = new Error('database unavailable');
    dbMocks.withTransaction.mockRejectedValueOnce(error);

    const response = await POST(request({
      body: { reason: 'Restore from the authoritative private finding.' },
    }), ctx());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      feature: 'api_admin_resource_freshness_repair',
    });
  });
});
