import { executeQuery } from '@/services/db/postgres';

const PEER_DECISION_BLOCKERS = new Set([
  'candidate_rejected',
  'candidate_escalated',
  'candidate_review_disagreement',
]);

interface PeerBlindReadinessRow {
  has_required_fields: boolean;
  has_required_tags: boolean;
  tags_confirmed: boolean;
  meets_score_threshold: boolean;
  blockers: unknown;
  can_mutate_evidence: boolean;
}

export interface PeerBlindCandidateReviewReadiness {
  canApprove: boolean;
  hasRequiredFields: boolean;
  hasRequiredTags: boolean;
  tagsConfirmed: boolean;
  meetsScoreThreshold: boolean;
  passesVerification: boolean;
  blockers: string[];
}

function isStaticReviewBlocker(blocker: string): boolean {
  return !PEER_DECISION_BLOCKERS.has(blocker) && !blocker.startsWith('Need ');
}

/**
 * Recompute durable readiness, then project only static evidence gates. Peer
 * approval counts, outcomes, and escalation/rejection blockers are never
 * returned to an independent reviewer.
 */
export async function getPeerBlindCandidateReviewReadiness(candidateId: string): Promise<{
  reviewReadiness: PeerBlindCandidateReviewReadiness;
  evidenceStillMutable: boolean;
}> {
  await executeQuery<{ is_ready: boolean }>(
    'SELECT public.evaluate_candidate_readiness($1) AS is_ready',
    [candidateId],
  );
  const rows = await executeQuery<PeerBlindReadinessRow>(
    `SELECT readiness.has_required_fields,
            readiness.has_required_tags,
            readiness.tags_confirmed,
            readiness.meets_score_threshold,
            readiness.blockers,
            NOT EXISTS (
              SELECT 1
              FROM public.candidate_admin_assignments completed_review
              WHERE completed_review.candidate_id = readiness.candidate_id
                AND completed_review.status = 'completed'
            ) AS can_mutate_evidence
     FROM public.candidate_readiness readiness
     WHERE readiness.candidate_id = $1`,
    [candidateId],
  );
  const readiness = rows[0];
  if (!readiness) {
    throw new Error(`Candidate ${candidateId} has no durable readiness record after evaluation`);
  }
  const rawBlockers = readiness.blockers;
  const hasValidBlockerEvidence = Array.isArray(rawBlockers)
    && rawBlockers.every((blocker: unknown) => typeof blocker === 'string');
  const blockers: string[] = hasValidBlockerEvidence
    ? (rawBlockers as string[]).filter(isStaticReviewBlocker)
    : ['readiness_evidence_invalid'];
  const passesVerification = !blockers.some((blocker) => (
    blocker === 'quarantine_source'
    || blocker === 'critical_verification_failure'
    || blocker === 'domain_allowlist_failed'
  ));
  const reviewReadiness = {
    hasRequiredFields: readiness.has_required_fields,
    hasRequiredTags: readiness.has_required_tags,
    tagsConfirmed: readiness.tags_confirmed,
    meetsScoreThreshold: readiness.meets_score_threshold,
    passesVerification,
    blockers,
    canApprove: readiness.has_required_fields
      && readiness.has_required_tags
      && readiness.tags_confirmed
      && readiness.meets_score_threshold
      && passesVerification
      && blockers.length === 0,
  };
  return {
    reviewReadiness,
    evidenceStillMutable: readiness.can_mutate_evidence,
  };
}
