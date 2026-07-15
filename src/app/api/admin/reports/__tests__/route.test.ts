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
const engineMocks = vi.hoisted(() => ({
  advanceInTransaction: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));

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
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
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
  engineMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
  engineMocks.advanceInTransaction.mockResolvedValue({ success: true, fromStatus: 'under_review', toStatus: 'approved', transitionId: 'tr-1', submissionId: 'rep-1', gateResults: [] });
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
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { reportId: '11111111-1111-4111-8111-111111111111', decision: 'approved' } }));
    expect(response.status).toBe(404);
  });

  it('applies an integrity hold for approved high-risk reports', async () => {
    engineMocks.advanceInTransaction
      .mockResolvedValueOnce({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tr-1', submissionId: 'rep-1', gateResults: [] })
      .mockResolvedValueOnce({ success: true, fromStatus: 'under_review', toStatus: 'approved', transitionId: 'tr-2', submissionId: 'rep-1', gateResults: [] });

    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM submissions') && sql.includes("submission_type = 'community_report'")) {
        return {
          rows: [{
            status: 'submitted',
            assigned_to_user_id: null,
            is_locked: true,
            locked_by_user_id: 'admin-1',
            service_id: 'svc-1',
            reason: 'suspected_fraud',
          }],
        };
      }
      if (sql.includes('UPDATE submissions') && sql.includes('assigned_to_user_id')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      if (sql.includes('FROM services') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'svc-1' }] };
      }
      if (sql.includes('UPDATE services')) {
        return { rows: [{ id: 'svc-1' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { reportId: '11111111-1111-4111-8111-111111111111', decision: 'approved' } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integrityHoldApplied).toBe(true);
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'approved',
    );
    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(2);
    expect(engineMocks.advanceInTransaction.mock.calls.every(([txClient]) => txClient === client)).toBe(true);
    const sqlCalls = client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[0]).toContain('pg_advisory_xact_lock_shared');
    expect(sqlCalls.findIndex((sql) => sql.includes('FROM submissions'))).toBeLessThan(
      sqlCalls.findIndex((sql) => sql.includes('FROM services') && sql.includes('FOR UPDATE')),
    );
    expect(sqlCalls.findIndex((sql) => sql.includes('UPDATE services'))).toBeGreaterThan(
      sqlCalls.findIndex((sql) => sql.includes('FROM services') && sql.includes('FOR UPDATE')),
    );
  });

  it('retains and escalates protected-resource evidence without applying a hold', async () => {
    engineMocks.advanceInTransaction
      .mockResolvedValueOnce({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tr-1', submissionId: 'rep-1', gateResults: [] })
      .mockResolvedValueOnce({ success: true, fromStatus: 'under_review', toStatus: 'escalated', transitionId: 'tr-2', submissionId: 'rep-1', gateResults: [] });
    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM submissions') && sql.includes("submission_type = 'community_report'")) {
        return {
          rows: [{
            status: 'submitted',
            assigned_to_user_id: null,
            is_locked: true,
            locked_by_user_id: 'admin-1',
            service_id: 'svc-hotline',
            reason: 'suspected_fraud',
          }],
        };
      }
      if (sql.includes('FROM oran_internal.hotline_authority_members')) {
        return {
          rows: [{
            workflow: 'verified_hotline',
            entity_type: 'service',
            entity_id: 'svc-hotline',
          }],
        };
      }
      if (sql.includes('UPDATE submissions') && sql.includes('assigned_to_user_id')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      if (sql.includes('FROM services') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'svc-hotline' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        reportId: '11111111-1111-4111-8111-111111111111',
        decision: 'approved',
      },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      decision: 'escalated',
      requestedDecision: 'approved',
      integrityHoldApplied: false,
      authorityReviewRequired: true,
    }));
    expect(engineMocks.advanceInTransaction).toHaveBeenLastCalledWith(
      client,
      expect.objectContaining({ toStatus: 'escalated' }),
    );
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE services'))).toBe(false);
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'escalated',
    );
  });
});
