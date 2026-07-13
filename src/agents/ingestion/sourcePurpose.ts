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

export interface StandaloneResourceUseDecision {
  allowed: boolean;
  purpose: SourceResourcePurpose;
  reason: string;
}

export function evaluateStandaloneResourceUse(source: {
  resourcePurpose?: unknown;
}): StandaloneResourceUseDecision {
  const parsedPurpose = SourceResourcePurposeSchema.safeParse(source.resourcePurpose);
  const purpose = parsedPurpose.success ? parsedPurpose.data : 'service_catalog';

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
