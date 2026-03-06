// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="scope-skeleton">Loading...</div>,
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
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

import ScopeCenterPage from '@/app/(oran-admin)/scopes/page';

function makeScope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scope-1',
    name: 'admin.manage_users',
    description: 'Manage platform users',
    risk_level: 'high',
    requires_approval: true,
    is_active: true,
    created_at: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    user_id: '11111111-1111-4111-8111-111111111111',
    scope_name: 'admin.manage_users',
    organization_id: null,
    status: 'pending_approval',
    requested_by_user_id: '22222222-2222-4222-8222-222222222222',
    justification: 'Need to handle weekly access reviews',
    created_at: '2026-01-10T00:00:00.000Z',
    expires_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin scope center page', () => {
  it('loads scopes, creates a new scope, and paginates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 41 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'scope-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 41 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          ({
            results: [makeScope({ id: 'scope-2', name: 'admin.manage_billing' })],
            total: 41,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 41 }),
      });

    render(<ScopeCenterPage />);

    await screen.findByText('admin.manage_users');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/scopes?page=1&limit=20');

    fireEvent.click(screen.getByRole('button', { name: 'New Scope' }));
    fireEvent.change(screen.getByLabelText('Scope name'), {
      target: { value: 'admin.manage_billing' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Handle billing controls' },
    });
    fireEvent.change(screen.getByLabelText('Risk level'), {
      target: { value: 'critical' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'admin.manage_billing',
          description: 'Handle billing controls',
          risk_level: 'critical',
          requires_approval: true,
        }),
      });
      expect(toastSuccessMock).toHaveBeenCalledWith('Scope created');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/scopes?page=2&limit=20');
      expect(screen.getByText('admin.manage_billing')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/admin/scopes?page=1&limit=20');
      expect(screen.getByText('admin.manage_users')).toBeInTheDocument();
    });
  });

  it('reviews and approves a pending grant', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeGrant()] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'grant-1', status: 'approved' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

    render(<ScopeCenterPage />);
    await screen.findByText('admin.manage_users');

    fireEvent.click(screen.getByRole('tab', { name: 'Pending Grants' }));
    await screen.findByText('Need to handle weekly access reviews');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const approveButton = screen.getByRole('button', { name: 'Approve' });
    expect(approveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Decision reason'), {
      target: { value: 'Approved after secondary review.' },
    });
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/scopes/grants/grant-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', reason: 'Approved after secondary review.' }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/scopes/grants');
      expect(toastSuccessMock).toHaveBeenCalledWith('Grant approved');
      expect(screen.getByText('No pending grants awaiting your approval.')).toBeInTheDocument();
    });
  });

  it('shows scopes and audit-tab API failures', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'scope API unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'audit unavailable' }),
      });

    render(<ScopeCenterPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Failed to load scopes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Audit Log' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/scopes/audit?limit=50');
      expect(screen.getByText('Failed to load audit log')).toBeInTheDocument();
    });
  });

  it('renders fallback scope badges and surfaces create-scope API errors', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            makeScope({
              id: 'scope-x',
              name: 'custom.scope',
              description: 'Custom scope for edge-case rendering',
              risk_level: 'unknown_risk',
              requires_approval: false,
              is_active: false,
            }),
          ],
          total: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Scope already exists' }),
      });

    render(<ScopeCenterPage />);

    await screen.findByText('custom.scope');
    expect(screen.getByText('unknown_risk')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New Scope' }));
    fireEvent.change(screen.getByLabelText('Scope name'), {
      target: { value: 'custom.scope' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Duplicate attempt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'custom.scope',
          description: 'Duplicate attempt',
          risk_level: 'medium',
          requires_approval: true,
        }),
      });
      expect(toastErrorMock).toHaveBeenCalledWith('Scope already exists');
    });
  });

  it('shows grant decision API errors and allows canceling review mode', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            makeGrant({
              id: 'grant-2',
              status: 'unknown_state',
              expires_at: '2026-03-01T00:00:00.000Z',
            }),
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Decision window closed' }),
      });

    render(<ScopeCenterPage />);
    await screen.findByText('admin.manage_users');

    fireEvent.click(screen.getByRole('tab', { name: 'Pending Grants' }));
    await screen.findByText('Need to handle weekly access reviews');
    expect(screen.getByText('unknown_state')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText(/Expires:/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Decision reason'), {
      target: { value: 'Denied after policy review.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/scopes/grants/grant-2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'denied', reason: 'Denied after policy review.' }),
      });
      expect(toastErrorMock).toHaveBeenCalledWith('Decision window closed');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Decision reason')).not.toBeInTheDocument();
  });

  it('renders populated audit log rows with null-justification fallback', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeScope()], total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'audit-1',
              actor_user_id: '12345678-1234-4234-8234-123456789abc',
              action: 'scope_grant_denied',
              target_type: 'scope',
              target_id: 'abcdef12-1234-4123-8123-abcdefabcdef',
              justification: null,
              created_at: '2026-01-11T00:00:00.000Z',
            },
          ],
        }),
      });

    render(<ScopeCenterPage />);
    await screen.findByText('admin.manage_users');

    fireEvent.click(screen.getByRole('tab', { name: 'Audit Log' }));

    await screen.findByText('scope_grant_denied');
    expect(screen.getByText(/scope: abcdef12…/i)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
