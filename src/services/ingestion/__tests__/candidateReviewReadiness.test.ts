import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  executeQuery: executeQueryMock,
}));

import { getPeerBlindCandidateReviewReadiness } from '../candidateReviewReadiness';

describe('peer-blind candidate review readiness', () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
  });

  it('fails closed when durable blocker evidence is malformed', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ is_ready: true }])
      .mockResolvedValueOnce([{
        has_required_fields: true,
        has_required_tags: true,
        tags_confirmed: true,
        meets_score_threshold: true,
        blockers: { unexpected: true },
        can_mutate_evidence: true,
      }]);

    await expect(getPeerBlindCandidateReviewReadiness('cand-1')).resolves.toEqual({
      reviewReadiness: {
        canApprove: false,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: false,
        blockers: ['readiness_evidence_invalid'],
      },
      evidenceStillMutable: true,
    });
  });

  it('withholds every peer outcome blocker while preserving independent approval', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ is_ready: false }])
      .mockResolvedValueOnce([{
        has_required_fields: true,
        has_required_tags: true,
        tags_confirmed: true,
        meets_score_threshold: true,
        blockers: [
          'candidate_rejected',
          'candidate_escalated',
          'candidate_review_disagreement',
          'Need 2 admin approvals, have 1',
        ],
        can_mutate_evidence: false,
      }]);

    await expect(getPeerBlindCandidateReviewReadiness('cand-1')).resolves.toEqual({
      reviewReadiness: {
        canApprove: true,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: [],
      },
      evidenceStillMutable: false,
    });
  });

  it('preserves unrelated static blockers that begin with Need', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ is_ready: false }])
      .mockResolvedValueOnce([{
        has_required_fields: true,
        has_required_tags: true,
        tags_confirmed: true,
        meets_score_threshold: true,
        blockers: ['Need government-issued ID verification'],
        can_mutate_evidence: true,
      }]);

    await expect(getPeerBlindCandidateReviewReadiness('cand-1')).resolves.toEqual({
      reviewReadiness: {
        canApprove: false,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: ['Need government-issued ID verification'],
      },
      evidenceStillMutable: true,
    });
  });

  it('surfaces a pending LLM suggestion as a peer-blind static blocker', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ is_ready: false }])
      .mockResolvedValueOnce([{
        has_required_fields: true,
        has_required_tags: true,
        tags_confirmed: true,
        meets_score_threshold: true,
        blockers: [
          'pending_llm_suggestion',
          'Need 2 admin approvals, have 0',
        ],
        can_mutate_evidence: true,
      }]);

    await expect(getPeerBlindCandidateReviewReadiness('cand-1')).resolves.toEqual({
      reviewReadiness: {
        canApprove: false,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: ['pending_llm_suggestion'],
      },
      evidenceStillMutable: true,
    });
  });
});
