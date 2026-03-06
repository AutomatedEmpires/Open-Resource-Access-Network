// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => navigationState.searchParams,
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

// Radix Dialog portals can be noisy in unit tests; stub Dialog primitives as
// simple wrappers so we can assert interactions without portal behavior.
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
    isSaved,
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    isSaved: boolean;
    onToggleSave: (id: string) => void;
  }) => (
    <div data-testid={`service-card-${enriched.service.id}`}>
      <p>{enriched.service.name}</p>
      <p>{isSaved ? 'saved' : 'not-saved'}</p>
      <button type="button" onClick={() => onToggleSave(enriched.service.id)}>
        toggle-{enriched.service.id}
      </button>
    </div>
  ),
}));

import { ToastProvider } from '@/components/ui/toast';
import DirectoryPage from '@/app/(seeker)/directory/DirectoryPageClient';

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function makeSearchResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        service: {
          service: { id: 'svc-1', name: 'Food Pantry' },
        },
      },
    ],
    total: 1,
    page: 1,
    limit: 12,
    hasMore: false,
    ...overrides,
  };
}

function ok(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

function bad(body: unknown) {
  return {
    ok: false,
    json: async () => body,
  };
}

function setupFetchRoutes(options?: {
  taxonomyTerms?: unknown[];
  searchResponses?: Array<ReturnType<typeof ok> | ReturnType<typeof bad>>;
}) {
  const taxonomyTerms = options?.taxonomyTerms ?? [];
  const searchResponses = options?.searchResponses ?? [];
  let searchCall = 0;

  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/taxonomy/terms')) {
      return ok({ terms: taxonomyTerms });
    }
    if (url.includes('/api/search?')) {
      const resp = searchResponses[Math.min(searchCall, Math.max(0, searchResponses.length - 1))];
      searchCall += 1;
      if (!resp) throw new Error('Missing mocked search response');
      return resp;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  navigationState.searchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('DirectoryPageClient', () => {
  it('shows initial empty state before any search', async () => {
    setupFetchRoutes();

    renderWithToast(<DirectoryPage />);

    expect(screen.getByText('Start with a search')).toBeInTheDocument();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c?.[0]));
      expect(urls.some((u) => u.includes('/api/taxonomy/terms'))).toBe(true);
    });
  });

  it('fetches taxonomy terms on load for top tags', async () => {
    setupFetchRoutes({
      taxonomyTerms: [{
        id: 'a1000000-0000-0000-0000-000000000001',
        term: 'Food Assistance',
        description: null,
        parentId: null,
        taxonomy: 'demo',
        serviceCount: 12,
      }],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByRole('button', { name: 'Food Assistance' });
    const urls = fetchMock.mock.calls.map((c) => String(c?.[0]));
    expect(urls.some((u) => u.includes('/api/taxonomy/terms'))).toBe(true);
  });

  it('shows selected tag name in the applied filters summary', async () => {
    setupFetchRoutes({
      taxonomyTerms: [{
        id: 'a1000000-0000-0000-0000-000000000001',
        term: 'Food Assistance',
        description: null,
        parentId: null,
        taxonomy: 'demo',
        serviceCount: 12,
      }],
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    // Select a tag via the top-tag chip.
    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));

    // It should appear as a removable applied chip.
    await screen.findByText('Tag: Food Assistance');
    expect(screen.getByRole('button', { name: /Remove tag Food Assistance/i })).toBeInTheDocument();
  });

  it('shows the first two selected tag names plus +N', async () => {
    setupFetchRoutes({
      taxonomyTerms: [
        {
          id: 'a1000000-0000-0000-0000-000000000001',
          term: 'Food Assistance',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 30,
        },
        {
          id: 'a1000000-0000-0000-0000-000000000002',
          term: 'Rent Help',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 20,
        },
        {
          id: 'a1000000-0000-0000-0000-000000000003',
          term: 'Job Training',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 10,
        },
      ],
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rent Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Job Training' }));

    await screen.findByText('Tag: Food Assistance');
    await screen.findByText('Tag: Rent Help');
    expect(screen.getByRole('button', { name: /View 1 more tag filters/i })).toBeInTheDocument();
  });

  it('can remove an individual applied tag without opening the dialog', async () => {
    setupFetchRoutes({
      taxonomyTerms: [
        {
          id: 'a1000000-0000-0000-0000-000000000001',
          term: 'Food Assistance',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 30,
        },
        {
          id: 'a1000000-0000-0000-0000-000000000002',
          term: 'Rent Help',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 20,
        },
      ],
      searchResponses: [ok(makeSearchResponse()), ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rent Help' }));

    await screen.findByText('Tag: Food Assistance');
    await screen.findByText('Tag: Rent Help');

    // Remove one tag directly from Applied.
    fireEvent.click(screen.getByRole('button', { name: /Remove tag Food Assistance/i }));

    await waitFor(() => {
      expect(screen.queryByText('Tag: Food Assistance')).not.toBeInTheDocument();
      expect(screen.getByText('Tag: Rent Help')).toBeInTheDocument();
    });
  });

  it('auto-runs search from URL params and syncs filter state back to URL', async () => {
    navigationState.searchParams = new URLSearchParams(
      'q=food&page=2&confidence=HIGH&sort=name_desc&category=food',
    );
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse({ page: 2 }))],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Page 2 · end of results');
    expect(screen.getByText('Food Pantry')).toBeInTheDocument();

    const searchUrl = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .find((u) => u.includes('/api/search?'));
    expect(searchUrl).toBeTruthy();
    expect(searchUrl).toContain('/api/search?');
    expect(searchUrl).toContain('q=food');
    expect(searchUrl).toContain('page=2');
    expect(searchUrl).toContain('limit=12');
    expect(searchUrl).toContain('sortBy=name_desc');
    expect(searchUrl).toContain('minConfidenceScore=80');

    expect(replaceMock).toHaveBeenCalledWith(
      '/directory?q=food&confidence=HIGH&sort=name_desc&category=food&page=2',
      { scroll: false },
    );
  });

  it('runs manual searches, re-queries on filters/pagination, and toggles saved state', async () => {
    setupFetchRoutes({
      searchResponses: [
        ok(makeSearchResponse({ hasMore: true, total: 3, page: 1 })),
        ok(makeSearchResponse({ hasMore: true, total: 3, page: 1 })),
        ok(makeSearchResponse({ page: 2, total: 3, hasMore: false })),
      ],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'rent help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('of');
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('3');
    });

    fireEvent.click(screen.getByRole('button', { name: 'High confidence only' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBeGreaterThanOrEqual(2);
      const trustUrl = String(searchCalls[1]);
      expect(trustUrl).toContain('minConfidenceScore=80');
      expect(trustUrl).toContain('page=1');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBeGreaterThanOrEqual(3);
      const nextUrl = String(searchCalls[2]);
      expect(nextUrl).toContain('page=2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    expect(screen.getByText('saved')).toBeInTheDocument();
  }, 15000);

  it('shows API error responses in the inline alert', async () => {
    setupFetchRoutes({
      searchResponses: [bad({ error: 'backend unavailable' })],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Search failed')).toBeInTheDocument();
    expect(screen.getByText('backend unavailable')).toBeInTheDocument();
  });

  it('supports category chip search and clearing back to URL defaults', async () => {
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBe(1);
      const url = String(searchCalls[0]);
      expect(url).toContain('q=food');
      expect(replaceMock).toHaveBeenCalledWith('/directory?q=food&category=food', { scroll: false });
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('supports opt-in device location search without putting coordinates in the URL', async () => {
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

    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));

    await waitFor(() => {
      expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBe(1);
    });

    const searchCalls = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .filter((u) => u.includes('/api/search?'));
    const url = String(searchCalls[0]);
    expect(url).toContain('/api/search?');
    expect(url).toContain('lat=47.62');
    expect(url).toContain('lng=-122.33');
    expect(url).not.toContain('q=');

    // Location coordinates must not be persisted into shareable URL params.
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('renders no-match results state from successful empty responses', async () => {
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse({ results: [], total: 0, hasMore: false }))],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'very specific query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('No matches');
    expect(screen.getByText('Try different keywords, broaden trust filters, or clear tags.')).toBeInTheDocument();
  });

  it('shows taxonomy fallback state when filter terms fail to load', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'taxonomy unavailable' }),
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Filters unavailable');
    expect(fetchMock).toHaveBeenCalledWith('/api/taxonomy/terms?limit=250', expect.any(Object));
  });

  it('shows no-match text in taxonomy dialog search', async () => {
    setupFetchRoutes({
      taxonomyTerms: [
        {
          id: 'a1000000-0000-0000-0000-000000000001',
          term: 'Food Assistance',
          description: null,
          parentId: null,
          taxonomy: 'demo',
          serviceCount: 12,
        },
      ],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search service tags' }), {
      target: { value: 'zzzz-no-match' },
    });

    await screen.findByText('No matching tags.');
  });

  it('handles geolocation permission-denied branch', async () => {
    setupFetchRoutes();

    renderWithToast(<DirectoryPage />);

    const deniedGeolocation = {
      getCurrentPosition: vi.fn(
        (
          _onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void,
          onError: (err: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => onError({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
      ),
    };

    Object.defineProperty(global.navigator, 'geolocation', {
      value: deniedGeolocation,
      configurable: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await screen.findByText('Location permission denied.');
    expect(deniedGeolocation.getCurrentPosition).toHaveBeenCalledOnce();

    const searchCalls = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .filter((u) => u.includes('/api/search?'));
    expect(searchCalls).toHaveLength(0);
  });

  it('shows unknown selected-tag summary chip from URL ids not in loaded taxonomy terms', async () => {
    navigationState.searchParams = new URLSearchParams(
      'taxonomyIds=a1000000-0000-4000-8000-000000000001',
    );
    setupFetchRoutes({
      taxonomyTerms: [],
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByRole('button', { name: 'View tag filters (1)' });
    const searchUrl = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .find((u) => u.includes('/api/search?'));
    expect(searchUrl).toContain('taxonomyIds=a1000000-0000-4000-8000-000000000001');
  });

  it('clears active location filter back to initial empty state', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 40.7128, longitude: -74.006 } });
        },
      ),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
      value: geolocation,
      configurable: true,
    });

    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear location filter' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Start with a search')).toBeInTheDocument();
    });
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('clears all filters back to empty state when category matches query text', async () => {
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    await waitFor(() => {
      expect(screen.getByText('Start with a search')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    });
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('clears filters but preserves non-category query text when clearing all', async () => {
    navigationState.searchParams = new URLSearchParams('q=shelter&category=food');
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse()), ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Food Pantry');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBeGreaterThanOrEqual(2);
      const latest = String(searchCalls.at(-1));
      expect(latest).toContain('q=shelter');
      expect(latest).not.toContain('minConfidenceScore=');
      expect(latest).not.toContain('taxonomyIds=');
    });
    expect(replaceMock).toHaveBeenCalledWith('/directory?q=shelter', { scroll: false });
  });

  it('re-runs search when clearing trust and sort chips after applied filters', async () => {
    setupFetchRoutes({
      searchResponses: [
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
      ],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'rent help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'High confidence only' }));
    fireEvent.change(screen.getByLabelText('Sort:'), {
      target: { value: 'name_desc' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear trust filter' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear sort option' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear trust filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear sort option' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBeGreaterThanOrEqual(5);
      const trustClearedUrl = String(searchCalls.at(-2));
      const sortClearedUrl = String(searchCalls.at(-1));
      expect(trustClearedUrl).not.toContain('minConfidenceScore=');
      expect(trustClearedUrl).toContain('sortBy=name_desc');
      expect(sortClearedUrl).not.toContain('sortBy=');
      expect(sortClearedUrl).not.toContain('minConfidenceScore=');
    });
  });

  it('handles geolocation timeout branch and avoids firing a search', async () => {
    setupFetchRoutes();

    const timeoutGeolocation = {
      getCurrentPosition: vi.fn(
        (
          _onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void,
          onError: (err: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
        ) => onError({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
      ),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
      value: timeoutGeolocation,
      configurable: true,
    });

    renderWithToast(<DirectoryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));

    await screen.findByText('Location request timed out.');
    expect(timeoutGeolocation.getCurrentPosition).toHaveBeenCalledOnce();
    const searchCalls = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .filter((u) => u.includes('/api/search?'));
    expect(searchCalls).toHaveLength(0);
  });
});
