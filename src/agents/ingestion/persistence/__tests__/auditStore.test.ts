import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAuditStore } from '../auditStore';

function createMockDb(selectResults: unknown[] = []) {
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
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => terminal),
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
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-row-1',
    candidateId: 'cand-1',
    eventType: 'publish.approved',
    actorType: 'human',
    actorId: 'admin-1',
    details: {
      eventId: 'evt-1',
      correlationId: 'corr-1',
      targetType: 'candidate',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputs: { source: 'manual' },
      outputs: { result: 'ok' },
      evidenceRefs: ['ev-1'],
    },
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    ...overrides,
  };
}

describe('auditStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends events by packing contract extras into details JSON', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleAuditStore(db as never);

    await store.append({
      eventId: 'evt-1',
      correlationId: 'corr-1',
      eventType: 'publish.approved',
      actorType: 'human',
      actorId: 'admin-1',
      targetType: 'candidate',
      targetId: 'cand-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputs: { source: 'manual' },
      outputs: { result: 'ok' },
      evidenceRefs: ['ev-1'],
    });

    expect(insertValues[0]).toEqual({
      candidateId: 'cand-1',
      eventType: 'publish.approved',
      actorType: 'human',
      actorId: 'admin-1',
      details: {
        eventId: 'evt-1',
        correlationId: 'corr-1',
        targetType: 'candidate',
        inputs: { source: 'manual' },
        outputs: { result: 'ok' },
        evidenceRefs: ['ev-1'],
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('lists by correlation and target with full details mapping', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [makeRow({ id: 'audit-row-2', eventType: 'status_changed', details: { eventId: 'evt-2', correlationId: 'corr-2', targetType: 'candidate', timestamp: '2026-01-02T00:00:00.000Z', inputs: {}, outputs: {}, evidenceRefs: [] } })],
    ]);
    const store = createDrizzleAuditStore(db as never);

    await expect(store.listByCorrelation('corr-1')).resolves.toEqual([
      {
        eventId: 'evt-1',
        correlationId: 'corr-1',
        eventType: 'publish.approved',
        actorType: 'human',
        actorId: 'admin-1',
        targetType: 'candidate',
        targetId: 'cand-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        inputs: { source: 'manual' },
        outputs: { result: 'ok' },
        evidenceRefs: ['ev-1'],
      },
    ]);
    await expect(store.listByTarget('candidate', 'cand-1')).resolves.toEqual([
      expect.objectContaining({
        eventId: 'evt-2',
        correlationId: 'corr-2',
        eventType: 'status_changed',
        targetType: 'candidate',
        targetId: 'cand-1',
      }),
    ]);
  });

  it('lists by type and falls back for legacy rows missing details fields', async () => {
    const createdAt = new Date('2026-01-03T00:00:00.000Z');
    const { db } = createMockDb([
      [
        makeRow({
          id: 'legacy-1',
          eventType: 'created',
          actorType: 'system',
          actorId: null,
          details: {},
          createdAt,
        }),
      ],
    ]);
    const store = createDrizzleAuditStore(db as never);

    await expect(store.listByType('created', 5)).resolves.toEqual([
      {
        eventId: 'legacy-1',
        correlationId: '',
        eventType: 'created',
        actorType: 'system',
        actorId: 'unknown',
        targetType: 'candidate',
        targetId: 'cand-1',
        timestamp: createdAt.toISOString(),
        inputs: {},
        outputs: {},
        evidenceRefs: [],
      },
    ]);
  });
});
