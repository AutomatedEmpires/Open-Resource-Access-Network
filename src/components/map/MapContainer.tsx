/**
 * ORAN Map Container — OpenStreetMap (tokenless)
 *
 * Renders an interactive service map using react-leaflet with OpenStreetMap
 * tiles. No API key, no server-side token broker, and no paid cloud SDK — this
 * replaces the former Azure Maps implementation and aligns ORAN with the
 * portfolio's tokenless map stack.
 *
 * Safety / Privacy:
 * - Does NOT request device location. Any device-location use must be explicit
 *   and happen at the page level (opt-in geolocation, ADR-0006).
 * - Plots ONLY coordinates from stored, verified records.
 *
 * Accessibility:
 * - Leaflet's container is keyboard-navigable when focused (arrow keys pan,
 *   +/- zoom). A visible keyboard hint and a "Skip to results" link are shown
 *   below the map so keyboard and screen-reader users are never trapped.
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Marker,
  Popup,
  ScaleControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { EnrichedService } from '@/domain/types';
import { getConfidenceTier } from '@/domain/confidence';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';

// ============================================================
// TYPES
// ============================================================

interface Pin {
  id: string;
  name: string;
  orgName: string;
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

// ============================================================
// CONFIDENCE-TIER → PIN COLOUR
// ============================================================

const TIER_COLOUR: Record<string, string> = {
  green: '#020617',
  yellow: '#334155',
  orange: '#64748b',
  red: '#cbd5e1',
  unknown: '#94a3b8',
};

/**
 * All markers use an inline DivIcon so there is no dependency on external CDN
 * marker images (and no CSP allowance required).
 */
function makePinIcon(tier: string): L.DivIcon {
  const colour = TIER_COLOUR[tier] ?? TIER_COLOUR['unknown'];
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${colour};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

// ============================================================
// INNER CONTROLLER (needs map context from RLMapContainer)
// ============================================================

/** Re-centres the map and emits onBoundsChange when relevant props change. */
function MapController({
  centerLat,
  centerLng,
  zoom,
  onBoundsChange,
}: Pick<MapContainerProps, 'centerLat' | 'centerLng' | 'zoom' | 'onBoundsChange'>) {
  const map = useMap();

  // Sync centre/zoom with parent props (e.g. after opt-in geolocation).
  useEffect(() => {
    map.setView([centerLat ?? 39.5, centerLng ?? -98.35], zoom ?? 4);
  }, [map, centerLat, centerLng, zoom]);

  // Emit bounds on every move so the page can run bbox queries.
  useMapEvents({
    moveend() {
      if (!onBoundsChange) return;
      const b = map.getBounds();
      onBoundsChange({
        minLat: b.getSouth(),
        minLng: b.getWest(),
        maxLat: b.getNorth(),
        maxLng: b.getEast(),
      });
    },
  });

  // Fire initial bounds after mount.
  useEffect(() => {
    if (!onBoundsChange) return;
    const b = map.getBounds();
    onBoundsChange({
      minLat: b.getSouth(),
      minLng: b.getWest(),
      maxLat: b.getNorth(),
      maxLng: b.getEast(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire once on mount
  }, []);

  return null;
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
  const pins: Pin[] = useMemo(() => {
    return services
      .map((s) => ({
        id: s.service.id,
        name: s.service.name,
        orgName: s.organization?.name ?? '',
        confidenceScore: s.confidenceScore?.score ?? null,
        lat: s.location?.latitude ?? null,
        lng: s.location?.longitude ?? null,
      }))
      .filter((p): p is Pin => typeof p.lat === 'number' && typeof p.lng === 'number');
  }, [services]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div
        role="application"
        aria-label="Interactive service map. Focus the map, then use arrow keys to pan and + / − to zoom."
        className="w-full h-full"
      >
        <RLMapContainer
          center={[centerLat, centerLng]}
          zoom={zoom}
          scrollWheelZoom
          className="h-full w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
          style={{ minHeight: '100%' }}
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <ScaleControl position="bottomleft" imperial metric={false} />

          <MapController
            centerLat={centerLat}
            centerLng={centerLng}
            zoom={zoom}
            onBoundsChange={onBoundsChange}
          />

          {pins.map((pin) => {
            const tier =
              typeof pin.confidenceScore === 'number' && Number.isFinite(pin.confidenceScore)
                ? getConfidenceTier(Math.max(0, Math.min(100, pin.confidenceScore)))
                : 'unknown';
            const serviceHref = buildDiscoveryHref(
              `/service/${encodeURIComponent(pin.id)}`,
              discoveryContext ?? {},
            );

            return (
              <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={makePinIcon(tier)}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold text-slate-900">{pin.name}</p>
                    {pin.orgName && <p className="mt-0.5 text-xs text-slate-500">{pin.orgName}</p>}
                    <a
                      href={serviceHref}
                      className="mt-2 block text-xs font-semibold text-slate-900 hover:underline"
                    >
                      View service
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </RLMapContainer>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Keyboard: focus the map, then Arrow keys to pan,{' '}
        <kbd className="font-mono">+</kbd> / <kbd className="font-mono">-</kbd> to zoom.{' '}
        <a href="#map-results" className="underline text-slate-700 hover:text-slate-900">
          Skip to results
        </a>
      </p>
    </div>
  );
}

export default MapContainer;
