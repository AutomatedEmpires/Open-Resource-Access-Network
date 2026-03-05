import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const clientQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  decideGrant,
  listPendingGrants,
  requestGrant,
  revokeGrant,
  userHasScope,
} from '@/services/workflow/two-person';

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
    return fn({ query: clientQueryMock });
  });
  clientQueryMock.mockReset();
});

describe('workflow/two-person', () => {
  it('requestGrant returns not found when scope is missing', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await requestGrant({
      userId: 'user-1',
      scopeName: 'scope:missing',
      requestedByUserId: 'admin-1',
      justification: 'Need elevated access',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('requestGrant rejects when user already has active grant', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'scope-1', requires_approval: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'grant-1' }] });

    const result = await requestGrant({
      userId: 'user-2',
      scopeName: 'submission:approve',
      requestedByUserId: 'admin-1',
      justification: 'Need for review work',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('User already has this scope grant');
  });

  it('requestGrant returns existing pending grant id when duplicate pending request exists', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'scope-2', requires_approval: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'pending-1' }] });

    const result = await requestGrant({
      userId: 'user-3',
      scopeName: 'submission:approve',
      requestedByUserId: 'admin-1',
      justification: 'Need for backup coverage',
    });

    expect(result.success).toBe(false);
    expect(result.grantId).toBe('pending-1');
  });

  it('requestGrant directly grants when two-person flag is disabled', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'scope-3', requires_approval: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'grant-direct-1' }] })
      .mockResolvedValue({ rows: [] });

    const result = await requestGrant({
      userId: 'user-4',
      scopeName: 'submission:approve',
      requestedByUserId: 'admin-1',
      justification: 'Urgent production need',
    });

    expect(result).toEqual({ success: true, grantId: 'grant-direct-1' });
  });

  it('requestGrant creates pending grant when two-person approval is required', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'scope-4', requires_approval: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pending-2' }] })
      .mockResolvedValue({ rows: [] });

    const result = await requestGrant({
      userId: 'user-5',
      scopeName: 'submission:approve',
      requestedByUserId: 'admin-1',
      justification: 'Needs second approver flow',
    });

    expect(result).toEqual({ success: true, grantId: 'pending-2' });
  });

  it('decideGrant returns not found when pending grant is missing', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await decideGrant({
      grantId: 'missing',
      decidedByUserId: 'admin-2',
      decision: 'approved',
      reason: 'LGTM',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Pending grant not found');
  });

  it('decideGrant rejects non-pending grants', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{
        id: 'pending-3',
        user_id: 'user-6',
        scope_id: 'scope-9',
        organization_id: null,
        requested_by_user_id: 'admin-1',
        status: 'approved',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }],
    });

    const result = await decideGrant({
      grantId: 'pending-3',
      decidedByUserId: 'admin-2',
      decision: 'approved',
      reason: 'Already done',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already approved');
  });

  it('decideGrant expires stale requests', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'pending-4',
          user_id: 'user-7',
          scope_id: 'scope-9',
          organization_id: null,
          requested_by_user_id: 'admin-1',
          status: 'pending',
          expires_at: new Date(Date.now() - 3600_000).toISOString(),
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await decideGrant({
      grantId: 'pending-4',
      decidedByUserId: 'admin-2',
      decision: 'approved',
      reason: 'Expired',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('decideGrant enforces two-person separation', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{
        id: 'pending-5',
        user_id: 'user-8',
        scope_id: 'scope-9',
        organization_id: null,
        requested_by_user_id: 'admin-1',
        status: 'pending',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }],
    });

    const result = await decideGrant({
      grantId: 'pending-5',
      decidedByUserId: 'admin-1',
      decision: 'approved',
      reason: 'Self-approve attempt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('two-person rule');
  });

  it('decideGrant approves and creates active grant', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'pending-6',
          user_id: 'user-9',
          scope_id: 'scope-11',
          organization_id: null,
          requested_by_user_id: 'admin-1',
          status: 'pending',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }],
      })
      .mockResolvedValue({ rows: [] });

    const result = await decideGrant({
      grantId: 'pending-6',
      decidedByUserId: 'admin-2',
      decision: 'approved',
      reason: 'Policy approved',
    });

    expect(result).toEqual({ success: true, grantId: 'pending-6' });
  });

  it('revokeGrant returns false when no active grant exists', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(revokeGrant('grant-missing', 'admin-1', 'cleanup')).resolves.toBe(false);
  });

  it('revokeGrant deactivates grant, audits, and notifies', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'grant-2', user_id: 'user-10', scope_id: 'scope-12' }] })
      .mockResolvedValue({ rows: [] });

    await expect(revokeGrant('grant-2', 'admin-1', 'no longer needed')).resolves.toBe(true);
    expect(clientQueryMock).toHaveBeenCalledTimes(3);
  });

  it('listPendingGrants supports requester exclusion filter', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'pending-7' }]);

    const rows = await listPendingGrants('admin-1');

    expect(rows).toEqual([{ id: 'pending-7' }]);
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(expect.stringContaining('requested_by_user_id != $1'), ['admin-1']);
  });

  it('userHasScope returns boolean from query result', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ has_scope: true }]);
    await expect(userHasScope('user-11', 'submission:read_all')).resolves.toBe(true);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    await expect(userHasScope('user-11', 'submission:read_all')).resolves.toBe(false);
  });
});
