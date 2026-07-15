/**
 * ORAN seeker map.
 *
 * OpenStreetMap tiles are rendered through Leaflet. This component deliberately
 * never requests device location; callers may update its center only after an
 * explicit user action.
 */

'use client';

import React from 'react';

import { LeafletFallback, type LeafletFallbackProps } from './LeafletFallback';

/** Stable public contract used by the seeker map page. */
export type MapContainerProps = LeafletFallbackProps;

export function MapContainer(props: MapContainerProps) {
  return <LeafletFallback {...props} />;
}

export default MapContainer;
