/**
 * LLM Module
 *
 * Provides a provider-agnostic interface for LLM extraction and categorization.
 *
 * Usage:
 * ```typescript
 * import { createLLMClient, getLLMConfigFromEnv } from '@/agents/ingestion/llm';
 * import '@/agents/ingestion/llm/providers'; // Auto-register providers
 *
 * const config = getLLMConfigFromEnv();
 * const client = await createLLMClient(config);
 *
 * const extraction = await client.extract({ content, sourceUrl });
 * const categorization = await client.categorize({ service: extraction.data.services[0] });
 * ```
 */

// Client interface + factory
export type {
  LLMClientConfig,
  LLMClient,
  ExtractionInput,
  CategorizationInput,
  LLMResult,
} from './client';

export {
  DEFAULT_LLM_CONFIG,
  createLLMClient,
  getLLMConfigFromEnv,
  getRegisteredLLMProviders,
  registerLLMClientProvider,
} from './client';

// Types for extraction/categorization results
export type {
  ExtractedService,
  ExtractedPhone,
  ExtractedAddress,
  ExtractedHours,
  ExtractedEligibility,
  ExtractionResult,
  CategorizationResult,
  TagResult,
  ServiceCategory,
  FieldConfidence,
  ServiceFieldConfidences,
  LLMError,
  LLMErrorCode,
} from './types';

export {
  ExtractedServiceSchema,
  ExtractedPhoneSchema,
  ExtractedAddressSchema,
  ExtractedHoursSchema,
  ExtractedEligibilitySchema,
  ExtractionResultSchema,
  CategorizationResultSchema,
  TagResultSchema,
  ServiceCategorySchema,
  FieldConfidenceSchema,
  ServiceFieldConfidencesSchema,
  LLMErrorSchema,
  LLMErrorCodeSchema,
} from './types';

// Prompt builders (for testing/customization)
export { buildExtractionMessages, buildCategorizationMessages } from './prompts';
