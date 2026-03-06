import { describe, expect, it } from 'vitest';

import {
  AdminProfileSchema,
  AdminProfileTypeSchema,
  AdminWithCapacitySchema,
  ClosestAdminSchema,
  createAdminProfile,
  filterByCapacity,
  hasCapacity,
  selectAdminsForAssignment,
  sortClosestAdmins,
  type AdminWithCapacity,
  type ClosestAdmin,
} from '../adminProfiles';

const ADMIN_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_PROFILE_ID = '22222222-2222-4222-8222-222222222222';

function makeClosest(overrides: Partial<ClosestAdmin>): ClosestAdmin {
  return {
    adminProfileId: ADMIN_PROFILE_ID,
    userId: 'user-a',
    displayName: 'Admin A',
    profileType: 'admin',
    distanceMeters: 100,
    availableCapacity: 4,
    ...overrides,
  };
}

function makeWithCapacity(overrides: Partial<AdminWithCapacity>): AdminWithCapacity {
  return {
    userId: 'user-a',
    displayName: 'Admin A',
    profileType: 'admin',
    maxPendingReviews: 10,
    maxInReview: 5,
    jurisdictionCountry: 'US',
    jurisdictionStates: [],
    jurisdictionCounties: [],
    categoryExpertise: [],
    isActive: true,
    isAcceptingReviews: true,
    totalReviewsCompleted: 0,
    currentPendingCount: 3,
    availableCapacity: 7,
    ...overrides,
  };
}

