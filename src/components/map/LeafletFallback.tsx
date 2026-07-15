/**
 * OpenStreetMap tile map rendered with react-leaflet.
 *
 * The historical export name is retained so existing imports remain stable,
 * but this is now ORAN's primary map implementation rather than a fallback.
 * OpenStreetMap attribution is rendered by Leaflet on the map.
 *
 * Safety / privacy:
 * - Does not request or watch device location.
 * - Plots only valid coordinates supplied by the caller.
 * - Keeps usable result links available when map tiles fail to load.
 */

'use client';

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import L, { type LatLngTuple } from 'leaflet';
import {
  MapContainer as ReactLeafletMap,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { getConfidenceTier } from '@/domain/confidence';
import type { EnrichedService } from '@/domain/types';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';

interface Pin {
  id: string;
  name: string;
  orgName: string;
  confidenceScore: number | null;
  lat: number;
  lng: number;
}

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface LeafletFallbackProps {
  /** Initial or explicitly selected center latitude. */
  centerLat?: number;
  /** Initial or explicitly selected center longitude. */
  centerLng?: number;
  /** Initial zoom level. */
  zoom?: number;
  /** Services to plot. Records without valid coordinates remain off-map. */
  services?: EnrichedService[];
  /** Shareable discovery context for popup detail links. */
  discoveryContext?: DiscoveryLinkState;
  /** Called after the map settles on a new viewport. */
  onBoundsChange?: (bounds: MapBounds) => void;
  className?: string;
}

const DEFAULT_CENTER: LatLngTuple = [39.5, -98.35];
const DEFAULT_ZOOM = 4;
const MAP_STATUS_LAYER_STYLE = { zIndex: 800 } as const;

const TIER_COLOUR: Record<string, string> = {
  green: '#020617',
  yellow: '#334155',
  orange: '#64748b',
  red: '#cbd5e1',
  unknown: '#94a3b8',
};

function makePinIcon(tier: string): L.DivIcon {
  const colour = TIER_COLOUR[tier] ?? TIER_COLOUR.unknown;

  return L.divIcon({
    className: 'oran-map-pin',
    html: `<span aria-hidden="true" style="display:block;width:16px;height:16px;border-radius:9999px;background:${colour};border:2px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.42)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -12],
  });
}

function toValidCoordinates(lat: unknown, lng: unknown): LatLngTuple | null {
  const isValid = (
    typeof lat === 'number'
    && Number.isFinite(lat)
    && lat >= -90
    && lat <= 90
    && typeof lng === 'number'
    && Number.isFinite(lng)
    && lng >= -180
    && lng <= 180
  );

  return isValid ? [lat as number, lng as number] : null;
}

function readBounds(map: ReturnType<typeof useMap>): MapBounds {
  const bounds = map.getBounds();
  return {
    minLat: bounds.getSouth(),
    minLng: bounds.getWest(),
    maxLat: bounds.getNorth(),
    maxLng: bounds.getEast(),
  };
}

function MapController({
  center,
  zoom,
  pinPositions,
  onBoundsChange,
}: {
  center: LatLngTuple;
  zoom: number;
  pinPositions: LatLngTuple[];
  onBoundsChange?: (bounds: MapBounds) => void;
}) {
  const map = useMap();

  const emitBounds = useCallback(() => {
    onBoundsChange?.(readBounds(map));
  }, [map, onBoundsChange]);

  useMapEvents({
    moveend: emitBounds,
  });

  // Parent center changes only occur after an explicit action in the seeker UI.
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, map, zoom]);

  // Match the previous map contract: focus a single result and fit a result set.
  useEffect(() => {
    if (pinPositions.length === 1) {
      map.setView(pinPositions[0], 13);
    } else if (pinPositions.length > 1) {
      map.fitBounds(pinPositions, {
        padding: [60, 60],
        maxZoom: 13,
      });
    }
  }, [map, pinPositions]);

  useEffect(() => {
    emitBounds();
  }, [emitBounds]);

  return null;
}

export function LeafletFallback({
  centerLat = DEFAULT_CENTER[0],
  centerLng = DEFAULT_CENTER[1],
  zoom = DEFAULT_ZOOM,
  services = [],
  discoveryContext,
  onBoundsChange,
  className = '',
}: LeafletFallbackProps) {
  const keyboardHelpId = useId();
  const [isTileLoading, setIsTileLoading] = useState(true);
  const [tileError, setTileError] = useState(false);

  const center = useMemo<LatLngTuple>(() => {
    return toValidCoordinates(centerLat, centerLng) ?? DEFAULT_CENTER;
  }, [centerLat, centerLng]);

  const pins = useMemo<Pin[]>(() => {
    return services.flatMap((service) => {
      const lat = service.location?.latitude;
      const lng = service.location?.longitude;
      const coordinates = toValidCoordinates(lat, lng);
      if (!coordinates) return [];

      return [{
        id: service.service.id,
        name: service.service.name,
        orgName: service.organization?.name ?? '',
        confidenceScore: service.confidenceScore?.score ?? null,
        lat: coordinates[0],
        lng: coordinates[1],
      }];
    });
  }, [services]);

  const pinPositions = useMemo<LatLngTuple[]>(
    () => pins.map((pin) => [pin.lat, pin.lng]),
    [pins],
  );

  const emptyMessage = services.length === 0
    ? 'No mappable resources in this view yet.'
    : 'These resources do not include a precise map location. Review the results list below.';

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-within:ring-2 focus-within:ring-blue-700 ${className}`}
      role="application"
      aria-label="Interactive service map. Arrow keys to pan, plus and minus keys to zoom."
      aria-describedby={keyboardHelpId}
    >
      <ReactLeafletMap
        center={center}
        zoom={zoom}
        minZoom={2}
        maxZoom={19}
        scrollWheelZoom
        keyboard
        worldCopyJump
        className="h-full w-full bg-slate-100"
        style={{ minHeight: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxNativeZoom={19}
          eventHandlers={{
            loading: () => {
              setIsTileLoading(true);
              setTileError(false);
            },
            load: () => setIsTileLoading(false),
            tileerror: () => {
              setIsTileLoading(false);
              setTileError(true);
            },
          }}
        />
        <ScaleControl position="bottomleft" imperial metric={false} />

        <MapController
          center={center}
          zoom={zoom}
          pinPositions={pinPositions}
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
            <Marker
              key={pin.id}
              position={[pin.lat, pin.lng]}
              icon={makePinIcon(tier)}
              keyboard
              alt={`${pin.name} map marker`}
              title={pin.orgName ? `${pin.name} — ${pin.orgName}` : pin.name}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-slate-950">{pin.name}</p>
                  {pin.orgName ? (
                    <p className="mt-0.5 text-xs text-slate-600">{pin.orgName}</p>
                  ) : null}
                  <a
                    href={serviceHref}
                    className="mt-2 block text-xs font-semibold text-blue-800 hover:underline"
                  >
                    View service
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </ReactLeafletMap>

      {isTileLoading ? (
        <div
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-slate-300 bg-white/95 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
          style={MAP_STATUS_LAYER_STYLE}
          role="status"
          aria-label="Loading map"
        >
          Loading map…
        </div>
      ) : null}

      {tileError ? (
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 rounded-lg border border-amber-300 bg-white/95 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm"
          style={MAP_STATUS_LAYER_STYLE}
          role="alert"
        >
          Map tiles are temporarily unavailable. Resource results remain available below.
        </div>
      ) : null}

      {pins.length === 0 && !isTileLoading && !tileError ? (
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 mx-auto max-w-sm rounded-lg border border-slate-300 bg-white/95 px-3 py-2 text-center text-xs font-medium text-slate-700 shadow-sm"
          style={MAP_STATUS_LAYER_STYLE}
          role="status"
          aria-live="polite"
        >
          {emptyMessage}
        </div>
      ) : null}

      <p id={keyboardHelpId} className="sr-only">
        Use Arrow keys to pan and plus or minus keys to zoom. Use the skip link in the page to move to resource results.
      </p>
    </div>
  );
}
