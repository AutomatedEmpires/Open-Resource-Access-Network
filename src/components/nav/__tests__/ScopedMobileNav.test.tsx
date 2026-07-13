// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';

vi.mock('next/link', () => ({ default: 'a' }));

const Icon = () => <svg aria-hidden="true" />;

afterEach(() => cleanup());

describe('ScopedMobileNav', () => {
  it('renders a safe-area mobile nav with an active route and optional badge', () => {
    render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/saved/collection"
        items={[
          { href: '/chat', label: 'Chat', icon: Icon },
          { href: '/directory', label: 'Directory', icon: Icon },
          { href: '/map', label: 'Map', icon: Icon },
          { href: '/saved', label: 'Saved', icon: Icon, badge: 3 },
        ]}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Seeker mobile navigation' });
    const saved = screen.getByRole('link', { name: /Saved/i });

    expect(nav).toHaveStyle({ paddingBottom: 'env(safe-area-inset-bottom)' });
    expect(saved).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('3 saved')).toBeInTheDocument();
  });

  it('matches the root item only on the exact landing route', () => {
    const { rerender } = render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/"
        items={[{ href: '/', label: 'Start', icon: Icon }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('aria-current', 'page');

    rerender(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/chat"
        items={[{ href: '/', label: 'Start', icon: Icon }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Start' })).not.toHaveAttribute('aria-current');
  });

  it('renders serializable icon keys for server-component callers', () => {
    render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/chat"
        items={[
          { href: '/', label: 'Start', icon: 'home' },
          { href: '/chat', label: 'Chat', icon: 'chat' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  });

  it('exports the seeker tabs in the product-defined order', () => {
    expect(SEEKER_MOBILE_NAV_ITEMS.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: 'Chat', href: '/chat' },
      { label: 'Map', href: '/map' },
      { label: 'Scroll', href: '/scroll' },
      { label: 'Profile', href: '/profile' },
    ]);
  });
});
