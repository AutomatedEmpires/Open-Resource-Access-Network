import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleCandidateStore } from '../candidateStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      let result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        offset: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
          Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          then: (onFulfilled: ((value: void) => unknown) | null | undefined, onRejected?: ((reason: unknown) => unknown) | null | undefined) =>
            Promise.resolve().then(onFulfilled, onRejected),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    candidateId: 'cand-1',
    extractionId: 'ext-1',
    extractKeySha256: 'a'.repeat(64),
    extractedAt: new Date('2026-01-01T00:00:00.000Z'),
    organizationName: 'Helping Hands',
    serviceName: 'Food Pantry',
    description: 'Emergency grocery assistance',
    websiteUrl: 'https://example.gov/feed',
    phone: '555-0100',
    phones: [{ number: '555-0100', type: 'voice' }],
    addressLine1: '123 Main St',
    addressLine2: null,
    addressCity: 'Seattle',
    addressRegion: 'WA',
    addressPostalCode: '98101',
    addressCountry: 'US',
    isRemoteService: false,
    reviewStatus: 'pending',
    assignedToRole: 'community_admin',
    assignedToUserId: 'user-1',
    assignedAt: null,
    jurisdictionState: 'WA',
    jurisdictionCounty: 'King',
    jurisdictionCity: 'Seattle',
    jurisdictionKind: 'county',
    confidenceScore: 80,
    confidenceTier: 'green',
    scoreVerification: 70,
    scoreCompleteness: 75,
    scoreFreshness: 65,
    reviewBy: new Date('2026-01-02T00:00:00.000Z'),
    lastVerifiedAt: null,
    reverifyAt: new Date('2026-02-01T00:00:00.000Z'),
    verificationChecklist: { contact: true },
    investigationPack: { canonicalUrl: 'https://example.gov/feed' },
    primaryEvidenceId: 'ev-1',
    provenanceRecords: { field: { evidenceId: 'ev-1' } },
    publishedServiceId: null,
    publishedAt: null,
    publishedByUserId: null,
    jobId: null,
    correlationId: 'corr-1',
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    ...overrides,
  };
}

