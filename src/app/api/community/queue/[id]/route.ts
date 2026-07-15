/**
 * GET /api/community/queue/[id] — Fetch a single submission with full service + org details.
 * PUT /api/community/queue/[id] — Submit a review decision (approve / deny / escalate / return).
 *
 * Uses the universal submissions table (migration 0022).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  decisionForResourceFreshnessOutcome,
  resourceFreshnessOutcomeError,
  resourceFreshnessReviewPacketSchema,
  resourceFreshnessReviewSchema,
  resourceFreshnessReviewTimingError,
  type ResourceFreshnessOutcome,
  type ResourceFreshnessScheduleCorrection,
  type ResourceFreshnessReviewPacket,
} from '@/domain/resourceFreshnessReview';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { buildCommunitySubmissionScope, getCommunityAdminScope } from '@/services/community/scope';
import {
  advanceInTransaction,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import {
  reconcileResourceFreshnessReview,
  type ResourceFreshnessReconciliationResult,
} from '@/services/freshness/resourceFreshness';
import type { PoolClient } from 'pg';
import type { HostServiceRequestedChanges, HostServiceVerificationPayload } from '@/services/ingestion/hostPortalIntake';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';
import {
  acquireProtectedMaintenanceGatesShared,
  assertAuthoritativeEntitiesMutable,
  ProtectedAuthoritativeMutationConflict,
} from '@/services/publication/protectedAuthoritativeMutation';
import {
  appendLifecycleEvent,
  buildPublicationLifecycleWindow,
} from '@/services/publication/livePublication';

// ============================================================
// SCHEMAS
// ============================================================

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'denied', 'escalated', 'returned', 'pending_second_approval'], {
    message: 'decision is required',
  }).optional(),
  notes: z.string().max(5000).optional(),
  freshnessReview: resourceFreshnessReviewSchema.optional(),
}).strict();

const GENERIC_COMMUNITY_REVIEW_TYPES = new Set(['service_verification']);

const storedDestructiveFreshnessReviewSchema = z.object({
  transitionId: z.string().min(1),
  reviewerUserId: z.string().min(1),
  recordedAt: z.string().datetime({ offset: true }),
  review: resourceFreshnessReviewSchema.refine(
    (review) => review.outcome === 'confirmed_unavailable',
    'Stored destructive review must confirm that the resource is unavailable',
  ),
}).strict();

type StoredDestructiveFreshnessReview = z.infer<
  typeof storedDestructiveFreshnessReviewSchema
>;
type PendingDestructiveFreshnessReview = Omit<
  StoredDestructiveFreshnessReview,
  'transitionId'
>;

// ============================================================
// HELPERS
// ============================================================
type RouteContext = { params: Promise<{ id: string }> };

class FreshnessReconciliationConflict extends Error {
  constructor(readonly clientMessage: string) {
    super(clientMessage);
    this.name = 'FreshnessReconciliationConflict';
  }
}

class LiveProjectionConflict extends Error {
  constructor(readonly clientMessage: string) {
    super(clientMessage);
    this.name = 'LiveProjectionConflict';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getStoredDestructiveFreshnessReview(
  payload: unknown,
): StoredDestructiveFreshnessReview | null {
  const parsed = storedDestructiveFreshnessReviewSchema.safeParse(
    asRecord(payload).resourceFreshnessFirstReview,
  );
  return parsed.success ? parsed.data : null;
}

type ResourceFreshnessPacketState =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'valid'; packet: ResourceFreshnessReviewPacket };

function getResourceFreshnessPacketState(payload: unknown): ResourceFreshnessPacketState {
  const record = asRecord(payload);
  if (!Object.prototype.hasOwnProperty.call(record, 'resourceFreshness')) {
    return { kind: 'none' };
  }
  const parsed = resourceFreshnessReviewPacketSchema.safeParse(record.resourceFreshness);
  return parsed.success
    ? { kind: 'valid', packet: parsed.data }
    : { kind: 'invalid' };
}

function isExpectedFreshnessReconciliation(
  packet: ResourceFreshnessReviewPacket,
  outcome: ResourceFreshnessOutcome,
  reconciliation: ResourceFreshnessReconciliationResult,
): boolean {
  if (reconciliation.findingId !== packet.findingId) return false;

  switch (outcome) {
    case 'confirmed_current':
    case 'corrected':
      return reconciliation.state === 'hold_cleared'
        || reconciliation.state === 'non_scanner_hold_retained';
    case 'confirmed_unavailable':
      return reconciliation.state === 'confirmed_unavailable';
    case 'unable_to_verify':
      return reconciliation.state === 'verification_inconclusive';
  }
}

interface AttachedScheduleValidityRow {
  id: string;
  service_id: string | null;
  location_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  current_date: string;
}

async function validateExplicitExpiryCorrections(
  client: PoolClient,
  serviceId: string,
  corrections: ResourceFreshnessScheduleCorrection[],
): Promise<string | null> {
  const serviceLock = await client.query<{ id: string }>(
    `SELECT service.id
     FROM services service
     WHERE service.id = $1
     FOR UPDATE OF service`,
    [serviceId],
  );
  if (serviceLock.rows.length !== 1) return 'Freshness review has no linked service';

  // Lock every currently attached location before reading its schedules.
  // A schedule insert needs an FK key-share on the location, so this prevents
  // an expired shared-schedule phantom from appearing before hold clearance.
  await client.query(
    `SELECT location.id
     FROM locations location
     JOIN service_at_location sal ON sal.location_id = location.id
     WHERE sal.service_id = $1
       AND location.status = 'active'
     ORDER BY location.id
     FOR UPDATE OF location, sal`,
    [serviceId],
  );

  const direct = await client.query<AttachedScheduleValidityRow>(
    `SELECT schedule.id, schedule.service_id, schedule.location_id,
            schedule.valid_from::text, schedule.valid_to::text,
            current_date::text AS current_date
     FROM schedules schedule
     WHERE schedule.service_id = $1
     ORDER BY schedule.id
     FOR UPDATE OF schedule`,
    [serviceId],
  );
  const shared = await client.query<AttachedScheduleValidityRow>(
    `SELECT schedule.id, schedule.service_id, schedule.location_id,
            schedule.valid_from::text, schedule.valid_to::text,
            current_date::text AS current_date
     FROM schedules schedule
     JOIN service_at_location sal ON sal.location_id = schedule.location_id
     JOIN locations location ON location.id = schedule.location_id
     WHERE schedule.service_id IS NULL
       AND schedule.location_id IS NOT NULL
       AND sal.service_id = $1
       AND location.status = 'active'
     ORDER BY schedule.id
     FOR UPDATE OF schedule, sal, location`,
    [serviceId],
  );
  const rows = [...direct.rows, ...shared.rows];

  const currentDate = rows[0]?.current_date ?? new Date().toISOString().slice(0, 10);
  const attachedById = new Map(rows.map((row) => [row.id, row]));
  const correctionById = new Map(corrections.map((correction) => [
    correction.scheduleId,
    correction,
  ]));

  for (const correction of corrections) {
    const schedule = attachedById.get(correction.scheduleId);
    if (!schedule) return 'A corrected schedule is no longer attached to this service';
    if (schedule.service_id !== serviceId) {
      return 'Shared location schedules must be corrected by an authorized resource maintainer';
    }
    if (correction.validFrom !== null && correction.validFrom > currentDate) {
      return 'Corrected schedule start cannot be in the future';
    }
    if (correction.validTo !== null && correction.validTo < currentDate) {
      return 'Corrected schedule expiry must be today or later, or have no end date';
    }
  }

  if (rows.some((row) => (
    row.service_id === null
    && row.location_id !== null
    && row.valid_to !== null
    && row.valid_to < currentDate
  ))) {
    return 'An expired shared location schedule requires authorized location-level maintenance';
  }

  const omittedExpiredDirectSchedule = rows.some((row) => (
    row.service_id === serviceId
    && row.valid_to !== null
    && row.valid_to < currentDate
    && !correctionById.has(row.id)
  ));
  if (corrections.length > 0 && omittedExpiredDirectSchedule) {
    return 'Every expired direct service schedule must be included in the correction';
  }

  const projectedRows = rows.map((row) => {
    const correction = correctionById.get(row.id);
    return correction ? { ...row, valid_to: correction.validTo } : row;
  });
  const stillExpired = projectedRows.length > 0 && projectedRows.every((row) => (
    row.valid_to !== null && row.valid_to < currentDate
  ));

  return stillExpired
    ? 'Attached schedules must be corrected before this listing can be approved'
    : null;
}

function parseRequestedChanges(value: unknown): HostServiceRequestedChanges {
  return asRecord(value) as HostServiceRequestedChanges;
}

async function applySubmittedServiceChanges(
  client: PoolClient,
  serviceId: string,
  requestedChanges: HostServiceRequestedChanges,
  actorUserId: string,
  forceStatus: 'active' | 'defunct' = 'active',
): Promise<void> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    url: 'url',
    email: 'email',
    interpretationServices: 'interpretation_services',
    applicationProcess: 'application_process',
    waitTime: 'wait_time',
    fees: 'fees',
    accreditations: 'accreditations',
    licenses: 'licenses',
  };

  for (const [tsKey, dbCol] of Object.entries(fieldMap)) {
    if (!(tsKey in requestedChanges)) continue;
    params.push((requestedChanges as Record<string, unknown>)[tsKey] ?? null);
    setClauses.push(`${dbCol} = $${params.length}`);
  }

  params.push(forceStatus);
  setClauses.push(`status = $${params.length}`);

  params.push(actorUserId);
  setClauses.push(`updated_by_user_id = $${params.length}`);

  params.push(serviceId);
  const updated = await client.query<{ id: string }>(
    `UPDATE services
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
       AND status = 'active'
     RETURNING id`,
    params,
  );
  if (!updated.rows[0]) {
    throw new LiveProjectionConflict(
      'The linked service is no longer active. A new reactivation review with current evidence is required.',
    );
  }

  if (requestedChanges.phones !== undefined) {
    await client.query('DELETE FROM phones WHERE service_id = $1', [serviceId]);
    for (const phone of requestedChanges.phones) {
      await client.query(
        `INSERT INTO phones (service_id, number, extension, type, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          serviceId,
          phone.number,
          phone.extension ?? null,
          phone.type === 'text' ? 'sms' : phone.type,
          phone.description ?? null,
        ],
      );
    }
  }

  if (requestedChanges.schedule !== undefined) {
    await client.query('DELETE FROM schedules WHERE service_id = $1', [serviceId]);
    for (const day of requestedChanges.schedule) {
      if (day.closed) continue;
      await client.query(
        `INSERT INTO schedules (service_id, days, opens_at, closes_at)
         VALUES ($1, $2, $3, $4)`,
        [serviceId, [day.day], day.opens, day.closes],
      );
    }
  }
}

async function applyApprovedServiceVerification(
  client: PoolClient,
  submissionId: string,
  actorUserId: string,
): Promise<{
  serviceId: string | null;
  shouldUpdateConfidence: boolean;
  verificationApplied: boolean;
}> {
  const rows = await client.query<{
    submission_type: string;
    service_id: string | null;
    payload: HostServiceVerificationPayload | null;
  }>(
    `SELECT submission_type, service_id, payload
     FROM submissions
     WHERE id = $1
     FOR UPDATE`,
    [submissionId],
  );

  const submission = rows.rows[0];
  if (!submission || submission.submission_type !== 'service_verification' || !submission.service_id) {
    return {
      serviceId: null,
      shouldUpdateConfidence: false,
      verificationApplied: false,
    };
  }

  const payload = asRecord(submission.payload) as Partial<HostServiceVerificationPayload>;
  const requestedChanges = parseRequestedChanges(payload.requestedChanges);

  switch (payload.changeType) {
    case 'host_service_archive':
      {
        const archived = await client.query<{ id: string }>(
        `UPDATE services
         SET status = 'defunct', updated_at = NOW(), updated_by_user_id = $2
         WHERE id = $1
           AND status = 'active'
         RETURNING id`,
        [submission.service_id, actorUserId],
        );
        if (!archived.rows[0]) {
          throw new LiveProjectionConflict(
            'The linked service has already been retired and cannot accept this review.',
          );
        }
      }
      return {
        serviceId: submission.service_id,
        shouldUpdateConfidence: false,
        verificationApplied: false,
      };
    case 'host_service_update':
      await applySubmittedServiceChanges(client, submission.service_id, requestedChanges, actorUserId, 'active');
      break;
    case 'host_service_create':
      await applySubmittedServiceChanges(client, submission.service_id, requestedChanges, actorUserId, 'active');
      break;
    default:
      {
        const activated = await client.query<{ id: string }>(
        `UPDATE services
         SET status = 'active', updated_at = NOW(), updated_by_user_id = $2
         WHERE id = $1
           AND status = 'active'
         RETURNING id`,
        [submission.service_id, actorUserId],
        );
        if (!activated.rows[0]) {
          throw new LiveProjectionConflict(
            'The linked service is no longer active. A new reactivation review with current evidence is required.',
          );
        }
      }
      break;
  }

  return {
    serviceId: submission.service_id,
    shouldUpdateConfidence: true,
    verificationApplied: true,
  };
}

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`community:verify:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const detailParams: unknown[] = [id];
    const scope = authCtx.role === 'oran_admin'
      ? null
      : await getCommunityAdminScope(authCtx.userId);
    const scopeCondition = scope
      ? buildCommunitySubmissionScope('sub', scope, detailParams)
      : null;

    // Full detail: submission + service + organization
    const rows = await executeQuery<{
      id: string;
      submission_type: string;
      status: string;
      service_id: string | null;
      target_type: string;
      target_id: string | null;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      title: string | null;
      notes: string | null;
      reviewer_notes: string | null;
      payload: Record<string, unknown>;
      requires_structured_freshness_review: boolean;
      evidence: unknown[];
      priority: number;
      is_locked: boolean;
      locked_by_user_id: string | null;
      sla_deadline: string | null;
      sla_breached: boolean;
      created_at: string;
      updated_at: string;
      // Service
      service_name: string | null;
      service_description: string | null;
      service_url: string | null;
      service_email: string | null;
      service_status: string | null;
      // Organization
      organization_id: string | null;
      organization_name: string | null;
      organization_url: string | null;
      organization_email: string | null;
      organization_description: string | null;
      submitted_by_display_name: string | null;
      assigned_to_display_name: string | null;
    }>(
      `SELECT sub.id, sub.submission_type, sub.status,
              sub.service_id, sub.target_type, sub.target_id,
              sub.submitted_by_user_id, sub.assigned_to_user_id,
              sub.title, sub.notes, sub.reviewer_notes,
              sub.payload,
              (
                CASE
                  WHEN pg_catalog.jsonb_typeof(sub.payload) = 'object'
                    THEN sub.payload ? 'resourceFreshness'
                  ELSE false
                END
                OR EXISTS (
                  SELECT 1
                  FROM oran_internal.resource_freshness_findings finding
                  WHERE finding.submission_id = sub.id
                    AND finding.status = 'open'
                )
              ) AS requires_structured_freshness_review,
              sub.evidence, sub.priority,
              sub.is_locked, sub.locked_by_user_id,
              sub.sla_deadline, sub.sla_breached,
              sub.created_at, sub.updated_at,
              s.name AS service_name, s.description AS service_description,
              s.url AS service_url, s.email AS service_email, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name,
              o.url AS organization_url, o.email AS organization_email,
              o.description AS organization_description,
              up_sub.display_name AS submitted_by_display_name,
              up_assign.display_name AS assigned_to_display_name
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       LEFT JOIN user_profiles up_sub ON up_sub.user_id = sub.submitted_by_user_id
       LEFT JOIN user_profiles up_assign ON up_assign.user_id = sub.assigned_to_user_id
       WHERE sub.id = $1${scopeCondition ? ` AND ${scopeCondition}` : ''}`,
      detailParams,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const entry = rows[0];

    // Fetch locations if service exists
    let locations: unknown[] = [];
    let phones: unknown[] = [];
    let schedules: unknown[] = [];
    if (entry.service_id) {
      locations = await executeQuery<{
        id: string;
        name: string | null;
        address_1: string | null;
        city: string | null;
        state_province: string | null;
        postal_code: string | null;
        latitude: number | null;
        longitude: number | null;
      }>(
        `SELECT l.id, l.name, a.address_1, a.city, a.state_province, a.postal_code,
                l.latitude, l.longitude
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id
         LEFT JOIN addresses a ON a.location_id = l.id
         WHERE sal.service_id = $1`,
        [entry.service_id],
      );

      phones = await executeQuery<{
        id: string;
        number: string;
        type: string | null;
        description: string | null;
      }>(
        `SELECT id, number, type, description FROM phones WHERE service_id = $1`,
        [entry.service_id],
      );

      schedules = await executeQuery<{
        id: string;
        service_id: string | null;
        location_id: string | null;
        location_name: string | null;
        valid_from: string | null;
        valid_to: string | null;
        days: string[] | null;
        opens_at: string | null;
        closes_at: string | null;
        description: string | null;
      }>(
        `SELECT schedule.id, schedule.service_id, schedule.location_id,
                location.name AS location_name,
                schedule.valid_from, schedule.valid_to, schedule.days,
                schedule.opens_at, schedule.closes_at, schedule.description
         FROM schedules schedule
         LEFT JOIN locations location ON location.id = schedule.location_id
         WHERE schedule.service_id = $1
            OR (
              schedule.service_id IS NULL
              AND schedule.location_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM service_at_location sal
                WHERE sal.location_id = schedule.location_id
                  AND sal.service_id = $1
              )
            )
         ORDER BY schedule.valid_to NULLS LAST, schedule.id`,
        [entry.service_id],
      );
    }

    // Fetch confidence score
    const scores = entry.service_id
      ? await executeQuery<{
          score: number;
          verification_confidence: number;
          eligibility_match: number;
          constraint_fit: number;
          computed_at: string;
        }>(
          `SELECT score, verification_confidence, eligibility_match, constraint_fit, computed_at
           FROM confidence_scores WHERE service_id = $1`,
          [entry.service_id],
        )
      : [];

    // Fetch transition history
    const transitions = await executeQuery<{
      id: string;
      from_status: string;
      to_status: string;
      actor_user_id: string;
      actor_role: string | null;
      reason: string | null;
      metadata: Record<string, unknown>;
      gates_passed: boolean;
      created_at: string;
      actor_display_name: string | null;
    }>(
      `SELECT st.id, st.from_status, st.to_status, st.actor_user_id, st.actor_role,
              st.reason, st.metadata, st.gates_passed, st.created_at,
              up.display_name AS actor_display_name
       FROM submission_transitions st
       LEFT JOIN user_profiles up ON up.user_id = st.actor_user_id
       WHERE st.submission_id = $1
       ORDER BY st.created_at ASC`,
      [id],
    );

    return NextResponse.json(
      {
        ...entry,
        locations,
        phones,
        schedules,
        confidenceScore: scores[0] ?? null,
        transitions,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_verify_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`community:verify:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    decision: requestedDecision,
    notes,
    freshnessReview,
  } = parsed.data;

  try {
    const accessParams: unknown[] = [id];
    const scope = authCtx.role === 'oran_admin'
      ? null
      : await getCommunityAdminScope(authCtx.userId);
    const scopeCondition = scope
      ? buildCommunitySubmissionScope('sub', scope, accessParams)
      : null;
    const preliminaryRows = await executeQuery<{
      id: string;
      submission_type: string;
      service_id: string | null;
      payload: Record<string, unknown> | null;
      has_open_freshness_finding: boolean;
      has_form_instance: boolean;
    }>(
      `SELECT sub.id, sub.submission_type, sub.service_id, sub.payload,
              EXISTS (
                SELECT 1
                FROM oran_internal.resource_freshness_findings finding
                WHERE finding.submission_id = sub.id
                  AND finding.status = 'open'
              ) AS has_open_freshness_finding,
              EXISTS (
                SELECT 1
                FROM form_instances form_instance
                WHERE form_instance.submission_id = sub.id
              ) AS has_form_instance
       FROM submissions sub
       WHERE sub.id = $1${scopeCondition ? ` AND ${scopeCondition}` : ''}`,
      accessParams,
    );

    const preliminary = preliminaryRows[0];
    if (!preliminary) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }
    if (
      !GENERIC_COMMUNITY_REVIEW_TYPES.has(preliminary.submission_type)
      || preliminary.has_form_instance
    ) {
      return NextResponse.json(
        {
          error: 'This submission requires its dedicated typed review endpoint',
          submissionType: preliminary.submission_type,
        },
        { status: 409 },
      );
    }

    const atomicResult = await withTransaction(async (client) => {
      // Global order: publication gate -> freshness gate -> row locks. Merge
      // takes the exclusive side, so no completed merge source can be
      // reactivated or have child rows recreated by a stale approval.
      await acquireLivePublicationGateShared(client);

      // The scanner uses the same freshness lock. Acquire it after the shared
      // publication gate and before service/submission row locks.
      if (preliminary.submission_type === 'service_verification') {
        await client.query(
          `SELECT pg_catalog.pg_advisory_xact_lock(
             pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
           )`,
        );
      }

      // Maintenance workflows take the exclusive side of these keys. Keep
      // this after freshness and before submission/service row locks.
      await acquireProtectedMaintenanceGatesShared(client);

      const lockedRows = await client.query<{
        id: string;
        submission_type: string;
        status: string;
        assigned_to_user_id: string | null;
        is_locked: boolean;
        locked_by_user_id: string | null;
        service_id: string | null;
        payload: Record<string, unknown> | null;
        has_open_freshness_finding: boolean;
        has_form_instance: boolean;
      }>(
        `SELECT sub.id, sub.submission_type, sub.status,
                sub.assigned_to_user_id, sub.is_locked, sub.locked_by_user_id,
                sub.service_id, sub.payload,
                EXISTS (
                  SELECT 1
                  FROM oran_internal.resource_freshness_findings finding
                  WHERE finding.submission_id = sub.id
                    AND finding.status = 'open'
                ) AS has_open_freshness_finding,
                EXISTS (
                  SELECT 1
                  FROM form_instances form_instance
                  WHERE form_instance.submission_id = sub.id
                ) AS has_form_instance
         FROM submissions sub
         WHERE sub.id = $1${scopeCondition ? ` AND ${scopeCondition}` : ''}
         FOR UPDATE OF sub`,
        accessParams,
      );
      const submission = lockedRows.rows[0];
      if (!submission) {
        return { ok: false as const, status: 404, body: { error: 'Submission not found' } };
      }
      if (
        !GENERIC_COMMUNITY_REVIEW_TYPES.has(submission.submission_type)
        || submission.has_form_instance
      ) {
        return {
          ok: false as const,
          status: 409,
          body: {
            error: 'This submission requires its dedicated typed review endpoint',
            submissionType: submission.submission_type,
          },
        };
      }
      if (
        !['under_review', 'pending_second_approval'].includes(submission.status)
        || submission.assigned_to_user_id !== authCtx.userId
        || !submission.is_locked
        || submission.locked_by_user_id !== authCtx.userId
      ) {
        return {
          ok: false as const,
          status: 409,
          body: { error: 'Claim and lock this submission before applying a decision.' },
        };
      }

      const packetState = getResourceFreshnessPacketState(submission.payload);
      if (
        packetState.kind === 'invalid'
        || (submission.has_open_freshness_finding && packetState.kind === 'none')
      ) {
        return {
          ok: false as const,
          status: 409,
          body: { error: 'Freshness review packet is invalid. Escalate this item to ORAN administration.' },
        };
      }

      let decision = requestedDecision;
      let stageDestructiveFreshnessReview = false;
      let completeDestructiveFreshnessReview = false;
      let destructiveReviewRecord: PendingDestructiveFreshnessReview | null = null;
      if (packetState.kind === 'valid') {
        if (!freshnessReview) {
          return {
            ok: false as const,
            status: 400,
            body: { error: 'Structured freshness review evidence is required' },
          };
        }

        const timingError = resourceFreshnessReviewTimingError(freshnessReview.checkedAt);
        const outcomeError = resourceFreshnessOutcomeError(packetState.packet, freshnessReview);
        if (timingError || outcomeError) {
          return {
            ok: false as const,
            status: 400,
            body: {
              error: 'Validation failed',
              details: [{ message: timingError ?? outcomeError }],
            },
          };
        }

        const mappedDecision = decisionForResourceFreshnessOutcome(freshnessReview.outcome);
        const payload = asRecord(submission.payload);
        const hasStoredDestructiveReview = Object.prototype.hasOwnProperty.call(
          payload,
          'resourceFreshnessFirstReview',
        );
        const storedDestructiveReview = getStoredDestructiveFreshnessReview(payload);

        if (hasStoredDestructiveReview && !storedDestructiveReview) {
          return {
            ok: false as const,
            status: 409,
            body: {
              error: 'The first destructive freshness review is invalid. Escalate this item to ORAN administration.',
            },
          };
        }

        if (freshnessReview.outcome === 'confirmed_unavailable') {
          if (submission.status === 'under_review') {
            if (
              requestedDecision
              && !['denied', 'pending_second_approval'].includes(requestedDecision)
            ) {
              return {
                ok: false as const,
                status: 400,
                body: {
                  error: 'Confirmed-unavailable findings require a second independent approval',
                  expectedDecision: 'pending_second_approval',
                },
              };
            }
            if (hasStoredDestructiveReview) {
              return {
                ok: false as const,
                status: 409,
                body: { error: 'A first destructive freshness review is already recorded' },
              };
            }
            stageDestructiveFreshnessReview = true;
            decision = 'pending_second_approval';
          } else {
            if (!storedDestructiveReview) {
              return {
                ok: false as const,
                status: 409,
                body: { error: 'A valid first destructive freshness review is required' },
              };
            }
            if (storedDestructiveReview.reviewerUserId === authCtx.userId) {
              return {
                ok: false as const,
                status: 409,
                body: { error: 'The second reviewer must be different from the first reviewer' },
              };
            }
            if (requestedDecision && requestedDecision !== 'denied') {
              return {
                ok: false as const,
                status: 400,
                body: {
                  error: 'Freshness review outcome does not match the requested decision',
                  expectedDecision: 'denied',
                },
              };
            }
            completeDestructiveFreshnessReview = true;
            decision = 'denied';
          }
          destructiveReviewRecord = {
            reviewerUserId: authCtx.userId,
            recordedAt: new Date().toISOString(),
            review: freshnessReview,
          };
        } else {
          if (storedDestructiveReview) {
            return {
              ok: false as const,
              status: 409,
              body: {
                error: 'The second reviewer must independently confirm unavailability before removal',
              },
            };
          }
          if (requestedDecision && requestedDecision !== mappedDecision) {
            return {
              ok: false as const,
              status: 400,
              body: {
                error: 'Freshness review outcome does not match the requested decision',
                expectedDecision: mappedDecision,
              },
            };
          }
          decision = mappedDecision;
        }

        if (
          packetState.packet.signal === 'explicit_expiry'
          && freshnessReview.outcome === 'corrected'
        ) {
          if (!submission.service_id) {
            return {
              ok: false as const,
              status: 409,
              body: { error: 'Freshness review has no linked service' },
            };
          }
          const correctionError = await validateExplicitExpiryCorrections(
            client,
            submission.service_id,
            freshnessReview.scheduleCorrections ?? [],
          );
          if (correctionError) {
            return { ok: false as const, status: 409, body: { error: correctionError } };
          }
        }
      } else {
        if (freshnessReview) {
          return {
            ok: false as const,
            status: 400,
            body: { error: 'Freshness review evidence is only accepted for scanner-created work' },
          };
        }
        if (!decision) {
          return {
            ok: false as const,
            status: 400,
            body: { error: 'Validation failed', details: [{ message: 'decision is required' }] },
          };
        }
      }

      if (
        decision === 'approved'
        && packetState.kind !== 'valid'
        && submission.submission_type === 'service_verification'
        && submission.service_id
      ) {
        await assertAuthoritativeEntitiesMutable(client, {
          serviceIds: [submission.service_id],
        });
      }

      const result = await advanceInTransaction(client, {
        submissionId: id,
        toStatus: decision as SubmissionStatus,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: freshnessReview?.reviewerSummary ?? notes ?? `Decision: ${decision}`,
        metadata: packetState.kind === 'valid' && freshnessReview
          ? stageDestructiveFreshnessReview
            ? {
                resourceFreshnessFirstReview: destructiveReviewRecord,
                resourceFreshnessFindingId: packetState.packet.findingId,
              }
            : {
                resourceFreshnessReview: freshnessReview,
                resourceFreshnessSecondReview: completeDestructiveFreshnessReview
                  ? destructiveReviewRecord
                  : undefined,
                resourceFreshnessFindingId: packetState.packet.findingId,
              }
          : undefined,
      });
      if (!result.success) {
        return {
          ok: false as const,
          status: 409,
          body: { error: result.error ?? 'Cannot apply this decision' },
        };
      }

      const persistedDestructiveReviewRecord = destructiveReviewRecord
        ? { ...destructiveReviewRecord, transitionId: result.transitionId }
        : null;

      if (freshnessReview && stageDestructiveFreshnessReview) {
        const persisted = await client.query<{ id: string }>(
          `UPDATE submissions
           SET reviewer_notes = $1,
               payload = jsonb_set(
                 coalesce(payload, '{}'::jsonb),
                 '{resourceFreshnessFirstReview}',
                 $2::jsonb,
                 true
               ),
               updated_at = NOW()
           WHERE id = $3
             AND NOT (coalesce(payload, '{}'::jsonb) ? 'resourceFreshnessFirstReview')
           RETURNING id`,
          [
            freshnessReview.reviewerSummary,
            JSON.stringify(persistedDestructiveReviewRecord),
            id,
          ],
        );
        if (!persisted.rows[0]) {
          throw new FreshnessReconciliationConflict(
            'The first destructive freshness review could not be recorded safely',
          );
        }
      } else if (freshnessReview && completeDestructiveFreshnessReview) {
        await client.query(
          `UPDATE submissions
           SET reviewer_notes = $1,
               payload = jsonb_set(
                 jsonb_set(
                   coalesce(payload, '{}'::jsonb),
                   '{resourceFreshnessReview}',
                   $2::jsonb,
                   true
                 ),
                 '{resourceFreshnessSecondReview}',
                 $3::jsonb,
                 true
               ),
               updated_at = NOW()
           WHERE id = $4`,
          [
            freshnessReview.reviewerSummary,
            JSON.stringify(freshnessReview),
            JSON.stringify(persistedDestructiveReviewRecord),
            id,
          ],
        );
      } else if (freshnessReview) {
        await client.query(
          `UPDATE submissions
           SET reviewer_notes = $1,
               payload = jsonb_set(
                 coalesce(payload, '{}'::jsonb),
                 '{resourceFreshnessReview}',
                 $2::jsonb,
                 true
               ),
               updated_at = NOW()
           WHERE id = $3`,
          [freshnessReview.reviewerSummary, JSON.stringify(freshnessReview), id],
        );
      } else if (notes) {
        await client.query(
          `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
          [notes, id],
        );
      }

      let approvedMessage = 'Record approved. Confidence score updated.';
      if (decision === 'approved' && packetState.kind !== 'valid') {
        const applied = await applyApprovedServiceVerification(
          client,
          id,
          authCtx.userId,
        );
        if (!applied.shouldUpdateConfidence) {
          approvedMessage = 'Record approved. Live listing updated.';
        }
        const fallbackService = applied.serviceId
          ? null
          : await client.query<{ service_id: string }>(
              `SELECT service_id FROM submissions WHERE id = $1 AND service_id IS NOT NULL`,
              [id],
            );
        const serviceId = applied.serviceId ?? fallbackService?.rows[0]?.service_id;

        if (serviceId && applied.shouldUpdateConfidence) {
          await client.query(
            `INSERT INTO confidence_scores (service_id, score, verification_confidence, eligibility_match, constraint_fit)
             VALUES ($1, 80, 80, 50, 50)
             ON CONFLICT (service_id)
             DO UPDATE SET verification_confidence = 80,
                           score = GREATEST(confidence_scores.score, 80),
                           computed_at = now()`,
            [serviceId],
          );
        }

        if (serviceId && applied.verificationApplied) {
          const verificationWindow = buildPublicationLifecycleWindow(80);
          await appendLifecycleEvent(client, {
            entityType: 'service',
            entityId: serviceId,
            eventType: 'verified',
            fromStatus: 'active',
            toStatus: 'active',
            actorType: 'human',
            actorId: authCtx.userId,
            metadata: {
              submissionId: id,
              approvalTransitionId: result.transitionId,
              verificationApplied: true,
              verifiedAt: verificationWindow.lastVerifiedAt,
              reverifyAt: verificationWindow.reverifyAt,
            },
          });
        }
      } else if (decision === 'approved') {
        // Scanner-created work is not a generic service-verification
        // projection. In particular, confirmed_current/corrected must never
        // reactivate an inactive or defunct service from stale payload data.
        // The typed freshness reconciler below owns schedule corrections and
        // clears only the exact scanner-owned integrity hold.
        approvedMessage = freshnessReview?.outcome === 'corrected'
          ? 'Freshness correction approved. Scanner hold reconciled.'
          : 'Freshness review approved. Scanner hold reconciled.';
      }

      const lifecycleReconciliation = freshnessReview && !stageDestructiveFreshnessReview
        ? await reconcileResourceFreshnessReview(client, id)
        : null;
      if (
        freshnessReview
        && !stageDestructiveFreshnessReview
        && packetState.kind === 'valid'
        && lifecycleReconciliation
        && !isExpectedFreshnessReconciliation(
          packetState.packet,
          freshnessReview.outcome,
          lifecycleReconciliation,
        )
      ) {
        throw new FreshnessReconciliationConflict(
          'Freshness review could not be safely finalized; no changes were applied',
        );
      }

      return {
        ok: true as const,
        decision: decision!,
        result,
        approvedMessage,
        lifecycleReconciliation,
      };
    });

    if (!atomicResult.ok) {
      return NextResponse.json(atomicResult.body, { status: atomicResult.status });
    }

    await sendTerminalStatusEmail(id, atomicResult.result.toStatus);

    const messages: Record<string, string> = {
      approved: atomicResult.approvedMessage,
      denied: 'Record denied. Change request notes saved for the host.',
      escalated: 'Record escalated for ORAN admin review.',
      returned: 'Record returned to submitter for revision.',
      pending_second_approval: 'Record sent for second approval (two-person rule).',
    };

    return NextResponse.json({
      success: true,
      id,
      fromStatus: atomicResult.result.fromStatus,
      toStatus: atomicResult.result.toStatus,
      transitionId: atomicResult.result.transitionId,
      message: messages[atomicResult.decision] ?? `Decision: ${atomicResult.decision}`,
      lifecycleReconciliation: atomicResult.lifecycleReconciliation,
    });
  } catch (error) {
    if (error instanceof LiveProjectionConflict) {
      return NextResponse.json({ error: error.clientMessage }, { status: 409 });
    }
    if (error instanceof FreshnessReconciliationConflict) {
      return NextResponse.json({ error: error.clientMessage }, { status: 409 });
    }
    if (error instanceof ProtectedAuthoritativeMutationConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await captureException(error, { feature: 'api_community_verify_decision' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
