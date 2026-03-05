// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const backMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: backMock,
  }),
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
    <div data-testid="service-card">
      <p>{enriched.service.name}</p>
      <p>{isSaved ? 'saved' : 'not-saved'}</p>
      <button type="button" onClick={() => onToggleSave(enriched.service.id)}>
        toggle-save
      </button>
    </div>
  ),
}));

import ServiceDetailPage from '@/app/(seeker)/service/[id]/ServiceDetailClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  document.title = 'ORAN';
  global.fetch = fetchMock as unknown as typeof fetch;
});

function makeService(id = 'svc-1', name = 'Food Pantry') {
  return {
    service: {
      id,
      name,
      description: 'Provides weekly groceries',
    },
    organization: {
      id: 'org-1',
      name: 'Helping Hands',
    },
  };
}

describe('ServiceDetailClient', () => {
  it('marks not found immediately when serviceId is missing', async () => {
    render(<ServiceDetailPage serviceId="" />);

    await screen.findByText('Service not found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows not found UI when the API returns 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    render(<ServiceDetailPage serviceId="missing-service" />);

    await screen.findByText('Service not found');
    expect(screen.getAllByRole('link', { name: 'Browse directory' })[0]).toHaveAttribute('href', '/directory');
  });

  it('renders a fetched service and toggles saved state with local + server sync', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeService()] }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getAllByText('Food Pantry').length).toBeGreaterThan(0);
    expect(document.title).toBe('Food Pantry | ORAN');
    expect(screen.getByText('not-saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('not-saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('[]');
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });
  });

  it('shows error state on server failures and handles back navigation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<ServiceDetailPage serviceId="svc-error" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Back to results' })[0]);
    expect(backMock).toHaveBeenCalledTimes(1);

    await screen.findByText('Could not load service');
    expect(screen.getByText('Failed to fetch service')).toBeInTheDocument();
  });
});
