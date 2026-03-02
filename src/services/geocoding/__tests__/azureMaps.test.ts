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
  });
});
