import type { VerificationCheckResult } from './contracts';

export type ConfidenceInputs = {
  sourceAllowlisted: boolean;
  requiredFieldsPresent: boolean;
  verificationChecks: VerificationCheckResult[];
  hasEvidenceSnapshot: boolean;
};

function clamp0to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function computeConfidenceScore(inputs: ConfidenceInputs): number {
  let score = 0;

  if (inputs.hasEvidenceSnapshot) score += 20;
  if (inputs.sourceAllowlisted) score += 20;
  if (inputs.requiredFieldsPresent) score += 20;

  for (const check of inputs.verificationChecks) {
    const weight = check.severity === 'critical' ? 20 : check.severity === 'warning' ? 10 : 4;

    if (check.status === 'pass') score += weight;
    if (check.status === 'fail') score -= weight;
  }

  return clamp0to100(score);
}

export function hasFailingCriticalChecks(checks: VerificationCheckResult[]): boolean {
  return checks.some((c) => c.severity === 'critical' && c.status === 'fail');
}
