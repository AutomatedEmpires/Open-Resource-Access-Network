/**
 * Drizzle ORM implementation of VerificationCheckStore.
 *
 * Maps VerificationCheckResult domain objects to the verification_checks table.
 */
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { verificationChecks } from '@/db/schema';
import type { VerificationCheckResult } from '../contracts';
import type { VerificationCheckStore } from '../stores';

/**
 * Convert a DB row to a VerificationCheckResult domain object.
 */
function rowToCheck(
  row: typeof verificationChecks.$inferSelect
): VerificationCheckResult & { candidateId: string } {
  return {
    checkId: row.id,
    candidateId: row.candidateId,
    extractionId: row.candidateId, // use candidateId as extraction reference
    checkType: row.checkType as VerificationCheckResult['checkType'],
    severity: row.severity as VerificationCheckResult['severity'],
    status: row.status as VerificationCheckResult['status'],
    ranAt: row.checkedAt.toISOString(),
    details: (row.details as Record<string, unknown>) ?? {},
    evidenceRefs: row.evidenceRefs ?? [],
  };
}

/**
 * Creates a VerificationCheckStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleVerificationCheckStore(
  db: NodePgDatabase<Record<string, unknown>>
): VerificationCheckStore {
  return {
    async record(
      check: VerificationCheckResult & { candidateId: string }
    ): Promise<void> {
      await db
        .insert(verificationChecks)
        .values({
          candidateId: check.candidateId,
          checkType: check.checkType,
          severity: check.severity,
          status: check.status,
          message: check.details?.message as string | undefined,
          details: check.details ?? {},
          evidenceRefs: check.evidenceRefs ?? [],
          checkedAt: new Date(check.ranAt),
        })
        .onConflictDoUpdate({
          target: [verificationChecks.candidateId, verificationChecks.checkType],
          set: {
            severity: check.severity,
            status: check.status,
            message: check.details?.message as string | undefined,
            details: check.details ?? {},
            evidenceRefs: check.evidenceRefs ?? [],
            checkedAt: new Date(check.ranAt),
          },
        });
    },

    async listFor(candidateId: string): Promise<VerificationCheckResult[]> {
      const rows = await db
        .select()
        .from(verificationChecks)
        .where(eq(verificationChecks.candidateId, candidateId));
      return rows.map(rowToCheck);
    },

    async getFailingCritical(
      candidateId: string
    ): Promise<VerificationCheckResult[]> {
      const rows = await db
        .select()
        .from(verificationChecks)
        .where(
          and(
            eq(verificationChecks.candidateId, candidateId),
            eq(verificationChecks.severity, 'critical'),
            eq(verificationChecks.status, 'fail')
          )
        );
      return rows.map(rowToCheck);
    },

    async deleteFor(candidateId: string): Promise<void> {
      await db
        .delete(verificationChecks)
        .where(eq(verificationChecks.candidateId, candidateId));
    },
  };
}
