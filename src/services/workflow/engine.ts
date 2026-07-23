/**
 * Workflow Engine — Universal Submission Pipeline
 *
 * Manages state transitions for submissions, enforces gates,
 * records transitions, handles locks, and applies SLA deadlines.
 *
 * All state changes go through advance() which:
 *  1. Validates the transition is allowed
 *  2. Checks all applicable gates (two-person, SLA, etc.)
 *  3. Acquires/releases lock if needed
 *  4. Updates submission status
 *  5. Records the transition + audit trail
 *  6. Fires notification events
 */

import { executeQuery, withTransaction } from '@/services/db/postgres';
import { sendEmail, isEmailConfigured } from '@/services/email/resendEmail';
import {
  SUBMISSION_TRANSITIONS,
  TWO_PERSON_REQUIRED_TYPES,
  FEATURE_FLAGS,
} from '@/domain/constants';
import type {
  SubmissionStatus,
  SubmissionType,
  GateCheckResult,
} from '@/domain/types';
import type { PoolClient } from 'pg';

// ============================================================
// TYPES
// ============================================================

/**
 * Granular gate skip options. Transition validity is ALWAYS enforced.
 * Only system actors should use these — API routes must never pass them.
 */
export interface SkipGateOptions {
  twoPersonApproval?: boolean;
  lockCheck?: boolean;
}

export interface AdvanceRequest {
  submissionId: string;
  toStatus: SubmissionStatus;
  actorUserId: string;
  actorRole: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  /**
   * @deprecated Use skipGateOptions instead. If boolean `true` is passed,
   * it is treated as { twoPersonApproval: true, lockCheck: true }.
   * Transition validity is ALWAYS enforced regardless of this flag.
   */
  skipGates?: boolean | SkipGateOptions;
}

export interface AdvanceResult {
  success: boolean;
  submissionId: string;
  fromStatus: SubmissionStatus;
  toStatus: SubmissionStatus;
  transitionId: string;
  gateResults: GateCheckResult[];
  error?: string;
}

interface SubmissionRow {
  id: string;
  submission_type: string;
  status: string;
  is_locked: boolean;
  locked_by_user_id: string | null;
  assigned_to_user_id: string | null;
  service_id: string | null;
  submitted_by_user_id: string;
  target_type: string;
  target_id: string | null;
}

interface SlaRow {
  review_hours: number;
  escalation_hours: number;
}

interface FlagRow {
  enabled: boolean;
}

// ============================================================
// GATE CHECKS
// ============================================================

/**
 * Check if a transition requires two-person approval and whether it has been satisfied.
 */
async function checkTwoPersonGate(
  client: PoolClient,
  submission: SubmissionRow,
  toStatus: SubmissionStatus,
  actorUserId: string,
): Promise<GateCheckResult> {
  const gate = 'two_person_approval';

  // Only applies to specific types moving to approved
  if (toStatus !== 'approved') {
    return { gate, passed: true, message: 'Not an approval transition' };
  }

  const isRequired = TWO_PERSON_REQUIRED_TYPES.includes(
    submission.submission_type as SubmissionType,
  );

  if (!isRequired) {
    return { gate, passed: true, message: 'Type does not require two-person approval' };
  }

  // Check feature flag. A MISSING row fails closed (gate enforced): an
  // unseeded flag table must never mean a single admin can approve
  // high-risk types. Disabling requires an explicit enabled=false row
  // (seeded by 0035 — flipping it on in production is a founder decision).
  const flagRows = await client.query<FlagRow>(
    `SELECT enabled FROM feature_flags WHERE name = $1`,
    [FEATURE_FLAGS.TWO_PERSON_APPROVAL],
  );
  const flagEnabled = flagRows.rows[0]?.enabled ?? true;
  if (!flagEnabled) {
    return { gate, passed: true, message: 'Two-person approval feature disabled' };
  }

  // The person approving must be different from the person who submitted
  if (actorUserId === submission.submitted_by_user_id) {
    return {
      gate,
      passed: false,
      message: 'Submitter cannot approve their own submission (two-person rule)',
    };
  }

  // Check if there was already a first reviewer — the second approver must be different
  const priorReviewers = await client.query<{ actor_user_id: string }>(
    `SELECT DISTINCT actor_user_id FROM submission_transitions
     WHERE submission_id = $1
       AND to_status IN ('under_review', 'pending_second_approval')
     ORDER BY actor_user_id`,
    [submission.id],
  );

  const reviewerIds = priorReviewers.rows.map((r) => r.actor_user_id);

  // If there were prior reviewers, the final approver must be different from all of them
  if (reviewerIds.length > 0 && reviewerIds.includes(actorUserId)) {
    return {
      gate,
      passed: false,
      message: 'Final approver must be different from prior reviewers (two-person rule)',
    };
  }

  return { gate, passed: true, message: 'Two-person approval check passed' };
}

