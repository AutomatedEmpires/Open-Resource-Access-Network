/**
 * Ingestion Agent Admin — ORAN Admin surface for managing
 * ingestion sources, jobs, candidates, and pipeline execution.
 *
 * ORAN-admin only. Client-side data fetching to `/api/admin/ingestion/*`.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  FileSearch,
  Play,
  RefreshCw,
  Globe,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { formatDateSafe } from '@/lib/format';

// ============================================================
// Types
// ============================================================

interface Source {
  id: string;
  displayName: string;
  trustLevel: 'allowlisted' | 'quarantine' | 'blocked';
  domainRules: { type: string; value: string }[];
  createdAt: string;
  updatedAt: string;
}

interface Job {
  id: string;
  correlationId: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  seedUrls: string[];
  urlsDiscovered: number;
  urlsFetched: number;
  candidatesExtracted: number;
  errorsCount: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

interface Candidate {
  id: string;
  sourceUrl: string;
  reviewStatus: string;
  confidenceTier?: string;
  confidenceScore?: number;
  fields: Record<string, unknown>;
}

interface SourceDraft {
  displayName: string;
  trustLevel: Source['trustLevel'];
  domainValue: string;
  domainType: 'exact_host' | 'suffix';
  seedUrl: string;
}

const EMPTY_SOURCE_DRAFT: SourceDraft = {
  displayName: '',
  trustLevel: 'quarantine',
  domainValue: '',
  domainType: 'exact_host',
  seedUrl: '',
};

// ============================================================
// Constants
// ============================================================

const TABS = [
  { key: 'sources', label: 'Sources', icon: Globe },
  { key: 'jobs', label: 'Jobs', icon: Database },
  { key: 'candidates', label: 'Candidates', icon: FileSearch },
  { key: 'process', label: 'Process', icon: Play },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TRUST_STYLES: Record<string, string> = {
  allowlisted: 'bg-green-50 text-green-700 border-green-200',
  quarantine: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-error-subtle text-error-strong border-error-soft',
};

const JOB_STATUS_STYLES: Record<string, string> = {
  queued: 'bg-gray-50 text-gray-700 border-gray-200',
  running: 'bg-info-subtle text-action-strong border-action-soft',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-error-subtle text-error-strong border-error-soft',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
};

const CANDIDATE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-50 text-gray-700 border-gray-200',
  in_review: 'bg-info-subtle text-action-strong border-action-soft',
  verified: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-error-subtle text-error-strong border-error-soft',
  escalated: 'bg-amber-50 text-amber-700 border-amber-200',
  published: 'bg-purple-50 text-purple-700 border-purple-200',
  archived: 'bg-gray-50 text-gray-500 border-gray-200',
};

const TIER_STYLES: Record<string, string> = {
  green: 'bg-green-50 text-green-700 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  red: 'bg-error-subtle text-error-strong border-error-soft',
};

const LIMIT = 20;

// ============================================================
// Helpers
// ============================================================

function StatusBadge({ status, styles }: { status: string; styles: Record<string, string> }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        styles[status] ?? 'bg-gray-50 text-gray-600 border-gray-200'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ============================================================
// Sources Tab
// ============================================================

function SourcesTab() {
  const { success, error: showError } = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_SOURCE_DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ingestion/sources');
      if (!res.ok) throw new Error(`Failed to fetch sources (${res.status})`);
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sources');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleCreateSource = useCallback(async () => {
    const displayName = draft.displayName.trim();
    const domainValue = draft.domainValue.trim();
    const seedUrl = draft.seedUrl.trim();

    if (!displayName || !domainValue) {
      setError('Display name and at least one domain rule are required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ingestion/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          trustLevel: draft.trustLevel,
          domainRules: [{ type: draft.domainType, value: domainValue }],
          discovery: seedUrl
            ? [{ type: 'seeded_only', seedUrls: [seedUrl] }]
            : undefined,
        }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string; details?: unknown } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to create ingestion source');
      }

      setDraft(EMPTY_SOURCE_DRAFT);
      success('Ingestion source created.');
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create ingestion source';
      setError(message);
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, fetchSources, showError, success]);

  if (isLoading) return <SkeletonCard />;
  if (error) {
    return (
      <div className="space-y-3">
        <FormAlert variant="error" message={error} />
        <Button variant="outline" size="sm" onClick={fetchSources}>Retry</Button>
      </div>
    );
  }
  if (sources.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Globe className="mx-auto h-12 w-12 text-gray-300 mb-3" aria-hidden="true" />
        <p className="text-sm">No ingestion sources configured yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-900">Register ingestion source</p>
          <p className="mt-1 text-sm text-gray-600">
            Add the domain allowlist rule and optional seed URL that the ingestion pipeline should trust and crawl.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Display name" id="ingestion-source-display-name" required>
            <input
              type="text"
              value={draft.displayName}
              onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Trust level" id="ingestion-source-trust-level" required>
            <select
              value={draft.trustLevel}
              onChange={(event) => setDraft((current) => ({ ...current, trustLevel: event.target.value as Source['trustLevel'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="allowlisted">Allowlisted</option>
              <option value="quarantine">Quarantine</option>
              <option value="blocked">Blocked</option>
            </select>
          </FormField>
          <FormField label="Domain rule type" id="ingestion-source-domain-type" required>
            <select
              value={draft.domainType}
              onChange={(event) => setDraft((current) => ({ ...current, domainType: event.target.value as SourceDraft['domainType'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="exact_host">Exact host</option>
              <option value="suffix">Suffix</option>
            </select>
          </FormField>
          <FormField label="Domain value" id="ingestion-source-domain-value" required hint="Examples: 211.org or .gov">
            <input
              type="text"
              value={draft.domainValue}
              onChange={(event) => setDraft((current) => ({ ...current, domainValue: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <FormField label="Optional seed URL" id="ingestion-source-seed-url" hint="Used for seeded-only discovery when provided.">
            <input
              type="url"
              value={draft.seedUrl}
              onChange={(event) => setDraft((current) => ({ ...current, seedUrl: event.target.value }))}
              placeholder="https://example.org/resources"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <div className="flex items-end">
            <Button type="button" onClick={() => void handleCreateSource()} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create source
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{sources.length} source{sources.length !== 1 ? 's' : ''}</p>
        <Button variant="outline" size="sm" onClick={fetchSources}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Refresh
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <caption className="sr-only">Ingestion sources</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Trust</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Domains</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {sources.map((src) => (
              <tr key={src.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{src.displayName}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={src.trustLevel} styles={TRUST_STYLES} />
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {src.domainRules.map((r) => r.value).join(', ')}
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDateSafe(src.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Jobs Tab
// ============================================================

function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/ingestion/jobs?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch jobs (${res.status})`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleCancelJob = useCallback(async (jobId: string) => {
    setCancellingId(jobId);
    try {
      const res = await fetch(`/api/admin/ingestion/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Cancel failed');
      }
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel job');
    } finally {
      setCancellingId(null);
    }
  }, [fetchJobs]);

  const statusFilters = ['', 'queued', 'running', 'completed', 'failed', 'cancelled'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="Filter jobs by status">
          {statusFilters.map((s) => (
            <button
              key={s || 'all'}
              role="tab"
              aria-selected={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={fetchJobs}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Refresh
        </Button>
      </div>

      {isLoading && <SkeletonCard />}
      {error && <FormAlert variant="error" message={error} className="mb-4" />}
      {!isLoading && !error && jobs.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Database className="mx-auto h-12 w-12 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-sm">No jobs found.</p>
        </div>
      )}
      {!isLoading && !error && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <caption className="sr-only">Ingestion jobs</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">URLs</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Candidates</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Errors</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Queued</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Duration</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {jobs.map((job) => {
                const durationMs =
                  job.startedAt && job.completedAt
                    ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
                    : null;
                return (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{job.jobType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} styles={JOB_STATUS_STYLES} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{job.urlsFetched}/{job.urlsDiscovered}</td>
                    <td className="px-4 py-3 text-gray-600">{job.candidatesExtracted}</td>
                    <td className="px-4 py-3">
                      {job.errorsCount > 0 ? (
                        <span className="text-error-base font-medium">{job.errorsCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateSafe(job.queuedAt)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(job.status === 'queued' || job.status === 'running') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-error-base border-error-soft hover:bg-error-subtle"
                          disabled={cancellingId === job.id}
                          onClick={() => void handleCancelJob(job.id)}
                        >
                          {cancellingId === job.id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Candidates Tab
// ============================================================

function CandidatesTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');

  const fetchCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (statusFilter) params.set('status', statusFilter);
      if (tierFilter) params.set('tier', tierFilter);
      const res = await fetch(`/api/admin/ingestion/candidates?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch candidates (${res.status})`);
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates');
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter, tierFilter]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  const statuses = ['', 'pending', 'in_review', 'verified', 'rejected', 'escalated', 'published'];
  const tiers = ['', 'green', 'yellow', 'orange', 'red'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1" role="tablist" aria-label="Filter by review status">
            {statuses.map((s) => (
              <button
                key={s || 'all'}
                role="tab"
                aria-selected={statusFilter === s}
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s ? s.replace(/_/g, ' ') : 'All'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" role="tablist" aria-label="Filter by confidence tier">
            {tiers.map((t) => (
              <button
                key={t || 'all-tier'}
                role="tab"
                aria-selected={tierFilter === t}
                onClick={() => { setTierFilter(t); setPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  tierFilter === t
                    ? 'bg-gray-900 text-white'
                    : t
                      ? TIER_STYLES[t]?.replace('border-', 'border border-') ?? 'bg-gray-100 text-gray-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t || 'Any tier'}
              </button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchCandidates}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Refresh
        </Button>
      </div>

      {isLoading && <SkeletonCard />}
      {error && <FormAlert variant="error" message={error} className="mb-4" />}
      {!isLoading && !error && candidates.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <FileSearch className="mx-auto h-12 w-12 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-sm">No candidates found.</p>
        </div>
      )}
      {!isLoading && !error && candidates.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <caption className="sr-only">Ingestion candidates</caption>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Source URL</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Tier</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 max-w-sm truncate" title={c.sourceUrl}>
                      {c.sourceUrl}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.reviewStatus} styles={CANDIDATE_STATUS_STYLES} />
                    </td>
                    <td className="px-4 py-3">
                      {c.confidenceTier && <StatusBadge status={c.confidenceTier} styles={TIER_STYLES} />}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      {c.confidenceScore !== undefined ? c.confidenceScore.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Page {page}</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={candidates.length < LIMIT}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Process Tab
// ============================================================

function ProcessTab() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [batchUrls, setBatchUrls] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!sourceUrl.trim()) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/ingestion/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: sourceUrl.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setSourceUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBatch = async () => {
    const urls = batchUrls
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length === 0) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/ingestion/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setBatchUrls('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePollFeeds = async () => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/ingestion/feeds/poll', { method: 'POST' });
      if (!res.ok) throw new Error(`Feed poll failed (${res.status})`);
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feed poll failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Single URL processing */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Process Single URL</h3>
        <p className="text-xs text-gray-500 mb-3">
          Run the full ingestion pipeline for a URL: fetch → extract → verify → score → build candidate.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.org/services"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent"
            disabled={isProcessing}
            aria-label="Source URL to process"
          />
          <Button onClick={handleProcess} disabled={isProcessing || !sourceUrl.trim()}>
            {isProcessing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            Process
          </Button>
        </div>
      </div>

      {/* Batch processing */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Batch Process</h3>
        <p className="text-xs text-gray-500 mb-3">One URL per line (max 100).</p>
        <textarea
          value={batchUrls}
          onChange={(e) => setBatchUrls(e.target.value)}
          placeholder={'https://example.org/food\nhttps://example.org/shelter\nhttps://example.org/health'}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent"
          disabled={isProcessing}
          rows={4}
          aria-label="URLs to batch process"
        />
        <Button className="mt-2" onClick={handleBatch} disabled={isProcessing || !batchUrls.trim()}>
          {isProcessing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUpDown className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Run Batch
        </Button>
      </div>

      {/* Feed polling */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Poll Feeds</h3>
        <p className="text-xs text-gray-500 mb-3">
          Trigger polling for all active feed subscriptions that are due.
        </p>
        <Button variant="outline" onClick={handlePollFeeds} disabled={isProcessing}>
          {isProcessing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Poll Now
        </Button>
      </div>

      {/* Result / Error */}
      {error && <FormAlert variant="error" message={error} className="mb-4" />}
      {result && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
            <p className="text-sm font-medium text-green-800">Operation completed</p>
          </div>
          <pre className="text-xs text-green-700 bg-green-100 rounded p-3 overflow-x-auto max-h-64">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

function IngestionPageInner() {
  const [activeTab, setActiveTab] = useState<TabKey>('sources');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ORAN Admin"
        title="Ingestion Agent"
        icon={<Database className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Manage sources, monitor jobs, review candidates, and trigger pipeline processing."
        badges={
          <>
            <PageHeaderBadge tone="trust">Ingestion stays source-aware and review-gated</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Active section: {TABS.find((tab) => tab.key === activeTab)?.label}</PageHeaderBadge>
            <PageHeaderBadge>Pipeline operations remain operator-controlled</PageHeaderBadge>
          </>
        }
      />

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-gray-200 pb-px" role="tablist" aria-label="Ingestion sections">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            id={`tab-${key}`}
            aria-selected={activeTab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? 'border-action-base text-action-base bg-info-subtle/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === 'sources' && <SourcesTab />}
        {activeTab === 'jobs' && <JobsTab />}
        {activeTab === 'candidates' && <CandidatesTab />}
        {activeTab === 'process' && <ProcessTab />}
      </div>
    </div>
  );
}

export default function IngestionPage() {
  return (
    <ErrorBoundary>
      <IngestionPageInner />
    </ErrorBoundary>
  );
}
