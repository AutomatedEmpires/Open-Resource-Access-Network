/**
 * LeafletFallback — OpenStreetMap tile-based map rendered with react-leaflet.
 *
 * Used automatically when AZURE_MAPS_KEY is not configured.
 * No API key required — tiles are served by the OpenStreetMap Foundation
 * under the ODbL licence. Attribution is required and rendered below the map.
 *
 * Safety / Privacy:
 * - Does NOT request device location.
 * - Plots only coordinates from stored, verified records.
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { EnrichedService } from '@/domain/types';
import { getConfidenceTier } from '@/domain/confidence';

// ─── Fix Leaflet default marker icon paths broken by webpack ────────────────
// react-leaflet/webpack strips the default icon URLs; we override with CDN copies.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface Pin {
  id: string;
  name: string;
  orgName: string;
  confidenceScore: number | null;
  lat: number;
  lng: number;
}

export interface LeafletFallbackProps {
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  services?: EnrichedService[];
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  className?: string;
}

// ─── Confidence-tier → pin colour ────────────────────────────────────────────

const TIER_COLOUR: Record<string, string> = {
  green: '#16a34a',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#dc2626',
  unknown: '#9ca3af',
};

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

// ─── Inner components (need map context from RLMapContainer) ─────────────────

/** Re-centres the map and fires onBoundsChange when relevant props change. */
function MapController({
  centerLat,
  centerLng,
  zoom,
  onBoundsChange,
}: Pick<LeafletFallbackProps, 'centerLat' | 'centerLng' | 'zoom' | 'onBoundsChange'>) {
  const map = useMap();

  // Sync centre/zoom with parent props
  useEffect(() => {
    map.setView([centerLat ?? 39.5, centerLng ?? -98.35], zoom ?? 4);
  }, [map, centerLat, centerLng, zoom]);

  // Emit bounds on every move and on first mount
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

  // Fire initial bounds after mount
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

// ─── Main export ─────────────────────────────────────────────────────────────

export function LeafletFallback({
  centerLat = 39.5,
  centerLng = -98.35,
  zoom = 4,
  services = [],
  onBoundsChange,
  className = '',
}: LeafletFallbackProps) {
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
      {/* Fallback badge — lets operators know which tile provider is active */}
      <div className="mb-1 flex items-center gap-1">
        <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Map preview — configure <code className="font-mono">AZURE_MAPS_KEY</code> for full Azure Maps
        </span>
      </div>

      <div
        role="application"
        aria-label="Interactive service map — OpenStreetMap fallback. Arrow keys to pan, + and − to zoom."
        className="w-full h-full"
      >
      <RLMapContainer
        center={[centerLat, centerLng]}
        zoom={zoom}
        scrollWheelZoom
        className="rounded-lg border border-gray-200 overflow-hidden bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full h-full"
        style={{ minHeight: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

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

          return (
            <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={makePinIcon(tier)}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">{pin.name}</p>
                  {pin.orgName && (
                    <p className="text-gray-500 text-xs mt-0.5">{pin.orgName}</p>
                  )}
                  <a
                    href={`/service/${encodeURIComponent(pin.id)}`}
                    className="mt-2 block text-xs font-semibold text-blue-700 hover:underline"
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

      <p className="mt-1 text-xs text-gray-500">
        Keyboard: Arrow keys to pan,{' '}
        <kbd className="font-mono">+</kbd> / <kbd className="font-mono">-</kbd> to zoom.{' '}
        <a href="#map-results" className="underline text-blue-600 hover:text-blue-800">
          Skip to results
        </a>
      </p>
    </div>
  );
}
