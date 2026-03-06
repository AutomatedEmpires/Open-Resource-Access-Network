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
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/api/auth/signout');
  });

  it('saves city and language locally and sends best-effort server updates', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      })
      .mockResolvedValueOnce({ ok: true }) // save city PUT
      .mockResolvedValueOnce({ ok: true }); // save language PUT

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
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual(
        expect.objectContaining({ approximateCity: 'Seattle, WA', language: 'ko' }),
      );
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
      expect(localStorage.getItem(SAVED_KEY)).toBeNull();
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
  });

  it('shows export and delete failures for authenticated users without clearing local data', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ approximateCity: 'Dallas', language: 'en' }));
    localStorage.setItem(SAVED_KEY, JSON.stringify(['svc-1']));
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            userId: 'user-1',
            preferredLocale: 'en',
            approximateCity: 'Dallas',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ preferences: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    render(<ProfilePage />);
    await screen.findByText('You are signed in. Your preferences are syncing across devices.');

    fireEvent.click(screen.getByRole('button', { name: 'downloading your data' }));
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
  });

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

    const inApp = await screen.findByLabelText('Submission assigned to you in-app notifications');
    const email = await screen.findByLabelText('Submission assigned to you email notifications');
    expect(inApp).toBeChecked();
    expect(email).toBeChecked();
  });
});
