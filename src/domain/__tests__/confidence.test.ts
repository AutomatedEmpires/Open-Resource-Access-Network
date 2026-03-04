import { describe, expect, it } from 'vitest';
import {
  canAutoApprove,
  clamp0to100,
  CONFIDENCE_THRESHOLDS,
  formatConfidencePercent,
  formatConfidenceWithTier,
  getBandDisplayInfo,
  getConfidenceBand,
  getConfidenceTier,
  getReviewSlaHours,
  getReverifyCadenceDays,
  getTierDisplayInfo,
  isPublishReady,
  isValidConfidence,
  normalizeConfidence,
  requiresReview,
} from '../confidence';

describe('normalizeConfidence', () => {
  it('normalizes supported input formats into 0-100 integers', () => {
    expect(normalizeConfidence(undefined)).toBe(0);
    expect(normalizeConfidence(null)).toBe(0);
    expect(normalizeConfidence(Number.NaN)).toBe(0);
    expect(normalizeConfidence('not-a-number')).toBe(0);
    expect(normalizeConfidence(0.853)).toBe(85);
    expect(normalizeConfidence('0.755')).toBe(76);
    expect(normalizeConfidence(1)).toBe(100);
    expect(normalizeConfidence(84.6)).toBe(85);
    expect(normalizeConfidence(140)).toBe(100);
    expect(normalizeConfidence(-8)).toBe(0);
  });
});

describe('confidence thresholds and validation', () => {
  it('clamps and validates scores', () => {
    expect(clamp0to100(84.6)).toBe(85);
    expect(clamp0to100(-10)).toBe(0);
    expect(clamp0to100(120)).toBe(100);

    expect(isValidConfidence(0)).toBe(true);
    expect(isValidConfidence(100)).toBe(true);
    expect(isValidConfidence(50.5)).toBe(true);
    expect(isValidConfidence(-1)).toBe(false);
    expect(isValidConfidence(101)).toBe(false);
    expect(isValidConfidence('50')).toBe(false);
  });

  it('maps scores to tiers and bands at the threshold boundaries', () => {
    expect(getConfidenceTier(CONFIDENCE_THRESHOLDS.GREEN)).toBe('green');
    expect(getConfidenceTier(CONFIDENCE_THRESHOLDS.YELLOW)).toBe('yellow');
    expect(getConfidenceTier(CONFIDENCE_THRESHOLDS.ORANGE)).toBe('orange');
    expect(getConfidenceTier(CONFIDENCE_THRESHOLDS.ORANGE - 1)).toBe('red');

    expect(getConfidenceBand(CONFIDENCE_THRESHOLDS.GREEN)).toBe('HIGH');
    expect(getConfidenceBand(CONFIDENCE_THRESHOLDS.YELLOW)).toBe('LIKELY');
    expect(getConfidenceBand(CONFIDENCE_THRESHOLDS.YELLOW - 1)).toBe('POSSIBLE');
  });
});

describe('display helpers', () => {
  it('returns stable metadata for tiers and bands', () => {
    expect(getTierDisplayInfo('green')).toEqual({
      label: 'Ready',
      description: 'Sufficient verification for publication',
      color: '#22c55e',
      textColor: '#ffffff',
    });

    expect(getTierDisplayInfo('yellow').label).toBe('Review');
    expect(getTierDisplayInfo('orange').label).toBe('Attention');
    expect(getTierDisplayInfo('red').label).toBe('Incomplete');

    expect(getBandDisplayInfo('HIGH').label).toBe('High confidence');
    expect(getBandDisplayInfo('LIKELY').description).toContain('Confirm');
    expect(getBandDisplayInfo('POSSIBLE').description).toContain('verify');
  });
});

describe('workflow decisions and formatting', () => {
  it('derives workflow flags from the same threshold rules', () => {
    expect(canAutoApprove(CONFIDENCE_THRESHOLDS.GREEN)).toBe(true);
    expect(canAutoApprove(CONFIDENCE_THRESHOLDS.GREEN - 1)).toBe(false);

    expect(requiresReview(CONFIDENCE_THRESHOLDS.GREEN)).toBe(false);
    expect(requiresReview(CONFIDENCE_THRESHOLDS.GREEN - 1)).toBe(true);

    expect(isPublishReady(CONFIDENCE_THRESHOLDS.YELLOW)).toBe(true);
    expect(isPublishReady(CONFIDENCE_THRESHOLDS.YELLOW - 1)).toBe(false);
  });

  it('calculates SLA and reverification cadence from the score tier', () => {
    expect(getReviewSlaHours(95)).toBe(168);
    expect(getReviewSlaHours(60)).toBe(72);
    expect(getReviewSlaHours(40)).toBe(48);
    expect(getReviewSlaHours(10)).toBe(24);

    expect(getReverifyCadenceDays(95)).toBe(180);
    expect(getReverifyCadenceDays(60)).toBe(90);
    expect(getReverifyCadenceDays(40)).toBe(30);
    expect(getReverifyCadenceDays(10)).toBe(14);
  });

  it('formats scores for display', () => {
    expect(formatConfidencePercent(84.6)).toBe('85%');
    expect(formatConfidenceWithTier(85)).toBe('85% (Ready)');
    expect(formatConfidenceWithTier(60)).toBe('60% (Review)');
  });
});