/**
 * Check if the submission lock is compatible with this actor.
 */
function checkLockGate(
  submission: SubmissionRow,
  actorUserId: string,
): GateCheckResult {
  const gate = 'lock_check';

  if (!submission.is_locked) {
    return { gate, passed: true, message: 'Submission not locked' };
  }

  if (submission.locked_by_user_id === actorUserId) {
    return { gate, passed: true, message: 'Actor holds the lock' };
  }

  return {
    gate,
    passed: false,
    message: `Submission locked by another user (${submission.locked_by_user_id})`,
  };
}

/**
 * Validate the transition is permitted by the workflow graph.
 */
function checkTransitionGate(
  fromStatus: SubmissionStatus,
  toStatus: SubmissionStatus,
): GateCheckResult {
  const gate = 'transition_valid';
  const allowed = SUBMISSION_TRANSITIONS[fromStatus];

  if (!allowed || !allowed.includes(toStatus)) {
    return {
      gate,
      passed: false,
      message: `Transition ${fromStatus} → ${toStatus} is not permitted`,
    };
  }

  return { gate, passed: true };
}

/**
 * Automated actors may collect signals and route work, but they may never
 * issue a human approval. This gate is deliberately not skippable.
 */
function checkHumanApprovalGate(
  toStatus: SubmissionStatus,
  actorRole: string,
): GateCheckResult {
  const gate = 'human_approval_required';

  if (toStatus !== 'approved') {
    return { gate, passed: true, message: 'Not an approval transition' };
  }

  if (actorRole.trim().toLowerCase() === 'system') {
    return {
      gate,
      passed: false,
      message: 'System actors cannot approve submissions; independent human review is required',
    };
  }

  return { gate, passed: true, message: 'Approval actor is human' };
}

/**
 * Organization ownership decisions can grant host-administrator access and
 * therefore require the platform-wide ORAN administrator role. This invariant
 * is deliberately not skippable, including for bulk or system-style callers.
 */
function checkOrganizationClaimDecisionRole(
  submission: SubmissionRow,
  toStatus: SubmissionStatus,
  actorRole: string,
): GateCheckResult {
  const gate = 'organization_claim_decision_role';
  const isDecision = toStatus === 'approved' || toStatus === 'denied';

  if (submission.submission_type !== 'org_claim' || !isDecision) {
    return { gate, passed: true, message: 'Not an organization claim decision' };
  }

  if (actorRole.trim().toLowerCase() === 'oran_admin') {
    return { gate, passed: true, message: 'Organization claim decision actor is an ORAN administrator' };
  }

  return {
    gate,
    passed: false,
    message: 'Only ORAN administrators can approve or deny organization claims',
  };
}

// ============================================================
// CORE ENGINE
// ============================================================

/**
 * Advance a submission from its current status to a new status.
 * This is the single entry point for all workflow state changes.
 */
export async function advance(req: AdvanceRequest): Promise<AdvanceResult> {
  const result = await withTransaction((client) => advanceInTransaction(client, req));
  if (result.success) {
    await sendTerminalStatusEmail(result.submissionId, result.toStatus);
  }
  return result;
}

/**
 * Advance a submission using an existing database transaction. Bulk routes
 * compose several advances into one all-or-nothing transaction through this
 * entry point, so a single failed transition rolls back every sibling change.
 */
