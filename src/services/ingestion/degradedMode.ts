export type IngestionDependency = 'feed_transport' | 'geocoding' | 'translation' | 'safety';

export interface DegradedAutomationDecision {
  allowAutoPublish: boolean;
  reason?: string;
  degradedDependencies: IngestionDependency[];
}

const AUTO_PUBLISH_BLOCKING_DEPENDENCIES: readonly IngestionDependency[] = [
  'feed_transport',
  'geocoding',
  'translation',
  'safety',
];

function parseDependencyToken(token: string): IngestionDependency | null {
  switch (token.trim().toLowerCase()) {
    case 'feed_transport':
    case 'feed':
      return 'feed_transport';
    case 'geocoding':
    case 'geo':
      return 'geocoding';
    case 'translation':
    case 'translator':
      return 'translation';
    case 'safety':
    case 'content_safety':
      return 'safety';
    default:
      return null;
  }
}

export function getDegradedIngestionDependencies(envValue = process.env.ORAN_INGESTION_DEGRADED_DEPENDENCIES): IngestionDependency[] {
  if (!envValue) {
    return [];
  }

  const dependencies = envValue
    .split(',')
    .map(parseDependencyToken)
    .filter((dependency): dependency is IngestionDependency => dependency !== null);

  return Array.from(new Set(dependencies));
}

export function decideAutoPublishInDegradedMode(
  dependencies = getDegradedIngestionDependencies(),
): DegradedAutomationDecision {
  const blockedBy = dependencies.filter((dependency) => AUTO_PUBLISH_BLOCKING_DEPENDENCIES.includes(dependency));
  if (blockedBy.length === 0) {
    return {
      allowAutoPublish: true,
      degradedDependencies: [],
    };
  }

  return {
    allowAutoPublish: false,
    reason: `degraded_dependencies:${blockedBy.join(',')}`,
    degradedDependencies: blockedBy,
  };
}
