/**
 * ORAN Map Container
 * Placeholder for the interactive map surface.
 * Actual map library (Mapbox/Leaflet) to be integrated via feature flag.
 */

'use client';

import React from 'react';
import { MapPin } from 'lucide-react';

interface MapContainerProps {
  /** Initial center latitude */
  centerLat?: number;
  /** Initial center longitude */
  centerLng?: number;
  /** Initial zoom level */
  zoom?: number;
  className?: string;
}

/**
 * MapContainer
 *
 * Placeholder component. When 'map_enabled' feature flag is active and
 * a map library is configured, this renders an interactive PostGIS-backed map.
 * Services are loaded from /api/search with bbox queries on pan/zoom.
 */
export function MapContainer({
  centerLat = 39.5,
  centerLng = -98.35,
  zoom = 4,
  className = '',
}: MapContainerProps) {
  return (
    <div
      className={`relative flex items-center justify-center bg-gray-100 rounded-lg border border-gray-200 min-h-[400px] ${className}`}
      role="region"
      aria-label="Interactive service map (loading)"
    >
      {/* Placeholder grid pattern to suggest a map */}
      <div className="absolute inset-0 overflow-hidden rounded-lg opacity-30">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#94a3b8" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Center marker */}
      <div className="relative z-10 text-center text-gray-500">
        <MapPin className="h-12 w-12 mx-auto text-blue-400 mb-2" aria-hidden="true" />
        <p className="text-sm font-medium">Interactive Map</p>
        <p className="text-xs text-gray-400 mt-1">
          Map loading... Services will appear as pins when map library is configured.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Center: {centerLat.toFixed(4)}, {centerLng.toFixed(4)} · Zoom: {zoom}
        </p>
      </div>
    </div>
  );
}

export default MapContainer;
