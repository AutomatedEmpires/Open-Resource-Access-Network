/**
 * Domain constants and types for Queue Triage with Anomaly Prioritization (§3).
 *
 * The triage_priority score is a deterministic weighted sum of six signals.
 * Signal weights sum to 100. Each signal independently normalizes to [0, 1].
 *
 * ORAN non-negotiables preserved:
 *   - No PII stored in triage_explanations.
 *   - Crisis adjacency detected via service_attributes taxonomy only
 *     (no seeker message content exposed here).
 *   - Scoring is purely deterministic — no LLM participation in ranking.
 */

// ============================================================
// QUEUE TYPES
// ============================================================

export const QUEUE_TYPES = [
  'pending_verification',
  'upcoming_reverification',
  'disputes_appeals',
  'high_risk_feedback',
  'regression_alerts',
] as const;

export type QueueType = (typeof QUEUE_TYPES)[number];

export const QUEUE_TYPE_LABELS: Record<QueueType, string> = {
  pending_verification:    'Pending Verification',
  upcoming_reverification: 'Upcoming Re-Verification',
  disputes_appeals:        'Disputes & Appeals',
  high_risk_feedback:      'High-Risk Feedback',
  regression_alerts:       'Regression Alerts',
};

/** Submission types that belong to each queue. */
export const QUEUE_SUBMISSION_TYPES: Record<QueueType, string[]> = {
  pending_verification:    ['service_verification', 'new_service', 'org_claim'],
  upcoming_reverification: ['service_verification'],
  disputes_appeals:        ['appeal', 'data_correction'],
  high_risk_feedback:      ['community_report'],
  regression_alerts:       ['service_verification', 'data_correction'],
};

/** Statuses that indicate an item is still actionable in the queue. */
export const ACTIONABLE_STATUSES = [
  'submitted',
  'needs_review',
  'under_review',
  'escalated',
  'pending_second_approval',
] as const;

// ============================================================
// TRIAGE SIGNAL WEIGHTS (must sum to 100)
// ============================================================

/**
 * Weights for each triage signal (out of 100 total).
 *
 * Rationale:
 *   trust    (25) — Low confidence is the single largest risk factor.
 *   traffic  (20) — Many people rely on a broken/missing record.
 *   feedback (20) — Recent negative feedback is a direct distress signal.
 *   staleness(15) — Older records decay and mislead seekers.
 *   crisis   (10) — Crisis-adjacent services warrant extra urgency.
 *   sla      (10) — Breached / imminent SLA creates operational liability.
 */
export const TRIAGE_SIGNAL_WEIGHTS = {
  signal_trust:     25,
  signal_traffic:   20,
  signal_feedback:  20,
  signal_staleness: 15,
  signal_crisis:    10,
  signal_sla_breach: 10,
} as const satisfies Record<string, number>;

// ============================================================
// CRISIS-ADJACENT SITUATION TAGS
// ============================================================

/**
 * service_attributes tags (taxonomy='situation') that indicate crisis adjacency.
 * Presence of ANY of these tags adds a full crisis signal (1.0).
 *
 * Uses structural service metadata only — no seeker message content.
 */
export const CRISIS_ADJACENT_SITUATION_TAGS: readonly string[] = [
  'domestic_violence',
  'housing_crisis',
  'food_insecurity',
  'suicidal_ideation',
  'mental_health_crisis',
  'substance_crisis',
  'human_trafficking_risk',
  'emergency_shelter',
  'immediate_safety_risk',
] as const;

// ============================================================
// SCORING THRESHOLDS
// ============================================================

/** Saves count above which traffic signal is fully saturated. */
export const TRAFFIC_SATURATION_SAVES = 50;

/** Confidence score below which trust signal is fully saturated (low = bad). */
export const TRUST_CONCERN_THRESHOLD = 40;

/** Number of recent negative feedback items (rating ≤ 2) above which feedback signal is saturated. */
export const FEEDBACK_SATURATION_COUNT = 5;

/** Number of days since submission created_at above which staleness signal is fully saturated. */
export const STALENESS_DAYS_SATURATION = 30;

/** Priority level at or above which a submission is considered "high priority". */
export const HIGH_PRIORITY_THRESHOLD = 70;

/** Priority level at or above which a submission is considered "critical". */
export const CRITICAL_PRIORITY_THRESHOLD = 85;

