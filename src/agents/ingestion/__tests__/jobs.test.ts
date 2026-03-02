import { describe, expect, test } from 'vitest';

import {
  createIngestionJob,
  IngestionJobSchema,
  IngestionJobStatusSchema,
  IngestionJobTypeSchema,
  transitionJobStatus,
} from '../jobs';

describe('ingestion jobs', () => {
  describe('schemas', () => {
    test('job type enum has expected values', () => {
      const types = IngestionJobTypeSchema.options;
      expect(types).toContain('seed_crawl');
      expect(types).toContain('scheduled_reverify');
      expect(types).toContain('manual_submission');
      expect(types).toContain('rss_feed');
      expect(types).toContain('sitemap_discovery');
      expect(types).toContain('registry_change');
    });

    test('job status enum has expected values', () => {
      const statuses = IngestionJobStatusSchema.options;
      expect(statuses).toContain('queued');
      expect(statuses).toContain('running');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
      expect(statuses).toContain('cancelled');
    });
  });

  describe('createIngestionJob', () => {
    test('creates a job with correlation ID', () => {
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: ['https://example.gov/services'],
      });

      expect(job.id).toBeDefined();
      expect(job.correlationId).toMatch(/^job-/);
      expect(job.status).toBe('queued');
      expect(job.jobType).toBe('seed_crawl');
      expect(job.seedUrls).toHaveLength(1);
      expect(job.urlsDiscovered).toBe(0);
      expect(job.urlsFetched).toBe(0);
      expect(job.candidatesExtracted).toBe(0);
      expect(job.agentId).toBe('oran-ingestion-agent/1.0');
    });

    test('accepts custom agent ID', () => {
      const job = createIngestionJob({
        jobType: 'rss_feed',
        seedUrls: ['https://example.edu/feed.xml'],
        agentId: 'custom-agent/2.0',
      });

      expect(job.agentId).toBe('custom-agent/2.0');
    });

    test('accepts source registry ID', () => {
      const registryId = crypto.randomUUID();
      const job = createIngestionJob({
        jobType: 'sitemap_discovery',
        seedUrls: ['https://example.gov/sitemap.xml'],
        sourceRegistryId: registryId,
      });

      expect(job.sourceRegistryId).toBe(registryId);
    });
  });

  describe('transitionJobStatus', () => {
    test('queued → running sets startedAt', () => {
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: ['https://example.gov/a'],
      });

      expect(job.startedAt).toBeUndefined();

      const running = transitionJobStatus(job, 'running', '2026-03-02T10:00:00Z');

      expect(running.status).toBe('running');
      expect(running.startedAt).toBe('2026-03-02T10:00:00Z');
      expect(running.completedAt).toBeUndefined();
    });

    test('running → completed sets completedAt', () => {
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: ['https://example.gov/a'],
      });
      const running = transitionJobStatus(job, 'running', '2026-03-02T10:00:00Z');
      const completed = transitionJobStatus(running, 'completed', '2026-03-02T10:30:00Z');

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBe('2026-03-02T10:30:00Z');
    });

    test('running → failed sets completedAt and error', () => {
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: ['https://example.gov/a'],
      });
      const running = transitionJobStatus(job, 'running');
      const failed = transitionJobStatus(running, 'failed', '2026-03-02T10:30:00Z', {
        message: 'Network timeout',
        details: { url: 'https://example.gov/a', attempt: 3 },
      });

      expect(failed.status).toBe('failed');
      expect(failed.completedAt).toBeDefined();
      expect(failed.errorMessage).toBe('Network timeout');
      expect(failed.errorDetails).toEqual({ url: 'https://example.gov/a', attempt: 3 });
    });

    test('cancelled sets completedAt', () => {
      const job = createIngestionJob({
        jobType: 'seed_crawl',
        seedUrls: ['https://example.gov/a'],
      });
      const cancelled = transitionJobStatus(job, 'cancelled');

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completedAt).toBeDefined();
    });
  });

  describe('IngestionJobSchema validation', () => {
    test('validates a complete job', () => {
      const job = {
        id: crypto.randomUUID(),
        correlationId: 'job-abc123',
        jobType: 'seed_crawl',
        status: 'running',
        seedUrls: ['https://example.gov/a', 'https://example.gov/b'],
        urlsDiscovered: 10,
        urlsFetched: 5,
        candidatesExtracted: 3,
        candidatesVerified: 1,
        errorsCount: 2,
        queuedAt: '2026-03-02T09:00:00Z',
        startedAt: '2026-03-02T09:01:00Z',
        agentId: 'test-agent/1.0',
      };

      const parsed = IngestionJobSchema.parse(job);
      expect(parsed.urlsDiscovered).toBe(10);
    });

    test('rejects invalid job type', () => {
      const job = {
        id: crypto.randomUUID(),
        correlationId: 'job-abc123',
        jobType: 'invalid_type',
        status: 'queued',
        seedUrls: [],
        queuedAt: '2026-03-02T09:00:00Z',
      };

      expect(() => IngestionJobSchema.parse(job)).toThrow();
    });

    test('rejects negative stats', () => {
      const job = {
        id: crypto.randomUUID(),
        correlationId: 'job-abc123',
        jobType: 'seed_crawl',
        status: 'queued',
        seedUrls: [],
        urlsDiscovered: -1,
        queuedAt: '2026-03-02T09:00:00Z',
      };

      expect(() => IngestionJobSchema.parse(job)).toThrow();
    });
  });
});

