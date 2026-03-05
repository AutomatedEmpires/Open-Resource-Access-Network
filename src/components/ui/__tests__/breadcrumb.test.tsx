// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Breadcrumb } from '../breadcrumb';

// Mock next/link to render as plain anchor
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('Breadcrumb', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders a single item as current page', () => {
    render(<Breadcrumb items={[{ label: 'Home' }]} />);
    const el = screen.getByText('Home');
    expect(el).toHaveAttribute('aria-current', 'page');
  });

  it('renders links for non-last items with hrefs', () => {
    render(
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Admin', href: '/admin' },
        { label: 'Queue' },
      ]} />,
    );

    const homeLink = screen.getByText('Home');
    expect(homeLink.tagName).toBe('A');
    expect(homeLink).toHaveAttribute('href', '/');

    const adminLink = screen.getByText('Admin');
    expect(adminLink.tagName).toBe('A');
    expect(adminLink).toHaveAttribute('href', '/admin');

    const queue = screen.getByText('Queue');
    expect(queue.tagName).toBe('SPAN');
    expect(queue).toHaveAttribute('aria-current', 'page');
  });

  it('renders separators between items', () => {
    render(
      <Breadcrumb items={[
        { label: 'A', href: '/' },
        { label: 'B', href: '/b' },
        { label: 'C' },
      ]} />,
    );

    const separators = screen.getAllByText('/');
    expect(separators).toHaveLength(2);
    separators.forEach(sep => {
      expect(sep).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('has accessible nav landmark', () => {
    render(
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Current' },
      ]} />,
    );
    const nav = screen.getByLabelText('Breadcrumb');
    expect(nav.tagName).toBe('NAV');
  });

  it('renders last item without link even if href is provided', () => {
    render(
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Current', href: '/current' },
      ]} />,
    );

    const current = screen.getByText('Current');
    expect(current.tagName).toBe('SPAN');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});
