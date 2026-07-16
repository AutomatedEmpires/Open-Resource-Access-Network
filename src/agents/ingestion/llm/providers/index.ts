/**
 * LLM Provider implementations.
 *
 * Import this module to auto-register providers with the client factory.
 * Each provider self-registers via `registerLLMClientProvider()`.
 */

// Providers self-register on import.
// azure_openai is the legacy connector; anthropic is the registered
// portfolio provider (activated via LLM_PROVIDER=anthropic + LLM_API_KEY).
export { AzureOpenAIClient, createAzureOpenAIClient } from './azureOpenai';
export { AnthropicClient, createAnthropicClient } from './anthropic';
