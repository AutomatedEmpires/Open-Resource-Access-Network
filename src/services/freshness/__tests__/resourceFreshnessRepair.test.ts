import { describe, expect, it, vi } from 'vitest';

import {
  ResourceFreshnessRepairConflictError,
  repairResourceFreshnessPacketInTransaction,
} from '../resourceFreshnessRepair';

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const FINDING_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_FINDING_ID = '55555555-5555-4555-8555-555555555555';
const SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const SIGNAL = 'stale_source' as const;
const BLOCKED_AT = '2026-07-13T12:00:00.000Z';
const SIGNAL_OBSERVED_AT = '2026-01-01T00:00:00.000Z';
const HOLD_REASON = `resource_freshness:${SIGNAL}:${FINDING_ID}`;

/** findings.evidence as main's scanner writes it (buildEvidence output). */
function evidence() {
  return {
    scannerVersion: 1,
    signalType: SIGNAL,
    detectedAsOf: BLOCKED_AT,
    signalObservedAt: SIGNAL_OBSERVED_AT,
    freshnessThresholdDays: 180,
    serviceUpdatedAt: '2026-07-01T00:00:00.000Z',
    lastSourceRefreshAt: SIGNAL_OBSERVED_AT,
    lastCandidateVerifiedAt: null,
    lastManualVerificationAt: null,
    reverifyAt: null,
    scheduleCount: 0,
    datedScheduleCount: 0,
    maxValidTo: null,
  };
}

/** submissions.payload.resourceFreshness as main's scanner writes it. */
function validPacket() {
  return {
    findingId: FINDING_ID,
    ...evidence(),
  };
}

function target(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: SUBMISSION_ID,
    submission_status: 'under_review',
    assigned_to_user_id: 'reviewer-1',
    is_locked: true,
    locked_by_user_id: 'reviewer-1',
    payload: {},
    finding_id: FINDING_ID,
    service_id: SERVICE_ID,
    signal_type: SIGNAL,
    signal_observed_at: SIGNAL_OBSERVED_AT,
    freshness_threshold_days: 180,
    evidence: evidence(),
    hold_reason: HOLD_REASON,
    blocked_at: BLOCKED_AT,
    ...overrides,
  };
}

