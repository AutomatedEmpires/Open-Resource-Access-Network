/**
 * Drizzle-backed implementation of AuditStore.
 *
 * Maps AuditEvent contract fields to the ingestion_audit_events table.
 * Fields not present as dedicated columns (correlationId, targetType,
 * targetId, inputs, outputs, evidenceRefs, eventId) are stored inside
 * the `details` JSONB column to avoid a schema migration that would
 * break candidateStore's existing inline audit writes.
 */

import { eq, desc, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { ingestionAuditEvents } from '@/db/schema';
import type { AuditEvent } from '../contracts';
import type { AuditStore } from '../stores';

/**
 * Convert an AuditEvent (contract shape) to an ingestion_audit_events row.
 *
 * DB columns: candidateId, eventType, actorType, actorId, details (jsonb)
 * Contract extras packed into details: eventId, correlationId, targetType,
 * targetId, inputs, outputs, evidenceRefs.
 */
function toRow(event: AuditEvent) {
  return {
    candidateId: event.targetId,
    eventType: event.eventType,
    actorType: event.actorType,
    actorId: event.actorId,
    details: {
      eventId: event.eventId,
      correlationId: event.correlationId,
      targetType: event.targetType,
      inputs: event.inputs,
      outputs: event.outputs,
      evidenceRefs: event.evidenceRefs,
      timestamp: event.timestamp,
    },
  };
}

/**
 * Reconstruct an AuditEvent from a DB row.
 * Fields stored in `details` JSONB are unpacked back into top-level contract fields.
 * Rows written by candidateStore (which uses flat event types and no contract extras)
 * are also handled gracefully.
 */
function fromRow(row: typeof ingestionAuditEvents.$inferSelect): AuditEvent {
  const details = (row.details ?? {}) as Record<string, unknown>;
  return {
    eventId: (details.eventId as string) ?? row.id,
    correlationId: (details.correlationId as string) ?? '',
    eventType: row.eventType as AuditEvent['eventType'],
    actorType: row.actorType as AuditEvent['actorType'],
    actorId: row.actorId ?? 'unknown',
    targetType: (details.targetType as AuditEvent['targetType']) ?? 'candidate',
    targetId: row.candidateId,
    timestamp: (details.timestamp as string) ?? row.createdAt.toISOString(),
    inputs: (details.inputs as Record<string, unknown>) ?? {},
    outputs: (details.outputs as Record<string, unknown>) ?? {},
    evidenceRefs: (details.evidenceRefs as string[]) ?? [],
  };
}

export function createDrizzleAuditStore(
  db: NodePgDatabase<Record<string, unknown>>
): AuditStore {
  return {
    async append(event: AuditEvent): Promise<void> {
      await db.insert(ingestionAuditEvents).values(toRow(event));
    },

    async listByCorrelation(correlationId: string): Promise<AuditEvent[]> {
      const rows = await db
        .select()
        .from(ingestionAuditEvents)
        .where(
          sql`${ingestionAuditEvents.details}->>'correlationId' = ${correlationId}`
        )
        .orderBy(desc(ingestionAuditEvents.createdAt));
      return rows.map(fromRow);
    },

    async listByTarget(targetType: string, targetId: string): Promise<AuditEvent[]> {
      // targetId is stored as candidateId in the DB.
      // We also filter by targetType in the details JSONB when present.
      const rows = await db
        .select()
        .from(ingestionAuditEvents)
        .where(
          and(
            eq(ingestionAuditEvents.candidateId, targetId),
            sql`(${ingestionAuditEvents.details}->>'targetType' = ${targetType} OR ${ingestionAuditEvents.details}->>'targetType' IS NULL)`
          )
        )
        .orderBy(desc(ingestionAuditEvents.createdAt));
      return rows.map(fromRow);
    },

    async listByType(eventType: string, limit = 100): Promise<AuditEvent[]> {
      const rows = await db
        .select()
        .from(ingestionAuditEvents)
        .where(eq(ingestionAuditEvents.eventType, eventType))
        .orderBy(desc(ingestionAuditEvents.createdAt))
        .limit(limit);
      return rows.map(fromRow);
    },
  };
}
