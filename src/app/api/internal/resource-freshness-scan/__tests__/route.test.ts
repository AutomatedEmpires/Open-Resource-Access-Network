import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  rejectUnauthorizedInternalRequest: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));

const freshnessMocks = vi.hoisted(() => ({
  scanResourceFreshness: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());
const captureMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/auth/internalRequest', () => authMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/freshness/resourceFreshness', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/freshness/resourceFreshness')>();
  return {
    ...original,
    scanResourceFreshness: freshnessMocks.scanResourceFreshness,
  };
});
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

const emptyResult = {
  checkedCount: 0,
  findingCount: 0,
  blockedCount: 0,
  expiredBlockedCount: 0,
  staleBlockedCount: 0,
  reverificationDueBlockedCount: 0,
  staleSourceBlockedCount: 0,
  unknownSourceBlockedCount: 0,
  protectedAuthoritySkippedCount: 0,
  enqueuedCount: 0,
  linkedToExistingCount: 0,
  resolvedCount: 0,
  confirmedUnavailableCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.rejectUnauthorizedInternalRequest.mockReturnValue(null);
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  freshnessMocks.scanResourceFreshness.mockResolvedValue(emptyResult);
  captureExceptionMock.mockResolvedValue(undefined);
  captureMessageMock.mockResolvedValue(undefined);
});

describe('/api/internal/resource-freshness-scan', () => {
  it('rejects unauthorized cron requests before touching the database', async () => {
    authMocks.rejectUnauthorizedInternalRequest.mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const { GET } = await import('../route');
    const response = await GET(new NextRequest('https://oran.test/api/internal/resource-freshness-scan'));

    expect(response.status).toBe(401);
    expect(dbMocks.isDatabaseConfigured).not.toHaveBeenCalled();
    expect(freshnessMocks.scanResourceFreshness).not.toHaveBeenCalled();
  });

  it('fails closed when the production database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const response = await GET(new NextRequest('https://oran.test/api/internal/resource-freshness-scan'));

    expect(response.status).toBe(503);
    expect(freshnessMocks.scanResourceFreshness).not.toHaveBeenCalled();
  });

  it('supports Vercel Cron GET and clamps the daily batch size', async () => {
    const { GET } = await import('../route');
    const response = await GET(new NextRequest(
      'https://oran.test/api/internal/resource-freshness-scan?limit=9999',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(freshnessMocks.scanResourceFreshness).toHaveBeenCalledWith({ limit: 100 });
    expect(body).toMatchObject({ success: true, ...emptyResult });
    expect(typeof body.checkedAt).toBe('string');
  });

  it('supports an authenticated POST override with a minimum batch size of one', async () => {
    const { POST } = await import('../route');
    const response = await POST(new NextRequest(
      'https://oran.test/api/internal/resource-freshness-scan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 0 }),
      },
    ));

    expect(response.status).toBe(200);
    expect(freshnessMocks.scanResourceFreshness).toHaveBeenCalledWith({ limit: 1 });
  });

  it('alerts without identifiers when protected authority work is skipped', async () => {
    freshnessMocks.scanResourceFreshness.mockResolvedValue({
      ...emptyResult,
      protectedAuthoritySkippedCount: 2,
    });
    const { GET } = await import('../route');
    const response = await GET(new NextRequest(
      'https://oran.test/api/internal/resource-freshness-scan',
    ));

    expect(response.status).toBe(200);
    expect(captureMessageMock).toHaveBeenCalledWith(
      'Protected authority freshness review requires owner action',
      'warning',
      {
        feature: 'resource_freshness_protected_authority',
        extra: { protectedAuthoritySkippedCount: 2 },
      },
    );
  });

  it('captures scanner failures without exposing database details', async () => {
    freshnessMocks.scanResourceFreshness.mockRejectedValue(new Error('private db detail'));
    const { GET } = await import('../route');
    const response = await GET(new NextRequest('https://oran.test/api/internal/resource-freshness-scan'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Resource freshness scan failed' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'resource_freshness_scan',
    });
  });
});
