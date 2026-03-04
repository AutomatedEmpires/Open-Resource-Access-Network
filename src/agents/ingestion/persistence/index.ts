/**
 * Persistence Layer for Ingestion Agent
 *
 * Drizzle ORM implementations of all 16 store interfaces.
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

export { createIngestionStores } from './storeFactory';
