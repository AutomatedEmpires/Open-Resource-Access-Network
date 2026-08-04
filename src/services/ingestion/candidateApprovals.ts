import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

import { executeQuery, withTransaction } from '@/services/db/postgres';

export const REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS = 2;

/**
 * Dark-landing capability probe: migration 0077 adds the nullable evidence
 * column, while 0078 activates its completion-binding trigger and guarded
 * workflow. Approval routes stay 503 until BOTH objects exist. Fails closed on
 * any probe error. Deliberately un-memoized:
 * a long-lived instance must observe the migration (or a rollback) promptly.
 */
export async function isCandidateApprovalEvidenceProvisioned(): Promise<boolean> {
  try {
    const columnRows = await executeQuery<{ exists: boolean }>(
      `SELECT true AS exists
       FROM pg_catalog.pg_attribute
       WHERE attrelid = pg_catalog.to_regclass('public.candidate_admin_assignments')
         AND attname = 'decision_reviewer_profile_id'
         AND NOT attisdropped`,
      [],
    );
    if (!columnRows[0]?.exists) return false;

    const triggerRows = await executeQuery<{ exists: boolean }>(
      `SELECT true AS exists
       WHERE EXISTS (
         SELECT 1
         FROM pg_catalog.pg_trigger
         WHERE tgrelid = pg_catalog.to_regclass('public.candidate_admin_assignments')
           AND tgname = 'trg_protect_completed_candidate_approval'
           AND NOT tgisinternal
           AND tgenabled IN ('O', 'A')
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.pg_trigger
         WHERE tgrelid = pg_catalog.to_regclass('public.extracted_candidates')
           AND tgname = 'trg_enforce_candidate_revision_lineage'
           AND NOT tgisinternal
           AND tgenabled IN ('O', 'A')
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint
         WHERE conrelid = pg_catalog.to_regclass('public.candidate_admin_assignments')
           AND conname = 'candidate_admin_assignments_decision_reviewer_check'
           AND convalidated IS TRUE
       )
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint
         WHERE conrelid = pg_catalog.to_regclass('public.extracted_candidates')
           AND conname = 'extracted_candidates_revision_number_check'
           AND convalidated IS TRUE
       )
       AND (
         SELECT count(*)
         FROM pg_catalog.pg_attribute
         WHERE attrelid = pg_catalog.to_regclass('public.extracted_candidates')
           AND attname IN ('lineage_root_candidate_id', 'revision_number')
           AND attnotnull IS TRUE
           AND NOT attisdropped
       ) = 2
       AND EXISTS (
         SELECT 1
         FROM pg_catalog.pg_index lineage_index
         WHERE lineage_index.indexrelid = pg_catalog.to_regclass(
           'public.idx_extracted_candidates_lineage_revision'
         )
           AND lineage_index.indrelid = pg_catalog.to_regclass('public.extracted_candidates')
           AND lineage_index.indisunique IS TRUE
           AND lineage_index.indisvalid IS TRUE
           AND lineage_index.indisready IS TRUE
       )`,
      [],
    );
    return Boolean(triggerRows[0]?.exists);
  } catch {
    return false;
  }
}

/**
 * Publication gate over immutable completed-assignment evidence.
 *
 * Once 0078 activates the evidence workflow, publication requires at least
 * REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS distinct verifying reviewers and
 * zero rejecting reviewers — counted directly from completed assignments,
 * never trusted from review_status or candidate_readiness (both of which
 * legacy paths can set without two independent reviewers).
 *
 * Before activation, this compatibility helper avoids querying a column that
 * may not exist yet. It is not publication authority: the transactional live
 * publisher independently requires the 0078 trigger and fails closed while the
 * workflow is dark.
 */
