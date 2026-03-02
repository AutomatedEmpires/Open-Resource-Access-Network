/**
 * LLM Client Interface
 *
 * Abstracts LLM providers for service extraction and categorization.
 * Supports Azure OpenAI (primary) with pluggable alternatives.
 */

import type {
  CategorizationResult,
  ExtractionResult,
  ExtractedService,
  LLMError,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic LLM configuration.
 */
export interface LLMClientConfig {
  /** Provider identifier */
  provider: 'azure_openai' | 'openai' | 'anthropic';
  /** Model name/deployment ID */
  model: string;
  /** API endpoint (for Azure, the resource endpoint) */
  endpoint?: string;
  /** API key (or use managed identity for Azure) */
  apiKey?: string;
  /** API version (Azure-specific) */
  apiVersion?: string;
  /** Max tokens for extraction */
  maxExtractionTokens?: number;
  /** Max tokens for categorization */
  maxCategorizationTokens?: number;
  /** Temperature (0.0 = deterministic, higher = more creative) */
  temperature?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Enable structured output (JSON mode) */
  useStructuredOutput?: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_LLM_CONFIG: Partial<LLMClientConfig> = {
  maxExtractionTokens: 4096,
  maxCategorizationTokens: 1024,
  temperature: 0.1, // Low for consistency
  timeoutMs: 60000, // 60s
  useStructuredOutput: true,
};

// ---------------------------------------------------------------------------
// Client Interface
// ---------------------------------------------------------------------------

/**
 * Input for extraction: cleaned page content + metadata.
 */
export interface ExtractionInput {
  /** Cleaned HTML/text content to extract from */
  content: string;
  /** Source URL for context */
  sourceUrl: string;
  /** Optional page title */
  pageTitle?: string;
  /** Source quality tier (affects confidence scoring) */
  sourceQuality?: 'official' | 'vetted' | 'quarantine';
  /** Hint about what type of page this is */
  pageHint?: 'service_listing' | 'organization_home' | 'contact_page' | 'unknown';
}

/**
 * Input for categorization: extracted service data.
 */
export interface CategorizationInput {
  /** The extracted service to categorize */
  service: ExtractedService;
  /** Optional hint for expected categories based on source */
  categoryHints?: string[];
}

/**
 * Result type that handles success or failure.
 */
export type LLMResult<T> =
  | { success: true; data: T }
  | { success: false; error: LLMError };

/**
 * LLM client interface.
 * Implementations: AzureOpenAIClient, OpenAIClient, etc.
 */
export interface LLMClient {
  /** Get provider name for logging */
  readonly provider: string;

  /** Get model name for logging */
  readonly model: string;

  /**
   * Extract service information from cleaned page content.
   * Returns structured data following HSDS conventions.
   */
  extract(input: ExtractionInput): Promise<LLMResult<ExtractionResult>>;

  /**
   * Categorize a service with taxonomy tags.
   * Should be called after extraction.
   */
  categorize(input: CategorizationInput): Promise<LLMResult<CategorizationResult>>;

  /**
   * Health check - verify the client can reach the LLM.
   */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Registry of client constructors by provider.
 * Allows adding new providers without modifying factory.
 */
const clientRegistry: Map<
  string,
  (config: LLMClientConfig) => Promise<LLMClient>
> = new Map();

/**
 * Register a client constructor for a provider.
 * Used by provider implementations to register themselves.
 */
export function registerLLMClientProvider(
  provider: string,
  constructor: (config: LLMClientConfig) => Promise<LLMClient>
): void {
  clientRegistry.set(provider, constructor);
}

/**
 * Create an LLM client based on configuration.
 * Throws if provider is not registered.
 */
export async function createLLMClient(config: LLMClientConfig): Promise<LLMClient> {
  const fullConfig: LLMClientConfig = {
    ...DEFAULT_LLM_CONFIG,
    ...config,
  };

  const constructor = clientRegistry.get(fullConfig.provider);
  if (!constructor) {
    throw new Error(
      `LLM provider "${fullConfig.provider}" is not registered. ` +
        `Available: ${Array.from(clientRegistry.keys()).join(', ') || 'none'}`
    );
  }

  return constructor(fullConfig);
}

/**
 * Get list of registered providers.
 */
export function getRegisteredLLMProviders(): string[] {
  return Array.from(clientRegistry.keys());
}

// ---------------------------------------------------------------------------
// Environment-based Configuration
// ---------------------------------------------------------------------------

/**
 * Create LLM client from environment variables.
 * Falls back to defaults if not set.
 *
 * Environment variables:
 * - LLM_PROVIDER: 'azure_openai' | 'openai' | 'anthropic'
 * - LLM_MODEL: Model name/deployment ID
 * - LLM_ENDPOINT: API endpoint (required for Azure)
 * - LLM_API_KEY: API key
 * - LLM_API_VERSION: API version (Azure)
 * - LLM_TEMPERATURE: Temperature (0.0-2.0)
 * - LLM_TIMEOUT_MS: Request timeout
 */
export function getLLMConfigFromEnv(): LLMClientConfig {
  const provider = (process.env.LLM_PROVIDER || 'azure_openai') as LLMClientConfig['provider'];

  return {
    provider,
    model: process.env.LLM_MODEL || 'gpt-4o',
    endpoint: process.env.LLM_ENDPOINT,
    apiKey: process.env.LLM_API_KEY,
    apiVersion: process.env.LLM_API_VERSION || '2024-08-01-preview',
    temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : undefined,
    timeoutMs: process.env.LLM_TIMEOUT_MS ? parseInt(process.env.LLM_TIMEOUT_MS, 10) : undefined,
  };
}
