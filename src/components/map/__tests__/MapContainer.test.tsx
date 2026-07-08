// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ── Mock leaflet (default import) — divIcon returns an opaque stub ───────────
vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn(() => ({ _icon: true })) },
}));

// ── Mock react-leaflet with lightweight DOM stand-ins ────────────────────────
const useMapEventsMock = vi.hoisted(() => vi.fn());
const setViewMock = vi.hoisted(() => vi.fn());
const getBoundsMock = vi.hoisted(() =>
  vi.fn(() => ({
    getSouth: () => 10,
    getWest: () => 20,
    getNorth: () => 30,
    getEast: () => 40,
  })),
);

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'leaflet-map' }, children),
  TileLayer: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'tile-layer', 'data-url': props.url as string }),
  Marker: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'marker' }, children),
  Popup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'popup' }, children),
  ScaleControl: () => React.createElement('div', { 'data-testid': 'scale' }),
  useMap: () => ({ setView: setViewMock, getBounds: getBoundsMock }),
  useMapEvents: useMapEventsMock,
}));

import { MapContainer } from '../MapContainer';

function svc(id: string, name: string, lat: number | null, lng: number | null, score: number | null) {
  return {
    service: { id, name },
    organization: { name: `${name} Org` },
    confidenceScore: score === null ? null : { score },
    location: lat === null || lng === null ? null : { latitude: lat, longitude: lng },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MapContainer (OpenStreetMap / Leaflet)', () => {
  it('renders an OpenStreetMap tile layer (tokenless, no Azure)', () => {
    render(<MapContainer services={[]} />);
    const tile = screen.getByTestId('tile-layer');
    expect(tile.getAttribute('data-url')).toContain('tile.openstreetmap.org');
  });

  it('plots only services that have coordinates', () => {
    render(
      <MapContainer
        services={[
          svc('a', 'Food Pantry', 47.6, -122.3, 90),
          svc('b', 'No Coords Clinic', null, null, 50),
          svc('c', 'Shelter', 40.7, -74.0, null),
        ]}
      />,
    );
    // Two of three services have coordinates → two markers.
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    expect(screen.getByText('Food Pantry')).toBeTruthy();
    expect(screen.getByText('Shelter')).toBeTruthy();
    expect(screen.queryByText('No Coords Clinic')).toBeNull();
  });

  it('builds a discovery-aware detail link in each popup', () => {
    render(<MapContainer services={[svc('svc-42', 'Legal Aid', 33.4, -112.0, 80)]} />);
    const link = screen.getByText('View service').closest('a');
    expect(link?.getAttribute('href')).toContain('/service/svc-42');
  });

  it('emits initial viewport bounds on mount for bbox queries', () => {
    const onBoundsChange = vi.fn();
    render(<MapContainer services={[]} onBoundsChange={onBoundsChange} />);
    expect(onBoundsChange).toHaveBeenCalledWith({
      minLat: 10,
      minLng: 20,
      maxLat: 30,
      maxLng: 40,
    });
  });

  it('exposes a keyboard hint and a skip-to-results affordance', () => {
    render(<MapContainer services={[]} />);
    expect(screen.getByText('Skip to results').closest('a')?.getAttribute('href')).toBe('#map-results');
  });
});
