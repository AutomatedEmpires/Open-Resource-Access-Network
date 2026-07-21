/**
 * Small, browser-safe crisis signal helpers.
 *
 * Keep provider SDKs and telemetry out of this module: guided intake needs the
 * deterministic checks before navigation, and importing the server content-
 * safety adapter into seeker pages would put those dependencies in the bundle.
 */

export const CRISIS_DISTRESS_SIGNALS: readonly string[] = [
  'feel hopeless',
  'feels hopeless',
  'feeling hopeless',
  'no hope left',
  'lost all hope',
  'all hope is gone',
  'no hope anymore',
  'want to disappear',
  'feel like disappearing',
  'wish i wasn\'t here',
  'wish i wasn\'t alive',
  'wish i was dead',
  'tired of living',
  'tired of being alive',
  'don\'t want to exist',
  'think about hurting',
  'thoughts of hurting',
  'thoughts of ending',
  'nobody would miss me',
  'nobody cares if i',
  'world is better without me',
  'better off without me',
  'i\'m just a burden',
  'everyone would be better',
  'given up on life',
  'giving up on life',
  'nothing to live for',
  'no reason to keep going',
  'no reason to stay',
  'can\'t do this anymore',
  'can\'t keep going',
  'can\'t take it anymore',
  'don\'t see a way out',
  'do not see a way out',
  'no way out',
  'no way forward',
  'at my breaking point',
  'reached my breaking point',
  'can\'t go on like this',
  'don\'t know how much more i can take',
  'don\'t know how much longer',
  'completely lost',
  'lost the will',
] as const;

export function normalizeSafetyText(message: string): string {
  return message.toLowerCase().replace(/[‘’‛]/g, "'");
}

export function hasDistressSignals(message: string): boolean {
  const normalized = normalizeSafetyText(message);
  return CRISIS_DISTRESS_SIGNALS.some((signal) => normalized.includes(signal));
}
