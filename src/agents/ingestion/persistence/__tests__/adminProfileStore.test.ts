import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAdminProfileStore } from '../adminProfileStore';

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
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => terminal),
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
    id: 'profile-1',
    userId: 'user-1',
    maxPending: 10,
    maxInReview: 5,
    isActive: true,
    isAcceptingNew: true,
    coverageStates: ['WA'],
    coverageCounties: ['King'],
    categoryExpertise: ['housing'],
    pendingCount: 3,
    totalVerified: 6,
    totalRejected: 2,
    avgReviewHours: '4.5',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('adminProfileStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates profiles and maps optional location/capacity defaults into insert fields', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleAdminProfileStore(db as never);

    await store.create({
      userId: 'user-1',
      profileType: 'admin',
      displayName: 'Reviewer One',
      maxPendingReviews: 12,
      jurisdictionStates: ['WA'],
      jurisdictionCounties: ['King'],
      categoryExpertise: ['housing'],
      location: {
        longitude: -122.33,
        latitude: 47.61,
      },
    } as never);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        maxPending: 12,
        maxInReview: 5,
        isActive: true,
        isAcceptingNew: true,
        coverageStates: ['WA'],
        coverageCounties: ['King'],
        categoryExpertise: ['housing'],
        location: expect.anything(),
      }),
    );
  });

  it('maps direct lookups back into admin profile domain objects', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [
        makeRow({
          id: 'profile-2',
          userId: 'user-2',
          isAcceptingNew: false,
          coverageStates: ['OR'],
          coverageCounties: [],
          categoryExpertise: ['food'],
          totalVerified: 1,
          totalRejected: 1,
          avgReviewHours: null,
        }),
      ],
    ]);
    const store = createDrizzleAdminProfileStore(db as never);

    await expect(store.getByUserId('user-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'profile-1',
        userId: 'user-1',
        displayName: 'user-1',
        jurisdictionStates: ['WA'],
        categoryExpertise: ['housing'],
        totalReviewsCompleted: 8,
        avgReviewHours: 4.5,
      }),
    );
    await expect(store.getById('profile-2')).resolves.toEqual(
      expect.objectContaining({
        id: 'profile-2',
        userId: 'user-2',
        isAcceptingReviews: false,
        jurisdictionStates: ['OR'],
        avgReviewHours: undefined,
      }),
    );
  });

  it('updates profile fields and exposes capacity-aware variants', async () => {
    const { db, updateSets } = createMockDb([
      [makeRow()],
      [
        makeRow(),
        makeRow({
          id: 'profile-2',
          userId: 'user-2',
          pendingCount: 10,
          maxPending: 10,
          isAcceptingNew: false,
        }),
      ],
    ]);
    const store = createDrizzleAdminProfileStore(db as never);

    await store.update('profile-1', {
      maxPendingReviews: 20,
      isActive: false,
      isAcceptingReviews: false,
      jurisdictionStates: ['WA', 'OR'],
      jurisdictionCounties: ['King', 'Multnomah'],
      categoryExpertise: ['housing', 'food'],
      location: {
        longitude: -123,
        latitude: 45.5,
      },
    } as never);

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        maxPending: 20,
        isActive: false,
        isAcceptingNew: false,
        coverageStates: ['WA', 'OR'],
        coverageCounties: ['King', 'Multnomah'],
        categoryExpertise: ['housing', 'food'],
        location: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    );

    await expect(store.getWithCapacity('profile-1')).resolves.toEqual(
      expect.objectContaining({
        currentPendingCount: 3,
        availableCapacity: 7,
      }),
    );
    await expect(
      store.listWithCapacity({
        isActive: true,
        isAcceptingReviews: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'profile-1',
        availableCapacity: 7,
      }),
      expect.objectContaining({
        id: 'profile-2',
        availableCapacity: 0,
      }),
    ]);
  });

  it('returns closest admins with available capacity and updates review stats', async () => {
    const { db, updateSets } = createMockDb([
      [
        {
          id: 'profile-1',
          userId: 'user-1',
          maxPending: 10,
          pendingCount: 4,
          distance: 1250,
        },
        {
          id: 'profile-2',
          userId: 'user-2',
          maxPending: 6,
          pendingCount: 1,
          distance: 2400,
        },
      ],
    ]);
    const store = createDrizzleAdminProfileStore(db as never);

    await expect(
      store.findClosestWithCapacity(
        { longitude: -122.33, latitude: 47.61 },
        {
          jurisdictionState: 'WA',
          jurisdictionCounty: 'King',
          category: 'housing',
        },
        5,
      ),
    ).resolves.toEqual([
      {
        adminProfileId: 'profile-1',
        userId: 'user-1',
        displayName: 'user-1',
        profileType: 'admin',
        distanceMeters: 1250,
        availableCapacity: 6,
      },
      {
        adminProfileId: 'profile-2',
        userId: 'user-2',
        displayName: 'user-2',
        profileType: 'admin',
        distanceMeters: 2400,
        availableCapacity: 5,
      },
    ]);

    await store.incrementReviewCount('profile-1');
    await store.updateAvgReviewTime('profile-1', 7200);

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        totalVerified: expect.anything(),
        lastReviewAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateSets[1]).toEqual(
      expect.objectContaining({
        avgReviewHours: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    );
  });
});
