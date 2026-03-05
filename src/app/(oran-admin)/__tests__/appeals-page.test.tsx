// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="appeals-skeleton">Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: toastSuccessMock,
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import AppealsPage from '@/app/(oran-admin)/appeals/page';

function makeAppeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appeal-1',
    status: 'submitted',
    title: 'Appeal for denied listing',
    notes: 'Please review this decision.',
    reviewer_notes: null,
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    priority: 1,
    original_submission_id: 'orig-1',
    original_submission_type: 'service_verification',
    created_at: '2026-01-10T00:00:00.000Z',
    updated_at: '2026-01-10T00:00:00.000Z',
    service_id: 'svc-1',
    ...overrides,
  };
}

function makeAppealResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [makeAppeal()],
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

describe('oran admin appeals page', () => {
  it('loads appeals and applies status filter tabs', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAppealResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAppealResponse({ results: [], total: 0 }),
      });

    render(<AppealsPage />);

    await screen.findByText('Appeal for denied listing');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/appeals?page=1&limit=20');

    fireEvent.click(screen.getByRole('tab', { name: 'Denied' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/appeals?page=1&limit=20&status=denied');
      expect(screen.getByText('No appeals found')).toBeInTheDocument();
      expect(screen.getByText('No appeals with status "Denied".')).toBeInTheDocument();
    });
  });

  it('submits an approval decision and refreshes list data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAppealResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Appeal approved successfully' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAppealResponse({ results: [makeAppeal({ status: 'approved' })] }),
      });

    render(<AppealsPage />);
    await screen.findByText('Appeal for denied listing');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Appeal' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appealId: 'appeal-1',
          decision: 'approved',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/appeals?page=1&limit=20');
      expect(toastSuccessMock).toHaveBeenCalledWith('Appeal approved successfully');
      expect(screen.getByRole('alert')).toHaveTextContent('Appeal approved successfully');
    });
  });

  it('requires notes to deny and surfaces API decision failures', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAppealResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'cannot deny yet' }),
      });

    render(<AppealsPage />);
    await screen.findByText('Appeal for denied listing');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const denyButton = screen.getByRole('button', { name: 'Deny Appeal' });
    expect(denyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Decision notes'), {
      target: { value: 'Requires additional evidence.' },
    });
    expect(denyButton).toBeEnabled();
    fireEvent.click(denyButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('cannot deny yet');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  it('renders load errors from API responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'appeals service unavailable' }),
    });

    render(<AppealsPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('appeals service unavailable')).toBeInTheDocument();
  });
});
