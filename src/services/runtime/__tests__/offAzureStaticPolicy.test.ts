import { describe, expect, it } from 'vitest';

import {
  guardPrecedesEverySink,
  hasExecutableCall,
  inspectArchivedWorkflowJobs,
  parseWorkflowRunCommands,
  shellExecutableLines,
} from '../../../../scripts/off-azure-static-policy-core.mjs';

describe('off-Azure static policy primitives', () => {
  it('does not accept imports, comments, or strings as endpoint guard calls', () => {
    const decoys = `
      import { assertAllowedRuntimeEndpoint } from './policy';
      // assertAllowedRuntimeEndpoint(candidate);
      /* assertAllowedRuntimeEndpoint(candidate); */
      const documentation = 'assertAllowedRuntimeEndpoint(candidate)';
      const templateDocumentation = \`assertAllowedRuntimeEndpoint(candidate)\`;
    `;

    expect(hasExecutableCall(decoys, 'assertAllowedRuntimeEndpoint')).toBe(false);
    expect(hasExecutableCall(
      `${decoys}\nassertAllowedRuntimeEndpoint(candidate, 'feed URL');`,
      'assertAllowedRuntimeEndpoint',
    )).toBe(true);
  });

  it('recognizes executable calls inside template expressions but not template text', () => {
    expect(hasExecutableCall(
      'const note = `guard(candidate)`;',
      'guard',
    )).toBe(false);
    expect(hasExecutableCall(
      'const note = `result: $' + '{condition ? { value: guard(candidate) } : null}`;',
      'guard',
    )).toBe(true);
  });

  it('requires an executable guard before every network sink', () => {
    expect(guardPrecedesEverySink(
      `assertAllowedRuntimeEndpoint(url);\nawait fetchFn(url);`,
      'assertAllowedRuntimeEndpoint',
      /\bfetchFn\s*\(/u,
    )).toBe(true);
    expect(guardPrecedesEverySink(
      `await fetchFn(url);\nassertAllowedRuntimeEndpoint(url);`,
      'assertAllowedRuntimeEndpoint',
      /\bfetchFn\s*\(/u,
    )).toBe(false);
  });

  it('does not accept a stray or step-level false condition for an archived job', () => {
    const inspection = inspectArchivedWorkflowJobs(`
if: \${{ false }}
jobs:
  disabled:
    if: \${{ false }}
    runs-on: ubuntu-latest
  "bypassed":
    runs-on: ubuntu-latest
    steps:
      - if: \${{ false }}
        run: echo never
  inline: { runs-on: ubuntu-latest }
`);

    expect(inspection.jobNames).toEqual(['disabled', 'bypassed', 'inline']);
    expect(inspection.jobsWithoutHardDisable).toEqual(['bypassed', 'inline']);
  });

  it('recognizes commands only inside executable workflow run blocks', () => {
    const commands = parseWorkflowRunCommands(`
jobs:
  migrate:
    steps:
      - run: |
          # node scripts/validate-runtime-endpoint.mjs SUPABASE_DB_URL SUPABASE_PROJECT_REF
          echo mask
          node scripts/validate-runtime-endpoint.mjs SUPABASE_DB_URL SUPABASE_PROJECT_REF
    # run: node scripts/validate-runtime-endpoint.mjs SUPABASE_DB_URL SUPABASE_PROJECT_REF
`);

    expect(commands.map((command) => command.text)).toEqual([
      'echo mask',
      'node scripts/validate-runtime-endpoint.mjs SUPABASE_DB_URL SUPABASE_PROJECT_REF',
    ]);
  });

  it('does not accept commented archive tripwires as shell commands', () => {
    expect(shellExecutableLines(`
#!/usr/bin/env bash
# echo "ORAN_LEGACY_AZURE_PROVISIONING_ARCHIVED"
# exit 1
az account show
`)).toEqual(['az account show']);
  });
});
