// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenChange?.(false)}>close-dialog</button>
      {children}
    </div>
  ),
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Overlay: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Content: ({
    children,
    onOpenAutoFocus,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { onOpenAutoFocus?: (event: { preventDefault: () => void }) => void }) => {
    React.useEffect(() => {
      onOpenAutoFocus?.({ preventDefault: () => {} });
    }, [onOpenAutoFocus]);
    return <div {...props}>{children}</div>;
  },
  Title: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}));

import { CommandPalette } from '@/components/command/CommandPalette';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommandPalette', () => {
  it('filters commands by query and shows no-results copy', () => {
    render(<CommandPalette open onClose={vi.fn()} />);

    expect(screen.getAllByRole('option')).toHaveLength(5);

    const input = screen.getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(input, { target: { value: 'nearby' } });
    expect(screen.getByRole('option', { name: /Go to Map/i })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.change(input, { target: { value: 'nothing-matches' } });
    expect(screen.getByText(/No commands found for/i)).toBeInTheDocument();
  });

  it('supports keyboard navigation and Enter executes the active command', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);

    const palette = screen.getByLabelText('Command palette');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(palette, { key: 'ArrowDown' });
    const afterDown = screen.getAllByRole('option');
    expect(afterDown[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(palette, { key: 'Enter' });
    expect(pushMock).toHaveBeenCalledWith('/directory');
    expect(onClose).toHaveBeenCalled();
  });

  it('supports mouse hover/click selection and close callback from dialog state', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);

    const savedOption = screen.getByRole('option', { name: /Go to Saved/i });
    fireEvent.mouseEnter(savedOption);
    expect(savedOption).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(savedOption);
    expect(pushMock).toHaveBeenCalledWith('/saved');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'close-dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
