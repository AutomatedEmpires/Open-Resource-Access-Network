import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePathnameMock = vi.hoisted(() => vi.fn());
const useStateMock = vi.hoisted(() => vi.fn());
const useMemoMock = vi.hoisted(() => vi.fn());
const useSessionMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
    useMemo: useMemoMock,
  };
});
vi.mock('next/link', () => ({
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}));
vi.mock('next-auth/react', () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
}));
vi.mock('lucide-react', () => ({
  ChevronDown: 'svg',
  List: 'svg',
  LogOut: 'svg',
  MapPin: 'svg',
  Menu: 'svg',
  MessageCircle: 'svg',
  User: 'svg',
  X: 'svg',
}));
vi.mock('../LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({
    t: (key: string) => ({
      'nav.chat': 'Chat',
      'nav.directory': 'Directory',
      'nav.map': 'Map',
      'nav.saved': 'Saved',
      'nav.profile': 'Profile',
      'nav.sign_in': 'Sign in',
      'nav.sign_out': 'Sign out',
      'nav.get_involved': 'Get Involved',
      'nav.work_with_us': 'Work with us',
      'nav.submit_listing': 'Submit a Listing',
      'nav.register_organization': 'Register an Organization',
      'nav.become_community_admin': 'Become a Community Admin',
      'nav.become_oran_admin': 'Become an ORAN Admin',
      'nav.notifications': 'Notifications',
      'nav.invitations': 'Invitations',
      'nav.profile_menu_aria': 'Open profile menu',
      'nav.get_involved_menu_aria': 'Open get involved menu',
      'nav.explore': 'Explore',
      'nav.open_menu': 'Open navigation',
      'nav.close_menu': 'Close navigation',
      'nav.main_label': 'Main navigation',
    }[key] ?? key),
  }),
}));

async function loadAppNav() {
  return import('../AppNav');
}

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any, any>) => boolean,
): React.ReactElement<any, any>[] {
  const elements: React.ReactElement<any, any>[] = [];

  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!React.isValidElement(value)) {
      return;
    }

    const element = value as React.ReactElement<any, any>;
    if (predicate(element)) {
      elements.push(element);
    }
    visit(element.props.children);
  };

  visit(node);
  return elements;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  usePathnameMock.mockReturnValue('/saved');
  useStateMock.mockReturnValue([{ mobileOpen: false, openMenu: null }, vi.fn()]);
  useMemoMock.mockImplementation((factory: () => unknown) => factory());
  useSessionMock.mockReturnValue({ data: null, status: 'unauthenticated' });
});

describe('AppNav', () => {
  it('renders the desktop seeker navigation with the active destination highlighted', async () => {
    usePathnameMock.mockReturnValue('/directory');
    const { AppNav } = await loadAppNav();

    const element = AppNav() as React.ReactElement<any, any>;
    const links = collectElements(element, (child) => child.type === 'a');
    const activeLink = links.find((child) => child.props.href === '/directory');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const toggle = buttons[2];
    const routeLinks = links.filter((child) => ['/', '/chat', '/directory', '/map'].includes(child.props.href));

    expect(routeLinks.map((child) => child.props.href)).toEqual(['/', '/chat', '/chat', '/directory', '/map']);
    expect(activeLink?.props['aria-current']).toBe('page');
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(toggle.props['aria-label']).toBe('Open navigation');
  });

  it('renders the mobile drawer when open and closes it from the toggle or a link', async () => {
    const setMobileOpenMock = vi.fn();
    usePathnameMock.mockReturnValue('/map/nearby');
    useStateMock.mockReturnValue([{ mobileOpen: true, openMenu: null }, setMobileOpenMock]);
    const { AppNav } = await loadAppNav();

    const element = AppNav() as React.ReactElement<any, any>;
    const links = collectElements(element, (child) => child.type === 'a');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const toggle = buttons[2];
    const mobileNav = collectElements(element, (child) => child.props.id === 'mobile-nav')[0];
    const mobileMapLink = links
      .filter((child) => child.props.href === '/map')
      .find((child) => typeof child.props.onClick === 'function');
    const signInLink = links.find((child) => child.props.href === '/auth/signin?callbackUrl=%2Fmap%2Fnearby');

    expect(toggle.props['aria-expanded']).toBe(true);
    expect(toggle.props['aria-label']).toBe('Close navigation');
    expect(mobileNav.props.id).toBe('mobile-nav');
    expect(mobileMapLink?.props['aria-current']).toBe('page');
    expect(signInLink).toBeTruthy();

    toggle.props.onClick();
    expect(setMobileOpenMock).toHaveBeenCalledWith(expect.any(Function));

    mobileMapLink?.props.onClick();
    expect(setMobileOpenMock).toHaveBeenCalledWith(expect.any(Function));
  });
});
