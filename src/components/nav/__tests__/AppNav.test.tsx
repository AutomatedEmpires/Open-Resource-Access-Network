// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OranRole } from '@/domain/types';

const usePathnameMock = vi.hoisted(() => vi.fn());
const useOranAuthMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
const openCrisisMock = vi.hoisted(() => vi.fn());

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
vi.mock('@/services/auth/client', () => ({
  useOranAuth: useOranAuthMock,
}));
vi.mock('@/components/crisis/CrisisContext', () => ({
  useCrisisModal: () => ({ openCrisis: openCrisisMock }),
}));
vi.mock('lucide-react', () => ({
  AlertTriangle: 'svg',
  Bookmark: 'svg',
  ChevronDown: 'svg',
  List: 'svg',
  LogOut: 'svg',
  MapPin: 'svg',
  Menu: 'svg',
  MessageCircle: 'svg',
  Rows3: 'svg',
  User: 'svg',
  X: 'svg',
}));
vi.mock('../LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('../NotificationBell', () => ({
  NotificationBell: () => null,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({
    t: (key: string) => ({
      'nav.chat': 'Find help',
      'nav.directory': 'Browse services',
      'nav.map': 'Map',
      'nav.scroll': 'Resource feed',
      'nav.saved': 'Saved',
      'nav.crisis': 'Crisis',
      'footer.crisis_resources_aria': 'Open crisis resources and emergency hotlines',
      'nav.profile': 'Profile',
      'nav.account': 'Account',
      'nav.sign_in': 'Sign in',
      'nav.sign_out': 'Sign out',
      'nav.notifications': 'Notifications',
      'nav.invitations': 'Invitations',
      'nav.profile_menu_aria': 'Open account menu',
      'nav.explore': 'More ways to browse',
      'nav.more': 'More',
      'nav.for_providers': 'For providers',
      'nav.submit_or_correct': 'Submit or correct a resource',
      'nav.volunteer_to_review': 'Volunteer to review resources',
      'nav.your_services': 'Your services',
      'nav.open_menu': 'Open navigation menu',
      'nav.close_menu': 'Close navigation menu',
      'nav.main_label': 'Main navigation',
    }[key] ?? key),
  }),
}));

import { AppNav } from '../AppNav';

function setAnonymousAuth() {
  useOranAuthMock.mockReturnValue({
    data: null,
    status: 'unauthenticated',
    signOut: signOutMock,
  });
}

