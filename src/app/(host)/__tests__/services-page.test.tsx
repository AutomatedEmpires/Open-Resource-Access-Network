// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="services-skeleton">Loading…</div>,
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

import ServicesPage from '@/app/(host)/services/page';

function orgsResponse() {
  return {
    results: [{ id: 'org-1', name: 'Helping Hands' }],
  };
}

function servicesResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'svc-1',
        organization_id: 'org-1',
        organization_name: 'Helping Hands',
        name: 'Food Pantry',
        description: 'Weekly groceries',
        status: 'active',
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

describe('host services page', () => {
  it('loads org options and service cards on mount', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse() });

    render(<ServicesPage />);

    await screen.findByText('Food Pantry');
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Service' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations?limit=100');
    expect(fetchMock).toHaveBeenCalledWith('/api/host/services?page=1&limit=12');
  });

  it('creates a new service via modal form and refreshes results', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'svc-2' }) }) // POST create
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse() }); // refresh

    render(<ServicesPage />);
    await screen.findByText('No services found');

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));
    fireEvent.change(screen.getByLabelText(/Service Name/i), {
      target: { value: 'Evening Meal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/host/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Evening Meal',
          status: 'active',
          organizationId: 'org-1',
        }),
      });
      expect(screen.getByText('Food Pantry')).toBeInTheDocument();
    });
  });

  it('updates an existing service from edit modal', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // PUT update
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          servicesResponse({
            results: [
              {
                id: 'svc-1',
                organization_id: 'org-1',
                organization_name: 'Helping Hands',
                name: 'Food Pantry Updated',
                description: 'Updated description',
                status: 'active',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
      });

    render(<ServicesPage />);
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Service Name/i), {
      target: { value: 'Food Pantry Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/host/services/svc-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Food Pantry Updated',
          status: 'active',
          description: 'Weekly groceries',
        }),
      });
      expect(screen.getByText('Food Pantry Updated')).toBeInTheDocument();
    });
  });

  it('shows API delete errors when archive fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Delete failed: service is protected' }),
      });

    render(<ServicesPage />);
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Delete failed: service is protected')).toBeInTheDocument();
  });

  it('applies organization filter, search, and pagination params', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => servicesResponse({ total: 13, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => servicesResponse({ total: 13, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => servicesResponse({ total: 13, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => servicesResponse({ page: 2, total: 13, hasMore: false }),
      });

    render(<ServicesPage />);
    await screen.findByText('Food Pantry');

    fireEvent.change(screen.getByLabelText('Filter by organization'), {
      target: { value: 'org-1' },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/services?page=1&limit=12&organizationId=org-1');
    });

    fireEvent.change(screen.getByLabelText('Search services'), {
      target: { value: 'food pantry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/services?page=1&limit=12&q=food+pantry&organizationId=org-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/host/services?page=2&limit=12&q=food+pantry&organizationId=org-1');
    });
  });

  it('shows save errors and archives services successfully', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => servicesResponse() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Save blocked by API policy' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => servicesResponse({ results: [], total: 0 }),
      });

    render(<ServicesPage />);
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/Service Name/i), {
      target: { value: 'Food Pantry v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Save blocked by API policy')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/services/svc-1', { method: 'DELETE' });
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/host/services?page=1&limit=12');
      expect(screen.getByText('No services found')).toBeInTheDocument();
    });
  });
});
