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
});
