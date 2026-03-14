import { describe, expect, it } from 'vitest';

import * as persistenceIndex from '../index';
import * as evidenceStoreModule from '../evidenceStore';
import * as candidateStoreModule from '../candidateStore';
import * as auditStoreModule from '../auditStore';
import * as sourceRegistryStoreModule from '../sourceRegistryStore';
import * as jobStoreModule from '../jobStore';
import * as tagStoreModule from '../tagStore';
import * as verificationCheckStoreModule from '../verificationCheckStore';
import * as verifiedLinkStoreModule from '../verifiedLinkStore';
import * as feedStoreModule from '../feedStore';
import * as adminRoutingStoreModule from '../adminRoutingStore';
import * as adminProfileStoreModule from '../adminProfileStore';
import * as adminAssignmentStoreModule from '../adminAssignmentStore';
import * as tagConfirmationStoreModule from '../tagConfirmationStore';
import * as llmSuggestionStoreModule from '../llmSuggestionStore';
import * as publishThresholdStoreModule from '../publishThresholdStore';
import * as publishReadinessStoreModule from '../publishReadinessStore';
import * as sourceFeedStateStoreModule from '../sourceFeedStateStore';
import * as storeFactoryModule from '../storeFactory';

describe('persistence index exports', () => {
  it('re-exports persistence store constructors', () => {
    expect(persistenceIndex.createDrizzleEvidenceStore).toBe(evidenceStoreModule.createDrizzleEvidenceStore);
    expect(persistenceIndex.createDrizzleCandidateStore).toBe(candidateStoreModule.createDrizzleCandidateStore);
    expect(persistenceIndex.createDrizzleAuditStore).toBe(auditStoreModule.createDrizzleAuditStore);
    expect(persistenceIndex.createDrizzleSourceRegistryStore).toBe(sourceRegistryStoreModule.createDrizzleSourceRegistryStore);
    expect(persistenceIndex.createDrizzleJobStore).toBe(jobStoreModule.createDrizzleJobStore);
    expect(persistenceIndex.createDrizzleTagStore).toBe(tagStoreModule.createDrizzleTagStore);
    expect(persistenceIndex.createDrizzleVerificationCheckStore).toBe(verificationCheckStoreModule.createDrizzleVerificationCheckStore);
    expect(persistenceIndex.createDrizzleVerifiedLinkStore).toBe(verifiedLinkStoreModule.createDrizzleVerifiedLinkStore);
    expect(persistenceIndex.createDrizzleFeedStore).toBe(feedStoreModule.createDrizzleFeedStore);
    expect(persistenceIndex.createDrizzleAdminRoutingStore).toBe(adminRoutingStoreModule.createDrizzleAdminRoutingStore);
    expect(persistenceIndex.createDrizzleAdminProfileStore).toBe(adminProfileStoreModule.createDrizzleAdminProfileStore);
    expect(persistenceIndex.createDrizzleAdminAssignmentStore).toBe(adminAssignmentStoreModule.createDrizzleAdminAssignmentStore);
    expect(persistenceIndex.createDrizzleTagConfirmationStore).toBe(tagConfirmationStoreModule.createDrizzleTagConfirmationStore);
    expect(persistenceIndex.createDrizzleLlmSuggestionStore).toBe(llmSuggestionStoreModule.createDrizzleLlmSuggestionStore);
    expect(persistenceIndex.createDrizzlePublishThresholdStore).toBe(publishThresholdStoreModule.createDrizzlePublishThresholdStore);
    expect(persistenceIndex.createDrizzlePublishReadinessStore).toBe(publishReadinessStoreModule.createDrizzlePublishReadinessStore);
    expect(persistenceIndex.createDrizzleSourceFeedStateStore).toBe(sourceFeedStateStoreModule.createDrizzleSourceFeedStateStore);
    expect(persistenceIndex.createIngestionStores).toBe(storeFactoryModule.createIngestionStores);
  });

  it('re-exports evidence link snapshot helpers', () => {
    expect(persistenceIndex.storeDiscoveredLinks).toBe(evidenceStoreModule.storeDiscoveredLinks);
    expect(persistenceIndex.getDiscoveredLinks).toBe(evidenceStoreModule.getDiscoveredLinks);
  });
});
