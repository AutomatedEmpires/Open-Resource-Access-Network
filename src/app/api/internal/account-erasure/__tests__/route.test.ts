import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfiguredMock = vi.hoisted(() => vi.fn());
const erasureMocks = vi.hoisted(() => ({
  claimAccountErasures: vi.fn(),
  processAccountErasurePages: vi.fn(),
}));
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({ isDatabaseConfigured: dbConfiguredMock }));
vi.mock('@/services/privacy/accountErasure', () => erasureMocks);
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

import { GET } from '../route';
import { NextRequest } from 'next/server';

function request(secret?: string) {
  return new NextRequest('https://oran.test/api/internal/account-erasure', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.stubEnv('INTERNAL_API_KEY', 'internal-secret');
  dbConfiguredMock.mockReturnValue(true);
  erasureMocks.claimAccountErasures.mockResolvedValue([]);
  erasureMocks.processAccountErasurePages.mockResolvedValue({
    completed: true,
    requestId: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    pagesProcessed: 2,
  });
});

describe('internal account erasure retry route', () => {
  it('rejects unauthenticated calls before reading the outbox', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(erasureMocks.claimAccountErasures).not.toHaveBeenCalled();
  });

  it('fails closed when the database is unavailable', async () => {
    dbConfiguredMock.mockReturnValue(false);
    const res = await GET(request('cron-secret'));
    expect(res.status).toBe(503);
  });

  it('processes a bounded claimed batch and reports pending retries', async () => {
    erasureMocks.claimAccountErasures
      .mockResolvedValueOnce([
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        status: 'processing',
        userId: 'user-1',
        clerkUserId: 'user_clerk_1',
      },
      ])
      .mockResolvedValueOnce([
        {
        requestId: '22222222-2222-4222-8222-222222222222',
        status: 'processing',
        userId: 'user-2',
        clerkUserId: 'user_clerk_2',
        },
      ])
      .mockResolvedValueOnce([]);
    erasureMocks.processAccountErasurePages
      .mockResolvedValueOnce({
        completed: true, requestId: 'one', status: 'completed', pagesProcessed: 3,
      })
      .mockResolvedValueOnce({
        completed: false, requestId: 'two', status: 'processing', pagesProcessed: 8,
      });

    const res = await GET(request('cron-secret'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      claimed: 2,
      processed: 2,
      pagesProcessed: 11,
      completed: 1,
      pending: 1,
    });
    expect(erasureMocks.claimAccountErasures).toHaveBeenCalledTimes(3);
    expect(erasureMocks.claimAccountErasures).toHaveBeenCalledWith(1);
    expect(erasureMocks.processAccountErasurePages).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: '11111111-1111-4111-8111-111111111111' }),
      expect.objectContaining({ maxPages: 8 }),
    );
  });

  it('never leases a later request before the current one is attempted', async () => {
    const callOrder: string[] = [];
    erasureMocks.claimAccountErasures.mockReset();
    erasureMocks.processAccountErasurePages.mockReset();
    erasureMocks.claimAccountErasures
      .mockImplementationOnce(async () => {
        callOrder.push('claim');
        return [{
          requestId: '11111111-1111-4111-8111-111111111111',
          status: 'processing',
          userId: 'user-1',
          clerkUserId: 'user_clerk_1',
        }];
      })
      .mockResolvedValueOnce([]);
    erasureMocks.processAccountErasurePages.mockImplementationOnce(async () => {
      callOrder.push('process');
      return {
        completed: false, requestId: 'one', status: 'processing', pagesProcessed: 1,
      };
    });

    const res = await GET(request('cron-secret'));
    expect(res.status).toBe(200);
    expect(callOrder.slice(0, 2)).toEqual(['claim', 'process']);
    expect(erasureMocks.claimAccountErasures).toHaveBeenNthCalledWith(1, 1);
  });
});
