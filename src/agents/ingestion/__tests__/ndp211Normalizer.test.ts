import { describe, expect, it, vi } from 'vitest';

import { normalize211SourceRecord } from '../ndp211Normalizer';
import type { SourceRecordRow } from '@/db/schema';

// ── Helpers ───────────────────────────────────────────────────

function buildSourceRecord(overrides: Partial<SourceRecordRow> = {}): SourceRecordRow {
  return {
    id: 'sr-norm-001',
    sourceFeedId: 'feed-211',
    sourceRecordType: 'service',
    sourceRecordId: 'svc-211-001',
    fetchedAt: new Date(),
    payloadSha256: 'abc123',
    rawPayload: {},
    parsedPayload: {},
    sourceConfidenceSignals: { trustTier: 'trusted_partner' },
    processingStatus: 'pending',
    correlationId: 'test-corr',
    sourceLicense: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SourceRecordRow;
}

function createMockNormalizerStores() {
  const tagCalls: Array<Record<string, unknown>> = [];
  return {
    stores: {
      sourceRecords: {
        findByDedup: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((row) => ({ id: `sr-gen-${Math.random().toString(36).slice(2, 6)}`, ...row })),
        addTaxonomy: vi.fn().mockResolvedValue(undefined),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      },
      sourceFeeds: {
        getById: vi.fn().mockResolvedValue({ id: 'feed-211', sourceSystemId: 'source-system-211' }),
        updateAfterPoll: vi.fn().mockResolvedValue(undefined),
      },
      canonicalOrganizations: {
        create: vi.fn().mockImplementation((row) => ({ id: `org-${Math.random().toString(36).slice(2, 6)}`, ...row })),
      },
      canonicalServices: {
        create: vi.fn().mockImplementation((row) => ({ id: `svc-${Math.random().toString(36).slice(2, 6)}`, ...row })),
      },
      canonicalLocations: {
        create: vi.fn().mockImplementation((row) => ({ id: `loc-${Math.random().toString(36).slice(2, 6)}`, ...row })),
      },
      canonicalServiceLocations: {
        bulkCreate: vi.fn().mockResolvedValue(undefined),
      },
      canonicalProvenance: {
        bulkCreate: vi.fn().mockResolvedValue(undefined),
      },
      tags: {
        add: vi.fn().mockImplementation((tag) => { tagCalls.push(tag); }),
      },
      taxonomyCrosswalks: {
        findBySourceCode: vi.fn().mockResolvedValue([]),
      },
      canonicalConcepts: {
        getById: vi.fn().mockResolvedValue(null),
      },
      conceptTagDerivations: {
        bulkCreate: vi.fn().mockResolvedValue(undefined),
      },
    },
    tagCalls,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('normalize211SourceRecord', () => {
  describe('child service records (type: service)', () => {
    it('derives eligibility tags from _211_eligibility', async () => {
      const { stores, tagCalls } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Veterans Outreach',
          description: 'Services for veterans',
          _211_eligibility: {
            description: 'Veterans only',
            types: ['veteran', 'disability'],
          },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
        trustTier: 'trusted_partner',
      });

      expect(result.enrichments.eligibilityTags).toContain('population:veterans');
      expect(result.enrichments.eligibilityTags).toContain('situation:disability');

      const audienceTags = tagCalls.filter(
        t => t.tagType === 'audience',
      );
      expect(audienceTags).toHaveLength(2);
      const tagValues = audienceTags.map(t => t.tagValue);
      expect(tagValues).toContain('veterans');
      expect(tagValues).toContain('disability');
    });

    it('derives cost tags from _211_fees_detail', async () => {
      const { stores, tagCalls } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Free Food Pantry',
          _211_fees_detail: { type: 'no_fee', description: 'Free to all' },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.costTags).toEqual(['free']);
      const costTags = tagCalls.filter(
        t => (t.tagValue as string)?.startsWith('cost:'),
      );
      expect(costTags).toHaveLength(1);
      expect(costTags[0].tagValue).toBe('cost:free');
    });

    it('derives language tags from _211_languages', async () => {
      const { stores, tagCalls } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Multi-lingual Clinic',
          _211_languages: { description: 'Spanish and Vietnamese', codes: ['english', 'spanish', 'vietnamese'] },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      // 'english' should be excluded
      expect(result.enrichments.languageTags).toEqual(['language_spanish', 'language_vietnamese']);
      const langTags = tagCalls.filter(
        t => (t.tagValue as string)?.startsWith('language_'),
      );
      expect(langTags).toHaveLength(2);
    });

    it('derives sliding_scale cost tag for partial_fee', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Sliding Scale Clinic',
          _211_fees_detail: { type: 'partial_fee', description: 'Based on income' },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.costTags).toEqual(['sliding_scale']);
    });

    it('maps fee_required for full_fee', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Paid Service',
          _211_fees_detail: { type: 'full_fee', description: 'Full cost' },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.costTags).toEqual(['fee_required']);
    });

    it('produces no cost tag for unknown fee types', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Unknown Fee Service',
          _211_fees_detail: { type: 'other', description: 'Something else' },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.costTags).toEqual([]);
    });

    it('handles missing enrichment data gracefully', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Basic Service',
          description: 'No 211-specific metadata',
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.eligibilityTags).toEqual([]);
      expect(result.enrichments.costTags).toEqual([]);
      expect(result.enrichments.languageTags).toEqual([]);
    });
  });

  describe('organization_bundle records', () => {
    it('extracts per-service enrichment data from nested services', async () => {
      const { stores, tagCalls } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'organization_bundle',
        parsedPayload: {
          id: 'org-bundle-001',
          name: 'Veterans Services Org',
          services: [
            {
              id: 'svc-1',
              name: 'Veteran Housing',
              description: 'Housing for veterans',
              eligibility: { types: ['veteran', 'homelessness'] },
              fees: { type: 'no_fee' },
              languages: { codes: ['english', 'spanish'] },
              taxonomy: [],
              phones: [],
              contacts: [],
              schedules: [],
              alternateNames: [],
              accreditations: [],
              licenses: [],
              serviceAreas: [],
              locationIds: [],
            },
          ],
          locations: [
            {
              id: 'loc-1',
              name: 'Downtown Office',
              latitude: 36.66,
              longitude: -121.81,
              addresses: [{ type: 'physical', street: '123 Main St', city: 'Marina', state: 'CA', postalCode: '93933' }],
              phones: [],
              contacts: [],
              schedules: [],
              alternateNames: [],
            },
          ],
          alternateNames: [],
          contacts: [],
          phones: [],
          programs: [],
          servicesAtLocations: [],
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
        trustTier: 'trusted_partner',
      });

      // Should derive enrichments from the nested service
      expect(result.enrichments.eligibilityTags).toContain('population:veterans');
      expect(result.enrichments.eligibilityTags).toContain('situation:homeless');
      expect(result.enrichments.costTags).toEqual(['free']);
      expect(result.enrichments.languageTags).toEqual(['language_spanish']);

      // Tags should have been applied
      const audienceTags = tagCalls.filter(
        t => t.tagType === 'audience',
      );
      expect(audienceTags.length).toBeGreaterThan(0);
    });

    it('handles bundles with multiple services, each getting their own tags', async () => {
      const { stores, tagCalls } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'organization_bundle',
        parsedPayload: {
          id: 'org-multi',
          name: 'Multi-Service Org',
          services: [
            {
              id: 'svc-a',
              name: 'Youth Program',
              eligibility: { types: ['youth'] },
              fees: { type: 'no_fee' },
              languages: { codes: [] },
              taxonomy: [],
              phones: [],
              contacts: [],
              schedules: [],
              alternateNames: [],
              accreditations: [],
              licenses: [],
              serviceAreas: [],
              locationIds: [],
            },
            {
              id: 'svc-b',
              name: 'Senior Services',
              eligibility: { types: ['senior'] },
              fees: { type: 'partial_fee', description: 'Sliding scale' },
              languages: { codes: ['english', 'vietnamese'] },
              taxonomy: [],
              phones: [],
              contacts: [],
              schedules: [],
              alternateNames: [],
              accreditations: [],
              licenses: [],
              serviceAreas: [],
              locationIds: [],
            },
          ],
          locations: [],
          alternateNames: [],
          contacts: [],
          phones: [],
          programs: [],
          servicesAtLocations: [],
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
        trustTier: 'trusted_partner',
      });

      // Both eligibility types present
      expect(result.enrichments.eligibilityTags).toContain('population:youth');
      expect(result.enrichments.eligibilityTags).toContain('population:seniors');

      // Both cost tags
      expect(result.enrichments.costTags).toContain('free');
      expect(result.enrichments.costTags).toContain('sliding_scale');

      // Language tags from second service
      expect(result.enrichments.languageTags).toContain('language_vietnamese');

      // Tags applied to individual services (not broadcast to all)
      const audienceTags = tagCalls.filter(
        t => t.tagType === 'audience',
      );
      // svc-a gets 'youth', svc-b gets 'seniors' — 2 total
      expect(audienceTags).toHaveLength(2);
    });

    it('handles bundles with no services gracefully', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'organization_bundle',
        parsedPayload: {
          id: 'org-empty',
          name: 'Empty Org',
          services: [],
          locations: [],
          alternateNames: [],
          contacts: [],
          phones: [],
          programs: [],
          servicesAtLocations: [],
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.eligibilityTags).toEqual([]);
      expect(result.enrichments.costTags).toEqual([]);
      expect(result.enrichments.languageTags).toEqual([]);
    });
  });

  describe('all eligibility type mappings', () => {
    const EXPECTED_MAPPINGS: Array<[string, string, string]> = [
      ['veteran', 'population', 'veterans'],
      ['senior', 'population', 'seniors'],
      ['youth', 'population', 'youth'],
      ['student', 'population', 'students'],
      ['transgender', 'population', 'lgbtq'],
      ['low_income', 'situation', 'low_income'],
      ['homelessness', 'situation', 'homeless'],
      ['victim_of_violence', 'situation', 'domestic_violence'],
      ['crisis', 'situation', 'crisis'],
      ['disability', 'situation', 'disability'],
      ['uninsured', 'situation', 'uninsured'],
      ['food_insecurity', 'situation', 'food_insecurity'],
      ['medical_issue', 'situation', 'medical_issue'],
    ];

    for (const [inputType, expectedCategory, expectedValue] of EXPECTED_MAPPINGS) {
      it(`maps 211 eligibility '${inputType}' → ${expectedCategory}:${expectedValue}`, async () => {
        const { stores } = createMockNormalizerStores();

        const record = buildSourceRecord({
          sourceRecordType: 'service',
          parsedPayload: {
            name: `Test ${inputType}`,
            _211_eligibility: { types: [inputType] },
          },
        });

        const result = await normalize211SourceRecord({
          stores: stores as never,
          sourceRecord: record,
        });

        expect(result.enrichments.eligibilityTags).toContain(
          `${expectedCategory}:${expectedValue}`,
        );
      });
    }

    it('ignores unmapped eligibility types (e.g., residency, home_ownership)', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Test unmapped',
          _211_eligibility: { types: ['residency', 'home_ownership', 'other'] },
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(result.enrichments.eligibilityTags).toEqual([]);
    });
  });

  describe('canonical entity creation', () => {
    it('creates canonical org, service, and location from a child service record', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: {
          name: 'Healthcare Clinic',
          description: 'Primary care for all',
          url: 'https://clinic.example.com',
          phone: '(555) 123-4567',
        },
      });

      const result = await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
        trustTier: 'trusted_partner',
      });

      expect(result.canonicalOrganizationId).toBeDefined();
      expect(result.canonicalServiceIds).toHaveLength(1);
      expect(result.provenanceRecordsCreated).toBeGreaterThan(0);
    });

    it('marks source record as normalized after processing', async () => {
      const { stores } = createMockNormalizerStores();

      const record = buildSourceRecord({
        sourceRecordType: 'service',
        parsedPayload: { name: 'Test Normalization Status' },
      });

      await normalize211SourceRecord({
        stores: stores as never,
        sourceRecord: record,
      });

      expect(stores.sourceRecords.updateStatus).toHaveBeenCalledWith(
        record.id,
        'normalized',
      );
    });
  });
});
