import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeQueryMock = vi.hoisted(() => vi.fn());
const deleteUserMock = vi.hoisted(() => vi.fn());
const clerkClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({ executeQuery: executeQueryMock }));
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: clerkClientMock }));

import {
  claimAccountErasures,
  processAccountErasure,
  processAccountErasurePages,
  queueAccountErasure,
} from '../accountErasure';

const request = {
  requestId: '11111111-1111-4111-8111-111111111111',
  userId: 'oran-user',
  clerkUserId: 'user_clerk_1',
  status: 'processing' as const,
};

const processingPage = {
  request_status: 'processing',
  clerk_deleted: true,
  completed: false,
  next_step: 'saved_services',
};

beforeEach(() => {
  vi.clearAllMocks();
  clerkClientMock.mockResolvedValue({ users: { deleteUser: deleteUserMock } });
  deleteUserMock.mockResolvedValue({ id: 'user_clerk_1' });
});

describe('durable account erasure service', () => {
  it('queues opaque text and UUID tombstones without exposing either identity', async () => {
    executeQueryMock.mockResolvedValueOnce([{
      request_id: request.requestId,
      request_status: 'pending',
    }]);
    const queued = await queueAccountErasure('oran-user', 'user_clerk_1');
    expect(queued.requestId).toBe(request.requestId);
    const params = executeQueryMock.mock.calls[0]?.[1] as string[];
    expect(params[0]).toBe('oran-user');
    expect(params[1]).toBe('user_clerk_1');
    expect(params[2]).toMatch(/^deleted-user:[0-9a-f-]{36}$/);
    expect(params[2]).not.toContain('oran-user');
    expect(params[3]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records Clerk deletion before advancing exactly one bounded page', async () => {
    executeQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([processingPage]);
    const result = await processAccountErasure(request);
    expect(result).toMatchObject({
      completed: false,
      status: 'processing',
      accessRevoked: true,
      identityProviderDeleted: true,
      nextStep: 'secure_data_erasure',
    });
    expect(deleteUserMock).toHaveBeenCalledWith('user_clerk_1');
    expect(String(executeQueryMock.mock.calls[0]?.[0])).toContain(
      'mark_clerk_account_deleted',
    );
    expect(String(executeQueryMock.mock.calls[1]?.[0])).toContain(
      'process_account_erasure_page',
    );
    expect(executeQueryMock.mock.calls[1]?.[1]).toEqual([request.requestId, 1000]);
  });

  it('treats Clerk not-found as an idempotent successful deletion', async () => {
    deleteUserMock.mockRejectedValueOnce({ status: 404 });
    executeQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([processingPage]);
    await expect(processAccountErasure(request)).resolves.toMatchObject({
      identityProviderDeleted: true,
      status: 'processing',
    });
  });

  it('records a bounded retry when Clerk deletion fails', async () => {
    deleteUserMock.mockRejectedValueOnce(new Error('provider unavailable'));
    executeQueryMock.mockResolvedValueOnce([]);
    const result = await processAccountErasure(request);
    expect(result).toMatchObject({
      completed: false,
      status: 'pending',
      identityProviderDeleted: false,
      nextStep: 'identity_provider_deletion',
    });
    expect(executeQueryMock.mock.calls[0]?.[1]).toEqual([
      request.requestId,
      'clerk_delete_failed',
    ]);
  });

  it('honestly reports external deletion when durable recording must retry', async () => {
    executeQueryMock
      .mockRejectedValueOnce(new Error('transaction failed'))
      .mockResolvedValueOnce([]);
    const result = await processAccountErasure(request);
    expect(result).toMatchObject({
      completed: false,
      identityProviderDeleted: true,
      nextStep: 'secure_data_erasure',
    });
    expect(executeQueryMock.mock.calls[1]?.[1]).toEqual([
      request.requestId,
      'clerk_delete_record_failed',
    ]);
  });

  it('records a retry when a bounded database page fails', async () => {
    executeQueryMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('page failed'))
      .mockResolvedValueOnce([]);
    const result = await processAccountErasure(request);
    expect(result).toMatchObject({
      completed: false,
      status: 'processing',
      identityProviderDeleted: true,
    });
    expect(executeQueryMock.mock.calls[2]?.[1]).toEqual([
      request.requestId,
      'database_erasure_page_failed',
    ]);
  });

  it('claims bounded work and maps the durable Clerk marker', async () => {
    executeQueryMock.mockResolvedValueOnce([{
      request_id: request.requestId,
      user_id: request.userId,
      clerk_user_id: request.clerkUserId,
      clerk_deleted: true,
    }]);
    await expect(claimAccountErasures(4)).resolves.toEqual([{
      ...request,
      clerkDeleted: true,
    }]);
    expect(String(executeQueryMock.mock.calls[0]?.[0])).toContain('clerk_deleted');
    expect(executeQueryMock.mock.calls[0]?.[1]).toEqual([4]);
  });

  it('drains several pages under an explicit page budget without retrying Clerk', async () => {
    executeQueryMock.mockResolvedValue([processingPage]);
    const result = await processAccountErasurePages(
      { ...request, clerkDeleted: true },
      { maxPages: 3, deadlineMs: Date.now() + 10_000 },
    );
    expect(result.pagesProcessed).toBe(3);
    expect(executeQueryMock).toHaveBeenCalledTimes(3);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('returns an already-completed request without external or database calls', async () => {
    await expect(processAccountErasure({
      ...request,
      status: 'completed',
    })).resolves.toMatchObject({ completed: true, nextStep: null });
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});
