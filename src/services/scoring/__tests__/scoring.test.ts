/**
 * Scoring Service Tests
 *
 * Tests for ConfidenceScorer and related functions.
 * All tests are self-contained — no DB connection required.
 */

import { describe, it, expect } from 'vitest';
import {
  computeScore,
  computeDataCompleteness,
  computeVerificationRecency,
  computeCommunityFeedback,
  computePenalties,
  getBand,
  ConfidenceScorer,
} from '../scorer';
import type { ServiceCompleteness, ServiceEvidence } from '../scorer';

// ============================================================
// FIXTURES
// ============================================================

const fullCompleteness: ServiceCompleteness = {
  hasName: true,
  hasDescription: true,
  hasPhone: true,
  hasAddress: true,
  hasSchedule: true,
  hasOrganizationName: true,
  hasStatus: true,
  hasUrl: true,
  hasEmail: true,
  hasFees: true,
};

const minimalCompleteness: ServiceCompleteness = {
  hasName: true,
  hasDescription: false,
  hasPhone: false,
  hasAddress: false,
  hasSchedule: false,
  hasOrganizationName: false,
  hasStatus: true,
};

const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
const staleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago

const fullEvidence: ServiceEvidence = {
  lastVerifiedAt: recentDate,
  lastHostUpdateAt: recentDate,
  feedbackCount: 10,
  averageRating: 4.5,
  contactSuccessRate: 0.9,
  sourceType: 'government_db',
  openFlagCount: 0,
  contactBounced: false,
  isDuplicate: false,
  hasClaimed: true,
};

const poorEvidence: ServiceEvidence = {
  lastVerifiedAt: null,
  lastHostUpdateAt: null,
  feedbackCount: 0,
  sourceType: 'unknown',
  openFlagCount: 3,
  contactBounced: true,
  isDuplicate: false,
  hasClaimed: false,
};

// ============================================================
// computeScore — range tests
// ============================================================

