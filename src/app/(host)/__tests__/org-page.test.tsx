// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="org-skeleton">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="dialog-root">{children}</div> : null),
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

import OrgDashboardPage from '@/app/(host)/org/page';

function makeListResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'org-1',
        name: 'Helping Hands',
        description: 'Community org',
        url: 'https://helpinghands.example.org',
        email: 'info@helpinghands.example.org',
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

describe('host org dashboard page', () => {
  it('loads and renders organization cards from the host API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeListResponse(),
    });

    render(<OrgDashboardPage />);

    await screen.findByText('Helping Hands');
    expect(screen.getByText('Community org')).toBeInTheDocument();
    expect(screen.getByText('Page 1 · 1 total')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations?page=1&limit=12');
  });

  it('applies search queries through the list endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse(),
      });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search organizations' }), {
      target: { value: 'helping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/host/organizations?page=1&limit=12&q=helping');
    });
  });

  it('edits organizations and refreshes the list after save', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse(),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // PUT save
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeListResponse({
            results: [{ id: 'org-1', name: 'Helping Hands Updated', description: 'Updated', url: null, email: null }],
          }),
      });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText(/Organization Name/i), {
      target: { value: 'Helping Hands Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations/org-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Helping Hands Updated',
          description: 'Community org',
          url: 'https://helpinghands.example.org',
          email: 'info@helpinghands.example.org',
        }),
      });
      expect(screen.getByText('Helping Hands Updated')).toBeInTheDocument();
    });
  });

  it('surfaces delete failures from archive requests', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Delete failed: protected organization' }),
      });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Delete failed: protected organization')).toBeInTheDocument();
  });

  it('renders API load failures from organization listing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'host organizations unavailable' }),
    });

    render(<OrgDashboardPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('host organizations unavailable')).toBeInTheDocument();
  });

  it('supports pagination and successful archive flow', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse({ total: 13, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeListResponse({
            page: 2,
            total: 13,
            hasMore: false,
            results: [
              {
                id: 'org-2',
                name: 'Neighborhood Hub',
                description: 'Second page org',
                url: null,
                email: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'org-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse({ page: 2, total: 0, hasMore: false, results: [] }),
      });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Neighborhood Hub');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/host/organizations?page=2&limit=12');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/organizations/org-2', { method: 'DELETE' });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/organizations?page=2&limit=12');
      expect(screen.getByText('No organizations found')).toBeInTheDocument();
    });
  });
});
