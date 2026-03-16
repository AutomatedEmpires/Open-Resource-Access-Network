// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="saved-skeleton">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/directory/ServiceCard', () => ({
  ServiceCard: ({
    enriched,
    href,
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    href?: string;
    onToggleSave?: (id: string) => void;
  }) => (
    <div data-testid={`saved-service-card-${enriched.service.id}`}>
      {enriched.service.name}
      {href ? <a href={href}>details-{enriched.service.id}</a> : null}
      {onToggleSave && (
        <button
          type="button"
          onClick={() => onToggleSave(enriched.service.id)}
          aria-label={`Remove ${enriched.service.name} from saved`}
        >
          Remove
        </button>
      )}
    </div>
  ),
}));

async function loadSavedPage() {
  const mod = await import('@/app/(seeker)/saved/SavedPageClient');
  return mod.default;
}

const STORAGE_KEY = 'oran:saved-service-ids';
const SEEKER_KEY = 'oran:seeker-context';
const PREFS_KEY = 'oran:preferences';

function service(id: string, name: string) {
  return {
    service: { id, name },
    organization: { id: 'org-1', name: 'Org' },
    taxonomyTerms: [{ id: 'a1000000-4000-4000-8000-000000000001', term: 'Food Assistance' }],
    attributes: [
      { taxonomy: 'delivery', tag: 'virtual' },
      { taxonomy: 'access', tag: 'walk_in' },
      { taxonomy: 'population', tag: 'youth' },
    ],
  };
}

beforeEach(() => {
  vi.resetModules();
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('SavedPageClient', () => {
  it('merges authenticated server saves with local-only IDs and backfills server', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ serverSyncEnabled: true }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-local']));
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ savedIds: ['svc-server'] }),
      })
      .mockResolvedValueOnce({ ok: true }) // /api/user/saved backfill
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [service('svc-server', 'Server Save'), service('svc-local', 'Local Save')],
          notFound: [],
        }),
      });

    render(<SavedPage />);

    await screen.findByText('Server Save');
    expect(screen.getByText('Local Save')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: 'svc-local' }),
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["svc-server","svc-local"]');
  });

  it('keeps authenticated bookmarks local-only when cross-device sync is off', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-local']));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-local', 'Local Save')],
        notFound: [],
      }),
    });

    render(<SavedPage />);

    await screen.findByText('Local Save');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/services?ids=svc-local',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByText('Sync off on this device')).toBeInTheDocument();
  });

  it('loads saved services from local IDs and cleans out not-found entries', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1', 'svc-2']));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-1', 'Shelter')],
        notFound: ['svc-2'],
      }),
    });

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    expect(screen.getByRole('status')).toHaveTextContent('1 saved service');
    expect(screen.getByText(/1 saved service could not be loaded/i)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["svc-1"]');
  });

  it('uses canonical discovery fallback links for saved service detail routes', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1']));
    localStorage.setItem(SEEKER_KEY, JSON.stringify({ serviceInterests: ['food_assistance'] }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-1', 'Shelter')],
        notFound: [],
      }),
    });

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    expect(screen.getByRole('link', { name: 'details-svc-1' })).toHaveAttribute(
      'href',
      '/service/svc-1?q=food&category=food_assistance&taxonomyIds=a1000000-4000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%2C%22access%22%3A%5B%22walk_in%22%5D%7D',
    );
  });

  it('removes a saved service locally without server sync when sync is off', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1']));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-1', 'Shelter')],
        notFound: [],
      }),
    });

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    fireEvent.click(screen.getByRole('button', { name: /Remove Shelter from saved/i }));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(screen.getByText('No saved services yet')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears all saved services after confirmation without server sync when sync is off', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1', 'svc-2']));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-1', 'Shelter'), service('svc-2', 'Pantry')],
        notFound: [],
      }),
    });

    render(<SavedPage />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 saved services');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(screen.getByText('No saved services yet')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can cancel clear-all confirmation without changing saved state', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1']));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [service('svc-1', 'Shelter')],
        notFound: [],
      }),
    });

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('saved-service-card-svc-1')).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["svc-1"]');
  });

  it('shows an error alert when batch service fetching fails', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['bad-id']));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid service IDs' }),
    });

    render(<SavedPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Invalid service IDs')).toBeInTheDocument();
  });

  it('shows generic fetch error for non-400 service lookup failures', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1']));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    render(<SavedPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Failed to fetch services')).toBeInTheDocument();
  });

  it('personalizes empty-state discovery links from the stored seeker preference', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(
      SEEKER_KEY,
      JSON.stringify({
        serviceInterests: ['food_assistance'],
      }),
    );
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<SavedPage />);

    await screen.findByText('No saved services yet');
      expect(screen.getByRole('link', { name: 'Open Chat' })).toHaveAttribute(
      'href',
      '/chat?q=food&category=food_assistance',
    );
    expect(screen.getByRole('link', { name: 'Browse directory' })).toHaveAttribute(
      'href',
      '/directory?q=food&category=food_assistance',
    );
    expect(screen.getByRole('link', { name: 'Map view' })).toHaveAttribute(
      'href',
      '/map?q=food&category=food_assistance',
    );
  });

  it('removes local saved state even when server delete request throws', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ serverSyncEnabled: true }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1']));
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [service('svc-1', 'Shelter')],
          notFound: [],
        }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    fireEvent.click(screen.getByRole('button', { name: /Remove Shelter from saved/i }));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(screen.getByText('No saved services yet')).toBeInTheDocument();
    });
  });
});
