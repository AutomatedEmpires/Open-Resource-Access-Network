import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRunbookFreshnessReport,
  formatRunbookFreshnessReport,
  REPOSITORY_ROOT,
} from '../../../scripts/check-runbook-freshness.mjs';

const temporaryRoots: string[] = [];

async function createFixtureRunbook(name: string, metadata: string) {
  const root = await mkdtemp(join(tmpdir(), 'oran-runbook-check-'));
  temporaryRoots.push(root);
  const directory = join(root, 'docs', 'ops', 'core');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `RUNBOOK_${name}.md`),
    `# Fixture runbook\n\n## Metadata\n\n${metadata}\n`,
    'utf8',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('check-runbook-freshness', () => {
  it('resolves the repository root as a usable native path', () => {
    expect(isAbsolute(REPOSITORY_ROOT)).toBe(true);
    expect(existsSync(join(REPOSITORY_ROOT, 'docs', 'ops'))).toBe(true);

    const report = buildRunbookFreshnessReport({
      now: new Date('2026-07-13T12:00:00.000Z'),
    });
    expect(report.summary.scanned).toBeGreaterThan(0);
  });

  it('accepts complete active lifecycle metadata', async () => {
    const root = await createFixtureRunbook(
      'ACTIVE',
      [
        '- Owner role: Platform On-Call Lead',
        '- Reviewers: Security Lead',
        '- Operational status: active',
        '- Last reviewed (UTC): 2026-07-13',
        '- Next review due (UTC): 2026-10-13',
      ].join('\n'),
    );

    const report = buildRunbookFreshnessReport({
      root,
      now: new Date('2026-07-13T12:00:00.000Z'),
    });

    expect(report.summary).toMatchObject({
      scanned: 1,
      active: 1,
      rollbackOnly: 0,
      missingMetadata: 0,
      invalidMetadata: 0,
      overdue: 0,
      passing: true,
    });
    expect(report.rows[0]).toMatchObject({ status: 'OK', lifecycle: 'active' });
  });

  it('keeps rollback-only runbooks governed and requires retirement metadata', async () => {
    const root = await createFixtureRunbook(
      'ROLLBACK',
      [
        '- Owner role: Platform On-Call Lead',
        '- Reviewers: Security Lead',
        '- Operational status: rollback-only',
        '- Last reviewed (UTC): 2026-07-13',
        '- Next review due (UTC): 2026-10-13',
      ].join('\n'),
    );

    const report = buildRunbookFreshnessReport({
      root,
      now: new Date('2026-07-13T12:00:00.000Z'),
    });

    expect(report.summary.passing).toBe(false);
    expect(report.rows[0]).toMatchObject({
      status: 'MISSING_METADATA',
      lifecycle: 'rollback-only',
      issues: ['missing:activeReplacement', 'missing:retirementTrigger'],
    });
  });

  it('fails closed for invalid dates and an impossible review cadence', async () => {
    const root = await createFixtureRunbook(
      'INVALID_DATE',
      [
        '- Owner role: Platform On-Call Lead',
        '- Reviewers: Security Lead',
        '- Operational status: active',
        '- Last reviewed (UTC): 2026-07-13',
        '- Next review due (UTC): 2026-02-31',
      ].join('\n'),
    );

    const report = buildRunbookFreshnessReport({
      root,
      now: new Date('2026-07-13T12:00:00.000Z'),
    });

    expect(report.summary.invalidMetadata).toBe(1);
    expect(report.rows[0].status).toBe('INVALID_METADATA');
    expect(report.rows[0].issues).toContain('invalid:nextReview');
  });

  it('reports overdue active and rollback-only runbooks without exemptions', async () => {
    const root = await createFixtureRunbook(
      'OVERDUE',
      [
        '- Owner role: Platform On-Call Lead',
        '- Reviewers: Security Lead',
        '- Operational status: rollback-only',
        '- Last reviewed (UTC): 2026-01-01',
        '- Next review due (UTC): 2026-04-01',
        '- Active replacement: `docs/ops/services/RUNBOOK_CURRENT.md`',
        '- Retirement trigger: Remove after the rollback window closes.',
      ].join('\n'),
    );

    const report = buildRunbookFreshnessReport({
      root,
      now: new Date('2026-07-13T12:00:00.000Z'),
    });

    expect(report.summary).toMatchObject({ rollbackOnly: 1, overdue: 1, passing: false });
    expect(report.rows[0]).toMatchObject({ status: 'OVERDUE', daysOverdue: 103 });
    expect(formatRunbookFreshnessReport(report)).toContain('rollback-only; due 2026-04-01');
  });
});
