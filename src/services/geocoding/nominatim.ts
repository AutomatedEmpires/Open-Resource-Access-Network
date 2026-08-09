/**
 * ORAN Geocoding Service — OpenStreetMap Nominatim
 *
 * Provider-neutral geocoding backed by the free, tokenless OpenStreetMap
 * Nominatim service. Replaces the former Azure Maps geocoder and keeps ORAN off
 * paid/keyed cloud dependencies, matching the portfolio's tokenless map stack.
 *
 * Same public surface as the prior adapter: geocode / reverseGeocode /
 * isConfigured / GeocodingResult / ReverseGeocodingResult.
 *
 * Usage policy: Nominatim's public instance requires a descriptive User-Agent
 * and a max of ~1 request/second. For high-volume ingestion, set
 * NOMINATIM_BASE_URL to a self-hosted instance.
 *
 * Privacy: Only the query text (address/place) or coordinates are sent. No user
 * PII (session IDs, user IDs) is ever included.
 *
 * Env (all optional — geocoding works with zero configuration):
 *   NOMINATIM_BASE_URL  — override the base URL (default: public OSM instance)
 *   GEOCODER_USER_AGENT — override the required User-Agent contact string
 */

import { assertAllowedRuntimeEndpoint } from '@/services/runtime/providerPolicy';

// ============================================================
// TYPES
// ============================================================

export interface GeocodingResult {
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lon: number;
  /** Formatted display address */
  formattedAddress: string;
  /** Confidence score 0–1 (mapped from Nominatim importance) */
  confidence: number;
}

export interface ReverseGeocodingResult {
  formattedAddress: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_USER_AGENT = 'ORAN/1.0 (+https://openresourceaccessnetwork.com)';
const REQUEST_TIMEOUT_MS = 5_000;

function getBaseUrl(): string {
  return assertAllowedRuntimeEndpoint(
    (process.env.NOMINATIM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    'NOMINATIM_BASE_URL',
  );
}

function getUserAgent(): string {
  return process.env.GEOCODER_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

/**
 * Map Nominatim's 0–1 `importance` to a confidence score, with a sensible
 * default when it is missing. Kept in the same 0–1 range as the prior adapter.
 */
function mapConfidence(importance: unknown): number {
  const n = typeof importance === 'number' ? importance : Number(importance);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Geocoding is always available (no API key required). Retained for call-site
 * compatibility with the prior keyed adapter.
 */
export function isConfigured(): boolean {
  return true;
}

/**
 * Forward geocode: address/place → coordinates.
 *
 * @returns Array of geocoding results (empty on error or no matches).
 */
export async function geocode(
  query: string,
  options?: { limit?: number; countryCode?: string },
): Promise<GeocodingResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(options?.limit ?? 5),
  });
  if (options?.countryCode) {
    params.set('countrycodes', options.countryCode.toLowerCase());
  }

  try {
    const res = await fetch(`${getBaseUrl()}/search?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': getUserAgent() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[geocoding] Nominatim returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((f: Record<string, unknown>) => ({
      lat: toNumber(f.lat),
      lon: toNumber(f.lon),
      formattedAddress: (f.display_name as string) ?? '',
      confidence: mapConfidence(f.importance),
    }));
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.error(`[geocoding] Nominatim geocode error: ${errName}`);
    return [];
  }
}

/**
 * Reverse geocode: coordinates → address.
 *
 * @returns Reverse geocoding result or null.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<ReverseGeocodingResult | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    addressdetails: '1',
  });

  try {
    const res = await fetch(`${getBaseUrl()}/reverse?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': getUserAgent() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[geocoding] Nominatim reverse returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const record = data as Record<string, unknown>;
    const addr = (record.address as Record<string, unknown> | undefined) ?? {};
    const city =
      (addr.city as string | undefined) ??
      (addr.town as string | undefined) ??
      (addr.village as string | undefined) ??
      (addr.hamlet as string | undefined);

    return {
      formattedAddress: (record.display_name as string) ?? '',
      city,
      state: addr.state as string | undefined,
      postalCode: addr.postcode as string | undefined,
      country: (addr.country_code as string | undefined)?.toUpperCase() ?? (addr.country as string | undefined),
    };
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.error(`[geocoding] Nominatim reverse error: ${errName}`);
    return null;
  }
}
