/**
 * Appeal a Denied Submission — Client Component
 *
 * Authenticated users can appeal a denied submission they own.
 * Shows a form to submit the appeal + a list of the user's existing appeals.
 * Wired to POST/GET /api/submissions/appeal.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Scale, Send, Loader2, CheckCircle2, ArrowLeft, Clock, FileText, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/PageHeader';
import type { SubmissionStatus } from '@/domain/types';
import { formatDate } from '@/lib/format';

// ============================================================
// TYPES
// ============================================================

interface AppealEntry {
  id: string;
  status: SubmissionStatus;
  title: string | null;
  notes: string | null;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DeniedSubmission {
  id: string;
  title: string | null;
  submission_type: string;
  created_at: string;
}

interface EvidenceItem {
  type: string;
  description: string;
  fileUrl: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  submitted:              { color: 'bg-amber-100 text-amber-800',   label: 'Submitted' },
  under_review:           { color: 'bg-info-muted text-action-deep',     label: 'Under Review' },
  needs_review:           { color: 'bg-info-muted text-action-deep',     label: 'Needs Review' },
  approved:               { color: 'bg-green-100 text-green-800',   label: 'Approved' },
  denied:                 { color: 'bg-error-muted text-error-deep',       label: 'Denied' },
  returned:               { color: 'bg-orange-100 text-orange-800', label: 'Returned' },
  escalated:              { color: 'bg-purple-100 text-purple-800', label: 'Escalated' },
  pending_second_approval:{ color: 'bg-indigo-100 text-indigo-800', label: 'Pending 2nd Approval' },
  withdrawn:              { color: 'bg-gray-100 text-gray-600',     label: 'Withdrawn' },
  expired:                { color: 'bg-gray-100 text-gray-500',     label: 'Expired' },
  archived:               { color: 'bg-gray-50 text-gray-400',      label: 'Archived' },
};

// ============================================================
// PAGE
// ============================================================

function AppealPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const prefilledId = searchParams.get('submissionId') ?? '';

  // Form state
  const [submissionId, setSubmissionId] = useState(prefilledId);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Denied submissions picker
  const [deniedSubmissions, setDeniedSubmissions] = useState<DeniedSubmission[]>([]);
  const [isLoadingDenied, setIsLoadingDenied] = useState(false);

  // My appeals list
  const [myAppeals, setMyAppeals] = useState<AppealEntry[]>([]);
  const [isLoadingAppeals, setIsLoadingAppeals] = useState(true);

  // UUID validation
  const isValidUuid = submissionId.trim().length === 0 || UUID_REGEX.test(submissionId.trim());

  const fetchDeniedSubmissions = useCallback(async () => {
    setIsLoadingDenied(true);
    try {
      const res = await fetch('/api/submissions/denied');
      if (!res.ok) return;
      const json = (await res.json()) as { submissions: DeniedSubmission[] };
      setDeniedSubmissions(json.submissions);
    } catch {
      // Best-effort
    } finally {
      setIsLoadingDenied(false);
    }
  }, []);

  const fetchAppeals = useCallback(async () => {
    setIsLoadingAppeals(true);
    try {
      const res = await fetch('/api/submissions/appeal');
      if (!res.ok) return;
      const json = (await res.json()) as { appeals: AppealEntry[] };
      setMyAppeals(json.appeals);
    } catch {
      // Best-effort
    } finally {
      setIsLoadingAppeals(false);
    }
  }, []);

  useEffect(() => { void fetchAppeals(); void fetchDeniedSubmissions(); }, [fetchAppeals, fetchDeniedSubmissions]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        submissionId: submissionId.trim(),
        reason: reason.trim(),
      };
      const validEvidence = evidence.filter((ev) => ev.description.trim() || ev.fileUrl.trim());
      if (validEvidence.length > 0) {
        payload.evidence = validEvidence;
      }

      const res = await fetch('/api/submissions/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to submit appeal');
      }

      setResult({ success: true, message: 'Appeal submitted successfully. You will be notified when it is reviewed.' });
      setReason('');
      setEvidence([]);
      void fetchAppeals();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'An error occurred' });
    } finally {
      setIsSubmitting(false);
    }
  }, [submissionId, reason, evidence, fetchAppeals]);

  const canSubmit = submissionId.trim().length > 0 && isValidUuid && reason.trim().length >= 10;

  const addEvidenceItem = useCallback(() => {
    if (evidence.length >= 10) return;
    setEvidence((prev) => [...prev, { type: 'document', description: '', fileUrl: '' }]);
  }, [evidence.length]);

  const removeEvidenceItem = useCallback((index: number) => {
    setEvidence((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEvidenceItem = useCallback((index: number, field: keyof EvidenceItem, value: string) => {
    setEvidence((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }, []);

  if (sessionStatus !== 'loading' && !session) {
    return (
      <main className="container mx-auto max-w-xl px-4 py-8">
        <PageHeader
          title="Appeal a Decision"
          icon={<Scale className="h-6 w-6" aria-hidden="true" />}
          subtitle="Submit an appeal for a denied submission to request reconsideration."
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <Scale className="h-8 w-8 text-amber-500 mx-auto mb-3" aria-hidden="true" />
          <p className="font-medium text-gray-900 mb-1">Sign in required</p>
          <p className="text-sm text-gray-600 mb-4">
            You must be signed in to submit or view appeals.
          </p>
          <Link
            href="/api/auth/signin"
            className="inline-flex items-center gap-1.5 rounded-md bg-action-base px-4 py-2 text-sm font-medium text-white hover:bg-action-strong"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-xl px-4 py-8">
      <div className="mb-4">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to profile
        </Link>
      </div>

      <PageHeader
        title="Appeal a Decision"
        icon={<Scale className="h-6 w-6" aria-hidden="true" />}
        subtitle="Submit an appeal for a denied submission to request reconsideration."
      />

      {result && (
        <div className="mb-4">
          <FormAlert
            variant={result.success ? 'success' : 'error'}
            message={result.message}
            onDismiss={() => setResult(null)}
          />
        </div>
      )}

      {/* Appeal form */}
      {!result?.success && (
        <form onSubmit={handleSubmit} className="space-y-5 mb-8">
          {/* Denied submissions picker */}
          {deniedSubmissions.length > 0 && (
            <FormField id="denied-picker" label="Select a denied submission" hint="Choose the submission you want to appeal">
              <select
                id="denied-picker"
                value={submissionId}
                onChange={(e) => setSubmissionId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
              >
                <option value="">Select a submission…</option>
                {deniedSubmissions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title ?? s.submission_type} — {formatDate(s.created_at)}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <FormField id="submission-id" label="Submission ID" hint="The denied submission you are appealing">
            <input
              id="submission-id"
              type="text"
              value={submissionId}
              onChange={(e) => setSubmissionId(e.target.value)}
              disabled={!!prefilledId}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                prefilledId ? 'border-gray-300 bg-gray-50 text-gray-500' : 'border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500'
              } ${!isValidUuid && submissionId.trim().length > 0 ? 'border-error-accent ring-1 ring-error-accent' : ''}`}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            {!isValidUuid && submissionId.trim().length > 0 && (
              <p className="text-xs text-error-base mt-1">Please enter a valid UUID format</p>
            )}
          </FormField>

          <FormField
            id="appeal-reason"
            label="Reason for appeal"
            hint="Explain why you believe the decision should be reconsidered (min. 10 characters)"
            charCount={reason.length}
            maxChars={2000}
          >
            <textarea
              id="appeal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Provide details about why this submission should be reconsidered..."
              maxLength={2000}
            />
          </FormField>

          {/* Evidence upload section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Supporting evidence (optional)</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEvidenceItem}
                disabled={evidence.length >= 10}
                className="gap-1 text-xs"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add evidence
              </Button>
            </div>
            {evidence.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Evidence #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeEvidenceItem(idx)}
                    className="text-gray-400 hover:text-error-light"
                    aria-label={`Remove evidence ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateEvidenceItem(idx, 'description', e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="Description of this evidence"
                />
                <input
                  type="url"
                  value={item.fileUrl}
                  onChange={(e) => updateEvidenceItem(idx, 'fileUrl', e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="URL to document or screenshot (https://...)"
                />
              </div>
            ))}
          </div>

          <Button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="w-full gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Submit Appeal
          </Button>
        </form>
      )}

      {result?.success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center mb-8">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-700 font-medium">Appeal submitted</p>
          <p className="text-sm text-gray-500 mt-1">You will be notified when your appeal is reviewed.</p>
        </div>
      )}

      {/* My appeals */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-gray-400" aria-hidden="true" />
          My Appeals
        </h2>

        {isLoadingAppeals && (
          <p className="text-sm text-gray-400">Loading…</p>
        )}

        {!isLoadingAppeals && myAppeals.length === 0 && (
          <div className="text-center p-6 text-gray-400 rounded-lg border border-gray-200">
            <Scale className="h-8 w-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
            <p className="text-sm">No appeals found.</p>
          </div>
        )}

        {myAppeals.length > 0 && (
          <div className="space-y-3">
            {myAppeals.map((a) => {
              const style = STATUS_STYLES[a.status] ?? { color: 'bg-gray-100 text-gray-700', label: a.status };
              return (
                <div key={a.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.title ?? 'Appeal'}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Submitted {formatDate(a.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.color} shrink-0`}>
                      {style.label}
                    </span>
                  </div>
                  {a.notes && (
                    <p className="text-sm text-gray-600 mt-2">{a.notes}</p>
                  )}
                  {a.reviewer_notes && (
                    <div className="mt-2 text-sm">
                      <span className="text-gray-500 font-medium">Reviewer: </span>
                      <span className="text-gray-700">{a.reviewer_notes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default function AppealPageContent() {
  return (
    <ErrorBoundary>
      <React.Suspense fallback={<div className="container mx-auto max-w-xl px-4 py-8 text-center text-gray-400">Loading…</div>}>
        <AppealPageInner />
      </React.Suspense>
    </ErrorBoundary>
  );
}
