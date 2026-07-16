/**
 * Anthropic LLM Client
 *
 * Production-grade implementation of `LLMClient` backed by the Anthropic
 * Messages API — the registered portfolio AI provider that replaces the
 * legacy Azure OpenAI connector. Uses raw fetch (matching the repo's other
 * provider integrations) so no SDK dependency is required.
 *
 * IMPORTANT:
 *  - Never logs PII or raw service content to telemetry.
 *  - The shared prompts already demand JSON output; responses are parsed
 *    with the same fence-tolerant parser behavior as the other providers.
 *  - Retryable errors include rate-limits and transient 5xx.
 *
 * Activation (founder-gated env): LLM_PROVIDER=anthropic, LLM_API_KEY,
 * optionally LLM_MODEL (defaults to claude-opus-4-8, matching the
 * portfolio's ingestion-extraction choice).
 */

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
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** Portfolio default for ingestion extraction (see registry PRODUCTS.md). */
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely parse JSON from a completion response (fence-tolerant). */
function parseJsonResponse(raw: string | null | undefined): unknown {
  if (!raw) throw new Error('Empty LLM response');

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  return JSON.parse(jsonStr);
}

/** Simple sleep for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP-status-carrying error for classification. */
class AnthropicHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AnthropicHttpError';
  }
}

/** Map HTTP/fetch errors to our LLMError codes. */
function classifyError(err: unknown): {
  code: 'rate_limited' | 'context_too_long' | 'timeout' | 'auth_error' | 'service_unavailable' | 'content_filtered' | 'unknown';
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (err instanceof AnthropicHttpError) {
    if (err.status === 429) {
      return {
        code: 'rate_limited',
        retryable: true,
        retryAfterMs: err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : 30_000,
      };
    }
    if (err.status === 401 || err.status === 403) {
      return { code: 'auth_error', retryable: false };
    }
    if (err.status === 529 || err.status >= 500) {
      return { code: 'service_unavailable', retryable: true, retryAfterMs: 10_000 };
    }
    if (err.status === 400 && err.message.toLowerCase().includes('too long')) {
      return { code: 'context_too_long', retryable: false };
    }
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (err.name === 'AbortError' || err.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('timed out')) {
      return { code: 'timeout', retryable: true, retryAfterMs: 5_000 };
    }
  }
  return { code: 'unknown', retryable: false };
}

interface AnthropicMessageResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Convert OpenAI-shaped chat messages (the shared prompt builders' output)
 * into the Anthropic Messages API shape: system prompt separated from turns.
 */
function toAnthropicPayload(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): { system: string | undefined; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system');
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: turns.length > 0 ? turns : [{ role: 'user', content: '' }],
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AnthropicClient implements LLMClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;

  private readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.model = config.model;
  }

  // ---- transport ---------------------------------------------------------

  private async createMessage(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens: number,
  ): Promise<AnthropicMessageResponse> {
    const { system, messages: turns } = toAnthropicPayload(messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature: this.config.temperature ?? DEFAULT_LLM_CONFIG.temperature,
        ...(system ? { system } : {}),
        messages: turns,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_LLM_CONFIG.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      // Body may describe the failure; never log it verbatim (may echo content).
      const retryAfter = response.headers.get('retry-after');
      let detail = '';
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        detail = body.error?.message ?? '';
      } catch {
        // Non-JSON error body — status alone is enough for classification.
      }
      throw new AnthropicHttpError(
        `Anthropic API error ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
      );
    }

    return (await response.json()) as AnthropicMessageResponse;
  }

  private extractText(response: AnthropicMessageResponse): string | undefined {
    return response.content?.find((block) => block.type === 'text')?.text;
  }

  private totalTokens(response: AnthropicMessageResponse): number | undefined {
    const input = response.usage?.input_tokens;
    const output = response.usage?.output_tokens;
    if (input === undefined && output === undefined) return undefined;
    return (input ?? 0) + (output ?? 0);
  }

  // ---- retry wrapper -------------------------------------------------------

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const classified = classifyError(err);
        if (!classified.retryable || attempt === maxRetries) {
          throw err;
        }
        const delay = classified.retryAfterMs ?? 1000 * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
    throw new Error('withRetry: unreachable');
  }

  // ---- extract -------------------------------------------------------------

  async extract(input: ExtractionInput): Promise<LLMResult<ExtractionResult>> {
    try {
      const messages = buildExtractionMessages(input);
      const response = await this.withRetry(() =>
        this.createMessage(
          messages,
          this.config.maxExtractionTokens ?? DEFAULT_LLM_CONFIG.maxExtractionTokens ?? 4096,
        ),
      );

      const parsed = parseJsonResponse(this.extractText(response));
      const validated = ExtractionResultSchema.parse(parsed);

      validated.modelId = response.model ?? this.model;
      validated.tokensUsed = this.totalTokens(response);

      return { success: true, data: validated };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ---- categorize ------------------------------------------------------------

  async categorize(input: CategorizationInput): Promise<LLMResult<CategorizationResult>> {
    try {
      const messages = buildCategorizationMessages(input);
      const response = await this.withRetry(() =>
        this.createMessage(
          messages,
          this.config.maxCategorizationTokens ?? DEFAULT_LLM_CONFIG.maxCategorizationTokens ?? 1024,
        ),
      );

      const parsed = parseJsonResponse(this.extractText(response));
      const validated = CategorizationResultSchema.parse(parsed);

      validated.modelId = response.model ?? this.model;
      validated.tokensUsed = this.totalTokens(response);

      return { success: true, data: validated };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ---- healthCheck -----------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.createMessage(
        [{ role: 'user', content: 'Respond with the word "ok".' }],
        8,
      );
      return (this.extractText(response) ?? '').toLowerCase().includes('ok');
    } catch {
      return false;
    }
  }

  // ---- error handling ----------------------------------------------------------

  private handleError<T>(err: unknown): LLMResult<T> {
    if (err instanceof ZodError) {
      return {
        success: false,
        error: { code: 'invalid_response', message: err.message, retryable: false },
      };
    }

    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: { code: 'parse_error', message: err.message, retryable: false },
      };
    }

    if (err instanceof Error && err.message === 'Empty LLM response') {
      return {
        success: false,
        error: { code: 'invalid_response', message: err.message, retryable: false },
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
 * Create an `AnthropicClient` from the shared config object.
 *
 * Requires `apiKey` (LLM_API_KEY). `endpoint` is ignored — the public
 * Anthropic API endpoint is fixed. A GPT-shaped default model coming from
 * the shared env defaults is replaced with the portfolio Claude default.
 */
export async function createAnthropicClient(
  config: LLMClientConfig,
): Promise<LLMClient> {
  if (!config.apiKey) {
    throw new Error('Anthropic requires an API key. Set LLM_API_KEY or provide config.apiKey.');
  }

  const model = !config.model || config.model.startsWith('gpt-')
    ? DEFAULT_ANTHROPIC_MODEL
    : config.model;

  return new AnthropicClient({ ...config, model });
}

// ---------------------------------------------------------------------------
// Self-register with the provider registry
// ---------------------------------------------------------------------------

registerLLMClientProvider('anthropic', createAnthropicClient);
