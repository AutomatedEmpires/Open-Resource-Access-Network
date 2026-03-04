/**
 * Composite factory that creates all 16 ingestion stores.
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
  };
}
