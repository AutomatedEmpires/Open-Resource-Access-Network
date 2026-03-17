import type { SeekerPlanServiceSnapshot } from '@/domain/execution';

export function getLinkedServiceExecutionWarnings(
  snapshot: SeekerPlanServiceSnapshot | undefined,
  now: Date = new Date(),
): string[] {
  if (!snapshot) {
    return [];
  }

  const warnings: string[] = [];
  const capturedAt = new Date(snapshot.capturedAt);
  if (!Number.isNaN(capturedAt.getTime())) {
    const ageDays = Math.floor((now.getTime() - capturedAt.getTime()) / 86_400_000);
    if (ageDays >= 7) {
      warnings.push(`This linked snapshot was captured ${ageDays} day${ageDays === 1 ? '' : 's'} ago. Re-open the live service record before you travel.`);
    }
  }

  if (snapshot.trustBand === 'LIKELY') {
    warnings.push('Trust is Likely. Confirm hours, availability, and eligibility before relying on this stop.');
  }

  if (snapshot.trustBand === 'POSSIBLE') {
    warnings.push('Trust is Possible. Treat this as lower-confidence and confirm provider details before you act on it.');
  }

  return warnings;
}
