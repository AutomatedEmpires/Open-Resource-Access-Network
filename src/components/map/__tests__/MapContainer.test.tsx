// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnrichedService } from '@/domain/types';

const mapContainerProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const tileLayerProps = vi.hoisted(() => [] as Array<Record<string, any>>);
const markerProps = vi.hoisted(() => [] as Array<Record<string, any>>);
const mapEventHandlers = vi.hoisted(() => ({ current: {} as Record<string, () => void> }));
const divIconMock = vi.hoisted(() => vi.fn((options: unknown) => ({ kind: 'div-icon', options })));
const mapMock = vi.hoisted(() => {
  const bounds = {
    getSouth: vi.fn(() => 24.4),
    getWest: vi.fn(() => -125),
    getNorth: vi.fn(() => 49.4),
    getEast: vi.fn(() => -66.8),
  };

  return {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => bounds),
  };
});

vi.mock('leaflet', () => ({
  default: {
    divIcon: divIconMock,
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    mapContainerProps.push(props);
    return <div data-testid="react-leaflet-map">{children}</div>;
  },
  TileLayer: (props: Record<string, any>) => {
    tileLayerProps.push(props);
    return (
      <div data-testid="tile-layer">
        <button type="button" onClick={() => props.eventHandlers?.load?.()}>
          Finish tile loading
        </button>
        <button type="button" onClick={() => props.eventHandlers?.loading?.()}>
          Restart tile loading
        </button>
        <button type="button" onClick={() => props.eventHandlers?.tileerror?.()}>
          Fail tile loading
        </button>
      </div>
    );
  },
  Marker: ({ children, ...props }: React.PropsWithChildren<Record<string, any>>) => {
    markerProps.push(props);
    return <div data-testid="map-marker">{children}</div>;
  },
  Popup: ({ children }: React.PropsWithChildren) => <div data-testid="map-popup">{children}</div>,
  ScaleControl: () => <div data-testid="scale-control" />,
  useMap: () => mapMock,
  useMapEvents: (handlers: Record<string, () => void>) => {
    mapEventHandlers.current = handlers;
    return mapMock;
  },
}));

import { MapContainer } from '../MapContainer';

function makeService({
  id,
  name,
  lat,
  lng,
  orgName = 'Community Partner',
  score = 85,
}: {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  orgName?: string;
  score?: number | null;
}): EnrichedService {
  return {
    service: { id, name },
    organization: { name: orgName },
    location: { latitude: lat, longitude: lng },
    confidenceScore: score == null ? null : { score },
  } as EnrichedService;
}

beforeEach(() => {
  vi.clearAllMocks();
  mapContainerProps.length = 0;
  tileLayerProps.length = 0;
  markerProps.length = 0;
  mapEventHandlers.current = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MapContainer OpenStreetMap implementation', () => {
  it('starts on a nationwide view with OpenStreetMap attribution and no location request', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<MapContainer className="h-96" />);

    expect(screen.getByRole('application', { name: /interactive service map/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading map' })).toBeInTheDocument();
    expect(screen.getByTestId('scale-control')).toBeInTheDocument();
    expect(mapContainerProps[0]).toEqual(expect.objectContaining({
      center: [39.5, -98.35],
      zoom: 4,
      minZoom: 2,
      maxZoom: 19,
      keyboard: true,
      worldCopyJump: true,
    }));
    expect(tileLayerProps[0]).toEqual(expect.objectContaining({
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: expect.stringContaining('OpenStreetMap'),
      maxNativeZoom: 19,
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Finish tile loading' }));
    expect(await screen.findByText('No mappable resources in this view yet.')).toBeInTheDocument();
  });

  it('plots only finite, in-range coordinates and keeps discovery state in result links', async () => {
    render(
      <MapContainer
        className="h-96"
        services={[
          makeService({ id: 'valid', name: 'Food Pantry', lat: 47.61, lng: -122.33, score: 90 }),
          makeService({ id: 'missing', name: 'Phone Help', lat: null, lng: null }),
          makeService({ id: 'nan', name: 'Bad Coordinate', lat: Number.NaN, lng: -122.1 }),
          makeService({ id: 'range', name: 'Outside Earth', lat: 120, lng: -122.1 }),
        ]}
        discoveryContext={{
          text: 'food',
          needId: 'food_assistance',
          confidenceFilter: 'HIGH',
          sortBy: 'distance',
        }}
      />,
    );

    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);
    expect(markerProps[0]).toEqual(expect.objectContaining({
      position: [47.61, -122.33],
      keyboard: true,
      alt: 'Food Pantry map marker',
      title: 'Food Pantry — Community Partner',
    }));
    expect(divIconMock).toHaveBeenCalledWith(expect.objectContaining({
      className: 'oran-map-pin',
      html: expect.stringContaining('#020617'),
    }));
    expect(screen.getByRole('link', { name: 'View service' })).toHaveAttribute(
      'href',
      '/service/valid?q=food&confidence=HIGH&sort=distance&category=food_assistance',
    );

    await waitFor(() => {
      expect(mapMock.setView).toHaveBeenCalledWith([47.61, -122.33], 13);
    });
  });

  it('fits multiple results and reports initial and moved viewport bounds', async () => {
    const onBoundsChange = vi.fn();

    render(
      <MapContainer
        className="h-96"
        services={[
          makeService({ id: 'one', name: 'Shelter', lat: 47.61, lng: -122.33 }),
          makeService({ id: 'two', name: 'Clinic', lat: 40.71, lng: -74.01 }),
        ]}
        onBoundsChange={onBoundsChange}
      />,
    );

    await waitFor(() => {
      expect(mapMock.fitBounds).toHaveBeenCalledWith(
        [
          [47.61, -122.33],
          [40.71, -74.01],
        ],
        { padding: [60, 60], maxZoom: 13 },
      );
      expect(onBoundsChange).toHaveBeenCalledWith({
        minLat: 24.4,
        minLng: -125,
        maxLat: 49.4,
        maxLng: -66.8,
      });
    });

    mapEventHandlers.current.moveend();
    expect(onBoundsChange).toHaveBeenCalledTimes(2);
  });

  it('falls back to the nationwide center for invalid caller coordinates', () => {
    render(
      <MapContainer
        className="h-96"
        centerLat={Number.NaN}
        centerLng={500}
        zoom={8}
      />,
    );

    expect(mapContainerProps[0]).toEqual(expect.objectContaining({
      center: [39.5, -98.35],
      zoom: 8,
    }));
  });

  it('keeps resource results usable when the tile provider fails', async () => {
    render(
      <MapContainer
        className="h-96"
        services={[makeService({ id: 'one', name: 'Legal Aid', lat: null, lng: null })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fail tile loading' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Map tiles are temporarily unavailable. Resource results remain available below.',
    );
    expect(screen.queryByRole('status', { name: 'Loading map' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart tile loading' }));
    expect(screen.getByRole('status', { name: 'Loading map' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains resources that have no precise map location', async () => {
    render(
      <MapContainer
        className="h-96"
        services={[makeService({ id: 'phone', name: 'Phone Support', lat: null, lng: null })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Finish tile loading' }));

    expect(await screen.findByText(
      'These resources do not include a precise map location. Review the results list below.',
    )).toBeInTheDocument();
  });
});
