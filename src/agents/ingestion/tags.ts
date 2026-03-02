/**
 * Resource tagging system.
 *
 * Tags categorize candidates/services by:
 * - Category (food, housing, healthcare, etc.)
 * - Geographic area (kootenai_county, idaho, 83814, etc.)
 * - Audience (veteran, senior, family, etc.)
 * - Verification status (what's missing, what's done)
 * - Program (SNAP, WIC, Section 8, etc.)
 * - Source quality (gov_source, edu_source, quarantine_source)
 *
 * Tags drive admin routing, search faceting, and confidence scoring.
 */
import { z } from 'zod';

export const ResourceTagTypeSchema = z.enum([
  'category',             // food, housing, healthcare, legal, employment, etc.
  'geographic',           // US state, county, city, ZIP, etc.
  'audience',             // veteran, senior, family, youth, disabled, immigrant, etc.
  'verification_missing', // missing_phone, missing_hours, missing_address, etc.
  'verification_status',  // verified, pending, escalated, needs_review
  'program',              // snap, wic, section8, medicaid, medicare, tanf, etc.
  'source_quality',       // gov_source, edu_source, mil_source, quarantine_source
  'custom',
]);
export type ResourceTagType = z.infer<typeof ResourceTagTypeSchema>;

export const TagAssignedBySchema = z.enum(['system', 'agent', 'human']);
export type TagAssignedBy = z.infer<typeof TagAssignedBySchema>;

