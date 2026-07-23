import type { PoolClient } from 'pg';

import {
  RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION,
  RESOURCE_FRESHNESS_SCANNER_ACTOR,
  deriveResourceFreshnessReviewPacket,
  requiredActionForResourceFreshnessSignal,
  resourceFreshnessPayloadPacketSchema,
  type ResourceFreshnessPayloadPacket,
  type ResourceFreshnessSignal,
} from '@/domain/resourceFreshnessReview';

export const RESOURCE_FRESHNESS_REPAIR_REASON_MIN_LENGTH = 10;
export const RESOURCE_FRESHNESS_REPAIR_REASON_MAX_LENGTH = 500;

interface RepairTargetRow {
  submission_id: string;
  submission_status: string;
  assigned_to_user_id: string | null;
  is_locked: boolean;
  locked_by_user_id: string | null;
  payload: unknown;
  finding_id: string;
  service_id: string;
  signal_type: ResourceFreshnessSignal;
  signal_observed_at: Date | string;
  freshness_threshold_days: number | null;
  evidence: unknown;
  hold_reason: string;
  blocked_at: Date | string;
}

export type ResourceFreshnessRepairResult =
  | {
      kind: 'repaired';
      submissionId: string;
      serviceId: string;
      findingId: string;
      packet: ResourceFreshnessPayloadPacket;
    }
  | {
      kind: 'conflict';
      reason:
        | 'target_mismatch'
        | 'packet_already_valid'
        | 'evidence_unreconstructable';
    };

export interface RepairResourceFreshnessPacketInput {
  submissionId: string;
  actorUserId: string;
  actorRole: 'oran_admin';
  reason: string;
}

