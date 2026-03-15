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
    href,
    isSaved,
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    href?: string;
    isSaved: boolean;
    onToggleSave: (id: string) => void;
  }) => (
    <div data-testid={`service-card-${enriched.service.id}`}>
      <p>{enriched.service.name}</p>
      {href ? <a href={href}>details-{enriched.service.id}</a> : null}
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
    if (url === '/api/saved') {
      return ok({});
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  navigationState.searchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('DirectoryPageClient', () => {
  it('hydrates saved IDs from localStorage and supports removing an already-saved item', async () => {
    localStorage.setItem('oran:saved-service-ids', '["svc-1",123,true]');
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('saved');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    await screen.findByText('not-saved');
    expect(localStorage.getItem('oran:saved-service-ids')).toBe('[]');
  });

  it('shows initial empty state before any search', async () => {
    setupFetchRoutes();

    renderWithToast(<DirectoryPage />);

    expect(screen.getByText('Start with a search')).toBeInTheDocument();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c?.[0]));
      expect(urls.some((u) => u.includes('/api/taxonomy/terms'))).toBe(true);
    });
  });

  it('seeds a blank directory entry from the stored seeker discovery preference', async () => {
    localStorage.setItem('oran:seeker-context', JSON.stringify({
      serviceInterests: ['housing'],
      preferredDeliveryModes: ['phone'],
      documentationBarriers: ['no_id'],
      urgencyWindow: 'same_day',
    }));
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Food Pantry');

    const searchUrl = String(
      fetchMock.mock.calls.find(([input]) => String(input).includes('/api/search?'))?.[0] ?? '',
    );
    expect(searchUrl).toContain('q=housing');
    expect(searchUrl).toContain('attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D');
    expect(replaceMock).toHaveBeenCalledWith(
      '/directory?q=housing&category=housing&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D',
      { scroll: false },
    );
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/map?q=housing&category=housing&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?q=housing&category=housing&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));

    // Select a tag via the top-tag chip.
    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));

    // It should appear as a removable applied chip.
    expect(await screen.findByRole('button', { name: /Remove tag Food Assistance/i })).toBeInTheDocument();
  });

  it('renders the shared current search scope summary from canonical discovery state', async () => {
    const taxonomyId = 'a1000000-0000-4000-8000-000000000001';
    navigationState.searchParams = new URLSearchParams(
      `q=rent%20help&category=housing&confidence=HIGH&sort=name_desc&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%5D%7D`,
    );
    setupFetchRoutes({
      taxonomyTerms: [{
        id: taxonomyId,
        term: 'Housing Navigation',
        description: null,
        parentId: null,
        taxonomy: 'demo',
        serviceCount: 12,
      }],
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Current search scope');
    expect(screen.getByText('Need: Housing')).toBeInTheDocument();
    expect(screen.getByText('Search: rent help')).toBeInTheDocument();
    expect(screen.getAllByText('Trust: High confidence only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sort: Name (Z-A)').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Tag: Housing Navigation')).length).toBeGreaterThan(0);
    expect(screen.getByText('Delivery: By Phone')).toBeInTheDocument();
    expect(screen.getByText('Access: No ID Required')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rent Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Job Training' }));

    expect(await screen.findByRole('button', { name: /Remove tag Food Assistance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove tag Rent Help/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rent Help' }));

    expect(await screen.findByRole('button', { name: /Remove tag Food Assistance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove tag Rent Help/i })).toBeInTheDocument();

    // Remove one tag directly from Applied.
    fireEvent.click(screen.getByRole('button', { name: /Remove tag Food Assistance/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Remove tag Food Assistance/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove tag Rent Help/i })).toBeInTheDocument();
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
      '/directory?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&page=2',
      { scroll: false },
    );
  });

  it('auto-runs category-only links by normalizing legacy category values', async () => {
    navigationState.searchParams = new URLSearchParams('category=food');
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Food Pantry');

    const searchUrl = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .find((u) => u.includes('/api/search?'));
    expect(searchUrl).toContain('q=food');
    expect(replaceMock).toHaveBeenCalledWith('/directory?q=food&category=food_assistance', { scroll: false });
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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Next page of results' }));

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

  it('syncs bookmark toggles to the account when cross-device sync is enabled', async () => {
    localStorage.setItem('oran:preferences', JSON.stringify({ serverSyncEnabled: true }));
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });
  });

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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      expect(searchCalls.length).toBe(1);
      const url = String(searchCalls[0]);
      expect(url).toContain('q=food');
      expect(replaceMock).toHaveBeenCalledWith('/directory?q=food&category=food_assistance', { scroll: false });
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('builds canonical map links from the current shareable discovery intent', async () => {
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    await screen.findByText('Food Pantry');

    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/map?q=food&category=food_assistance',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?q=food&category=food_assistance',
    );
    expect(screen.getByRole('link', { name: 'details-svc-1' })).toHaveAttribute(
      'href',
      '/service/svc-1?q=food&category=food_assistance',
    );
  });

  it('preserves shareable attribute filters in map and chat handoff links', async () => {
    navigationState.searchParams = new URLSearchParams(
      'category=food&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    setupFetchRoutes({
      searchResponses: [ok(makeSearchResponse())],
    });

    renderWithToast(<DirectoryPage />);

    await screen.findByText('Food Pantry');

    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/map?q=food&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?q=food&category=food_assistance&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D',
    );
  });

  it('preserves non-search filters when clearing a category-backed query', async () => {
    const taxonomyId = 'a1000000-0000-0000-0000-000000000001';
    setupFetchRoutes({
      taxonomyTerms: [{
        id: taxonomyId,
        term: 'Food Assistance',
        description: null,
        parentId: null,
        taxonomy: 'demo',
        serviceCount: 12,
      }],
      searchResponses: [
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
      ],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      const latest = String(searchCalls.at(-1));
      expect(latest).toContain(`taxonomyIds=${taxonomyId}`);
      expect(latest).not.toContain('q=food');
      expect(replaceMock).toHaveBeenCalledWith(`/directory?taxonomyIds=${taxonomyId}`, { scroll: false });
    });
  });

  it('clears only the text/category portion of search and preserves active filters', async () => {
    const taxonomyId = 'a1000000-0000-0000-0000-000000000001';
    setupFetchRoutes({
      taxonomyTerms: [{
        id: taxonomyId,
        term: 'Food Assistance',
        description: null,
        parentId: null,
        taxonomy: 'demo',
        serviceCount: 12,
      }],
      searchResponses: [
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
        ok(makeSearchResponse()),
      ],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls
        .map((c) => String(c?.[0]))
        .filter((u) => u.includes('/api/search?'));
      const latest = String(searchCalls.at(-1));
      expect(latest).toContain(`taxonomyIds=${taxonomyId}`);
      expect(latest).not.toContain('q=food');
      expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
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

  it('shows a browser-unavailable message when navigator is unavailable', async () => {
    setupFetchRoutes();
    vi.stubGlobal('navigator', undefined as unknown as Navigator);

    renderWithToast(<DirectoryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));

    await screen.findByText('Device location is not available in this browser.');
    const searchCalls = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .filter((u) => u.includes('/api/search?'));
    expect(searchCalls).toHaveLength(0);
  });

  it('swallows aborted searches and keeps the empty state visible', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/taxonomy/terms')) {
        return ok({ terms: [] });
      }
      if (url.includes('/api/search?')) {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'rent help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText('Start with a search')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('de-dupes repeated service IDs when appending additional pages', async () => {
    setupFetchRoutes({
      searchResponses: [
        ok(makeSearchResponse({
          hasMore: true,
          total: 2,
          results: [
            {
              service: {
                service: { id: 'svc-1', name: 'Food Pantry' },
              },
            },
          ],
        })),
        ok(makeSearchResponse({
          hasMore: false,
          page: 2,
          total: 2,
          results: [
            {
              service: {
                service: { id: 'svc-1', name: 'Food Pantry' },
              },
            },
            {
              service: {
                service: { id: 'svc-2', name: 'Housing Hotline' },
              },
            },
          ],
        })),
      ],
    });

    renderWithToast(<DirectoryPage />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Next page of results' }));
    await screen.findByText('Housing Hotline');

    const searchCalls = fetchMock.mock.calls
      .map((c) => String(c?.[0]))
      .filter((u) => u.includes('/api/search?'));
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[1]).toContain('page=2');
    expect(screen.getAllByText('Food Pantry')).toHaveLength(1);
  });

  it('clears selected tags from no-match state back to the initial empty state', async () => {
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
      searchResponses: [ok(makeSearchResponse({ results: [], total: 0, hasMore: false }))],
    });

    renderWithToast(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refine results' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Food Assistance' }));
    await screen.findByText('No matches');

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear tags' })[1]);
    await screen.findByText('Start with a search');
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });
});
