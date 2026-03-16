import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_INGESTION_CONTROLS,
  evaluateScenarioCoverage,
  loadDocumentedIngestionScenarios,
  SCENARIO_DOCS,
} from '@/agents/ingestion/scenarioCoverage';

const repoRoot = path.resolve(__dirname, '../../../..');
const scenarios = loadDocumentedIngestionScenarios(repoRoot);

describe('documented ingestion scenario coverage', () => {
  it('loads all three documented scenario sets', () => {
    expect(SCENARIO_DOCS).toHaveLength(3);
    expect(scenarios).toHaveLength(300);
    expect(scenarios[0]?.id).toBe(1);
    expect(scenarios.at(-1)?.id).toBe(300);
  });

  it('contains exactly one hundred scenarios per document', () => {
    const counts = new Map<string, number>();
    for (const scenario of scenarios) {
      counts.set(scenario.sourceDoc, (counts.get(scenario.sourceDoc) ?? 0) + 1);
    }

    for (const docPath of SCENARIO_DOCS) {
      expect(counts.get(docPath)).toBe(100);
    }
  });

  it('exposes the full unified control stack needed by the documented scenarios', () => {
    expect(ACTIVE_INGESTION_CONTROLS).toEqual(
      new Set([
        'identity_convergence',
        'advisory_locking',
        'authority_ranking',
        'non_destructive_updates',
        'review_fallback',
        'provenance_capture',
        'linkage_backfill',
      ]),
    );
  });
});

describe('per-scenario proof coverage', () => {
  it.each(scenarios)('scenario $id is covered by implemented ingestion controls', (scenario) => {
    const result = evaluateScenarioCoverage(scenario);

    expect(result.missingControls).toEqual([]);
    expect(result.requiredControls.length).toBeGreaterThan(0);
  });
});
