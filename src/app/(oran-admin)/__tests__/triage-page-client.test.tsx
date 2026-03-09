// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import TriagePageClient from '@/app/(oran-admin)/triage/TriagePageClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe('TriagePageClient', () => {
  it('loads summary + queue rows and supports item rescore', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/admin/triage/summary') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: [
              {
                queue_type: 'pending_verification',
                label: 'Pending Verification',
                total: 1,
                high_priority: 1,
                critical: 0,
                avg_priority: 72,
              },
            ],
          }),
        } as Response;
      }

      if (url.startsWith('/api/admin/triage?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            queue_type: 'pending_verification',
            total: 1,
            entries: [
              {
                submission_id: 'sub-1',
                submission_type: 'service_verification',
                status: 'needs_review',
                title: 'Shelter quality review',
                service_id: 'svc-1',
                service_name: 'Shelter One',
                created_at: '2026-03-01T00:00:00.000Z',
                sla_deadline: null,
                sla_breached: false,
                triage_priority: 88,
                triage_explanations: ['High traffic', 'Recent complaints', 'Low confidence', 'Stale data'],
                scored_at: '2026-03-02T00:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }

      if (url === '/api/admin/triage/sub-1' && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }

      return { ok: false, status: 500, json: async () => ({ error: 'unexpected' }) } as Response;
    });

    render(<TriagePageClient />);

    await screen.findByText('Triage Queue');
    await screen.findByRole('table', { name: /Pending Verification triage queue/i });
    expect(screen.getByText('Shelter quality review')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Re-score submission sub-1/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/triage/sub-1', { method: 'POST' });
      expect(toastMock).toHaveBeenCalledWith('success', 'Score refreshed.');
    });
  });

  it('shows queue error state and rescore-all failure toast', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/admin/triage/summary') {
        return { ok: true, status: 200, json: async () => ({ summary: [] }) } as Response;
      }

      if (url.startsWith('/api/admin/triage?')) {
        return { ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response;
      }

      if (url === '/api/admin/triage' && method === 'POST') {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response;
      }

      return { ok: false, status: 500, json: async () => ({ error: 'unexpected' }) } as Response;
    });

    render(<TriagePageClient />);

    await screen.findByText('HTTP 503');
    fireEvent.click(screen.getByRole('button', { name: 'Re-score all pending submissions' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/triage', { method: 'POST' });
      expect(toastMock).toHaveBeenCalledWith('error', 'Failed to run triage scoring.');
    });
  });
});

