import { beforeEach, describe, expect, it, vi } from 'vitest';

const creatorMocks = vi.hoisted(() => ({
  sourceRegistry: vi.fn(() => ({ name: 'sourceRegistryStore' })),
  jobs: vi.fn(() => ({ name: 'jobStore' })),
  evidence: vi.fn(() => ({ name: 'evidenceStore' })),
  candidates: vi.fn(() => ({ name: 'candidateStore' })),
  tags: vi.fn(() => ({ name: 'tagStore' })),
  checks: vi.fn(() => ({ name: 'verificationCheckStore' })),
  links: vi.fn(() => ({ name: 'verifiedLinkStore' })),
  audit: vi.fn(() => ({ name: 'auditStore' })),
  feeds: vi.fn(() => ({ name: 'feedStore' })),
  routing: vi.fn(() => ({ name: 'adminRoutingStore' })),
  adminProfiles: vi.fn(() => ({ name: 'adminProfileStore' })),
  assignments: vi.fn(() => ({ name: 'adminAssignmentStore' })),
  tagConfirmations: vi.fn(() => ({ name: 'tagConfirmationStore' })),
  llmSuggestions: vi.fn(() => ({ name: 'llmSuggestionStore' })),
  publishThresholds: vi.fn(() => ({ name: 'publishThresholdStore' })),
  publishReadiness: vi.fn(() => ({ name: 'publishReadinessStore' })),
  sourceSystems: vi.fn(() => ({ name: 'sourceSystemStore' })),
  sourceFeeds: vi.fn(() => ({ name: 'sourceFeedStore' })),
  sourceRecords: vi.fn(() => ({ name: 'sourceRecordStore' })),
  entityIdentifiers: vi.fn(() => ({ name: 'entityIdentifierStore' })),
  hsdsExportSnapshots: vi.fn(() => ({ name: 'hsdsExportSnapshotStore' })),
  lifecycleEvents: vi.fn(() => ({ name: 'lifecycleEventStore' })),
  canonicalOrganizations: vi.fn(() => ({ name: 'canonicalOrganizationStore' })),
  canonicalServices: vi.fn(() => ({ name: 'canonicalServiceStore' })),
  canonicalLocations: vi.fn(() => ({ name: 'canonicalLocationStore' })),
  canonicalServiceLocations: vi.fn(() => ({ name: 'canonicalServiceLocationStore' })),
  canonicalProvenance: vi.fn(() => ({ name: 'canonicalProvenanceStore' })),
}));

vi.mock('../sourceRegistryStore', () => ({
  createDrizzleSourceRegistryStore: creatorMocks.sourceRegistry,
}));
vi.mock('../jobStore', () => ({
  createDrizzleJobStore: creatorMocks.jobs,
}));
vi.mock('../evidenceStore', () => ({
  createDrizzleEvidenceStore: creatorMocks.evidence,
}));
vi.mock('../candidateStore', () => ({
  createDrizzleCandidateStore: creatorMocks.candidates,
}));
vi.mock('../tagStore', () => ({
  createDrizzleTagStore: creatorMocks.tags,
}));
vi.mock('../verificationCheckStore', () => ({
  createDrizzleVerificationCheckStore: creatorMocks.checks,
}));
vi.mock('../verifiedLinkStore', () => ({
  createDrizzleVerifiedLinkStore: creatorMocks.links,
}));
vi.mock('../auditStore', () => ({
  createDrizzleAuditStore: creatorMocks.audit,
}));
vi.mock('../feedStore', () => ({
  createDrizzleFeedStore: creatorMocks.feeds,
}));
vi.mock('../adminRoutingStore', () => ({
  createDrizzleAdminRoutingStore: creatorMocks.routing,
}));
vi.mock('../adminProfileStore', () => ({
  createDrizzleAdminProfileStore: creatorMocks.adminProfiles,
}));
vi.mock('../adminAssignmentStore', () => ({
  createDrizzleAdminAssignmentStore: creatorMocks.assignments,
}));
vi.mock('../tagConfirmationStore', () => ({
  createDrizzleTagConfirmationStore: creatorMocks.tagConfirmations,
}));
vi.mock('../llmSuggestionStore', () => ({
  createDrizzleLlmSuggestionStore: creatorMocks.llmSuggestions,
}));
vi.mock('../publishThresholdStore', () => ({
  createDrizzlePublishThresholdStore: creatorMocks.publishThresholds,
}));
vi.mock('../publishReadinessStore', () => ({
  createDrizzlePublishReadinessStore: creatorMocks.publishReadiness,
}));
vi.mock('../sourceSystemStore', () => ({
  createDrizzleSourceSystemStore: creatorMocks.sourceSystems,
}));
vi.mock('../sourceFeedStore', () => ({
  createDrizzleSourceFeedStore: creatorMocks.sourceFeeds,
}));
vi.mock('../sourceRecordStore', () => ({
  createDrizzleSourceRecordStore: creatorMocks.sourceRecords,
}));
vi.mock('../entityIdentifierStore', () => ({
  createDrizzleEntityIdentifierStore: creatorMocks.entityIdentifiers,
}));
vi.mock('../hsdsExportSnapshotStore', () => ({
  createDrizzleHsdsExportSnapshotStore: creatorMocks.hsdsExportSnapshots,
}));
vi.mock('../lifecycleEventStore', () => ({
  createDrizzleLifecycleEventStore: creatorMocks.lifecycleEvents,
}));
vi.mock('../canonicalOrganizationStore', () => ({
  createDrizzleCanonicalOrganizationStore: creatorMocks.canonicalOrganizations,
}));
vi.mock('../canonicalServiceStore', () => ({
  createDrizzleCanonicalServiceStore: creatorMocks.canonicalServices,
}));
vi.mock('../canonicalLocationStore', () => ({
  createDrizzleCanonicalLocationStore: creatorMocks.canonicalLocations,
}));
vi.mock('../canonicalServiceLocationStore', () => ({
  createDrizzleCanonicalServiceLocationStore: creatorMocks.canonicalServiceLocations,
}));
vi.mock('../canonicalProvenanceStore', () => ({
  createDrizzleCanonicalProvenanceStore: creatorMocks.canonicalProvenance,
}));

