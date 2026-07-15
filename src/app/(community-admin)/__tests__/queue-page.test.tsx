// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));
const authState = vi.hoisted(() => ({
  role: 'community_admin' as 'community_admin' | 'oran_admin',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/services/auth/client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'community-admin-1',
        role: authState.role,
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
        assigned_to_display_name: null,
        is_locked: false,
        locked_by_user_id: null,
        notes: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        service_name: 'Food Pantry',
        service_status: 'active',
        organization_id: 'org-1',
        organization_name: 'Helping Hands',
        sla_deadline: null,
        sla_breached: false,
        requires_structured_freshness_review: false,
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
  authState.role = 'community_admin';
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

  it('exposes the needs-review status tab and renders filtered empty-state messaging', async () => {
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

    const needsReviewFilter = screen.getByRole('button', { name: 'Needs Review' });
    expect(needsReviewFilter).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(needsReviewFilter);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&status=needs_review');
      expect(screen.getByText('No entries found')).toBeInTheDocument();
      expect(screen.getByText('No entries with status "Needs Review".')).toBeInTheDocument();
      expect(needsReviewFilter).toHaveAttribute('aria-pressed', 'true');
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

    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&assignedToMe=true');
      expect(screen.getAllByText('community-admin-1')).not.toHaveLength(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/community/queue?page=1&limit=20&assignedToMe=true');
    });
  });

  it('claims needs-review entries on mobile and desktop and refreshes the current listing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueResponse({
            results: [{ ...makeQueueResponse().results[0], status: 'needs_review' }],
          }),
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
                status: 'under_review',
                assigned_to_user_id: 'community-admin-1',
                assigned_to_display_name: 'community-admin-1',
                is_locked: true,
                locked_by_user_id: 'community-admin-1',
              },
            ],
          }),
      });

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Select Food Pantry' })).not.toBeInTheDocument();

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

  it('reserves escalated claims for ORAN admins in mobile and desktop views', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makeQueueResponse({
        results: [{ ...makeQueueResponse().results[0], status: 'escalated' }],
      }),
    });

    const communityView = render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();

    communityView.unmount();
    fetchMock.mockClear();
    authState.role = 'oran_admin';

    render(<QueuePage />);
    expect(await screen.findAllByText('Food Pantry')).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Claim' })[0]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: 'q-1' }),
      });
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
                status: 'under_review',
                assigned_to_user_id: 'community-admin-1',
                assigned_to_display_name: 'community-admin-1',
                is_locked: true,
                locked_by_user_id: 'community-admin-1',
                sla_breached: true,
              },
              {
                ...makeQueueResponse().results[0],
                id: 'q-2',
                service_name: 'Health Clinic',
                status: 'under_review',
                assigned_to_user_id: 'reviewer-2',
                assigned_to_display_name: 'reviewer-2',
                is_locked: true,
                locked_by_user_id: 'reviewer-2',
                sla_deadline: '2026-02-20T00:00:00.000Z',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: ['q-1'], failed: [] }),
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
    const selectedCount = screen.getByText('1 selected');
    expect(selectedCount).toBeInTheDocument();
    expect(selectedCount.parentElement).toHaveClass('flex-col', 'sm:flex-row');
    expect(screen.getByRole('button', { name: 'Approve selected' }).parentElement).toHaveClass('flex-wrap');
    expect(screen.queryByRole('checkbox', { name: 'Select Health Clinic' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['q-1'], decision: 'approved' }),
      });
    });

    await screen.findByText('No entries found');
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('keeps under-review work read-only unless the current user owns its assignment and lock', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeQueueResponse({
        total: 2,
        results: [
          {
            ...makeQueueResponse().results[0],
            id: 'q-unlocked',
            service_name: 'Unlocked Review',
            status: 'under_review',
            assigned_to_user_id: 'community-admin-1',
            is_locked: false,
            locked_by_user_id: null,
          },
          {
            ...makeQueueResponse().results[0],
            id: 'q-other-lock',
            service_name: 'Other Reviewer Lock',
            status: 'under_review',
            assigned_to_user_id: 'community-admin-1',
            is_locked: true,
            locked_by_user_id: 'reviewer-2',
          },
        ],
      }),
    });

    render(<QueuePage />);

    expect(await screen.findAllByText('Unlocked Review')).not.toHaveLength(0);
    expect(screen.queryByRole('checkbox', { name: 'Select Unlocked Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select Other Reviewer Lock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeDisabled();
  });

  it('keeps valid and malformed freshness rows out of bulk selection', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({
          total: 3,
          results: [
            {
              ...makeQueueResponse().results[0],
              id: 'q-normal',
              service_name: 'Food Pantry',
              status: 'under_review',
              assigned_to_user_id: 'community-admin-1',
              assigned_to_display_name: 'community-admin-1',
              is_locked: true,
              locked_by_user_id: 'community-admin-1',
            },
            {
              ...makeQueueResponse().results[0],
              id: 'q-fresh-valid',
              service_name: 'Housing Hours',
              status: 'under_review',
              assigned_to_user_id: 'community-admin-1',
              is_locked: true,
              locked_by_user_id: 'community-admin-1',
              requires_structured_freshness_review: true,
            },
            {
              ...makeQueueResponse().results[0],
              id: 'q-fresh-malformed',
              service_name: 'Clinic Schedule',
              status: 'under_review',
              assigned_to_user_id: 'community-admin-1',
              is_locked: true,
              locked_by_user_id: 'community-admin-1',
              requires_structured_freshness_review: true,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: ['q-normal'], failed: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueResponse({ results: [], total: 0 }),
      });

    render(<QueuePage />);

    expect(await screen.findAllByText('Housing Hours')).not.toHaveLength(0);
    expect(screen.getAllByText(/Individual evidence review required/i)).toHaveLength(4);
    expect(screen.queryByRole('checkbox', { name: 'Select Housing Hours' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select Clinic Schedule' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: 'Select Food Pantry' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['q-normal'], decision: 'approved' }),
      });
    });
  });

  it('surfaces bulk-action API errors and allows dismissing the alert', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueResponse({
            results: [{
              ...makeQueueResponse().results[0],
              status: 'under_review',
              assigned_to_user_id: 'community-admin-1',
              is_locked: true,
              locked_by_user_id: 'community-admin-1',
            }],
          }),
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
