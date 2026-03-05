// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import ClaimPage from '@/app/(host)/claim/page';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('host claim page', () => {
  it('renders step 1 and only enables continue once org name is provided', () => {
    render(<ClaimPage />);

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(screen.getByRole('heading', { name: 'Claim an Organization' })).toBeInTheDocument();
    expect(continueBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Organization Name/i), {
      target: { value: 'Helping Hands' },
    });

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('submits successfully and transitions to the success state actions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        organizationId: 'org-1',
        serviceId: 'svc-1',
        message: 'Claim queued for review.',
      }),
    });

    render(<ClaimPage />);

    fireEvent.change(screen.getByLabelText(/Organization Name/i), {
      target: { value: 'Helping Hands' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'Community nonprofit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByLabelText(/Website/i), {
      target: { value: 'https://helpinghands.example.org' },
    });
    fireEvent.change(screen.getByLabelText(/Contact Email/i), {
      target: { value: 'contact@helpinghands.example.org' },
    });
    fireEvent.change(screen.getByLabelText(/Notes for Reviewer/i), {
      target: { value: 'I am the operations manager.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    fireEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

    await screen.findByText('Claim Submitted!');
    expect(fetchMock).toHaveBeenCalledWith('/api/host/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: 'Helping Hands',
        description: 'Community nonprofit',
        url: 'https://helpinghands.example.org',
        email: 'contact@helpinghands.example.org',
        claimNotes: 'I am the operations manager.',
      }),
    });
    expect(screen.getByText('Claim queued for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/org');

    fireEvent.click(screen.getByRole('button', { name: 'Submit Another Claim' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Claim an Organization' })).toBeInTheDocument();
      expect(screen.getByLabelText(/Organization Name/i)).toHaveValue('');
    });
  });

  it('shows submission errors from API failures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Authentication required to submit claims' }),
    });

    render(<ClaimPage />);

    fireEvent.change(screen.getByLabelText(/Organization Name/i), {
      target: { value: 'Helping Hands' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Authentication required to submit claims')).toBeInTheDocument();
  });
});
