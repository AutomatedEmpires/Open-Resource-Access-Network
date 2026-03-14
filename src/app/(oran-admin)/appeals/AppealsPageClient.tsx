/**
 * /appeals — Appeal Review Queue
 *
 * ORAN admin view to review appeals on denied submissions.
 * Appeals that are approved re-open the original submission for re-review.
 * Wired to GET/POST /api/admin/appeals.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Scale, RefreshCw,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, RotateCcw,
  Clock, Filter, Loader2, FileText, ArrowRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { SubmissionStatus } from '@/domain/types';
import { formatDate, daysAgo } from '@/lib/format';

// ============================================================
// TYPES
// ============================================================

interface AppealRow {
  id: string;
  status: SubmissionStatus;
  title: string | null;
  notes: string | null;
  reviewer_notes: string | null;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  priority: number;
  original_submission_id: string | null;
  original_submission_type: string | null;
  created_at: string;
  updated_at: string;
  service_id: string | null;
}

interface AppealResponse {
  results: AppealRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 20;

const STATUS_TABS: { value: '' | SubmissionStatus; label: string }[] = [
  { value: '',             label: 'All' },
  { value: 'submitted',    label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'returned',     label: 'Returned' },
  { value: 'approved',     label: 'Approved' },
  { value: 'denied',       label: 'Denied' },
];

// ============================================================
// HELPERS
// ============================================================

function formatType(type: string | null): string {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 0) return null;
  const colors = priority >= 2 ? 'bg-error-subtle text-error-strong' : 'bg-orange-50 text-orange-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>
      P{priority}
    </span>
  );
}

// ============================================================
// PAGE
// ============================================================

function AppealsPageInner() {
  const [data, setData] = useState<AppealResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | SubmissionStatus>('');

  // Decision state
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
  const toast = useToast();

  // ── Fetch appeals ──
  const fetchAppeals = useCallback(async (p: number, status: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (status) params.set('status', status);

      const res = await fetch(`/api/admin/appeals?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load appeals');
      }
      const json = (await res.json()) as AppealResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load appeals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAppeals(1, statusFilter);
  }, [fetchAppeals, statusFilter]);

  // ── Submit decision ──
  const handleDecision = useCallback(async (appealId: string, decision: 'approved' | 'denied' | 'returned') => {
    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch('/api/admin/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appealId,
          decision,
          notes: decisionNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Decision failed');
      }
      const json = (await res.json()) as { message: string };
      setSubmitResult({ success: true, message: json.message });
      const labels: Record<string, string> = { approved: 'approved', denied: 'denied', returned: 'returned for more info' };
      toast.success(`Appeal ${labels[decision]} successfully`);
      setDecidingId(null);
      setDecisionNotes('');
      void fetchAppeals(page, statusFilter);
    } catch (e) {
      setSubmitResult({ success: false, message: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setIsSubmitting(false);
    }
  }, [decisionNotes, page, statusFilter, fetchAppeals, toast]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Appeal Review"
        icon={<Scale className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Review appeals on denied submissions. Approved appeals re-open the original record for re-review."
        badges={
          <>
            <PageHeaderBadge tone="trust">Appeals preserve review accountability</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Denied records can re-enter the queue</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} appeals` : 'Loading appeals'}</PageHeaderBadge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => void fetchAppeals(page, statusFilter)}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Result announcement */}
      {submitResult && (
        <div className="mb-4">
          <FormAlert
            variant={submitResult.success ? 'success' : 'error'}
            message={submitResult.message}
            onDismiss={() => setSubmitResult(null)}
          />
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="Filter by appeal status">
        <Filter className="h-4 w-4 text-gray-400 mr-1 shrink-0" aria-hidden="true" />
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={statusFilter === value}
            onClick={() => { setStatusFilter(value); setPage(1); }}
            className={`inline-flex min-h-[44px] items-center px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              statusFilter === value
                ? 'bg-info-muted text-action-deep'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {/* Loading state */}
      {isLoading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.results.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 text-center">
          <Scale className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No appeals found</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter
              ? `No appeals with status "${STATUS_TABS.find(({ value }) => value === statusFilter)?.label ?? statusFilter}".`
              : 'No pending appeals to review.'}
          </p>
        </div>
      )}

      {/* Appeals table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Appeals with submission metadata, original type, status, and review actions.</caption>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Appeal</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Original</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((row) => {
                  const age = daysAgo(row.created_at);
                  const isDeciding = decidingId === row.id;
                  const canDecide = ['submitted', 'under_review', 'returned'].includes(row.status);
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`hover:bg-gray-50 ${isDeciding ? 'bg-purple-50/50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-purple-400 shrink-0" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{row.title ?? 'Appeal'}</p>
                              <p className="text-xs text-gray-500 truncate">
                                ID: {row.id.slice(0, 8)}…
                                {row.priority > 0 && <PriorityBadge priority={row.priority} />}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-xs text-gray-600">
                            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>{formatType(row.original_submission_type)}</span>
                          </div>
                          {row.original_submission_id && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">
                              {row.original_submission_id.slice(0, 8)}…
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-gray-700">{formatDate(row.created_at)}</p>
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {age === 0 ? 'Today' : `${age}d ago`}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canDecide && !isDeciding && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDecidingId(row.id)}
                              className="gap-1"
                            >
                              Review
                            </Button>
                          )}
                          {isDeciding && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setDecidingId(null); setDecisionNotes(''); }}
                            >
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                      {/* Decision panel */}
                      {isDeciding && (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 bg-purple-50/30 border-t border-purple-100">
                            <div className="max-w-xl space-y-3">
                              {row.notes && (
                                <div className="text-sm">
                                  <span className="text-gray-500 font-medium">Appeal reason: </span>
                                  <span className="text-gray-700">{row.notes}</span>
                                </div>
                              )}
                              <FormField
                                id={`notes-${row.id}`}
                                label="Decision notes"
                                hint="Required for denial/return, optional for approval"
                                charCount={decisionNotes.length}
                                maxChars={5000}
                              >
                                <textarea
                                  value={decisionNotes}
                                  onChange={(e) => setDecisionNotes(e.target.value)}
                                  rows={2}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  placeholder="Reason for decision..."
                                  maxLength={5000}
                                />
                              </FormField>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => void handleDecision(row.id, 'approved')}
                                  disabled={isSubmitting}
                                  className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                                >
                                  {isSubmitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  Approve Appeal
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDecision(row.id, 'returned')}
                                  disabled={isSubmitting || !decisionNotes.trim()}
                                  className="gap-1 text-orange-600 border-orange-200 hover:bg-orange-50 disabled:opacity-50"
                                  title={!decisionNotes.trim() ? 'Notes are required when requesting more info' : undefined}
                                >
                                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                  Request More Info
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDecision(row.id, 'denied')}
                                  disabled={isSubmitting || !decisionNotes.trim()}
                                  className="gap-1 text-error-base border-error-soft hover:bg-error-subtle disabled:opacity-50"
                                  title={!decisionNotes.trim() ? 'Notes are required before denying an appeal' : undefined}
                                >
                                  <XCircle className="h-4 w-4" aria-hidden="true" />
                                  Deny Appeal
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <p className="text-gray-500">
            Page {page} of {totalPages} &middot; {data.total} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchAppeals(page - 1, statusFilter)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchAppeals(page + 1, statusFilter)}
              disabled={!data.hasMore || isLoading}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export default function AppealsPage() {
  return (
    <ErrorBoundary>
      <AppealsPageInner />
    </ErrorBoundary>
  );
}
