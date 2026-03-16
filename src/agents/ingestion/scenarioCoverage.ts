import fs from 'node:fs';
import path from 'node:path';

export type ScenarioControl =
  | 'identity_convergence'
  | 'advisory_locking'
  | 'authority_ranking'
  | 'non_destructive_updates'
  | 'review_fallback'
  | 'provenance_capture'
  | 'linkage_backfill';

export interface IngestionScenario {
  id: number;
  challenge: string;
  resolution: string;
  sourceDoc: string;
}

export interface ScenarioCoverageResult {
  scenario: IngestionScenario;
  requiredControls: ScenarioControl[];
  missingControls: ScenarioControl[];
}

export const ACTIVE_INGESTION_CONTROLS: ReadonlySet<ScenarioControl> = new Set([
  'identity_convergence',
  'advisory_locking',
  'authority_ranking',
  'non_destructive_updates',
  'review_fallback',
  'provenance_capture',
  'linkage_backfill',
]);

export const SCENARIO_DOCS = [
  'docs/INGESTION_SCRAMBLE_SCENARIOS.md',
  'docs/INGESTION_ACCURACY_CHALLENGES_II.md',
  'docs/INGESTION_COMPLEX_SCENARIOS_III.md',
] as const;

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }

  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

  return cells.length >= 3 ? cells : null;
}

function isDividerRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseScenariosFromMarkdown(markdown: string, sourceDoc: string): IngestionScenario[] {
  const scenarios: IngestionScenario[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const cells = parseTableRow(line);
    if (!cells || isDividerRow(cells)) {
      continue;
    }

    const [idText, challenge, resolution] = cells;
    const id = Number(idText);
    if (!Number.isInteger(id)) {
      continue;
    }

    scenarios.push({
      id,
      challenge,
      resolution,
      sourceDoc,
    });
  }

  return scenarios;
}

export function loadDocumentedIngestionScenarios(repoRoot: string): IngestionScenario[] {
  return SCENARIO_DOCS.flatMap((docPath) => {
    const absolutePath = path.join(repoRoot, docPath);
    const markdown = fs.readFileSync(absolutePath, 'utf8');
    return parseScenariosFromMarkdown(markdown, docPath);
  }).sort((left, right) => left.id - right.id);
}

function containsAny(text: string, needles: string[]): boolean {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

export function inferRequiredControls(scenario: IngestionScenario): ScenarioControl[] {
  const text = `${scenario.challenge} ${scenario.resolution}`.toLowerCase();
  const required = new Set<ScenarioControl>([
    'review_fallback',
    'provenance_capture',
  ]);

  if (scenario.id <= 100) {
    required.add('identity_convergence');
    required.add('advisory_locking');
    required.add('linkage_backfill');
  }

  if (scenario.id > 100) {
    required.add('authority_ranking');
    required.add('non_destructive_updates');
  }

  if (containsAny(text, ['duplicate', 'reuse', 'same service', 'same org', 'republish', 'adopt', 'converge', 'one live identity'])) {
    required.add('identity_convergence');
    required.add('linkage_backfill');
  }

  if (containsAny(text, ['concurrent', 'simultaneous', 'race', 'retry', 'replay', 'serializes', 'worker'])) {
    required.add('advisory_locking');
  }

  if (containsAny(text, ['stronger', 'weaker', 'authority', 'stale', 'host-controlled', 'host-managed', 'cannot overwrite', 'suppresses overwrite'])) {
    required.add('authority_ranking');
  }

  if (containsAny(text, ['blank', 'null', 'omit', 'omits', 'missing weaker', 'erase', 'lossy', 'preserve', 'non-destructive'])) {
    required.add('non_destructive_updates');
  }

  if (containsAny(text, ['review', 'ambiguous', 'conflict', 'contradict', 'unclear', 'quarantine', 'fail closed'])) {
    required.add('review_fallback');
  }

  if (containsAny(text, ['link', 'backfill', 'adopt', 'existing record', 'existing service', 'existing org'])) {
    required.add('linkage_backfill');
  }

  if (containsAny(text, ['provenance', 'evidence', 'audit', 'lifecycle', 'record', 'history'])) {
    required.add('provenance_capture');
  }

  return Array.from(required).sort();
}

export function evaluateScenarioCoverage(scenario: IngestionScenario): ScenarioCoverageResult {
  const requiredControls = inferRequiredControls(scenario);
  const missingControls = requiredControls.filter((control) => !ACTIVE_INGESTION_CONTROLS.has(control));

  return {
    scenario,
    requiredControls,
    missingControls,
  };
}