export async function advanceInTransaction(
  client: PoolClient,
  req: AdvanceRequest,
): Promise<AdvanceResult> {
    // 1. Lock and fetch the submission row
    const rows = await client.query<SubmissionRow>(
      `SELECT id, submission_type, status, is_locked, locked_by_user_id,
              assigned_to_user_id, service_id, submitted_by_user_id,
              target_type, target_id
       FROM submissions
       WHERE id = $1
       FOR UPDATE`,
      [req.submissionId],
    );

    const submission = rows.rows[0];
    if (!submission) {
      return {
        success: false,
        submissionId: req.submissionId,
        fromStatus: 'draft' as SubmissionStatus,
        toStatus: req.toStatus,
        transitionId: '',
        gateResults: [],
        error: 'Submission not found',
      };
    }

    const fromStatus = submission.status as SubmissionStatus;

    // 2. Run gate checks
    const gateResults: GateCheckResult[] = [];

    // Normalize skipGates to granular options
    const skipOpts: SkipGateOptions =
      typeof req.skipGates === 'object' && req.skipGates !== null
        ? req.skipGates
        : req.skipGates === true
          ? { twoPersonApproval: true, lockCheck: true }
          : {};

    // ALWAYS check transition graph validity — cannot be skipped
    gateResults.push(checkTransitionGate(fromStatus, req.toStatus));

    // System/automated approval is never permitted and cannot be skipped.
    gateResults.push(checkHumanApprovalGate(req.toStatus, req.actorRole));

    // Organization-claim decisions grant or deny ownership and cannot be
    // delegated to community reviewers or bypassed with skipGates.
    gateResults.push(checkOrganizationClaimDecisionRole(submission, req.toStatus, req.actorRole));

    // Check lock (skippable)
    if (!skipOpts.lockCheck) {
      gateResults.push(checkLockGate(submission, req.actorUserId));
    }

    // Check two-person approval (skippable)
    if (!skipOpts.twoPersonApproval) {
      gateResults.push(
        await checkTwoPersonGate(client, submission, req.toStatus, req.actorUserId),
      );
    }

    const allPassed = gateResults.every((g) => g.passed);

    if (!allPassed) {
      // Record the failed transition attempt
      const failedTransition = await client.query<{ id: string }>(
        `INSERT INTO submission_transitions
           (submission_id, from_status, to_status, actor_user_id, actor_role,
            reason, gates_checked, gates_passed, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
         RETURNING id`,
        [
          req.submissionId,
          fromStatus,
          req.toStatus,
          req.actorUserId,
          req.actorRole,
          req.reason ?? null,
          JSON.stringify(gateResults),
          JSON.stringify(req.metadata ?? {}),
        ],
      );

      return {
        success: false,
        submissionId: req.submissionId,
        fromStatus,
        toStatus: req.toStatus,
        transitionId: failedTransition.rows[0]?.id ?? '',
        gateResults,
        error: gateResults
          .filter((g) => !g.passed)
          .map((g) => g.message)
          .join('; '),
      };
    }

    // 3. Update submission status
    const now = new Date().toISOString();
    const statusFields = buildStatusTimestamps(req.toStatus, now);

    await client.query(
      `UPDATE submissions
       SET status = $1,
           ${statusFields.setClause}
           updated_at = $${statusFields.nextParam}
       WHERE id = $${statusFields.nextParam + 1}`,
      [req.toStatus, ...statusFields.params, now, req.submissionId],
    );

    // 4. Release lock if transitioning to a terminal state
    if (isTerminalStatus(req.toStatus)) {
      await client.query(
        `UPDATE submissions
         SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL
         WHERE id = $1`,
        [req.submissionId],
      );
    }

    // 5. Record the successful transition
    const transition = await client.query<{ id: string }>(
      `INSERT INTO submission_transitions
         (submission_id, from_status, to_status, actor_user_id, actor_role,
          reason, gates_checked, gates_passed, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       RETURNING id`,
      [
        req.submissionId,
        fromStatus,
        req.toStatus,
        req.actorUserId,
        req.actorRole,
        req.reason ?? null,
        JSON.stringify(gateResults),
        JSON.stringify(req.metadata ?? {}),
      ],
    );

    // 6. Fire notification for status change
    await fireStatusChangeNotification(
      client,
      req.submissionId,
      submission,
      fromStatus,
      req.toStatus,
      req.actorUserId,
    );

    return {
      success: true,
      submissionId: req.submissionId,
      fromStatus,
      toStatus: req.toStatus,
      transitionId: transition.rows[0]?.id ?? '',
      gateResults,
    };
}

// ============================================================
// LOCK MANAGEMENT
// ============================================================

