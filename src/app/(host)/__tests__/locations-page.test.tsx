// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="locations-skeleton">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import LocationsPage from '@/app/(host)/locations/page';

function orgsResponse() {
  return {
    results: [{ id: 'org-1', name: 'Helping Hands' }],
  };
}

function locationsResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'loc-1',
        organization_id: 'org-1',
        organization_name: 'Helping Hands',
        name: 'Downtown Office',
        address_1: '123 Main St',
        city: 'Seattle',
        state_province: 'WA',
        postal_code: '98101',
        latitude: 47.61,
        longitude: -122.33,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('host locations page', () => {
  it('loads organization options and location cards on mount', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() });

    render(<LocationsPage />);

    await screen.findByText('Downtown Office');
    expect(screen.getByText('123 Main St, Seattle, WA, 98101')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Location' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations?limit=100');
    expect(fetchMock).toHaveBeenCalledWith('/api/host/locations?page=1&limit=12');
  });

  it('validates latitude/longitude client-side before saving', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ results: [] }) });

    render(<LocationsPage />);
    await screen.findByText('No locations found');

    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
    fireEvent.change(screen.getByLabelText(/^Organization/i), {
      target: { value: 'org-1' },
    });
    fireEvent.change(screen.getByLabelText(/Location Name/i), {
      target: { value: 'New Office' },
    });
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '120' },
    });
    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }, 15000);

  it('creates locations and refreshes the listing', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'loc-2' }) }) // POST create
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() }); // refresh

    render(<LocationsPage />);
    await screen.findByText('No locations found');

    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
    fireEvent.change(screen.getByLabelText(/^Organization/i), {
      target: { value: 'org-1' },
    });
    fireEvent.change(screen.getByLabelText(/Location Name/i), {
      target: { value: 'Downtown Office' },
    });
    fireEvent.change(screen.getByLabelText('Street Address'), {
      target: { value: '123 Main St' },
    });
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByLabelText('State'), {
      target: { value: 'WA' },
    });
    fireEvent.change(screen.getByLabelText('Postal Code'), {
      target: { value: '98101' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/host/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Downtown Office',
          organizationId: 'org-1',
          address1: '123 Main St',
          city: 'Seattle',
          stateProvince: 'WA',
          postalCode: '98101',
          country: 'US',
        }),
      });
      expect(screen.getByText('Downtown Office')).toBeInTheDocument();
    });
  });

  it('shows delete errors when location removal fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Delete failed: location in use' }),
      });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[1]);

    await screen.findByRole('alert');
    expect(screen.getByText('Delete failed: location in use')).toBeInTheDocument();
  });

  it('applies organization filters and paginates results', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ total: 13, hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ total: 13, hasMore: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => locationsResponse({ page: 2, total: 13, hasMore: false }),
      });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');

    fireEvent.change(screen.getByLabelText('Filter by organization'), {
      target: { value: 'org-1' },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/locations?page=1&limit=12&organizationId=org-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/locations?page=2&limit=12&organizationId=org-1');
    });
  });

  it('shows save errors during edit and supports successful delete refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Location save blocked' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => locationsResponse({ results: [], total: 0 }),
      });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Location Name/i), {
      target: { value: 'Downtown Office Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Location save blocked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/locations/loc-1', { method: 'DELETE' });
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/host/locations?page=1&limit=12');
      expect(screen.getByText('No locations found')).toBeInTheDocument();
    });
  });
});