export async function assertCandidatePublishApprovalEvidence(
  candidateId: string,
): Promise<void> {
  if (!(await isCandidateApprovalEvidenceProvisioned())) {
    return;
  }

  const rows = await executeQuery<{
    approval_count: number;
    rejection_count: number;
    escalation_count: number;
  }>(
    `SELECT count(DISTINCT CASE
                WHEN approval.outcome = 'verified' THEN approval.decision_reviewer_profile_id
              END)::integer AS approval_count,
            count(DISTINCT CASE
                WHEN approval.outcome = 'rejected' THEN approval.decision_reviewer_profile_id
              END)::integer AS rejection_count,
            count(DISTINCT CASE
                WHEN approval.outcome = 'escalated' THEN approval.decision_reviewer_profile_id
              END)::integer AS escalation_count
     FROM public.candidate_admin_assignments approval
     WHERE approval.candidate_id = $1
       AND approval.status = 'completed'`,
    [candidateId],
  );
  const approvalCount = rows[0]?.approval_count ?? 0;
  const rejectionCount = rows[0]?.rejection_count ?? 0;
  const escalationCount = rows[0]?.escalation_count ?? 0;
  if (
    approvalCount < REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS
    || rejectionCount > 0
    || escalationCount > 0
  ) {
    throw new CandidateApprovalConflict(
      `Publication requires ${REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS} independent`
      + ` approvals with no rejections or escalations (currently ${approvalCount} approval(s),`
      + ` ${rejectionCount} rejection(s), ${escalationCount} escalation(s)).`,
    );
  }
}

export class CandidateApprovalConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateApprovalConflict';
  }
}

interface CandidateRow {
  candidate_id: string;
  review_status: string;
  published_service_id: string | null;
}

interface ReviewerRow {
  id: string;
  user_id: string;
  is_active: boolean;
  is_accepting_new: boolean;
  in_review_count: number;
  max_in_review: number;
  account_status: string | null;
  role: string;
}

interface AssignmentRow {
  id: string;
  candidate_id: string;
  admin_profile_id: string;
  status: string;
  expires_at: string | null;
}

interface CandidateReadinessDecisionRow {
  has_required_fields: boolean;
  has_required_tags: boolean;
  tags_confirmed: boolean;
  meets_score_threshold: boolean;
  pending_tag_count: number;
  blockers: unknown;
}

const PEER_DECISION_READINESS_BLOCKERS = new Set([
  'candidate_rejected',
  'candidate_escalated',
  'candidate_review_disagreement',
]);

function hasNonApprovalReadinessBlocker(rawBlockers: unknown): boolean {
  if (!Array.isArray(rawBlockers)) return true;
  return rawBlockers.some((blocker) => (
    typeof blocker !== 'string'
    || (
      blocker !== 'missing_two_person_approval'
      && !PEER_DECISION_READINESS_BLOCKERS.has(blocker)
      && !/^Need \d+ admin approvals, have \d+$/i.test(blocker)
    )
  ));
}

async function lockCandidate(client: PoolClient, candidateId: string) {
  const result = await client.query<CandidateRow>(
    `SELECT candidate_id, review_status, published_service_id
     FROM public.extracted_candidates
     WHERE candidate_id = $1
     FOR UPDATE`,
    [candidateId],
  );
  const candidate = result.rows[0];
  if (!candidate) throw new CandidateApprovalConflict('Candidate not found.');
  if (candidate.published_service_id || ['published', 'archived', 'rejected'].includes(candidate.review_status)) {
    throw new CandidateApprovalConflict('Candidate is no longer open for approval.');
  }
  return candidate;
}

async function lockActiveReviewer(
  client: PoolClient,
  actorUserId: string,
) {
  const result = await client.query<ReviewerRow>(
    `SELECT reviewer.id,
            reviewer.user_id,
            reviewer.is_active,
            reviewer.is_accepting_new,
            reviewer.in_review_count,
            reviewer.max_in_review,
            account.account_status,
            account.role
     FROM public.admin_review_profiles reviewer
     JOIN public.user_profiles account ON account.user_id = reviewer.user_id
     WHERE reviewer.user_id = $1
     FOR UPDATE OF reviewer
     FOR SHARE OF account`,
    [actorUserId],
  );
  const reviewer = result.rows[0];
  if (
    !reviewer
    || !reviewer.is_active
    || (reviewer.account_status ?? 'active') !== 'active'
    || reviewer.role !== 'community_admin'
  ) {
    throw new CandidateApprovalConflict('Only an active assigned reviewer may review this candidate.');
  }
  return reviewer;
}

