import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const clientQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  acquireLock,
  advance,
  applySla,
  assignSubmission,
  bulkAdvance,
  checkSlaBreaches,
  releaseLock,
  runAutoCheck,
} from '@/services/workflow/engine';

beforeEach(() => {
  vi.clearAllMocks();

  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
    return fn({ query: clientQueryMock });
  });

  clientQueryMock.mockReset();
});

describe('workflow/engine', () => {
  it('advance returns not found when submission does not exist', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await advance({
      submissionId: 'sub-1',
      toStatus: 'approved',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Submission not found');
  });

  it('advance rejects invalid transitions and records failed transition', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-2',
          submission_type: 'service_verification',
          status: 'draft',
          is_locked: false,
          locked_by_user_id: null,
          assigned_to_user_id: null,
          service_id: null,
          submitted_by_user_id: 'user-a',
          target_type: 'service',
          target_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-failed-1' }] });

    const result = await advance({
      submissionId: 'sub-2',
      toStatus: 'approved',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
      reason: 'invalid attempt',
    });

    expect(result.success).toBe(false);
    expect(result.transitionId).toBe('transition-failed-1');
    expect(result.error).toContain('not permitted');
  });

  it('advance enforces lock gate for different lock holder', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-3',
          submission_type: 'service_verification',
          status: 'submitted',
          is_locked: true,
          locked_by_user_id: 'other-reviewer',
          assigned_to_user_id: null,
          service_id: null,
          submitted_by_user_id: 'user-a',
          target_type: 'service',
          target_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-failed-2' }] });

    const result = await advance({
      submissionId: 'sub-3',
      toStatus: 'needs_review',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked by another user');
  });

  it('advance enforces two-person gate for self-approval', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-4',
          submission_type: 'org_claim',
          status: 'pending_second_approval',
          is_locked: false,
          locked_by_user_id: null,
          assigned_to_user_id: null,
          service_id: null,
          submitted_by_user_id: 'user-self',
          target_type: 'organization',
          target_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-failed-3' }] });

    const result = await advance({
      submissionId: 'sub-4',
      toStatus: 'approved',
      actorUserId: 'user-self',
      actorRole: 'community_admin',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('two-person rule');
  });

  it('advance succeeds, records transition, and releases lock on terminal status', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-5',
          submission_type: 'service_verification',
          status: 'under_review',
          is_locked: false,
          locked_by_user_id: null,
          assigned_to_user_id: null,
          service_id: 'svc-1',
          submitted_by_user_id: 'submitter-1',
          target_type: 'service',
          target_id: 'svc-1',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-ok-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await advance({
      submissionId: 'sub-5',
      toStatus: 'approved',
      actorUserId: 'reviewer-2',
      actorRole: 'community_admin',
      reason: 'Reviewed and approved',
    });

    expect(result.success).toBe(true);
    expect(result.transitionId).toBe('transition-ok-1');
    expect(result.toStatus).toBe('approved');
  });

  it('acquireLock returns true when row is updated and false otherwise', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'sub-6' }]);
    await expect(acquireLock('sub-6', 'user-1')).resolves.toBe(true);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    await expect(acquireLock('sub-6', 'user-1')).resolves.toBe(false);
  });

  it('releaseLock supports admin and lock-holder paths', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'sub-7' }]);
    await expect(releaseLock('sub-7', 'user-1', false)).resolves.toBe(true);
    expect(dbMocks.executeQuery.mock.calls[0]?.[1]).toEqual(['sub-7', 'user-1']);

    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'sub-7' }]);
    await expect(releaseLock('sub-7', 'oran-admin', true)).resolves.toBe(true);
    expect(dbMocks.executeQuery.mock.calls[1]?.[1]).toEqual(['sub-7']);
  });

  it('assignSubmission returns false when target submission is missing', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(assignSubmission('sub-8', 'reviewer-1', 'admin-1', 'community_admin')).resolves.toBe(false);
  });

  it('assignSubmission writes audit + notification when assignment succeeds', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'sub-9' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(assignSubmission('sub-9', 'reviewer-2', 'admin-1', 'community_admin')).resolves.toBe(true);
    expect(clientQueryMock).toHaveBeenCalledTimes(3);
  });

  it('applySla skips when no SLA row exists and updates when it exists', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    await applySla('sub-10', 'service_verification');

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ review_hours: 24, escalation_hours: 48 }])
      .mockResolvedValueOnce([]);

    await applySla('sub-10', 'service_verification', 'WA');

    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('checkSlaBreaches flags overdue submissions and emits notifications', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { id: 'sub-11', submission_type: 'org_claim' },
        { id: 'sub-12', submission_type: 'removal_request' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const count = await checkSlaBreaches();

    expect(count).toBe(2);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('bulkAdvance returns empty array when no ids are passed', async () => {
    const results = await bulkAdvance([], 'approved', 'admin-1', 'community_admin');
    expect(results).toEqual([]);
  });

  it('bulkAdvance processes multiple submissions concurrently in batches', async () => {
    // Each advance call needs: SELECT submission (1 mock) + gate checks + update + transition
    // For simplicity, mock withTransaction to simulate successful advance for each
    const ids = ['sub-a', 'sub-b', 'sub-c', 'sub-d', 'sub-e', 'sub-f'];

    // withTransaction is called once per advance() call inside bulkAdvance
    let callCount = 0;
    dbMocks.withTransaction.mockImplementation(
      async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
        const idx = callCount++;
        const mockClient = {
          query: vi.fn()
            // submission row
            .mockResolvedValueOnce({
              rows: [{
                id: ids[idx],
                submission_type: 'service_verification',
                status: 'under_review',
                is_locked: false,
                locked_by_user_id: null,
                assigned_to_user_id: null,
                service_id: 'svc-1',
                submitted_by_user_id: 'submitter-1',
                target_type: 'service',
                target_id: 'svc-1',
              }],
            })
            // two-person feature flag
            .mockResolvedValueOnce({ rows: [] })
            // update status
            .mockResolvedValueOnce({ rows: [] })
            // transition record
            .mockResolvedValueOnce({ rows: [{ id: `t-${idx}` }] })
            // notification
            .mockResolvedValueOnce({ rows: [] }),
        };
        return fn(mockClient);
      },
    );

    const results = await bulkAdvance(ids, 'approved', 'reviewer-1', 'community_admin', 'batch');

    expect(results).toHaveLength(6);
    expect(results.every(r => r.success)).toBe(true);
    expect(callCount).toBe(6);
  });

  it('bulkAdvance handles individual failures without aborting the batch', async () => {
    let callCount = 0;
    dbMocks.withTransaction.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Database timeout');
      }
      return {
        success: true,
        submissionId: `sub-${callCount}`,
        fromStatus: 'under_review',
        toStatus: 'approved',
        transitionId: `t-${callCount}`,
        gateResults: [],
      };
    });

    const results = await bulkAdvance(['sub-1', 'sub-2', 'sub-3'], 'approved', 'admin', 'oran_admin');

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain('Database timeout');
    expect(results[2].success).toBe(true);
  });

  it('runAutoCheck routes to needs_review when auto-check feature is disabled', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ enabled: false }]);

    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-13',
          submission_type: 'service_verification',
          status: 'submitted',
          is_locked: false,
          locked_by_user_id: null,
          assigned_to_user_id: null,
          service_id: 'svc-13',
          submitted_by_user_id: 'system',
          target_type: 'service',
          target_id: 'svc-13',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-ok-2' }] });

    const result = await runAutoCheck('sub-13', 'system');

    expect(result.success).toBe(true);
    expect(result.toStatus).toBe('needs_review');
  });

  it('runAutoCheck auto-approves when confidence meets threshold', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ service_id: 'svc-14', score: 95 }]);

    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-14',
          submission_type: 'service_verification',
          status: 'auto_checking',
          is_locked: false,
          locked_by_user_id: null,
          assigned_to_user_id: null,
          service_id: 'svc-14',
          submitted_by_user_id: 'system',
          target_type: 'service',
          target_id: 'svc-14',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'transition-ok-3' }] });

    const result = await runAutoCheck('sub-14', 'system');

    expect(result.success).toBe(true);
    expect(result.toStatus).toBe('approved');
  });
});
