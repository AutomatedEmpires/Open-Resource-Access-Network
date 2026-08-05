/**
 * Drizzle ORM implementation of AdminAssignmentStore.
 *
 * Maps AdminAssignment domain objects to the candidate_admin_assignments table.
 */
import { eq, and, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { candidateAdminAssignments } from '@/db/schema';
import type { AdminAssignment, AssignmentStatus, AdminDecision } from '../adminAssignments';
import type { AdminAssignmentStore, AdminAssignmentFilters } from '../stores';

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function reviewerRoutingIsActive(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<boolean> {
  const assignSignature = 'oran_internal.assign_candidate_reviewers(text,integer)';
  const listSignature = 'oran_internal.list_undercovered_candidate_reviews(integer,integer)';
  const result = await db.execute(sql`
    SELECT
      pg_catalog.to_regprocedure(${assignSignature}) IS NOT NULL AS assign_function_exists,
      CASE
        WHEN pg_catalog.to_regprocedure(${assignSignature}) IS NULL THEN false
        ELSE pg_catalog.has_function_privilege(
          current_user,
          pg_catalog.to_regprocedure(${assignSignature}),
          'EXECUTE'
        )
      END AS assign_executable,
      pg_catalog.to_regprocedure(${listSignature}) IS NOT NULL AS list_function_exists,
      CASE
        WHEN pg_catalog.to_regprocedure(${listSignature}) IS NULL THEN false
        ELSE pg_catalog.has_function_privilege(
          current_user,
          pg_catalog.to_regprocedure(${listSignature}),
          'EXECUTE'
        )
      END AS list_executable,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger activation_trigger
        WHERE activation_trigger.tgrelid =
            'public.candidate_admin_assignments'::pg_catalog.regclass
          AND activation_trigger.tgname =
            'trg_protect_completed_candidate_approval'
          AND NOT activation_trigger.tgisinternal
          AND activation_trigger.tgenabled IN ('O', 'A')
      ) AS activation_active,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint activation_constraint
        WHERE activation_constraint.conrelid =
            'public.candidate_admin_assignments'::pg_catalog.regclass
          AND activation_constraint.conname =
            'candidate_admin_assignments_decision_reviewer_check'
          AND activation_constraint.contype = 'c'
          AND activation_constraint.convalidated IS TRUE
      ) AS activation_constraint_validated
  `);
  const state = resultRows<{
    assign_function_exists: boolean;
    assign_executable: boolean;
    list_function_exists: boolean;
    list_executable: boolean;
    activation_active: boolean;
    activation_constraint_validated: boolean;
  }>(result)[0];
  if (!state) {
    throw new Error('Candidate reviewer routing state could not be read');
  }
  if (!state.activation_active) {
    const provablyDark = state.assign_function_exists
      && state.list_function_exists
      && !state.assign_executable
      && !state.list_executable
      && !state.activation_constraint_validated;
    if (provablyDark) return false;
    throw new Error('Candidate reviewer routing contract drifted after activation');
  }
  if (
    !state.assign_function_exists
    || !state.assign_executable
    || !state.list_function_exists
    || !state.list_executable
    || !state.activation_constraint_validated
  ) {
    throw new Error('Candidate reviewer routing contract drifted after activation');
  }
  return true;
}

function fromDatabaseStatus(status: string): AssignmentStatus {
  if (status === 'claimed') return 'accepted';
  if (status === 'declined') return 'skipped';
  if (status === 'reassigned') return 'withdrawn';
  return status as AssignmentStatus;
}

function toDatabaseStatus(status: AssignmentStatus): string {
  if (status === 'accepted') return 'claimed';
  if (status === 'skipped') return 'declined';
  if (status === 'withdrawn') return 'reassigned';
  return status;
}

function fromDatabaseDecision(decision: string | null): AdminDecision | undefined {
  if (decision === 'verified') return 'approve';
  if (decision === 'rejected') return 'reject';
  if (decision === 'escalated') return 'escalate';
  return decision ? decision as AdminDecision : undefined;
}

function toDatabaseDecision(decision: AdminDecision): string {
  if (decision === 'approve') return 'verified';
  if (decision === 'reject') return 'rejected';
  if (decision === 'needs_more_info') return 'escalated';
  if (decision === 'escalate') return 'escalated';
  return decision;
}

/**
 * Convert a DB row to an AdminAssignment domain object.
 */
function rowToAssignment(
  row: typeof candidateAdminAssignments.$inferSelect
): AdminAssignment {
  return {
    id: row.id,
    candidateId: row.candidateId,
    adminProfileId: row.adminProfileId,
    assignmentRank: row.priorityRank,
    distanceMeters: row.distanceMeters ? Number(row.distanceMeters) : undefined,
    assignmentStatus: fromDatabaseStatus(row.status),
    decision: fromDatabaseDecision(row.outcome),
    decisionNotes: row.outcomeNotes ?? undefined,
    assignedAt: row.assignedAt.toISOString(),
    acceptedAt: row.claimedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    decisionDueBy: row.expiresAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Creates an AdminAssignmentStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleAdminAssignmentStore(
  db: NodePgDatabase<Record<string, unknown>>
): AdminAssignmentStore {
  return {
    async listCandidatesNeedingReviewerCoverage(limit = 100): Promise<string[] | null> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Candidate reviewer repair batch limit must be between 1 and 100');
      }
      if (!(await reviewerRoutingIsActive(db))) return null;

      const result = await db.execute(sql`
        SELECT routed.candidate_id
        FROM oran_internal.list_undercovered_candidate_reviews(
          ${limit},
          2
        ) AS routed(candidate_id)
      `);

      return resultRows<{ candidate_id: unknown }>(result).map((row) => {
        if (typeof row.candidate_id !== 'string' || row.candidate_id.length === 0) {
          throw new Error('Candidate reviewer repair query returned an invalid candidate identity');
        }
        return row.candidate_id;
      });
    },

    async routeForReview(candidateId, limit = 5): Promise<number | null> {
      if (!(await reviewerRoutingIsActive(db))) return null;
      const result = await db.execute(sql`
        SELECT oran_internal.assign_candidate_reviewers(
          ${candidateId},
          ${limit}
        )::integer AS qualifying_reviewer_count
      `);
      const rawCount = resultRows<{ qualifying_reviewer_count: number | string }>(
        result,
      )[0]?.qualifying_reviewer_count;
      const reviewerCount = Number(rawCount);
      if (!Number.isInteger(reviewerCount) || reviewerCount < 0) {
        throw new Error('Candidate reviewer routing returned an invalid coverage count');
      }
      return reviewerCount;
    },

    async create(assignment: AdminAssignment): Promise<void> {
      await db.insert(candidateAdminAssignments).values({
        candidateId: assignment.candidateId,
        adminProfileId: assignment.adminProfileId,
        assignmentType: 'geographic',
        priorityRank: assignment.assignmentRank,
        distanceMeters: assignment.distanceMeters?.toString(),
        status: toDatabaseStatus(assignment.assignmentStatus),
        assignedAt: new Date(assignment.assignedAt),
        expiresAt: assignment.decisionDueBy
          ? new Date(assignment.decisionDueBy)
          : undefined,
      });
    },

    async bulkCreate(assignments: AdminAssignment[]): Promise<void> {
      if (assignments.length === 0) return;

      const rows = assignments.map((a) => ({
        candidateId: a.candidateId,
        adminProfileId: a.adminProfileId,
        assignmentType: 'geographic' as const,
        priorityRank: a.assignmentRank,
        distanceMeters: a.distanceMeters?.toString(),
        status: toDatabaseStatus(a.assignmentStatus),
        assignedAt: new Date(a.assignedAt),
        expiresAt: a.decisionDueBy ? new Date(a.decisionDueBy) : undefined,
      }));

      await db
        .insert(candidateAdminAssignments)
        .values(rows)
        .onConflictDoNothing();
    },

    async getById(assignmentId: string): Promise<AdminAssignment | null> {
      const rows = await db
        .select()
        .from(candidateAdminAssignments)
        .where(eq(candidateAdminAssignments.id, assignmentId))
        .limit(1);
      return rows.length > 0 ? rowToAssignment(rows[0]) : null;
    },

    async getForCandidateAdmin(
      candidateId: string,
      adminProfileId: string
    ): Promise<AdminAssignment | null> {
      const rows = await db
        .select()
        .from(candidateAdminAssignments)
        .where(
          and(
            eq(candidateAdminAssignments.candidateId, candidateId),
            eq(candidateAdminAssignments.adminProfileId, adminProfileId)
          )
        )
        .limit(1);
      return rows.length > 0 ? rowToAssignment(rows[0]) : null;
    },

    async updateStatus(
      assignmentId: string,
      status: AssignmentStatus,
      decision?: AdminDecision,
      notes?: string
    ): Promise<void> {
      const updates: Record<string, unknown> = {
        status: toDatabaseStatus(status),
        updatedAt: new Date(),
      };

      if (status === 'accepted') {
        updates.claimedAt = new Date();
      }
      if (status === 'completed') {
        updates.completedAt = new Date();
      }
      if (decision) {
        updates.outcome = toDatabaseDecision(decision);
      }
      if (notes) {
        updates.outcomeNotes = notes;
      }

      await db
        .update(candidateAdminAssignments)
        .set(updates)
        .where(eq(candidateAdminAssignments.id, assignmentId));
    },

    async list(
      filters: AdminAssignmentFilters,
      limit?: number,
      offset?: number
    ): Promise<AdminAssignment[]> {
      const conditions = [];

      if (filters.candidateId) {
        conditions.push(
          eq(candidateAdminAssignments.candidateId, filters.candidateId)
        );
      }
      if (filters.adminProfileId) {
        conditions.push(
          eq(candidateAdminAssignments.adminProfileId, filters.adminProfileId)
        );
      }
      if (filters.assignmentStatus) {
        conditions.push(
          eq(candidateAdminAssignments.status, toDatabaseStatus(filters.assignmentStatus))
        );
      }
      if (filters.decision) {
        conditions.push(
          eq(candidateAdminAssignments.outcome, toDatabaseDecision(filters.decision))
        );
      }
      if (filters.isOverdue) {
        conditions.push(
          and(
            lt(candidateAdminAssignments.expiresAt, new Date()),
            inArray(candidateAdminAssignments.status, ['pending', 'claimed'])
          )!
        );
      }

      const query = db
        .select()
        .from(candidateAdminAssignments)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit ?? 50)
        .offset(offset ?? 0);

      const rows = await query;
      return rows.map(rowToAssignment);
    },

    async listForCandidate(candidateId: string): Promise<AdminAssignment[]> {
      const rows = await db
        .select()
        .from(candidateAdminAssignments)
        .where(eq(candidateAdminAssignments.candidateId, candidateId));
      return rows.map(rowToAssignment);
    },

    async listForAdmin(
      adminProfileId: string,
      statusFilter?: AssignmentStatus[]
    ): Promise<AdminAssignment[]> {
      const conditions = [
        eq(candidateAdminAssignments.adminProfileId, adminProfileId),
      ];

      if (statusFilter && statusFilter.length > 0) {
        conditions.push(
          inArray(candidateAdminAssignments.status, statusFilter.map(toDatabaseStatus))
        );
      }

      const rows = await db
        .select()
        .from(candidateAdminAssignments)
        .where(and(...conditions));
      return rows.map(rowToAssignment);
    },

    async listOverdue(limit?: number): Promise<AdminAssignment[]> {
      const rows = await db
        .select()
        .from(candidateAdminAssignments)
        .where(
          and(
            lt(candidateAdminAssignments.expiresAt, new Date()),
            inArray(candidateAdminAssignments.status, ['pending', 'claimed'])
          )
        )
        .limit(limit ?? 50);
      return rows.map(rowToAssignment);
    },

    async withdrawAllForCandidate(candidateId: string): Promise<number> {
      const result = await db
        .update(candidateAdminAssignments)
        .set({
          status: 'reassigned',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(candidateAdminAssignments.candidateId, candidateId),
            inArray(candidateAdminAssignments.status, ['pending', 'claimed'])
          )
        )
        .returning({ id: candidateAdminAssignments.id });
      return result.length;
    },

    async countPending(adminProfileId: string): Promise<number> {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(candidateAdminAssignments)
        .where(
          and(
            eq(candidateAdminAssignments.adminProfileId, adminProfileId),
            eq(candidateAdminAssignments.status, 'pending')
          )
        );
      return result[0]?.count ?? 0;
    },
  };
}
