// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));

import SecurityPage from '@/app/(oran-admin)/admin-security/page';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin security page', () => {
  it('loads accounts and submits a freeze decision', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            user_id: 'user-2',
            display_name: 'Jordan',
            email: 'jordan@example.com',
            role: 'host_admin',
            account_status: 'active',
            security_note: null,
            suspended_at: null,
            restored_at: null,
            organization_count: 2,
            updated_at: '2026-03-16T12:00:00.000Z',
          }],
          total: 1,
          page: 1,
          hasMore: false,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Account frozen successfully.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], total: 0, page: 1, hasMore: false }) });

    render(<SecurityPage />);

    await screen.findByText('Jordan');
    fireEvent.change(screen.getByPlaceholderText('Record why this account is being frozen or restored.'), {
      target: { value: 'Credential stuffing investigation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze account' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/security/accounts', expect.objectContaining({ method: 'POST' }));
    });
  });
});
