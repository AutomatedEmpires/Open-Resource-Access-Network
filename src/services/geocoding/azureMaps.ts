/**
 * ORAN Azure Maps Geocoding Service
 *
 * Replaces OpenStreetMap Nominatim with Azure Maps for geocoding.
 * Uses the Azure Maps Search API (Get Geocoding endpoint).
 *
 * Privacy: Only the query text (address/place name) is sent to Azure Maps.
 * No user PII (session IDs, user IDs) is included in geocoding requests.
 *
 * Requires env:
 *   AZURE_MAPS_KEY — subscription key (Key Vault reference in production)
 */

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
  /** Confidence score 0–1 (mapped from Azure Maps confidence) */
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

const AZURE_MAPS_BASE = 'https://atlas.microsoft.com';
const API_VERSION = '2025-01-01';

// ============================================================
// HELPERS
// ============================================================

function getSubscriptionKey(): string | null {
  return process.env.AZURE_MAPS_KEY ?? null;
}

/**
 * Map Azure Maps confidence levels to numeric scores.
 */
function mapConfidence(confidence: string | undefined): number {
  switch (confidence) {
    case 'High':
      return 0.95;
    case 'Medium':
      return 0.7;
    case 'Low':
      return 0.4;
    default:
      return 0.5;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Check if Azure Maps geocoding is configured.
 */
export function isConfigured(): boolean {
  return !!getSubscriptionKey();
}

/**
 * Forward geocode: address/place → coordinates.
 *
 * @param query - Address or place name to geocode
 * @param options - Optional parameters (limit, bounding box)
 * @returns Array of geocoding results (empty if service unavailable or no matches)
 */
export async function geocode(
  query: string,
  options?: { limit?: number; countryCode?: string }
): Promise<GeocodingResult[]> {
  const key = getSubscriptionKey();
  if (!key) return [];

  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    'api-version': API_VERSION,
    'subscription-key': key,
    query: trimmed,
    top: String(options?.limit ?? 5),
  });

  if (options?.countryCode) {
    params.set('countryRegion', options.countryCode);
  }

  try {
    const res = await fetch(`${AZURE_MAPS_BASE}/geocode?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      console.error(`[geocoding] Azure Maps returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    const features = data?.features;
    if (!Array.isArray(features)) return [];

    return features.map((f: Record<string, unknown>) => {
      const geometry = f.geometry as { coordinates?: number[] } | undefined;
      const props = f.properties as Record<string, unknown> | undefined;
      const coords = geometry?.coordinates ?? [0, 0];
      return {
        lon: coords[0],
        lat: coords[1],
        formattedAddress: (props?.address as Record<string, unknown>)?.formattedAddress as string ?? '',
        confidence: mapConfidence(props?.confidence as string | undefined),
      };
    });
  } catch (err) {
    console.error('[geocoding] Azure Maps geocode error:', err);
    return [];
  }
}

/**
 * Reverse geocode: coordinates → address.
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns Reverse geocoding result or null
 */
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<ReverseGeocodingResult | null> {
  const key = getSubscriptionKey();
  if (!key) return null;

  const params = new URLSearchParams({
    'api-version': API_VERSION,
    'subscription-key': key,
    coordinates: `${lon},${lat}`,
  });

  try {
    const res = await fetch(`${AZURE_MAPS_BASE}/reverseGeocode?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      console.error(`[geocoding] Azure Maps reverse returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const feature = data?.features?.[0];
    if (!feature) return null;

    const addr = (feature.properties as Record<string, unknown>)?.address as Record<string, unknown> | undefined;
    return {
      formattedAddress: (addr?.formattedAddress as string) ?? '',
      city: addr?.locality as string | undefined,
      state: addr?.adminDistricts as string | undefined,
      postalCode: addr?.postalCode as string | undefined,
      country: addr?.countryRegion as string | undefined,
    };
  } catch (err) {
    console.error('[geocoding] Azure Maps reverse error:', err);
    return null;
  }
}
