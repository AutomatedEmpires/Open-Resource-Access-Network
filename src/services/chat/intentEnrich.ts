/**
 * ORAN LLM Intent Enrichment Service — Idea 10
 *
 * Uses gpt-4o-mini to classify ambiguous "general" queries into a more specific
 * IntentCategory when the deterministic keyword classifier returns 'general' (fallback).
 *
 * Guardrails:
 * - Only activates when intent.category === 'general' (never overrides specific categories).
 * - Never called for crisis-routed messages (orchestrator early-returns before Stage 4.5).
 * - Never invents service names, addresses, phone numbers, hours, or eligibility.
 * - Fail-open: any network or parse error returns the original intent unchanged.
 *
 * Cost: ~$0.0002 per enrichment call (gpt-4o-mini at $0.15/1M input tokens, ~100 tokens/call).
 * Only fires for 'general' fallback queries — typically < 20% of messages.
 *
 * Requires env:
 *   AZURE_OPENAI_ENDPOINT   — e.g. https://oranhf57ir-prod-oai.openai.azure.com/
 *   AZURE_OPENAI_KEY        — subscription key (Key Vault reference in production)
 *   AZURE_OPENAI_DEPLOYMENT — deployment name (default: gpt-4o-mini)
 */

import { INTENT_CATEGORIES } from '@/services/chat/types';
import type { Intent, IntentCategory } from '@/services/chat/types';

// ============================================================
// CONSTANTS
// ============================================================

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_TOKENS = 20;
const API_VERSION = '2024-02-15-preview';

// ============================================================
// HELPERS
// ============================================================

function getConfig(): { endpoint: string; key: string; deployment: string } | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
  if (!endpoint || !key) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key, deployment };
}

function buildPrompt(message: string): string {
  const cats = INTENT_CATEGORIES.filter((c) => c !== 'general').join(', ');
  return (
    `You are a query classifier for a civic resource directory. ` +
    `Classify the following user query into exactly one category: ${cats}. ` +
    `If no category fits, output "general". ` +
    `Output only the category name, nothing else.\n\n` +
    `Query: "${message.slice(0, 300)}"`
  );
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Check if LLM intent enrichment is configured.
 */
export function isConfigured(): boolean {
  return !!getConfig();
}

/**
 * Attempt to enrich a 'general' intent with a more specific category using gpt-4o-mini.
 *
 * Returns the original intent unchanged if:
 * - The existing category is not 'general' (already classified)
 * - Azure OpenAI is not configured
 * - The API call fails or returns an unrecognised category
 */
export async function enrichIntent(message: string, existing: Intent): Promise<Intent> {
  // Only enrich when the keyword classifier returned the 'general' fallback.
  if (existing.category !== 'general') return existing;

  const config = getConfig();
  if (!config) return existing;

  const url =
    `${config.endpoint}/openai/deployments/` +
    `${encodeURIComponent(config.deployment)}/chat/completions` +
    `?api-version=${API_VERSION}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': config.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: buildPrompt(message) }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[intentEnrich] Azure OpenAI returned ${res.status}`);
      return existing;
    }

    const data: unknown = await res.json();
    const raw = (
      (data as { choices?: { message?: { content?: string } }[] })
        ?.choices?.[0]?.message?.content ?? ''
    )
      .trim()
      .toLowerCase();

    const valid = (INTENT_CATEGORIES as readonly string[]).includes(raw);
    if (!valid) return existing;

    return { ...existing, category: raw as IntentCategory };
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.warn(`[intentEnrich] LLM enrichment failed (non-fatal): ${errName}`);
    return existing;
  }
}
