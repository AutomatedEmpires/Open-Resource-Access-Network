// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CrisisProvider } from '@/components/crisis/CrisisContext';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';

const useLocaleMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: useLocaleMock }));

const Icon = () => <svg aria-hidden="true" />;

beforeEach(() => {
  useLocaleMock.mockImplementation(() => {
    throw new Error('Locale provider is not mounted.');
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    expect(screen.getByRole('button', { name: 'Open crisis resources and emergency hotlines' })).toBeInTheDocument();
    expect(nav).not.toHaveAttribute('data-seeker-discovery-nav');
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
      { label: 'Home', href: '/' },
      { label: 'Find help', href: '/chat' },
      { label: 'Browse', href: '/directory' },
      { label: 'Saved', href: '/saved' },
    ]);
  });

  it('marks the seeker navigation from its destinations and uses safe English fallbacks', () => {
    render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/chat"
        items={SEEKER_MOBILE_NAV_ITEMS.map((item) => ({ ...item, label: 'Unlocalized' }))}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Seeker mobile navigation' });
    expect(nav).toHaveAttribute('data-seeker-discovery-nav');
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Find help' })).toHaveAttribute('href', '/chat');
    expect(within(nav).getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/directory');
    expect(within(nav).getByRole('link', { name: 'Saved' })).toHaveAttribute('href', '/saved');
  });

  it('marks Browse as the current mobile destination on the map surface', () => {
    render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/map"
        items={SEEKER_MOBILE_NAV_ITEMS}
      />,
    );

    expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('data-active');
    expect(screen.getByRole('link', { name: 'Browse' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Find help' })).not.toHaveAttribute('aria-current');
  });

  it('localizes seeker labels and crisis access when locale context is available', () => {
    const translations: Record<string, string> = {
      'nav.home': 'Accueil',
      'nav.chat': 'Trouver de l’aide',
      'nav.browse': 'Parcourir',
      'nav.saved': 'Enregistrés',
      'nav.crisis': 'Crise',
      'footer.crisis_resources_aria': "Ouvrir les ressources de crise et les lignes d'assistance",
    };
    useLocaleMock.mockReturnValue({ t: (key: string) => translations[key] ?? key });

    render(
      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname="/"
        items={SEEKER_MOBILE_NAV_ITEMS}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Seeker mobile navigation' });
    expect(within(nav).getByRole('link', { name: 'Accueil' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Trouver de l’aide' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Parcourir' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Enregistrés' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', {
      name: "Ouvrir les ressources de crise et les lignes d'assistance",
    })).toHaveTextContent('Crise');
  });

  it('opens the shared crisis dialog with the verified 911, 988, and 211 actions', () => {
    render(
      <CrisisProvider>
        <ScopedMobileNav
          scopeLabel="Seeker"
          pathname="/"
          items={SEEKER_MOBILE_NAV_ITEMS}
        />
      </CrisisProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open crisis resources and emergency hotlines' }));

    const dialog = screen.getByRole('dialog', { name: 'Crisis Resources' });
    expect(within(dialog).getByRole('link', { name: /Call Emergency Services: 911/i })).toHaveAttribute('href', 'tel:911');
    expect(within(dialog).getByRole('link', { name: /Call 988 Suicide & Crisis Lifeline: 988/i })).toHaveAttribute('href', 'tel:988');
    expect(within(dialog).getByRole('link', { name: /Call 211 Community Helpline: 211/i })).toHaveAttribute('href', 'tel:211');
  });
});
