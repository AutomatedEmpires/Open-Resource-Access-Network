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
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    onToggleSave?: (id: string) => void;
  }) => (
    <div data-testid={`saved-service-card-${enriched.service.id}`}>
      {enriched.service.name}
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

function service(id: string, name: string) {
  return {
    service: { id, name },
    organization: { id: 'org-1', name: 'Org' },
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
  it('loads saved services from local IDs and cleans out not-found entries', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1', 'svc-2']));
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      }) // /api/saved GET -> unauthenticated
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [service('svc-1', 'Shelter')],
          notFound: ['svc-2'],
        }),
      }); // /api/services

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    expect(screen.getByRole('status')).toHaveTextContent('1 saved service');
    expect(screen.getByText(/1 saved service could not be loaded/i)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["svc-1"]');
  });

  it('removes a saved service locally and sends best-effort delete to server', async () => {
    const SavedPage = await loadSavedPage();
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
      .mockResolvedValueOnce({ ok: true }); // removeServerSaved

    render(<SavedPage />);

    await screen.findByTestId('saved-service-card-svc-1');
    fireEvent.click(screen.getByRole('button', { name: /Remove Shelter from saved/i }));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
      expect(screen.getByText('No saved services yet')).toBeInTheDocument();
    });
  });

  it('clears all saved services after confirmation', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['svc-1', 'svc-2']));
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [service('svc-1', 'Shelter'), service('svc-2', 'Pantry')],
          notFound: [],
        }),
      })
      .mockResolvedValue({ ok: true }); // removeServerSaved calls

    render(<SavedPage />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 saved services');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(screen.getByText('No saved services yet')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-2' }),
      });
    });
  });

  it('shows an error alert when batch service fetching fails', async () => {
    const SavedPage = await loadSavedPage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['bad-id']));
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid service IDs' }),
      });

    render(<SavedPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Invalid service IDs')).toBeInTheDocument();
  });
});
