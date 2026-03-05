// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { ReportProblemDialog } from '@/components/feedback/ReportProblemDialog';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReportProblemDialog', () => {
  it('starts with submit disabled and enables submit after selecting an issue type', () => {
    render(
      <ReportProblemDialog
        serviceId="11111111-1111-4111-8111-111111111111"
        serviceName="Community Kitchen"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Community Kitchen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Wrong information' }));

    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeEnabled();
  });

  it('submits a report and shows the success state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ created: true }),
    });

    render(
      <ReportProblemDialog
        serviceId="11111111-1111-4111-8111-111111111111"
        serviceName="Shelter One"
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Wrong hours' }));
    fireEvent.change(screen.getByLabelText('Additional details'), {
      target: { value: '  closes at 5pm now  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => {
      expect(screen.getByText('Thank you for your report!')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/submissions/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'wrong_hours',
        details: 'closes at 5pm now',
      }),
    });
  });

  it('shows API errors and supports dismissing the alert', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Unable to submit report' }),
    });

    render(
      <ReportProblemDialog
        serviceId="11111111-1111-4111-8111-111111111111"
        serviceName="Shelter Two"
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Other issue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to submit report');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('calls onOpenChange(false) and resets form state after close timeout', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();

    render(
      <ReportProblemDialog
        serviceId="11111111-1111-4111-8111-111111111111"
        serviceName="Shelter Three"
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Wrong phone number' }));
    fireEvent.change(screen.getByLabelText('Additional details'), {
      target: { value: 'Test comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByLabelText('Additional details')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeDisabled();
  });
});
