import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleTaxonomyRegistryStore } from '../taxonomyRegistryStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
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
        limit: vi.fn(() => builder),
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
    id: 'reg-1',
    name: 'AIRS/211 LA County',
    uri: 'https://example.org/airs',
    version: '2025-01',
    description: 'AIRS taxonomy',
    isDefault: false,
    status: 'active',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('taxonomyRegistryStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleTaxonomyRegistryStore(db as never);

    expect(await store.getById('reg-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findByName returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleTaxonomyRegistryStore(db as never);

    expect(await store.findByName('AIRS/211 LA County')).toEqual(row);
    expect(await store.findByName('nope')).toBeNull();
  });

  it('listActive returns active registries', async () => {
    const rows = [makeRow(), makeRow({ id: 'reg-2', name: 'Open Eligibility' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleTaxonomyRegistryStore(db as never);

    expect(await store.listActive()).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleTaxonomyRegistryStore(db as never);

    const result = await store.create({ name: 'AIRS/211 LA County' });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update sets fields and updated_at', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleTaxonomyRegistryStore(db as never);

    await store.update('reg-1', { version: '2025-06' } as any);
    expect(updateSets).toHaveLength(1);
    expect((updateSets[0] as Record<string, unknown>).version).toBe('2025-06');
    expect((updateSets[0] as Record<string, unknown>).updatedAt).toBeInstanceOf(Date);
  });
});
