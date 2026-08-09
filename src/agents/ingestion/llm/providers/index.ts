/**
 * LLM Provider implementations.
 *
 * Import this module to auto-register providers with the client factory.
 * Each provider self-registers via `registerLLMClientProvider()`.
 */

// Anthropic is the only bundled provider. Adding another provider requires an
// explicit architecture and runtime-policy change.
export { AnthropicClient, createAnthropicClient } from './anthropic';