import { createIngestionStores } from '../storeFactory';

describe('storeFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates all ingestion stores from a shared db instance', () => {
    const db = { name: 'db' } as never;
    const stores = createIngestionStores(db);

    expect(creatorMocks.sourceRegistry).toHaveBeenCalledWith(db);
    expect(creatorMocks.jobs).toHaveBeenCalledWith(db);
    expect(creatorMocks.evidence).toHaveBeenCalledWith(db);
    expect(creatorMocks.candidates).toHaveBeenCalledWith(db);
    expect(creatorMocks.tags).toHaveBeenCalledWith(db);
    expect(creatorMocks.checks).toHaveBeenCalledWith(db);
    expect(creatorMocks.links).toHaveBeenCalledWith(db);
    expect(creatorMocks.audit).toHaveBeenCalledWith(db);
    expect(creatorMocks.feeds).toHaveBeenCalledWith(db);
    expect(creatorMocks.routing).toHaveBeenCalledWith(db);
    expect(creatorMocks.adminProfiles).toHaveBeenCalledWith(db);
    expect(creatorMocks.assignments).toHaveBeenCalledWith(db);
    expect(creatorMocks.tagConfirmations).toHaveBeenCalledWith(db);
    expect(creatorMocks.llmSuggestions).toHaveBeenCalledWith(db);
    expect(creatorMocks.publishThresholds).toHaveBeenCalledWith(db);
    expect(creatorMocks.publishReadiness).toHaveBeenCalledWith(db);
    expect(creatorMocks.sourceSystems).toHaveBeenCalledWith(db);
    expect(creatorMocks.sourceFeeds).toHaveBeenCalledWith(db);
    expect(creatorMocks.sourceRecords).toHaveBeenCalledWith(db);
    expect(creatorMocks.entityIdentifiers).toHaveBeenCalledWith(db);
    expect(creatorMocks.hsdsExportSnapshots).toHaveBeenCalledWith(db);
    expect(creatorMocks.lifecycleEvents).toHaveBeenCalledWith(db);
    expect(creatorMocks.canonicalOrganizations).toHaveBeenCalledWith(db);
    expect(creatorMocks.canonicalServices).toHaveBeenCalledWith(db);
    expect(creatorMocks.canonicalLocations).toHaveBeenCalledWith(db);
    expect(creatorMocks.canonicalServiceLocations).toHaveBeenCalledWith(db);
    expect(creatorMocks.canonicalProvenance).toHaveBeenCalledWith(db);

    expect(stores).toEqual({
      sourceRegistry: { name: 'sourceRegistryStore' },
      jobs: { name: 'jobStore' },
      evidence: { name: 'evidenceStore' },
      candidates: { name: 'candidateStore' },
      tags: { name: 'tagStore' },
      checks: { name: 'verificationCheckStore' },
      links: { name: 'verifiedLinkStore' },
      audit: { name: 'auditStore' },
      feeds: { name: 'feedStore' },
      routing: { name: 'adminRoutingStore' },
      adminProfiles: { name: 'adminProfileStore' },
      assignments: { name: 'adminAssignmentStore' },
      tagConfirmations: { name: 'tagConfirmationStore' },
      llmSuggestions: { name: 'llmSuggestionStore' },
      publishThresholds: { name: 'publishThresholdStore' },
      publishReadiness: { name: 'publishReadinessStore' },
      sourceSystems: { name: 'sourceSystemStore' },
      sourceFeeds: { name: 'sourceFeedStore' },
      sourceRecords: { name: 'sourceRecordStore' },
      entityIdentifiers: { name: 'entityIdentifierStore' },
      hsdsExportSnapshots: { name: 'hsdsExportSnapshotStore' },
      lifecycleEvents: { name: 'lifecycleEventStore' },
      canonicalOrganizations: { name: 'canonicalOrganizationStore' },
      canonicalServices: { name: 'canonicalServiceStore' },
      canonicalLocations: { name: 'canonicalLocationStore' },
      canonicalServiceLocations: { name: 'canonicalServiceLocationStore' },
      canonicalProvenance: { name: 'canonicalProvenanceStore' },
    });
  });
});
