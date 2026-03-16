// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));

import ReportsPage from '@/app/(oran-admin)/reports/page';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin reports page', () => {
  it('loads reports and submits an approval decision', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 'rep-1',
            status: 'submitted',
            title: 'Report: suspected fraud',
            notes: 'Phone number routes to scam line',
            reviewer_notes: null,
            service_id: 'svc-1',
            reason: 'suspected_fraud',
            created_at: '2026-03-16T12:00:00.000Z',
            updated_at: '2026-03-16T12:00:00.000Z',
            service_name: 'Food Pantry',
            organization_name: 'Helping Hands',
            integrity_hold_at: null,
            is_high_risk: true,
          }],
          total: 1,
          page: 1,
          hasMore: false,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Report resolved and integrity hold applied.' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], total: 0, page: 1, hasMore: false }),
      });

    render(<ReportsPage />);

    await screen.findByText('Report: suspected fraud');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve report' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/reports', expect.objectContaining({ method: 'POST' }));
    });
  });
});