export class ResourceFreshnessRepairConflictError extends Error {
  constructor() {
    super('Resource freshness repair target changed during repair');
    this.name = 'ResourceFreshnessRepairConflictError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameInstant(left: string, right: Date | string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = right instanceof Date ? right.getTime() : Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function reconstructPacket(target: RepairTargetRow): ResourceFreshnessPayloadPacket | null {
  // Main's scanner stores findings.evidence = the flat packet minus findingId.
  const packet = resourceFreshnessPayloadPacketSchema.safeParse({
    findingId: target.finding_id,
    ...(asRecord(target.evidence) ?? {}),
  });
  if (!packet.success) return null;

  // The private finding is authoritative. Its denormalized evidence must still
  // describe the exact signal, block instant, and hold identity recorded in
  // the typed columns.
  const expectedHoldReason = `resource_freshness:${target.signal_type}:${target.finding_id}`;
  if (
    packet.data.signalType !== target.signal_type
    || target.hold_reason.toLowerCase() !== expectedHoldReason.toLowerCase()
    || !sameInstant(packet.data.signalObservedAt, target.signal_observed_at)
    || !sameInstant(packet.data.detectedAsOf, target.blocked_at)
    || packet.data.freshnessThresholdDays !== target.freshness_threshold_days
  ) {
    return null;
  }

  // Belt and braces: the flat packet must also derive a valid structured
  // review packet, so review surfaces can always consume the repaired state.
  try {
    deriveResourceFreshnessReviewPacket(packet.data);
  } catch {
    return null;
  }

  return packet.data;
}

/**
 * Rebuild only a missing or malformed scanner packet from the private finding.
 * The caller owns the surrounding transaction. No workflow or hold state is
 * changed by this operation.
 */
export async function repairResourceFreshnessPacketInTransaction(
  client: PoolClient,
  input: RepairResourceFreshnessPacketInput,
): Promise<ResourceFreshnessRepairResult> {
  const repairReason = input.reason.trim();
  if (
    repairReason.length < RESOURCE_FRESHNESS_REPAIR_REASON_MIN_LENGTH
    || repairReason.length > RESOURCE_FRESHNESS_REPAIR_REASON_MAX_LENGTH
  ) {
    throw new TypeError('Resource freshness repair reason is outside the allowed bounds');
  }

  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
     )`,
  );

  const targetResult = await client.query<RepairTargetRow>(
    `SELECT sub.id AS submission_id,
            sub.status AS submission_status,
            sub.assigned_to_user_id,
            sub.is_locked,
            sub.locked_by_user_id,
            sub.payload,
            finding.id AS finding_id,
            finding.service_id,
            finding.signal_type,
            finding.signal_observed_at,
            finding.freshness_threshold_days,
            finding.evidence,
            finding.hold_reason,
            finding.blocked_at
     FROM public.submissions sub
     JOIN oran_internal.resource_freshness_findings finding
       ON finding.submission_id = sub.id
      AND finding.service_id = sub.service_id
      AND finding.status = 'open'
     JOIN public.services service
       ON service.id = sub.service_id
      AND service.id = finding.service_id
      AND service.integrity_hold_reason = finding.hold_reason
      AND service.integrity_held_by_user_id = $2
     WHERE sub.id = $1
       AND sub.submission_type = 'service_verification'
     ORDER BY finding.id
     FOR UPDATE OF sub, finding, service`,
    [input.submissionId, RESOURCE_FRESHNESS_SCANNER_ACTOR],
  );

  if (targetResult.rows.length !== 1) {
    return { kind: 'conflict', reason: 'target_mismatch' };
  }

  const target = targetResult.rows[0];
  const payloadRecord = asRecord(target.payload);
  const currentPacket = resourceFreshnessPayloadPacketSchema.safeParse(
    payloadRecord?.resourceFreshness,
  );
  // A shape-valid packet describing a DIFFERENT finding must be repairable,
  // not declared valid — only the open finding's own packet counts.
  if (currentPacket.success && currentPacket.data.findingId === target.finding_id) {
    return { kind: 'conflict', reason: 'packet_already_valid' };
  }

  const packet = reconstructPacket(target);
  if (!packet) {
    return { kind: 'conflict', reason: 'evidence_unreconstructable' };
  }

  const repairedPayload: Record<string, unknown> = payloadRecord
    ? { ...payloadRecord }
    : {};
  repairedPayload.resourceFreshness = packet;

  const previousPayload = JSON.stringify(target.payload);
  const updated = await client.query<{ id: string }>(
    `UPDATE public.submissions
     SET payload = $2::jsonb,
         updated_at = now()
     WHERE id = $1
       AND submission_type = 'service_verification'
       AND service_id = $4
       AND status = $5
       AND assigned_to_user_id IS NOT DISTINCT FROM $6
       AND is_locked = $7
       AND locked_by_user_id IS NOT DISTINCT FROM $8
       AND payload IS NOT DISTINCT FROM $3::jsonb
       AND EXISTS (
         SELECT 1
         FROM oran_internal.resource_freshness_findings finding
         JOIN public.services service ON service.id = finding.service_id
         WHERE finding.id = $9
           AND finding.submission_id = public.submissions.id
           AND finding.service_id = public.submissions.service_id
           AND finding.status = 'open'
           AND finding.hold_reason = $10
           AND service.integrity_hold_reason = finding.hold_reason
           AND service.integrity_held_by_user_id = $11
       )
     RETURNING id`,
    [
      input.submissionId,
      JSON.stringify(repairedPayload),
      previousPayload,
      target.service_id,
      target.submission_status,
      target.assigned_to_user_id,
      target.is_locked,
      target.locked_by_user_id,
      target.finding_id,
      target.hold_reason,
      RESOURCE_FRESHNESS_SCANNER_ACTOR,
    ],
  );
  if (updated.rows.length !== 1) {
    throw new ResourceFreshnessRepairConflictError();
  }

  const auditMetadata = {
    schemaVersion: RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION,
    repairReason,
    findingId: target.finding_id,
    serviceId: target.service_id,
    signal: target.signal_type,
    requiredAction: requiredActionForResourceFreshnessSignal(target.signal_type),
    previousPacketState: payloadRecord
      && Object.prototype.hasOwnProperty.call(payloadRecord, 'resourceFreshness')
      ? 'invalid'
      : 'missing',
  };
  await client.query(
    `INSERT INTO public.audit_logs
       (action, resource_type, resource_id, after, actor_user_id, actor_role)
     VALUES
       ('resource_freshness_packet_repaired', 'submission', $1, $2::jsonb, $3, $4)`,
    [
      input.submissionId,
      JSON.stringify(auditMetadata),
      input.actorUserId,
      input.actorRole,
    ],
  );

  return {
    kind: 'repaired',
    submissionId: input.submissionId,
    serviceId: target.service_id,
    findingId: target.finding_id,
    packet,
  };
}
