// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="rules-skeleton">Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import RulesPage from '@/app/(oran-admin)/rules/page';

function makeRulesResponse(overrides: Record<string, unknown> = {}) {
  return {
    flags: [
      {
        name: 'community_verification_enabled',
        enabled: true,
        rolloutPct: 100,
      },
      {
        name: 'ingestion_auto_publish',
        enabled: false,
        rolloutPct: 25,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin rules page', () => {
  it('renders empty state when no flags are returned', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeRulesResponse({ flags: [] }),
    });

    render(<RulesPage />);

    await screen.findByText('No feature flags configured');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/rules');
  });

  it('edits a flag and saves changes with a refreshed list', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeRulesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Flag updated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeRulesResponse({
            flags: [
              {
                name: 'community_verification_enabled',
                enabled: false,
                rolloutPct: 65,
              },
            ],
          }),
      });

    render(<RulesPage />);
    await screen.findByText('community_verification_enabled');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle community_verification_enabled' }));
    fireEvent.change(screen.getByLabelText('Rollout percentage'), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'community_verification_enabled',
          enabled: false,
          rolloutPct: 65,
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/rules');
      expect(screen.getByRole('alert')).toHaveTextContent('Flag updated');
    });
  });

  it('shows load and save errors from API responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'rules service unavailable' }),
    });

    render(<RulesPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('rules service unavailable')).toBeInTheDocument();

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeRulesResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'flag update denied' }),
      });

    render(<RulesPage />);
    await screen.findByText('community_verification_enabled');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await screen.findByRole('alert');
    expect(screen.getByText('flag update denied')).toBeInTheDocument();
  });
});
