// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="dashboard-skeleton" className={className}>Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import HostDashboardPage from '@/app/(host)/host/page';

function makeDashboardResponse(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      organizations: 2,
      incompleteOrganizations: 1,
      services: 14,
      staleServices: 3,
      locations: 6,
      staleLocations: 1,
      teamMembers: 4,
      pendingInvites: 1,
      pendingReviews: 5,
      claimsInFlight: 2,
    },
    recentSubmissions: [
      {
        id: 'sub-1',
        title: 'Update Downtown Pantry hours',
        submission_type: 'service_verification',
        status: 'under_review',
        organization_name: 'Helping Hands',
        created_at: '2026-03-08T10:00:00.000Z',
      },
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

describe('host dashboard page', () => {
  it('loads and renders the host operational overview', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDashboardResponse(),
    });

    render(<HostDashboardPage />);

    await screen.findByText('Operational Snapshot');
    expect(fetchMock).toHaveBeenCalledWith('/api/host/dashboard');
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Update Downtown Pantry hours')).toBeInTheDocument();
    expect(screen.getByText('Helping Hands')).toBeInTheDocument();
    expect(screen.getByText('Action center')).toBeInTheDocument();
    expect(screen.getAllByText('Pending reviews').length).toBeGreaterThan(0);
    expect(screen.getByText('Publication alerts')).toBeInTheDocument();
    expect(screen.getByText('Audit readiness')).toBeInTheDocument();
    expect(screen.getByText('Review backlog is blocking publication')).toBeInTheDocument();
    expect(screen.getByText('Complete public trust fields')).toBeInTheDocument();
    expect(screen.getByText('Quick actions')).toBeInTheDocument();
    expect(screen.getByText('Shift briefing')).toBeInTheDocument();
    expect(screen.getByText('Workspace guide')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Update Downtown Pantry hours' })).toHaveAttribute(
      'href',
      '/resource-studio?entryId=sub-1',
    );
    expect(screen.getByRole('link', { name: /^Open resource studio/i })).toHaveAttribute(
      'href',
      '/resource-studio',
    );
  });

  it('shows API errors and supports refresh retry', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'host dashboard unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeDashboardResponse({ recentSubmissions: [] }),
      });

    render(<HostDashboardPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('host dashboard unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('No active host submissions right now.')).toBeInTheDocument();
      expect(screen.getByText('Audit readiness')).toBeInTheDocument();
    });
  });
});