/**
 * Acquire an exclusive lock on a submission for the given user.
 * Returns true if lock was acquired.
 */
export async function acquireLock(
  submissionId: string,
  userId: string,
): Promise<boolean> {
  const result = await executeQuery<{ id: string }>(
    `UPDATE submissions
     SET is_locked = true, locked_at = NOW(), locked_by_user_id = $1, updated_at = NOW()
     WHERE id = $2 AND (is_locked = false OR locked_by_user_id = $1)
     RETURNING id`,
    [userId, submissionId],
  );
  return result.length > 0;
}

/**
 * Release the lock on a submission. Only the lock holder or an oran_admin can release.
 */
export async function releaseLock(
  submissionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const whereClause = isAdmin
    ? `id = $1`
    : `id = $1 AND locked_by_user_id = $2`;

  const params = isAdmin ? [submissionId] : [submissionId, userId];

  const result = await executeQuery<{ id: string }>(
    `UPDATE submissions
     SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL, updated_at = NOW()
     WHERE ${whereClause}
     RETURNING id`,
    params,
  );
  return result.length > 0;
}

/** Default lock timeout in minutes. */
const LOCK_TIMEOUT_MINUTES = 30;

/**
 * Release all locks older than the given timeout.
 * Returns the number of locks expired.
 */
export async function expireStaleLocks(
  timeoutMinutes: number = LOCK_TIMEOUT_MINUTES,
): Promise<number> {
  const result = await executeQuery<{ id: string }>(
    `UPDATE submissions
     SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL, updated_at = NOW()
     WHERE is_locked = true
       AND locked_at < NOW() - INTERVAL '1 minute' * $1
     RETURNING id`,
    [timeoutMinutes],
  );
  return result.length;
}

// ============================================================
// ASSIGNMENT
// ============================================================

/**
 * Assign a submission to a reviewer.
 */
