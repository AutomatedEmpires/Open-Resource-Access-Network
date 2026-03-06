/**
 * Unit tests for admin routing contracts
 */

import { describe, it, expect } from 'vitest';
import {
  AdminCapacitySchema,
  CandidateAssignmentSchema,
  RoutingRequestSchema,
  getAvailableSlots,
  canAcceptAssignment,
  shouldToggleAcceptingNew,
  computeAdminPriority,
  computeEffectiveMaxPending,
  CAPACITY_SCALING_MIN_REVIEWS,
  sortAdminsByPriority,
  createAssignment,
  claimAssignment,
  completeAssignment,
  declineAssignment,
  isAssignmentExpired,
  PRIORITY_SCORES,
  type AdminCapacity,
  type CandidateAssignment,
} from '../routing';

describe('AdminCapacity schema', () => {
  it('validates a complete admin capacity record', () => {
    const validCapacity = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      pendingCount: 5,
      inReviewCount: 2,
      maxPending: 10,
      maxInReview: 5,
      totalVerified: 100,
      totalRejected: 10,
      avgReviewHours: 2.5,
      lastReviewAt: new Date(),
      coverageZoneId: null,
      coverageStates: ['ID', 'WA'],
      coverageCounties: ['ID_Kootenai', 'WA_Spokane'],
      isActive: true,
      isAcceptingNew: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => AdminCapacitySchema.parse(validCapacity)).not.toThrow();
  });

  it('applies defaults for optional fields', () => {
    const minimalCapacity = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const parsed = AdminCapacitySchema.parse(minimalCapacity);
    expect(parsed.pendingCount).toBe(0);
    expect(parsed.maxPending).toBe(10);
    expect(parsed.isActive).toBe(true);
  });

  it('rejects negative pending count', () => {
    const invalid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      pendingCount: -1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => AdminCapacitySchema.parse(invalid)).toThrow();
  });
});

describe('CandidateAssignment schema', () => {
  it('validates a complete assignment', () => {
    const validAssignment = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      candidateId: '550e8400-e29b-41d4-a716-446655440002',
      assignedUserId: 'user-123',
      assignedOrgId: null,
      assignmentType: 'admin',
      status: 'pending',
      priorityRank: 1,
      distanceMeters: 1500.5,
      claimedAt: null,
      completedAt: null,
      declinedAt: null,
      declineReason: null,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    expect(() => CandidateAssignmentSchema.parse(validAssignment)).not.toThrow();
  });

  it('applies defaults for status and type', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      candidateId: '550e8400-e29b-41d4-a716-446655440002',
      assignedUserId: 'user-123',
      assignedOrgId: null,
      distanceMeters: null,
      claimedAt: null,
      completedAt: null,
      declinedAt: null,
      declineReason: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    const parsed = CandidateAssignmentSchema.parse(minimal);
    expect(parsed.status).toBe('pending');
    expect(parsed.assignmentType).toBe('admin');
    expect(parsed.priorityRank).toBe(1);
  });
});

describe('RoutingRequest schema', () => {
  it('validates routing request with defaults', () => {
    const request = {
      candidateId: '550e8400-e29b-41d4-a716-446655440000',
      state: 'ID',
      county: 'Kootenai',
    };
    const parsed = RoutingRequestSchema.parse(request);
    expect(parsed.adminLimit).toBe(5);
    expect(parsed.orgLimit).toBe(1);
    expect(parsed.expiresHours).toBe(48);
  });

  it('enforces admin limit bounds', () => {
    const tooHigh = {
      candidateId: '550e8400-e29b-41d4-a716-446655440000',
      state: 'ID',
      county: null,
      adminLimit: 20,
    };
    expect(() => RoutingRequestSchema.parse(tooHigh)).toThrow();
  });
});

describe('getAvailableSlots', () => {
  it('calculates available slots correctly', () => {
    const admin: AdminCapacity = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      pendingCount: 3,
      inReviewCount: 2,
      maxPending: 10,
      maxInReview: 5,
      totalVerified: 50,
      totalRejected: 5,
      avgReviewHours: null,
      lastReviewAt: null,
      coverageZoneId: null,
      coverageStates: [],
      coverageCounties: [],
      isActive: true,
      isAcceptingNew: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(getAvailableSlots(admin)).toBe(7);
  });

  it('returns 0 when at capacity', () => {
    const admin: AdminCapacity = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      pendingCount: 10,
      inReviewCount: 5,
      maxPending: 10,
      maxInReview: 5,
      totalVerified: 50,
      totalRejected: 5,
      avgReviewHours: null,
      lastReviewAt: null,
      coverageZoneId: null,
      coverageStates: [],
      coverageCounties: [],
      isActive: true,
      isAcceptingNew: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(getAvailableSlots(admin)).toBe(0);
  });
});

