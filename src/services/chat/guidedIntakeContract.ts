import { z } from 'zod';

const APPROXIMATE_LOCATION_PATTERN = /^(?:\d{5}(?:-\d{4})?|[\p{L}][\p{L}\s.'-]{0,59}(?:,\s*[A-Za-z]{2})?)$/u;
const STREET_LEVEL_SUFFIX_PATTERN = /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|highway|hwy|route|parkway|pkwy|circle|terrace|suite|unit|apartment|apt)\.?$/i;

const ApproximateLocationTextSchema = z.string().trim().min(1).max(80)
  .regex(
    APPROXIMATE_LOCATION_PATTERN,
    'Use a city, City, ST, or 5-digit ZIP code.',
  )
  .refine(
    (location) => !STREET_LEVEL_SUFFIX_PATTERN.test(
      location.replace(/,\s*[A-Za-z]{2}$/, '').trim(),
    ),
    'Use a city, City, ST, or 5-digit ZIP code, not a street address.',
  )
  .refine(
    (location) => location.includes(',') || !/\s[A-Z]{2}$/i.test(location),
    'Put a comma before a 2-letter state code, for example Detroit, MI.',
  );

export const GuidedIntakeRequestSchema = z.object({
  searchText: z.string().trim().min(1).max(500).refine(
    (value) => /[\p{L}\p{N}]/u.test(value),
    'Describe the need with at least one letter or number.',
  ),
  location: ApproximateLocationTextSchema.optional(),
  urgency: z.enum(['today', 'within_days', 'planning']).optional(),
  audience: z.enum(['self', 'child', 'family', 'someone_else']).optional(),
  accessMode: z.enum(['can_travel', 'cannot_travel', 'phone', 'online']).optional(),
}).strict();

export type GuidedIntakeRequest = z.infer<typeof GuidedIntakeRequestSchema>;