async function lockAssignment(
  client: PoolClient,
  candidateId: string,
  assignmentId: string,
  reviewerId: string,
) {
  const result = await client.query<AssignmentRow>(
    `SELECT id, candidate_id, admin_profile_id, status, expires_at
     FROM public.candidate_admin_assignments
     WHERE id = $1
       AND candidate_id = $2
       AND admin_profile_id = $3
     FOR UPDATE`,
    [assignmentId, candidateId, reviewerId],
  );
  const assignment = result.rows[0];
  if (!assignment) {
    throw new CandidateApprovalConflict('This candidate is not assigned to the current reviewer.');
  }
  return assignment;
}

export async function claimCandidateApproval(input: {
  candidateId: string;
  assignmentId: string;
  actorUserId: string;
}): Promise<{ status: 'claimed' }> {
  return withTransaction(async (client) => {
    const candidate = await lockCandidate(client, input.candidateId);
    if (candidate.review_status === 'verified') {
      throw new CandidateApprovalConflict('Candidate already has the required independent approvals.');
    }
    const reviewer = await lockActiveReviewer(client, input.actorUserId);
    const assignment = await lockAssignment(
      client,
      input.candidateId,
      input.assignmentId,
      reviewer.id,
    );
    if (assignment.status !== 'pending') {
      throw new CandidateApprovalConflict(`Assignment is ${assignment.status}, not pending.`);
    }
    if (assignment.expires_at && new Date(assignment.expires_at).getTime() <= Date.now()) {
      throw new CandidateApprovalConflict('Assignment has expired and must be rerouted.');
    }
    if (reviewer.in_review_count >= reviewer.max_in_review) {
      throw new CandidateApprovalConflict('Reviewer has reached active-review capacity.');
    }
    if (!reviewer.is_accepting_new) {
      throw new CandidateApprovalConflict('Reviewer is not accepting new assignments.');
    }

    const claimed = await client.query<{ id: string }>(
      `UPDATE public.candidate_admin_assignments
       SET status = 'claimed',
           claimed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING id`,
      [assignment.id],
    );
    if (!claimed.rows[0]) {
      throw new CandidateApprovalConflict('Assignment ownership changed; refresh and try again.');
    }

    const candidateClaim = await client.query<{ candidate_id: string }>(
      `UPDATE public.extracted_candidates
       SET review_status = 'in_review',
           assigned_to_role = $2,
           assigned_to_user_id = $3,
           assigned_at = NOW(),
           updated_at = NOW()
       WHERE candidate_id = $1
         AND review_status IN ('pending', 'escalated', 'in_review')
       RETURNING candidate_id`,
      [input.candidateId, reviewer.role, input.actorUserId],
    );
    if (!candidateClaim.rows[0]) {
      throw new CandidateApprovalConflict('Candidate status changed; refresh and try again.');
    }
    await client.query(
      `INSERT INTO public.ingestion_audit_events
         (candidate_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'approval.claimed', 'human', $2, $3::jsonb)`,
      [
        input.candidateId,
        input.actorUserId,
        JSON.stringify({ assignmentId: assignment.id, eventId: crypto.randomUUID() }),
      ],
    );
    return { status: 'claimed' };
  });
}

