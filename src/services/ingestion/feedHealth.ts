export interface IngestionFeedHealthSnapshot {
  activeFeeds: number;
  pausedFeeds: number;
  failedFeeds: number;
  autoPublishFeeds: number;
  silentFeeds: number;
  silentAutoPublishFeeds: number;
}

export interface IngestionDegradedModeStatus {
  recommended: boolean;
  severity: 'normal' | 'elevated' | 'degraded';
  reasons: string[];
  freezeAutoPublish: boolean;
  requireReviewOnly: boolean;
}

function threshold(activeFeeds: number, ratio: number, minimum: number): number {
  return Math.max(minimum, Math.ceil(activeFeeds * ratio));
}

export function assessIngestionDegradedMode(
  snapshot: IngestionFeedHealthSnapshot,
): IngestionDegradedModeStatus {
  const reasons: string[] = [];
  const silentFeedThreshold = threshold(snapshot.activeFeeds, 0.2, 2);
  const failedFeedThreshold = threshold(snapshot.activeFeeds, 0.15, 2);
  const degradedSilentThreshold = threshold(snapshot.activeFeeds, 0.3, 3);

  if (snapshot.silentAutoPublishFeeds > 0) {
    reasons.push(
      `${snapshot.silentAutoPublishFeeds} auto-publish feed${snapshot.silentAutoPublishFeeds === 1 ? '' : 's'} are silent past the health window`,
    );
  }

  if (snapshot.silentFeeds >= silentFeedThreshold) {
    reasons.push(
      `${snapshot.silentFeeds} active feed${snapshot.silentFeeds === 1 ? '' : 's'} are silent and should be reviewed before further automation`,
    );
  }

  if (snapshot.failedFeeds >= failedFeedThreshold) {
    reasons.push(
      `${snapshot.failedFeeds} active feed${snapshot.failedFeeds === 1 ? '' : 's'} are currently failed`,
    );
  }

  const recommended = reasons.length > 0;
  const severity: IngestionDegradedModeStatus['severity'] = !recommended
    ? 'normal'
    : snapshot.silentAutoPublishFeeds > 0 || snapshot.silentFeeds >= degradedSilentThreshold
      ? 'degraded'
      : 'elevated';

  return {
    recommended,
    severity,
    reasons,
    freezeAutoPublish: snapshot.silentAutoPublishFeeds > 0,
    requireReviewOnly: recommended,
  };
}
