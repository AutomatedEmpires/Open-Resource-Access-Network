'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';

interface ReportRow {
  id: string;
  status: string;
  title: string | null;
  notes: string | null;
  reviewer_notes: string | null;
  service_id: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  service_name: string | null;
  organization_name: string | null;
  integrity_hold_at: string | null;
  is_high_risk: boolean;
}

interface ReportResponse {
  results: ReportRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

const STATUS_TABS = [
  { value: '', label: 'Open' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
] as const;

export default function ReportsPageClient() {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = useCallback(async (nextStatus = statusFilter) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', limit: '20' });
      if (nextStatus) params.set('status', nextStatus);
      const res = await fetch(`/api/admin/reports?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as ReportResponse & { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to load reports');
      }
      setData(body as ReportResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchReports(statusFilter);
  }, [fetchReports, statusFilter]);

  const handleDecision = useCallback(async (reportId: string, decision: 'approved' | 'denied' | 'escalated') => {
    setPendingId(reportId);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, decision, notes: decisionNotes[reportId]?.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to update report');
      }
      setInfo(body?.message ?? 'Report updated successfully.');
      setExpandedId(null);
      await fetchReports(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update report');
    } finally {
      setPendingId(null);
    }
  }, [decisionNotes, fetchReports, statusFilter]);

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Trust And Safety Reports"
        icon={<ShieldAlert className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Review community complaints, confirm high-risk issues, and place listings on integrity hold when live seeker visibility would be unsafe."
        badges={(
          <>
            <PageHeaderBadge tone="trust">High-risk approvals can trigger integrity holds</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Reports remain evidence-backed review items</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} reports` : 'Loading reports'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void fetchReports(statusFilter)} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        )}
        className="mb-8"
      />

      {error && <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />}
      {info && <FormAlert variant="success" message={info} onDismiss={() => setInfo(null)} className="mb-6" />}

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Report status filters">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.value}
            className={`rounded-full px-4 py-2 text-sm font-medium ${statusFilter === tab.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {data?.results.map((row) => {
          const expanded = expandedId === row.id;
          const noteValue = decisionNotes[row.id] ?? row.reviewer_notes ?? '';
          return (
            <section key={row.id} className={`rounded-2xl border bg-[var(--bg-surface)] p-5 ${row.is_high_risk ? 'border-error-soft' : 'border-[var(--border)]'}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">{row.title ?? 'Community report'}</h2>
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{row.status.replace(/_/g, ' ')}</span>
                    {row.is_high_risk ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-error-subtle px-2.5 py-1 text-xs font-medium text-error-deep">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        high risk
                      </span>
                    ) : null}
                    {row.integrity_hold_at ? (
                      <span className="inline-flex rounded-full bg-error-subtle px-2.5 py-1 text-xs font-medium text-error-deep">integrity hold active</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{row.organization_name ?? 'Unknown organization'} • {row.service_name ?? 'Unknown service'} • {row.reason?.replace(/_/g, ' ') ?? 'unspecified reason'}</p>
                  <p className="text-sm text-[var(--text-muted)]">{row.notes}</p>
                  <p className="text-xs text-[var(--text-muted)]">Opened {new Date(row.created_at).toLocaleString()}.</p>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setExpandedId(expanded ? null : row.id)}>
                    {expanded ? 'Close' : 'Review'}
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 space-y-3 border-t border-[var(--border-subtle)] pt-4">
                  <label className="block text-sm font-medium text-[var(--text-secondary)]">
                    Decision notes
                    <textarea
                      rows={4}
                      value={noteValue}
                      onChange={(event) => setDecisionNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void handleDecision(row.id, 'approved')} disabled={pendingId === row.id}>
                      {pendingId === row.id ? 'Applying…' : 'Approve report'}
                    </Button>
                    <Button variant="outline" onClick={() => void handleDecision(row.id, 'escalated')} disabled={pendingId === row.id || noteValue.trim().length === 0}>
                      Escalate
                    </Button>
                    <Button variant="outline" onClick={() => void handleDecision(row.id, 'denied')} disabled={pendingId === row.id || noteValue.trim().length === 0}>
                      Deny report
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

        {data && data.results.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
            No reports matched the current filters.
          </div>
        ) : null}
      </div>
    </ErrorBoundary>
  );
}
