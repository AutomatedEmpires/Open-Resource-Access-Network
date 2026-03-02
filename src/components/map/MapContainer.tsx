/**
 * ORAN Map Container — Azure Maps
 *
 * Safety / Privacy:
 * - Does NOT request device location.
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

// ============================================================
// TYPES
// ============================================================

interface Pin {
  id: string;
  name: string;
  orgName: string;
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
  return `<div style="padding:8px 12px;max-width:220px;font-family:system-ui,sans-serif">
    <p style="margin:0;font-weight:600;font-size:14px;color:#111">${escapeHtml(pin.name)}</p>
    <p style="margin:2px 0 0;font-size:12px;color:#666">${escapeHtml(pin.orgName)}</p>
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  // ── extract plottable pins ────────────────────────────────
  const pins: Pin[] = useMemo(() => {
    return services
      .map((s) => ({
        id: s.service.id,
        name: s.service.name,
        orgName: s.organization?.name ?? '',
        lat: s.location?.latitude ?? null,
        lng: s.location?.longitude ?? null,
      }))
      .filter((p): p is Pin => typeof p.lat === 'number' && typeof p.lng === 'number');
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
      const marker = new atlas.HtmlMarker({
        position: [pin.lng, pin.lat],
        color: '#2563eb', // blue-600
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