export const ResourceTagSchema = z
  .object({
    id: z.string().uuid().optional(),

    // Attach to candidate OR service (one required)
    candidateId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),

    tagType: ResourceTagTypeSchema,
    tagValue: z.string().min(1).transform((v) => v.toLowerCase().trim()),
    displayLabel: z.string().min(1).optional(),

    // Confidence in this tag (0-100)
    tagConfidence: z.number().int().min(0).max(100).default(100),

    // Who assigned it
    assignedBy: TagAssignedBySchema.default('system'),
    assignedByUserId: z.string().min(1).optional(),

    // Evidence supporting this tag
    evidenceRefs: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((t) => t.candidateId || t.serviceId, {
    message: 'Either candidateId or serviceId must be provided',
  });
export type ResourceTag = z.infer<typeof ResourceTagSchema>;

// ============================================================
// PREDEFINED TAG VALUES (for consistency)
// ============================================================

/**
 * Standard category tags matching ORAN taxonomy top-level categories.
 */
export const CATEGORY_TAGS = [
  'food',
  'housing',
  'healthcare',
  'mental_health',
  'substance_use',
  'legal',
  'employment',
  'education',
  'transportation',
  'utilities',
  'financial',
  'childcare',
  'disability',
  'domestic_violence',
  'immigration',
  'reentry',
  'seniors',
  'youth',
  'crisis',
  'other',
] as const;
export type CategoryTag = (typeof CATEGORY_TAGS)[number];

/**
 * Standard audience tags (self-identified populations).
 */
export const AUDIENCE_TAGS = [
  'veteran',
  'senior',
  'family',
  'youth',
  'disabled',
  'immigrant',
  'refugee',
  'homeless',
  'lgbtq',
  'pregnant',
  'single_parent',
  'low_income',
  'unemployed',
  'student',
  'tribal',
  'rural',
  'reentry',
] as const;
export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

/**
 * Standard program tags (public benefit programs).
 */
export const PROGRAM_TAGS = [
  'snap',             // Supplemental Nutrition Assistance
  'wic',              // Women, Infants, Children
  'tanf',             // Temporary Assistance for Needy Families
  'medicaid',
  'medicare',
  'section8',         // Housing Choice Voucher
  'liheap',           // Low Income Home Energy Assistance
  'ssi',              // Supplemental Security Income
  'ssdi',             // Social Security Disability Insurance
  'chip',             // Children's Health Insurance Program
  'head_start',
  'va_benefits',
  'snap_et',          // SNAP Employment & Training
  'free_lunch',       // National School Lunch Program
  'pell_grant',
] as const;
export type ProgramTag = (typeof PROGRAM_TAGS)[number];

/**
 * Verification-missing tags (what's still needed).
 */
export const VERIFICATION_MISSING_TAGS = [
  'missing_phone',
  'missing_address',
  'missing_hours',
  'missing_eligibility',
  'missing_service_area',
  'missing_description',
  'missing_provenance',
  'needs_duplication_review',
  'needs_policy_review',
  'needs_geocoding',
] as const;
export type VerificationMissingTag = (typeof VERIFICATION_MISSING_TAGS)[number];

/**
 * Source quality tags.
 */
export const SOURCE_QUALITY_TAGS = [
  'gov_source',       // .gov domain
  'edu_source',       // .edu domain
  'mil_source',       // .mil domain
  'partner_feed',     // Official partner data
  'quarantine_source', // Domain not yet fully trusted
  'manual_entry',     // Human-submitted
] as const;
export type SourceQualityTag = (typeof SOURCE_QUALITY_TAGS)[number];

// ============================================================
// TAG HELPERS
// ============================================================

/**
 * Create a geographic tag from jurisdiction components.
 * Format: us_wa_king_seattle or us_wa_king or us_wa
 */
export function createGeographicTag(
  state?: string,
  county?: string,
  city?: string,
  country: string = 'US'
): string {
  const parts = [country.toLowerCase()];
  if (state) parts.push(state.toLowerCase().replace(/\s+/g, '_'));
  if (county) parts.push(county.toLowerCase().replace(/\s+/g, '_'));
  if (city) parts.push(city.toLowerCase().replace(/\s+/g, '_'));
  return parts.join('_');
}

/**
 * Parse a geographic tag back into components.
 */
export function parseGeographicTag(tag: string): {
  country: string;
  state?: string;
  county?: string;
  city?: string;
} {
  const parts = tag.split('_');
  return {
    country: parts[0]?.toUpperCase() ?? 'US',
    state: parts[1]?.toUpperCase(),
    county: parts[2],
    city: parts[3],
  };
}

/**
 * Create a composite display label for an area.
 * "Kootenai County, Idaho" or "Seattle, King County, Washington"
 */
export function formatGeographicLabel(
  state?: string,
  county?: string,
  city?: string
): string {
  const parts: string[] = [];
  if (city) parts.push(city);
  if (county) parts.push(`${county} County`);
  if (state) parts.push(state);
  return parts.join(', ') || 'Nationwide';
}

/**
 * Derive source quality tag from a domain.
 */
export function deriveSourceQualityTag(hostname: string): SourceQualityTag {
  const h = hostname.toLowerCase();
  if (h.endsWith('.gov')) return 'gov_source';
  if (h.endsWith('.edu')) return 'edu_source';
  if (h.endsWith('.mil')) return 'mil_source';
  return 'quarantine_source';
}

/**
 * Build verification-missing tags from a checklist.
 */
export function buildVerificationMissingTags(
  checklist: Array<{ key: string; status: string; required: boolean }>
): VerificationMissingTag[] {
  const tags: VerificationMissingTag[] = [];

  for (const item of checklist) {
    if (item.required && item.status === 'missing') {
      switch (item.key) {
        case 'contact_method':
          tags.push('missing_phone');
          break;
        case 'physical_address_or_virtual':
          tags.push('missing_address');
          break;
        case 'service_area':
          tags.push('missing_service_area');
          break;
        case 'eligibility_criteria':
          tags.push('missing_eligibility');
          break;
        case 'hours':
          tags.push('missing_hours');
          break;
        case 'source_provenance':
          tags.push('missing_provenance');
          break;
        case 'duplication_review':
          tags.push('needs_duplication_review');
          break;
        case 'policy_pass':
          tags.push('needs_policy_review');
          break;
      }
    }
  }

  return tags;
}

