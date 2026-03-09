/**
 * Centralized submission status display styles.
 *
 * Every admin/seeker page that renders a status badge should import from here
 * instead of defining its own STATUS_STYLES constant.
 */

export interface StatusStyle {
  /** Tailwind color classes (bg, text, ring). */
  color: string;
  /** Human-readable label for the status. */
  label: string;
}

/**
 * Visual styles + labels for each SubmissionStatus value.
 *
 * Labels use consistent vocabulary across all surfaces:
 *   submitted → "Submitted"  (not "Pending")
 *   under_review → "Under Review"  (not "In Review")
 */
export const SUBMISSION_STATUS_STYLES: Record<string, StatusStyle> = {
  draft:                    { color: 'bg-stone-100 text-stone-800 ring-stone-600/20',    label: 'Draft' },
  submitted:                { color: 'bg-amber-100 text-amber-800 ring-amber-600/20',    label: 'Submitted' },
  auto_checking:            { color: 'bg-cyan-100 text-cyan-800 ring-cyan-600/20',       label: 'Auto-Checking' },
  needs_review:             { color: 'bg-orange-100 text-orange-800 ring-orange-600/20', label: 'Needs Review' },
  under_review:             { color: 'bg-rose-100 text-rose-800 ring-rose-600/20',       label: 'Under Review' },
  approved:                 { color: 'bg-green-100 text-green-800 ring-green-600/20',    label: 'Approved' },
  denied:                   { color: 'bg-red-100 text-red-800 ring-red-600/20',          label: 'Denied' },
  escalated:                { color: 'bg-purple-100 text-purple-800 ring-purple-600/20', label: 'Escalated' },
  pending_second_approval:  { color: 'bg-indigo-100 text-indigo-800 ring-indigo-600/20', label: 'Pending Approval' },
  returned:                 { color: 'bg-yellow-100 text-yellow-800 ring-yellow-600/20', label: 'Returned' },
  withdrawn:                { color: 'bg-slate-100 text-slate-800 ring-slate-600/20',    label: 'Withdrawn' },
  expired:                  { color: 'bg-stone-100 text-stone-800 ring-stone-600/20',    label: 'Expired' },
  archived:                 { color: 'bg-zinc-100 text-zinc-800 ring-zinc-600/20',       label: 'Archived' },
};

/** Fallback style when a status value is unknown. */
export const DEFAULT_STATUS_STYLE: StatusStyle = {
  color: 'bg-stone-100 text-stone-800 ring-stone-600/20',
  label: 'Unknown',
};
