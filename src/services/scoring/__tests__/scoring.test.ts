import { describe, expect, it } from 'vitest';
import {
  computeConstraintFit,
  computeEligibilityMatch,
  computeScore,
  computeVerificationConfidence,
  ConfidenceScorer,
  getBand,
} from '../scorer';

describe('computeVerificationConfidence', () => {
  it('applies positive verification signals', () => {
    const score = computeVerificationConfidence({
      orgVerified: true,
      communityPhoneConfirmed: true,
      communityInPersonConfirmed: true,
      documentProofProvided: true,
      websiteHealthy: true,
      confirmationsLast90Days: 2,
    });

    expect(score).toBe(100);
  });

  it('applies stale/report/contact penalties', () => {
    const score = computeVerificationConfidence({
      orgVerified: true,
      daysSinceLastVerification: 181,
      repeatedUserReportsTrend: true,
      contactInvalid: true,
    });

    // 35 - 25 - 15 - 30 = -35 -> clamped to 0
    expect(score).toBe(0);
  });

  it('caps verification score at 100', () => {
    const score = computeVerificationConfidence({
      orgVerified: true,
      communityPhoneConfirmed: true,
      communityInPersonConfirmed: true,
      documentProofProvided: true,
      websiteHealthy: true,
      confirmationsLast90Days: 5,
    });

    expect(score).toBe(100);
  });
});

describe('computeEligibilityMatch', () => {
  it('uses structured eligibility score', () => {
    expect(computeEligibilityMatch({ eligibilityMatchScore: 72 })).toBe(72);
  });

  it('defaults unknown eligibility to 0', () => {
    expect(computeEligibilityMatch({})).toBe(0);
  });
});

describe('computeConstraintFit', () => {
  it('uses structured constraint fit score', () => {
    expect(computeConstraintFit({ constraintFitScore: 64 })).toBe(64);
  });

  it('defaults unknown constraint fit to 0', () => {
    expect(computeConstraintFit({})).toBe(0);
  });
});

describe('computeScore', () => {
  it('uses exact ORAN formula: 0.45/0.40/0.15', () => {
    const result = computeScore('svc-1', {
      evidence: {
        orgVerified: true,
        documentProofProvided: true,
        // verification = 55
        eligibilityMatchScore: 80,
        constraintFitScore: 40,
      },
    });

    // 0.45*55 + 0.40*80 + 0.15*40 = 62.75
    expect(result.score).toBe(62.8);
    expect(result.verificationConfidence).toBe(55);
    expect(result.eligibilityMatch).toBe(80);
    expect(result.constraintFit).toBe(40);
  });

  it('returns serviceId in result', () => {
    const result = computeScore('my-service', { evidence: {} });
    expect(result.serviceId).toBe('my-service');
  });
});

describe('getBand', () => {
  it('returns HIGH for scores >= 80', () => {
    expect(getBand(80)).toBe('HIGH');
    expect(getBand(100)).toBe('HIGH');
  });

  it('returns LIKELY for scores 60-79', () => {
    expect(getBand(60)).toBe('LIKELY');
    expect(getBand(79.9)).toBe('LIKELY');
  });

  it('returns POSSIBLE for scores below 60', () => {
    expect(getBand(59.9)).toBe('POSSIBLE');
    expect(getBand(0)).toBe('POSSIBLE');
  });
});

describe('ConfidenceScorer', () => {
  it('delegates computeScore/getBand', () => {
    const scorer = new ConfidenceScorer();
    const result = scorer.computeScore('svc-2', {
      evidence: {
        orgVerified: true,
        eligibilityMatchScore: 70,
        constraintFitScore: 70,
      },
    });

    expect(result.score).toBeGreaterThan(0);
    expect(scorer.getBand(result.score)).toBeTypeOf('string');
  });
});
