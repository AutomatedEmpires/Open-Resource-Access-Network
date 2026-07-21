/**
 * Provider-independent crisis-signal compatibility surface.
 *
 * ORAN no longer sends distress language to an external content-safety
 * provider. Runtime chat routing imports the synchronous helpers directly
 * from crisisSignals; this module remains only for older internal imports.
 */

import { hasDistressSignals } from '@/services/security/crisisSignals';

export {
  CRISIS_DISTRESS_SIGNALS,
  hasDistressSignals,
  normalizeSafetyText,
} from '@/services/security/crisisSignals';

/** @deprecated Use hasDistressSignals synchronously. */
export async function checkCrisisContentSafety(message: string): Promise<boolean> {
  return hasDistressSignals(message);
}
