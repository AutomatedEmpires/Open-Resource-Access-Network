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

import DirectoryPage from '@/app/(seeker)/directory/DirectoryPageClient';

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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  navigationState.searchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('DirectoryPageClient', () => {
  it('shows initial empty state before any search', () => {
    render(<DirectoryPage />);

    expect(screen.getByText('Start with a search')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-runs search from URL params and syncs filter state back to URL', async () => {
    navigationState.searchParams = new URLSearchParams(
      'q=food&page=2&confidence=HIGH&sort=name_desc&category=food',
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse({ page: 2 }),
    });

    render(<DirectoryPage />);

    await screen.findByText('Page 2 · end of results');
    expect(screen.getByText('Food Pantry')).toBeInTheDocument();

    const searchUrl = String(fetchMock.mock.calls[0]?.[0]);
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
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse({ hasMore: true, total: 3, page: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse({ hasMore: true, total: 3, page: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSearchResponse({ page: 2, total: 3, hasMore: false }),
      });

    render(<DirectoryPage />);

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
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
      expect(secondUrl).toContain('minConfidenceScore=80');
      expect(secondUrl).toContain('page=1');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const thirdUrl = String(fetchMock.mock.calls[2]?.[0]);
      expect(thirdUrl).toContain('page=2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-svc-1' }));
    expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    expect(screen.getByText('saved')).toBeInTheDocument();
  }, 15000);

  it('shows API error responses in the inline alert', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'backend unavailable' }),
    });

    render(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Search failed')).toBeInTheDocument();
    expect(screen.getByText('backend unavailable')).toBeInTheDocument();
  });

  it('supports category chip search and clearing back to URL defaults', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse(),
    });

    render(<DirectoryPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain('q=food');
      expect(replaceMock).toHaveBeenCalledWith('/directory?q=food&category=food', { scroll: false });
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(replaceMock).toHaveBeenCalledWith('/directory', { scroll: false });
  });

  it('renders no-match results state from successful empty responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSearchResponse({ results: [], total: 0, hasMore: false }),
    });

    render(<DirectoryPage />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search services' }), {
      target: { value: 'very specific query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('No matches');
    expect(screen.getByText('Try different keywords, or use chat for guided searching.')).toBeInTheDocument();
  });
});
