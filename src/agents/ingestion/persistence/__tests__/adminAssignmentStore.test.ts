import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAdminAssignmentStore } from '../adminAssignmentStore';

function createMockDb(
  selectResults: unknown[] = [],
  returningResults: unknown[] = [],
) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const execute = vi.fn(async (_statement?: unknown): Promise<unknown> => undefined);

  const db = {
    execute,
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        offset: vi.fn(() => Promise.resolve(result)),
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(() => terminal),
        offset: terminal.offset,
        then: terminal.then,
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        const result: any = {
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
          then: (
            onFulfilled?: ((value: void) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve().then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
        return result;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        const rows = returningResults.shift() ?? [];
        const whereResult: any = {
          returning: vi.fn(() => Promise.resolve(rows)),
          then: (
            onFulfilled?: ((value: void) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve().then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
        return {
          where: vi.fn(() => whereResult),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-1',
    candidateId: 'cand-1',
    adminProfileId: 'admin-1',
    priorityRank: 1,
    distanceMeters: '1234',
    status: 'pending',
    outcome: null,
    outcomeNotes: null,
    assignedAt: new Date('2026-01-01T00:00:00.000Z'),
    claimedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    ...overrides,
  };
}

const assignmentFixture = {
  id: 'assign-1',
  candidateId: 'cand-1',
  adminProfileId: 'admin-1',
  assignmentRank: 1,
  distanceMeters: 1234,
  assignmentStatus: 'pending',
  assignedAt: '2026-01-01T00:00:00.000Z',
  decisionDueBy: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:01.000Z',
  updatedAt: '2026-01-01T00:00:02.000Z',
} as const;

describe('adminAssignmentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps create and bulkCreate payloads into insert rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleAdminAssignmentStore(db as never);

    await store.create(assignmentFixture as never);
    await store.bulkCreate([
      assignmentFixture as never,
      {
        ...assignmentFixture,
        id: 'assign-2',
        candidateId: 'cand-2',
        adminProfileId: 'admin-2',
        assignmentRank: 2,
        distanceMeters: undefined,
        decisionDueBy: undefined,
      } as never,
    ]);
    await store.bulkCreate([]);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        adminProfileId: 'admin-1',
        assignmentType: 'geographic',
        priorityRank: 1,
        distanceMeters: '1234',
        status: 'pending',
      }),
    );
    expect(insertValues[1]).toEqual([
      expect.objectContaining({
        candidateId: 'cand-1',
        distanceMeters: '1234',
      }),
      expect.objectContaining({
        candidateId: 'cand-2',
        distanceMeters: undefined,
        expiresAt: undefined,
      }),
    ]);
    expect(insertValues).toHaveLength(2);
  });

  it('delegates reviewer routing to the database-owned capacity function', async () => {
    const { db } = createMockDb();
    db.execute
      .mockResolvedValueOnce({
        rows: [{
          assign_function_exists: true,
          assign_executable: true,
          list_function_exists: true,
          list_executable: true,
          activation_active: true,
          activation_constraint_validated: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ qualifying_reviewer_count: 3 }] });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.routeForReview?.('cand-1', 4)).resolves.toBe(3);

    expect(db.execute).toHaveBeenCalledTimes(2);
    const activationSql = JSON.stringify(db.execute.mock.calls[0]?.[0]);
    expect(activationSql).toContain(
      "activation_trigger.tgenabled IN ('O', 'A')",
    );
    expect(activationSql).toContain(
      'oran_internal.assign_candidate_reviewers(text,integer)',
    );
    expect(activationSql).toContain(
      'oran_internal.list_undercovered_candidate_reviews(integer,integer)',
    );
    expect(activationSql).toContain(
      'candidate_admin_assignments_decision_reviewer_check',
    );
    expect(activationSql).toContain('activation_constraint.convalidated IS TRUE');
  });

  it('delegates bounded undercoverage selection to the database after activation', async () => {
    const { db } = createMockDb();
    db.execute
      .mockResolvedValueOnce({
        rows: [{
          assign_function_exists: true,
          assign_executable: true,
          list_function_exists: true,
          list_executable: true,
          activation_active: true,
          activation_constraint_validated: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ candidate_id: 'cand-oldest' }, { candidate_id: 'cand-newer' }],
      });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.listCandidatesNeedingReviewerCoverage?.(25)).resolves.toEqual([
      'cand-oldest',
      'cand-newer',
    ]);

    const selectionSql = JSON.stringify(db.execute.mock.calls[1]?.[0]);
    expect(selectionSql).toContain('oran_internal.list_undercovered_candidate_reviews(');
    expect(selectionSql).toContain('AS routed(candidate_id)');
  });

  it('does not scan candidates while database-owned reviewer routing is dark', async () => {
    const { db } = createMockDb();
    db.execute.mockResolvedValueOnce({
      rows: [{
        assign_function_exists: true,
        assign_executable: false,
        list_function_exists: true,
        list_executable: false,
        activation_active: false,
        activation_constraint_validated: false,
      }],
    });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.listCandidatesNeedingReviewerCoverage?.()).resolves.toBeNull();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects unbounded reviewer repair scans', async () => {
    const { db } = createMockDb();
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.listCandidatesNeedingReviewerCoverage?.(101)).rejects.toThrow(
      'batch limit must be between 1 and 100',
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('keeps ingestion available while database-owned routing is still dark', async () => {
    const { db } = createMockDb();
    db.execute.mockResolvedValueOnce({
      rows: [{
        assign_function_exists: true,
        assign_executable: false,
        list_function_exists: true,
        list_executable: false,
        activation_active: false,
        activation_constraint_validated: false,
      }],
    });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.routeForReview?.('cand-1', 4)).resolves.toBeNull();

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when activated reviewer routing privileges drift', async () => {
    const { db } = createMockDb();
    db.execute.mockResolvedValueOnce({
      rows: [{
        assign_function_exists: true,
        assign_executable: true,
        list_function_exists: true,
        list_executable: false,
        activation_active: true,
        activation_constraint_validated: true,
      }],
    });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.routeForReview?.('cand-1', 4)).rejects.toThrow(
      'Candidate reviewer routing contract drifted after activation',
    );

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the activation trigger is disabled after 0078', async () => {
    const { db } = createMockDb();
    db.execute.mockResolvedValueOnce({
      rows: [{
        assign_function_exists: true,
        assign_executable: true,
        list_function_exists: true,
        list_executable: true,
        activation_active: false,
        activation_constraint_validated: true,
      }],
    });
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.listCandidatesNeedingReviewerCoverage?.()).rejects.toThrow(
      'Candidate reviewer routing contract drifted after activation',
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('maps select rows back into domain objects for direct lookups', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [
        makeRow({
          id: 'assign-2',
          candidateId: 'cand-2',
          adminProfileId: 'admin-2',
          status: 'completed',
          outcome: 'verified',
          outcomeNotes: 'Looks good',
          claimedAt: new Date('2026-01-01T01:00:00.000Z'),
          completedAt: new Date('2026-01-01T02:00:00.000Z'),
        }),
      ],
    ]);
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(store.getById('assign-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'assign-1',
        candidateId: 'cand-1',
        distanceMeters: 1234,
        assignmentStatus: 'pending',
        decisionDueBy: '2026-01-02T00:00:00.000Z',
      }),
    );
    await expect(store.getForCandidateAdmin('cand-2', 'admin-2')).resolves.toEqual(
      expect.objectContaining({
        id: 'assign-2',
        assignmentStatus: 'completed',
        decision: 'approve',
        decisionNotes: 'Looks good',
        acceptedAt: '2026-01-01T01:00:00.000Z',
        completedAt: '2026-01-01T02:00:00.000Z',
      }),
    );
  });

  it('applies status-specific timestamps and decision metadata when updating', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleAdminAssignmentStore(db as never);

    await store.updateStatus('assign-1', 'accepted');
    await store.updateStatus('assign-1', 'completed', 'approve', 'Verified by staff');

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'claimed',
        claimedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
        outcome: 'verified',
        outcomeNotes: 'Verified by staff',
      }),
    );
  });

  it('lists assignments, withdraws pending work, and counts pending records', async () => {
    const { db, updateSets } = createMockDb(
      [
        [makeRow(), makeRow({ id: 'assign-2', candidateId: 'cand-2' })],
        [makeRow({ id: 'assign-3', adminProfileId: 'admin-9' })],
        [makeRow({ id: 'assign-4' })],
        [{ count: 7 }],
      ],
      [[{ id: 'assign-1' }, { id: 'assign-2' }]],
    );
    const store = createDrizzleAdminAssignmentStore(db as never);

    await expect(
      store.list(
        {
          candidateId: 'cand-1',
          adminProfileId: 'admin-1',
          assignmentStatus: 'pending',
          decision: 'approve',
          isOverdue: true,
        },
        25,
        10,
      ),
    ).resolves.toHaveLength(2);
    await expect(store.listForAdmin('admin-9', ['pending'])).resolves.toHaveLength(1);
    await expect(store.listOverdue(5)).resolves.toHaveLength(1);
    await expect(store.withdrawAllForCandidate('cand-1')).resolves.toBe(2);
    await expect(store.countPending('admin-1')).resolves.toBe(7);

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'reassigned',
        updatedAt: expect.any(Date),
      }),
    );
  });
});
