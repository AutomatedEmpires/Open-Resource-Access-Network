/**
 * ORAN Confidence Scorer
 *
 * Public scoring contract (0–100):
 * - Trust score = verification confidence (0–100)
 * - Match score = normalized blend of eligibility + constraint (0–100)
 * - Overall score (stored/used for ordering/admin) keeps the historical weights
 *
 * IMPORTANT:
 * Seeker-facing confidence messaging should be driven by Trust (verification)
 * rather than a blended score that can be sensitive to missing match signals.
 */

import type { ConfidenceBand, ConfidenceScore } from '@/domain/types';
import {
  ORAN_CONFIDENCE_WEIGHTS,
  VERIFICATION_SIGNAL_WEIGHTS,
  VERIFICATION_PENALTIES,
  CONFIDENCE_BANDS,
} from '@/domain/constants';

export interface ServiceEvidence {
  // Verification confidence signals
  orgVerified?: boolean;
  communityPhoneConfirmed?: boolean;
  communityInPersonConfirmed?: boolean;
  documentProofProvided?: boolean;
  websiteHealthy?: boolean;
  confirmationsLast90Days?: number;
  daysSinceLastVerification?: number;
  repeatedUserReportsTrend?: boolean;
  contactInvalid?: boolean;
  moderationFlagsOpen?: number;

  // Structured upstream scoring inputs (never inferred)
  eligibilityMatchScore?: number;
  constraintFitScore?: number;
}

export interface ScoreInput {
  evidence: ServiceEvidence;
}

const clampToPercent = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
const r1 = (value: number): number => Math.round(value * 10) / 10;

const MATCH_WEIGHT_SUM = ORAN_CONFIDENCE_WEIGHTS.eligibility + ORAN_CONFIDENCE_WEIGHTS.constraint;

/**
 * Neutral default for match-related subscores when the system does not yet have
 * enough structured inputs to compute them. Using 50 avoids unfairly depressing
 * overall scores to 0 when match signals are absent.
 */
const DEFAULT_UNKNOWN_MATCH_SCORE = 50;

/**
 * Verification Confidence (0–100) based on deterministic signals and penalties.
 */
export function computeVerificationConfidence(evidence: ServiceEvidence): number {
  let score = 0;

  if (evidence.orgVerified) score += VERIFICATION_SIGNAL_WEIGHTS.orgVerified;
  if (evidence.communityPhoneConfirmed) score += VERIFICATION_SIGNAL_WEIGHTS.communityPhone;
  if (evidence.communityInPersonConfirmed) score += VERIFICATION_SIGNAL_WEIGHTS.communityInPerson;
  if (evidence.documentProofProvided) score += VERIFICATION_SIGNAL_WEIGHTS.documentProof;
  if (evidence.websiteHealthy) score += VERIFICATION_SIGNAL_WEIGHTS.websiteHealth;
  if ((evidence.confirmationsLast90Days ?? 0) >= 2) {
    score += VERIFICATION_SIGNAL_WEIGHTS.multipleConfirmations90d;
  }

  if ((evidence.daysSinceLastVerification ?? 0) > 180) {
    score += VERIFICATION_PENALTIES.staleOver180Days;
  }
  if (evidence.repeatedUserReportsTrend) {
    score += VERIFICATION_PENALTIES.repeatedUserReportsTrend;
  }
  if (evidence.contactInvalid) {
    score += VERIFICATION_PENALTIES.invalidContact;
  }
  if ((evidence.moderationFlagsOpen ?? 0) > 0) {
    score += VERIFICATION_PENALTIES.moderationFlag;
  }

  return clampToPercent(score);
}

/**
 * Eligibility Match (0–100) is a structured upstream input.
 * If unknown, defaults to a neutral 50 (rather than 0) to avoid penalizing
 * services before match signals are computed.
 */
export function computeEligibilityMatch(evidence: ServiceEvidence): number {
  return clampToPercent(evidence.eligibilityMatchScore ?? DEFAULT_UNKNOWN_MATCH_SCORE);
}

/**
 * Constraint Fit (0–100) is a structured upstream input.
 * If unknown, defaults to a neutral 50 (rather than 0) to avoid penalizing
 * services before fit signals are computed.
 */
export function computeConstraintFit(evidence: ServiceEvidence): number {
  return clampToPercent(evidence.constraintFitScore ?? DEFAULT_UNKNOWN_MATCH_SCORE);
}

/**
 * Trust score used for seeker-facing messaging.
 * Equivalent to verification confidence.
 */
export function computeTrustScore(evidence: ServiceEvidence): number {
  return computeVerificationConfidence(evidence);
}

/**
 * Match score used for seeker-facing "fit" messaging.
 * Normalized blend of eligibility + constraint.
 */
export function computeMatchScore(evidence: ServiceEvidence): number {
  const eligibilityMatch = computeEligibilityMatch(evidence);
  const constraintFit = computeConstraintFit(evidence);

  // Normalize to 0–100 by dividing by the match weight sum.
  // (eligibility+constraint weights sum to 0.55 in the current contract)
  const match =
    (ORAN_CONFIDENCE_WEIGHTS.eligibility * eligibilityMatch +
      ORAN_CONFIDENCE_WEIGHTS.constraint * constraintFit) /
    MATCH_WEIGHT_SUM;

  return r1(clampToPercent(match));
}

export function computeScore(serviceId: string, input: ScoreInput): ConfidenceScore {
  const verificationConfidence = computeVerificationConfidence(input.evidence);
  const eligibilityMatch = computeEligibilityMatch(input.evidence);
  const constraintFit = computeConstraintFit(input.evidence);

  const score =
    ORAN_CONFIDENCE_WEIGHTS.verification * verificationConfidence +
    ORAN_CONFIDENCE_WEIGHTS.eligibility * eligibilityMatch +
    ORAN_CONFIDENCE_WEIGHTS.constraint * constraintFit;

  const now = new Date();

  return {
    id: '',
    serviceId,
    score: r1(clampToPercent(score)),
    verificationConfidence: r1(verificationConfidence),
    eligibilityMatch: r1(eligibilityMatch),
    constraintFit: r1(constraintFit),
    computedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function getBand(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_BANDS.HIGH.min) return 'HIGH';
  if (score >= CONFIDENCE_BANDS.LIKELY.min) return 'LIKELY';
  return 'POSSIBLE';
}

export class ConfidenceScorer {
  computeScore(serviceId: string, input: ScoreInput): ConfidenceScore {
    return computeScore(serviceId, input);
  }

  getBand(score: number): ConfidenceBand {
    return getBand(score);
  }
}
