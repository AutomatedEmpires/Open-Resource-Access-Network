/**
 * Tests for the OpenStreetMap Nominatim geocoding service.
 *
 * Validates configuration behaviour, input sanitisation, and response mapping
 * without hitting the real API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocode, reverseGeocode, isConfigured } from '../nominatim';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('Nominatim geocoding', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isConfigured', () => {
    it('is always available (no API key required)', () => {
      expect(isConfigured()).toBe(true);
    });
  });

  describe('geocode', () => {
    it('returns empty array for a blank query without calling the network', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const results = await geocode('   ');
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('maps a Nominatim search response and sends a descriptive User-Agent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okJson([
          {
            lat: '47.6',
            lon: '-122.33',
            display_name: '123 Main St, Seattle, WA 98101',
            importance: 0.9,
          },
        ]),
      );

      const results = await geocode('123 Main St, Seattle');
      expect(results).toHaveLength(1);
      expect(results[0].lat).toBe(47.6);
      expect(results[0].lon).toBe(-122.33);
      expect(results[0].formattedAddress).toBe('123 Main St, Seattle, WA 98101');
      expect(results[0].confidence).toBeCloseTo(0.9);

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/search?');
      expect(url).toContain('format=jsonv2');
      expect((init.headers as Record<string, string>)['User-Agent']).toContain('ORAN');
    });

    it('applies the country filter and limit and clamps confidence', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okJson([
          { lat: '2', lon: '-1', display_name: 'A', importance: 1.7 },
          { lat: '4', lon: '-3', display_name: 'B' },
        ]),
      );

      const results = await geocode('Seattle', { countryCode: 'US', limit: 3 });
      expect(results).toHaveLength(2);
      expect(results[0].confidence).toBe(1); // clamped from 1.7
      expect(results[1].confidence).toBe(0.5); // missing importance -> default

      const url = String(fetchSpy.mock.calls[0]?.[0]);
      expect(url).toContain('countrycodes=us');
      expect(url).toContain('limit=3');
    });

    it('returns empty array when the payload is not an array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ error: 'nope' }));
      expect(await geocode('x')).toEqual([]);
    });

    it('returns empty array on API error and network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 429 } as Response);
      expect(await geocode('x')).toEqual([]);

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
      expect(await geocode('y')).toEqual([]);
    });

    it('honours NOMINATIM_BASE_URL override', async () => {
      process.env.NOMINATIM_BASE_URL = 'https://geo.internal.example/';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
      await geocode('anywhere');
      expect(String(fetchSpy.mock.calls[0]?.[0]).startsWith('https://geo.internal.example/search?')).toBe(true);
    });
  });

  describe('reverseGeocode', () => {
    it('maps a reverse response, preferring town when city is absent', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okJson({
          display_name: '400 Broad St, Seattle, WA',
          address: {
            town: 'Seattle',
            state: 'Washington',
            postcode: '98109',
            country_code: 'us',
          },
        }),
      );

      const result = await reverseGeocode(47.62, -122.35);
      expect(result).toEqual({
        formattedAddress: '400 Broad St, Seattle, WA',
        city: 'Seattle',
        state: 'Washington',
        postalCode: '98109',
        country: 'US',
      });
    });

    it('returns null on error, empty, and network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 } as Response);
      expect(await reverseGeocode(1, 2)).toBeNull();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
      expect(await reverseGeocode(1, 2)).toBeNull();

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
      expect(await reverseGeocode(1, 2)).toBeNull();
    });
  });
});
