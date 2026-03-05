// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="queue-skeleton">Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
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

import QueuePage from '@/app/(community-admin)/queue/page';

function makeQueueResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'q-1',
        service_id: 'svc-1',
        status: 'submitted',
        submitted_by_user_id: 'user-a',
        assigned_to_user_id: null,
        notes: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        service_name: 'Food Pantry',
        service_status: 'active',
        organization_id: 'org-1',
        organization_name: 'Helping Hands',
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

describe('community admin queue page', () => {
  it('loads queue rows, shows stale age, and supports pagination calls', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({ total: 40, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({ page: 2, total: 40, hasMore: false }),
      });

    render(<QueuePage />);

    await screen.findByText('Food Pantry');
    expect(fetchMock).toHaveBeenCalledWith('/api/community/queue?page=1&limit=20');
    expect(screen.getByText('40 entries')).toBeInTheDocument();
    expect(screen.getByText(/\(\d+d\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=2&limit=20');
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
    });
  });

  it('filters by status tabs and renders empty state messaging', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({ results: [], total: 0 }),
      });

    render(<QueuePage />);
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('tab', { name: 'Approved' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&status=approved');
      expect(screen.getByText('No entries found')).toBeInTheDocument();
      expect(screen.getByText('No entries with status "Approved".')).toBeInTheDocument();
    });
  });

  it('claims pending entries and refreshes the current listing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueResponse({
            results: [
              {
                ...makeQueueResponse().results[0],
                assigned_to_user_id: 'community-admin-1',
              },
            ],
          }),
      });

    render(<QueuePage />);
    await screen.findByText('Food Pantry');

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: 'q-1' }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/community/queue?page=1&limit=20');
      expect(screen.getByText('community-admin-1')).toBeInTheDocument();
    });
  });

  it('shows API errors for initial load and claim failures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'queue unavailable' }),
    });

    render(<QueuePage />);
    await screen.findByRole('alert');
    expect(screen.getByText('queue unavailable')).toBeInTheDocument();

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'already claimed by another reviewer' }),
      });

    render(<QueuePage />);
    await screen.findByText('Food Pantry');
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    await screen.findByRole('alert');
    expect(screen.getByText('already claimed by another reviewer')).toBeInTheDocument();
  });
});
