import type { VerificationCheckResult } from './contracts';
import type { VerificationChecklist } from './checklist';

// ============================================================
// CONFIDENCE TIERS (color-coded status)
// ============================================================

export type ConfidenceTier = 'green' | 'yellow' | 'orange' | 'red';

export const CONFIDENCE_TIER_THRESHOLDS = {
  green: 80,   // Ready to publish
  yellow: 60,  // Likely good, needs review
  orange: 40,  // Possible, needs attention
  red: 0,      // Insufficient, needs work
} as const;

export function getConfidenceTier(score: number): ConfidenceTier {
  if (score >= CONFIDENCE_TIER_THRESHOLDS.green) return 'green';
  if (score >= CONFIDENCE_TIER_THRESHOLDS.yellow) return 'yellow';
  if (score >= CONFIDENCE_TIER_THRESHOLDS.orange) return 'orange';
  return 'red';
}

export function getTierDisplayInfo(tier: ConfidenceTier): {
  label: string;
  description: string;
  color: string;
} {
  switch (tier) {
    case 'green':
      return {
        label: 'Ready',
        description: 'Sufficient verification for publication',
        color: '#22c55e',
      };
    case 'yellow':
      return {
        label: 'Review',
        description: 'Likely good, awaiting review',
        color: '#eab308',
      };
    case 'orange':
      return {
        label: 'Attention',
        description: 'Needs additional verification',
        color: '#f97316',
      };
    case 'red':
      return {
        label: 'Incomplete',
        description: 'Insufficient data for publication',
        color: '#ef4444',
      };
  }
}

// ============================================================
// CONFIDENCE SCORE CALCULATION
// ============================================================

export type ConfidenceInputs = {
  sourceAllowlisted: boolean;
  requiredFieldsPresent: boolean;
  verificationChecks: VerificationCheckResult[];
  hasEvidenceSnapshot: boolean;
  checklist?: VerificationChecklist;
};

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Compute confidence score (0-100) from verification inputs.
 *
 * Scoring breakdown:
 * - Evidence snapshot exists: +20
 * - Source is allowlisted: +20
 * - Required fields present: +20
 * - Verification checks: variable (critical=20, warning=10, info=4)
 * - Checklist completion: up to +20
 *
 * The score determines the confidence tier (color-coded status).
 */
export function computeConfidenceScore(inputs: ConfidenceInputs): number {
  let score = 0;

  // Base points
  if (inputs.hasEvidenceSnapshot) score += 20;
  if (inputs.sourceAllowlisted) score += 20;
  if (inputs.requiredFieldsPresent) score += 20;

  // Verification check points
  for (const check of inputs.verificationChecks) {
    const weight = check.severity === 'critical' ? 20 : check.severity === 'warning' ? 10 : 4;

    if (check.status === 'pass') score += weight;
    if (check.status === 'fail') score -= weight;
    // 'unknown' adds nothing
  }

  // Checklist completion bonus (up to +20)
  if (inputs.checklist && inputs.checklist.length > 0) {
    const required = inputs.checklist.filter((i) => i.required);
    const satisfied = required.filter((i) => i.status === 'satisfied');
    if (required.length > 0) {
      const checklistRatio = satisfied.length / required.length;
      score += Math.round(checklistRatio * 20);
    }
  }

  return clamp0to100(score);
}

/**
 * Compute detailed score breakdown for UI display.
 */
export function computeScoreBreakdown(inputs: ConfidenceInputs): {
  score: number;
  tier: ConfidenceTier;
  breakdown: Array<{ label: string; points: number; max: number }>;
} {
  const breakdown: Array<{ label: string; points: number; max: number }> = [];

  breakdown.push({
    label: 'Evidence snapshot',
    points: inputs.hasEvidenceSnapshot ? 20 : 0,
    max: 20,
  });

  breakdown.push({
    label: 'Allowlisted source',
    points: inputs.sourceAllowlisted ? 20 : 0,
    max: 20,
  });

  breakdown.push({
    label: 'Required fields',
    points: inputs.requiredFieldsPresent ? 20 : 0,
    max: 20,
  });

  // Verification checks
  let checkPoints = 0;
  let checkMax = 0;
  for (const check of inputs.verificationChecks) {
    const weight = check.severity === 'critical' ? 20 : check.severity === 'warning' ? 10 : 4;
    checkMax += weight;
    if (check.status === 'pass') checkPoints += weight;
  }
  breakdown.push({
    label: 'Verification checks',
    points: Math.max(0, checkPoints),
    max: checkMax || 40, // Default max if no checks
  });

  // Checklist
  if (inputs.checklist && inputs.checklist.length > 0) {
    const required = inputs.checklist.filter((i) => i.required);
    const satisfied = required.filter((i) => i.status === 'satisfied');
    const ratio = required.length > 0 ? satisfied.length / required.length : 1;
    breakdown.push({
      label: 'Checklist completion',
      points: Math.round(ratio * 20),
      max: 20,
    });
  }

  const score = computeConfidenceScore(inputs);

  return {
    score,
    tier: getConfidenceTier(score),
    breakdown,
  };
}

export function hasFailingCriticalChecks(checks: VerificationCheckResult[]): boolean {
  return checks.some((c) => c.severity === 'critical' && c.status === 'fail');
}

/**
 * Check if a candidate is ready for publish (green tier + no critical failures).
 */
export function isReadyForPublish(
  score: number,
  checks: VerificationCheckResult[]
): boolean {
  return getConfidenceTier(score) === 'green' && !hasFailingCriticalChecks(checks);
}

/**
 * Compute reverification cadence based on confidence score.
 */
export function computeReverifyCadenceDays(score: number): number {
  const tier = getConfidenceTier(score);
  switch (tier) {
    case 'green':
      return 180; // 6 months
    case 'yellow':
      return 90;  // 3 months
    case 'orange':
      return 30;  // 1 month
    case 'red':
      return 14;  // 2 weeks (or keep in review)
  }
}

/**
 * Compute review SLA based on confidence score.
 */
export function computeReviewSlaHours(score: number, hasCriticalFailure: boolean): number {
  if (hasCriticalFailure) return 24;

  const tier = getConfidenceTier(score);
  switch (tier) {
    case 'green':
      return 168; // 7 days (lower priority)
    case 'yellow':
      return 72;  // 3 days
    case 'orange':
      return 48;  // 2 days
    case 'red':
      return 168; // 7 days (may need more work first)
  }
}