describe('adminProfiles edge coverage', () => {
  it('validates profile schemas and defaults', () => {
    expect(AdminProfileTypeSchema.parse('org')).toBe('org');
    expect(() => AdminProfileTypeSchema.parse('invalid')).toThrow();

    const parsedProfile = AdminProfileSchema.parse({
      userId: 'user-1',
      profileType: 'admin',
      displayName: 'Admin One',
    });
    expect(parsedProfile.maxPendingReviews).toBe(10);
    expect(parsedProfile.jurisdictionCountry).toBe('US');
    expect(parsedProfile.isAcceptingReviews).toBe(true);

    expect(() =>
      AdminProfileSchema.parse({
        userId: 'user-1',
        profileType: 'admin',
        displayName: 'Bad Coordinates',
        location: { longitude: 190, latitude: 91 },
      }),
    ).toThrow();

    const withCapacity = AdminWithCapacitySchema.parse({
      ...parsedProfile,
      currentPendingCount: 2,
      availableCapacity: 8,
    });
    expect(withCapacity.availableCapacity).toBe(8);

    expect(
      ClosestAdminSchema.parse({
        adminProfileId: ADMIN_PROFILE_ID,
        userId: 'user-1',
        displayName: 'Closest Admin',
        profileType: 'admin',
        distanceMeters: 25,
        availableCapacity: 3,
      }).distanceMeters,
    ).toBe(25);
  });

  it('creates profiles with defaults and optional fields', () => {
    const basic = createAdminProfile('user-1', 'Basic Admin');
    expect(basic.profileType).toBe('admin');
    expect(basic.maxPendingReviews).toBe(10);
    expect(basic.totalReviewsCompleted).toBe(0);
    expect(basic).not.toHaveProperty('email');
    expect(basic).not.toHaveProperty('location');

    const rich = createAdminProfile('org-1', 'Org One', {
      profileType: 'org',
      maxPendingReviews: 25,
      jurisdictionCountry: 'CA',
      jurisdictionStates: ['BC'],
      jurisdictionCounties: ['Metro Vancouver'],
      categoryExpertise: ['housing', 'food'],
      location: { longitude: -123.1207, latitude: 49.2827 },
      email: 'ops@example.org',
      isActive: false,
      isAcceptingReviews: false,
      totalReviewsCompleted: 999,
    });

    expect(rich.profileType).toBe('org');
    expect(rich.maxPendingReviews).toBe(25);
    expect(rich.jurisdictionCountry).toBe('CA');
    expect(rich.location).toEqual({ longitude: -123.1207, latitude: 49.2827 });
    expect(rich.email).toBe('ops@example.org');
    expect(rich.isActive).toBe(false);
    expect(rich.isAcceptingReviews).toBe(false);
    expect(rich.totalReviewsCompleted).toBe(0);
  });

  it('applies role-based capacity defaults', () => {
    const oranAdmin = createAdminProfile('u1', 'ORAN Admin', { role: 'oran_admin' });
    expect(oranAdmin.maxPendingReviews).toBe(50);
    expect(oranAdmin.maxInReview).toBe(20);

    const communityAdmin = createAdminProfile('u2', 'Community Admin', { role: 'community_admin' });
    expect(communityAdmin.maxPendingReviews).toBe(10);
    expect(communityAdmin.maxInReview).toBe(5);

    const hostAdmin = createAdminProfile('u3', 'Host Admin', { role: 'host_admin' });
    expect(hostAdmin.maxPendingReviews).toBe(5);
    expect(hostAdmin.maxInReview).toBe(3);
  });

  it('allows explicit capacity to override role defaults', () => {
    const custom = createAdminProfile('u1', 'Custom', {
      role: 'oran_admin',
      maxPendingReviews: 30,
      maxInReview: 10,
    });
    expect(custom.maxPendingReviews).toBe(30);
    expect(custom.maxInReview).toBe(10);
  });

  it('evaluates and filters capacity correctly', () => {
    const available = makeWithCapacity({});
    const inactive = makeWithCapacity({ isActive: false });
    const notAccepting = makeWithCapacity({ isAcceptingReviews: false });
    const full = makeWithCapacity({ availableCapacity: 0, currentPendingCount: 10 });

    expect(hasCapacity(available)).toBe(true);
    expect(hasCapacity(inactive)).toBe(false);
    expect(hasCapacity(notAccepting)).toBe(false);
    expect(hasCapacity(full)).toBe(false);

    expect(filterByCapacity([inactive, available, notAccepting, full])).toEqual([available]);
  });

  it('sorts closest admins with and without org prioritization', () => {
    const admins: ClosestAdmin[] = [
      makeClosest({
        adminProfileId: ADMIN_PROFILE_ID,
        userId: 'admin-near',
        displayName: 'Admin Near',
        profileType: 'admin',
        distanceMeters: 20,
      }),
      makeClosest({
        adminProfileId: ORG_PROFILE_ID,
        userId: 'org-far',
        displayName: 'Org Far',
        profileType: 'org',
        distanceMeters: 900,
      }),
      makeClosest({
        adminProfileId: '33333333-3333-4333-8333-333333333333',
        userId: 'org-near',
        displayName: 'Org Near',
        profileType: 'org',
        distanceMeters: 30,
      }),
    ];

    expect(sortClosestAdmins(admins).map((a) => a.userId)).toEqual([
      'admin-near',
      'org-near',
      'org-far',
    ]);

    expect(sortClosestAdmins(admins, { prioritizeOrgs: true }).map((a) => a.userId)).toEqual([
      'org-near',
      'org-far',
      'admin-near',
    ]);
  });

  it('selects balanced assignments and respects targetCount limits', () => {
    const closest: ClosestAdmin[] = [
      makeClosest({ adminProfileId: ADMIN_PROFILE_ID, userId: 'a1', distanceMeters: 40, profileType: 'admin' }),
      makeClosest({ adminProfileId: '44444444-4444-4444-8444-444444444444', userId: 'a2', distanceMeters: 10, profileType: 'admin' }),
      makeClosest({ adminProfileId: '55555555-5555-4555-8555-555555555555', userId: 'a3', distanceMeters: 30, profileType: 'admin' }),
      makeClosest({ adminProfileId: '66666666-6666-4666-8666-666666666666', userId: 'a4', distanceMeters: 15, profileType: 'admin' }),
      makeClosest({ adminProfileId: ORG_PROFILE_ID, userId: 'o1', distanceMeters: 12, profileType: 'org' }),
      makeClosest({ adminProfileId: '77777777-7777-4777-8777-777777777777', userId: 'o2', distanceMeters: 22, profileType: 'org' }),
      makeClosest({ adminProfileId: '88888888-8888-4888-8888-888888888888', userId: 'o3', distanceMeters: 55, profileType: 'org' }),
    ];

    const selected = selectAdminsForAssignment(closest, 5);
    expect(selected).toHaveLength(5);
    expect(selected.map((a) => a.distanceMeters)).toEqual([10, 12, 22, 30, 40]);

    const small = selectAdminsForAssignment(closest, 2);
    expect(small).toHaveLength(2);
    expect(small.map((a) => a.distanceMeters)).toEqual([10, 12]);

    expect(selectAdminsForAssignment(closest, 0)).toEqual([]);
  });
});
