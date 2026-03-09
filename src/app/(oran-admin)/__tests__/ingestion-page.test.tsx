// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="ingestion-skeleton">Loading...</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import IngestionPage from '@/app/(oran-admin)/ingestion/page';

function makeSourcesResponse(overrides: Record<string, unknown> = {}) {
  return {
    sources: [
      {
        id: 'src-1',
        displayName: 'City Services Feed',
        trustLevel: 'allowlisted',
        domainRules: [{ type: 'domain', value: 'example.org' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeJobsResponse(overrides: Record<string, unknown> = {}) {
  return {
    jobs: [
      {
        id: 'job-1',
        correlationId: 'corr-1',
        jobType: 'crawl_seed',
        status: 'running',
        seedUrls: ['https://example.org/start'],
        urlsDiscovered: 10,
        urlsFetched: 5,
        candidatesExtracted: 2,
        errorsCount: 0,
        queuedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeCandidatesResponse(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        id: 'cand-1',
        sourceUrl: 'https://example.org/resource',
        reviewStatus: 'pending',
        confidenceTier: 'green',
        confidenceScore: 0.91,
        fields: {},
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

describe('oran admin ingestion page', () => {
  it('renders sources error state and recovers on retry', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse({ sources: [] }),
      });

    render(<IngestionPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Failed to fetch sources (500)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('No ingestion sources configured yet.')).toBeInTheDocument();
    });
  });

  it('loads sources tab and supports refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      });

    render(<IngestionPage />);

    await screen.findByText('City Services Feed');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/ingestion/sources');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/ingestion/sources');
    });
  });

  it('loads jobs tab and applies status filtering', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeJobsResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeJobsResponse({ jobs: [] }),
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');

    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    await screen.findByText('crawl seed');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/ingestion/jobs?limit=50');

    const jobsFilter = screen.getByRole('tablist', { name: 'Filter jobs by status' });
    fireEvent.click(within(jobsFilter).getByRole('tab', { name: 'failed' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/ingestion/jobs?limit=50&status=failed');
      expect(screen.getByText('No jobs found.')).toBeInTheDocument();
    });
  });

  it('cancels queued jobs and refreshes the list', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeJobsResponse({
            jobs: [
              {
                ...makeJobsResponse().jobs[0],
                id: 'job-queue-1',
                status: 'queued',
                errorsCount: 2,
                startedAt: '2026-01-01T00:00:00.000Z',
                completedAt: '2026-01-01T00:00:02.000Z',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeJobsResponse({ jobs: [] }),
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');
    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));

    await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.getByText('2.0s')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/ingestion/jobs/job-queue-1', {
        method: 'DELETE',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/ingestion/jobs?limit=50');
      expect(screen.getByText('No jobs found.')).toBeInTheDocument();
    });
  });

  it('loads candidates tab and applies status/tier filters with query params', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCandidatesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCandidatesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCandidatesResponse(),
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');

    fireEvent.click(screen.getByRole('tab', { name: 'Candidates' }));
    await screen.findByText('https://example.org/resource');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/ingestion/candidates?page=1&limit=20');

    fireEvent.click(screen.getByRole('tab', { name: 'verified' }));
    fireEvent.click(screen.getByRole('tab', { name: 'red' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/ingestion/candidates?page=1&limit=20&status=verified&tier=red');
    });
  });

  it('paginates candidates and renders score/tier fallbacks', async () => {
    const twentyCandidates = Array.from({ length: 20 }, (_, idx) => ({
      id: `cand-${idx + 1}`,
      sourceUrl: `https://example.org/resource-${idx + 1}`,
      reviewStatus: idx === 0 ? 'unknown_state' : 'pending',
      confidenceTier: idx === 0 ? undefined : 'green',
      confidenceScore: idx === 0 ? undefined : 0.75,
      fields: {},
    }));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCandidatesResponse({ candidates: twentyCandidates }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeCandidatesResponse({
            candidates: [
              {
                id: 'cand-next',
                sourceUrl: 'https://example.org/next-page',
                reviewStatus: 'verified',
                confidenceTier: 'green',
                confidenceScore: 0.92,
                fields: {},
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeCandidatesResponse({ candidates: twentyCandidates }),
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');
    fireEvent.click(screen.getByRole('tab', { name: 'Candidates' }));

    await screen.findByText('https://example.org/resource-1');
    expect(screen.getByText('—')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/ingestion/candidates?page=2&limit=20');
      expect(screen.getByText('Page 2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/ingestion/candidates?page=1&limit=20');
      expect(screen.getByText('Page 1')).toBeInTheDocument();
    });
  });

  it('runs process tab actions for single URL, batch, and feed poll', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: true, jobId: 'job-single-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'batch size exceeds limit' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ polled: 4, enqueued: 1 }),
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');
    fireEvent.click(screen.getByRole('tab', { name: 'Process' }));

    fireEvent.change(screen.getByLabelText('Source URL to process'), {
      target: { value: 'https://example.org/single' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/ingestion/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'https://example.org/single' }),
      });
      expect(screen.getByText('Operation completed')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('URLs to batch process'), {
      target: { value: 'https://example.org/a\nhttps://example.org/b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Batch' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/ingestion/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['https://example.org/a', 'https://example.org/b'] }),
      });
      expect(screen.getByRole('alert')).toHaveTextContent('batch size exceeds limit');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Poll Now' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/admin/ingestion/feeds/poll', { method: 'POST' });
      expect(screen.getByText('Operation completed')).toBeInTheDocument();
    });
  });

  it('shows process, batch, and feed-poll fallback errors', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSourcesResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('invalid json');
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => {
          throw new Error('invalid json');
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    render(<IngestionPage />);
    await screen.findByText('City Services Feed');
    fireEvent.click(screen.getByRole('tab', { name: 'Process' }));

    fireEvent.change(screen.getByLabelText('Source URL to process'), {
      target: { value: 'https://example.org/failing-single' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));
    await screen.findByText('Failed (503)');

    fireEvent.change(screen.getByLabelText('URLs to batch process'), {
      target: { value: 'https://example.org/failing-batch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Batch' }));
    await screen.findByText('Failed (504)');

    fireEvent.click(screen.getByRole('button', { name: 'Poll Now' }));
    await screen.findByText('Feed poll failed (500)');
  });
});
