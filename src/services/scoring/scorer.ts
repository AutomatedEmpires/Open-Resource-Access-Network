/**
 * ORAN Confidence Scorer
 *
 * Implements the scoring model defined in docs/SCORING_MODEL.md
 *
 * Factors and weights:
 *   data_completeness    × 0.25
 *   verification_recency × 0.30
 *   community_feedback   × 0.20
 *   host_responsiveness  × 0.15
 *   source_authority     × 0.10
 *
 * Plus penalties for staleness, unresolved flags, bounced contacts, etc.
 */

import type { ConfidenceScore, ConfidenceBand } from '@/domain/types';
import {
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_PENALTIES,
  CONFIDENCE_BANDS,
} from '@/domain/constants';

// ============================================================
// EVIDENCE TYPES
// ============================================================

export interface ServiceEvidence {
  /** ISO timestamp of last verification (from verification_queue) */
  lastVerifiedAt?: Date | null;
  /** ISO timestamp of last host update */
  lastHostUpdateAt?: Date | null;
  /** Number of feedback entries */
  feedbackCount?: number;
  /** Average feedback rating (1–5) */
  averageRating?: number;
  /** Contact success rate (0.0–1.0) */
  contactSuccessRate?: number;
  /** Source authority type */
  sourceType?: SourceType;
  /** Number of open unresolved flags */
  openFlagCount?: number;
  /** Whether contact info has been confirmed as bouncing */
  contactBounced?: boolean;
  /** Whether this record is a detected duplicate */
  isDuplicate?: boolean;
  /** True if the organization has a claimed owner */
  hasClaimed?: boolean;
}

export interface ServiceCompleteness {
  hasName: boolean;
  hasDescription: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  hasSchedule: boolean;
  hasOrganizationName: boolean;
  hasStatus: boolean;
  /** Optional but valuable fields */
  hasUrl?: boolean;
  hasEmail?: boolean;
  hasFees?: boolean;
}

export type SourceType =
  | 'government_db'
  | '211_airs'
  | 'verified_nonprofit'
  | 'host_verified'
  | 'host_unverified'
  | 'community'
  | 'unknown';

// ============================================================
// FACTOR COMPUTATIONS
// ============================================================

const REQUIRED_FIELDS = [
  'hasName',
  'hasDescription',
  'hasPhone',
  'hasAddress',
  'hasSchedule',
  'hasOrganizationName',
  'hasStatus',
] as const;

const OPTIONAL_BONUS_FIELDS = [
  'hasUrl',
  'hasEmail',
  'hasFees',
] as const;

const OPTIONAL_BONUS_PER_FIELD = 0.05;

/**
 * Compute data_completeness sub-score (0.0–1.0).
 * All required fields present = 1.0; each missing reduces score.
 */
export function computeDataCompleteness(completeness: ServiceCompleteness): number {
  const requiredCount = REQUIRED_FIELDS.length;
  const missingRequired = REQUIRED_FIELDS.filter((f) => !completeness[f]).length;
  const baseScore = Math.max(0, 1.0 - missingRequired / requiredCount);

  let bonus = 0;
  for (const field of OPTIONAL_BONUS_FIELDS) {
    if (completeness[field]) {
      bonus += OPTIONAL_BONUS_PER_FIELD;
    }
  }

  return Math.min(1.0, baseScore + bonus);
}

/**
 * Compute verification_recency sub-score (0.0–1.0).
 * Based on days since last verification.
 */
export function computeVerificationRecency(lastVerifiedAt?: Date | null): number {
  if (!lastVerifiedAt) return 0.0;

  const daysSince = (Date.now() - lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < 30)  return 1.00;
  if (daysSince < 90)  return 0.90;
  if (daysSince < 180) return 0.75;
  if (daysSince < 365) return 0.50;
  if (daysSince < 730) return 0.25;
  return 0.0;
}

/**
 * Compute community_feedback sub-score (0.0–1.0).
 * Requires minimum 3 feedback entries; below threshold returns neutral 0.5.
 */
export function computeCommunityFeedback(
  feedbackCount?: number,
  averageRating?: number,
  contactSuccessRate?: number
): number {
  if (!feedbackCount || feedbackCount < 3) return 0.5;
  if (averageRating === undefined) return 0.5;

  const ratingScore = (averageRating / 5.0) * 0.7;
  const successScore = (contactSuccessRate ?? 0.5) * 0.3;

  return Math.min(1.0, ratingScore + successScore);
}

/**
 * Compute host_responsiveness sub-score (0.0–1.0).
 */
export function computeHostResponsiveness(
  lastHostUpdateAt?: Date | null,
  hasClaimed?: boolean
): number {
  if (!hasClaimed) return 0.10;
  if (!lastHostUpdateAt) return 0.10;

  const daysSince = (Date.now() - lastHostUpdateAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < 30)  return 1.00;
  if (daysSince < 90)  return 0.80;
  if (daysSince < 180) return 0.60;
  if (daysSince < 365) return 0.40;
  return 0.20;
}

/**
 * Compute source_authority sub-score (0.0–1.0).
 */
