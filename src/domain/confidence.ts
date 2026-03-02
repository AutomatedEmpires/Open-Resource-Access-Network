/**
 * ORAN Confidence Score Utilities
 *
 * Standardizes confidence scoring across all ORAN systems.
 * All confidence values in ORAN are 0-100 integers.
 *
 * This module provides:
 * - Type-safe confidence values
 * - Normalization from various input formats (0-1, 0-100, string)
 * - Tier calculation (green/yellow/orange/red or HIGH/LIKELY/POSSIBLE)
 * - Validation helpers
 */

// ============================================================
// TYPES
// ============================================================

/**
 * Confidence score: always 0-100 integer in ORAN.
 */
export type ConfidenceScore = number;

/**
 * Confidence tiers for admin/ingestion workflows.
 * Color-coded for visual clarity.
 */
export type ConfidenceTier = 'green' | 'yellow' | 'orange' | 'red';

/**
 * Confidence bands for seeker-facing displays.
 * Human-friendly labels.
 */
export type ConfidenceBand = 'HIGH' | 'LIKELY' | 'POSSIBLE';

// ============================================================
// THRESHOLDS (Single Source of Truth)
// ============================================================

/**
 * Threshold values for confidence tiers.
 * These are the canonical boundaries used everywhere.
 */
export const CONFIDENCE_THRESHOLDS = {
  GREEN: 80,   // Ready / High confidence
  YELLOW: 60,  // Review needed / Likely
  ORANGE: 40,  // Attention needed / Possible
  RED: 0,      // Insufficient / Needs work
} as const;

// ============================================================
// NORMALIZATION
// ============================================================

/**
 * Normalize any confidence input to 0-100 integer.
 *
 * Accepts:
 * - 0-1 floats (multiplied by 100)
 * - 0-100 integers (returned as-is)
 * - Strings that parse to numbers
 * - null/undefined (returns 0)
 *
 * @example
 * normalizeConfidence(0.85)    // → 85
 * normalizeConfidence(85)      // → 85
 * normalizeConfidence('0.75')  // → 75
 * normalizeConfidence(null)    // → 0
 */
export function normalizeConfidence(input: number | string | null | undefined): ConfidenceScore {
  if (input === null || input === undefined) {
    return 0;
  }

  const num = typeof input === 'string' ? parseFloat(input) : input;

  if (!Number.isFinite(num)) {
    return 0;
  }

  // If value is between 0 and 1 (exclusive of exact 1), treat as 0-1 scale
  // and multiply by 100. Exact 1 is ambiguous but we treat it as 100%.
  if (num > 0 && num < 1) {
    return clamp0to100(Math.round(num * 100));
  }

  // If value is exactly 1, it could be 0-1 scale (100%) or 0-100 scale (1%)
  // Convention: treat 1 as 100%
  if (num === 1) {
    return 100;
  }

  // Otherwise, treat as 0-100 scale
  return clamp0to100(Math.round(num));
}

/**
 * Clamp a number to 0-100 range.
 */