export async function assignSubmission(
  submissionId: string,
  assigneeUserId: string,
  actorUserId: string,
  actorRole: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    // LB8: Enforce admin capacity limits before assigning
    const capacityRows = await client.query<{ pending_count: string; max_capacity: string }>(
      `SELECT
         COALESCE(p.pending_count, 0)::text AS pending_count,
         COALESCE(p.max_capacity, 50)::text AS max_capacity
       FROM admin_review_profiles p
       WHERE p.user_id = $1`,
      [assigneeUserId],
    );
    if (capacityRows.rows.length > 0) {
      const pending = parseInt(capacityRows.rows[0].pending_count, 10);
      const maxCap = parseInt(capacityRows.rows[0].max_capacity, 10);
      if (pending >= maxCap) {
        throw new Error(`Assignee has reached capacity (${pending}/${maxCap})`);
      }
    }

    const result = await client.query<{ id: string }>(
      `UPDATE submissions
       SET assigned_to_user_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [assigneeUserId, submissionId],
    );

    if (result.rows.length === 0) return false;

    // Record in audit log
    await client.query(
      `INSERT INTO scope_audit_log
         (actor_user_id, actor_role, action, target_type, target_id, after_state)
       VALUES ($1, $2, 'submission_assigned', 'submission', $3, $4)`,
      [
        actorUserId,
        actorRole,
        submissionId,
        JSON.stringify({ assigned_to: assigneeUserId }),
      ],
    );

    // Notify the assignee
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_assigned', $2, $3, 'submission', $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        assigneeUserId,
        'Submission assigned to you',
        `You have been assigned submission ${submissionId}`,
        submissionId,
        `/verify?id=${submissionId}`,
        `assign_${submissionId}_${assigneeUserId}`,
      ],
    );

    return true;
  });
}

// ============================================================
// SLA MANAGEMENT
// ============================================================

/**
 * Apply SLA deadline to a submission based on its type and jurisdiction.
 */
export async function applySla(
  submissionId: string,
  submissionType: SubmissionType,
  jurisdictionState?: string | null,
): Promise<void> {
  const slaRows = await executeQuery<SlaRow>(
    `SELECT review_hours, escalation_hours
     FROM submission_slas
     WHERE submission_type = $1
       AND (jurisdiction_state = $2 OR jurisdiction_state IS NULL)
       AND is_active = true
     ORDER BY jurisdiction_state DESC NULLS LAST
     LIMIT 1`,
    [submissionType, jurisdictionState ?? null],
  );

  if (slaRows.length === 0) return;

  const sla = slaRows[0];
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + sla.review_hours);

  await executeQuery(
    `UPDATE submissions
     SET sla_deadline = $1, updated_at = NOW()
     WHERE id = $2`,
    [deadline.toISOString(), submissionId],
  );
}

/**
 * Check for SLA breaches and escalate submissions past their deadline.
 * Intended to be called by a scheduled job.
 */
export async function checkSlaBreaches(): Promise<number> {
  const breached = await executeQuery<{ id: string; submission_type: string }>(
    `UPDATE submissions
     SET sla_breached = true, updated_at = NOW()
     WHERE sla_deadline < NOW()
       AND sla_breached = false
       AND status IN ('needs_review', 'under_review', 'pending_second_approval')
     RETURNING id, submission_type`,
    [],
  );

  // Fire notification for each breached submission
  for (const row of breached) {
    await executeQuery(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       SELECT COALESCE(assigned_to_user_id, submitted_by_user_id),
              'submission_sla_breach',
              'SLA Breach: Submission overdue',
              'Submission ' || $1 || ' has breached its SLA deadline',
              'submission',
              $1,
              '/verify?id=' || $1,
              'sla_breach_' || $1 || '_' || NOW()::text
       FROM submissions WHERE id = $1
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [row.id],
    );
  }

  return breached.length;
}

// ============================================================
// BULK OPERATIONS
// ============================================================

/** Max concurrent advance() calls within a single bulkAdvance batch */
const BULK_CONCURRENCY = 5;

/**
 * Bulk advance submissions with bounded concurrency.
 * Processes submissions in parallel batches of BULK_CONCURRENCY to avoid
 * overwhelming the connection pool while being faster than sequential.
 */
export async function bulkAdvance(
  submissionIds: string[],
  toStatus: SubmissionStatus,
  actorUserId: string,
  actorRole: string,
  reason?: string,
): Promise<AdvanceResult[]> {
  const results: AdvanceResult[] = [];

  for (let i = 0; i < submissionIds.length; i += BULK_CONCURRENCY) {
    const batch = submissionIds.slice(i, i + BULK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((id) =>
        advance({
          submissionId: id,
          toStatus,
          actorUserId,
          actorRole,
          reason,
        }),
      ),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const settled = batchResults[j];
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        results.push({
          success: false,
          submissionId: batch[j],
          fromStatus: 'draft' as SubmissionStatus,
          toStatus,
          transitionId: '',
          gateResults: [],
          error: settled.reason instanceof Error ? settled.reason.message : 'Unknown error',
        });
      }
    }
  }

  return results;
}

// ============================================================
// AUTO-CHECK GATE
// ============================================================

/**
 * Run automated confidence checks on a submission.
 * Uses confidence_scores for service_verification types as a review signal.
 * Confidence never authorizes publication; every result routes to needs_review.
 */
export async function runAutoCheck(
  submissionId: string,
  actorUserId: string,
): Promise<AdvanceResult> {
  // Check feature flag
  const flagRows = await executeQuery<FlagRow>(
    `SELECT enabled FROM feature_flags WHERE name = $1`,
    [FEATURE_FLAGS.AUTO_CHECK_GATE],
  );
  const enabled = flagRows[0]?.enabled ?? false;

  if (!enabled) {
    // Skip auto-check, go straight to needs_review
    return advance({
      submissionId,
      toStatus: 'needs_review',
      actorUserId,
      actorRole: 'system',
      reason: 'Auto-check gate disabled, routing to manual review',
      skipGates: true,
    });
  }

  // Fetch submission + confidence score
  const rows = await executeQuery<{
    service_id: string | null;
    score: number | null;
  }>(
    `SELECT s.service_id, cs.score
     FROM submissions s
     LEFT JOIN confidence_scores cs ON cs.service_id = s.service_id
     WHERE s.id = $1`,
    [submissionId],
  );

  const row = rows[0];
  const confidence = row?.score;

  return advance({
    submissionId,
    toStatus: 'needs_review',
    actorUserId,
    actorRole: 'system',
    reason: confidence !== null && confidence !== undefined
      ? `Confidence score ${confidence} recorded; independent human review required`
      : 'No confidence score available, routing to manual review',
    skipGates: true,
    metadata: {
      auto_score: confidence ?? null,
      confidence_only: true,
      requires_independent_review: true,
    },
  });
}

// ============================================================
// HELPERS
// ============================================================

function getSubmitterActionUrl(submissionType: string): string | null {
  switch (submissionType as SubmissionType) {
    case 'community_report':
      return '/report';
    case 'appeal':
      return '/appeal';
    case 'org_claim':
      return '/claim';
    case 'new_service':
      return '/services';
    default:
      return null;
  }
}

function isTerminalStatus(status: SubmissionStatus): boolean {
  return ['approved', 'denied', 'withdrawn', 'expired', 'archived'].includes(status);
}

function buildStatusTimestamps(
  toStatus: SubmissionStatus,
  now: string,
): { setClause: string; params: string[]; nextParam: number } {
  const params: string[] = [];
  const clauses: string[] = [];
  let idx = 2; // $1 is already used for status

  if (toStatus === 'submitted') {
    clauses.push(`submitted_at = $${idx}`);
    params.push(now);
    idx++;
  }

  if (toStatus === 'under_review') {
    clauses.push(`reviewed_at = $${idx}`);
    params.push(now);
    idx++;
  }

  if (isTerminalStatus(toStatus)) {
    clauses.push(`resolved_at = $${idx}`);
    params.push(now);
    idx++;
  }

  return {
    setClause: clauses.length > 0 ? clauses.join(', ') + ', ' : '',
    params,
    nextParam: idx,
  };
}

async function fireStatusChangeNotification(
  client: PoolClient,
  submissionId: string,
  submission: SubmissionRow,
  fromStatus: SubmissionStatus,
  toStatus: SubmissionStatus,
  actorUserId: string,
): Promise<void> {
  // Notify the submitter about status changes (unless actor is the submitter)
  if (submission.submitted_by_user_id !== actorUserId) {
    const submitterActionUrl = getSubmitterActionUrl(submission.submission_type);
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       VALUES ($1, 'submission_status_changed', $2, $3, 'submission', $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        submission.submitted_by_user_id,
        `Submission ${toStatus}`,
        `Your submission has been moved from ${fromStatus} to ${toStatus}`,
        submissionId,
        submitterActionUrl,
        `status_${submissionId}_${fromStatus}_${toStatus}`,
      ],
    );
  }

  // If it needs second approval, notify community_admin / oran_admin
  if (toStatus === 'pending_second_approval') {
    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       SELECT up.user_id,
              'two_person_approval_needed',
              'Second approval needed',
              'Submission ' || $1 || ' requires a second approver',
              'submission',
              $1,
              '/verify?id=' || $1,
              'two_person_' || $1 || '_' || up.user_id
       FROM user_profiles up
       WHERE up.role IN ('community_admin', 'oran_admin')
         AND up.user_id != $2
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [submissionId, actorUserId],
    );
  }

}

/**
 * For terminal statuses, email the contact_email from payload (if present).
 * This handles anonymous reporters who provided an email for follow-up.
 *
 * Runs OUTSIDE the workflow transaction, strictly after the decision has
 * committed. Database notification events stay transactional; this external
 * side effect is intentionally best-effort and never makes a committed
 * workflow decision appear to have failed.
 */
export async function sendTerminalStatusEmail(
  submissionId: string,
  toStatus: SubmissionStatus,
): Promise<void> {
  if (!isTerminalStatus(toStatus) || !isEmailConfigured()) return;

  try {
    const payloadRows = await executeQuery<{
      payload: unknown;
      title: string | null;
    }>(
      `SELECT payload, title FROM submissions WHERE id = $1`,
      [submissionId],
    );
    const rawPayload = payloadRows[0]?.payload;
    const payload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload) as unknown
      : rawPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const contactEmail = (payload as Record<string, unknown>).contact_email;
    if (typeof contactEmail !== 'string' || contactEmail.trim().length === 0) return;

    const subjectTitle = payloadRows[0]?.title ?? 'Your submission';
    await sendEmail({
      to: contactEmail,
      subject: `Update: ${subjectTitle} — ${toStatus}`,
      text: `Your submission has been updated to "${toStatus}". Thank you for your report.`,
    }).catch(() => { /* best-effort */ });
  } catch {
    // Payload lookup, parsing, and delivery are best-effort after commit.
  }
}
