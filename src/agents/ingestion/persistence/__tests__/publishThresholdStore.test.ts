import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzlePublishThresholdStore } from '../publishThresholdStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        then: terminal.then,
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return Promise.resolve();
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
    id: 'threshold-1',
    primaryCategory: null,
    jurisdictionState: null,
    minOverallScore: 70,
    minServiceTypeTags: 2,
    minAdminApprovals: 1,
    requireOrgApproval: false,
    requiredFields: ['name', 'address'],
    isActive: true,
    ...overrides,
  };
}

describe('publishThresholdStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects the most specific matching threshold', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'default', priority: 1 }),
        makeRow({ id: 'category-only', primaryCategory: 'food', priority: 5 }),
        makeRow({ id: 'state-only', jurisdictionState: 'WA', priority: 8 }),
        makeRow({ id: 'category-and-state', primaryCategory: 'food', jurisdictionState: 'WA', priority: 3 }),
        makeRow({ id: 'mismatch', primaryCategory: 'housing', jurisdictionState: 'OR', priority: 100 }),
      ],
    ]);
    const store = createDrizzlePublishThresholdStore(db as never);

    await expect(store.findBestMatch('food', 'WA')).resolves.toEqual(
      expect.objectContaining({
        id: 'category-and-state',
        category: 'food',
        jurisdictionState: 'WA',
        minConfidenceScore: 70,
        minConfirmedTags: 2,
        requiredChecklistItems: ['name', 'address'],
        minAdminApprovals: 1,
        requireOrgApproval: false,
        isActive: true,
      }),
    );
  });

  it('returns null when there are no active thresholds', async () => {
    const { db } = createMockDb([[]]);
    const store = createDrizzlePublishThresholdStore(db as never);

    await expect(store.findBestMatch('food', 'WA')).resolves.toBeNull();
  });

  it('lists active thresholds and preserves undefined category/state mappings', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'one', primaryCategory: 'housing', jurisdictionState: 'WA', requiredFields: ['name'] }),
        makeRow({ id: 'two', primaryCategory: null, jurisdictionState: null, requiredFields: [] }),
      ],
    ]);
    const store = createDrizzlePublishThresholdStore(db as never);

    await expect(store.listActive()).resolves.toEqual([
      expect.objectContaining({
        id: 'one',
        category: 'housing',
        jurisdictionState: 'WA',
        requiredChecklistItems: ['name'],
      }),
      expect.objectContaining({
        id: 'two',
        category: undefined,
        jurisdictionState: undefined,
        requiredChecklistItems: [],
      }),
    ]);
  });

  it('updates existing thresholds and inserts new thresholds through upsert', async () => {
    const { db, insertValues, updateSets } = createMockDb();
    const store = createDrizzlePublishThresholdStore(db as never);

    await store.upsert({
      id: 'threshold-1',
      category: 'food',
      jurisdictionState: 'WA',
      minConfidenceScore: 85,
      minConfirmedTags: 3,
      maxPendingTags: 1,
      requiredChecklistItems: ['name', 'hours'],
      minAdminApprovals: 2,
      requireOrgApproval: true,
      priority: 10,
      isActive: true,
    });

    await store.upsert({
      category: 'housing',
      minConfidenceScore: 75,
      minConfirmedTags: 2,
      maxPendingTags: 2,
      requiredChecklistItems: ['name'],
      minAdminApprovals: 1,
      requireOrgApproval: false,
      priority: 1,
      isActive: true,
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        primaryCategory: 'food',
        jurisdictionState: 'WA',
        minOverallScore: 85,
        minServiceTypeTags: 3,
        minAdminApprovals: 2,
        requireOrgApproval: true,
        requiredFields: ['name', 'hours'],
        isActive: true,
        updatedAt: expect.any(Date),
      }),
    );
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        primaryCategory: 'housing',
        jurisdictionState: undefined,
        minOverallScore: 75,
        minServiceTypeTags: 2,
        minAdminApprovals: 1,
        requireOrgApproval: false,
        requiredFields: ['name'],
        isActive: true,
      }),
    );
  });
});