export function computeSourceAuthority(sourceType?: SourceType): number {
  const scores: Record<SourceType, number> = {
    government_db:      1.00,
    '211_airs':         0.90,
    verified_nonprofit: 0.80,
    host_verified:      0.70,
    host_unverified:    0.40,
    community:          0.30,
    unknown:            0.10,
  };

  return scores[sourceType ?? 'unknown'];
}

// ============================================================
// PENALTY COMPUTATION
// ============================================================

export interface PenaltyFlags {
  daysPastDue?: number;
  openFlagCount?: number;
  contactBounced?: boolean;
  isDuplicate?: boolean;
}

/**
 * Compute total penalties to subtract from the weighted score.
 * Returns a NEGATIVE number (or zero).
 */
export function computePenalties(flags: PenaltyFlags): number {
  let penalty = 0;

  // Staleness penalty
  if (flags.daysPastDue && flags.daysPastDue > 0) {
    const periods = Math.floor(flags.daysPastDue / 30);
    const stalenessPenalty = periods * CONFIDENCE_PENALTIES.stalenessPer30Days;
    penalty += Math.max(stalenessPenalty, CONFIDENCE_PENALTIES.stalenessMaxPenalty);
  }

  // Unresolved flag penalty
  if (flags.openFlagCount && flags.openFlagCount > 0) {
    const flagPenalty = flags.openFlagCount * CONFIDENCE_PENALTIES.unresolvedFlagPer;
    penalty += Math.max(flagPenalty, CONFIDENCE_PENALTIES.unresolvedFlagMax);
  }

  // Bounced contact penalty
  if (flags.contactBounced) {
    penalty += CONFIDENCE_PENALTIES.bouncedContact;
  }

  // Duplicate penalty
  if (flags.isDuplicate) {
    penalty += CONFIDENCE_PENALTIES.duplicateRecord;
  }

  return penalty;
}

// ============================================================
// MAIN SCORER
// ============================================================

export interface ScoreInput {
  completeness: ServiceCompleteness;
  evidence: ServiceEvidence;
}

/**
 * Computes the full confidence score for a service.
 * Applies all factor weights and penalties.
 * Returns a ConfidenceScore with score clamped to [0.000, 1.000].
 */
export function computeScore(serviceId: string, input: ScoreInput): ConfidenceScore {
  const { completeness, evidence } = input;

  const dataCompleteness = computeDataCompleteness(completeness);
  const verificationRecency = computeVerificationRecency(evidence.lastVerifiedAt);
  const communityFeedback = computeCommunityFeedback(
    evidence.feedbackCount,
    evidence.averageRating,
    evidence.contactSuccessRate
  );
  const hostResponsiveness = computeHostResponsiveness(
    evidence.lastHostUpdateAt,
    evidence.hasClaimed
  );
  const sourceAuthority = computeSourceAuthority(evidence.sourceType);

  const weighted =
    dataCompleteness    * CONFIDENCE_WEIGHTS.dataCompleteness    +
    verificationRecency * CONFIDENCE_WEIGHTS.verificationRecency +
    communityFeedback   * CONFIDENCE_WEIGHTS.communityFeedback   +
    hostResponsiveness  * CONFIDENCE_WEIGHTS.hostResponsiveness  +
    sourceAuthority     * CONFIDENCE_WEIGHTS.sourceAuthority;

  // Compute penalties
  const penaltyFlags: PenaltyFlags = {
    openFlagCount: evidence.openFlagCount,
    contactBounced: evidence.contactBounced,
    isDuplicate: evidence.isDuplicate,
  };

  // Days past due: assume reviews are due every 180 days after last verification
  if (evidence.lastVerifiedAt) {
    const daysSince = (Date.now() - evidence.lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 180) {
      penaltyFlags.daysPastDue = daysSince - 180;
    }
  }

  const penalties = computePenalties(penaltyFlags);
  const rawScore = weighted + penalties;
  const score = Math.min(1.0, Math.max(0.0, rawScore));

  return {
    id: '',
    serviceId,
    score: Math.round(score * 1000) / 1000,
    dataCompleteness: Math.round(dataCompleteness * 1000) / 1000,
    verificationRecency: Math.round(verificationRecency * 1000) / 1000,
    communityFeedback: Math.round(communityFeedback * 1000) / 1000,
    hostResponsiveness: Math.round(hostResponsiveness * 1000) / 1000,
    sourceAuthority: Math.round(sourceAuthority * 1000) / 1000,
    computedAt: new Date(),
  };
}

/**
 * Returns the confidence band for a given score.
 */
export function getBand(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_BANDS.HIGH.min)       return 'HIGH';
  if (score >= CONFIDENCE_BANDS.MEDIUM.min)     return 'MEDIUM';
  if (score >= CONFIDENCE_BANDS.LOW.min)        return 'LOW';
  return 'UNVERIFIED';
}

/**
 * Convenience class wrapping the functional API.
 */
export class ConfidenceScorer {
  computeScore(serviceId: string, input: ScoreInput): ConfidenceScore {
    return computeScore(serviceId, input);
  }

  applyPenalties(baseScore: number, flags: PenaltyFlags): number {
    const penalties = computePenalties(flags);
    return Math.min(1.0, Math.max(0.0, baseScore + penalties));
  }

  getBand(score: number): ConfidenceBand {
    return getBand(score);
  }
}
