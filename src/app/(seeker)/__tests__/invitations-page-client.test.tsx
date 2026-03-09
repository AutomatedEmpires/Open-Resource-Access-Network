// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/PageHeader', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  ),
  PageHeaderBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import InvitationsPageClient from '@/app/(seeker)/invitations/InvitationsPageClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('InvitationsPageClient', () => {
  it('renders empty state when there are no invites', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invites: [] }),
    });

    render(<InvitationsPageClient />);

    await screen.findByText('No pending invitations');
    expect(screen.getByRole('link', { name: 'Back to profile' })).toHaveAttribute('href', '/profile');
  });

  it('loads invitations and supports accept decision', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invites: [{
            id: 'invite-1',
            organization_id: 'org-1',
            organization_name: 'Helping Hands',
            role: 'host_admin',
            status: 'pending',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: null,
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ invites: [] }) });

    render(<InvitationsPageClient />);

    await screen.findByText('Helping Hands');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/host/admins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId: 'invite-1', action: 'accept' }),
      });
      expect(screen.getByRole('status')).toHaveTextContent('Invitation accepted');
    });
  });
});