describe('canAcceptAssignment', () => {
  const baseAdmin: AdminCapacity = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-123',
    pendingCount: 5,
    inReviewCount: 2,
    maxPending: 10,
    maxInReview: 5,
    totalVerified: 50,
    totalRejected: 5,
    avgReviewHours: null,
    lastReviewAt: null,
    coverageZoneId: null,
    coverageStates: [],
    coverageCounties: [],
    isActive: true,
    isAcceptingNew: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('returns true when admin has capacity', () => {
    expect(canAcceptAssignment(baseAdmin)).toBe(true);
  });

  it('returns false when admin is inactive', () => {
    expect(canAcceptAssignment({ ...baseAdmin, isActive: false })).toBe(false);
  });

  it('returns false when admin is not accepting new', () => {
    expect(canAcceptAssignment({ ...baseAdmin, isAcceptingNew: false })).toBe(false);
  });

  it('returns false when at max pending', () => {
    expect(canAcceptAssignment({ ...baseAdmin, pendingCount: 10 })).toBe(false);
  });
});

describe('shouldToggleAcceptingNew', () => {
  const baseAdmin: AdminCapacity = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-123',
    pendingCount: 5,
    inReviewCount: 2,
    maxPending: 10,
    maxInReview: 5,
    totalVerified: 50,
    totalRejected: 5,
    avgReviewHours: null,
    lastReviewAt: null,
    coverageZoneId: null,
    coverageStates: [],
    coverageCounties: [],
    isActive: true,
    isAcceptingNew: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('returns false (pause) when at maxPending', () => {
    expect(shouldToggleAcceptingNew({ ...baseAdmin, pendingCount: 10 })).toBe(false);
  });

  it('returns false (pause) when over maxPending', () => {
    expect(shouldToggleAcceptingNew({ ...baseAdmin, pendingCount: 12 })).toBe(false);
  });

  it('returns true (resume) when below 80% threshold and paused', () => {
    // 80% of 10 = 8; pendingCount 7 < 8 → resume
    expect(shouldToggleAcceptingNew({ ...baseAdmin, isAcceptingNew: false, pendingCount: 7 })).toBe(true);
  });

  it('returns null when below threshold but already accepting', () => {
    expect(shouldToggleAcceptingNew({ ...baseAdmin, pendingCount: 7 })).toBeNull();
  });

  it('returns null when paused but still above threshold', () => {
    // 80% of 10 = 8; pendingCount 9 >= 8 → no change
    expect(shouldToggleAcceptingNew({ ...baseAdmin, isAcceptingNew: false, pendingCount: 9 })).toBeNull();
  });

  it('does not resume when admin is inactive', () => {
    expect(shouldToggleAcceptingNew({ ...baseAdmin, isActive: false, isAcceptingNew: false, pendingCount: 2 })).toBeNull();
  });
});

describe('computeAdminPriority', () => {
  const baseAdmin: AdminCapacity = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-123',
    pendingCount: 5,
    inReviewCount: 2,
    maxPending: 10,
    maxInReview: 5,
    totalVerified: 50,
    totalRejected: 5,
    avgReviewHours: null,
    lastReviewAt: null,
    coverageZoneId: null,
    coverageStates: ['ID', 'WA'],
    coverageCounties: ['ID_Kootenai'],
    isActive: true,
    isAcceptingNew: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('gives highest score for exact county match', () => {
    const result = computeAdminPriority(baseAdmin, 'ID', 'Kootenai');
    expect(result.score).toBe(PRIORITY_SCORES.exact_county);
    expect(result.matchLevel).toBe('exact_county');
  });

  it('gives state score for state-only match', () => {
    const result = computeAdminPriority(baseAdmin, 'ID', 'Bonner');
    expect(result.score).toBe(PRIORITY_SCORES.state);
    expect(result.matchLevel).toBe('state');
  });

  it('gives fallback score for admin with no geo restriction', () => {
    const noGeoAdmin = { ...baseAdmin, coverageStates: [], coverageCounties: [] };
    const result = computeAdminPriority(noGeoAdmin, 'CA', 'LosAngeles');
    expect(result.score).toBe(PRIORITY_SCORES.fallback);
    expect(result.matchLevel).toBe('fallback');
  });

  it('gives zero score when no match', () => {
    const result = computeAdminPriority(baseAdmin, 'CA', 'LosAngeles');
    expect(result.score).toBe(0);
    expect(result.matchLevel).toBe('none');
  });
});

