/**
 * ORAN Confidence Scorer
 *
 * Public score contract (0–100):
 * final = 0.45 * verification + 0.40 * eligibility + 0.15 * constraint
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

const clampToPercent = (value: number): number => Math.max(0, Math.min(100, value));
const r1 = (value: number): number => Math.round(value * 10) / 10;

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
 * Unknown remains unknown and defaults to 0 until clarified.
 */
export function computeEligibilityMatch(evidence: ServiceEvidence): number {
  return clampToPercent(evidence.eligibilityMatchScore ?? 0);
}

/**
 * Constraint Fit (0–100) is a structured upstream input.
 * Unknown remains unknown and defaults to 0 until clarified.
 */
export function computeConstraintFit(evidence: ServiceEvidence): number {
  return clampToPercent(evidence.constraintFitScore ?? 0);
}

export function computeScore(serviceId: string, input: ScoreInput): ConfidenceScore {
  const verificationConfidence = computeVerificationConfidence(input.evidence);
  const eligibilityMatch = computeEligibilityMatch(input.evidence);
  const constraintFit = computeConstraintFit(input.evidence);

  const score =
    ORAN_CONFIDENCE_WEIGHTS.verification * verificationConfidence +
    ORAN_CONFIDENCE_WEIGHTS.eligibility * eligibilityMatch +
    ORAN_CONFIDENCE_WEIGHTS.constraint * constraintFit;

  return {
    id: '',
    serviceId,
    score: r1(clampToPercent(score)),
    verificationConfidence: r1(verificationConfidence),
    eligibilityMatch: r1(eligibilityMatch),
    constraintFit: r1(constraintFit),
    computedAt: new Date(),
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
