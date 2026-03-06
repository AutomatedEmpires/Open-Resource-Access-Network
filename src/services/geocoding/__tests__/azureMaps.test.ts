/**
 * Tests for Azure Maps geocoding service.
 *
 * Tests the module without hitting the real API — validates configuration
 * detection, input sanitization, and response mapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocode, reverseGeocode, isConfigured } from '../azureMaps';

describe('Azure Maps geocoding', () => {
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
    it('returns false when AZURE_MAPS_KEY is not set', () => {
      delete process.env.AZURE_MAPS_KEY;
      expect(isConfigured()).toBe(false);
    });

    it('returns true when AZURE_MAPS_KEY is set', () => {
      process.env.AZURE_MAPS_KEY = 'test-key';
      expect(isConfigured()).toBe(true);
    });
  });

  // ── Geocode ────────────────────────────────────────────────
  describe('geocode', () => {
    it('returns empty array when not configured', async () => {
      delete process.env.AZURE_MAPS_KEY;
      const results = await geocode('123 Main St');
      expect(results).toEqual([]);
    });

    it('returns empty array for blank query', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';
      const results = await geocode('   ');
      expect(results).toEqual([]);
    });

    it('maps Azure Maps GeoJSON response correctly', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';

      const mockResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-122.33, 47.60] },
            properties: {
              confidence: 'High',
              address: { formattedAddress: '123 Main St, Seattle, WA 98101' },
            },
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await geocode('123 Main St, Seattle');
      expect(results).toHaveLength(1);
      expect(results[0].lat).toBe(47.60);
      expect(results[0].lon).toBe(-122.33);
      expect(results[0].formattedAddress).toBe('123 Main St, Seattle, WA 98101');
      expect(results[0].confidence).toBe(0.95);
    });

    it('includes country filter and maps confidence fallbacks', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [-1, 2] },
              properties: { confidence: 'Medium', address: { formattedAddress: 'A' } },
            },
            {
              geometry: { coordinates: [-3, 4] },
              properties: { confidence: 'Low', address: { formattedAddress: 'B' } },
            },
            {
              geometry: {},
              properties: { confidence: 'Unknown', address: {} },
            },
          ],
        }),
      } as Response);

      const results = await geocode('Seattle', { countryCode: 'US', limit: 3 });
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.confidence)).toEqual([0.7, 0.4, 0.5]);
      expect(results[2].lat).toBe(0);
      expect(results[2].lon).toBe(0);

      const url = String(fetchSpy.mock.calls[0]?.[0]);
      expect(url).toContain('countryRegion=US');
      expect(url).toContain('top=3');
    });

    it('returns empty array when features is not an array', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: null }),
      } as Response);

      const results = await geocode('non-array');
      expect(results).toEqual([]);
    });

    it('returns empty array on API error', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const results = await geocode('test');
      expect(results).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
      const results = await geocode('test');
      expect(results).toEqual([]);
    });
  });

  // ── Reverse geocode ────────────────────────────────────────
  describe('reverseGeocode', () => {
    it('returns null when not configured', async () => {
      delete process.env.AZURE_MAPS_KEY;
      const result = await reverseGeocode(47.6, -122.33);
      expect(result).toBeNull();
    });

    it('maps reverse geocode response correctly', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';

      const mockResponse = {
        features: [
          {
            properties: {
              address: {
                formattedAddress: '123 Main St, Seattle, WA',
                locality: 'Seattle',
                postalCode: '98101',
                countryRegion: 'US',
              },
            },
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await reverseGeocode(47.6, -122.33);
      expect(result).not.toBeNull();
      expect(result?.formattedAddress).toBe('123 Main St, Seattle, WA');
      expect(result?.city).toBe('Seattle');
    });

    it('maps reverse geocode optional fields and handles API/error paths', async () => {
      process.env.AZURE_MAPS_KEY = 'test-key';

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                address: {
                  formattedAddress: '400 Broad St, Seattle, WA',
                  locality: 'Seattle',
                  adminDistricts: 'WA',
                  postalCode: '98109',
                  countryRegion: 'US',
                },
              },
            },
          ],
        }),
      } as Response);
      const mapped = await reverseGeocode(47.6205, -122.3493);
      expect(mapped).toEqual({
        formattedAddress: '400 Broad St, Seattle, WA',
        city: 'Seattle',
        state: 'WA',
        postalCode: '98109',
        country: 'US',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);
      await expect(reverseGeocode(1, 2)).resolves.toBeNull();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ features: [] }),
      } as Response);
      await expect(reverseGeocode(1, 2)).resolves.toBeNull();

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
      await expect(reverseGeocode(1, 2)).resolves.toBeNull();
    });
  });
});