export function clamp0to100(value: number): ConfidenceScore {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Validate that a confidence score is in valid range.
 */
export function isValidConfidence(value: unknown): value is ConfidenceScore {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

// ============================================================
// TIER CALCULATION
// ============================================================

/**
 * Get confidence tier (green/yellow/orange/red) from score.
 *
 * @param score - Confidence score 0-100
 * @returns ConfidenceTier
 */
export function getConfidenceTier(score: ConfidenceScore): ConfidenceTier {
  if (score >= CONFIDENCE_THRESHOLDS.GREEN) return 'green';
  if (score >= CONFIDENCE_THRESHOLDS.YELLOW) return 'yellow';
  if (score >= CONFIDENCE_THRESHOLDS.ORANGE) return 'orange';
  return 'red';
}

/**
 * Get confidence band (HIGH/LIKELY/POSSIBLE) from score.
 * Used for seeker-facing displays.
 *
 * @param score - Confidence score 0-100
 * @returns ConfidenceBand
 */
export function getConfidenceBand(score: ConfidenceScore): ConfidenceBand {
  if (score >= CONFIDENCE_THRESHOLDS.GREEN) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.YELLOW) return 'LIKELY';
  return 'POSSIBLE';
}

// ============================================================
// TIER DISPLAY INFO
// ============================================================

export interface TierDisplayInfo {
  label: string;
  description: string;
  color: string;
  textColor: string;
}

/**
 * Get display information for a confidence tier.
 */
export function getTierDisplayInfo(tier: ConfidenceTier): TierDisplayInfo {
  switch (tier) {
    case 'green':
      return {
        label: 'Ready',
        description: 'Sufficient verification for publication',
        color: '#22c55e', // green-500
        textColor: '#ffffff',
      };
    case 'yellow':
      return {
        label: 'Review',
        description: 'Likely good, awaiting review',
        color: '#eab308', // yellow-500
        textColor: '#000000',
      };
    case 'orange':
      return {
        label: 'Attention',
        description: 'Needs additional verification',
        color: '#f97316', // orange-500
        textColor: '#000000',
      };
    case 'red':
      return {
        label: 'Incomplete',
        description: 'Insufficient data for publication',
        color: '#ef4444', // red-500
        textColor: '#ffffff',
      };
  }
}

/**
 * Get display information for a confidence band.
 */
export function getBandDisplayInfo(band: ConfidenceBand): TierDisplayInfo {
  switch (band) {
    case 'HIGH':
      return {
        label: 'High confidence',
        description: 'Well-verified service information',
        color: '#22c55e',
        textColor: '#ffffff',
      };
    case 'LIKELY':
      return {
        label: 'Likely',
        description: 'Confirm hours/eligibility before visiting',
        color: '#eab308',
        textColor: '#000000',
      };
    case 'POSSIBLE':
      return {
        label: 'Possible',
        description: 'Contact provider to verify details',
        color: '#f97316',
        textColor: '#000000',
      };
  }
}

// ============================================================
// AUTO-APPROVE LOGIC
// ============================================================

/**
 * Check if a confidence score qualifies for auto-approval.
 * Only green tier (≥80) can be auto-approved.
 */
export function canAutoApprove(score: ConfidenceScore): boolean {
  return score >= CONFIDENCE_THRESHOLDS.GREEN;
}

/**
 * Check if a confidence score requires human review.
 * Anything below green tier needs review.
 */
export function requiresReview(score: ConfidenceScore): boolean {
  return score < CONFIDENCE_THRESHOLDS.GREEN;
}

/**
 * Check if a confidence score is ready for publish.
 * Minimum is yellow tier (≥60).
 */
export function isPublishReady(score: ConfidenceScore): boolean {
  return score >= CONFIDENCE_THRESHOLDS.YELLOW;
}

// ============================================================
// SLA CALCULATION
// ============================================================

/**
 * Calculate review SLA hours based on confidence tier.
 * Lower confidence = faster required response.
 */
export function getReviewSlaHours(score: ConfidenceScore): number {
  const tier = getConfidenceTier(score);
  switch (tier) {
    case 'green':
      return 168; // 7 days (lower priority)
    case 'yellow':
      return 72;  // 3 days
    case 'orange':
      return 48;  // 2 days
    case 'red':
      return 24;  // 1 day (urgent)
  }
}

/**
 * Calculate reverification cadence in days.
 * Lower confidence = more frequent re-checks.
 */
export function getReverifyCadenceDays(score: ConfidenceScore): number {
  const tier = getConfidenceTier(score);
  switch (tier) {
    case 'green':
      return 180; // 6 months
    case 'yellow':
      return 90;  // 3 months
    case 'orange':
      return 30;  // 1 month
    case 'red':
      return 14;  // 2 weeks
  }
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Format confidence score as percentage string.
 */
export function formatConfidencePercent(score: ConfidenceScore): string {
  return `${Math.round(score)}%`;
}

/**
 * Format confidence with tier label.
 */
export function formatConfidenceWithTier(score: ConfidenceScore): string {
  const tier = getConfidenceTier(score);
  const { label } = getTierDisplayInfo(tier);
  return `${score}% (${label})`;
}
