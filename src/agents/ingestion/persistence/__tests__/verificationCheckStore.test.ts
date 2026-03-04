import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleVerificationCheckStore } from '../verificationCheckStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const conflictConfigs: unknown[] = [];
  const deleteTargets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(result)),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          onConflictDoUpdate: vi.fn((config: unknown) => {
            conflictConfigs.push(config);
            return Promise.resolve();
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((target: unknown) => {
        deleteTargets.push(target);
        return Promise.resolve();
      }),
    })),
  };

  return { db, insertValues, conflictConfigs, deleteTargets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'check-1',
    candidateId: 'cand-1',
    checkType: 'domain_allowlist',
    severity: 'warning',
    status: 'pass',
    checkedAt: new Date('2026-01-01T00:00:00.000Z'),
    details: { message: 'ok', score: 92 },
    evidenceRefs: ['ev-1'],
    ...overrides,
  };
}

describe('verificationCheckStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records checks with upsert semantics and normalized payloads', async () => {
    const { db, insertValues, conflictConfigs } = createMockDb();
    const store = createDrizzleVerificationCheckStore(db as never);

    await store.record({
      checkId: 'check-1',
      candidateId: 'cand-1',
      extractionId: 'cand-1',
      checkType: 'domain_allowlist',
      severity: 'critical',
      status: 'fail',
      ranAt: '2026-01-01T00:00:00.000Z',
      details: { message: 'blocked', reason: 'domain_mismatch' },
      evidenceRefs: ['ev-1', 'ev-2'],
    });

    expect(insertValues).toEqual([
      expect.objectContaining({
        candidateId: 'cand-1',
        checkType: 'domain_allowlist',
        severity: 'critical',
        status: 'fail',
        message: 'blocked',
        details: { message: 'blocked', reason: 'domain_mismatch' },
        evidenceRefs: ['ev-1', 'ev-2'],
        checkedAt: expect.any(Date),
      }),
    ]);
    expect(conflictConfigs).toEqual([
      expect.objectContaining({
        set: expect.objectContaining({
          severity: 'critical',
          status: 'fail',
          message: 'blocked',
          checkedAt: expect.any(Date),
        }),
      }),
    ]);
  });

  it('maps stored rows back into check results for list and critical lookups', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [
        makeRow({
          id: 'check-2',
          severity: 'critical',
          status: 'fail',
          details: null,
          evidenceRefs: null,
        }),
      ],
    ]);
    const store = createDrizzleVerificationCheckStore(db as never);

    await expect(store.listFor('cand-1')).resolves.toEqual([
      expect.objectContaining({
        checkId: 'check-1',
        candidateId: 'cand-1',
        extractionId: 'cand-1',
        ranAt: '2026-01-01T00:00:00.000Z',
        details: { message: 'ok', score: 92 },
        evidenceRefs: ['ev-1'],
      }),
    ]);

    await expect(store.getFailingCritical('cand-1')).resolves.toEqual([
      expect.objectContaining({
        checkId: 'check-2',
        severity: 'critical',
        status: 'fail',
        details: {},
        evidenceRefs: [],
      }),
    ]);
  });

  it('deletes all checks for a candidate', async () => {
    const { db, deleteTargets } = createMockDb();
    const store = createDrizzleVerificationCheckStore(db as never);

    await store.deleteFor('cand-1');

    expect(deleteTargets).toHaveLength(1);
  });
});
