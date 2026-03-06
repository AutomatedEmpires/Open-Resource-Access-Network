// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams('organizationId=org-1'),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import AdminsPage from '@/app/(host)/admins/page';

function makeOrganizationsResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [{ id: 'org-1', name: 'Helping Hands' }],
    ...overrides,
  };
}

function makeMembersResponse(overrides: Record<string, unknown> = {}) {
  return {
    members: [
      {
        id: 'mem-1',
        user_id: '11111111-1111-4111-8111-111111111111',
        organization_id: 'org-1',
        role: 'host_member',
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  navigationState.searchParams = new URLSearchParams('organizationId=org-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('host admins page', () => {
  it('loads members, confirms role changes, and surfaces remove failures', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMembersResponse({
            members: [
              {
                ...makeMembersResponse().members[0],
                role: 'host_admin',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'cannot remove the only admin' }),
      });

    render(<AdminsPage />);

    await screen.findByText('11111111-1111-4111-8111-111111111111');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/host/organizations');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/host/admins?organizationId=org-1');

    fireEvent.change(screen.getByLabelText('Change role for 11111111-1111-4111-8111-111111111111'), {
      target: { value: 'host_admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/admins/mem-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'host_admin' }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/admins?organizationId=org-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/host/admins/mem-1', { method: 'DELETE' });
      expect(screen.getByRole('alert')).toHaveTextContent('cannot remove the only admin');
    });
  });

  it('validates UUID input and adds a member successfully', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse({ members: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse(),
      });

    render(<AdminsPage />);
    await screen.findByText('No team members yet. Use the form above to add a collaborator.');

    // Switch to UUID input mode (default is email)
    fireEvent.click(screen.getByRole('button', { name: 'User ID' }));

    fireEvent.change(screen.getByLabelText('User ID (UUID)'), { target: { value: 'not-a-uuid' } });
    expect(screen.getByRole('button', { name: 'Add Member' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('User ID (UUID)'), {
      target: { value: '22222222-2222-4222-8222-222222222222' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'host_admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: 'org-1',
          role: 'host_admin',
          inviteMode: true,
          userId: '22222222-2222-4222-8222-222222222222',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/admins?organizationId=org-1');
      expect(screen.getByRole('alert')).toHaveTextContent('Team member added successfully.');
    });
  });

  it('shows auth-required message when no organization context exists', async () => {
    navigationState.searchParams = new URLSearchParams();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'not authenticated' }),
      status: 401,
    });

    render(<AdminsPage />);

    await screen.findByText('Authentication required');
    expect(screen.getByText(/Team management requires Microsoft Entra ID integration/i)).toBeInTheDocument();

    // Switch to UUID mode (default is email)
    fireEvent.click(screen.getByRole('button', { name: 'User ID' }));

    fireEvent.change(screen.getByLabelText('User ID (UUID)'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No organization selected.');
  });

  it('shows organization selector for multi-org users and switches team context', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeOrganizationsResponse({
            results: [
              { id: 'org-1', name: 'Helping Hands' },
              { id: 'org-2', name: 'Neighborhood Aid' },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeOrganizationsResponse({
            results: [
              { id: 'org-1', name: 'Helping Hands' },
              { id: 'org-2', name: 'Neighborhood Aid' },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeMembersResponse({
            members: [
              {
                id: 'mem-2',
                user_id: '22222222-2222-4222-8222-222222222222',
                organization_id: 'org-2',
                role: 'host_admin',
                status: 'active',
                created_at: '2026-01-02T00:00:00.000Z',
                updated_at: null,
              },
            ],
          }),
      });

    render(<AdminsPage />);

    await screen.findByLabelText('Select Organization');
    fireEvent.change(screen.getByLabelText('Select Organization'), {
      target: { value: 'org-2' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/host/admins?organizationId=org-2');
      expect(screen.getByText('22222222-2222-4222-8222-222222222222')).toBeInTheDocument();
    });
  });

  it('renders permission errors from team-member fetch responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden' }),
      });

    render(<AdminsPage />);

    await screen.findByText('You do not have permission to view this team.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/host/admins?organizationId=org-1');
  });

  it('renders 401 auth errors from team-member fetch responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'unauthorized' }),
      });

    render(<AdminsPage />);

    await screen.findByText('Authentication required to view team members.');
  });

  it('shows network failure message when member fetch throws', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockRejectedValueOnce(new Error('network down'));

    render(<AdminsPage />);

    await screen.findByText('Failed to connect to the server.');
  });

  it('shows invite API errors in email mode', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse({ members: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'User already invited' }),
      });

    render(<AdminsPage />);
    await screen.findByText('No team members yet. Use the form above to add a collaborator.');

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'already@invited.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: 'org-1',
          role: 'host_member',
          inviteMode: true,
          email: 'already@invited.org',
        }),
      });
      expect(screen.getByRole('alert')).toHaveTextContent('User already invited');
    });
  });

  it('shows fallback role-update error when API fails without json body', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('malformed json');
        },
      });

    render(<AdminsPage />);
    await screen.findByText('11111111-1111-4111-8111-111111111111');

    fireEvent.change(screen.getByLabelText('Change role for 11111111-1111-4111-8111-111111111111'), {
      target: { value: 'host_admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to update member role.');
  });

  it('removes member successfully and refreshes empty-state list', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeOrganizationsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMembersResponse({ members: [] }),
      });

    render(<AdminsPage />);
    await screen.findByText('11111111-1111-4111-8111-111111111111');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/admins/mem-1', { method: 'DELETE' });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/admins?organizationId=org-1');
      expect(screen.getByText('No team members yet. Use the form above to add a collaborator.')).toBeInTheDocument();
    });
  });
});
