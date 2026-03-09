/**
 * Persistence Layer for Ingestion Agent
 *
 * Drizzle ORM implementations of all 36 store interfaces.
 */

export {
  createDrizzleEvidenceStore,
  storeDiscoveredLinks,
  getDiscoveredLinks,
} from './evidenceStore';

export { createDrizzleCandidateStore } from './candidateStore';

export { createDrizzleAuditStore } from './auditStore';

export { createDrizzleSourceRegistryStore } from './sourceRegistryStore';

export { createDrizzleJobStore } from './jobStore';

export { createDrizzleTagStore } from './tagStore';

export { createDrizzleVerificationCheckStore } from './verificationCheckStore';

export { createDrizzleVerifiedLinkStore } from './verifiedLinkStore';

export { createDrizzleFeedStore } from './feedStore';

export { createDrizzleAdminRoutingStore } from './adminRoutingStore';

export { createDrizzleAdminProfileStore } from './adminProfileStore';

export { createDrizzleAdminAssignmentStore } from './adminAssignmentStore';

export { createDrizzleTagConfirmationStore } from './tagConfirmationStore';

export { createDrizzleLlmSuggestionStore } from './llmSuggestionStore';

export { createDrizzlePublishThresholdStore } from './publishThresholdStore';

export { createDrizzlePublishReadinessStore } from './publishReadinessStore';

export { createDrizzleSourceSystemStore } from './sourceSystemStore';

export { createDrizzleSourceFeedStore } from './sourceFeedStore';

export { createDrizzleSourceRecordStore } from './sourceRecordStore';

export { createDrizzleEntityIdentifierStore } from './entityIdentifierStore';

export { createDrizzleHsdsExportSnapshotStore } from './hsdsExportSnapshotStore';

export { createDrizzleLifecycleEventStore } from './lifecycleEventStore';

export { createDrizzleCanonicalOrganizationStore } from './canonicalOrganizationStore';
export { createDrizzleCanonicalServiceStore } from './canonicalServiceStore';
export { createDrizzleCanonicalLocationStore } from './canonicalLocationStore';
export { createDrizzleCanonicalServiceLocationStore } from './canonicalServiceLocationStore';
export { createDrizzleCanonicalProvenanceStore } from './canonicalProvenanceStore';

export { createDrizzleTaxonomyRegistryStore } from './taxonomyRegistryStore';
export { createDrizzleTaxonomyTermExtStore } from './taxonomyTermExtStore';
export { createDrizzleCanonicalConceptStore } from './canonicalConceptStore';
export { createDrizzleTaxonomyCrosswalkStore } from './taxonomyCrosswalkStore';
export { createDrizzleConceptTagDerivationStore } from './conceptTagDerivationStore';

export { createDrizzleEntityClusterStore } from './entityClusterStore';
export { createDrizzleEntityClusterMemberStore } from './entityClusterMemberStore';
export { createDrizzleResolutionCandidateStore } from './resolutionCandidateStore';
export { createDrizzleResolutionDecisionStore } from './resolutionDecisionStore';

export { createIngestionStores } from './storeFactory';
