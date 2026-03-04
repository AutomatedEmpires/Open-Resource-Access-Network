import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleVerifiedLinkStore } from '../verifiedLinkStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

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
    id: 'link-1',
    candidateId: 'cand-1',
    serviceId: 'svc-1',
    url: 'https://example.gov/apply',
    label: 'Apply now',
    linkType: 'apply',
    intentActions: ['apply'],
    intentCategories: ['benefits'],
    audienceTags: ['veterans'],
    locales: ['en-US'],
    isVerified: true,
    verifiedAt: new Date('2026-01-01T01:00:00.000Z'),
    verifiedByUserId: 'user-1',
    lastCheckedAt: new Date('2026-01-01T02:00:00.000Z'),
    lastHttpStatus: 200,
    isLinkAlive: true,
    evidenceId: 'ev-1',
    discoveredAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeLink(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand-1',
    serviceId: 'svc-1',
    url: 'https://example.gov/apply',
    label: 'Apply now',
    linkType: 'apply',
    intentActions: ['apply'],
    intentCategories: ['benefits'],
    audienceTags: ['veterans'],
    locales: ['en-US'],
    isVerified: false,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('verifiedLinkStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds single and bulk links using normalized database payloads', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleVerifiedLinkStore(db as never);

    await store.add(
      makeLink({
        verifiedAt: '2026-01-01T01:00:00.000Z',
        lastCheckedAt: '2026-01-01T02:00:00.000Z',
        lastHttpStatus: 202,
        isLinkAlive: true,
        evidenceId: 'ev-1',
      }) as never
    );
    await store.bulkAdd([
      makeLink({ url: 'https://example.gov/contact', linkType: 'contact' }),
      makeLink({ url: 'https://example.gov/hours', linkType: 'hours' }),
    ] as never);
    await store.bulkAdd([]);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        serviceId: 'svc-1',
        url: 'https://example.gov/apply',
        linkType: 'apply',
        verifiedAt: expect.any(Date),
        lastCheckedAt: expect.any(Date),
        lastHttpStatus: 202,
        isLinkAlive: true,
        evidenceId: 'ev-1',
        discoveredAt: expect.any(Date),
      })
    );
    expect(insertValues[1]).toEqual([
      expect.objectContaining({ url: 'https://example.gov/contact', linkType: 'contact' }),
      expect.objectContaining({ url: 'https://example.gov/hours', linkType: 'hours' }),
    ]);
    expect(insertValues).toHaveLength(2);
  });

  it('updates verification and link health timestamps', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleVerifiedLinkStore(db as never);

    await store.verify('link-1', 'reviewer-1');
    await store.updateHealth('link-1', 503, false);
    await store.transferToService('cand-1', 'svc-2');

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        isVerified: true,
        verifiedAt: expect.any(Date),
        verifiedByUserId: 'reviewer-1',
        updatedAt: expect.any(Date),
      })
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({
        lastCheckedAt: expect.any(Date),
        lastHttpStatus: 503,
        isLinkAlive: false,
        updatedAt: expect.any(Date),
      })
    );
    expect(updateSets[2]).toEqual(
      expect.objectContaining({
        serviceId: 'svc-2',
        updatedAt: expect.any(Date),
      })
    );
  });

  it('maps rows into domain links for candidate and service lookups', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [makeRow({ id: 'link-2', verifiedAt: null, verifiedByUserId: null })],
      [makeRow({ id: 'link-3', serviceId: 'svc-1', isVerified: true })],
      [makeRow({ id: 'link-4', linkType: 'pdf' })],
    ]);
    const store = createDrizzleVerifiedLinkStore(db as never);

    await expect(store.listForCandidate('cand-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'link-1',
        candidateId: 'cand-1',
        serviceId: 'svc-1',
        verifiedAt: '2026-01-01T01:00:00.000Z',
        lastCheckedAt: '2026-01-01T02:00:00.000Z',
      }),
    ]);
    await expect(store.listForService('svc-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'link-2',
        verifiedAt: undefined,
        verifiedByUserId: undefined,
      }),
    ]);
    await expect(store.listForService('svc-1', true)).resolves.toEqual([
      expect.objectContaining({
        id: 'link-3',
        isVerified: true,
      }),
    ]);
    await expect(store.listByType('svc-1', 'pdf')).resolves.toEqual([
      expect.objectContaining({
        id: 'link-4',
        linkType: 'pdf',
      }),
    ]);
  });
});
