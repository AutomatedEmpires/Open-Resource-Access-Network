/**
 * LLM Extraction Types
 *
 * Types for the LLM extraction pipeline that converts raw HTML/text
 * into structured service data following HSDS conventions.
 */

import { z } from 'zod';

import { CATEGORY_TAGS } from '../tags';

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

/**
 * Field-level confidence from LLM extraction.
 * LLM reports certainty per field, mapped to 0-100 scale.
 */
export const FieldConfidenceSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().nullable().optional(),
  sourceSnippet: z.string().nullable().optional(),
});
export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>;

// ---------------------------------------------------------------------------
// Extraction Response
// ---------------------------------------------------------------------------

/**
 * A single phone number extracted by LLM.
 */
export const ExtractedPhoneSchema = z.object({
  number: z.string(),
  type: z.enum(['voice', 'fax', 'tty', 'hotline', 'sms', 'unknown']).default('voice'),
  context: z.string().nullable().optional(),
});
export type ExtractedPhone = z.infer<typeof ExtractedPhoneSchema>;

/**
 * A physical address extracted by LLM.
 */
export const ExtractedAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable().optional(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string().default('US'),
});
export type ExtractedAddress = z.infer<typeof ExtractedAddressSchema>;

/**
 * Operating hours extracted by LLM.
 */
export const ExtractedHoursSchema = z.object({
  dayOfWeek: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  opensAt: z.string().nullable().optional(), // HH:MM format
  closesAt: z.string().nullable().optional(), // HH:MM format
  is24Hours: z.boolean().default(false),
  isClosed: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});
export type ExtractedHours = z.infer<typeof ExtractedHoursSchema>;

/**
 * Eligibility criteria extracted by LLM.
 */
export const ExtractedEligibilitySchema = z.object({
  description: z.string(),
  ageMin: z.number().int().min(0).nullable().optional(),
  ageMax: z.number().int().min(0).nullable().optional(),
  incomeRequirement: z.string().nullable().optional(),
  residencyRequirement: z.string().nullable().optional(),
  documentationRequired: z.array(z.string()).default([]),
  restrictions: z.array(z.string()).default([]),
});
export type ExtractedEligibility = z.infer<typeof ExtractedEligibilitySchema>;

/**
 * A single service extracted from a page.
 * One page may contain multiple services.
 */
export const ExtractedServiceSchema = z.object({
  organizationName: z.string(),
  serviceName: z.string(),
  description: z.string(),
  category: z.string().nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  phones: z.array(ExtractedPhoneSchema).default([]),
  email: z.string().email().nullable().optional(),
  address: ExtractedAddressSchema.nullable().optional(),
  hours: z.array(ExtractedHoursSchema).default([]),
  eligibility: ExtractedEligibilitySchema.nullable().optional(),
  applicationProcess: z.string().nullable().optional(),
  fees: z.string().nullable().optional(),
  languages: z.array(z.string()).default([]),
  isRemoteService: z.boolean().default(false),
  serviceAreaDescription: z.string().nullable().optional(),
});
export type ExtractedService = z.infer<typeof ExtractedServiceSchema>;

/**
 * Field confidence scores for an extracted service.
 * Keys match ExtractedService field names.
 */
export const ServiceFieldConfidencesSchema = z.object({
  organizationName: FieldConfidenceSchema.optional(),
  serviceName: FieldConfidenceSchema.optional(),
  description: FieldConfidenceSchema.optional(),
  websiteUrl: FieldConfidenceSchema.optional(),
  phones: FieldConfidenceSchema.optional(),
  email: FieldConfidenceSchema.optional(),
  address: FieldConfidenceSchema.optional(),
  hours: FieldConfidenceSchema.optional(),
  eligibility: FieldConfidenceSchema.optional(),
  applicationProcess: FieldConfidenceSchema.optional(),
  fees: FieldConfidenceSchema.optional(),
  languages: FieldConfidenceSchema.optional(),
  isRemoteService: FieldConfidenceSchema.optional(),
  serviceAreaDescription: FieldConfidenceSchema.optional(),
});
export type ServiceFieldConfidences = z.infer<typeof ServiceFieldConfidencesSchema>;

/**
 * Complete extraction result from LLM.
 */
export const ExtractionResultSchema = z.object({
  services: z.array(ExtractedServiceSchema),
  confidences: z.array(ServiceFieldConfidencesSchema),
  pageType: z.enum(['service_listing', 'organization_home', 'contact_page', 'eligibility_page', 'unknown']),
  extractionNotes: z.string().nullable().optional(),
  tokensUsed: z.number().int().min(0).optional(),
  modelId: z.string().optional(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------------------------------------------------------------------------
// Categorization / Tagging
// ---------------------------------------------------------------------------

/**
 * Top-level category tags used by the ingestion pipeline.
 * Source of truth: `src/agents/ingestion/tags.ts`.
 */
export const ServiceCategorySchema = z.enum(CATEGORY_TAGS);
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

/**
 * A single tag with confidence score.
 */
export const TagResultSchema = z.object({
  tag: ServiceCategorySchema,
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().nullable().optional(),
});
export type TagResult = z.infer<typeof TagResultSchema>;

/**
 * Complete categorization result from LLM.
 */
export const CategorizationResultSchema = z.object({
  tags: z.array(TagResultSchema),
  primaryCategory: ServiceCategorySchema.optional(),
  tokensUsed: z.number().int().min(0).optional(),
  modelId: z.string().optional(),
});
export type CategorizationResult = z.infer<typeof CategorizationResultSchema>;

// ---------------------------------------------------------------------------
// LLM Error Types
// ---------------------------------------------------------------------------

export const LLMErrorCodeSchema = z.enum([
  'rate_limited',
  'context_too_long',
  'invalid_response',
  'parse_error',
  'timeout',
  'auth_error',
  'service_unavailable',
  'content_filtered',
  'unknown',
]);
export type LLMErrorCode = z.infer<typeof LLMErrorCodeSchema>;

export const LLMErrorSchema = z.object({
  code: LLMErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().min(0).optional(),
  rawError: z.unknown().optional(),
});
export type LLMError = z.infer<typeof LLMErrorSchema>;
