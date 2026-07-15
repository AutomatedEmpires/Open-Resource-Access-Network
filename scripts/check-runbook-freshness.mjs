#!/usr/bin/env node

/**
 * ORAN Runbook Freshness Checker
 *
 * Validates lifecycle and review metadata for operational runbooks. Active and
 * rollback-only runbooks both remain governed and fail when their review is
 * overdue. A rollback-only document must also name its active replacement and
 * the event and deadline that end its rollback window, plus whether the
 * retained path has actually been validated.
 *
 * Usage:
 *   node scripts/check-runbook-freshness.mjs
 *   node scripts/check-runbook-freshness.mjs --json
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const RUNBOOK_RELATIVE_DIRS = [
  ['docs', 'ops', 'core'],
  ['docs', 'ops', 'services'],
  ['docs', 'ops', 'security'],
  ['docs', 'ops', 'dr'],
  ['docs', 'ops', 'monitoring'],
  ['docs', 'ops', 'data'],
];

const FIELD_PATTERNS = {
  owner: /^-\s+Owner role:\s*(.+?)\s*$/m,
  reviewers: /^-\s+Reviewers:\s*(.+?)\s*$/m,
  lifecycle: /^-\s+Operational status:\s*(active|rollback-only)\s*$/m,
  lastReviewed: /^-\s+Last reviewed \(UTC\):\s*(\d{4}-\d{2}-\d{2})\s*$/m,
  nextReview: /^-\s+Next review due \(UTC\):\s*(\d{4}-\d{2}-\d{2})\s*$/m,
  activeReplacement: /^-\s+Active replacement:\s*(.+?)\s*$/m,
  retirementTrigger: /^-\s+Retirement trigger:\s*(.+?)\s*$/m,
  validationStatus: /^-\s+Validation status:\s*(validated|code-aligned-unvalidated|unvalidated)\s*$/m,
  retirementDeadline: /^-\s+Retirement deadline \(UTC\):\s*(\d{4}-\d{2}-\d{2})\s*$/m,
};

const REQUIRED_FIELDS = ['owner', 'reviewers', 'lifecycle', 'lastReviewed', 'nextReview'];

function listRunbooks(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRunbooks(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith('RUNBOOK_') || !entry.name.endsWith('.md')) continue;
    files.push(full);
  }
  return files;
}

function utcDateOnly(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function parseStrictDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function readField(source, field) {
  return source.match(FIELD_PATTERNS[field])?.[1]?.trim() ?? null;
}

export function buildRunbookFreshnessReport({
  root = REPOSITORY_ROOT,
  now = new Date(),
  relativeDirs = RUNBOOK_RELATIVE_DIRS,
} = {}) {
  const today = utcDateOnly(now);
  const rows = [];

  for (const segments of relativeDirs) {
    const baseDir = join(root, ...segments);
    if (!statSync(baseDir, { throwIfNoEntry: false })?.isDirectory()) continue;

    for (const filePath of listRunbooks(baseDir)) {
      const source = readFileSync(filePath, 'utf8');
      const metadata = Object.fromEntries(
        Object.keys(FIELD_PATTERNS).map((field) => [field, readField(source, field)]),
      );
      const issues = [];

      for (const field of REQUIRED_FIELDS) {
        if (!metadata[field]) issues.push(`missing:${field}`);
      }

      const lastReviewedDate = metadata.lastReviewed
        ? parseStrictDate(metadata.lastReviewed)
        : null;
      const nextReviewDate = metadata.nextReview
        ? parseStrictDate(metadata.nextReview)
        : null;
      const retirementDeadlineDate = metadata.retirementDeadline
        ? parseStrictDate(metadata.retirementDeadline)
        : null;

      if (metadata.lastReviewed && !lastReviewedDate) issues.push('invalid:lastReviewed');
      if (metadata.nextReview && !nextReviewDate) issues.push('invalid:nextReview');
      if (metadata.retirementDeadline && !retirementDeadlineDate) {
        issues.push('invalid:retirementDeadline');
      }
      if (lastReviewedDate && lastReviewedDate > today) issues.push('invalid:lastReviewedInFuture');
      if (lastReviewedDate && nextReviewDate && nextReviewDate <= lastReviewedDate) {
        issues.push('invalid:reviewCadence');
      }

      if (metadata.lifecycle === 'rollback-only') {
        if (!metadata.activeReplacement) issues.push('missing:activeReplacement');
        if (!metadata.retirementTrigger) issues.push('missing:retirementTrigger');
        if (!metadata.validationStatus) issues.push('missing:validationStatus');
        if (!metadata.retirementDeadline) issues.push('missing:retirementDeadline');
        if (
          lastReviewedDate
          && retirementDeadlineDate
          && retirementDeadlineDate < lastReviewedDate
        ) {
          issues.push('invalid:retirementDeadlineBeforeReview');
        }
        if (retirementDeadlineDate && retirementDeadlineDate < today) {
          issues.push('invalid:retirementDeadlinePassed');
        }
      }

      const hasMissingMetadata = issues.some((issue) => issue.startsWith('missing:'));
      const hasInvalidMetadata = issues.some((issue) => issue.startsWith('invalid:'));
      const isOverdue = issues.length === 0 && nextReviewDate && nextReviewDate < today;
      const daysOverdue = isOverdue
        ? Math.floor((today.getTime() - nextReviewDate.getTime()) / 86_400_000)
        : 0;

      rows.push({
        file: relative(root, filePath).replaceAll('\\', '/'),
        lifecycle: metadata.lifecycle,
        lastReviewed: metadata.lastReviewed,
        due: metadata.nextReview,
        status: hasMissingMetadata
          ? 'MISSING_METADATA'
          : hasInvalidMetadata
            ? 'INVALID_METADATA'
            : isOverdue
              ? 'OVERDUE'
              : 'OK',
        daysOverdue,
        issues,
      });
    }
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));

  const summary = {
    scanned: rows.length,
    active: rows.filter((row) => row.lifecycle === 'active').length,
    rollbackOnly: rows.filter((row) => row.lifecycle === 'rollback-only').length,
    missingMetadata: rows.filter((row) => row.status === 'MISSING_METADATA').length,
    invalidMetadata: rows.filter((row) => row.status === 'INVALID_METADATA').length,
    overdue: rows.filter((row) => row.status === 'OVERDUE').length,
  };

  return {
    summary: {
      ...summary,
      passing:
        summary.missingMetadata === 0
        && summary.invalidMetadata === 0
        && summary.overdue === 0,
    },
    rows,
  };
}

export function formatRunbookFreshnessReport(report) {
  const lines = [
    'ORAN Runbook Freshness Report',
    '--------------------------------',
    `Scanned: ${report.summary.scanned}`,
    `Active: ${report.summary.active}`,
    `Rollback-only: ${report.summary.rollbackOnly}`,
    `Missing metadata: ${report.summary.missingMetadata}`,
    `Invalid metadata: ${report.summary.invalidMetadata}`,
    `Overdue: ${report.summary.overdue}`,
    '',
  ];

  for (const row of report.rows) {
    const lifecycle = row.lifecycle ?? 'unknown';
    if (row.status === 'OK') {
      lines.push(`OK       ${row.file} (${lifecycle}; due ${row.due})`);
      continue;
    }
    if (row.status === 'OVERDUE') {
      lines.push(
        `OVERDUE  ${row.file} (${lifecycle}; due ${row.due}, ${row.daysOverdue} day(s) overdue)`,
      );
      continue;
    }
    lines.push(`${row.status.padEnd(9)} ${row.file} (${row.issues.join(', ')})`);
  }

  if (!report.summary.passing) {
    lines.push('', 'Runbook freshness check failed.');
  }

  return lines.join('\n');
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  const report = buildRunbookFreshnessReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatRunbookFreshnessReport(report));
  }
  process.exitCode = report.summary.passing ? 0 : 1;
}
