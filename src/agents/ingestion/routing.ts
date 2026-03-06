/**
 * Admin Review Capacity and Routing Contracts
 *
 * Handles capacity-limited admin routing: finding the nearest admins
 * with available slots to review a candidate.
 *
 * @module agents/ingestion/routing
 */

import { z } from 'zod';
import { ROLE_CAPACITY_DEFAULTS } from '@/domain/constants';

// ============================================================
// ADMIN CAPACITY
// ============================================================

/**
 * Admin's review capacity status.
 * Tracks pending items and limits to prevent overload.
 */
export const AdminCapacitySchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),

  // Current queue counts
  pendingCount: z.number().int().min(0).default(0),
  inReviewCount: z.number().int().min(0).default(0),

  // Capacity limits (defaults from community_admin tier; overridden per role)
  maxPending: z.number().int().min(1).default(ROLE_CAPACITY_DEFAULTS.community_admin.maxPending),
  maxInReview: z.number().int().min(1).default(ROLE_CAPACITY_DEFAULTS.community_admin.maxInReview),

  // Performance metrics
  totalVerified: z.number().int().min(0).default(0),
  totalRejected: z.number().int().min(0).default(0),
  avgReviewHours: z.number().nullable().default(null),
  lastReviewAt: z.date().nullable().default(null),

  // Geographic coverage
  coverageZoneId: z.string().uuid().nullable().default(null),
  coverageStates: z.array(z.string()).default([]),
  coverageCounties: z.array(z.string()).default([]), // Format: "STATE_COUNTY"

  // Status
  isActive: z.boolean().default(true),
  isAcceptingNew: z.boolean().default(true),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AdminCapacity = z.infer<typeof AdminCapacitySchema>;

// ============================================================
// AUTO-CAPACITY SCALING
// ============================================================

/**
 * Minimum number of completed reviews before scaling kicks in.
 * Prevents newly-onboarded admins from getting inflated limits.
 */
export const CAPACITY_SCALING_MIN_REVIEWS = 20;

/**
 * Performance tiers for capacity scaling, keyed by avg review hours.
 * Each tier defines a multiplier for maxPending.
 *
 * - fast (< 4h avg): 1.5x capacity
 * - normal (4-12h): 1.0x (no change)
 * - slow (> 12h): 0.75x capacity (but never below role default minimum)
 */
export const CAPACITY_SCALING_TIERS = [
  { maxAvgHours: 4,      multiplier: 1.5 },
  { maxAvgHours: 12,     multiplier: 1.0 },
  { maxAvgHours: Infinity, multiplier: 0.75 },
] as const;

/**
 * Compute the effective maxPending for an admin based on their avgReviewHours.
 *
 * Returns the original maxPending if:
 * - No avgReviewHours data available
 * - Fewer than CAPACITY_SCALING_MIN_REVIEWS completed reviews
 *
 * Otherwise, applies the tier multiplier and floors to ensure at least 1.
 */
export function computeEffectiveMaxPending(admin: AdminCapacity): number {
  const totalCompleted = admin.totalVerified + admin.totalRejected;

  // Not enough history — use configured max
  if (admin.avgReviewHours == null || totalCompleted < CAPACITY_SCALING_MIN_REVIEWS) {
    return admin.maxPending;
  }

  const tier = CAPACITY_SCALING_TIERS.find((t) => admin.avgReviewHours! <= t.maxAvgHours);
  const multiplier = tier?.multiplier ?? 1.0;

  return Math.max(1, Math.floor(admin.maxPending * multiplier));
}

/**
 * Available slots calculation
 */
export function getAvailableSlots(admin: AdminCapacity): number {
  return Math.max(0, admin.maxPending - admin.pendingCount);
}

/**
 * Check if admin can accept new assignments
 */
export function canAcceptAssignment(admin: AdminCapacity): boolean {
  return (
    admin.isActive &&
    admin.isAcceptingNew &&
    admin.pendingCount < admin.maxPending
  );
}

/**
 * Auto-pause threshold: 100% of maxPending.
 * Auto-resume threshold: 80% of maxPending.
 *
 * Returns the new value of `isAcceptingNew` if it should change, or null if no change needed.
 */
export const AUTO_RESUME_THRESHOLD = 0.8;

export function shouldToggleAcceptingNew(admin: AdminCapacity): boolean | null {
  // Pause: at or over capacity
  if (admin.isAcceptingNew && admin.pendingCount >= admin.maxPending) {
    return false;
  }
  // Resume: dropped below 80% of max
  if (
    !admin.isAcceptingNew &&
    admin.isActive &&
    admin.pendingCount < Math.floor(admin.maxPending * AUTO_RESUME_THRESHOLD)
  ) {
    return true;
  }
  return null;
}