// ============================================================
// TYPES
// ============================================================

export interface TriageSignals {
  signal_traffic:   number; // 0–1
  signal_trust:     number; // 0–1
  signal_feedback:  number; // 0–1
  signal_staleness: number; // 0–1
  signal_crisis:    number; // 0–1 (binary: 0 or 1)
  signal_sla_breach: number; // 0–1 (binary or stepped)
}

export interface TriageScore {
  id:                  string;
  submission_id:       string;
  triage_priority:     number; // 0–100
  signal_traffic:      number;
  signal_trust:        number;
  signal_feedback:     number;
  signal_staleness:    number;
  signal_crisis:       number;
  signal_sla_breach:   number;
  triage_explanations: string[];
  scored_at:           string;
}

export interface TriageQueueEntry {
  submission_id:       string;
  submission_type:     string;
  status:              string;
  title:               string | null;
  service_id:          string | null;
  service_name:        string | null;
  created_at:          string;
  sla_deadline:        string | null;
  sla_breached:        boolean;
  triage_priority:     number;
  triage_explanations: string[];
  scored_at:           string | null;
}

export interface TriageQueueSummary {
  queue_type:    QueueType;
  label:         string;
  total:         number;
  high_priority: number;
  critical:      number;
  avg_priority:  number | null;
}

// ============================================================
// PURE SCORING FUNCTION
// ============================================================

/**
 * Compute a deterministic triage_priority (0–100) from normalized signals.
 *
 * Pure function — no side effects, no I/O.
 * Each signal must be in [0, 1] range before calling.
 */
export function computeTriagePriority(signals: TriageSignals): number {
  const score =
    signals.signal_trust     * TRIAGE_SIGNAL_WEIGHTS.signal_trust +
    signals.signal_traffic   * TRIAGE_SIGNAL_WEIGHTS.signal_traffic +
    signals.signal_feedback  * TRIAGE_SIGNAL_WEIGHTS.signal_feedback +
    signals.signal_staleness * TRIAGE_SIGNAL_WEIGHTS.signal_staleness +
    signals.signal_crisis    * TRIAGE_SIGNAL_WEIGHTS.signal_crisis +
    signals.signal_sla_breach * TRIAGE_SIGNAL_WEIGHTS.signal_sla_breach;

  // Clamp to [0, 100] to guard against floating-point edge cases
  return Math.min(100, Math.max(0, Math.round(score * 100) / 100));
}

/**
 * Build human-readable explanation bullets from signals.
 * Returns at most 5 bullets describing the dominant factors.
 * No PII included.
 */
export function buildTriageExplanations(signals: TriageSignals): string[] {
  const bullets: Array<{ text: string; score: number }> = [];

  if (signals.signal_trust >= 0.8)
    bullets.push({ text: 'Very low confidence score', score: signals.signal_trust });
  else if (signals.signal_trust >= 0.5)
    bullets.push({ text: 'Below-average confidence score', score: signals.signal_trust });

  if (signals.signal_traffic >= 0.8)
    bullets.push({ text: 'High seeker traffic (many saves)', score: signals.signal_traffic });
  else if (signals.signal_traffic >= 0.4)
    bullets.push({ text: 'Elevated seeker traffic', score: signals.signal_traffic });

  if (signals.signal_feedback >= 0.8)
    bullets.push({ text: 'Multiple recent negative feedback reports', score: signals.signal_feedback });
  else if (signals.signal_feedback >= 0.4)
    bullets.push({ text: 'Recent negative feedback', score: signals.signal_feedback });

  if (signals.signal_staleness >= 0.8)
    bullets.push({ text: 'Submission is significantly overdue', score: signals.signal_staleness });
  else if (signals.signal_staleness >= 0.4)
    bullets.push({ text: 'Submission aging in queue', score: signals.signal_staleness });

  if (signals.signal_crisis >= 1)
    bullets.push({ text: 'Crisis-adjacent service category', score: signals.signal_crisis });

  if (signals.signal_sla_breach >= 1)
    bullets.push({ text: 'SLA breached', score: signals.signal_sla_breach });
  else if (signals.signal_sla_breach >= 0.7)
    bullets.push({ text: 'SLA deadline imminent', score: signals.signal_sla_breach });

  // Return top 5 by descending signal score
  return bullets
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((b) => b.text);
}
