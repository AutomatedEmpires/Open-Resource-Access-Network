// @vitest-environment jsdom

import React from 'react';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeStoredSeekerProfile } from '@/services/profile/clientContext';
import { writeStoredProfilePreferences } from '@/services/profile/syncPreference';
import { writeStoredSavedServiceIds } from '@/services/saved/client';

const usePathnameMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}));

vi.mock('@/components/command/CommandPalette', () => ({
  CommandPalette: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (
    <div>
      <p data-testid="palette-state">{open ? 'open' : 'closed'}</p>
      <button type="button" onClick={onClose}>close-palette</button>
    </div>
  ),
}));

vi.mock('@/components/footer', () => ({
  AppFooter: () => <div data-testid="app-footer" />,
}));

import SeekerLayoutShell from '@/app/(seeker)/SeekerLayoutShell';

beforeEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  usePathnameMock.mockReturnValue('/chat');
});

afterAll(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('seeker layout shell', () => {
  it('toggles command palette with Ctrl/Cmd+K and closes through palette callback', () => {
    render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);

    expect(screen.getAllByRole('button', { name: 'Open quick actions' })).toHaveLength(2);
    expect(screen.getByTestId('palette-state')).toHaveTextContent('closed');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('palette-state')).toHaveTextContent('open');

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByTestId('palette-state')).toHaveTextContent('closed');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('palette-state')).toHaveTextContent('open');
    fireEvent.click(screen.getByRole('button', { name: 'close-palette' }));
    expect(screen.getByTestId('palette-state')).toHaveTextContent('closed');
  });

  it('loads saved count badge from localStorage, caps at 99+, and ignores invalid JSON', async () => {
    usePathnameMock.mockReturnValue('/saved');
    localStorage.setItem(
      'oran:saved-service-ids',
      JSON.stringify(Array.from({ length: 120 }, (_, i) => `svc-${i}`)),
    );

    const { unmount } = render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);
    await waitFor(() => {
      expect(screen.getAllByText('99+').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('99+').length).toBeGreaterThan(0);
    unmount();

    localStorage.setItem('oran:saved-service-ids', '{bad-json');
    render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);
    await waitFor(() => {
      expect(screen.queryByText('99+')).toBeNull();
    });
  });

  it('renders seeker context strip details from localStorage', async () => {
    localStorage.setItem('oran:preferences', JSON.stringify({ approximateCity: 'Phoenix' }));
    localStorage.setItem('oran:saved-service-ids', JSON.stringify(['svc-1', 'svc-2']));
    localStorage.setItem(
      'oran:seeker-context',
      JSON.stringify({
        serviceInterests: ['food_assistance', 'housing'],
        profileHeadline: 'Parent seeking stable housing',
      }),
    );

    render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);

    await waitFor(() => {
      expect(screen.getByText('Near Phoenix (approx.)')).toBeInTheDocument();
    });

    expect(screen.getByText(/Private by default/)).toBeInTheDocument();
    expect(screen.getByText('2 saved')).toBeInTheDocument();
    expect(screen.getByText('Personalized profile')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Personalize your search' })).toBeInTheDocument();
  });

  it('updates saved badges and context strip immediately when same-tab saved state changes', async () => {
    usePathnameMock.mockReturnValue('/directory');

    render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);

    await waitFor(() => {
      expect(screen.queryByText('1 saved')).toBeNull();
    });

    writeStoredSavedServiceIds(['svc-1']);

    await waitFor(() => {
      expect(screen.getByText('1 saved')).toBeInTheDocument();
    });
  });

  it('updates profile context chips immediately when same-tab preferences change', async () => {
    usePathnameMock.mockReturnValue('/profile');

    render(<SeekerLayoutShell planEnabled>Child</SeekerLayoutShell>);

    writeStoredProfilePreferences({ approximateCity: 'Tacoma', serverSyncEnabled: true });
    writeStoredSeekerProfile({
      serviceInterests: ['food_assistance'],
      profileHeadline: 'Parent seeking support',
    });

    await waitFor(() => {
      expect(screen.getByText('Near Tacoma (approx.)')).toBeInTheDocument();
    });

    expect(screen.getByText(/Private by default/)).toBeInTheDocument();
    expect(screen.getByText('Personalized profile')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage preferences' })).toBeInTheDocument();
  });

  it('hides the plan navigation item when the feature flag is off', () => {
    render(<SeekerLayoutShell planEnabled={false}>Child</SeekerLayoutShell>);

    expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
  });

  it('shows the dashboard navigation item only when the dashboard flag is on', () => {
    const { rerender } = render(<SeekerLayoutShell planEnabled reminderEnabled dashboardEnabled={false}>Child</SeekerLayoutShell>);

    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();

    rerender(<SeekerLayoutShell planEnabled reminderEnabled dashboardEnabled>Child</SeekerLayoutShell>);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
