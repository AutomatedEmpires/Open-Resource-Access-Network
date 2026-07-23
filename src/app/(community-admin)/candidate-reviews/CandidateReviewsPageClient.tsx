'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, FileSearch, RefreshCw } from 'lucide-react';

// Dynamic SSR-off import (matching the SavedServiceComparison pattern) keeps
// the review panel out of shared first-load chunks.
const CandidateApprovalPanel = dynamic(
  () => import('@/components/admin/CandidateApprovalPanel')
    .then((module) => module.CandidateApprovalPanel),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';

interface CandidateReviewRow {
  candidate_id: string;
  assignment_status: 'pending' | 'claimed';
  expires_at: string | null;
  candidate_review_status: string;
  organization_name: string;
  service_name: string;
  description: string | null;
  website_url: string | null;
  jurisdiction_state: string | null;
  jurisdiction_county: string | null;
  jurisdiction_city: string | null;
  confidence_tier: string | null;
  confidence_score: number | null;
}

interface CandidateReviewResponse {
  results: CandidateReviewRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

const LIMIT = 20;

export default function CandidateReviewsPageClient() {
  const [rows, setRows] = useState<CandidateReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'open' | 'pending' | 'claimed'>('open');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        limit: String(LIMIT),
      });
      const response = await fetch(`/api/community/candidate-reviews?${params.toString()}`, { signal });
      if (!response.ok) throw new Error('Unable to load assigned candidate reviews.');
      const body = await response.json() as CandidateReviewResponse;
      setRows(body.results ?? []);
      setTotal(body.total ?? 0);
      setHasMore(Boolean(body.hasMore));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Unable to load assigned candidate reviews.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidate reviews"
        subtitle="Independently verify assigned resources before they can enter the live seeker catalog."
        icon={<FileSearch className="h-6 w-6" aria-hidden="true" />}
        badges={(
          <>
            <PageHeaderBadge tone="accent">{total} assigned</PageHeaderBadge>
            <PageHeaderBadge tone="neutral">Two matching decisions required</PageHeaderBadge>
          </>
        )}
      />

      <section className="rounded-2xl border border-sky-300 bg-gradient-to-r from-sky-700 via-blue-800 to-slate-900 p-5 text-white shadow-lg shadow-sky-950/15">
        <h2 className="text-lg font-semibold">Blind, independent review</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-sky-100">
          You will see your assignment and aggregate progress, never another reviewer&apos;s identity, notes, or decision.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Candidate review assignment status" className="flex flex-wrap gap-2">
          {(['open', 'pending', 'claimed'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              onClick={() => { setStatus(value); setPage(1); }}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold capitalize ${
                status === value
                  ? 'border-sky-800 bg-gradient-to-r from-sky-700 to-blue-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {loading && <SkeletonCard />}
      {error && <FormAlert variant="error" message={error} />}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-600">
          <FileSearch className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="font-medium">No {status === 'open' ? 'open' : status} candidate reviews are assigned to you.</p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const location = [row.jurisdiction_city, row.jurisdiction_county, row.jurisdiction_state]
              .filter(Boolean)
              .join(', ');
            return (
              <article key={row.candidate_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">{row.assignment_status}</p>
                    <h2 className="mt-1 text-lg font-semibold text-slate-950">{row.service_name}</h2>
                    <p className="text-sm text-slate-600">{row.organization_name}</p>
                  </div>
                  {row.confidence_tier && (
                    <span className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900">
                      {row.confidence_tier}
                    </span>
                  )}
                </div>
                {row.description && <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-700">{row.description}</p>}
                {location && <p className="mt-3 text-xs font-medium text-slate-500">{location}</p>}
                <Button className="mt-4 w-full" onClick={() => setSelectedCandidateId(row.candidate_id)}>
                  {row.assignment_status === 'claimed' ? 'Continue review' : 'Open review'}
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {selectedCandidateId && (
        <CandidateApprovalPanel
          candidateId={selectedCandidateId}
          onClose={() => setSelectedCandidateId(null)}
          onChanged={() => load()}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Page {page}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" disabled={!hasMore} onClick={() => setPage((value) => value + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
