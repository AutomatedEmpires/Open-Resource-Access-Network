/**
 * Persistence Layer for Ingestion Agent
 *
 * Drizzle ORM implementations of store interfaces.
 */

export {
  createDrizzleEvidenceStore,
  storeDiscoveredLinks,
  getDiscoveredLinks,
} from './evidenceStore';

export {
  createDrizzleCandidateStore,
} from './candidateStore';
