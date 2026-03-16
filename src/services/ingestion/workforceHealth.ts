export interface IngestionWorkforceHealthSnapshot {
  pendingDecisionSubmissions: number;
  slaBreachedSubmissions: number;
  silentReviewers: number;
  stalledReviewerAssignments: number;
  silentHostAdmins: number;
  silentOwnerOrganizations: number;
}

export interface IngestionWorkforceHealthStatus {
  recommended: boolean;
  severity: 'normal' | 'elevated' | 'degraded';
  reasons: string[];
  requireReviewOnly: boolean;
  requireOwnerOutreach: boolean;
}

function threshold(total: number, ratio: number, minimum: number): number {
  return Math.max(minimum, Math.ceil(total * ratio));
}

export function assessIngestionWorkforceHealth(
  snapshot: IngestionWorkforceHealthSnapshot,
): IngestionWorkforceHealthStatus {
  const reasons: string[] = [];
  const stalledAssignmentThreshold = threshold(snapshot.pendingDecisionSubmissions, 0.25, 2);

  if (snapshot.silentReviewers > 0 && snapshot.stalledReviewerAssignments >= stalledAssignmentThreshold) {
    reasons.push(
      `${snapshot.stalledReviewerAssignments} pending submission${snapshot.stalledReviewerAssignments === 1 ? '' : 's'} are assigned to ${snapshot.silentReviewers} silent reviewer${snapshot.silentReviewers === 1 ? '' : 's'}`,
    );
  }

  if (snapshot.silentOwnerOrganizations > 0) {
    reasons.push(
      `${snapshot.silentOwnerOrganizations} owner organization${snapshot.silentOwnerOrganizations === 1 ? '' : 's'} have no recently active host admin`,
    );
  }

  const recommended = reasons.length > 0;
  const severity: IngestionWorkforceHealthStatus['severity'] = !recommended
    ? 'normal'
    : snapshot.slaBreachedSubmissions > 0 || snapshot.silentOwnerOrganizations > 0
      ? 'degraded'
      : 'elevated';

  return {
    recommended,
    severity,
    reasons,
    requireReviewOnly: snapshot.stalledReviewerAssignments > 0,
    requireOwnerOutreach: snapshot.silentOwnerOrganizations > 0,
  };
}