function setAuthenticatedRole(role: OranRole) {
  useOranAuthMock.mockReturnValue({
    data: {
      user: {
        id: `user-${role}`,
        name: 'Test User',
        email: 'test@example.com',
        role,
        accountStatus: 'active',
      },
    },
    status: 'authenticated',
    signOut: signOutMock,
  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  usePathnameMock.mockReturnValue('/directory');
  signOutMock.mockResolvedValue(undefined);
  setAnonymousAuth();
});

describe('AppNav', () => {
  it('keeps primary discovery, saved resources, and anonymous preferences discoverable', () => {
    render(<AppNav />);

    const primary = screen.getByTestId('desktop-primary-nav');
    expect(within(primary).getByRole('link', { name: 'Find help' })).toHaveAttribute('href', '/chat');
    expect(within(primary).getByRole('link', { name: 'Browse services' })).toHaveAttribute('href', '/directory');
    expect(within(primary).getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
    expect(within(primary).getByRole('link', { name: 'Browse services' })).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('link', { name: 'Saved' })).toHaveAttribute('href', '/saved');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/signin?callbackUrl=%2Fdirectory',
    );
    expect(screen.queryByRole('button', { name: 'Open account menu' })).not.toBeInTheDocument();
  });

  it('puts every primary destination in the responsive drawer and closes it after navigation', () => {
    usePathnameMock.mockReturnValue('/map/nearby');
    render(<AppNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = document.getElementById('mobile-nav');
    expect(drawer).not.toBeNull();
    if (!drawer) throw new Error('Responsive navigation drawer did not open.');

    expect(within(drawer).getByRole('link', { name: 'Find help' })).toHaveAttribute('href', '/chat');
    expect(within(drawer).getByRole('link', { name: 'Browse services' })).toHaveAttribute('href', '/directory');
    expect(within(drawer).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    expect(within(drawer).getByRole('link', { name: 'Saved' })).toHaveAttribute('href', '/saved');
    expect(within(drawer).getByRole('link', { name: 'For providers' })).toHaveAttribute(
      'href',
      '/partnerships/organizations',
    );
    expect(within(drawer).getByRole('link', { name: 'Submit or correct a resource' })).toHaveAttribute(
      'href',
      '/submit-resource',
    );
    expect(within(drawer).getByRole('link', { name: 'Volunteer to review resources' })).toHaveAttribute(
      'href',
      '/partnerships/admins',
    );

    fireEvent.click(within(drawer).getByRole('link', { name: 'Map' }));
    expect(document.getElementById('mobile-nav')).not.toBeInTheDocument();
  });

  it('opens the shared crisis experience from the compact tablet header control', () => {
    render(<AppNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Open crisis resources and emergency hotlines' }));
    expect(openCrisisMock).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the responsive drawer trigger when Escape closes the drawer', () => {
    render(<AppNav />);

    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(trigger);
    const drawer = document.getElementById('mobile-nav');
    expect(drawer).not.toBeNull();
    if (!drawer) throw new Error('Responsive navigation drawer did not open.');

    const drawerLink = within(drawer).getByRole('link', { name: 'Map' });
    drawerLink.focus();
    fireEvent.keyDown(drawerLink, { key: 'Escape' });

    expect(document.getElementById('mobile-nav')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it.each<{
    role: OranRole;
    expectedHrefs: string[];
  }>([
    { role: 'seeker', expectedHrefs: ['/profile', '/saved', '/notifications', '/invitations'] },
    { role: 'host_admin', expectedHrefs: ['/host', '/org/profile', '/admins', '/notifications'] },
    { role: 'community_admin', expectedHrefs: ['/dashboard', '/queue', '/coverage', '/notifications'] },
    { role: 'oran_admin', expectedHrefs: ['/operations', '/approvals', '/audit', '/notifications'] },
  ])('exposes the $role account destinations through a disclosure', ({ role, expectedHrefs }) => {
    setAuthenticatedRole(role);
    render(<AppNav />);

    const trigger = screen.getByRole('button', { name: 'Open account menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'account-disclosure');
    expect(trigger).not.toHaveAttribute('aria-haspopup');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const disclosure = document.getElementById('account-disclosure');
    expect(disclosure).not.toBeNull();
    for (const href of expectedHrefs) {
      expect(disclosure?.querySelector(`a[href="${href}"]`)).toBeTruthy();
    }
    expect(within(disclosure as HTMLElement).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(disclosure as HTMLElement).queryByRole('menu')).not.toBeInTheDocument();
    expect(within(disclosure as HTMLElement).queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('closes the account disclosure and delegates sign-out to the authenticated client', () => {
    setAuthenticatedRole('host_admin');
    render(<AppNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    const disclosure = document.getElementById('account-disclosure');
    expect(disclosure).not.toBeNull();
    fireEvent.click(within(disclosure as HTMLElement).getByRole('button', { name: 'Sign out' }));

    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: '/' });
    expect(document.getElementById('account-disclosure')).not.toBeInTheDocument();
  });

  it('restores focus to the account trigger when Escape closes the disclosure', () => {
    setAuthenticatedRole('community_admin');
    render(<AppNav />);

    const trigger = screen.getByRole('button', { name: 'Open account menu' });
    fireEvent.click(trigger);
    const disclosure = document.getElementById('account-disclosure');
    expect(disclosure).not.toBeNull();
    if (!disclosure) throw new Error('Account disclosure did not open.');

    const notificationLink = within(disclosure).getByRole('link', { name: 'Notifications' });
    notificationLink.focus();
    fireEvent.keyDown(notificationLink, { key: 'Escape' });

    expect(document.getElementById('account-disclosure')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
