// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild ? <>{children}</> : <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: toastMock,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import ProfilePage from '@/app/(seeker)/profile/ProfilePageClient';

const PREFS_KEY = 'oran:preferences';
const SAVED_KEY = 'oran:saved-service-ids';
const SEEKER_KEY = 'oran:seeker-context';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  document.documentElement.lang = 'en';
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('ProfilePageClient', () => {
  it('loads local-only preferences when unauthenticated and shows saved count summary', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ approximateCity: 'Austin, TX', language: 'vi' }));
    localStorage.setItem(SAVED_KEY, JSON.stringify(['svc-1', 'svc-2']));
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);

    await screen.findByText('Profile');
    await waitFor(() => {
      expect(screen.getByLabelText('City or region')).toHaveValue('Austin, TX');
      expect(screen.getByLabelText('Language')).toHaveValue('vi');
      expect(screen.getByText('2 services bookmarked on this device.')).toBeInTheDocument();
    });
  });

  it('personalizes the saved-empty browse link from the seeker service interest', async () => {
    localStorage.setItem(
      SEEKER_KEY,
      JSON.stringify({
        serviceInterests: ['housing'],
      }),
    );
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);

    await screen.findByText('No saved services yet.');
    expect(screen.getByRole('link', { name: 'Browse services' })).toHaveAttribute(
      'href',
      '/directory?q=housing&category=housing',
    );
  });

  it('uses canonical profile-derived discovery defaults for browse, chat, and map actions', async () => {
    localStorage.setItem(
      SEEKER_KEY,
      JSON.stringify({
        serviceInterests: ['housing'],
        preferredDeliveryModes: ['phone'],
        documentationBarriers: ['no_id'],
      }),
    );
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);

    await screen.findByText('No saved services yet.');
    expect(screen.getByRole('link', { name: 'Browse services' })).toHaveAttribute(
      'href',
      '/directory?q=housing&category=housing',
    );
    expect(screen.getByRole('link', { name: 'Ask chat' })).toHaveAttribute(
      'href',
      '/chat?q=housing&category=housing',
    );
    expect(screen.getByRole('link', { name: 'Map view' })).toHaveAttribute(
      'href',
      '/map?q=housing&category=housing',
    );
  });

  it('hydrates from authenticated server profile and shows signed-in account state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        profile: {
          userId: 'user-1',
          preferredLocale: 'es',
          approximateCity: 'Madrid',
        },
      }),
    });

    render(<ProfilePage />);

    await screen.findByText('You are signed in. Your preferences are syncing across devices.');
    expect(screen.getByLabelText('City or region')).toHaveValue('Madrid');
    expect(screen.getByLabelText('Language')).toHaveValue('es');
    // Sign out appears in both the auth banner and the privacy section — verify at least one
    const signOutLinks = screen.getAllByRole('link', { name: /sign out/i });
    expect(signOutLinks.length).toBeGreaterThanOrEqual(1);
    expect(signOutLinks[0]).toHaveAttribute('href', '/api/auth/signout');
  });

  it('saves city and language locally without server sync when not opted in', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);
    await screen.findByText('Profile');

    fireEvent.change(screen.getByLabelText('City or region'), {
      target: { value: 'Seattle, WA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual(
        expect.objectContaining({ approximateCity: 'Seattle, WA' }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'ko' },
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual(
        expect.objectContaining({ approximateCity: 'Seattle, WA', language: 'ko' }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps authenticated profiles local-only until sync is explicitly enabled', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            displayName: null,
            preferredLocale: null,
            approximateCity: null,
            seekerProfile: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ preferences: [] }),
      });

    render(<ProfilePage />);

    await screen.findByText('You are signed in. Profile changes stay on this device until you turn on cross-device sync.');
    expect(screen.getByText('Local-only until you opt in')).toBeInTheDocument();
    expect(screen.getByLabelText('Save my preferences to improve future results across devices')).not.toBeChecked();
  });

  it('enables cross-device sync explicitly before sending profile updates to the server', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            displayName: null,
            preferredLocale: null,
            approximateCity: null,
            seekerProfile: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ preferences: [] }),
      })
      .mockResolvedValue({ ok: true, status: 200 });

    render(<ProfilePage />);

    const syncToggle = await screen.findByLabelText('Save my preferences to improve future results across devices');
    expect(syncToggle).not.toBeChecked();

    fireEvent.click(syncToggle);

    await waitFor(() => {
      const syncCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/profile' && (call[1] as RequestInit | undefined)?.method === 'PUT');
      expect(syncCall?.[0]).toBe('/api/profile');
      expect(syncCall?.[1]).toMatchObject({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = JSON.parse(String((syncCall?.[1] as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>;
      expect(body.preferredLocale).toBe('en');
      expect(body.seekerProfile).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText('City or region'), {
      target: { value: 'Seattle, WA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approximateCity: 'Seattle, WA' }),
      });
    });

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'ko' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLocale: 'ko' }),
      });
    });
  });

  it('deletes all local data after confirmation and resets UI summary', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ approximateCity: 'Denver', language: 'fr' }));
    localStorage.setItem(SAVED_KEY, JSON.stringify(['svc-1']));
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);
    await screen.findByText('Profile');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(localStorage.getItem(PREFS_KEY)).toBeNull();
      expect(localStorage.getItem(SAVED_KEY)).toBe('[]');
      expect(screen.getByText('No saved services yet.')).toBeInTheDocument();
    });
  });

  it('loads notification preferences when authenticated and saves toggles', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            preferredLocale: 'en',
            approximateCity: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          preferences: [
            { eventType: 'submission_assigned', channel: 'in_app', enabled: true },
            { eventType: 'submission_assigned', channel: 'email', enabled: false },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    render(<ProfilePage />);

    await screen.findByText('Notification preferences');
    const inAppToggle = await screen.findByLabelText('Submission assigned to you in-app notifications');
    const emailToggle = await screen.findByLabelText('Submission assigned to you email notifications');
    expect(inAppToggle).toBeChecked();
    expect(emailToggle).not.toBeChecked();

    fireEvent.click(emailToggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/user/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: [{ eventType: 'submission_assigned', channel: 'email', enabled: true }],
        }),
      });
      expect(toastMock).toHaveBeenCalledWith('success', 'Notification enabled');
      expect(emailToggle).toBeChecked();
    });
  });

  it('reverts notification toggles when save fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            preferredLocale: 'en',
            approximateCity: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          preferences: [
            { eventType: 'submission_sla_warning', channel: 'in_app', enabled: true },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    render(<ProfilePage />);

    await screen.findByText('Notification preferences');
    const toggle = await screen.findByLabelText('SLA deadline approaching in-app notifications');
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/user/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: [{ eventType: 'submission_sla_warning', channel: 'in_app', enabled: false }],
        }),
      });
      expect(toastMock).toHaveBeenCalledWith('error', 'Failed to save notification preference');
      expect(toggle).toBeChecked();
    });
  });

  it('toggles color theme preference and supports canceling delete confirmation', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);
    await screen.findByText('Profile');

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('oran-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('oran-theme')).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
  }, 30_000);

  it('hydrates and persists Phase 1 constraint selections locally', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    render(<ProfilePage />);
    await screen.findByText('Profile');

    fireEvent.click(screen.getByRole('button', { name: 'Transportation is a barrier' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Need help today' }));
    fireEvent.click(screen.getByRole('button', { name: 'No ID available' }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(SEEKER_KEY) ?? '{}')).toEqual(
        expect.objectContaining({
          transportationBarrier: true,
          urgencyWindow: 'same_day',
          documentationBarriers: ['no_id'],
        }),
      );
    });
  }, 30_000);

  it('shows export and delete failures for authenticated users without clearing local data', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ approximateCity: 'Dallas', language: 'en' }));
    localStorage.setItem(SAVED_KEY, JSON.stringify(['svc-1']));
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/profile') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profile: {
              userId: 'user-1',
              preferredLocale: 'en',
              approximateCity: 'Dallas',
            },
          }),
        } as Response;
      }

      if (url === '/api/user/notifications/preferences') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ preferences: [] }),
        } as Response;
      }

      if (url === '/api/user/data-export' || url === '/api/user/data-delete') {
        return {
          ok: false,
          status: 500,
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ProfilePage />);
    await screen.findByText('You are signed in. Your preferences are syncing across devices.');

    fireEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    await waitFor(() => {
      const exportCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/user/data-export');
      expect(exportCall).toEqual(['/api/user/data-export', { method: 'POST' }]);
      expect(toastMock).toHaveBeenCalledWith('error', 'Failed to export data.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/user/data-delete');
      expect(deleteCall).toEqual(['/api/user/data-delete', { method: 'DELETE' }]);
      expect(toastMock).toHaveBeenCalledWith('error', 'Failed to delete server data. Please try again.');
      expect(localStorage.getItem(PREFS_KEY)).not.toBeNull();
      expect(localStorage.getItem(SAVED_KEY)).not.toBeNull();
    });
  }, 30_000);

  it('defaults notification channels to enabled when no explicit preference exists', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            preferredLocale: 'en',
            approximateCity: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ preferences: [] }),
      });

    render(<ProfilePage />);

    await screen.findByText('Notification preferences');
    const inApp = await screen.findByLabelText(
      'Submission assigned to you in-app notifications',
      {},
      { timeout: 10_000 },
    );
    const email = await screen.findByLabelText(
      'Submission assigned to you email notifications',
      {},
      { timeout: 10_000 },
    );
    expect(inApp).toBeChecked();
    expect(email).toBeChecked();
  }, 30_000);
});