// ============================================================
// CANDIDATE ASSIGNMENT
// ============================================================

export const AssignmentType = z.enum(['admin', 'org', 'escalated']);
export type AssignmentType = z.infer<typeof AssignmentType>;

export const AssignmentStatus = z.enum([
  'pending',
  'claimed',
  'completed',
  'declined',
  'expired',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

/**
 * Assignment of a candidate to an admin or org for review.
 */
export const CandidateAssignmentSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),

  // Who is assigned
  assignedUserId: z.string().nullable(),
  assignedOrgId: z.string().uuid().nullable(),

  // Assignment type
  assignmentType: AssignmentType.default('admin'),

  // Status
  status: AssignmentStatus.default('pending'),

  // Priority / routing info
  priorityRank: z.number().int().min(1).default(1),
  distanceMeters: z.number().nullable(),

  // Response timestamps
  claimedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  declinedAt: z.date().nullable(),
  declineReason: z.string().nullable(),

  // Expiration
  expiresAt: z.date().nullable(),

  createdAt: z.date(),
});

export type CandidateAssignment = z.infer<typeof CandidateAssignmentSchema>;

// ============================================================
// ROUTING LOGIC
// ============================================================

/**
 * Input for finding admins to route a candidate to.
 */
export const RoutingRequestSchema = z.object({
  candidateId: z.string().uuid(),
  state: z.string().nullable(),
  county: z.string().nullable(),

  // How many admins/orgs to assign
  adminLimit: z.number().int().min(1).max(10).default(5),
  orgLimit: z.number().int().min(0).max(3).default(1),

  // How long before assignment expires
  expiresHours: z.number().int().min(1).max(168).default(48), // max 1 week
});

export type RoutingRequest = z.infer<typeof RoutingRequestSchema>;

/**
 * Result from finding admins.
 */
export const AdminMatchSchema = z.object({
  userId: z.string(),
  adminName: z.string().nullable(),
  availableSlots: z.number().int(),
  priorityScore: z.number().int(),
});

export type AdminMatch = z.infer<typeof AdminMatchSchema>;

/**
 * Result from routing a candidate.
 */
export const RoutingResultSchema = z.object({
  candidateId: z.string().uuid(),
  assignedAdmins: z.array(AdminMatchSchema),
  assignedOrgs: z.array(z.string().uuid()),
  totalAssigned: z.number().int(),
  routedAt: z.date(),
});

export type RoutingResult = z.infer<typeof RoutingResultSchema>;

// ============================================================
// PRIORITY SCORING
// ============================================================

/**
 * Geographic match levels for priority scoring.
 */
export const GeoMatchLevel = z.enum([
  'exact_county', // Admin covers exact county
  'state', // Admin covers state
  'zone', // Admin covers zone
  'fallback', // Admin covers all (no geo restriction)
  'none', // No geographic match
]);
export type GeoMatchLevel = z.infer<typeof GeoMatchLevel>;

/**
 * Priority scores for routing decisions.
 */
export const PRIORITY_SCORES: Record<GeoMatchLevel, number> = {
  exact_county: 100,
  state: 50,
  zone: 25,
  fallback: 10,
  none: 0,
};

/**
 * Compute priority score for an admin given candidate location.
 */
export function computeAdminPriority(
  admin: AdminCapacity,
  state: string | null,
  county: string | null
): { score: number; matchLevel: GeoMatchLevel } {
  // Exact county match (highest priority)
  if (state && county) {
    const countyKey = `${state}_${county}`;
    if (admin.coverageCounties.includes(countyKey)) {
      return { score: PRIORITY_SCORES.exact_county, matchLevel: 'exact_county' };
    }
  }

  // State match
  if (state && admin.coverageStates.includes(state)) {
    return { score: PRIORITY_SCORES.state, matchLevel: 'state' };
  }

  // Zone-only match is only meaningful when candidate location is unknown.
  // If a candidate has explicit state/county and the admin does not cover it,
  // we conservatively treat this as no match (avoids misrouting).
  if (!state && !county && admin.coverageZoneId) {
    return { score: PRIORITY_SCORES.zone, matchLevel: 'zone' };
  }

  // Fallback: admin with no geo restriction
  if (admin.coverageStates.length === 0 && admin.coverageCounties.length === 0) {
    return { score: PRIORITY_SCORES.fallback, matchLevel: 'fallback' };
  }

  // No match
  return { score: 0, matchLevel: 'none' };
}

