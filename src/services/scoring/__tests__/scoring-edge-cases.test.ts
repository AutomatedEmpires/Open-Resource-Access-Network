/**
 * Scoring Edge Case Tests
 *
 * Validates scorer behavior under boundary conditions:
 * NaN inputs, negative overflow, extreme values, etc.
 * Safety-critical: incorrect scores could surface wrong services to vulnerable users.
 */

import { describe, it, expect } from 'vitest';
import {
  computeVerificationConfidence,
  computeEligibilityMatch,
  computeConstraintFit,
  computeScore,
  getBand,
} from '../scorer';

describe('scoring edge cases', () => {
  // ── Boundary values ────────────────────────────────────────
  describe('boundary clamping', () => {
    it('clamps negative computed score to 0', () => {
      const result = computeVerificationConfidence({
        daysSinceLastVerification: 999,
        repeatedUserReportsTrend: true,
        contactInvalid: true,
        moderationFlagsOpen: 5,
      });
      expect(result).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('clamps verification above 100 to 100', () => {
      // All positive signals should never exceed 100
      const result = computeVerificationConfidence({
        orgVerified: true,
        communityPhoneConfirmed: true,
        communityInPersonConfirmed: true,
        documentProofProvided: true,
        websiteHealthy: true,
        confirmationsLast90Days: 100,
      });
      expect(result).toBeLessThanOrEqual(100);
    });

    it('clamps eligibility score above 100 to 100', () => {
      expect(computeEligibilityMatch({ eligibilityMatchScore: 150 })).toBe(100);
    });

    it('clamps eligibility score below 0 to 0', () => {
      expect(computeEligibilityMatch({ eligibilityMatchScore: -50 })).toBe(0);
    });

    it('clamps constraint fit above 100 to 100', () => {
      expect(computeConstraintFit({ constraintFitScore: 200 })).toBe(100);
    });

    it('clamps constraint fit below 0 to 0', () => {
      expect(computeConstraintFit({ constraintFitScore: -10 })).toBe(0);
    });
  });

  // ── NaN / undefined handling ───────────────────────────────
  describe('NaN and undefined safety', () => {
    it('handles undefined evidence gracefully', () => {
      const result = computeScore('svc-nan', { evidence: {} });
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('handles NaN eligibility score as 0 (clamped)', () => {
      const result = computeEligibilityMatch({ eligibilityMatchScore: NaN });
      // NaN should be clamped to 0 (via Math.max(0, ...))
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    });

    it('handles NaN constraint fit score as 0 (clamped)', () => {
      const result = computeConstraintFit({ constraintFitScore: NaN });
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    });

    it('final score is always a finite number', () => {
      const result = computeScore('svc-edge', {
        evidence: {
          eligibilityMatchScore: NaN,
          constraintFitScore: NaN,
        },
      });
      expect(Number.isFinite(result.score)).toBe(true);
    });
  });

  // ── getBand edge cases ─────────────────────────────────────
  describe('getBand boundaries', () => {
    it('score of exactly 80 is HIGH', () => {
      expect(getBand(80)).toBe('HIGH');
    });

    it('score of 79.99 is LIKELY', () => {
      expect(getBand(79.99)).toBe('LIKELY');
    });

    it('score of exactly 60 is LIKELY', () => {
      expect(getBand(60)).toBe('LIKELY');
    });

    it('score of 59.99 is POSSIBLE', () => {
      expect(getBand(59.99)).toBe('POSSIBLE');
    });

    it('score of 0 is POSSIBLE', () => {
      expect(getBand(0)).toBe('POSSIBLE');
    });

    it('score of 100 is HIGH', () => {
      expect(getBand(100)).toBe('HIGH');
    });
  });

  // ── Full score composition ─────────────────────────────────
  describe('full score with all penalties', () => {
    it('worst case: all penalties, no positives = 0', () => {
      const result = computeScore('svc-worst', {
        evidence: {
          orgVerified: false,
          daysSinceLastVerification: 365,
          repeatedUserReportsTrend: true,
          contactInvalid: true,
          moderationFlagsOpen: 3,
          eligibilityMatchScore: 0,
          constraintFitScore: 0,
        },
      });
      expect(result.score).toBe(0);
    });

    it('best case: all signals maxed = 100', () => {
      const result = computeScore('svc-best', {
        evidence: {
          orgVerified: true,
          communityPhoneConfirmed: true,
          communityInPersonConfirmed: true,
          documentProofProvided: true,
          websiteHealthy: true,
          confirmationsLast90Days: 5,
          eligibilityMatchScore: 100,
          constraintFitScore: 100,
        },
      });
      expect(result.score).toBe(100);
    });
  });

  // ── Score result shape ─────────────────────────────────────
  describe('score result shape', () => {
    it('includes all required fields with correct types', () => {
      const result = computeScore('svc-shape', { evidence: {} });
      expect(typeof result.id).toBe('string');
      expect(typeof result.serviceId).toBe('string');
      expect(typeof result.score).toBe('number');
      expect(typeof result.verificationConfidence).toBe('number');
      expect(typeof result.eligibilityMatch).toBe('number');
      expect(typeof result.constraintFit).toBe('number');
      expect(result.computedAt).toBeInstanceOf(Date);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });
});
