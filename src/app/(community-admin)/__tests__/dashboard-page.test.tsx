// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: { name: 'Jordan Rivera' },
    },
  }),
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="dashboard-skeleton" className={className}>
      Loading...
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import DashboardPage from '@/app/(community-admin)/dashboard/page';

function makeCoverageResponse(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      submitted: 5,
      underReview: 3,
      approved: 11,
      escalated: 1,
      slaBreached: 2,
    },
    recentActivity: [
      { date: '2026-03-07', approved: 2, denied: 1, escalated: 0 },
    ],
    zone: {
      id: 'zone-1',
      name: 'Central Texas',
      description: 'Austin metro community review zone.',
      states: ['TX'],
      counties: ['TX_Travis'],
      hasGeometry: true,
      hasExplicitScope: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('community admin dashboard page', () => {
  it('loads and renders scoped dashboard metrics and actions', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCoverageResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 4 }),
      });

    render(<DashboardPage />);

    await screen.findByText('Quick Actions');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/community/coverage');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue?assignedToMe=true&limit=1');
    expect(screen.getByText('Jordan')).toBeInTheDocument();
    expect(screen.getAllByText('Central Texas').length).toBeGreaterThan(0);
    expect(screen.getByText('Operations Queue')).toBeInTheDocument();
    expect(screen.getByText('Escalations')).toBeInTheDocument();
    expect(screen.getByText('Shift Briefing')).toBeInTheDocument();
    expect(screen.getByText('Alert Center')).toBeInTheDocument();
    expect(screen.getByText('Audit Readiness')).toBeInTheDocument();
    expect(screen.getByText('Document review evidence')).toBeInTheDocument();
    expect(screen.getByText('Zone boundary verified')).toBeInTheDocument();
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Continue a Review')).toBeInTheDocument();
    expect(screen.getByText('Handle Escalations')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Under Review')).toBeInTheDocument();
    expect(screen.getByText('SLA Breached')).toBeInTheDocument();
    expect(screen.getAllByText('Escalated').length).toBeGreaterThan(0);
  });

  it('shows API errors and recovers through refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'community dashboard unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCoverageResponse({ recentActivity: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 1 }),
      });

    render(<DashboardPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('community dashboard unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(screen.getByText('No decisions recorded in the last 7 days.')).toBeInTheDocument();
      expect(screen.getByText('Audit Readiness')).toBeInTheDocument();
    });
  });
});
