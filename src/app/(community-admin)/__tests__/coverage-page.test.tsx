// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="coverage-skeleton" className={className}>
      Loading...
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import CoveragePage from '@/app/(community-admin)/coverage/page';

function makeCoverageResponse(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      pending: 4,
      inReview: 2,
      verified: 9,
      rejected: 1,
      escalated: 1,
      total: 17,
      stale: 3,
    },
    recentActivity: [
      { date: '2026-02-01', verified: 3, rejected: 0, escalated: 1 },
      { date: '2026-02-02', verified: 0, rejected: 2, escalated: 0 },
    ],
    topOrganizations: [
      { organization_id: 'org-1', organization_name: 'Helping Hands', pending_count: 3 },
      { organization_id: 'org-2', organization_name: 'Food Access', pending_count: 1 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('community admin coverage page', () => {
  it('loads and renders summary/activity/organization cards', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeCoverageResponse(),
    });

    render(<CoveragePage />);

    expect(screen.getByRole('heading', { name: 'My Coverage Zone' })).toBeInTheDocument();
    await screen.findByText('Organizations Needing Review');

    expect(fetchMock).toHaveBeenCalledWith('/api/community/coverage');
    expect(screen.getByText('Helping Hands')).toBeInTheDocument();
    expect(screen.getByText('Food Access')).toBeInTheDocument();
    expect(screen.getByText('3 pending')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByText('Coverage Zone Map')).toBeInTheDocument();
  });

  it('shows API errors and recovers via refresh retry', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'coverage backend unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeCoverageResponse({
            summary: {
              pending: 0,
              inReview: 0,
              verified: 5,
              rejected: 0,
              escalated: 0,
              total: 5,
              stale: 0,
            },
          }),
      });

    render(<CoveragePage />);

    await screen.findByRole('alert');
    expect(screen.getByText('coverage backend unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Organizations Needing Review')).toBeInTheDocument();
    });
  });

  it('renders empty-state sections when activity and top organizations are absent', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeCoverageResponse({
          recentActivity: [],
          topOrganizations: [],
        }),
    });

    render(<CoveragePage />);

    await screen.findByText('No recent decisions recorded.');
    expect(screen.getByText('All caught up — no pending reviews.')).toBeInTheDocument();
  });
});
