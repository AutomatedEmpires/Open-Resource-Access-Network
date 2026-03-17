/**
 * Appeal a Denied Submission — Client Component
 *
 * Authenticated users can appeal a denied submission they own.
 * Shows a form to submit the appeal + a list of the user's existing appeals.
 * Wired to POST/GET /api/submissions/appeal.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Scale, Send, Loader2, CheckCircle2, ArrowLeft, Clock, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
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
  type: 'document' | 'screenshot' | 'provider_email' | 'public_notice' | 'other';
  description: string;
  fileUrl: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  submitted:              { color: 'border border-slate-200 bg-slate-50 text-slate-700', label: 'Submitted' },
  under_review:           { color: 'border border-slate-200 bg-slate-100 text-slate-900', label: 'Under Review' },
  needs_review:           { color: 'border border-slate-200 bg-slate-100 text-slate-900', label: 'Needs Review' },
  approved:               { color: 'border border-slate-300 bg-white text-slate-900', label: 'Approved' },
  denied:                 { color: 'border border-error-soft bg-error-muted text-error-deep', label: 'Denied' },
  returned:               { color: 'border border-slate-200 bg-slate-50 text-slate-700', label: 'Returned' },
  escalated:              { color: 'border border-slate-200 bg-slate-100 text-slate-900', label: 'Escalated' },
  pending_second_approval:{ color: 'border border-slate-200 bg-slate-100 text-slate-900', label: 'Pending 2nd Approval' },
  withdrawn:              { color: 'border border-slate-200 bg-slate-50 text-slate-600', label: 'Withdrawn' },
  expired:                { color: 'border border-slate-200 bg-slate-50 text-slate-500', label: 'Expired' },
  archived:               { color: 'border border-slate-200 bg-white text-slate-400', label: 'Archived' },
};

const EVIDENCE_TYPE_OPTIONS: Array<{ value: EvidenceItem['type']; label: string }> = [
  { value: 'document', label: 'Document' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'provider_email', label: 'Provider email' },
  { value: 'public_notice', label: 'Public notice' },
  { value: 'other', label: 'Other' },
];

// ============================================================
// PAGE
// ============================================================

function AppealPageInner() {
  const searchParams = useSearchParams();
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
  const [, setIsLoadingDenied] = useState(false);

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
      <main className="min-h-screen bg-white">
        <div className="container mx-auto max-w-3xl px-4 py-6 md:py-8">
        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
        <PageHeader
          eyebrow="Decision review"
          title="Appeal a Decision"
          icon={<Scale className="h-6 w-6" aria-hidden="true" />}
          subtitle="Submit an appeal for a denied submission to request reconsideration."
          badges={(
            <>
              <PageHeaderBadge tone="trust">Authenticated workflow</PageHeaderBadge>
              <PageHeaderBadge tone="accent">Evidence-based review</PageHeaderBadge>
            </>
          )}
        />
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-6 text-center shadow-sm">
          <Scale className="mx-auto mb-3 h-8 w-8 text-slate-500" aria-hidden="true" />
          <p className="mb-1 font-medium text-slate-900">Sign in required</p>
          <p className="mb-4 text-sm text-slate-600">
            You must be signed in to submit or view appeals.
          </p>
          <Link
            href="/auth/signin?callbackUrl=/appeal"
            className="inline-flex items-center gap-1.5 rounded-md bg-action-base px-4 py-2 text-sm font-medium text-white hover:bg-action-strong"
          >
            Sign in
          </Link>
        </div>
        </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-3xl px-4 py-6 md:py-8">
      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
      <div className="mb-4">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to profile
        </Link>
      </div>

      <PageHeader
        eyebrow="Decision review"
        title="Appeal a Decision"
        icon={<Scale className="h-6 w-6" aria-hidden="true" />}
        subtitle="Submit an appeal for a denied submission to request reconsideration."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Authenticated workflow</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Evidence-based review</PageHeaderBadge>
            <PageHeaderBadge>{myAppeals.length > 0 ? `${myAppeals.length} appeals on file` : 'No appeals on file'}</PageHeaderBadge>
          </>
        )}
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
          <FormSection
            title="Decision to review"
            description="Select the denied submission you want reviewed again, or paste the submission ID you were given."
          >
            {deniedSubmissions.length > 0 && (
              <FormField id="denied-picker" label="Select a denied submission" hint="Choose the submission you want to appeal">
                <select
                  id="denied-picker"
                  value={submissionId}
                  onChange={(e) => setSubmissionId(e.target.value)}
                  aria-label="Select a denied submission to appeal"
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
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

            <FormField
              id="submission-id"
              label="Submission ID"
              hint="The denied submission you are appealing"
              error={!isValidUuid && submissionId.trim().length > 0 ? 'Please enter a valid UUID format.' : undefined}
            >
              <input
                id="submission-id"
                type="text"
                value={submissionId}
                onChange={(e) => setSubmissionId(e.target.value)}
                disabled={!!prefilledId}
                required
                className={`w-full rounded-lg border px-3 py-2 text-sm ${
                    prefilledId ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300'
                } ${!isValidUuid && submissionId.trim().length > 0 ? 'border-error-accent ring-1 ring-error-accent' : ''}`}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </FormField>

            {deniedSubmissions.length === 0 && (
              <p className="text-xs text-slate-500">
                No denied submissions were found on your account. You can still paste a valid submission ID if support directed you to appeal manually.
              </p>
            )}
          </FormSection>

          <FormSection
            title="Appeal statement"
            description="Explain why the decision should be reconsidered and what a reviewer should verify."
          >
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
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Provide details about why this submission should be reconsidered..."
                maxLength={2000}
              />
            </FormField>
          </FormSection>

          <FormSection
            title="Supporting evidence"
            description="Optional documents, screenshots, or provider links can help a reviewer verify your appeal faster."
            action={
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
            }
          >
            {evidence.map((item, idx) => (
              <div key={idx} className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Evidence #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeEvidenceItem(idx)}
                    className="text-stone-400 hover:text-error-light"
                    aria-label={`Remove evidence ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <FormField id={`evidence-${idx}-description`} label={`Evidence ${idx + 1} description`} srOnlyLabel>
                  <input
                    aria-label={`Evidence ${idx + 1} description`}
                    type="text"
                    value={item.description}
                    onChange={(e) => updateEvidenceItem(idx, 'description', e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    placeholder="Description of this evidence"
                  />
                </FormField>
                <FormField id={`evidence-${idx}-type`} label={`Evidence ${idx + 1} type`} srOnlyLabel>
                  <select
                    aria-label={`Evidence ${idx + 1} type`}
                    value={item.type}
                    onChange={(e) => updateEvidenceItem(idx, 'type', e.target.value as EvidenceItem['type'])}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
                  >
                    {EVIDENCE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField id={`evidence-${idx}-url`} label={`Evidence ${idx + 1} URL`} srOnlyLabel>
                  <input
                    aria-label={`Evidence ${idx + 1} URL`}
                    type="url"
                    value={item.fileUrl}
                    onChange={(e) => updateEvidenceItem(idx, 'fileUrl', e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    placeholder="URL to document or screenshot (https://...)"
                  />
                </FormField>
              </div>
            ))}
          </FormSection>

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
        <div className="mb-8 rounded-[24px] border border-slate-200 bg-slate-50 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-slate-700" aria-hidden="true" />
          <p className="font-medium text-slate-900">Appeal submitted</p>
          <p className="mt-1 text-sm text-slate-500">You will be notified when your appeal is reviewed.</p>
        </div>
      )}

      <FormSection
        title="How appeals are reviewed"
        description="Appeals are reconsidered using the original submission, reviewer notes, and any supporting evidence you provide."
        className="mb-8"
      >
        <ul className="space-y-2 text-sm text-slate-600">
          <li>Use the appeal statement to explain what changed or what was missed.</li>
          <li>Attach only evidence that can be verified by the review team.</li>
          <li>Approval is not guaranteed and may require additional reviewer follow-up.</li>
        </ul>
      </FormSection>

      {/* My appeals */}
      <FormSection
        title="My Appeals"
        description="Track active and prior appeals from the same seeker account."
      >
        {isLoadingAppeals && (
          <p className="text-sm text-slate-400">Loading…</p>
        )}

        {!isLoadingAppeals && myAppeals.length === 0 && (
          <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-6 text-center text-slate-400">
            <Scale className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm">No appeals found.</p>
          </div>
        )}

        {myAppeals.length > 0 && (
          <div className="space-y-3">
            {myAppeals.map((a) => {
              const style = STATUS_STYLES[a.status] ?? { color: 'border border-slate-200 bg-slate-50 text-slate-700', label: a.status };
              return (
                <div key={a.id} className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{a.title ?? 'Appeal'}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Submitted {formatDate(a.created_at)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.color} shrink-0`}>
                      {style.label}
                    </span>
                  </div>
                  {a.notes && (
                    <p className="mt-2 text-sm text-slate-600">{a.notes}</p>
                  )}
                  {a.reviewer_notes && (
                    <div className="mt-2 text-sm">
                      <span className="font-medium text-slate-500">Reviewer: </span>
                      <span className="text-slate-700">{a.reviewer_notes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </FormSection>
      </section>
      </div>
    </main>
  );
}

export default function AppealPageContent() {
  return (
    <ErrorBoundary>
      <React.Suspense fallback={<div className="container mx-auto max-w-xl px-4 py-8 text-center text-slate-400">Loading…</div>}>
        <AppealPageInner />
      </React.Suspense>
    </ErrorBoundary>
  );
}
