'use client';

import { useCallback, useEffect, useState } from 'react';

interface CurrentUserAssignment {
  id: string;
  status: 'pending' | 'claimed' | 'completed';
  outcome: string | null;
  expires_at: string | null;
}

interface CandidateDetail {
  candidate: {
    fields?: {
      organizationName?: string;
      serviceName?: string;
      description?: string;
      websiteUrl?: string;
    };
    review?: { status?: string };
  };
  currentUserAssignment: CurrentUserAssignment | null;
  assignmentProgress?: {
    completedReviewCount: number;
    openReviewCount: number;
    requiredMatchingReviewCount: number;
  };
}

interface CandidateApprovalPanelProps {
  candidateId: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}

function safeHttpUrl(input: string | undefined) {
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function controlledErrorMessage(status: number, body: unknown, fallback: string) {
  if (status === 400 || status === 404 || status === 409) {
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === 'string' && error.length <= 240) return error;
  }
  return fallback;
}

export function CandidateApprovalPanel({
  candidateId,
  onClose,
  onChanged,
}: CandidateApprovalPanelProps) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationDecision, setConfirmationDecision] = useState<'rejected' | 'escalated' | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ingestion/candidates/${candidateId}`, { signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(controlledErrorMessage(response.status, body, 'Unable to load this review.'));
      }
      setDetail(body as CandidateDetail);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Unable to load this review.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const submit = async (action: 'claim' | 'decide', decision?: 'approved' | 'rejected' | 'escalated') => {
    const assignment = detail?.currentUserAssignment;
    if (!assignment) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/ingestion/candidates/${candidateId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          assignmentId: assignment.id,
          ...(decision ? { decision, notes: notes.trim() || undefined } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(controlledErrorMessage(response.status, body, 'The review action could not be completed.'));
      }
      setNotice(action === 'claim' ? 'Review claimed.' : 'Decision recorded.');
      setNotes('');
      setConfirmationDecision(null);
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review action could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  const assignment = detail?.currentUserAssignment;
  const fields = detail?.candidate.fields;
  const sourceUrl = safeHttpUrl(fields?.websiteUrl);

  const requestDecision = (decision: 'approved' | 'rejected' | 'escalated') => {
    if (decision === 'approved') {
      void submit('decide', decision);
      return;
    }
    if (notes.trim().length < 20) {
      setError('Add a substantive note of at least 20 characters before rejecting or escalating.');
      return;
    }
    setError(null);
    setConfirmationDecision(decision);
  };

  return (
    <section
      className="rounded-2xl border border-sky-300 bg-gradient-to-br from-sky-50 via-white to-slate-100 p-5 shadow-lg shadow-sky-950/10"
      aria-labelledby="candidate-review-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Independent review</p>
          <h3 id="candidate-review-title" className="mt-1 text-lg font-semibold text-slate-950">
            {fields?.serviceName ?? 'Candidate review'}
          </h3>
          {fields?.organizationName && <p className="text-sm text-slate-600">{fields.organizationName}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-white"
        >
          Close
        </button>
      </div>

      {loading && <p className="mt-5 text-sm text-slate-600" role="status">Loading assigned review…</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950" role="status">{notice}</p>}

      {!loading && detail && (
        <div className="mt-5 space-y-4">
          {fields?.description && <p className="text-sm leading-6 text-slate-700">{fields.description}</p>}
          {sourceUrl && (
            <a className="block break-all text-sm font-medium text-sky-800 underline" href={sourceUrl} target="_blank" rel="noreferrer">
              Review source page
            </a>
          )}
          <p className="text-sm text-slate-600">
            Candidate status: <span className="font-semibold text-slate-900">{detail.candidate.review?.status ?? 'unknown'}</span>
          </p>
          {detail.assignmentProgress && (
            <p className="text-sm text-slate-600">
              Review progress: <span className="font-semibold text-slate-900">
                {detail.assignmentProgress.completedReviewCount} completed
              </span>{' '}
              · {detail.assignmentProgress.openReviewCount} open · {detail.assignmentProgress.requiredMatchingReviewCount} matching decisions required
            </p>
          )}

          {!assignment && (
            <p className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700">
              This candidate is not assigned to your reviewer profile.
            </p>
          )}

          {assignment?.status === 'pending' && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit('claim')}
              className="min-h-11 rounded-lg bg-gradient-to-r from-sky-700 to-blue-900 px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {submitting ? 'Claiming…' : 'Claim review'}
            </button>
          )}

          {assignment?.status === 'claimed' && (
            <div className="space-y-3">
              <label htmlFor="candidate-review-notes" className="block text-sm font-medium text-slate-800">
                Review notes <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea
                id="candidate-review-notes"
                value={notes}
                maxLength={4000}
                rows={4}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 focus:border-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              <p className="text-xs text-slate-500">
                Rejection or escalation requires a substantive note of at least 20 characters and confirmation.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={submitting} onClick={() => requestDecision('approved')} className="min-h-11 rounded-lg bg-gradient-to-r from-sky-700 to-blue-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
                  Approve
                </button>
                <button type="button" disabled={submitting} onClick={() => requestDecision('rejected')} className="min-h-11 rounded-lg border border-red-500 bg-white px-4 text-sm font-semibold text-red-800 disabled:opacity-50">
                  Reject
                </button>
                <button type="button" disabled={submitting} onClick={() => requestDecision('escalated')} className="min-h-11 rounded-lg border border-slate-400 bg-slate-100 px-4 text-sm font-semibold text-slate-800 disabled:opacity-50">
                  Escalate
                </button>
              </div>
              {confirmationDecision && (
                <div role="alertdialog" aria-labelledby="candidate-negative-confirmation" className="rounded-lg border border-amber-400 bg-amber-50 p-4">
                  <p id="candidate-negative-confirmation" className="text-sm font-semibold text-amber-950">
                    Confirm {confirmationDecision === 'rejected' ? 'rejection' : 'escalation'}
                  </p>
                  <p className="mt-1 text-sm text-amber-900">This signed decision becomes immutable review evidence.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={submitting} onClick={() => void submit('decide', confirmationDecision)} className="min-h-11 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
                      Confirm {confirmationDecision === 'rejected' ? 'rejection' : 'escalation'}
                    </button>
                    <button type="button" disabled={submitting} onClick={() => setConfirmationDecision(null)} className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 text-sm font-semibold text-amber-950 disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {assignment?.status === 'completed' && (
            <p className="rounded-lg border border-sky-300 bg-white p-3 text-sm text-slate-700">
              Your independent decision is complete{assignment.outcome ? `: ${assignment.outcome}` : '.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
