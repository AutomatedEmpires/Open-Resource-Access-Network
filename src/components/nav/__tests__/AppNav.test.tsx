import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePathnameMock = vi.hoisted(() => vi.fn());
const useStateMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
  };
});
vi.mock('next/link', () => ({
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
}));
vi.mock('lucide-react', () => ({
  MessageCircle: 'svg',
  List: 'svg',
  MapPin: 'svg',
  Bookmark: 'svg',
  Flag: 'svg',
  User: 'svg',
  Menu: 'svg',
  X: 'svg',
}));
vi.mock('../NotificationBell', () => ({
  NotificationBell: () => null,
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
  useStateMock.mockReturnValue([false, vi.fn()]);
});

describe('AppNav', () => {
  it('renders the desktop seeker navigation with the active destination highlighted', async () => {
    const { AppNav } = await loadAppNav();

    const element = AppNav() as React.ReactElement<any, any>;
    const links = collectElements(element, (child) => child.type === 'a');
    const activeLink = links.find((child) => child.props.href === '/saved');
    const toggle = collectElements(element, (child) => child.type === 'button')[0];

    expect(links).toHaveLength(9);
    expect(activeLink?.props['aria-current']).toBe('page');
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(toggle.props['aria-label']).toBe('Open navigation');
  });

  it('renders the mobile drawer when open and closes it from the toggle or a link', async () => {
    const setMobileOpenMock = vi.fn();
    usePathnameMock.mockReturnValue('/map/nearby');
    useStateMock.mockReturnValue([true, setMobileOpenMock]);
    const { AppNav } = await loadAppNav();

    const element = AppNav() as React.ReactElement<any, any>;
    const links = collectElements(element, (child) => child.type === 'a');
    const toggle = collectElements(element, (child) => child.type === 'button')[0];
    const mobileNav = collectElements(element, (child) => child.props.id === 'mobile-nav')[0];
    const mobileMapLink = links
      .filter((child) => child.props.href === '/map')
      .find((child) => typeof child.props.onClick === 'function');

    expect(toggle.props['aria-expanded']).toBe(true);
    expect(toggle.props['aria-label']).toBe('Close navigation');
    expect(mobileNav.props.id).toBe('mobile-nav');
    expect(mobileMapLink?.props['aria-current']).toBe('page');

    toggle.props.onClick();
    expect(setMobileOpenMock).toHaveBeenCalledWith(expect.any(Function));

    mobileMapLink?.props.onClick();
    expect(setMobileOpenMock).toHaveBeenCalledWith(false);
  });
});
