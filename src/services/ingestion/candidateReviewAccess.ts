import { executeQuery } from '@/services/db/postgres';

export interface CandidateReviewAssignmentAccess {
  id: string;
  status: string;
  outcome: string | null;
  expires_at: string | null;
}

export function redactPeerReviewMetadata<T>(row: T): T {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const redacted = { ...row } as Record<string, unknown>;
  delete redacted.reviewedByUserId;
  delete redacted.reviewNotes;
  delete redacted.reviewed_by_user_id;
  delete redacted.review_notes;
  delete redacted.reviewedBy;
  delete redacted.assignedByUserId;
  delete redacted.addedBy;
  delete redacted.actorId;
  delete redacted.createdByUserId;
  delete redacted.updatedByUserId;
  delete redacted.verifiedByUserId;
  return redacted as T;
}

export function redactCandidateAssignmentMetadata<T>(candidate: T): T {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  const redacted = { ...candidate } as Record<string, unknown>;
  if (redacted.review && typeof redacted.review === 'object' && !Array.isArray(redacted.review)) {
    const review = { ...redacted.review as Record<string, unknown> };
    delete review.assignedToKey;
    delete review.assignedToRole;
    delete review.status;
    redacted.review = review;
  }
  return redacted as T;
}

/**
 * Community reviewers may read only candidates assigned to them. ORAN admins
 * retain read-only oversight, but mutation routes still require an exact
 * claimed assignment.
 */
export async function getCandidateReviewReadAccess(input: {
  candidateId: string;
  actorUserId: string;
  hasOranOversight: boolean;
}): Promise<{
  allowed: boolean;
  assignment: CandidateReviewAssignmentAccess | null;
}> {
  // ORAN administrators are oversight-only. Even if a legacy assignment row
  // exists, never surface it as the current user's actionable review.
  if (input.hasOranOversight) {
    return { allowed: true, assignment: null };
  }

  const rows = await executeQuery<CandidateReviewAssignmentAccess>(
    `SELECT assignment.id,
            assignment.status,
            CASE WHEN assignment.status = 'completed' THEN assignment.outcome END AS outcome,
            assignment.expires_at
     FROM public.candidate_admin_assignments assignment
     JOIN public.admin_review_profiles reviewer
       ON reviewer.id = assignment.admin_profile_id
     JOIN public.user_profiles account
       ON account.user_id = reviewer.user_id
     WHERE assignment.candidate_id = $1
       AND reviewer.user_id = $2
       AND reviewer.is_active IS TRUE
       AND COALESCE(account.account_status, 'active') = 'active'
       AND account.role = 'community_admin'
       AND assignment.status IN ('pending', 'claimed', 'completed')
       AND (
         assignment.status = 'completed'
         OR assignment.expires_at IS NULL
         OR assignment.expires_at > NOW()
       )
     ORDER BY CASE assignment.status
       WHEN 'claimed' THEN 0
       WHEN 'pending' THEN 1
       ELSE 2
     END,
     assignment.assigned_at DESC
     LIMIT 1`,
    [input.candidateId, input.actorUserId],
  );
  return {
    allowed: Boolean(rows[0]),
    assignment: rows[0] ?? null,
  };
}