/**
 * Sort admins by priority for assignment.
 *
 * Priority order:
 * 1. Geographic match score (higher = better)
 * 2. Pending count (lower = better, more capacity)
 * 3. Average review time (lower = faster)
 */
export function sortAdminsByPriority(
  admins: AdminCapacity[],
  state: string | null,
  county: string | null
): Array<AdminCapacity & { priorityScore: number; matchLevel: GeoMatchLevel }> {
  return admins
    .filter(canAcceptAssignment)
    .map((admin) => {
      const { score, matchLevel } = computeAdminPriority(admin, state, county);
      return { ...admin, priorityScore: score, matchLevel };
    })
    .filter((admin) => admin.priorityScore > 0)
    .sort((a, b) => {
      // Primary: priority score (descending)
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      // Secondary: pending count (ascending)
      if (a.pendingCount !== b.pendingCount) {
        return a.pendingCount - b.pendingCount;
      }
      // Tertiary: avg review hours (ascending, nulls last)
      const aHours = a.avgReviewHours ?? Infinity;
      const bHours = b.avgReviewHours ?? Infinity;
      return aHours - bHours;
    });
}

// ============================================================
// ASSIGNMENT ACTIONS
// ============================================================

/**
 * Create an assignment for a candidate.
 */
export function createAssignment(
  candidateId: string,
  assignedUserId: string,
  priorityRank: number,
  expiresHours: number = 48
): Omit<CandidateAssignment, 'id' | 'createdAt'> {
  return {
    candidateId,
    assignedUserId,
    assignedOrgId: null,
    assignmentType: 'admin',
    status: 'pending',
    priorityRank,
    distanceMeters: null,
    claimedAt: null,
    completedAt: null,
    declinedAt: null,
    declineReason: null,
    expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000),
  };
}

/**
 * Claim an assignment (admin starts review).
 */
export function claimAssignment(
  assignment: CandidateAssignment
): CandidateAssignment {
  if (assignment.status !== 'pending') {
    throw new Error(`Cannot claim assignment with status: ${assignment.status}`);
  }
  return {
    ...assignment,
    status: 'claimed',
    claimedAt: new Date(),
  };
}

/**
 * Complete an assignment (admin finished review).
 */
export function completeAssignment(
  assignment: CandidateAssignment
): CandidateAssignment {
  if (assignment.status !== 'claimed') {
    throw new Error(
      `Cannot complete assignment with status: ${assignment.status}`
    );
  }
  return {
    ...assignment,
    status: 'completed',
    completedAt: new Date(),
  };
}

/**
 * Decline an assignment (admin opts out).
 */
export function declineAssignment(
  assignment: CandidateAssignment,
  reason: string
): CandidateAssignment {
  if (!['pending', 'claimed'].includes(assignment.status)) {
    throw new Error(
      `Cannot decline assignment with status: ${assignment.status}`
    );
  }
  return {
    ...assignment,
    status: 'declined',
    declinedAt: new Date(),
    declineReason: reason,
  };
}

/**
 * Check if assignment has expired.
 */
export function isAssignmentExpired(assignment: CandidateAssignment): boolean {
  if (assignment.status !== 'pending') return false;
  if (!assignment.expiresAt) return false;
  return new Date() > assignment.expiresAt;
}

// ============================================================
// STORE INTERFACE
// ============================================================

/**
 * Store interface for admin capacity operations.
 */
export interface AdminCapacityStore {
  getByUserId(userId: string): Promise<AdminCapacity | null>;
  getAvailableAdmins(
    state: string | null,
    county: string | null,
    limit: number
  ): Promise<AdminCapacity[]>;
  incrementPending(userId: string): Promise<void>;
  decrementPending(userId: string): Promise<void>;
  setAcceptingNew(userId: string, accepting: boolean): Promise<void>;
  updateReviewMetrics(
    userId: string,
    reviewTimeHours: number,
    wasApproved: boolean
  ): Promise<void>;
}

/**
 * Store interface for assignment operations.
 */
export interface AssignmentStore {
  create(
    assignment: Omit<CandidateAssignment, 'id' | 'createdAt'>
  ): Promise<CandidateAssignment>;
  getByCandidate(candidateId: string): Promise<CandidateAssignment[]>;
  getByAdmin(userId: string, status?: AssignmentStatus): Promise<CandidateAssignment[]>;
  updateStatus(id: string, updates: Partial<CandidateAssignment>): Promise<void>;
  expireStale(): Promise<number>; // Returns count expired
}