describe('candidateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates candidates and emits an audit event with the mapped DB fields', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleCandidateStore(db as never);

    await store.create({
      extractionId: 'ext-1',
      candidateId: 'cand-1',
      extractKeySha256: 'a'.repeat(64) as `${string}`,
      extractedAt: '2026-01-01T00:00:00.000Z',
      review: {
        status: 'pending',
        timers: {},
        tags: [],
        checklist: { contact: true } as never,
      },
      fields: {
        organizationName: 'Helping Hands',
        serviceName: 'Food Pantry',
        description: 'Emergency grocery assistance',
        websiteUrl: 'https://example.gov/feed',
        phone: '555-0100',
        phones: [{ number: '555-0100', type: 'voice' }],
        address: {
          line1: '123 Main St',
          city: 'Seattle',
          region: 'WA',
          postalCode: '98101',
          country: 'US',
        },
        isRemoteService: false,
      },
      investigation: { canonicalUrl: 'https://example.gov/feed', discoveredLinks: [], importantArtifacts: [] },
      provenance: { field: { evidenceId: 'ev-1' } },
      correlationId: 'corr-1',
      primaryEvidenceId: 'ev-1',
      jurisdictionState: 'WA',
      jurisdictionCounty: 'King',
      jurisdictionCity: 'Seattle',
      jurisdictionKind: 'county',
      jobId: 'job-1',
    } as never);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        extractionId: 'ext-1',
        organizationName: 'Helping Hands',
        serviceName: 'Food Pantry',
        addressLine1: '123 Main St',
        addressCity: 'Seattle',
        addressRegion: 'WA',
        addressPostalCode: '98101',
        jurisdictionState: 'WA',
        jurisdictionCounty: 'King',
        jurisdictionCity: 'Seattle',
        jurisdictionKind: 'county',
        primaryEvidenceId: 'ev-1',
        correlationId: 'corr-1',
        jobId: 'job-1',
      }),
    );
    expect(insertValues[1]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        eventType: 'created',
        actorType: 'system',
        details: { correlationId: 'corr-1' },
      }),
    );
  });

  it('maps rows back into the domain shape for id and extract key lookups', async () => {
    const { db } = createMockDb([[makeRow()], [makeRow({ candidateId: 'cand-2', jurisdictionKind: 'federal' })]]);
    const store = createDrizzleCandidateStore(db as never);

    await expect(store.getById('cand-1')).resolves.toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        review: expect.objectContaining({
          status: 'pending',
          jurisdiction: expect.objectContaining({
            kind: 'regional',
            stateProvince: 'WA',
          }),
        }),
        fields: expect.objectContaining({
          organizationName: 'Helping Hands',
          serviceName: 'Food Pantry',
          address: expect.objectContaining({
            line1: '123 Main St',
            city: 'Seattle',
          }),
        }),
      }),
    );
    await expect(store.getByExtractKey('a'.repeat(64))).resolves.toEqual(
      expect.objectContaining({
        candidateId: 'cand-2',
        review: expect.objectContaining({
          jurisdiction: expect.objectContaining({ kind: 'national' }),
        }),
      }),
    );
  });

  it('updates fields, review metadata, investigation, and provenance then audits the changed columns', async () => {
    const { db, insertValues, updateSets } = createMockDb();
    const store = createDrizzleCandidateStore(db as never);

    await store.update('cand-1', {
      fields: {
        organizationName: 'Updated Org',
        serviceName: 'Updated Service',
        description: 'Updated description',
        websiteUrl: 'https://updated.gov',
        phone: '555-0200',
        phones: [{ number: '555-0200' }],
        address: {
          line1: '456 Oak St',
          line2: 'Suite 2',
          city: 'Tacoma',
          region: 'WA',
          postalCode: '98402',
          country: 'US',
        },
        isRemoteService: true,
      },
      review: {
        status: 'verified',
        assignedToRole: 'oran_admin',
        assignedToKey: 'user-9',
        checklist: { contact: true } as never,
        timers: {
          reviewBy: '2026-01-03T00:00:00.000Z',
          lastVerifiedAt: '2026-01-04T00:00:00.000Z',
          reverifyAt: '2026-02-04T00:00:00.000Z',
        },
        jurisdiction: {
          country: 'US',
          stateProvince: 'WA',
          countyOrRegion: 'Pierce',
          city: 'Tacoma',
          kind: 'statewide',
        },
      },
      investigation: { canonicalUrl: 'https://updated.gov', discoveredLinks: [], importantArtifacts: [] },
      provenance: { field: { evidenceId: 'ev-2' } },
    } as never);

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        organizationName: 'Updated Org',
        serviceName: 'Updated Service',
        description: 'Updated description',
        websiteUrl: 'https://updated.gov',
        phone: '555-0200',
        addressLine1: '456 Oak St',
        addressLine2: 'Suite 2',
        addressCity: 'Tacoma',
        isRemoteService: true,
        reviewStatus: 'verified',
        assignedToRole: 'oran_admin',
        assignedToUserId: 'user-9',
        jurisdictionKind: 'state',
        investigationPack: { canonicalUrl: 'https://updated.gov', discoveredLinks: [], importantArtifacts: [] },
        provenanceRecords: { field: { evidenceId: 'ev-2' } },
      }),
    );
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        eventType: 'field_edited',
        actorType: 'system',
      }),
    );
    expect((insertValues[0] as { details: { updatedFields: string[] } }).details.updatedFields).toEqual(
      expect.arrayContaining(['organizationName', 'jurisdictionKind', 'investigationPack', 'provenanceRecords']),
    );
  });

  it('updates review status, confidence score, assignment, and publication with the correct audit events', async () => {
    const { db, insertValues, updateSets } = createMockDb();
    const store = createDrizzleCandidateStore(db as never);

    await store.updateReviewStatus('cand-1', 'rejected', 'admin-1');
    await store.updateConfidenceScore('cand-1', 82.4);
    await store.assign('cand-1', 'community_admin', 'user-2');
    await store.markPublished('cand-1', 'svc-77', 'admin-9');

    expect(updateSets[0]).toEqual({ reviewStatus: 'rejected' });
    expect(updateSets[1]).toEqual({ confidenceScore: 82 });
    expect(updateSets[2]).toEqual(
      expect.objectContaining({
        assignedToRole: 'community_admin',
        assignedToUserId: 'user-2',
        assignedAt: expect.any(Date),
        reviewStatus: 'in_review',
      }),
    );
    expect(updateSets[3]).toEqual(
      expect.objectContaining({
        reviewStatus: 'published',
        publishedServiceId: 'svc-77',
        publishedAt: expect.any(Date),
        publishedByUserId: 'admin-9',
      }),
    );
    expect(insertValues).toEqual([
      expect.objectContaining({ eventType: 'status_changed', actorType: 'admin', actorId: 'admin-1' }),
      expect.objectContaining({ eventType: 'score_updated', details: { newScore: 82.4 } }),
      expect.objectContaining({ eventType: 'assigned', details: { role: 'community_admin', userId: 'user-2' } }),
      expect.objectContaining({ eventType: 'published', actorType: 'admin', actorId: 'admin-9', details: { serviceId: 'svc-77' } }),
    ]);
  });

  it('lists filtered candidates and due review queues from mapped rows', async () => {
    const { db } = createMockDb([
      [makeRow(), makeRow({ candidateId: 'cand-2', reviewStatus: 'published' })],
      [makeRow({ candidateId: 'cand-3', reviewStatus: 'pending' })],
      [makeRow({ candidateId: 'cand-4', reviewStatus: 'published' })],
    ]);
    const store = createDrizzleCandidateStore(db as never);

    const listed = await store.list(
      {
        reviewStatus: 'pending',
        confidenceTier: 'green',
        jurisdictionState: 'WA',
        assignedToUserId: 'user-1',
      },
      10,
      5,
    );
    const dueReview = await store.listDueForReview(5);
    const dueReverify = await store.listDueForReverify(5);

    expect(listed).toHaveLength(2);
    expect(dueReview).toEqual([expect.objectContaining({ candidateId: 'cand-3' })]);
    expect(dueReverify).toEqual([expect.objectContaining({ candidateId: 'cand-4' })]);
  });
});