export async function decideCandidateApproval(input: {
  candidateId: string;
  assignmentId: string;
  actorUserId: string;
  decision: 'approved' | 'rejected' | 'escalated';
  notes?: string;
}): Promise<{
  status: string;
  approvalCount: number;
  rejectionCount: number;
  escalationCount: number;
}> {
  const normalizedNotes = input.notes?.trim();
  if (normalizedNotes && normalizedNotes.length > 4_000) {
    throw new CandidateApprovalConflict('Review notes exceed the allowed length.');
  }
  if (
    input.decision !== 'approved'
    && (!normalizedNotes || normalizedNotes.length < 20)
  ) {
    throw new CandidateApprovalConflict(
      'Rejection and escalation require a substantive review note.',
    );
  }

  return withTransaction(async (client) => {
    const candidate = await lockCandidate(client, input.candidateId);
    if (candidate.review_status === 'verified') {
      throw new CandidateApprovalConflict('Candidate already has the required independent approvals.');
    }
    const reviewer = await lockActiveReviewer(client, input.actorUserId);
    const assignment = await lockAssignment(
      client,
      input.candidateId,
      input.assignmentId,
      reviewer.id,
    );
    if (assignment.status !== 'claimed') {
      throw new CandidateApprovalConflict('Reviewer must claim the assignment before deciding it.');
    }
    if (assignment.expires_at && new Date(assignment.expires_at).getTime() <= Date.now()) {
      throw new CandidateApprovalConflict('Assignment has expired and must be rerouted.');
    }

    if (input.decision === 'approved') {
      // Recompute the full non-approval safety baseline while the candidate is
      // locked. Tag/LLM inputs cannot change after this first completion.
      await client.query(
        `SELECT public.evaluate_candidate_readiness($1) AS is_ready`,
        [input.candidateId],
      );
      const readiness = await client.query<CandidateReadinessDecisionRow>(
        `SELECT has_required_fields,
                has_required_tags,
                tags_confirmed,
                meets_score_threshold,
                pending_tag_count,
                blockers
         FROM public.candidate_readiness
         WHERE candidate_id = $1
         FOR UPDATE`,
        [input.candidateId],
      );
      const baseline = readiness.rows[0];
      if (
        !baseline
        || !baseline.has_required_fields
        || !baseline.has_required_tags
        || !baseline.tags_confirmed
        || !baseline.meets_score_threshold
        || baseline.pending_tag_count !== 0
        || hasNonApprovalReadinessBlocker(baseline.blockers)
      ) {
        throw new CandidateApprovalConflict(
          'Candidate evidence must be complete, confirmed, and safety-cleared before approval.',
        );
      }
    }

    const outcome = input.decision === 'approved' ? 'verified' : input.decision;
    const completed = await client.query<{ id: string }>(
      `UPDATE public.candidate_admin_assignments
       SET status = 'completed',
           outcome = $2,
           outcome_notes = $3,
           decision_reviewer_profile_id = $4,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND status = 'claimed'
         AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING id`,
      [assignment.id, outcome, normalizedNotes ?? null, reviewer.id],
    );
    if (!completed.rows[0]) {
      throw new CandidateApprovalConflict('Assignment decision was already taken.');
    }

    const decisions = await client.query<{
      approval_count: number;
      rejection_count: number;
      escalation_count: number;
    }>(
      `SELECT count(DISTINCT CASE
                  WHEN approval.outcome = 'verified' THEN approval.decision_reviewer_profile_id
                END)::integer AS approval_count,
              count(DISTINCT CASE
                  WHEN approval.outcome = 'rejected' THEN approval.decision_reviewer_profile_id
                END)::integer AS rejection_count,
              count(DISTINCT CASE
                  WHEN approval.outcome = 'escalated' THEN approval.decision_reviewer_profile_id
                END)::integer AS escalation_count
       FROM public.candidate_admin_assignments approval
       WHERE approval.candidate_id = $1
         AND approval.status = 'completed'`,
      [input.candidateId],
    );
    const approvalCount = decisions.rows[0]?.approval_count ?? 0;
    const rejectionCount = decisions.rows[0]?.rejection_count ?? 0;
    const escalationCount = decisions.rows[0]?.escalation_count ?? 0;
    const hasApprovalConsensus = (
      approvalCount >= REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS
      && rejectionCount === 0
      && escalationCount === 0
    );
    const hasRejectionConsensus = (
      rejectionCount >= REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS
      && approvalCount === 0
      && escalationCount === 0
    );
    const hasDecisionDisagreement = approvalCount > 0 && rejectionCount > 0;

    let nextStatus = 'in_review';
    if (
      input.decision === 'escalated'
      || escalationCount > 0
      || hasDecisionDisagreement
      || rejectionCount > 0
    ) {
      nextStatus = 'escalated';
    }
    if (hasApprovalConsensus) nextStatus = 'verified';
    if (hasRejectionConsensus) nextStatus = 'rejected';

    const readinessUpdate = await client.query<{ candidate_id: string }>(
      `UPDATE public.candidate_readiness readiness
       SET admin_approval_count = $2,
           has_admin_approval = $3,
           is_ready = CASE
             WHEN $4 <> 'verified' THEN false
             ELSE readiness.has_required_fields
               AND readiness.has_required_tags
               AND readiness.tags_confirmed
               AND readiness.meets_score_threshold
               AND readiness.pending_tag_count = 0
               AND $3
               AND NOT EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(readiness.blockers) blocker(value)
                 WHERE blocker.value <> 'missing_two_person_approval'
                   AND blocker.value NOT LIKE 'Need % admin approvals%'
               )
           END,
           blockers = (
             SELECT COALESCE(jsonb_agg(blocker.value), '[]'::jsonb)
             FROM jsonb_array_elements_text(readiness.blockers) blocker(value)
             WHERE blocker.value <> 'missing_two_person_approval'
               AND blocker.value NOT LIKE 'Need % admin approvals%'
               AND blocker.value NOT IN (
                 'candidate_rejected',
                 'candidate_escalated',
                 'candidate_review_disagreement'
               )
           ) || CASE
             WHEN $4 = 'rejected' THEN '["candidate_rejected"]'::jsonb
             WHEN $5 THEN '["candidate_review_disagreement"]'::jsonb
             WHEN $4 = 'escalated' THEN '["candidate_escalated"]'::jsonb
             WHEN NOT $3 THEN '["missing_two_person_approval"]'::jsonb
             ELSE '[]'::jsonb
           END,
           last_evaluated_at = NOW(),
           updated_at = NOW()
       WHERE readiness.candidate_id = $1
       RETURNING candidate_id`,
      [input.candidateId, approvalCount, hasApprovalConsensus, nextStatus, hasDecisionDisagreement],
    );
    if (!readinessUpdate.rows[0]) {
      throw new CandidateApprovalConflict('Candidate readiness evidence is missing.');
    }

    const candidateDecision = await client.query<{ candidate_id: string }>(
      `UPDATE public.extracted_candidates
       SET review_status = $2,
           assigned_to_user_id = NULL,
           assigned_at = NULL,
           updated_at = NOW()
       WHERE candidate_id = $1
         AND review_status IN ('pending', 'in_review', 'escalated')
       RETURNING candidate_id`,
      [input.candidateId, nextStatus],
    );
    if (!candidateDecision.rows[0]) {
      throw new CandidateApprovalConflict('Candidate status changed; the decision was rolled back.');
    }

    if (['verified', 'rejected'].includes(nextStatus)) {
      await client.query(
        `UPDATE public.candidate_admin_assignments
         SET status = 'reassigned',
             updated_at = NOW()
         WHERE candidate_id = $1
           AND status IN ('pending', 'claimed')`,
        [input.candidateId],
      );
    }

    await client.query(
      `INSERT INTO public.ingestion_audit_events
         (candidate_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'approval.decided', 'human', $2, $3::jsonb)`,
      [
        input.candidateId,
        input.actorUserId,
        JSON.stringify({
          assignmentId: assignment.id,
          decision: input.decision,
          approvalCount,
          rejectionCount,
          escalationCount,
          requiredApprovalCount: REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS,
          eventId: crypto.randomUUID(),
        }),
      ],
    );

    return { status: nextStatus, approvalCount, rejectionCount, escalationCount };
  });
}
