/**
 * Azure OpenAI LLM Client
 *
 * Production-grade implementation of `LLMClient` backed by Azure OpenAI Service.
 * Uses the official `openai` SDK with Azure-specific configuration.
 *
 * IMPORTANT:
 *  - Never logs PII or raw service content to telemetry.
 *  - Structured JSON output mode is preferred for reliable parsing.
 *  - Retryable errors include rate-limits and transient 5xx.
 */

import { AzureOpenAI } from 'openai';
import { ZodError } from 'zod';

import type {
  LLMClient,
  LLMClientConfig,
  ExtractionInput,
  CategorizationInput,
  LLMResult,
} from '../client';
import { registerLLMClientProvider, DEFAULT_LLM_CONFIG } from '../client';
import type { ExtractionResult, CategorizationResult } from '../types';
import {
  ExtractionResultSchema,
  CategorizationResultSchema,
} from '../types';

import { buildExtractionMessages } from '../prompts/extraction';
import { buildCategorizationMessages } from '../prompts/categorization';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely parse JSON from a chat completion response. */
function parseJsonResponse(raw: string | null | undefined): unknown {
  if (!raw) throw new Error('Empty LLM response');

  // Handle fenced code-blocks some models wrap output in
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  return JSON.parse(jsonStr);
}

/** Map SDK/HTTP errors to our LLMError codes. */
function classifyError(err: unknown): {
  code: 'rate_limited' | 'context_too_long' | 'timeout' | 'auth_error' | 'service_unavailable' | 'content_filtered' | 'unknown';
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any).status as number | undefined;

    if (status === 429 || msg.includes('rate limit')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retryAfter = (err as any).headers?.['retry-after'];
      return {
        code: 'rate_limited',
        retryable: true,
        retryAfterMs: retryAfter ? parseInt(retryAfter, 10) * 1000 : 30_000,
      };
    }

    if (msg.includes('context_length_exceeded') || msg.includes('maximum context length')) {
      return { code: 'context_too_long', retryable: false };
    }

    if (msg.includes('content_filter') || msg.includes('content management policy')) {
      return { code: 'content_filtered', retryable: false };
    }

    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
      return { code: 'auth_error', retryable: false };
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
      return { code: 'timeout', retryable: true, retryAfterMs: 5_000 };
    }

    if (status && status >= 500) {
      return { code: 'service_unavailable', retryable: true, retryAfterMs: 10_000 };
    }
  }
  return { code: 'unknown', retryable: false };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AzureOpenAIClient implements LLMClient {
  readonly provider = 'azure_openai' as const;
  readonly model: string;

  private readonly client: AzureOpenAI;
  private readonly config: LLMClientConfig;

  constructor(client: AzureOpenAI, config: LLMClientConfig) {
    this.client = client;
    this.config = config;
    this.model = config.model;
  }

  // ---- extract ---------------------------------------------------------

  async extract(input: ExtractionInput): Promise<LLMResult<ExtractionResult>> {
    try {
      const messages = buildExtractionMessages(input);

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxExtractionTokens ?? DEFAULT_LLM_CONFIG.maxExtractionTokens,
        temperature: this.config.temperature ?? DEFAULT_LLM_CONFIG.temperature,
        response_format: this.config.useStructuredOutput
          ? { type: 'json_object' as const }
          : undefined,
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const parsed = parseJsonResponse(rawContent);
      const validated = ExtractionResultSchema.parse(parsed);

      // Attach model metadata
      validated.modelId = response.model ?? this.config.model;
      validated.tokensUsed = response.usage?.total_tokens;

      return { success: true, data: validated };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ---- categorize ------------------------------------------------------

  async categorize(input: CategorizationInput): Promise<LLMResult<CategorizationResult>> {
    try {
      const messages = buildCategorizationMessages(input);

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxCategorizationTokens ?? DEFAULT_LLM_CONFIG.maxCategorizationTokens,
        temperature: this.config.temperature ?? DEFAULT_LLM_CONFIG.temperature,
        response_format: this.config.useStructuredOutput
          ? { type: 'json_object' as const }
          : undefined,
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const parsed = parseJsonResponse(rawContent);
      const validated = CategorizationResultSchema.parse(parsed);

      validated.modelId = response.model ?? this.config.model;
      validated.tokensUsed = response.usage?.total_tokens;

      return { success: true, data: validated };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ---- healthCheck -----------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'Respond with the word "ok".' }],
        max_tokens: 4,
        temperature: 0,
      });
      const text = response.choices?.[0]?.message?.content?.toLowerCase() ?? '';
      return text.includes('ok');
    } catch {
      return false;
    }
  }

  // ---- error handling ---------------------------------------------------

  private handleError<T>(err: unknown): LLMResult<T> {
    if (err instanceof ZodError) {
      return {
        success: false,
        error: {
          code: 'invalid_response',
          message: err.message,
          retryable: false,
        },
      };
    }

    // JSON.parse failures (including when the model returns non-JSON)
    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: {
          code: 'parse_error',
          message: err.message,
          retryable: false,
        },
      };
    }

    if (err instanceof Error && err.message === 'Empty LLM response') {
      return {
        success: false,
        error: {
          code: 'invalid_response',
          message: err.message,
          retryable: false,
        },
      };
    }

    const classified = classifyError(err);
    return {
      success: false,
      error: {
        code: classified.code,
        message: err instanceof Error ? err.message : String(err),
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
        // Intentionally omit rawError to avoid leaking PII in downstream logging
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an `AzureOpenAIClient` from the shared config object.
 *
 * Requires at minimum:
 * - `endpoint` — Azure OpenAI resource endpoint (e.g. https://my-resource.openai.azure.com)
 * - `apiKey` — API key for the resource (or use managed identity in production)
 * - `model` — deployment name within the Azure resource
 */
export async function createAzureOpenAIClient(
  config: LLMClientConfig
): Promise<LLMClient> {
  if (!config.endpoint) {
    throw new Error(
      'Azure OpenAI requires an endpoint. Set LLM_ENDPOINT or provide config.endpoint.'
    );
  }

  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion ?? '2024-08-01-preview',
    deployment: config.model,
    timeout: config.timeoutMs ?? DEFAULT_LLM_CONFIG.timeoutMs ?? 60_000,
  });

  return new AzureOpenAIClient(client, config);
}

// ---------------------------------------------------------------------------
// Self-register with the provider registry
// ---------------------------------------------------------------------------

registerLLMClientProvider('azure_openai', createAzureOpenAIClient);
