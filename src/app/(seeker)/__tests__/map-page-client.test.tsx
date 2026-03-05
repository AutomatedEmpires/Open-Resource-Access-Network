// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockMapContainer(props: {
      services: Array<unknown>;
      onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
    }) {
      return (
        <div data-testid="map-container">
          <span data-testid="map-service-count">{props.services.length}</span>
          <button
            type="button"
            onClick={() => props.onBoundsChange?.({ minLat: 10, minLng: 20, maxLat: 30, maxLng: 40 })}
          >
            emit-bounds
          </button>
        </div>
      );
    };
  },
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="skeleton-card">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/directory/ServiceCard', () => ({
  ServiceCard: ({ enriched }: { enriched: { service: { id: string; name: string } } }) => (
    <div data-testid={`map-service-card-${enriched.service.id}`}>{enriched.service.name}</div>
  ),
}));

const toastSuccessMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: vi.fn(),
    success: toastSuccessMock,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

import MapPage from '@/app/(seeker)/map/MapPageClient';

function renderWithToast(ui: React.ReactElement) {
  return render(ui);
}

function makeSearchResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        service: {
          service: { id: 'svc-1', name: 'Shelter' },
          location: { latitude: 47.61, longitude: -122.33 },
        },
      },
      {
        service: {
          service: { id: 'svc-2', name: 'Food Pantry' },
          location: { latitude: null, longitude: null },
        },
      },
    ],
    total: 2,
    page: 1,
    limit: 50,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('MapPageClient', () => {
  it('renders initial state and waits for a manual search', () => {
    renderWithToast(<MapPage />);

    expect(screen.getByRole('heading', { name: 'Service Map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('runs text search and shows pin coverage + mapped results', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse(),
    });

    renderWithToast(<MapPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'shelter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Shelter');
    expect(screen.getByRole('status')).toHaveTextContent('2 of 2 shown');
    expect(screen.getByTestId('map-service-count')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Search this area' })).toBeInTheDocument();
  });

  it('re-queries with bbox in "search this area" mode and debounces pan updates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse(),
      });

    renderWithToast(<MapPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Shelter');

    fireEvent.click(screen.getByRole('button', { name: 'emit-bounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search this area' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bboxUrl = String(fetchMock.mock.calls[1]?.[0]);
      expect(bboxUrl).toContain('minLat=10');
      expect(bboxUrl).toContain('minLng=20');
      expect(bboxUrl).toContain('maxLat=30');
      expect(bboxUrl).toContain('maxLng=40');
    });

    fireEvent.click(screen.getByRole('button', { name: 'emit-bounds' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }, { timeout: 1300 });
  });

  it('shows inline error details when search requests fail', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'search service unavailable' }),
    });

    renderWithToast(<MapPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'legal aid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Search failed');
    expect(screen.getByText('search service unavailable')).toBeInTheDocument();
  });

  it('does not bbox-query until bounds exist and then supports mobile list toggle', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse(),
    });

    renderWithToast(<MapPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'shelter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Shelter');

    fireEvent.click(screen.getByRole('button', { name: 'Search this area' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'List (2)' }));
    expect(screen.getByRole('button', { name: 'Map view' })).toBeInTheDocument();
  });

  it('shows no-match state and supports clearing typed query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse({ results: [], total: 0, hasMore: false }),
    });

    renderWithToast(<MapPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'rare query' },
    });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services to plot' }), {
      target: { value: 'rare query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findAllByText('No matches')).toHaveLength(2);
    expect(await screen.findByText('Try different keywords or pan to a new area.')).toBeInTheDocument();
  });
});
