import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleTagConfirmationStore } from '../tagConfirmationStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
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
  };

  return { db, insertValues, updateSets };
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
    const { db, insertValues } = createMockDb([[makeRow()]]);
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-tag-id');
    const store = createDrizzleTagConfirmationStore(db as never);

    await store.create({
      candidateId: 'cand-1',
      tagType: 'category',
      suggestedValue: 'housing',
      suggestedConfidence: 72,
      confidenceTier: 'yellow',
      confirmationStatus: 'pending',
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
      } as never,
      {
        candidateId: 'cand-1',
        tagType: 'category',
        suggestedValue: 'shelter',
        suggestedConfidence: 38,
        confidenceTier: 'red',
        confirmationStatus: 'pending',
      } as never,
    ]);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        resourceTagId: 'generated-tag-id',
        candidateId: 'cand-1',
        tagType: 'category',
        tagValue: 'housing',
        originalConfidence: 72,
        status: 'pending',
      }),
    );
    expect(insertValues[1]).toEqual([
      expect.objectContaining({
        resourceTagId: 'tag-2',
        status: 'auto_approved',
      }),
      expect.objectContaining({
        resourceTagId: 'generated-tag-id',
        tagValue: 'shelter',
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
      }),
    );

    uuidSpy.mockRestore();
  });

  it('updates reviewer decisions and supports confidence-tier filtering in list', async () => {
    const { db, updateSets } = createMockDb([
      [
        makeRow({ id: 'confirm-green', originalConfidence: 91 }),
        makeRow({ id: 'confirm-orange', originalConfidence: 45 }),
      ],
    ]);
    const store = createDrizzleTagConfirmationStore(db as never);

    await store.updateDecision(
      'confirm-1',
      'modified',
      'housing_support',
      99,
      'reviewer-1',
      'Adjusted to taxonomy canonical term',
    );

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'modified',
        modifiedTagValue: 'housing_support',
        reviewedByUserId: 'reviewer-1',
        reviewNotes: 'Adjusted to taxonomy canonical term',
        reviewedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );

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
        makeRow({ id: 'confirm-7', status: 'confirmed', originalConfidence: 79 }),
        makeRow({ id: 'confirm-8', status: 'auto_approved', originalConfidence: 92 }),
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
