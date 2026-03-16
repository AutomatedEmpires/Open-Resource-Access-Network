/**
 * ORAN Map Container — Azure Maps
 *
 * Safety / Privacy:
 * - Does NOT request device location (any device location use must be explicit
 *   and happen at the page level).
 * - Plots only coordinates from stored, verified records.
 * - Scoped Azure Maps auth is fetched from /api/maps/token (server-side broker)
 *   so the raw shared key never appears in the client.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as atlas from 'azure-maps-control';
import 'azure-maps-control/dist/atlas.min.css';
import { AlertTriangle, Loader2 } from 'lucide-react';

import type { EnrichedService } from '@/domain/types';
import { getConfidenceTier } from '@/domain/confidence';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';
import { LeafletFallback } from './LeafletFallback';

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
  /** Shareable discovery context for popup detail links. */
  discoveryContext?: DiscoveryLinkState;
  /** Callback when map viewport changes (for bbox queries) */
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  className?: string;
}

interface MapsClientAuthResponse {
  authType: 'sas';
  sasToken: string;
}

// ============================================================
// POPUP HELPERS
// ============================================================

function popupContent(pin: Pin, discoveryContext?: DiscoveryLinkState): string {
  const safeLogo = safeHttpUrl(pin.orgLogoUrl ?? null);
  const detailHref = buildDiscoveryHref(`/service/${encodeURIComponent(pin.id)}`, discoveryContext ?? {});

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
      <a href="${escapeAttribute(detailHref)}" style="font-size:12px;color:#1d4ed8;text-decoration:none;font-weight:600">View service</a>
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
  discoveryContext,
  onBoundsChange,
  className = '',
}: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const markersRef = useRef<atlas.HtmlMarker[]>([]);
  const popupRef = useRef<atlas.Popup | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [useLeafletFallback, setUseLeafletFallback] = useState(false);

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

  // ── fetch scoped auth from server-side broker ─────────────
  const fetchMapsAuth = useCallback(async (): Promise<MapsClientAuthResponse | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch('/api/maps/token', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<MapsClientAuthResponse>;
      if (body.authType !== 'sas' || !body.sasToken) {
        return null;
      }
      return {
        authType: 'sas',
        sasToken: body.sasToken,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  // ── initialise map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // already initialised

    let cancelled = false;
    let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const mapsAuth = await fetchMapsAuth();
      if (cancelled) return;

      if (!mapsAuth) {
        setUseLeafletFallback(true);
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
            authType: atlas.AuthenticationType.sas,
            sasToken: mapsAuth.sasToken,
          },
        });

        const popup = new atlas.Popup({ closeButton: true, pixelOffset: [0, -18] });
        popupRef.current = popup;
        mapRef.current = map;
        map.controls.add(new atlas.control.ScaleControl({ maxWidth: 120, unit: 'imperial' }), {
          position: atlas.ControlPosition.BottomLeft,
        });
        readyTimeoutId = setTimeout(() => {
          if (cancelled || mapRef.current !== map) return;
          setUseLeafletFallback(true);
          setIsLoading(false);
        }, 5000);

        map.events.add('ready', () => {
          if (cancelled) return;
          if (readyTimeoutId) {
            clearTimeout(readyTimeoutId);
            readyTimeoutId = null;
          }
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
        if (readyTimeoutId) {
          clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : 'Failed to initialise Azure Maps');
          setUseLeafletFallback(true);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (readyTimeoutId) {
        clearTimeout(readyTimeoutId);
      }
      try {
        markersRef.current = [];
        popupRef.current = null;
        mapRef.current?.dispose();
      } finally {
        mapRef.current = null;
      }
    };
  }, [centerLat, centerLng, fetchMapsAuth, onBoundsChange, zoom]);

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
            content: popupContent(pin, discoveryContext),
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
  }, [discoveryContext, pins]);

  // ── keyboard navigation ───────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!map) return;

    const cam = map.getCamera();
    const center = cam.center as [number, number] | undefined;
    const zoom = typeof cam.zoom === 'number' ? cam.zoom : 4;
    const delta = 0.1 / Math.pow(2, zoom - 4); // pan step shrinks as zoom increases

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (center) map.setCamera({ center: [center[0], center[1] + delta] });
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (center) map.setCamera({ center: [center[0], center[1] - delta] });
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (center) map.setCamera({ center: [center[0] - delta, center[1]] });
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (center) map.setCamera({ center: [center[0] + delta, center[1]] });
        break;
      case '+':
      case '=':
        e.preventDefault();
        map.setCamera({ zoom: zoom + 1 });
        break;
      case '-':
        e.preventDefault();
        map.setCamera({ zoom: Math.max(1, zoom - 1) });
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        map.setCamera({ center: [centerLng, centerLat], zoom });
        break;
      default:
        break;
    }
  }, [centerLat, centerLng]);

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

  // ── OpenStreetMap fallback (no Azure Maps key configured) ─
  if (useLeafletFallback) {
    return (
      <LeafletFallback
        centerLat={centerLat}
        centerLng={centerLng}
        zoom={zoom}
        services={services}
        discoveryContext={discoveryContext}
        onBoundsChange={onBoundsChange}
        className={className}
      />
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
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={`rounded-lg border border-gray-200 overflow-hidden bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
        role="application"
        aria-label="Interactive service map. Arrow keys to pan, + and - to zoom, R to reset."
      />
      <p className="mt-1 text-xs text-gray-500">
        Keyboard: Arrow keys to pan, <kbd className="font-mono">+</kbd> / <kbd className="font-mono">-</kbd> to zoom, <kbd className="font-mono">R</kbd> to reset.{' '}
        <a href="#map-results" className="underline text-blue-600 hover:text-blue-800">
          Skip to results
        </a>
      </p>
    </>
  );
}

export default MapContainer;