describe('sortAdminsByPriority', () => {
  it('sorts admins by priority score descending', () => {
    const admins: AdminCapacity[] = [
      {
        id: '1',
        userId: 'admin-1',
        pendingCount: 5,
        inReviewCount: 0,
        maxPending: 10,
        maxInReview: 5,
        totalVerified: 0,
        totalRejected: 0,
        avgReviewHours: null,
        lastReviewAt: null,
        coverageZoneId: null,
        coverageStates: ['CA'],
        coverageCounties: [],
        isActive: true,
        isAcceptingNew: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        userId: 'admin-2',
        pendingCount: 2,
        inReviewCount: 0,
        maxPending: 10,
        maxInReview: 5,
        totalVerified: 0,
        totalRejected: 0,
        avgReviewHours: null,
        lastReviewAt: null,
        coverageZoneId: null,
        coverageStates: ['ID'],
        coverageCounties: ['ID_Kootenai'],
        isActive: true,
        isAcceptingNew: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const sorted = sortAdminsByPriority(admins, 'ID', 'Kootenai');
    expect(sorted[0].userId).toBe('admin-2'); // Exact county match
    expect(sorted.length).toBe(1); // CA admin filtered out (no match)
  });

  it('filters out admins who cannot accept', () => {
    const admins: AdminCapacity[] = [
      {
        id: '1',
        userId: 'admin-1',
        pendingCount: 10, // At capacity
        inReviewCount: 0,
        maxPending: 10,
        maxInReview: 5,
        totalVerified: 0,
        totalRejected: 0,
        avgReviewHours: null,
        lastReviewAt: null,
        coverageZoneId: null,
        coverageStates: [],
        coverageCounties: [],
        isActive: true,
        isAcceptingNew: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const sorted = sortAdminsByPriority(admins, 'ID', 'Kootenai');
    expect(sorted.length).toBe(0);
  });
});

describe('createAssignment', () => {
  it('creates a pending assignment with expiration', () => {
    const assignment = createAssignment(
      '550e8400-e29b-41d4-a716-446655440001',
      'user-123',
      1,
      48
    );
    expect(assignment.status).toBe('pending');
    expect(assignment.assignmentType).toBe('admin');
    expect(assignment.expiresAt).toBeDefined();
    expect(assignment.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('assignment state transitions', () => {
  const baseAssignment: CandidateAssignment = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    candidateId: '550e8400-e29b-41d4-a716-446655440002',
    assignedUserId: 'user-123',
    assignedOrgId: null,
    assignmentType: 'admin',
    status: 'pending',
    priorityRank: 1,
    distanceMeters: null,
    claimedAt: null,
    completedAt: null,
    declinedAt: null,
    declineReason: null,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  it('claimAssignment transitions pending -> claimed', () => {
    const claimed = claimAssignment(baseAssignment);
    expect(claimed.status).toBe('claimed');
    expect(claimed.claimedAt).toBeDefined();
  });

  it('claimAssignment throws if not pending', () => {
    const claimed = { ...baseAssignment, status: 'claimed' as const };
    expect(() => claimAssignment(claimed)).toThrow();
  });

  it('completeAssignment transitions claimed -> completed', () => {
    const claimed = { ...baseAssignment, status: 'claimed' as const, claimedAt: new Date() };
    const completed = completeAssignment(claimed);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
  });

  it('completeAssignment throws if not claimed', () => {
    expect(() => completeAssignment(baseAssignment)).toThrow();
  });

  it('declineAssignment transitions to declined with reason', () => {
    const declined = declineAssignment(baseAssignment, 'Not in my area');
    expect(declined.status).toBe('declined');
    expect(declined.declineReason).toBe('Not in my area');
    expect(declined.declinedAt).toBeDefined();
  });
});

describe('isAssignmentExpired', () => {
  it('returns false for non-pending assignments', () => {
    const claimed: CandidateAssignment = {
      id: '1',
      candidateId: '2',
      assignedUserId: 'user-123',
      assignedOrgId: null,
      assignmentType: 'admin',
      status: 'claimed',
      priorityRank: 1,
      distanceMeters: null,
      claimedAt: new Date(),
      completedAt: null,
      declinedAt: null,
      declineReason: null,
      expiresAt: new Date(Date.now() - 1000), // Past expiration
      createdAt: new Date(),
    };
    expect(isAssignmentExpired(claimed)).toBe(false);
  });

  it('returns true for pending assignment past expiration', () => {
    const expired: CandidateAssignment = {
      id: '1',
      candidateId: '2',
      assignedUserId: 'user-123',
      assignedOrgId: null,
      assignmentType: 'admin',
      status: 'pending',
      priorityRank: 1,
      distanceMeters: null,
      claimedAt: null,
      completedAt: null,
      declinedAt: null,
      declineReason: null,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    };
    expect(isAssignmentExpired(expired)).toBe(true);
  });

  it('returns false if no expiration set', () => {
    const noExpiry: CandidateAssignment = {
      id: '1',
      candidateId: '2',
      assignedUserId: 'user-123',
      assignedOrgId: null,
      assignmentType: 'admin',
      status: 'pending',
      priorityRank: 1,
      distanceMeters: null,
      claimedAt: null,
      completedAt: null,
      declinedAt: null,
      declineReason: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    expect(isAssignmentExpired(noExpiry)).toBe(false);
  });
});

describe('computeEffectiveMaxPending', () => {
  const baseAdmin: AdminCapacity = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'user-123',
    pendingCount: 5,
    inReviewCount: 2,
    maxPending: 10,
    maxInReview: 5,
    totalVerified: 50,
    totalRejected: 5,
    avgReviewHours: 3,
    lastReviewAt: new Date(),
    coverageZoneId: null,
    coverageStates: [],
    coverageCounties: [],
    isActive: true,
    isAcceptingNew: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('returns base maxPending when no avgReviewHours data', () => {
    const admin = { ...baseAdmin, avgReviewHours: null };
    expect(computeEffectiveMaxPending(admin)).toBe(10);
  });

  it('returns base maxPending when too few completed reviews', () => {
    const admin = {
      ...baseAdmin,
      totalVerified: 5,
      totalRejected: 2,
      avgReviewHours: 2,
    };
    // 5+2=7 < CAPACITY_SCALING_MIN_REVIEWS (20)
    expect(computeEffectiveMaxPending(admin)).toBe(10);
  });

  it('scales up to 1.5x for fast reviewers (< 4h avg)', () => {
    const admin = {
      ...baseAdmin,
      totalVerified: 15,
      totalRejected: 10,
      avgReviewHours: 2,
    };
    // 15+10 = 25 >= 20; 2h < 4h → 1.5x → floor(10*1.5) = 15
    expect(computeEffectiveMaxPending(admin)).toBe(15);
  });

  it('keeps 1.0x for normal reviewers (4-12h avg)', () => {
    const admin = {
      ...baseAdmin,
      totalVerified: 15,
      totalRejected: 10,
      avgReviewHours: 8,
    };
    // 8h → normal tier → 1.0x → 10
    expect(computeEffectiveMaxPending(admin)).toBe(10);
  });

  it('scales down to 0.75x for slow reviewers (> 12h avg)', () => {
    const admin = {
      ...baseAdmin,
      totalVerified: 15,
      totalRejected: 10,
      avgReviewHours: 24,
    };
    // 24h > 12h → 0.75x → floor(10*0.75) = 7
    expect(computeEffectiveMaxPending(admin)).toBe(7);
  });

  it('never returns less than 1', () => {
    const admin = {
      ...baseAdmin,
      maxPending: 1,
      totalVerified: 15,
      totalRejected: 10,
      avgReviewHours: 48,
    };
    // floor(1*0.75) = 0 → clamped to 1
    expect(computeEffectiveMaxPending(admin)).toBe(1);
  });

  it('applies at exactly the CAPACITY_SCALING_MIN_REVIEWS threshold', () => {
    const admin = {
      ...baseAdmin,
      totalVerified: CAPACITY_SCALING_MIN_REVIEWS,
      totalRejected: 0,
      avgReviewHours: 2,
    };
    // Exactly at threshold → scaling applies → 1.5x → 15
    expect(computeEffectiveMaxPending(admin)).toBe(15);
  });
});
