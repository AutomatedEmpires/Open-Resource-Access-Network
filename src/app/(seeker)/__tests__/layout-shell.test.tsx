// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

import SeekerLayout from '@/app/(seeker)/layout';

beforeEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  usePathnameMock.mockReturnValue('/chat');
});

describe('seeker layout shell', () => {
  it('toggles command palette with Ctrl/Cmd+K and closes through palette callback', () => {
    render(<SeekerLayout>Child</SeekerLayout>);

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

    const { unmount } = render(<SeekerLayout>Child</SeekerLayout>);
    await waitFor(() => {
      expect(screen.getAllByText('99+').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('99+').length).toBeGreaterThan(0);
    unmount();

    localStorage.setItem('oran:saved-service-ids', '{bad-json');
    render(<SeekerLayout>Child</SeekerLayout>);
    await waitFor(() => {
      expect(screen.queryByText('99+')).toBeNull();
    });
  });
});
