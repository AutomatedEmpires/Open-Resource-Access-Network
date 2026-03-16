import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ executeQuery: vi.fn(), isDatabaseConfigured: vi.fn() }));
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

function createRequest() {
  return { headers: new Headers({ 'x-forwarded-for': '203.0.113.3' }) } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin', accountStatus: 'active', orgIds: [], orgRoles: new Map() });
  requireMinRoleMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/admin/operations/summary', () => {
  it('returns the combined summary payload', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        approvals_pending: 4,
        appeals_open: 2,
        reports_open: 3,
        high_risk_reports_open: 1,
        scopes_pending: 5,
        integrity_held_services: 6,
      }])
      .mockResolvedValueOnce([
        { id: 'sub-1', submission_type: 'community_report', status: 'submitted', title: 'Fraud report', updated_at: '2026-03-16T12:00:00.000Z' },
      ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.high_risk_reports_open).toBe(1);
    expect(body.recentActivity).toHaveLength(1);
  });
});
