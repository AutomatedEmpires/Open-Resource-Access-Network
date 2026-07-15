import { z } from 'zod';

/**
 * Describes how ORAN may use data from a source.
 *
 * Trust answers "how much do we trust this publisher?" while purpose answers
 * "is this source capable of producing a seeker-facing resource at all?".
 */
export const SourceResourcePurposeSchema = z.enum([
  'service_catalog',
  'program_navigation',
  'supporting_reference',
  'excluded',
]);

export type SourceResourcePurpose = z.infer<typeof SourceResourcePurposeSchema>;
export type EvaluatedSourceResourcePurpose = SourceResourcePurpose | 'unclassified';

export interface StandaloneResourceUseDecision {
  allowed: boolean;
  purpose: EvaluatedSourceResourcePurpose;
  reason: string;
}

export function evaluateStandaloneResourceUse(source?: {
  resourcePurpose?: unknown;
} | null): StandaloneResourceUseDecision {
  const parsedPurpose = SourceResourcePurposeSchema.safeParse(source?.resourcePurpose);

  // Purpose is an explicit publication classification, not a compatibility
  // default. Missing and malformed values must remain visible as unclassified
  // and fail closed until an operator assigns a supported purpose.
  if (!parsedPurpose.success) {
    return {
      allowed: false,
      purpose: 'unclassified',
      reason: 'source resource purpose is missing or invalid; classify it before seeker publication',
    };
  }

  const purpose = parsedPurpose.data;

  if (purpose === 'supporting_reference') {
    return {
      allowed: false,
      purpose,
      reason: 'supporting_reference sources may enrich services but cannot become standalone seeker resources',
    };
  }

  if (purpose === 'excluded') {
    return {
      allowed: false,
      purpose,
      reason: 'excluded sources cannot become seeker-facing resources',
    };
  }

  return {
    allowed: true,
    purpose,
    reason: purpose === 'program_navigation'
      ? 'official program navigation is eligible for seeker-facing publication'
      : 'direct service catalog is eligible for seeker-facing publication',
  };
}
