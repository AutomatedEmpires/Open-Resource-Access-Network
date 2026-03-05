/**
 * ORAN Map Container — Azure Maps
 *
 * Safety / Privacy:
 * - Does NOT request device location (any device location use must be explicit
 *   and happen at the page level).
 * - Plots only coordinates from stored, verified records.
 * - Subscription key is fetched from /api/maps/token (server-side broker)
 *   so it never appears in the client JS bundle.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as atlas from 'azure-maps-control';
import 'azure-maps-control/dist/atlas.min.css';
import { AlertTriangle, Loader2 } from 'lucide-react';

import type { EnrichedService } from '@/domain/types';
import { getConfidenceTier } from '@/domain/confidence';

// ============================================================
// TYPES
// ============================================================

interface Pin {
  id: string;
  name: string;
  orgName: string;
  orgLogoUrl: string | null;
  confidenceScore: number | null;
  lat: number;
  lng: number;
}

interface MapContainerProps {
  /** Initial center latitude */
  centerLat?: number;
  /** Initial center longitude */
  centerLng?: number;
  /** Initial zoom level */
  zoom?: number;
  /** Services to plot (only those with coordinates are shown) */
  services?: EnrichedService[];
  /** Callback when map viewport changes (for bbox queries) */
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  className?: string;
}

// ============================================================
// POPUP HELPERS
// ============================================================

