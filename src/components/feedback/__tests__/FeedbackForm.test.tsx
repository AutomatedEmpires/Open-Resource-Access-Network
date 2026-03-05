// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

import { FeedbackForm } from '@/components/feedback/FeedbackForm';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('FeedbackForm', () => {
  it('renders with submit disabled until a rating is selected', () => {
    render(
      <FeedbackForm
        serviceId="svc-1"
        sessionId="session-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Rate this service info' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Feedback' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close feedback form' })).toBeInTheDocument();
  });

  it('submits successfully and shows the acknowledgement state', async () => {
    const onSubmit = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(
      <FeedbackForm
        serviceId="svc-1"
        sessionId="session-1"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.change(screen.getByLabelText('Additional comments'), {
      target: { value: 'Great and accurate listing.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }));

    await screen.findByText('Thank you for your feedback!');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: 'svc-1',
        sessionId: 'session-1',
        rating: 5,
        comment: 'Great and accurate listing.',
        contactSuccess: true,
      }),
    });
  });

  it('shows API errors and keeps submission available when a rating is set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Submission failed' }),
    });

    render(
      <FeedbackForm
        serviceId="svc-1"
        sessionId="session-1"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Submission failed');
      expect(screen.getByRole('button', { name: 'Submit Feedback' })).toBeEnabled();
    });
  });
});
