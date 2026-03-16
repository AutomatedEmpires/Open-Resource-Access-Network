// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const mapContainerMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockMapContainer(props: {
      services: Array<unknown>;
      centerLat?: number;
      centerLng?: number;
      zoom?: number;
      discoveryContext?: Record<string, unknown>;
      onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
    }) {
      mapContainerMock(props);
      return (
        <div
          data-testid="map-container"
          data-center-lat={props.centerLat == null ? '' : String(props.centerLat)}
          data-center-lng={props.centerLng == null ? '' : String(props.centerLng)}
          data-zoom={props.zoom == null ? '' : String(props.zoom)}
        >
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

vi.mock('@/components/ui/dialog', () => {
  const DialogContext = React.createContext<{
    open: boolean;
    onOpenChange: (next: boolean) => void;
  }>({
    open: false,
    onOpenChange: () => {},
  });

  return {
    Dialog: ({
      children,
      open = false,
      onOpenChange = () => {},
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
    }) => (
      <DialogContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </DialogContext.Provider>
    ),
    DialogTrigger: ({ children }: { children: React.ReactNode }) => {
      const ctx = React.useContext(DialogContext);
      if (React.isValidElement(children)) {
        const originalOnClick =
          typeof children.props === 'object' && children.props !== null
            ? (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick
            : undefined;
        const el = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
        return React.cloneElement(el, {
          onClick: (e: React.MouseEvent) => {
            originalOnClick?.(e);
            ctx.onOpenChange(true);
          },
        });
      }
      return <button type="button" onClick={() => ctx.onOpenChange(true)}>{children}</button>;
    },
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const ctx = React.useContext(DialogContext);
      if (!ctx.open) return null;
      return <div>{children}</div>;
    },
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('@/components/directory/ServiceCard', () => ({
  ServiceCard: ({
    enriched,
    href,
    isSaved,
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    href?: string;
    isSaved?: boolean;
    onToggleSave?: (id: string) => void;
  }) => (
    <div data-testid={`map-service-card-${enriched.service.id}`}>
      <span>{enriched.service.name}</span>
      {href ? <a href={href}>details-{enriched.service.id}</a> : null}
      <span>{isSaved ? 'saved' : 'not-saved'}</span>
      <button type="button" onClick={() => onToggleSave?.(enriched.service.id)}>
        toggle-{enriched.service.id}
      </button>
    </div>
  ),
}));

const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: vi.fn(),
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: toastInfoMock,
  }),
}));

import MapPage from '@/app/(seeker)/map/MapPageClient';

function renderWithToast(ui: React.ReactElement) {
  return render(ui);
}

function getMapSearchBox() {
  return screen.getByRole('searchbox', { name: /Search services(?: to plot)?/i });
}

function getSearchSubmitButton() {
  return screen.getByRole('button', { name: /^(Search|Search map)$/i });
}

function getRefineMapButton() {
  return screen.getByRole('button', { name: /^(Refine map|Filters)$/i });
}

async function clickUseMyLocationControl() {
  const directButton = screen.queryByRole('button', { name: /^(Use my location|Allow|Allow location|Try again|Try location again)$/i });
  if (directButton) {
    fireEvent.click(directButton);
    return;
  }

  fireEvent.click(screen.getByRole('button', { name: /^Filters(?: \(\d+ active\))?$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^(Use my location|Allow|Allow location|Try again|Try location again)$/i }));
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

type MockApiResponse = {
  ok: boolean;
  body: unknown;
};

function mockApi(searchResponses: MockApiResponse[]) {
  const queue = [...searchResponses];
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/taxonomy/terms')) {
      return {
        ok: true,
        json: async () => ({ terms: [] }),
      } as Response;
    }

    if (url.includes('/api/search?')) {
      const next = queue.shift() ?? { ok: true, body: makeSearchResponse() };
      return {
        ok: next.ok,
        json: async () => next.body,
      } as Response;
    }

    if (url === '/api/saved') {
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }

    return {
      ok: false,
      json: async () => ({ error: `Unexpected request: ${url}` }),
    } as Response;
  });
}

function getSearchCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/search?'));
}

beforeEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  fetchMock.mockReset();
  setMatchMedia(false);
  navigationState.searchParams = new URLSearchParams();
  localStorage.clear();
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(global.navigator, 'geolocation', {
    value: {
      getCurrentPosition: vi.fn(),
    },
    configurable: true,
  });
  mockApi([]);
});

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('MapPageClient', () => {
  it('renders initial state and waits for a manual search', () => {
    renderWithToast(<MapPage />);

    expect(screen.getByRole('heading', { name: 'Map' })).toBeInTheDocument();
    expect(getSearchSubmitButton()).toBeDisabled();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('seeds a blank map entry from the stored seeker discovery preference', async () => {
    localStorage.setItem('oran:seeker-context', JSON.stringify({
      serviceInterests: ['housing'],
      preferredDeliveryModes: ['phone'],
      documentationBarriers: ['no_id'],
      urgencyWindow: 'same_day',
    }));
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);

    await screen.findByText('Shelter');

    const searchUrl = String(getSearchCalls().at(-1)?.[0]);
    expect(searchUrl).toContain('q=housing');
    expect(searchUrl).not.toContain('attributes=');
    expect(replaceMock).toHaveBeenCalledWith(
      '/map?q=housing&category=housing',
      { scroll: false },
    );
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute(
      'href',
      '/directory?q=housing&category=housing',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?q=housing&category=housing',
    );
  });

  it('auto-runs canonical map URLs and keeps the shareable filter state normalized', async () => {
    navigationState.searchParams = new URLSearchParams(
      'category=food&sort=distance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);

    await screen.findByText('Shelter');

    const searchUrl = String(getSearchCalls().at(-1)?.[0]);
    expect(searchUrl).toContain('q=food');
    expect(searchUrl).toContain('sortBy=distance');
    expect(replaceMock).toHaveBeenCalledWith(
      '/map?q=food&sort=distance&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
      { scroll: false },
    );
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute(
      'href',
      '/directory?q=food&sort=distance&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?q=food&sort=distance&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'details-svc-1' })).toHaveAttribute(
      'href',
      '/service/svc-1?q=food&sort=distance&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    expect(mapContainerMock).toHaveBeenLastCalledWith(expect.objectContaining({
      discoveryContext: {
        text: 'food',
        needId: 'food_assistance',
        confidenceFilter: 'all',
        sortBy: 'distance',
        attributeFilters: { delivery: ['virtual'] },
      },
    }));
  });

  it('runs text search and shows pin coverage + mapped results', async () => {
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'shelter' },
    });
    fireEvent.click(getSearchSubmitButton());

    await screen.findByText('Shelter');
    expect(screen.getByRole('status')).toHaveTextContent('2 of 2 shown');
    expect(screen.getByTestId('map-service-count')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Search this area' })).toBeInTheDocument();
    expect(screen.getByText('Also applicable but not pinned')).toBeInTheDocument();
    expect(screen.getByText('No precise map location listed')).toBeInTheDocument();
  });

  it('re-queries with bbox in "search this area" mode and debounces pan updates', async () => {
    mockApi([
      { ok: true, body: makeSearchResponse() },
      { ok: true, body: makeSearchResponse() },
      { ok: true, body: makeSearchResponse() },
    ]);

    renderWithToast(<MapPage />);

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'food' },
    });
    fireEvent.click(getSearchSubmitButton());
    await screen.findByText('Shelter');

    fireEvent.click(screen.getByRole('button', { name: 'emit-bounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search this area' }));

    await waitFor(() => {
      expect(getSearchCalls().length).toBeGreaterThanOrEqual(2);
      const bboxUrl = String(getSearchCalls().at(-1)?.[0]);
      expect(bboxUrl).toContain('minLat=10');
      expect(bboxUrl).toContain('minLng=20');
      expect(bboxUrl).toContain('maxLat=30');
      expect(bboxUrl).toContain('maxLng=40');
    });

    const searchCallCount = getSearchCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'emit-bounds' }));
    await waitFor(() => {
      expect(getSearchCalls().length).toBeGreaterThan(searchCallCount);
    }, { timeout: 1300 });
  });

  it('shows inline error details when search requests fail', async () => {
    mockApi([{ ok: false, body: { error: 'search service unavailable' } }]);

    renderWithToast(<MapPage />);

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'legal aid' },
    });
    fireEvent.click(getSearchSubmitButton());

    await screen.findByText('Search failed');
    expect(screen.getByText('search service unavailable')).toBeInTheDocument();
  });

  it('does not bbox-query until bounds exist and then supports mobile list toggle', async () => {
    setMatchMedia(true);

    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'shelter' },
    });
    fireEvent.click(getSearchSubmitButton());
    await screen.findByText('Shelter');

    expect(getSearchCalls()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Search this area' })).not.toBeInTheDocument();
    expect(getSearchCalls()).toHaveLength(1);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Expand results panel' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Collapse results panel' })).toBeInTheDocument();
  });

  it('shows no-match state and supports clearing typed query', async () => {
    mockApi([
      {
        ok: true,
        body: makeSearchResponse({ results: [], total: 0, hasMore: false }),
      },
    ]);

    renderWithToast(<MapPage />);

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'rare query' },
    });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith('/map', { scroll: false });

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'rare query' },
    });
    fireEvent.click(getSearchSubmitButton());

    expect(await screen.findByText('No matches in this area')).toBeInTheDocument();
    expect(await screen.findByText('Try different keywords or pan to a new area.')).toBeInTheDocument();
  });

  it('surfaces permission-denied geolocation errors', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (
          _onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void,
          onError: (err: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => {
          onError({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
        },
      ),
    };

    Object.defineProperty(global.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });

    renderWithToast(<MapPage />);
    await clickUseMyLocationControl();
    await waitFor(() => {
      expect(toastInfoMock).toHaveBeenCalledWith('Requesting device location…');
      expect(toastErrorMock).toHaveBeenCalledWith('Location permission denied.');
    });
  });

  it('surfaces geolocation timeout and generic unavailable errors', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (
          _onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void,
          onError: (err: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => {
          onError({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 });
          onError({ code: 2, PERMISSION_DENIED: 1, TIMEOUT: 3 });
        },
      ),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });

    renderWithToast(<MapPage />);
    await clickUseMyLocationControl();
    await clickUseMyLocationControl();

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Location request timed out.');
      expect(toastErrorMock).toHaveBeenCalledWith('Location unavailable.');
    });
  });

  it('hydrates saved ids and persists toggle save/unsave state', async () => {
    localStorage.setItem('oran:saved-service-ids', '["svc-1",5]');
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);
    fireEvent.change(getMapSearchBox(), {
      target: { value: 'shelter' },
    });
    fireEvent.click(getSearchSubmitButton());
    await screen.findByText('Shelter');

    expect(screen.getAllByText('saved').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    expect(localStorage.getItem('oran:saved-service-ids')).toBe('[]');
    expect(toastSuccessMock).toHaveBeenCalledWith('Removed from this device');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved on this device');
  });

  it('syncs map bookmark toggles to the account when cross-device sync is enabled', async () => {
    localStorage.setItem('oran:preferences', JSON.stringify({ serverSyncEnabled: true }));
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);
    fireEvent.change(getMapSearchBox(), {
      target: { value: 'shelter' },
    });
    fireEvent.click(getSearchSubmitButton());
    await screen.findByText('Shelter');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved to this device and your synced account');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Removed from this device and your synced account');
  });

  it('centers map from opted-in geolocation and shows mobile search-area CTA', async () => {
    setMatchMedia(true);

    const geolocation = {
      getCurrentPosition: vi.fn(
        (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 47.6159, longitude: -122.3321 } });
        },
      ),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });

    renderWithToast(<MapPage />);
    await clickUseMyLocationControl();

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Centered near your location (not saved).');
      expect(screen.getAllByRole('button', { name: 'Search this area' }).length).toBeGreaterThan(0);
    });

    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-center-lat', '47.62');
    expect(map).toHaveAttribute('data-center-lng', '-122.33');
    expect(map).toHaveAttribute('data-zoom', '12');
  });

  it('shows search fallback errors when response bodies are not JSON', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/search?')) {
        return {
          ok: false,
          json: async () => {
            throw new Error('bad search body');
          },
        } as unknown as Response;
      }
      return {
        ok: false,
        json: async () => ({ error: `Unexpected request: ${url}` }),
      } as Response;
    });

    renderWithToast(<MapPage />);
    fireEvent.change(getMapSearchBox(), {
      target: { value: 'fallback' },
    });
    fireEvent.click(getSearchSubmitButton());
    expect((await screen.findAllByText('Search failed')).length).toBeGreaterThan(0);
  });

  it('blocks empty submits but allows canonical attribute-only search without typed text', async () => {
    mockApi([{ ok: true, body: makeSearchResponse() }]);
    renderWithToast(<MapPage />);
    fireEvent.click(getRefineMapButton());
    await screen.findByRole('button', { name: 'By Phone' });

    const initialSearchCalls = getSearchCalls().length;
    fireEvent.submit(getMapSearchBox().closest('form')!);
    expect(getSearchCalls().length).toBe(initialSearchCalls);

    fireEvent.click(screen.getByRole('button', { name: 'By Phone' }));

    await waitFor(() => {
      expect(getSearchCalls().length).toBe(initialSearchCalls + 1);
      expect(String(getSearchCalls().at(-1)?.[0])).toContain('attributes=');
    });

    expect(screen.queryByRole('button', { name: 'Search this area' })).not.toBeInTheDocument();
  });

  it('shows canonical filter controls in the unified dialog', async () => {
    renderWithToast(<MapPage />);
    fireEvent.click(getRefineMapButton());

    expect(await screen.findByText('Service details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Food' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By Phone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nearby first' })).toBeInTheDocument();
  });

  it('clears a stale category chip when the user types a different query', async () => {
    renderWithToast(<MapPage />);
    fireEvent.click(getRefineMapButton());

    const categoryButton = screen.getByRole('button', { name: 'Food' });
    fireEvent.click(categoryButton);
    expect(categoryButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'legal aid' },
    });

    expect(categoryButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the category query instead of stale typed text when a quick chip is selected', async () => {
    mockApi([{ ok: true, body: makeSearchResponse() }]);

    renderWithToast(<MapPage />);
    fireEvent.click(getRefineMapButton());

    fireEvent.change(getMapSearchBox(), {
      target: { value: 'rare typed query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(() => {
      const latest = String(getSearchCalls().at(-1)?.[0]);
      expect(latest).toContain('q=food');
      expect(latest).not.toContain('rare+typed+query');
    });
  });

  it('renders confidence-ring labels for known and unknown confidence scores', async () => {
    mockApi([
      {
        ok: true,
        body: makeSearchResponse({
          results: [
            {
              service: {
                service: { id: 'svc-high', name: 'High Confidence' },
                location: { latitude: 47.61, longitude: -122.33 },
                confidenceScore: { score: 90 },
              },
            },
            {
              service: {
                service: { id: 'svc-mid', name: 'Mid Confidence' },
                location: { latitude: 47.62, longitude: -122.31 },
                confidenceScore: { score: 65 },
              },
            },
            {
              service: {
                service: { id: 'svc-low', name: 'Low Confidence' },
                location: { latitude: 47.63, longitude: -122.32 },
                confidenceScore: { score: 20 },
              },
            },
            {
              service: {
                service: { id: 'svc-unknown', name: 'Unknown Confidence' },
                location: { latitude: 47.64, longitude: -122.34 },
                confidenceScore: null,
              },
            },
          ],
          total: 4,
        }),
      },
    ]);

    renderWithToast(<MapPage />);
    fireEvent.change(getMapSearchBox(), {
      target: { value: 'confidence' },
    });
    fireEvent.click(getSearchSubmitButton());

    await screen.findByText('High Confidence');
    expect(screen.getByLabelText('Trust 90 percent')).toBeInTheDocument();
    expect(screen.getByLabelText('Trust 65 percent')).toBeInTheDocument();
    expect(screen.getByLabelText('Trust 20 percent')).toBeInTheDocument();
    expect(screen.getByLabelText('Trust score unknown')).toBeInTheDocument();
  });
});
