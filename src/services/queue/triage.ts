/**
 * Queue Triage — Deterministic Priority Scoring
 *
 * Computes a `triage_priority` score (0–100) and `triage_tier`
 * (`urgent` / `high` / `normal` / `low`) for each queue entry,
 * plus a human-readable `triage_explanations` array so the UI
 * can show "Why prioritized".
 *
 * Design constraints (ORAN non-negotiables):
 * - Pure function: no I/O, no external calls.
 * - Fully deterministic: same input → same output every time.
 * - No LLM involvement in ranking decisions.
 */

// ============================================================
// TYPES
// ============================================================

export type TriageTier = 'urgent' | 'high' | 'normal' | 'low';

export interface TriageInput {
  /** DB-stored priority field (0–100); higher = more important. */
  dbPriority: number;
  /** ISO timestamp the entry was created. */
  createdAt: string;
  /** Current submission status. */
  status: string;
  /** ISO deadline for SLA compliance; null when no SLA is set. */
  slaDeadline: string | null;
  /** True when the SLA has already been breached. */
  slaBreached: boolean;
  /**
   * Optional override: wall-clock "now" in milliseconds since epoch.
   * Defaults to `Date.now()` when omitted. Useful for testing.
   */
  nowMs?: number;
}

export interface TriageResult {
  /** Normalised priority score in [0, 100]. */
  score: number;
  /** Coarse tier label derived from `score`. */
  tier: TriageTier;
  /** Short human-readable reasons listed highest-weight first. */
  explanations: string[];
}

// ============================================================
// THRESHOLDS (exported so tests can reference them)
// ============================================================

export const TRIAGE_TIER_THRESHOLDS = {
  URGENT: 75,
  HIGH: 50,
  NORMAL: 25,
} as const;

// Signal weights (max contribution to the 0–100 scale)
const WEIGHT_SLA_BREACHED      = 80; // breached SLA is always urgent on its own
const WEIGHT_SLA_CRITICAL      = 25; // < 24 h
const WEIGHT_SLA_WARNING       = 15; // < 72 h
const WEIGHT_ESCALATED_STATUS  = 30;
const WEIGHT_DB_PRIORITY       = 20; // scaled: dbPriority/100 * 20
const WEIGHT_STALENESS_HIGH    = 10; // > 14 days
const WEIGHT_STALENESS_MED     =  5; // > 7 days

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY  = 24 * MS_PER_HOUR;

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Compute deterministic triage priority for a single queue entry.
 *
 * @example
 * const result = computeTriagePriority({
 *   dbPriority: 50,
 *   createdAt: '2024-01-01T00:00:00Z',
 *   status: 'escalated',
 *   slaDeadline: null,
 *   slaBreached: false,
 * });
 * // result.tier === 'high'
 */
export function computeTriagePriority(input: TriageInput): TriageResult {
  const now = input.nowMs ?? Date.now();
  const explanations: string[] = [];
  let raw = 0;

  // ── Signal: SLA breached ──────────────────────────────────
  if (input.slaBreached) {
    raw += WEIGHT_SLA_BREACHED;
    explanations.push('SLA has been breached');
  }
  // ── Signal: SLA approaching ──────────────────────────────
  else if (input.slaDeadline) {
    const msUntilDeadline = new Date(input.slaDeadline).getTime() - now;
    if (msUntilDeadline < 24 * MS_PER_HOUR) {
      raw += WEIGHT_SLA_CRITICAL;
      explanations.push('SLA deadline within 24 hours');
    } else if (msUntilDeadline < 72 * MS_PER_HOUR) {
      raw += WEIGHT_SLA_WARNING;
      explanations.push('SLA deadline within 72 hours');
    }
  }

  // ── Signal: escalated status ─────────────────────────────
  if (input.status === 'escalated') {
    raw += WEIGHT_ESCALATED_STATUS;
    explanations.push('Submission has been escalated');
  }

  // ── Signal: time in queue (staleness) ────────────────────
  const ageMs = now - new Date(input.createdAt).getTime();
  const ageDays = ageMs / MS_PER_DAY;
  if (ageDays > 14) {
    raw += WEIGHT_STALENESS_HIGH;
    explanations.push(`In queue for ${Math.floor(ageDays)} days`);
  } else if (ageDays > 7) {
    raw += WEIGHT_STALENESS_MED;
    explanations.push(`In queue for ${Math.floor(ageDays)} days`);
  }

  // ── Signal: existing DB priority ─────────────────────────
  const safeDbPriority = Number.isFinite(input.dbPriority) ? input.dbPriority : 0;
  const dbContribution = Math.round((Math.max(0, Math.min(100, safeDbPriority)) / 100) * WEIGHT_DB_PRIORITY);
  raw += dbContribution;
  if (dbContribution >= 10) {
    explanations.push('High base priority');
  }

  // Clamp to [0, 100]
  const score = Math.min(100, Math.max(0, raw));

  const tier = scoreToTier(score);

  return { score, tier, explanations };
}

/**
 * Map a numeric priority score to a human-readable tier label.
 * Exported for use in sorted-list comparators and UI constants.
 */
export function scoreToTier(score: number): TriageTier {
  if (score >= TRIAGE_TIER_THRESHOLDS.URGENT) return 'urgent';
  if (score >= TRIAGE_TIER_THRESHOLDS.HIGH)   return 'high';
  if (score >= TRIAGE_TIER_THRESHOLDS.NORMAL) return 'normal';
  return 'low';
}
