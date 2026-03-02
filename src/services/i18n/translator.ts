/**
 * ORAN Azure AI Translator Service
 *
 * Provides dynamic translation using Azure AI Translator (Cognitive Services).
 * Used alongside the static i18n dictionary to translate user-facing content
 * that is not pre-translated (e.g., service descriptions from the database).
 *
 * Privacy: Only the text to translate and target language are sent.
 * No user PII (session IDs, user IDs) is included in translation requests.
 *
 * Free tier (F0): 2M characters/month.
 *
 * Requires env:
 *   AZURE_TRANSLATOR_KEY      — subscription key (Key Vault reference in prod)
 *   AZURE_TRANSLATOR_ENDPOINT — e.g. https://api.cognitive.microsofttranslator.com/
 *   AZURE_TRANSLATOR_REGION   — e.g. westus2
 */

import type { LocaleCode } from './i18n';

// ============================================================
// TYPES
// ============================================================

export interface TranslationRequest {
  text: string;
  from?: LocaleCode;
  to: LocaleCode;
}

export interface TranslationResponse {
  originalText: string;
  translatedText: string;
  detectedLanguage?: string;
  to: LocaleCode;
}

// ============================================================
// CONSTANTS
// ============================================================

const TRANSLATE_PATH = '/translate';
const API_VERSION = '3.0';
const MAX_TEXT_LENGTH = 10_000; // Azure limit is 50k but we cap lower for safety
const REQUEST_TIMEOUT_MS = 8_000;

// Simple in-memory cache to avoid duplicate API calls for repeated content.
const translationCache = new Map<string, TranslationResponse>();
const MAX_CACHE_SIZE = 500;

// ============================================================
// HELPERS
// ============================================================

function getConfig(): { key: string; endpoint: string; region: string } | null {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT;
  const region = process.env.AZURE_TRANSLATOR_REGION;

  if (!key || !endpoint || !region) return null;
  return { key, endpoint, region };
}

function cacheKey(text: string, to: string, from?: string): string {
  return `${from ?? 'auto'}:${to}:${text.slice(0, 200)}`;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Check if Azure AI Translator is configured.
 */
export function isConfigured(): boolean {
  return !!getConfig();
}

/**
 * Translate a single text string.
 *
 * @returns Translated text, or the original text if translation is unavailable.
 */
export async function translate(request: TranslationRequest): Promise<TranslationResponse> {
  const { text, from, to } = request;

  // No-op if already the source language.
  if (from && from === to) {
    return { originalText: text, translatedText: text, to };
  }

  // Check cache.
  const ck = cacheKey(text, to, from);
  const cached = translationCache.get(ck);
  if (cached) return cached;

  const config = getConfig();
  if (!config) {
    return { originalText: text, translatedText: text, to };
  }

  const truncated = text.slice(0, MAX_TEXT_LENGTH);

  const params = new URLSearchParams({
    'api-version': API_VERSION,
    to,
  });
  if (from) params.set('from', from);

  try {
    const res = await fetch(`${config.endpoint}${TRANSLATE_PATH}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Ocp-Apim-Subscription-Region': config.region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: truncated }]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[translator] Azure Translator returned ${res.status}`);
      return { originalText: text, translatedText: text, to };
    }

    const data = await res.json();
    const translations = data?.[0]?.translations;
    if (!Array.isArray(translations) || translations.length === 0) {
      return { originalText: text, translatedText: text, to };
    }

    const result: TranslationResponse = {
      originalText: text,
      translatedText: translations[0].text ?? text,
      detectedLanguage: data[0]?.detectedLanguage?.language,
      to,
    };

    // Cache the result.
    if (translationCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry.
      const firstKey = translationCache.keys().next().value;
      if (firstKey !== undefined) translationCache.delete(firstKey);
    }
    translationCache.set(ck, result);

    return result;
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.error(`[translator] Azure Translator error: ${errName}`);
    return { originalText: text, translatedText: text, to };
  }
}

/**
 * Translate multiple texts in a single API call (batch).
 * Azure Translator supports up to 100 elements per request.
 *
 * @returns Array of translation responses in the same order as input.
 */
export async function translateBatch(
  texts: string[],
  to: LocaleCode,
  from?: LocaleCode
): Promise<TranslationResponse[]> {
  if (texts.length === 0) return [];

  // If all cached, return from cache.
  const results: (TranslationResponse | null)[] = texts.map((t) => {
    const ck = cacheKey(t, to, from);
    return translationCache.get(ck) ?? null;
  });

  const uncachedIndices = results
    .map((r, i) => (r === null ? i : -1))
    .filter((i) => i >= 0);

  if (uncachedIndices.length === 0) {
    return results as TranslationResponse[];
  }

  const config = getConfig();
  if (!config) {
    return texts.map((t) => ({ originalText: t, translatedText: t, to }));
  }

  // Build batch (max 100 per Azure API limit).
  const batch = uncachedIndices.slice(0, 100).map((i) => ({
    Text: texts[i].slice(0, MAX_TEXT_LENGTH),
  }));

  const params = new URLSearchParams({ 'api-version': API_VERSION, to });
  if (from) params.set('from', from);

  try {
    const res = await fetch(`${config.endpoint}${TRANSLATE_PATH}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Ocp-Apim-Subscription-Region': config.region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[translator] batch returned ${res.status}`);
      return texts.map((t) => ({ originalText: t, translatedText: t, to }));
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return texts.map((t) => ({ originalText: t, translatedText: t, to }));
    }

    // Map responses back.
    for (let j = 0; j < uncachedIndices.length && j < data.length; j++) {
      const idx = uncachedIndices[j];
      const translated = data[j]?.translations?.[0]?.text ?? texts[idx];
      const result: TranslationResponse = {
        originalText: texts[idx],
        translatedText: translated,
        detectedLanguage: data[j]?.detectedLanguage?.language,
        to,
      };
      results[idx] = result;

      // Cache.
      const ck = cacheKey(texts[idx], to, from);
      if (translationCache.size >= MAX_CACHE_SIZE) {
        const firstKey = translationCache.keys().next().value;
        if (firstKey !== undefined) translationCache.delete(firstKey);
      }
      translationCache.set(ck, result);
    }

    // Fill any remaining nulls with pass-through.
    return results.map((r, i) => r ?? { originalText: texts[i], translatedText: texts[i], to });
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.error(`[translator] batch error: ${errName}`);
    return texts.map((t) => ({ originalText: t, translatedText: t, to }));
  }
}
