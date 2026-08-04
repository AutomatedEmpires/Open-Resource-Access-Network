import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleTagConfirmationStore } from '../tagConfirmationStore';

function createMockDb(selectResults: unknown[] = [], executeResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const deleteWhereCalls: unknown[] = [];

  const db = {
    execute: vi.fn((_statement: unknown) => Promise.resolve(executeResults.shift() ?? { rows: [] })),
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
        return {
          then: (
            onFulfilled?: ((value: void) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve().then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((value: unknown) => {
        deleteWhereCalls.push(value);
        return Promise.resolve();
      }),
    })),
  };

  return { db, insertValues, updateSets, deleteWhereCalls };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'confirm-1',
    candidateId: 'cand-1',
    resourceTagId: 'tag-1',
    tagType: 'category',
    tagValue: 'housing',
    originalConfidence: 72,
    status: 'pending',
    modifiedTagValue: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNotes: null,
    evidenceId: null,
    evidenceSnippet: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    ...overrides,
  };
}

describe('tagConfirmationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates confirmation rows and maps getById responses into domain shape', async () => {
    const { db, insertValues } = createMockDb([[
      makeRow({ evidenceId: 'evidence-db-1' }),
    ]]);
    const store = createDrizzleTagConfirmationStore(db as never);

    await store.create({
      candidateId: 'cand-1',
      resourceTagId: 'tag-1',
      tagType: 'category',
      suggestedValue: 'housing',
      suggestedConfidence: 72,
      confidenceTier: 'yellow',
      confirmationStatus: 'pending',
      evidenceRefs: ['evidence-db-1'],
    } as never);

    await store.bulkCreate([
      {
        candidateId: 'cand-1',
        id: 'confirm-2',
        resourceTagId: 'tag-2',
        tagType: 'custom',
        suggestedValue: 'adults',
        suggestedConfidence: 81,
        confidenceTier: 'green',
        confirmationStatus: 'auto_approved',
        evidenceRefs: [],
      } as never,
      {
        candidateId: 'cand-1',
        resourceTagId: 'tag-3',
        tagType: 'category',
        suggestedValue: 'shelter',
        suggestedConfidence: 38,
        confidenceTier: 'red',
        confirmationStatus: 'pending',
        evidenceRefs: ['evidence-db-3'],
      } as never,
    ]);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        resourceTagId: 'tag-1',
        candidateId: 'cand-1',
        tagType: 'category',
        tagValue: 'housing',
        originalConfidence: 72,
        status: 'pending',
        evidenceId: 'evidence-db-1',
      }),
    );
    expect(insertValues[1]).toEqual([
      expect.objectContaining({
        resourceTagId: 'tag-2',
        status: 'pending',
      }),
      expect.objectContaining({
        resourceTagId: 'tag-3',
        tagValue: 'shelter',
        evidenceId: 'evidence-db-3',
      }),
    ]);

    await expect(store.getById('confirm-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'confirm-1',
        tagType: 'category',
        suggestedValue: 'housing',
        suggestedConfidence: 72,
        confidenceTier: 'yellow',
        confirmationStatus: 'pending',
        evidenceRefs: ['evidence-db-1'],
      }),
    );
  });

  it('fails closed before writing when a confirmation has no resource tag identity', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleTagConfirmationStore(db as never);
    const missingIdentity = {
      candidateId: 'cand-1',
      tagType: 'category',
      suggestedValue: 'housing',
      suggestedConfidence: 72,
      confidenceTier: 'yellow',
      confirmationStatus: 'pending',
      evidenceRefs: [],
    };

    await expect(store.create(missingIdentity as never)).rejects.toThrow(
      'requires a persisted resourceTagId',
    );
    await expect(store.bulkCreate([
      {
        ...missingIdentity,
        resourceTagId: 'tag-valid',
      } as never,
      missingIdentity as never,
    ])).rejects.toThrow('requires a persisted resourceTagId');
    expect(insertValues).toEqual([]);
  });

  it('atomically scopes pending reconciliation and preserves exact tag identities', async () => {
    const { db, insertValues, deleteWhereCalls } = createMockDb();
    const store = createDrizzleTagConfirmationStore(db as never);

    await store.replacePendingForCandidate('cand-1', 'category', [
      {
        candidateId: 'cand-1',
        resourceTagId: 'tag-stable',
        tagType: 'category',
        suggestedValue: 'housing',
        suggestedConfidence: 62,
        confidenceTier: 'yellow',
        confirmationStatus: 'pending',
        evidenceRefs: ['evidence-2'],
      } as never,
    ]);

    expect(deleteWhereCalls).toHaveLength(1);
    expect(insertValues).toEqual([
      [
        expect.objectContaining({
          candidateId: 'cand-1',
          resourceTagId: 'tag-stable',
          tagType: 'category',
          tagValue: 'housing',
          evidenceId: 'evidence-2',
        }),
      ],
    ]);
  });

  it('updates reviewer decisions and supports confidence-tier filtering in list', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'confirm-green', originalConfidence: 91 }),
        makeRow({ id: 'confirm-orange', originalConfidence: 45 }),
      ],
    ], [{ rows: [{ id: 'confirm-1' }] }]);
    const store = createDrizzleTagConfirmationStore(db as never);

    await expect(store.updateDecision(
      'cand-1',
      'confirm-1',
      'modified',
      'housing_support',
      99,
      'reviewer-1',
      'Adjusted to taxonomy canonical term',
    )).resolves.toBe('updated');

    const decisionSql = JSON.stringify(db.execute.mock.calls[0]?.[0]);
    expect(decisionSql).toContain("review_status IN ('pending', 'in_review', 'escalated')");
    expect(decisionSql).toContain('confirmation.candidate_id = locked_candidate.candidate_id');
    expect(decisionSql).toContain("confirmation.status = 'pending'");
    expect(decisionSql).toContain("actor_assignment.status = 'claimed'");
    expect(decisionSql).toContain('actor_reviewer.user_id');
    expect(decisionSql).toContain("actor_account.role = 'community_admin'");
    expect(decisionSql).not.toContain("actor_account.role IN ('community_admin', 'oran_admin')");
    expect(decisionSql).toContain("completed_review.status = 'completed'");
    expect(decisionSql).toContain('INSERT INTO public.ingestion_audit_events');
    expect(decisionSql).toContain('FOR UPDATE');

    await expect(
      store.list(
        {
          candidateId: 'cand-1',
          tagType: 'category',
          confirmationStatus: 'pending',
          reviewedByUserId: 'reviewer-1',
          confidenceTier: 'green',
        },
        50,
        0,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'confirm-green',
        confidenceTier: 'green',
      }),
    ]);
  });

  it('returns conflict when candidate ownership, open review, or pending state does not match', async () => {
    const { db } = createMockDb([], [{ rows: [] }]);
    const store = createDrizzleTagConfirmationStore(db as never);

    await expect(store.updateDecision(
      'cand-route',
      'confirm-other-or-terminal',
      'confirmed',
      undefined,
      undefined,
      'reviewer-1',
    )).resolves.toBe('conflict');

    const decisionSql = JSON.stringify(db.execute.mock.calls[0]?.[0]);
    expect(decisionSql).toContain('candidate_id');
    expect(decisionSql).toContain("review_status IN ('pending', 'in_review', 'escalated')");
    expect(decisionSql).toContain('confirmation.candidate_id = locked_candidate.candidate_id');
    expect(decisionSql).toContain("confirmation.status = 'pending'");
    expect(decisionSql).toContain("actor_assignment.status = 'claimed'");
    expect(decisionSql).toContain("completed_review.status = 'completed'");
  });

  it('lists candidate queues and pending counts by tier', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'confirm-1', status: 'pending', originalConfidence: 90 }),
        makeRow({ id: 'confirm-2', status: 'modified', originalConfidence: 55 }),
      ],
      [
        makeRow({ id: 'confirm-3', status: 'pending', originalConfidence: 90 }),
      ],
      [
        makeRow({ id: 'confirm-4', status: 'pending', originalConfidence: 85 }),
        makeRow({ id: 'confirm-5', status: 'pending', originalConfidence: 61 }),
        makeRow({ id: 'confirm-6', status: 'pending', originalConfidence: 44 }),
      ],
      [
        makeRow({
          id: 'confirm-7',
          status: 'approved',
          reviewedByUserId: 'reviewer-1',
          originalConfidence: 79,
        }),
        makeRow({ id: 'confirm-8', status: 'approved', originalConfidence: 92 }),
      ],
    ]);
    const store = createDrizzleTagConfirmationStore(db as never);

    await expect(store.listForCandidate('cand-1')).resolves.toHaveLength(2);
    await expect(store.listPendingForCandidate('cand-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'confirm-3',
        confirmationStatus: 'pending',
      }),
    ]);
    await expect(store.countPendingByTier('cand-1')).resolves.toEqual({
      green: 1,
      yellow: 1,
      orange: 1,
    });
    await expect(store.listConfirmed('cand-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'confirm-7',
        confirmationStatus: 'confirmed',
      }),
      expect.objectContaining({
        id: 'confirm-8',
        confirmationStatus: 'auto_approved',
      }),
    ]);
  });
});