function clientFor(row: ReturnType<typeof target> | null, updateRows = [{ id: SUBMISSION_ID }]) {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FOR UPDATE OF sub, finding, service')) {
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE public.submissions')) return { rows: updateRows };
      if (sql.includes('INSERT INTO public.audit_logs')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

const input = {
  submissionId: SUBMISSION_ID,
  actorUserId: 'oran-admin-1',
  actorRole: 'oran_admin' as const,
  reason: 'Restore the scanner packet from its authoritative finding.',
};

describe('repairResourceFreshnessPacketInTransaction', () => {
  it('rejects an unbounded audit reason before acquiring locks', async () => {
    const client = clientFor(target());

    await expect(repairResourceFreshnessPacketInTransaction(client as never, {
      ...input,
      reason: 'x'.repeat(501),
    })).rejects.toBeInstanceOf(TypeError);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('repairs a missing packet while preserving every unrelated payload key', async () => {
    const originalPayload = {
      unrelated: { keep: true },
      correlationId: 'correlation-1',
      // Legacy key from the retired review lane: preserved untouched — main
      // never writes it, so removing it would be a claim about state this
      // deployment cannot produce.
      resourceFreshnessReview: { outcome: 'confirmed_current' },
    };
    const client = clientFor(target({ payload: originalPayload }));

    const result = await repairResourceFreshnessPacketInTransaction(client as never, input);

    expect(result).toMatchObject({
      kind: 'repaired',
      submissionId: SUBMISSION_ID,
      serviceId: SERVICE_ID,
      findingId: FINDING_ID,
      packet: validPacket(),
    });
    expect(String(client.query.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');

    const lockCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('FOR UPDATE OF sub, finding, service')
    ));
    const lockSql = String(lockCall?.[0]);
    expect(lockSql).toContain("finding.status = 'open'");
    expect(lockSql).toContain('finding.service_id = sub.service_id');
    expect(lockSql).toContain('service.integrity_hold_reason = finding.hold_reason');
    expect(lockSql).toContain('service.integrity_held_by_user_id = $2');
    expect(lockSql).toContain("sub.submission_type = 'service_verification'");

    const updateCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE public.submissions')
    ));
    const updateSql = String(updateCall?.[0]);
    const updateParams = updateCall?.[1] as unknown[];
    expect(updateSql).toContain('RETURNING id');
    expect(updateSql).toContain('payload IS NOT DISTINCT FROM $3::jsonb');
    expect(updateSql).toContain('assigned_to_user_id IS NOT DISTINCT FROM $6');
    expect(updateSql).toContain("finding.status = 'open'");
    expect(updateSql).not.toContain('SET status');
    expect(updateSql).not.toContain('assigned_to_user_id =');
    const repairedPayload = JSON.parse(String(updateParams[1]));
    expect(repairedPayload).toEqual({
      unrelated: { keep: true },
      correlationId: 'correlation-1',
      resourceFreshnessReview: { outcome: 'confirmed_current' },
      resourceFreshness: validPacket(),
    });
    expect(JSON.parse(String(updateParams[2]))).toEqual(originalPayload);

    const auditCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO public.audit_logs')
    ));
    const auditParams = auditCall?.[1] as unknown[];
    expect(auditParams[0]).toBe(SUBMISSION_ID);
    expect(auditParams[2]).toBe('oran-admin-1');
    expect(auditParams[3]).toBe('oran_admin');
    expect(JSON.parse(String(auditParams[1]))).toEqual({
      schemaVersion: 1,
      repairReason: input.reason,
      findingId: FINDING_ID,
      serviceId: SERVICE_ID,
      signal: SIGNAL,
      requiredAction: 'refresh_authoritative_source',
      previousPacketState: 'missing',
    });
    expect(String(auditParams[1])).not.toContain('serviceUpdatedAt');
    expect(String(auditParams[1])).not.toContain('lastSourceRefreshAt');
  });

  it('repairs an invalid packet and records the previous state', async () => {
    const client = clientFor(target({
      payload: {
        keep: 'yes',
        resourceFreshness: { scannerVersion: 999, raw: 'invalid' },
      },
    }));

    const result = await repairResourceFreshnessPacketInTransaction(client as never, input);

    expect(result.kind).toBe('repaired');
    const updateCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE public.submissions')
    ));
    expect(JSON.parse(String(updateCall?.[1]?.[1]))).toEqual({
      keep: 'yes',
      resourceFreshness: validPacket(),
    });
    const auditCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO public.audit_logs')
    ));
    expect(JSON.parse(String(auditCall?.[1]?.[1]))).toMatchObject({
      previousPacketState: 'invalid',
    });
  });

  it('does not overwrite a packet that already matches the open finding', async () => {
    const client = clientFor(target({ payload: { resourceFreshness: validPacket() } }));

    await expect(repairResourceFreshnessPacketInTransaction(client as never, input)).resolves.toEqual({
      kind: 'conflict',
      reason: 'packet_already_valid',
    });
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE public.submissions')
    ))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO public.audit_logs')
    ))).toBe(false);
  });

  it('repairs a shape-valid packet that belongs to a DIFFERENT finding', async () => {
    const strayPacket = { ...validPacket(), findingId: OTHER_FINDING_ID };
    const client = clientFor(target({ payload: { resourceFreshness: strayPacket } }));

    const result = await repairResourceFreshnessPacketInTransaction(client as never, input);

    expect(result.kind).toBe('repaired');
    const updateCall = client.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE public.submissions')
    ));
    expect(JSON.parse(String(updateCall?.[1]?.[1]))).toEqual({
      resourceFreshness: validPacket(),
    });
  });

  it('rejects missing, closed, or identity-mismatched authoritative targets before mutation', async () => {
    const client = clientFor(null);

    await expect(repairResourceFreshnessPacketInTransaction(client as never, input)).resolves.toEqual({
      kind: 'conflict',
      reason: 'target_mismatch',
    });
    const lockSql = String(client.query.mock.calls[1]?.[0]);
    expect(lockSql).toContain("finding.status = 'open'");
    expect(lockSql).toContain('finding.submission_id = sub.id');
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['malformed evidence', { evidence: { detectedAsOf: BLOCKED_AT } }],
    ['observed-instant mismatch', { signal_observed_at: '2026-01-02T00:00:00.000Z' }],
    ['block-instant mismatch', { blocked_at: '2026-07-13T12:00:01.000Z' }],
    ['threshold mismatch', { freshness_threshold_days: 90 }],
    ['hold identity mismatch', { hold_reason: `resource_freshness:${SIGNAL}:44444444-4444-4444-8444-444444444444` }],
    ['signal column disagreeing with evidence', {
      signal_type: 'reverification_due',
      hold_reason: `resource_freshness:reverification_due:${FINDING_ID}`,
    }],
  ])('rejects unreconstructable %s without updating or auditing', async (_label, overrides) => {
    const client = clientFor(target(overrides));

    await expect(repairResourceFreshnessPacketInTransaction(client as never, input)).resolves.toEqual({
      kind: 'conflict',
      reason: 'evidence_unreconstructable',
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('throws on a guarded update miss so the caller rolls back and never appends an audit row', async () => {
    const client = clientFor(target(), []);

    await expect(
      repairResourceFreshnessPacketInTransaction(client as never, input),
    ).rejects.toBeInstanceOf(ResourceFreshnessRepairConflictError);
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO public.audit_logs')
    ))).toBe(false);
  });
});
