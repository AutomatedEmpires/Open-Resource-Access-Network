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
    assignmentStatus: row.status as AssignmentStatus,
    decision: row.outcome ? (row.outcome as AdminDecision) : undefined,
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
    async create(assignment: AdminAssignment): Promise<void> {
      await db.insert(candidateAdminAssignments).values({
        candidateId: assignment.candidateId,
        adminProfileId: assignment.adminProfileId,
        assignmentType: 'geographic',
        priorityRank: assignment.assignmentRank,
        distanceMeters: assignment.distanceMeters?.toString(),
        status: assignment.assignmentStatus,
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
        status: a.assignmentStatus,
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
        status,
        updatedAt: new Date(),
      };

      if (status === 'accepted') {
        updates.claimedAt = new Date();
      }
      if (status === 'completed') {
        updates.completedAt = new Date();
      }
      if (decision) {
        updates.outcome = decision;
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
          eq(candidateAdminAssignments.status, filters.assignmentStatus)
        );
      }
      if (filters.decision) {
        conditions.push(
          eq(candidateAdminAssignments.outcome, filters.decision)
        );
      }
      if (filters.isOverdue) {
        conditions.push(
          and(
            lt(candidateAdminAssignments.expiresAt, new Date()),
            inArray(candidateAdminAssignments.status, ['pending', 'accepted'])
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
          inArray(candidateAdminAssignments.status, statusFilter)
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
            inArray(candidateAdminAssignments.status, ['pending', 'accepted'])
          )
        )
        .limit(limit ?? 50);
      return rows.map(rowToAssignment);
    },

    async withdrawAllForCandidate(candidateId: string): Promise<number> {
      const result = await db
        .update(candidateAdminAssignments)
        .set({
          status: 'withdrawn',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(candidateAdminAssignments.candidateId, candidateId),
            inArray(candidateAdminAssignments.status, ['pending', 'accepted'])
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
