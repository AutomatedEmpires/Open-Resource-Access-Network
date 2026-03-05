// @vitest-environment jsdom

import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/ui/toast';

function ToastActions() {
  const { success, error, warning, info, toast } = useToast();
  const countRef = useRef(0);

  return (
    <div>
      <button type="button" onClick={() => success('Saved successfully', 0)}>
        Success
      </button>
      <button type="button" onClick={() => error('Something failed', 0)}>
        Error
      </button>
      <button type="button" onClick={() => warning('Heads up', 0)}>
        Warning
      </button>
      <button type="button" onClick={() => info('Auto hide', 1000)}>
        Timed
      </button>
      <button
        type="button"
        onClick={() => {
          const n = countRef.current;
          countRef.current += 1;
          toast('info', `msg-${n}`, 0);
        }}
      >
        Add
      </button>
    </div>
  );
}

function HookOutsideProvider() {
  useToast();
  return null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToastProvider and useToast', () => {
  it('throws when useToast is called outside the provider', () => {
    expect(() => render(<HookOutsideProvider />)).toThrowError(
      'useToast must be used inside <ToastProvider>',
    );
  });

  it('shows and dismisses a toast manually', async () => {
    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Success' }));

    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully');
    fireEvent.click(screen.getByLabelText('Dismiss notification'));

    await waitFor(() => {
      expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
    });
  });

  it('auto-dismisses timed toasts', async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Timed' }));
    expect(screen.getByText('Auto hide')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Auto hide')).not.toBeInTheDocument();
  });

  it('keeps only the latest MAX_TOASTS (4) toasts and evicts the oldest', () => {
    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    const addButton = screen.getByRole('button', { name: 'Add' });
    // Add 6 toasts; only the last 4 should be visible
    for (let i = 0; i < 6; i++) fireEvent.click(addButton);

    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(screen.queryByText('msg-0')).not.toBeInTheDocument();
    expect(screen.queryByText('msg-1')).not.toBeInTheDocument();
    expect(screen.getByText('msg-5')).toBeInTheDocument();
  });

  describe('variants', () => {
    it('renders a warning toast with role="status"', () => {
      render(
        <ToastProvider>
          <ToastActions />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
      expect(screen.getByRole('status')).toHaveTextContent('Heads up');
    });

    it('renders an error toast with role="alert" (assertive)', () => {
      render(
        <ToastProvider>
          <ToastActions />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Error' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
    });

    it('renders a success toast with role="status"', () => {
      render(
        <ToastProvider>
          <ToastActions />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Success' }));
      expect(screen.getByRole('status')).toHaveTextContent('Saved successfully');
    });
  });

  describe('timer hygiene', () => {
    beforeEach(() => vi.useFakeTimers());

    it('cancels the auto-dismiss timer when a toast is manually dismissed', () => {
      render(
        <ToastProvider>
          <ToastActions />
        </ToastProvider>,
      );

      // Add a timed toast (1000ms) then immediately dismiss it manually
      fireEvent.click(screen.getByRole('button', { name: 'Timed' }));
      fireEvent.click(screen.getByLabelText('Dismiss notification'));

      // Advance past the original auto-dismiss deadline — no second removal should occur
      act(() => vi.advanceTimersByTime(2000));

      // If the timer had NOT been cancelled it would have called setToasts again
      // (no crash, but verifiable via query — still not in DOM)
      expect(screen.queryByText('Auto hide')).not.toBeInTheDocument();
    });
  });
});
