#!/usr/bin/env node

/**
 * ORAN Runbook Freshness Checker
 *
 * Validates `Next review due (UTC): YYYY-MM-DD` metadata in operational runbooks.
 * Fails with exit code 1 when a runbook is overdue.
 *
 * Usage:
 *   node scripts/check-runbook-freshness.mjs
 *   node scripts/check-runbook-freshness.mjs --json
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const RUNBOOK_DIRS = [
  join(ROOT, 'docs', 'ops', 'core'),
  join(ROOT, 'docs', 'ops', 'services'),
  join(ROOT, 'docs', 'ops', 'security'),
  join(ROOT, 'docs', 'ops', 'dr'),
  join(ROOT, 'docs', 'ops', 'monitoring'),
];

const emitJson = process.argv.includes('--json');
const DUE_RE = /^-\s+Next review due \(UTC\):\s*(\d{4}-\d{2}-\d{2})\s*$/m;

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

function utcDateOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const today = utcDateOnly(new Date());
const rows = [];
let missingMetadata = 0;
let overdue = 0;

for (const baseDir of RUNBOOK_DIRS) {
  if (!statSync(baseDir, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const filePath of listRunbooks(baseDir)) {
    const rel = relative(ROOT, filePath);
    const src = readFileSync(filePath, 'utf8');
    const m = src.match(DUE_RE);

    if (!m) {
      missingMetadata++;
      rows.push({
        file: rel,
        due: null,
        status: 'MISSING_METADATA',
        daysOverdue: null,
      });
      continue;
    }

    const dueDate = new Date(`${m[1]}T00:00:00Z`);
    const days = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const isOverdue = days > 0;

    if (isOverdue) overdue++;

    rows.push({
      file: rel,
      due: m[1],
      status: isOverdue ? 'OVERDUE' : 'OK',
      daysOverdue: isOverdue ? days : 0,
    });
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file));

const summary = {
  scanned: rows.length,
  missingMetadata,
  overdue,
  passing: missingMetadata === 0 && overdue === 0,
};

if (emitJson) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log('ORAN Runbook Freshness Report');
  console.log('--------------------------------');
  console.log(`Scanned: ${summary.scanned}`);
  console.log(`Missing metadata: ${summary.missingMetadata}`);
  console.log(`Overdue: ${summary.overdue}`);
  console.log('');

  for (const row of rows) {
    if (row.status === 'OK') {
      console.log(`OK       ${row.file} (due ${row.due})`);
      continue;
    }
    if (row.status === 'OVERDUE') {
      console.log(`OVERDUE  ${row.file} (due ${row.due}, ${row.daysOverdue} day(s) overdue)`);
      continue;
    }
    console.log(`MISSING  ${row.file} (missing \`Next review due (UTC)\` metadata)`);
  }

  if (!summary.passing) {
    console.log('');
    console.log('Runbook freshness check failed.');
  }
}

process.exit(summary.passing ? 0 : 1);
