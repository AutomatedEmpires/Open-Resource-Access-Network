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
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'community-admin-1',
      },
    },
  }),
}));

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
        sla_deadline: null,
        sla_breached: false,
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
  replaceMock.mockReset();
  navigationState.searchParams = new URLSearchParams();
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

    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/community/queue?page=1&limit=20');
    expect(screen.getAllByText('40 entries').length).toBeGreaterThan(0);
    expect(screen.getByText(/\(\d+d\)/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=2&limit=20');
      expect(screen.getAllByText('2 / 2')).not.toHaveLength(0);
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
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Approved' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&status=approved');
      expect(screen.getByText('No entries found')).toBeInTheDocument();
      expect(screen.getByText('No entries with status "Approved".')).toBeInTheDocument();
    });
  });

  it('applies the assigned-to-me filter and supports manual refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueResponse({
            results: [
              {
                ...makeQueueResponse().results[0],
                assigned_to_user_id: 'community-admin-1',
                assigned_to_display_name: 'community-admin-1',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      });

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Assigned to me' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&assignedToMe=true');
      expect(screen.getAllByText('community-admin-1')).not.toHaveLength(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&assignedToMe=true');
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
                assigned_to_display_name: 'community-admin-1',
              },
            ],
          }),
      });

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Claim' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: 'q-1' }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/community/queue?page=1&limit=20');
      expect(screen.getAllByText('community-admin-1')).not.toHaveLength(0);
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
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Claim' })[0]);

    await screen.findByRole('alert');
    expect(screen.getByText('already claimed by another reviewer')).toBeInTheDocument();
  });

  it('renders bulk actions, processes approval selection, and resets selected state', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueResponse({
            total: 2,
            results: [
              {
                ...makeQueueResponse().results[0],
                id: 'q-1',
                service_name: 'Food Pantry',
                status: 'submitted',
                sla_breached: true,
              },
              {
                ...makeQueueResponse().results[0],
                id: 'q-2',
                service_name: 'Health Clinic',
                status: 'under_review',
                assigned_to_user_id: 'reviewer-2',
                assigned_to_display_name: 'reviewer-2',
                sla_deadline: '2026-02-20T00:00:00.000Z',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: ['q-1'], failed: [{ id: 'q-2', error: 'locked' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({ total: 0, results: [] }),
      });

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    expect(screen.getByText('Breached')).toBeInTheDocument();
    expect(screen.getAllByText('reviewer-2')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['q-1', 'q-2'], decision: 'approved' }),
      });
    });

    await screen.findByText('No entries found');
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('surfaces bulk-action API errors and allows dismissing the alert', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'bulk queue unavailable' }),
      });

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);

    fireEvent.click(screen.getAllByRole('checkbox', { name: /Select Food Pantry/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject selected' }));

    await screen.findByRole('alert');
    expect(screen.getByText('bulk queue unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('bulk queue unavailable')).not.toBeInTheDocument();
  });

  it('shows default empty-state copy when no status filter is active', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeQueueResponse({ results: [], total: 0 }),
    });

    render(<QueuePage />);

    await screen.findByText('No entries found');
    expect(screen.getByText('The review queue is empty.')).toBeInTheDocument();
  });
});
