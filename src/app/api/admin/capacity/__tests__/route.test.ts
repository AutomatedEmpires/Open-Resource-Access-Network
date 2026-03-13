/**
 * Unit tests for GET /api/admin/capacity
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

import { NextRequest } from 'next/server';

function createRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/capacity', {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

const adminProfileRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  user_id: 'user-123',
  pending_count: 5,
  in_review_count: 2,
  max_pending: 10,
  max_in_review: 5,
  total_verified: 50,
  total_rejected: 10,
  avg_review_hours: 3,
  last_review_at: '2025-01-01T00:00:00Z',
  coverage_states: ['ID', 'WA'],
  coverage_counties: ['ID_Kootenai'],
  coverage_zone_id: null,
  is_active: true,
  is_accepting_new: true,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([adminProfileRow]);
  authMocks.getAuthContext.mockResolvedValue({ userId: 'user-123', role: 'community_admin' });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/admin/capacity', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns 403 when user is not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  it('returns 403 when user does not have admin role', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
  });

  it('returns 404 when admin has no review profile', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(404);
  });

  it('returns capacity dashboard with scaling info', async () => {
    // totalVerified(50) + totalRejected(10) = 60 >= 20; avgReviewHours=3 < 4 → 1.5x
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userId).toBe('user-123');
    expect(body.pendingCount).toBe(5);
    expect(body.maxPending).toBe(10);
    expect(body.effectiveMaxPending).toBe(15); // 10 * 1.5 = 15
    expect(body.scalingApplied).toBe(true);
    expect(body.coverageStates).toEqual(['ID', 'WA']);
  });

  it('returns scalingApplied=false when no scaling applies', async () => {
    // avg_review_hours=8 (normal tier, 1.0x) → no scaling
    dbMocks.executeQuery.mockResolvedValueOnce([
      { ...adminProfileRow, avg_review_hours: 8 },
    ]);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    const body = await res.json();

    expect(body.effectiveMaxPending).toBe(10);
    expect(body.scalingApplied).toBe(false);
  });

  it('returns 500 when query throws', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('DB error'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
