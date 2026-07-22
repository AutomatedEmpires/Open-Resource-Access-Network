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
  SkeletonCard: () => <div>Loading...</div>,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
    info: vi.fn(),
    toast: vi.fn(),
  }),
}));

import ApprovalsPageClient from '../ApprovalsPageClient';

function claim(status: 'needs_review' | 'pending_second_approval' | 'approved') {
  return {
    id: 'claim-1',
    service_id: 'service-1',
    status,
    submitted_by_user_id: 'host-1',
    assigned_to_user_id: null,
    notes: 'Please verify my role.',
    created_at: '2026-07-21T00:00:00.000Z',
    updated_at: '2026-07-21T00:00:00.000Z',
    service_name: 'Community Resource',
    organization_id: 'org-1',
    organization_name: 'Exact Claim Organization',
    organization_url: 'https://example.org',
    organization_email: 'owner@example.org',
  };
}

function claimsResponse(status: 'needs_review' | 'pending_second_approval' | 'approved') {
  return { results: [claim(status)], total: 1, page: 1, hasMore: false };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('organization claim review states', () => {
  it('exposes needs-review and second-approval claims as actionable', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => claimsResponse('needs_review'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'First review recorded. A different ORAN administrator must provide final approval.',
          toStatus: 'pending_second_approval',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => claimsResponse('pending_second_approval'),
      });

    render(<ApprovalsPageClient />);

    await screen.findByText('Exact Claim Organization');
    expect(screen.getByRole('tab', { name: 'Needs Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Second Approval' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quick action' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: 'claim-1',
          decision: 'approved',
        }),
      });
      expect(toastSuccessMock).toHaveBeenCalledWith('Claim sent for second approval');
      expect(screen.getByRole('status')).toHaveTextContent('A different ORAN administrator');
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quick action' })).toBeInTheDocument();
    });
  });

  it('keeps card review available for approved projection repair', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => claimsResponse('approved'),
    });

    render(<ApprovalsPageClient />);

    await screen.findByText('Exact Claim Organization');
    expect(screen.getByRole('link', { name: 'Card review' })).toHaveAttribute(
      'href',
      '/approvals/claim-1',
    );
    expect(screen.queryByRole('button', { name: 'Quick action' })).not.toBeInTheDocument();
  });
});
