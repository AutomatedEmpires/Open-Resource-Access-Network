// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));

import OperationsPage from '@/app/(oran-admin)/operations/page';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin operations page', () => {
  it('renders summary metrics and refreshes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          approvals_pending: 4,
          appeals_open: 2,
          reports_open: 3,
          high_risk_reports_open: 1,
          scopes_pending: 5,
          integrity_held_services: 6,
        },
        recentActivity: [
          { id: 'sub-1', submission_type: 'community_report', status: 'submitted', title: 'Fraud report', updated_at: '2026-03-16T12:00:00.000Z' },
        ],
      }),
    });

    render(<OperationsPage />);

    await screen.findByText('Pending approvals');
    expect(screen.getByText('4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/operations/summary');
    });
  });
});
