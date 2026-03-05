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
  SkeletonCard: () => <div data-testid="claims-skeleton">Loading...</div>,
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

import ApprovalsPage from '@/app/(oran-admin)/approvals/page';

function makeClaimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    service_id: 'service-1',
    status: 'submitted',
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    notes: 'Original submitter note',
    created_at: '2026-01-10T00:00:00.000Z',
    updated_at: '2026-01-10T00:00:00.000Z',
    service_name: 'Emergency Shelter',
    organization_id: 'org-1',
    organization_name: 'Helping Hands Org',
    organization_url: 'https://example.org',
    organization_email: 'contact@example.org',
    ...overrides,
  };
}

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [makeClaimRow()],
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

describe('oran admin approvals page', () => {
  it('loads claims and applies status tab filters', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResponse({ results: [], total: 0 }),
      });

    render(<ApprovalsPage />);

    await screen.findByText('Helping Hands Org');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/approvals?page=1&limit=20');

    fireEvent.click(screen.getByRole('tab', { name: 'Denied' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/approvals?page=1&limit=20&status=denied');
      expect(screen.getByText('No claims found')).toBeInTheDocument();
      expect(screen.getByText('No claims with status "Denied".')).toBeInTheDocument();
    });
  });

  it('requires notes before deny and submits decision with refresh + toast', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Decision recorded' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeResponse({
            results: [makeClaimRow({ status: 'denied', notes: 'duplicate claim' })],
          }),
      });

    render(<ApprovalsPage />);
    await screen.findByText('Helping Hands Org');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const denyButton = screen.getByRole('button', { name: 'Deny' });
    expect(denyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Decision notes'), {
      target: { value: '  duplicate claim  ' },
    });
    expect(denyButton).toBeEnabled();
    fireEvent.click(denyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: 'claim-1',
          decision: 'denied',
          notes: 'duplicate claim',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/approvals?page=1&limit=20');
      expect(toastSuccessMock).toHaveBeenCalledWith('Claim denied successfully');
      expect(screen.getByRole('alert')).toHaveTextContent('Decision recorded');
    });
  });

  it('shows API decision errors and keeps review panel open', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'cannot deny yet' }),
      });

    render(<ApprovalsPage />);
    await screen.findByText('Helping Hands Org');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.change(screen.getByLabelText('Decision notes'), {
      target: { value: 'reason provided' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('cannot deny yet');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });
});
