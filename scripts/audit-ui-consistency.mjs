#!/usr/bin/env node
/**
 * ORAN UI Consistency Drift Detector
 *
 * Scans src/app/**\/*.tsx for three categories of drift:
 *   1. Raw <button elements (hard error without Button import; advisory with Button import)
 *   2. Hardcoded ad-hoc colour utilities (bg-*, text-*, border-*, outline-* in
 *      blue/red scales) instead of semantic tokens from globals.css @theme inline
 *   3. <input elements without an associated label or aria-label
 *
 * Output: Markdown summary to stdout (append to $GITHUB_STEP_SUMMARY in CI).
 *
 * Usage:
 *   node scripts/audit-ui-consistency.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_APP = join(ROOT, 'src', 'app');

// ── File walker ──────────────────────────────────────────────────────────────

/** @returns {string[]} Absolute paths of all .tsx files under dir */
function walkTsx(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsx(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

// ── Detectors ────────────────────────────────────────────────────────────────

/**
 * DRIFT-1: Raw <button usage.
 *
 * - Without Button import → hard error (must migrate to <Button>).
 * - With Button import    → advisory warning (toggle chips / map controls are OK;
 *   confirm/submit actions should use <Button>).
 *
 * @param {string} src File content
 * @returns {string[]} Diagnostic messages (empty = clean)
 */
function detectRawButtons(src) {
  const hasRawButton = /<button[\s>]/.test(src);
  if (!hasRawButton) return [];

  const matches = [...src.matchAll(/<button[\s>]/g)];
  const hasSharedImport = /@\/components\/ui\/button/.test(src);

  if (hasSharedImport) {
    return [
      `${matches.length} raw \`<button\` element(s) alongside \`Button\` import — ` +
      `verify usage is intentional (toggle chips / map controls are OK; confirm/submit actions should use \`<Button>\`)`,
    ];
  }

  return [`${matches.length} raw \`<button\` element(s) — import \`Button\` from \`@/components/ui/button\``];
}

/**
 * DRIFT-2: Hardcoded ad-hoc color utilities.
 * Flags bg-blue-* / bg-red-* (arbitrary intensity, including arbitrary values)
 * that appear in className strings.
 *
 * The approved palette uses semantic CSS vars (--bg-*, --color-*) or specific
 * brand colours defined in the design token system.  Plain bg-blue-600 /
 * bg-red-600 etc. in app-level pages (not ui primitives) indicate drift.
 *
 * Exceptions: files under src/components/ui/ are excluded (they ARE the primitive layer).
 *
 * @param {string} src File content
 * @param {string} filePath Absolute path (used for exclusion check)
/**
 * DRIFT-2: Hardcoded ad-hoc color utilities.
 *
 * Flags raw Tailwind palette classes for bg / text / border / outline / ring
 * in both the red and blue scales.  The approved design token system exposes
 * semantic aliases (e.g. bg-error-base, text-action-strong) generated from
 * CSS custom properties in globals.css `@theme inline`.
 *
 * Exceptions: files under src/components/ui/ are excluded (they ARE the
 * primitive layer and define the canonical token usage).
 *
 * @param {string} src File content
 * @param {string} filePath Absolute path (used for exclusion check)
 * @returns {string[]} Diagnostic messages
 */
function detectAdHocColors(src, filePath) {
  // Skip the shared primitives themselves
  if (filePath.includes(`src${sep}components${sep}ui${sep}`)) return [];

  // Match raw palette classes anywhere in the file (className props, template
  // literals, cn() calls, string constants, etc.).
  const colorRe = /\b((?:bg|text|border|outline|ring)-(?:blue|red)-\d{1,3})\b/g;
  const found = new Set();
  for (const m of src.matchAll(colorRe)) {
    found.add(m[1]);
  }

  if (found.size === 0) return [];

  return [
    `Ad-hoc colour utilities found: ${[...found].map(c => `\`${c}\``).join(', ')} — ` +
    `replace with semantic tokens (see \`src/app/globals.css\` \`@theme inline\` block)`,
  ];
}

/**
 * DRIFT-3: <input elements without an accessible label.
 * Flags <input that:
 *   - are not type="hidden"
 *   - do not have an aria-label or aria-labelledby attribute
 *   - are not immediately wrapped by (or inside) a <FormField> or <label> within 3 lines
 *
 * This is a heuristic — it may have false negatives for remote label associations.
 *
 * @param {string} src File content
 * @returns {string[]} Diagnostic messages
 */
function detectUnlabelledInputs(src) {
  const lines = src.split('\n');
  const msgs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/<input[\s/]/.test(line)) continue;

    // Skip hidden inputs
    if (/type=["']hidden["']/.test(line)) continue;

    // Check the input line and 2 lines before/after for label/aria coverage
    const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');

    const hasAriaLabel    = /aria-label(?:ledby)?=/.test(window);
    const hasFormField    = /<FormField[\s>]/.test(window);
    const hasLabelElement = /<label[\s>]/.test(window);

    if (!hasAriaLabel && !hasFormField && !hasLabelElement) {
      msgs.push(`Line ${i + 1}: \`<input\` may lack an accessible label (no \`aria-label\`, \`<FormField>\`, or \`<label>\` found nearby)`);
    }
  }
  return msgs;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const files = walkTsx(SRC_APP);

/** @type {{ file: string; issues: string[] }[]} */
const driftEntries = [];

for (const abs of files) {
  // global-error.tsx uses inline styles by design (root layout may be unavailable)
  if (abs.endsWith('global-error.tsx')) continue;
  // Skip test files — they intentionally use raw HTML elements
  if (abs.includes(`${sep}__tests__${sep}`)) continue;

  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }

  const issues = [
    ...detectRawButtons(src),
    ...detectAdHocColors(src, abs),
    ...detectUnlabelledInputs(src),
  ];

  if (issues.length > 0) {
    driftEntries.push({ file: relative(ROOT, abs), issues });
  }
}

// ── Markdown output ──────────────────────────────────────────────────────────

const totalIssues = driftEntries.reduce((n, e) => n + e.issues.length, 0);
const timestamp   = new Date().toISOString();

const lines = [
  `## ORAN UI Consistency Drift Report`,
  ``,
  `> Generated: ${timestamp}`,
  `> Scanned: \`src/app/**/*.tsx\` (${files.length} files)`,
  ``,
  totalIssues === 0
    ? `**✅ No drift detected.**`
    : `**⚠️  ${totalIssues} issue(s) found across ${driftEntries.length} file(s).**`,
  ``,
];

if (driftEntries.length > 0) {
  lines.push(`### Findings`, ``);
  for (const { file, issues } of driftEntries) {
    lines.push(`#### \`${file}\``);
    for (const issue of issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  lines.push(
    `### Remediation guide`,
    ``,
    `| Category | Fix |`,
    `|----------|-----|`,
    `| Raw \`<button\` (no import) | Replace with \`<Button>\` from \`@/components/ui/button\` |`,
    `| Raw \`<button\` (with import) | Confirm toggle/map-control usage is intentional; migrate confirm/submit to \`<Button>\` |`,
    `| Ad-hoc \`bg-*\` / \`text-*\` / \`border-*\` | Use semantic tokens from \`globals.css\` \`@theme inline\` (e.g. \`bg-error-base\`, \`text-action-strong\`, \`border-error-soft\`) |`,
    `| Unlabelled \`<input\` | Wrap in \`<FormField label="…">\` or add \`aria-label="…"\` |`,
    ``,
  );
}

console.log(lines.join('\n'));

// Exit 0 always — this is a reporting-only tool (non-blocking in v1)
process.exit(0);
