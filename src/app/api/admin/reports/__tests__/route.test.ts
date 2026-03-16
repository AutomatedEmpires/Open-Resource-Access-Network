import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({ advance: vi.fn(), acquireLock: vi.fn(), releaseLock: vi.fn() }));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/workflow/engine', () => engineMocks);

function createRequest(options: { search?: string; jsonBody?: unknown; jsonError?: boolean } = {}) {
  const url = new URL(`https://oran.test/api/admin/reports${options.search ?? ''}`);
  return {
    headers: new Headers({ 'x-forwarded-for': '203.0.113.2' }),
    nextUrl: url,
    json: options.jsonError ? vi.fn().mockRejectedValue(new Error('bad json')) : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createClient() {
  return { query: vi.fn() };
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: ReturnType<typeof createClient>) => unknown) => fn(createClient()));
  authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin', accountStatus: 'active', orgIds: [], orgRoles: new Map() });
  requireMinRoleMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.releaseLock.mockResolvedValue(true);
  engineMocks.advance.mockResolvedValue({ success: true, fromStatus: 'under_review', toStatus: 'approved', transitionId: 'tr-1', submissionId: 'rep-1', gateResults: [] });
});

describe('GET /api/admin/reports', () => {
  it('lists report submissions', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'rep-1',
        status: 'submitted',
        title: 'Report: suspected fraud',
        notes: 'Phone number routes to scam line',
        reviewer_notes: null,
        submitted_by_user_id: 'user-1',
        assigned_to_user_id: null,
        service_id: 'svc-1',
        reason: 'suspected_fraud',
        contact_email: null,
        reporter_authenticated: true,
        created_at: '2026-03-16T12:00:00.000Z',
        updated_at: '2026-03-16T12:00:00.000Z',
        service_name: 'Food Pantry',
        organization_name: 'Helping Hands',
        integrity_hold_at: null,
      }])
      .mockResolvedValueOnce([{ count: '1' }]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest({ search: '?status=submitted' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results[0].is_high_risk).toBe(true);
  });
});

describe('POST /api/admin/reports', () => {
  it('returns 404 when the report does not exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { reportId: '11111111-1111-4111-8111-111111111111', decision: 'approved' } }));
    expect(response.status).toBe(404);
  });

  it('applies an integrity hold for approved high-risk reports', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ status: 'submitted', service_id: 'svc-1', reason: 'suspected_fraud' }])
      .mockResolvedValueOnce([]);
    engineMocks.advance
      .mockResolvedValueOnce({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tr-1', submissionId: 'rep-1', gateResults: [] })
      .mockResolvedValueOnce({ success: true, fromStatus: 'under_review', toStatus: 'approved', transitionId: 'tr-2', submissionId: 'rep-1', gateResults: [] });

    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'svc-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { reportId: '11111111-1111-4111-8111-111111111111', decision: 'approved' } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integrityHoldApplied).toBe(true);
  });
});
