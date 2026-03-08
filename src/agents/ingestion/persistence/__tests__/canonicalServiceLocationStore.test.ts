import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleCanonicalServiceLocationStore } from '../canonicalServiceLocationStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];

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
        const rows = returningResults.shift() ?? [];
        return {
          returning: vi.fn(() => Promise.resolve(rows)),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'csl-1',
    canonicalServiceId: 'csvc-1',
    canonicalLocationId: 'cloc-1',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('canonicalServiceLocationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listByService returns links for a service', async () => {
    const rows = [makeRow(), makeRow({ id: 'csl-2', canonicalLocationId: 'cloc-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalServiceLocationStore(db as never);

    expect(await store.listByService('csvc-1')).toEqual(rows);
  });

  it('listByLocation returns links for a location', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalServiceLocationStore(db as never);

    expect(await store.listByLocation('cloc-1')).toEqual(rows);
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleCanonicalServiceLocationStore(db as never);

    const result = await store.create({
      canonicalServiceId: 'csvc-1',
      canonicalLocationId: 'cloc-1',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('remove calls delete with correct where clause', async () => {
    const { db } = createMockDb();
    const store = createDrizzleCanonicalServiceLocationStore(db as never);

    await store.remove('csvc-1', 'cloc-1');
    expect(db.delete).toHaveBeenCalled();
  });
});
