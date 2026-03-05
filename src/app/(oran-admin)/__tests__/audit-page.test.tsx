// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="audit-skeleton">Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import AuditPage from '@/app/(oran-admin)/audit/page';

function makeAuditResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'audit-1',
        action: 'update',
        table_name: 'services',
        record_id: 'svc-1',
        user_id: 'admin-1',
        old_data: JSON.stringify({ name: 'Old Name' }),
        new_data: JSON.stringify({ name: 'New Name' }),
        ip_address: '127.0.0.1',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin audit page', () => {
  it('loads audit rows and expands JSON change details', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeAuditResponse(),
    });

    render(<AuditPage />);

    await screen.findByText('svc-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/audit?page=1&limit=25');

    fireEvent.click(screen.getByText('svc-1'));

    await screen.findByText('Previous Data');
    expect(screen.getByText('New Data')).toBeInTheDocument();
    expect(screen.getByText(/IP: 127.0.0.1/)).toBeInTheDocument();
    expect(document.body).toHaveTextContent('User: admin-1');
  });

  it('applies action/table filters and clears them', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse(),
      });

    render(<AuditPage />);
    await screen.findByText('svc-1');

    fireEvent.change(screen.getByLabelText('Action filter'), { target: { value: 'delete' } });
    fireEvent.change(screen.getByLabelText('Table filter'), { target: { value: 'services' } });

    await waitFor(() => {
      const lastCall = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(lastCall).toContain('/api/admin/audit?page=1&limit=25');
      expect(lastCall).toContain('action=delete');
      expect(lastCall).toContain('tableName=services');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/audit?page=1&limit=25');
    });
  });

  it('shows filtered empty state when no entries match', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeAuditResponse({ results: [], total: 0 }),
      });

    render(<AuditPage />);
    await screen.findByText('svc-1');

    fireEvent.change(screen.getByLabelText('Action filter'), { target: { value: 'login' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/audit?page=1&limit=25&action=login');
      expect(screen.getByText('No audit entries found')).toBeInTheDocument();
      expect(screen.getByText('No entries match the current filters.')).toBeInTheDocument();
    });
  });

  it('renders API load errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'audit backend unavailable' }),
    });

    render(<AuditPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('audit backend unavailable')).toBeInTheDocument();
  });
});
