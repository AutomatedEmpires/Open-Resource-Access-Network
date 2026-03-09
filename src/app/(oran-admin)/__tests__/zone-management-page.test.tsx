// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="zones-skeleton">Loading...</div>,
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
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

import ZoneManagementPage from '@/app/(oran-admin)/zone-management/page';

function makeZonesResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'zone-1',
        name: 'Downtown',
        description: 'Core city services',
        assigned_user_id: 'admin-1',
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
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

describe('oran admin zone management page', () => {
  it('shows initial load failures and can recover with refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'zones API unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse(),
      });

    render(<ZoneManagementPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('zones API unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/zones?page=1&limit=20');
      expect(screen.getByText('Downtown')).toBeInTheDocument();
    });
  });

  it('loads zones and applies status filters with empty-state messaging', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse({ results: [], total: 0 }),
      });

    render(<ZoneManagementPage />);

    await screen.findByText('Downtown');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/zones?page=1&limit=20');

    fireEvent.click(screen.getByRole('tab', { name: 'Inactive' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/zones?page=1&limit=20&status=inactive');
      expect(screen.getByText('No coverage zones found')).toBeInTheDocument();
      expect(screen.getByText('No zones with status "inactive".')).toBeInTheDocument();
    });
  });

  it('creates a new zone and refreshes the listing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Zone created' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeZonesResponse({
            results: [
              ...makeZonesResponse().results,
              {
                id: 'zone-2',
                name: 'Uptown',
                description: 'North district',
                assigned_user_id: null,
                status: 'inactive',
                created_at: '2026-01-05T00:00:00.000Z',
                updated_at: '2026-01-05T00:00:00.000Z',
              },
            ],
            total: 2,
          }),
      });

    render(<ZoneManagementPage />);
    await screen.findByText('Downtown');

    fireEvent.click(screen.getByRole('button', { name: 'New Zone' }));
    fireEvent.change(screen.getByLabelText(/Zone name/i), { target: { value: 'Uptown' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'North district' } });
    fireEvent.change(screen.getByLabelText('Assigned admin ID'), { target: { value: 'admin-2' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Zone' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Uptown',
          description: 'North district',
          assignedUserId: 'admin-2',
          status: 'inactive',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/zones?page=1&limit=20');
      expect(screen.getByRole('status')).toHaveTextContent('Zone created');
      expect(screen.getByText('Uptown')).toBeInTheDocument();
    });
  });

  it('edits an existing zone and saves changes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Zone updated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeZonesResponse({
            results: [
              {
                id: 'zone-1',
                name: 'Downtown East',
                description: 'Reassigned district',
                assigned_user_id: 'admin-9',
                status: 'inactive',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-06T00:00:00.000Z',
              },
            ],
          }),
      });

    render(<ZoneManagementPage />);
    await screen.findByText('Downtown');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Downtown' }));
    fireEvent.change(screen.getByLabelText(/Zone name/i), { target: { value: 'Downtown East' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reassigned district' } });
    fireEvent.change(screen.getByLabelText('Assigned admin ID'), { target: { value: 'admin-9' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/zones/zone-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Downtown East',
          description: 'Reassigned district',
          assignedUserId: 'admin-9',
          status: 'inactive',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/zones?page=1&limit=20');
      expect(screen.getByRole('status')).toHaveTextContent('Zone updated');
      expect(screen.getByText('Downtown East')).toBeInTheDocument();
    });
  });

  it('shows delete API failures from confirmation dialog actions', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'zone still has assignments' }),
      });

    render(<ZoneManagementPage />);
    await screen.findByText('Downtown');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Downtown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/zones/zone-1', { method: 'DELETE' });
      expect(screen.getByRole('alert')).toHaveTextContent('zone still has assignments');
    });
  });

  it('paginates results and refreshes after successful deletion', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeZonesResponse({
            total: 41,
            hasMore: true,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeZonesResponse({
            results: [
              {
                id: 'zone-2',
                name: 'Uptown',
                description: null,
                assigned_user_id: null,
                status: 'inactive',
                created_at: '2026-01-03T00:00:00.000Z',
                updated_at: '2026-01-03T00:00:00.000Z',
              },
            ],
            page: 2,
            total: 41,
            hasMore: false,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeZonesResponse({
            total: 41,
            hasMore: true,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Zone deleted' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeZonesResponse({ results: [], total: 0, hasMore: false }),
      });

    render(<ZoneManagementPage />);
    await screen.findByText('Downtown');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/zones?page=2&limit=20');
      expect(screen.getByText('Uptown')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/zones?page=1&limit=20');
      expect(screen.getByText('Downtown')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Downtown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/zones/zone-1', { method: 'DELETE' });
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/admin/zones?page=1&limit=20');
      expect(screen.getByRole('status')).toHaveTextContent('Zone deleted');
    });
  });
});
