/**
 * Admin assignment management for the approval workflow.
 *
 * Each candidate is assigned to ~5 closest admins/orgs for review.
 * This tracks assignment status, decisions, and timing.
 */
import { z } from 'zod';

// ============================================================
// Assignment Status
// ============================================================

export const AssignmentStatusSchema = z.enum([
  'pending',      // Waiting for admin to pick up
  'accepted',     // Admin accepted, reviewing
  'completed',    // Admin finished review
  'skipped',      // Admin declined/skipped
  'expired',      // SLA expired, moved to next admin
  'withdrawn',    // Candidate was handled by another admin
]);

export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

// ============================================================
// Admin Decision
// ============================================================

export const AdminDecisionSchema = z.enum([
  'approve',        // Ready for publish
  'reject',         // Not a valid resource
  'needs_more_info', // Missing critical info
  'escalate',       // Needs ORAN admin review
]);

export type AdminDecision = z.infer<typeof AdminDecisionSchema>;

// ============================================================
// Admin Assignment
// ============================================================

export const AdminAssignmentSchema = z.object({
  id: z.string().uuid().optional(),
  candidateId: z.string().uuid(),
  adminProfileId: z.string().uuid(),

  // Assignment ranking (1 = closest/primary, 5 = furthest backup)
  assignmentRank: z.number().int().min(1).max(10),

  // Distance from admin to candidate (meters)
  distanceMeters: z.number().min(0).optional(),

  // Status
  assignmentStatus: AssignmentStatusSchema,

  // Decision (if completed)
  decision: AdminDecisionSchema.optional(),
  decisionNotes: z.string().optional(),

  // Timestamps
  assignedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  decisionDueBy: z.string().datetime().optional(),

  // Review metrics
  reviewDurationSecs: z.number().int().min(0).optional(),

  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type AdminAssignment = z.infer<typeof AdminAssignmentSchema>;

// ============================================================
// Valid status transitions
// ============================================================

const VALID_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  pending: ['accepted', 'skipped', 'expired', 'withdrawn'],
  accepted: ['completed', 'skipped', 'expired', 'withdrawn'],
  completed: [], // Terminal
  skipped: [],   // Terminal
  expired: [],   // Terminal
  withdrawn: [], // Terminal
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(
  from: AssignmentStatus,
  to: AssignmentStatus
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Check if a status is terminal (no more transitions possible).
 */
export function isTerminalStatus(status: AssignmentStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

// ============================================================
// Factory functions
// ============================================================

export function createAssignment(
  candidateId: string,
  adminProfileId: string,
  rank: number,
  options: {
    distanceMeters?: number;
    slaDurationHours?: number;
  } = {}
): AdminAssignment {
  const now = new Date().toISOString();
  const slaHours = options.slaDurationHours ?? 48;

  return {
    candidateId,
    adminProfileId,
    assignmentRank: rank,
    assignmentStatus: 'pending',
    assignedAt: now,
    decisionDueBy: new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString(),
    ...(options.distanceMeters !== undefined ? { distanceMeters: options.distanceMeters } : {}),
  };
}

// ============================================================
// Status transition functions
// ============================================================

/**
 * Accept an assignment (admin starts reviewing).
 */
export function acceptAssignment(assignment: AdminAssignment): AdminAssignment {
  if (assignment.assignmentStatus !== 'pending') {
    throw new Error(`Cannot accept assignment in status: ${assignment.assignmentStatus}`);
  }
  return {
    ...assignment,
    assignmentStatus: 'accepted',
    acceptedAt: new Date().toISOString(),
  };
}

/**
 * Complete an assignment with a decision.
 */
export function completeAssignment(
  assignment: AdminAssignment,
  decision: AdminDecision,
  notes?: string
): AdminAssignment {
  if (assignment.assignmentStatus !== 'accepted') {
    throw new Error(`Cannot complete assignment in status: ${assignment.assignmentStatus}`);
  }

  const now = new Date().toISOString();
  const acceptedAt = assignment.acceptedAt ? new Date(assignment.acceptedAt) : new Date();
  const reviewDuration = Math.floor((Date.now() - acceptedAt.getTime()) / 1000);

  return {
    ...assignment,
    assignmentStatus: 'completed',
    decision,
    decisionNotes: notes,
    completedAt: now,
    reviewDurationSecs: reviewDuration,
  };
}

/**
 * Skip an assignment (admin declines).
 */
export function skipAssignment(assignment: AdminAssignment): AdminAssignment {
  if (!['pending', 'accepted'].includes(assignment.assignmentStatus)) {
    throw new Error(`Cannot skip assignment in status: ${assignment.assignmentStatus}`);
  }
  return {
    ...assignment,
    assignmentStatus: 'skipped',
  };
}

/**
 * Expire an assignment (SLA passed).
 */
export function expireAssignment(assignment: AdminAssignment): AdminAssignment {
  if (!['pending', 'accepted'].includes(assignment.assignmentStatus)) {
    throw new Error(`Cannot expire assignment in status: ${assignment.assignmentStatus}`);
  }
  return {
    ...assignment,
    assignmentStatus: 'expired',
  };
}

/**
 * Withdraw an assignment (another admin handled it).
 */
export function withdrawAssignment(assignment: AdminAssignment): AdminAssignment {
  if (isTerminalStatus(assignment.assignmentStatus)) {
    throw new Error(`Cannot withdraw assignment in terminal status: ${assignment.assignmentStatus}`);
  }
  return {
    ...assignment,
    assignmentStatus: 'withdrawn',
  };
}

// ============================================================
// SLA calculation
// ============================================================

/**
 * Calculate SLA duration based on confidence tier.
 * Green = 72h, Yellow = 48h, Orange = 24h, Red = 12h
 */
export function calculateSlaDuration(
  confidenceTier: 'green' | 'yellow' | 'orange' | 'red'
): number {
  switch (confidenceTier) {
    case 'green': return 72;
    case 'yellow': return 48;
    case 'orange': return 24;
    case 'red': return 12;
    default: return 48;
  }
}

/**
 * Check if an assignment is overdue.
 */
export function isOverdue(assignment: AdminAssignment): boolean {
  if (!assignment.decisionDueBy) return false;
  if (isTerminalStatus(assignment.assignmentStatus)) return false;
  return new Date(assignment.decisionDueBy) < new Date();
}

/**
 * Get all overdue assignments from a list.
 */
export function getOverdueAssignments(
  assignments: AdminAssignment[]
): AdminAssignment[] {
  return assignments.filter(isOverdue);
}

// ============================================================
// Aggregation helpers
// ============================================================

/**
 * Count approvals for a candidate.
 */
export function countApprovals(assignments: AdminAssignment[]): number {
  return assignments.filter(
    a => a.assignmentStatus === 'completed' && a.decision === 'approve'
  ).length;
}

/**
 * Count rejections for a candidate.
 */
export function countRejections(assignments: AdminAssignment[]): number {
  return assignments.filter(
    a => a.assignmentStatus === 'completed' && a.decision === 'reject'
  ).length;
}

/**
 * Check if any org has approved.
 */
export function hasOrgApproval(
  assignments: AdminAssignment[],
  getProfileType: (profileId: string) => 'admin' | 'org'
): boolean {
  return assignments.some(
    a =>
      a.assignmentStatus === 'completed' &&
      a.decision === 'approve' &&
      getProfileType(a.adminProfileId) === 'org'
  );
}

/**
 * Get pending assignments (for notification/reminder).
 */
export function getPendingAssignments(
  assignments: AdminAssignment[]
): AdminAssignment[] {
  return assignments.filter(a => a.assignmentStatus === 'pending');
}

/**
 * Get the next priority admin (lowest rank with pending status).
 */
export function getNextPriorityAdmin(
  assignments: AdminAssignment[]
): AdminAssignment | undefined {
  return assignments
    .filter(a => a.assignmentStatus === 'pending')
    .sort((a, b) => a.assignmentRank - b.assignmentRank)[0];
}
