import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleTagStore } from '../tagStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const deleteWhereCalls: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      let result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => {
          result = result ?? [];
          return builder;
        }),
        then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
          Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
          then: (onFulfilled: ((value: void) => unknown) | null | undefined, onRejected?: ((reason: unknown) => unknown) | null | undefined) =>
            Promise.resolve().then(onFulfilled, onRejected),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((value: unknown) => {
        deleteWhereCalls.push(value);
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

  return { db, insertValues, deleteWhereCalls, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tag-1',
    targetId: 'svc-1',
    targetType: 'service',
    tagType: 'category',
    tagValue: 'food',
    confidence: 88,
    source: 'agent',
    addedBy: 'user-1',
    addedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('tagStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps DB rows into service and candidate domain tags', async () => {
    const { db } = createMockDb([
      [
        makeRow(),
        makeRow({
          id: 'tag-2',
          targetId: 'cand-7',
          targetType: 'candidate',
          source: 'llm',
          confidence: null,
          addedBy: null,
        }),
      ],
    ]);
    const store = createDrizzleTagStore(db as never);

    const results = await store.listFor('svc-1', 'service');

    expect(results).toEqual([
      {
        id: 'tag-1',
        serviceId: 'svc-1',
        tagType: 'category',
        tagValue: 'food',
        tagConfidence: 88,
        assignedBy: 'agent',
        assignedByUserId: 'user-1',
        evidenceRefs: [],
      },
      {
        id: 'tag-2',
        candidateId: 'cand-7',
        tagType: 'category',
        tagValue: 'food',
        tagConfidence: 100,
        assignedBy: 'system',
        assignedByUserId: undefined,
        evidenceRefs: [],
      },
    ]);
  });

  it('adds and bulk-adds tags with the correct DB field mapping', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleTagStore(db as never);

    await store.add({
      id: 'tag-1',
      serviceId: 'svc-1',
      tagType: 'category',
      tagValue: 'food',
      tagConfidence: 92,
      assignedBy: 'human',
      assignedByUserId: 'admin-1',
      evidenceRefs: [],
    });

    await store.bulkAdd([
      {
        id: 'tag-2',
        candidateId: 'cand-2',
        tagType: 'audience',
        tagValue: 'youth',
        tagConfidence: 80,
        assignedBy: 'system',
        assignedByUserId: undefined,
        evidenceRefs: [],
      },
      {
        id: 'tag-3',
        serviceId: 'svc-2',
        tagType: 'program',
        tagValue: 'pantry',
        tagConfidence: 75,
        assignedBy: 'agent',
        assignedByUserId: 'agent-1',
        evidenceRefs: [],
      },
    ]);

    await store.bulkAdd([]);

    expect(insertValues).toEqual([
      {
        id: 'tag-1',
        targetId: 'svc-1',
        targetType: 'service',
        tagType: 'category',
        tagValue: 'food',
        confidence: 92,
        source: 'human',
        addedBy: 'admin-1',
      },
      [
        {
          id: 'tag-2',
          targetId: 'cand-2',
          targetType: 'candidate',
          tagType: 'audience',
          tagValue: 'youth',
          confidence: 80,
          source: 'system',
          addedBy: null,
        },
        {
          id: 'tag-3',
          targetId: 'svc-2',
          targetType: 'service',
          tagType: 'program',
          tagValue: 'pantry',
          confidence: 75,
          source: 'agent',
          addedBy: 'agent-1',
        },
      ],
    ]);
  });

  it('filters by type and finds matching target ids', async () => {
    const { db } = createMockDb([
      [makeRow({ tagType: 'category', tagValue: 'food' })],
      [{ targetId: 'svc-1' }, { targetId: 'svc-2' }],
    ]);
    const store = createDrizzleTagStore(db as never);

    await expect(store.listByType('svc-1', 'service', 'category')).resolves.toEqual([
      expect.objectContaining({ serviceId: 'svc-1', tagType: 'category', tagValue: 'food' }),
    ]);
    await expect(store.findByTag('category', 'food', 'service')).resolves.toEqual(['svc-1', 'svc-2']);
  });

  it('removes stale values and preserves durable ids for unchanged values', async () => {
    const { db, deleteWhereCalls, insertValues, updateSets } = createMockDb([
      [
        makeRow({ id: 'tag-stable', tagValue: 'food', confidence: 70 }),
        makeRow({ id: 'tag-removed', tagValue: 'transportation' }),
      ],
    ]);
    const store = createDrizzleTagStore(db as never);

    await store.remove('svc-1', 'service', 'category', 'food');
    const reconciled = await store.replaceByType('svc-1', 'service', 'category', [
      {
        id: 'new-extraction-id',
        serviceId: 'svc-1',
        tagType: 'category',
        tagValue: 'food',
        tagConfidence: 93,
        assignedBy: 'agent',
        assignedByUserId: 'agent-2',
        evidenceRefs: ['evidence-new'],
      },
      {
        id: 'tag-9',
        serviceId: 'svc-1',
        tagType: 'category',
        tagValue: 'housing',
        tagConfidence: 90,
        assignedBy: 'agent',
        assignedByUserId: 'agent-2',
        evidenceRefs: [],
      },
    ]);

    expect(deleteWhereCalls).toHaveLength(2);
    expect(updateSets).toEqual([
      {
        tagValue: 'food',
        confidence: 93,
        source: 'agent',
        addedBy: 'agent-2',
      },
    ]);
    expect(insertValues.at(-1)).toEqual({
      id: 'tag-9',
      targetId: 'svc-1',
      targetType: 'service',
      tagType: 'category',
      tagValue: 'housing',
      confidence: 90,
      source: 'agent',
      addedBy: 'agent-2',
    });
    expect(reconciled).toEqual([
      expect.objectContaining({ id: 'tag-stable', tagValue: 'food' }),
      expect.objectContaining({ id: 'tag-9', tagValue: 'housing' }),
    ]);
  });
});
