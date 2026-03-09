/**
 * /approvals — Claim Approvals
 *
 * ORAN admin view to approve or deny organization ownership claims.
 * Enhanced with FormField, FormAlert, toast notifications.
 * Lists submission entries with approve/deny actions.
 * Wired to GET/POST /api/admin/approvals.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, RefreshCw, AlertTriangle,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Building2, Clock, ExternalLink, Mail, Filter, Loader2,
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

interface ClaimRow {
  id: string;
  service_id: string;
  status: SubmissionStatus;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  service_name: string;
  organization_id: string;
  organization_name: string;
  organization_url: string | null;
  organization_email: string | null;
}

interface ClaimResponse {
  results: ClaimRow[];
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
  { value: 'approved',     label: 'Approved' },
  { value: 'denied',       label: 'Denied' },
];

// ============================================================
// PAGE
// ============================================================

function ApprovalsPageInner() {
  const [data, setData] = useState<ClaimResponse | null>(null);
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

  // ── Fetch claims ──
  const fetchClaims = useCallback(async (p: number, status: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (status) params.set('status', status);

      const res = await fetch(`/api/admin/approvals?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load claims');
      }
      const json = (await res.json()) as ClaimResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load claims');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClaims(1, statusFilter);
  }, [fetchClaims, statusFilter]);

  // ── Submit decision ──
  const handleDecision = useCallback(async (submissionId: string, decision: 'approved' | 'denied') => {
    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch('/api/admin/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
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
      toast.success(`Claim ${decision === 'approved' ? 'approved' : 'denied'} successfully`);
      setDecidingId(null);
      setDecisionNotes('');
      void fetchClaims(page, statusFilter);
    } catch (e) {
      setSubmitResult({ success: false, message: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setIsSubmitting(false);
    }
  }, [decisionNotes, page, statusFilter, fetchClaims, toast]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Claim Approvals"
        icon={<ShieldCheck className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Final review and approve or deny organization ownership claims across the platform."
        badges={
          <>
            <PageHeaderBadge tone="trust">Ownership decisions affect workspace control</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Platform-wide verification gate</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} claims` : 'Loading claims'}</PageHeaderBadge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => void fetchClaims(page, statusFilter)}
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
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="Filter by claim status">
        <Filter className="h-4 w-4 text-gray-400 mr-1 shrink-0" aria-hidden="true" />
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={statusFilter === value}
            onClick={() => { setStatusFilter(value); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
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
        <div className="flex items-center gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 mb-4 text-sm text-error-strong" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
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
          <ShieldCheck className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No claims found</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter
              ? `No claims with status "${STATUS_TABS.find(({ value }) => value === statusFilter)?.label ?? statusFilter}".`
              : 'No pending organization claims.'}
          </p>
        </div>
      )}

      {/* Claims table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Organization claim approvals with submission metadata, status, and review actions.</caption>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Organization</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((row) => {
                  const age = daysAgo(row.created_at);
                  const isDeciding = decidingId === row.id;
                  const canDecide = ['submitted', 'under_review'].includes(row.status);
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`hover:bg-gray-50 ${isDeciding ? 'bg-info-subtle/50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{row.organization_name}</p>
                              <p className="text-xs text-gray-500 truncate">{row.service_name}</p>
                            </div>
                          </div>
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
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {row.organization_url && (
                              <a
                                href={row.organization_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-action-base hover:underline text-xs inline-flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                Website
                              </a>
                            )}
                            {row.organization_email && (
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Mail className="h-3 w-3" aria-hidden="true" />
                                {row.organization_email}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canDecide && !isDeciding && (
                            <div className="flex justify-end gap-2">
                              <Link href={`/approvals/${row.id}`}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1"
                                >
                                  Card review
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDecidingId(row.id)}
                                className="gap-1"
                              >
                                Quick action
                              </Button>
                            </div>
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
                          <td colSpan={5} className="px-4 py-4 bg-info-subtle/30 border-t border-info-muted">
                            <div className="max-w-xl space-y-3">
                              {row.notes && (
                                <div className="text-sm">
                                  <span className="text-gray-500 font-medium">Claim notes: </span>
                                  <span className="text-gray-700">{row.notes}</span>
                                </div>
                              )}
                              <FormField
                                id={`notes-${row.id}`}
                                label="Decision notes"
                                hint="Required for denial, optional for approval"
                                charCount={decisionNotes.length}
                                maxChars={5000}
                              >
                                <textarea
                                  value={decisionNotes}
                                  onChange={(e) => setDecisionNotes(e.target.value)}
                                  rows={2}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
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
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleDecision(row.id, 'denied')}
                                  disabled={isSubmitting || !decisionNotes.trim()}
                                  className="gap-1 text-error-base border-error-soft hover:bg-error-subtle disabled:opacity-50"
                                  title={!decisionNotes.trim() ? 'Notes are required before denying a claim' : undefined}
                                >
                                  <XCircle className="h-4 w-4" aria-hidden="true" />
                                  Deny
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
              onClick={() => void fetchClaims(page - 1, statusFilter)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchClaims(page + 1, statusFilter)}
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

export default function ApprovalsPage() {
  return (
    <ErrorBoundary>
      <ApprovalsPageInner />
    </ErrorBoundary>
  );
}
