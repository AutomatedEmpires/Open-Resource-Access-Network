import { describe, expect, it, vi } from 'vitest';

import {
  decidePublicationOverwrite,
  getCurrentPublicationAuthority,
  getPublicationSourceRank,
  inferPublicationSourceKind,
} from '@/services/publication/liveAuthority';

describe('liveAuthority', () => {
  it('orders publication sources by authority', () => {
    expect(getPublicationSourceRank('host_submission')).toBeGreaterThan(getPublicationSourceRank('canonical_feed'));
    expect(getPublicationSourceRank('canonical_feed')).toBeGreaterThan(getPublicationSourceRank('candidate_allowlisted'));
  });

  it('infers source kind from snapshot metadata', () => {
    expect(inferPublicationSourceKind({ meta: { publicationSourceKind: 'host_submission' } })).toBe('host_submission');
    expect(inferPublicationSourceKind({ meta: { generatedBy: 'oran-promote-to-live' } })).toBe('canonical_feed');
    expect(inferPublicationSourceKind({ meta: { generatedBy: 'oran-ingestion-publish' } })).toBe('candidate_allowlisted');
    expect(inferPublicationSourceKind({ meta: { generatedBy: 'oran-resource-submission-projection', channel: 'public' } })).toBe('community_review');
  });

  it('loads current publication authority from the current snapshot', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'canonical_feed' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    await expect(getCurrentPublicationAuthority(client as never, 'svc-1')).resolves.toEqual({
      sourceKind: 'canonical_feed',
      sourceRank: getPublicationSourceRank('canonical_feed'),
      generatedAt: '2026-03-16T00:00:00.000Z',
      payload: { meta: { publicationSourceKind: 'canonical_feed' } },
    });
  });

  it('suppresses weaker incoming publications when a stronger current authority exists', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'host_submission' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    const decision = await decidePublicationOverwrite(client as never, 'svc-1', 'candidate_allowlisted');
    expect(decision).toEqual({
      shouldOverwrite: false,
      current: {
        sourceKind: 'host_submission',
        sourceRank: getPublicationSourceRank('host_submission'),
        generatedAt: '2026-03-16T00:00:00.000Z',
        payload: { meta: { publicationSourceKind: 'host_submission' } },
      },
      reason: expect.stringContaining('incoming candidate_allowlisted rank'),
    });
  });

  it('allows stronger incoming publications to replace weaker current authority', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'candidate_allowlisted' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    const decision = await decidePublicationOverwrite(client as never, 'svc-1', 'canonical_feed');
    expect(decision.shouldOverwrite).toBe(true);
    expect(decision.current?.sourceKind).toBe('candidate_allowlisted');
  });

  it('loads current publication authority from the current snapshot', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'canonical_feed' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    await expect(getCurrentPublicationAuthority(client as never, 'svc-1')).resolves.toEqual({
      sourceKind: 'canonical_feed',
      sourceRank: getPublicationSourceRank('canonical_feed'),
      generatedAt: '2026-03-16T00:00:00.000Z',
      payload: { meta: { publicationSourceKind: 'canonical_feed' } },
    });
  });

  it('suppresses weaker incoming publications when a stronger current authority exists', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'host_submission' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    await expect(decidePublicationOverwrite(client as never, 'svc-1', 'candidate_allowlisted')).resolves.toEqual({
      shouldOverwrite: false,
      current: {
        sourceKind: 'host_submission',
        sourceRank: getPublicationSourceRank('host_submission'),
        generatedAt: '2026-03-16T00:00:00.000Z',
        payload: { meta: { publicationSourceKind: 'host_submission' } },
      },
      reason: expect.stringContaining('incoming candidate_allowlisted rank'),
    });
  });

  it('allows stronger incoming publications to replace weaker current authority', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          hsds_payload: { meta: { publicationSourceKind: 'candidate_allowlisted' } },
          generated_at: '2026-03-16T00:00:00.000Z',
        }],
      }),
    };

    const decision = await decidePublicationOverwrite(client as never, 'svc-1', 'canonical_feed');
    expect(decision.shouldOverwrite).toBe(true);
    expect(decision.current?.sourceKind).toBe('candidate_allowlisted');
  });
});
