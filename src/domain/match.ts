/**
 * Shared confidence-band and match-score math for seeker surfaces.
 *
 * There must be exactly ONE formula for the seeker-facing match score. Before
 * this module existed the service detail page averaged eligibility/constraint
 * while ServiceCard used the weighted formula, so a single record could show
 * two different match bands on the same page — and pg NUMERIC values arriving
 * as strings made the average render as "Overall score: NaN" in production.
 */

import type { ConfidenceBand, EnrichedService } from '@/domain/types';
import { CONFIDENCE_BANDS, ORAN_CONFIDENCE_WEIGHTS } from '@/domain/constants';

/** pg NUMERIC serializes as a JSON string; older stored snapshots may still
 * carry strings, so presentation math coerces defensively. */
function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function getConfidenceBand(score?: number | string | null): ConfidenceBand {
  const value = toFiniteNumber(score);
  if (value == null) return 'POSSIBLE';
  if (value >= CONFIDENCE_BANDS.HIGH.min) return 'HIGH';
  if (value >= CONFIDENCE_BANDS.LIKELY.min) return 'LIKELY';
  return 'POSSIBLE';
}

/**
 * Canonical seeker-facing match score: the eligibility/constraint components
 * of the confidence record combined with their ORAN_CONFIDENCE_WEIGHTS,
 * normalized to 0-100. Returns null when the record carries no usable
 * confidence data.
 */
export function computeMatchScore(
  confidence?: EnrichedService['confidenceScore'] | null,
): number | null {
  if (!confidence) return null;

  const eligibility = toFiniteNumber(confidence.eligibilityMatch);
  const constraint = toFiniteNumber(confidence.constraintFit);
  if (eligibility == null || constraint == null) return null;

  const matchWeightSum = ORAN_CONFIDENCE_WEIGHTS.eligibility + ORAN_CONFIDENCE_WEIGHTS.constraint;
  if (matchWeightSum <= 0) return null;

  const score =
    (ORAN_CONFIDENCE_WEIGHTS.eligibility * eligibility +
      ORAN_CONFIDENCE_WEIGHTS.constraint * constraint) /
    matchWeightSum;

  return Math.max(0, Math.min(100, score));
}