describe('computeScore', () => {
  it('returns a score between 0 and 1 for a fully complete service', () => {
    const result = computeScore('test-id', { completeness: fullCompleteness, evidence: fullEvidence });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('returns a score between 0 and 1 for a minimal service', () => {
    const result = computeScore('test-id', { completeness: minimalCompleteness, evidence: poorEvidence });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('scores a fully complete service higher than a minimal one', () => {
    const fullResult = computeScore('full', { completeness: fullCompleteness, evidence: fullEvidence });
    const minResult = computeScore('min', { completeness: minimalCompleteness, evidence: poorEvidence });
    expect(fullResult.score).toBeGreaterThan(minResult.score);
  });

  it('returns serviceId in the result', () => {
    const result = computeScore('my-service-123', { completeness: fullCompleteness, evidence: fullEvidence });
    expect(result.serviceId).toBe('my-service-123');
  });

  it('includes all sub-scores', () => {
    const result = computeScore('test', { completeness: fullCompleteness, evidence: fullEvidence });
    expect(result.dataCompleteness).toBeGreaterThan(0);
    expect(result.verificationRecency).toBeGreaterThan(0);
    expect(result.communityFeedback).toBeGreaterThan(0);
    expect(result.hostResponsiveness).toBeGreaterThan(0);
    expect(result.sourceAuthority).toBeGreaterThan(0);
  });
});

// ============================================================
// computeDataCompleteness
// ============================================================

describe('computeDataCompleteness', () => {
  it('returns 1.0 (or higher, capped) for fully complete service', () => {
    const score = computeDataCompleteness(fullCompleteness);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns less than 1.0 for incomplete service', () => {
    const score = computeDataCompleteness(minimalCompleteness);
    expect(score).toBeLessThan(1.0);
  });

  it('returns a higher score when more optional fields are present', () => {
    const withOptional = computeDataCompleteness({ ...fullCompleteness, hasUrl: true });
    const withoutOptional = computeDataCompleteness({ ...fullCompleteness, hasUrl: false, hasEmail: false, hasFees: false });
    expect(withOptional).toBeGreaterThanOrEqual(withoutOptional);
  });
});

// ============================================================
// computeVerificationRecency
// ============================================================

describe('computeVerificationRecency', () => {
  it('returns 1.0 for recently verified (< 30 days)', () => {
    expect(computeVerificationRecency(recentDate)).toBe(1.0);
  });

  it('returns 0.0 for never verified (null)', () => {
    expect(computeVerificationRecency(null)).toBe(0.0);
  });

  it('returns 0.0 for stale record (> 730 days)', () => {
    const veryStaleDate = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    expect(computeVerificationRecency(veryStaleDate)).toBe(0.0);
  });

  it('returns a lower score for older verification', () => {
    const midDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // ~6.5 months
    expect(computeVerificationRecency(recentDate)).toBeGreaterThan(computeVerificationRecency(midDate));
  });
});

// ============================================================
// computeCommunityFeedback
// ============================================================

describe('computeCommunityFeedback', () => {
  it('returns 0.5 (neutral) when feedback count is below threshold', () => {
    expect(computeCommunityFeedback(2, 5.0, 1.0)).toBe(0.5);
  });

  it('returns 0.5 (neutral) when no feedback at all', () => {
    expect(computeCommunityFeedback(undefined, undefined, undefined)).toBe(0.5);
  });

  it('returns high score for excellent feedback', () => {
    const score = computeCommunityFeedback(10, 5.0, 1.0);
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns low score for poor feedback', () => {
    const score = computeCommunityFeedback(10, 1.0, 0.0);
    expect(score).toBeLessThan(0.3);
  });
});

// ============================================================
// computePenalties
// ============================================================

describe('computePenalties', () => {
  it('returns 0 when no penalties apply', () => {
    expect(computePenalties({})).toBe(0);
  });

  it('reduces score for bounced contact', () => {
    const penalty = computePenalties({ contactBounced: true });
    expect(penalty).toBeLessThan(0);
    expect(penalty).toBe(-0.20);
  });

  it('reduces score for unresolved flags', () => {
    const penalty = computePenalties({ openFlagCount: 2 });
    expect(penalty).toBe(-0.20); // 2 × -0.10
  });

  it('caps staleness penalty at max', () => {
    const penalty = computePenalties({ daysPastDue: 999 });
    expect(penalty).toBeGreaterThanOrEqual(-0.30); // max staleness penalty
  });

  it('accumulates multiple penalties', () => {
    const single = computePenalties({ contactBounced: true });
    const multiple = computePenalties({ contactBounced: true, openFlagCount: 1 });
    expect(multiple).toBeLessThan(single);
  });
});

// ============================================================
// getBand
// ============================================================

describe('getBand', () => {
  it('returns HIGH for score >= 0.75', () => {
    expect(getBand(0.75)).toBe('HIGH');
    expect(getBand(1.00)).toBe('HIGH');
    expect(getBand(0.80)).toBe('HIGH');
  });

  it('returns MEDIUM for score 0.50–0.74', () => {
    expect(getBand(0.50)).toBe('MEDIUM');
    expect(getBand(0.74)).toBe('MEDIUM');
    expect(getBand(0.60)).toBe('MEDIUM');
  });

  it('returns LOW for score 0.25–0.49', () => {
    expect(getBand(0.25)).toBe('LOW');
    expect(getBand(0.49)).toBe('LOW');
    expect(getBand(0.35)).toBe('LOW');
  });

  it('returns UNVERIFIED for score < 0.25', () => {
    expect(getBand(0.00)).toBe('UNVERIFIED');
    expect(getBand(0.24)).toBe('UNVERIFIED');
    expect(getBand(0.10)).toBe('UNVERIFIED');
  });
});

// ============================================================
// ConfidenceScorer class
// ============================================================

describe('ConfidenceScorer class', () => {
  const scorer = new ConfidenceScorer();

  it('computeScore delegates to function correctly', () => {
    const result = scorer.computeScore('svc-1', { completeness: fullCompleteness, evidence: fullEvidence });
    expect(result.score).toBeGreaterThan(0);
    expect(result.serviceId).toBe('svc-1');
  });

  it('applyPenalties reduces score', () => {
    const base = 0.80;
    const penalized = scorer.applyPenalties(base, { contactBounced: true });
    expect(penalized).toBeLessThan(base);
  });

  it('applyPenalties clamps to 0', () => {
    const penalized = scorer.applyPenalties(0.05, { contactBounced: true, openFlagCount: 3 });
    expect(penalized).toBeGreaterThanOrEqual(0);
  });

  it('getBand returns the correct band', () => {
    expect(scorer.getBand(0.80)).toBe('HIGH');
    expect(scorer.getBand(0.60)).toBe('MEDIUM');
    expect(scorer.getBand(0.30)).toBe('LOW');
    expect(scorer.getBand(0.10)).toBe('UNVERIFIED');
  });
});

// ============================================================
// Staleness effect on score
// ============================================================

describe('Staleness effect', () => {
  it('stale service scores lower than recently verified', () => {
    const freshEvidence: ServiceEvidence = { ...fullEvidence, lastVerifiedAt: recentDate };
    const staleEvidence: ServiceEvidence = { ...fullEvidence, lastVerifiedAt: staleDate };

    const fresh = computeScore('fresh', { completeness: fullCompleteness, evidence: freshEvidence });
    const stale = computeScore('stale', { completeness: fullCompleteness, evidence: staleEvidence });

    expect(fresh.score).toBeGreaterThan(stale.score);
  });
});
