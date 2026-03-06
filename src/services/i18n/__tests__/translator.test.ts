/**
 * Tests for Azure AI Translator service.
 *
 * Tests configuration detection, caching, and response mapping
 * without hitting the real API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translate, translateBatch, isConfigured } from '../translator';

describe('Azure AI Translator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Configuration ──────────────────────────────────────────
  describe('isConfigured', () => {
    it('returns false when env vars are missing', () => {
      delete process.env.AZURE_TRANSLATOR_KEY;
      delete process.env.AZURE_TRANSLATOR_ENDPOINT;
      delete process.env.AZURE_TRANSLATOR_REGION;
      expect(isConfigured()).toBe(false);
    });

    it('returns true when all env vars are set', () => {
      process.env.AZURE_TRANSLATOR_KEY = 'test-key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';
      expect(isConfigured()).toBe(true);
    });
  });

  // ── Single translate ───────────────────────────────────────
  describe('translate', () => {
    it('returns original text when not configured', async () => {
      delete process.env.AZURE_TRANSLATOR_KEY;
      const result = await translate({ text: 'hello', to: 'es' });
      expect(result.translatedText).toBe('hello');
      expect(result.to).toBe('es');
    });

    it('returns original text when source equals target', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';
      const result = await translate({ text: 'hello', from: 'en', to: 'en' });
      expect(result.translatedText).toBe('hello');
    });

    it('translates via API and caches result', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      const mockResponse = [
        {
          detectedLanguage: { language: 'en', score: 1.0 },
          translations: [{ text: 'hola', to: 'es' }],
        },
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await translate({ text: 'hello', to: 'es' });
      expect(result.translatedText).toBe('hola');
      expect(result.detectedLanguage).toBe('en');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call should use cache (no new fetch).
      const result2 = await translate({ text: 'hello', to: 'es' });
      expect(result2.translatedText).toBe('hola');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns original on API error', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      const result = await translate({ text: 'goodbye', to: 'es' });
      expect(result.translatedText).toBe('goodbye');
    });

    it('returns original text when API response has no translations', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [{ detectedLanguage: { language: 'en' }, translations: [] }],
      } as Response);

      const result = await translate({ text: 'no translation', to: 'es' });
      expect(result.translatedText).toBe('no translation');
    });

    it('includes "from" language in request params when provided', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [{ translations: [{ text: 'bonjour' }] }],
      } as Response);

      await translate({ text: 'hello-from', from: 'en', to: 'fr' });

      const requestUrl = String(fetchSpy.mock.calls[0]?.[0]);
      expect(requestUrl).toContain('from=en');
      expect(requestUrl).toContain('to=fr');
    });

    it('returns original text when fetch throws', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('network-down');

      const result = await translate({ text: 'error case', to: 'es' });
      expect(result.translatedText).toBe('error case');
    });
  });

  // ── Batch translate ────────────────────────────────────────
  describe('translateBatch', () => {
    it('returns empty array for empty input', async () => {
      const results = await translateBatch([], 'es');
      expect(results).toEqual([]);
    });

    it('returns originals when not configured', async () => {
      delete process.env.AZURE_TRANSLATOR_KEY;
      const results = await translateBatch(['hello', 'world'], 'es');
      expect(results).toHaveLength(2);
      expect(results[0].translatedText).toBe('hello');
      expect(results[1].translatedText).toBe('world');
    });

    it('translates batch via API', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      const mockResponse = [
        { translations: [{ text: 'buenos días', to: 'es' }] },
        { translations: [{ text: 'buenas noches', to: 'es' }] },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await translateBatch(['good morning', 'good night'], 'es');
      expect(results).toHaveLength(2);
      expect(results[0].translatedText).toBe('buenos días');
      expect(results[1].translatedText).toBe('buenas noches');
    });

    it('returns cached batch results without API call', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [{ translations: [{ text: 'hola-cached' }] }],
      } as Response);

      const first = await translateBatch(['hello-cached'], 'es');
      expect(first[0].translatedText).toBe('hola-cached');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const second = await translateBatch(['hello-cached'], 'es');
      expect(second[0].translatedText).toBe('hola-cached');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns originals when batch API response is not an array', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: true }),
      } as Response);

      const results = await translateBatch(['x', 'y'], 'es');
      expect(results.map((r) => r.translatedText)).toEqual(['x', 'y']);
    });

    it('falls back for uncached entries when response is shorter than request batch', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [{ translations: [{ text: 'uno' }] }],
      } as Response);

      const results = await translateBatch(['one-short', 'two-short'], 'es');
      expect(results[0].translatedText).toBe('uno');
      expect(results[1].translatedText).toBe('two-short');
    });

    it('returns originals on non-OK batch response and thrown errors', async () => {
      process.env.AZURE_TRANSLATOR_KEY = 'key';
      process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://api.test.com/';
      process.env.AZURE_TRANSLATOR_REGION = 'westus2';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response);
      const notOk = await translateBatch(['rate-limited'], 'es', 'en');
      expect(notOk[0].translatedText).toBe('rate-limited');

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'));
      const errored = await translateBatch(['throws'], 'es', 'en');
      expect(errored[0].translatedText).toBe('throws');
    });
  });
});