function popupContent(pin: Pin): string {
  const safeLogo = safeHttpUrl(pin.orgLogoUrl ?? null);

  const logoHtml = safeLogo
    ? `<img src="${escapeAttribute(safeLogo)}" alt="${escapeAttribute(`${pin.orgName} logo`)}" style="width:32px;height:32px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid #e5e7eb" />`
    : `<div style="width:32px;height:32px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#111">ORAN</div>`;

  return `<div style="padding:10px 12px;max-width:260px;font-family:system-ui,sans-serif">
    <div style="display:flex;gap:10px;align-items:center">
      ${logoHtml}
      <div style="min-width:0">
        <p style="margin:0;font-weight:700;font-size:14px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(pin.name)}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(pin.orgName)}</p>
      </div>
    </div>
    <div style="margin-top:8px">
      <a href="/service/${encodeURIComponent(pin.id)}" style="font-size:12px;color:#1d4ed8;text-decoration:none;font-weight:600">View service</a>
    </div>
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function markerHtml(tier: 'green' | 'yellow' | 'orange' | 'red' | 'unknown'): string {
  const className =
    tier === 'green' ? 'bg-green-600' :
      tier === 'yellow' ? 'bg-yellow-500' :
      tier === 'orange' ? 'bg-orange-500' :
      tier === 'red' ? 'bg-red-600' :
      'bg-gray-400';

  // A simple, touch-friendly pin dot. Tailwind classes apply because the marker is injected into the same document.
  return `<div class="${className} w-4 h-4 rounded-full border-2 border-white shadow"></div>`;
}

// ============================================================
// COMPONENT
// ============================================================

export function MapContainer({
  centerLat = 39.5,
  centerLng = -98.35,
  zoom = 4,
  services = [],
  onBoundsChange,
  className = '',
}: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const markersRef = useRef<atlas.HtmlMarker[]>([]);
  const popupRef = useRef<atlas.Popup | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // If the parent provides a new center/zoom (e.g. after opt-in geolocation),
  // re-center the map. This component never requests device location itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isLoading) return;

    map.setCamera({ center: [centerLng, centerLat], zoom });
  }, [centerLat, centerLng, isLoading, zoom]);

  // ── extract plottable pins ────────────────────────────────
  const pins: Pin[] = useMemo(() => {
    const raw = services.map((s) => ({
      id: s.service.id,
      name: s.service.name,
      orgName: s.organization?.name ?? '',
      orgLogoUrl: s.organization?.logoUrl ?? null,
      confidenceScore: s.confidenceScore?.score ?? null,
      lat: s.location?.latitude ?? null,
      lng: s.location?.longitude ?? null,
    }));

    return raw.filter((p): p is Pin => typeof p.lat === 'number' && typeof p.lng === 'number');
  }, [services]);

  // ── fetch key from server-side broker ─────────────────────
  const fetchKey = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/maps/token', {
        credentials: 'same-origin',
        cache: 'default', // browser respects Cache-Control: private, max-age=300
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { subscriptionKey?: string };
      return body.subscriptionKey ?? null;
    } catch {
      return null;
    }
  }, []);

  // ── initialise map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // already initialised

    let cancelled = false;

    (async () => {
      const key = await fetchKey();
      if (cancelled) return;

      if (!key) {
        setMapError('Azure Maps is not configured. Contact your administrator.');
        setIsLoading(false);
        return;
      }

      try {
        const map = new atlas.Map(containerRef.current!, {
          center: [centerLng, centerLat],
          zoom,
          language: 'en-US',
          view: 'Auto',
          style: 'road',
          authOptions: {
            authType: atlas.AuthenticationType.subscriptionKey,
            subscriptionKey: key,
          },
        });

        const popup = new atlas.Popup({ closeButton: true, pixelOffset: [0, -18] });
        popupRef.current = popup;
        mapRef.current = map;

        map.events.add('ready', () => {
          if (cancelled) return;
          setIsLoading(false);

          // Fire initial bounds
          if (onBoundsChange) {
            const cam = map.getCamera();
            const b = cam.bounds;
            if (b) {
              onBoundsChange({
                minLng: b[0],
                minLat: b[1],
                maxLng: b[2],
                maxLat: b[3],
              });
            }
          }
        });

        // Emit bounds on moveend (for bbox queries)
        if (onBoundsChange) {
          map.events.add('moveend', () => {
            const cam = map.getCamera();
            const b = cam.bounds;
            if (b) {
              onBoundsChange({
                minLng: b[0],
                minLat: b[1],
                maxLng: b[2],
                maxLat: b[3],
              });
            }
          });
        }
      } catch (e) {
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : 'Failed to initialise Azure Maps');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        markersRef.current = [];
        popupRef.current = null;
        mapRef.current?.dispose();
      } finally {
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run on mount
  }, []);

  // ── update markers + popups when pins change ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const popup = popupRef.current;

    // clear previous markers
    if (markersRef.current.length > 0) {
      map.markers.remove(markersRef.current);
      markersRef.current = [];
    }

    const nextMarkers: atlas.HtmlMarker[] = [];

    for (const pin of pins) {
      const tier =
        typeof pin.confidenceScore === 'number' && Number.isFinite(pin.confidenceScore)
          ? getConfidenceTier(Math.max(0, Math.min(100, pin.confidenceScore)))
          : 'unknown';

      const marker = new atlas.HtmlMarker({
        position: [pin.lng, pin.lat],
        htmlContent: markerHtml(tier),
      });

      // popup on click
      if (popup) {
        map.events.add('click', marker, () => {
          popup.setOptions({
            position: [pin.lng, pin.lat],
            content: popupContent(pin),
          });
          popup.open(map);
        });
      }

      nextMarkers.push(marker);
    }

    if (nextMarkers.length > 0) {
      map.markers.add(nextMarkers);
      markersRef.current = nextMarkers;

      // Auto-fit the camera to the pins with padding
      if (pins.length === 1) {
        map.setCamera({ center: [pins[0].lng, pins[0].lat], zoom: 13 });
      } else if (pins.length > 1) {
        const positions = pins.map((p) => [p.lng, p.lat] as [number, number]);
        const bb = atlas.data.BoundingBox.fromPositions(positions);
        map.setCamera({ bounds: bb, padding: 60 });
      }
    }
  }, [pins]);

  // ── loading state ─────────────────────────────────────────
  if (isLoading && !mapError) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 ${className}`}
        role="status"
        aria-label="Loading map"
      >
        <div className="flex flex-col items-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-hidden="true" />
          <p className="text-sm text-gray-500">Loading map…</p>
        </div>
      </div>
    );
  }

  // ── error state ───────────────────────────────────────────
  if (mapError) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-gray-200 bg-white p-6 text-center ${className}`}
        role="alert"
      >
        <div className="max-w-md">
          <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-gray-900">Map unavailable</p>
          <p className="mt-1 text-xs text-gray-500">{mapError}</p>
        </div>
      </div>
    );
  }

  // ── map canvas ────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={`rounded-lg border border-gray-200 overflow-hidden bg-gray-100 ${className}`}
      role="region"
      aria-label="Interactive service map"
    />
  );
}

export default MapContainer;
