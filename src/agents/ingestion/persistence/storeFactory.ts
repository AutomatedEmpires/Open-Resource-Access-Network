/**
 * Composite factory that creates all 37 ingestion stores.
 *
 * Usage:
 *   const stores = createIngestionStores(db);
 *   await stores.candidates.getById(id);
 *   await stores.tags.listFor(id, 'candidate');
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IngestionStores } from '../stores';
import * as schema from '@/db/schema';

import { createDrizzleSourceRegistryStore } from './sourceRegistryStore';
import { createDrizzleJobStore } from './jobStore';
import { createDrizzleEvidenceStore } from './evidenceStore';
import { createDrizzleCandidateStore } from './candidateStore';
import { createDrizzleTagStore } from './tagStore';
import { createDrizzleVerificationCheckStore } from './verificationCheckStore';
import { createDrizzleVerifiedLinkStore } from './verifiedLinkStore';
import { createDrizzleAuditStore } from './auditStore';
import { createDrizzleFeedStore } from './feedStore';
import { createDrizzleAdminRoutingStore } from './adminRoutingStore';
import { createDrizzleAdminProfileStore } from './adminProfileStore';
import { createDrizzleAdminAssignmentStore } from './adminAssignmentStore';
import { createDrizzleTagConfirmationStore } from './tagConfirmationStore';
import { createDrizzleLlmSuggestionStore } from './llmSuggestionStore';
import { createDrizzlePublishThresholdStore } from './publishThresholdStore';
import { createDrizzlePublishReadinessStore } from './publishReadinessStore';
import { createDrizzleSourceSystemStore } from './sourceSystemStore';
import { createDrizzleSourceFeedStore } from './sourceFeedStore';
import { createDrizzleSourceFeedStateStore } from './sourceFeedStateStore';
import { createDrizzleSourceRecordStore } from './sourceRecordStore';
import { createDrizzleEntityIdentifierStore } from './entityIdentifierStore';
import { createDrizzleHsdsExportSnapshotStore } from './hsdsExportSnapshotStore';
import { createDrizzleLifecycleEventStore } from './lifecycleEventStore';
import { createDrizzleCanonicalOrganizationStore } from './canonicalOrganizationStore';
import { createDrizzleCanonicalServiceStore } from './canonicalServiceStore';
import { createDrizzleCanonicalLocationStore } from './canonicalLocationStore';
import { createDrizzleCanonicalServiceLocationStore } from './canonicalServiceLocationStore';
import { createDrizzleCanonicalProvenanceStore } from './canonicalProvenanceStore';
import { createDrizzleTaxonomyRegistryStore } from './taxonomyRegistryStore';
import { createDrizzleTaxonomyTermExtStore } from './taxonomyTermExtStore';
import { createDrizzleCanonicalConceptStore } from './canonicalConceptStore';
import { createDrizzleTaxonomyCrosswalkStore } from './taxonomyCrosswalkStore';
import { createDrizzleConceptTagDerivationStore } from './conceptTagDerivationStore';
import { createDrizzleEntityClusterStore } from './entityClusterStore';
import { createDrizzleEntityClusterMemberStore } from './entityClusterMemberStore';
import { createDrizzleResolutionCandidateStore } from './resolutionCandidateStore';
import { createDrizzleResolutionDecisionStore } from './resolutionDecisionStore';

/**
 * Creates the full set of ingestion stores backed by PostgreSQL via Drizzle.
 *
 * All stores share the same database connection, ensuring consistency
 * when used within the same request or pipeline step.
 */
export function createIngestionStores(
  db: NodePgDatabase<typeof schema>
): IngestionStores {
  return {
    sourceRegistry: createDrizzleSourceRegistryStore(db),
    jobs: createDrizzleJobStore(db),
    evidence: createDrizzleEvidenceStore(db),
    candidates: createDrizzleCandidateStore(db),
    tags: createDrizzleTagStore(db),
    checks: createDrizzleVerificationCheckStore(db),
    links: createDrizzleVerifiedLinkStore(db),
    audit: createDrizzleAuditStore(db),
    feeds: createDrizzleFeedStore(db),
    routing: createDrizzleAdminRoutingStore(db),
    adminProfiles: createDrizzleAdminProfileStore(db),
    assignments: createDrizzleAdminAssignmentStore(db),
    tagConfirmations: createDrizzleTagConfirmationStore(db),
    llmSuggestions: createDrizzleLlmSuggestionStore(db),
    publishThresholds: createDrizzlePublishThresholdStore(db),
    publishReadiness: createDrizzlePublishReadinessStore(db),

    // Source assertion layer (0032)
    sourceSystems: createDrizzleSourceSystemStore(db),
    sourceFeeds: createDrizzleSourceFeedStore(db),
    sourceFeedStates: createDrizzleSourceFeedStateStore(db),
    sourceRecords: createDrizzleSourceRecordStore(db),
    entityIdentifiers: createDrizzleEntityIdentifierStore(db),
    hsdsExportSnapshots: createDrizzleHsdsExportSnapshotStore(db),
    lifecycleEvents: createDrizzleLifecycleEventStore(db),

    // Canonical federation layer (0033)
    canonicalOrganizations: createDrizzleCanonicalOrganizationStore(db),
    canonicalServices: createDrizzleCanonicalServiceStore(db),
    canonicalLocations: createDrizzleCanonicalLocationStore(db),
    canonicalServiceLocations: createDrizzleCanonicalServiceLocationStore(db),
    canonicalProvenance: createDrizzleCanonicalProvenanceStore(db),

    // Taxonomy federation layer (0037)
    taxonomyRegistries: createDrizzleTaxonomyRegistryStore(db),
    taxonomyTermsExt: createDrizzleTaxonomyTermExtStore(db),
    canonicalConcepts: createDrizzleCanonicalConceptStore(db),
    taxonomyCrosswalks: createDrizzleTaxonomyCrosswalkStore(db),
    conceptTagDerivations: createDrizzleConceptTagDerivationStore(db),

    // Resolution & clustering layer (0038)
    entityClusters: createDrizzleEntityClusterStore(db),
    entityClusterMembers: createDrizzleEntityClusterMemberStore(db),
    resolutionCandidates: createDrizzleResolutionCandidateStore(db),
    resolutionDecisions: createDrizzleResolutionDecisionStore(db),
  };
}
