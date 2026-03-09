/**
 * Report a Service Listing — Client Component
 *
 * Allows any user (authenticated or anonymous) to report incorrect,
 * closed, or suspicious listing information.
 * Wired to POST /api/submissions/report.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Flag, Send, Loader2, CheckCircle2, ArrowLeft, Clock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, daysAgo } from '@/lib/format';
import type { SubmissionStatus } from '@/domain/types';
import { buildDiscoveryHref, parseDiscoveryUrlState } from '@/services/search/discovery';

// ============================================================
// TYPES
// ============================================================

interface ReportRow {
  id: string;
  status: SubmissionStatus;
  title: string | null;
  notes: string | null;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
  service_id: string | null;
  reason: string | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const REPORT_REASONS = [
  { value: 'incorrect_info',      label: 'Incorrect information' },
  { value: 'permanently_closed',  label: 'Permanently closed' },
  { value: 'temporarily_closed',  label: 'Temporarily closed' },
  { value: 'wrong_location',      label: 'Wrong location / address' },
  { value: 'wrong_phone',         label: 'Wrong phone number' },
  { value: 'wrong_hours',         label: 'Wrong hours of operation' },
  { value: 'wrong_eligibility',   label: 'Wrong eligibility requirements' },
  { value: 'suspected_fraud',     label: 'Suspected fraudulent listing' },
  { value: 'duplicate_listing',   label: 'Duplicate listing' },
  { value: 'other',               label: 'Other' },
] as const;

// ============================================================
// PAGE
// ============================================================

function ReportPageInner() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('serviceId') ?? '';
  const discoveryIntent = useMemo(() => parseDiscoveryUrlState(searchParams), [searchParams]);
  const directoryHref = useMemo(() => buildDiscoveryHref('/directory', discoveryIntent), [discoveryIntent]);
  const listingHref = useMemo(() => {
    if (!serviceId) return directoryHref;
    return buildDiscoveryHref(`/service/${serviceId}`, discoveryIntent);
  }, [directoryHref, discoveryIntent, serviceId]);

  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // My Reports state
  const [myReports, setMyReports] = useState<ReportRow[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  const fetchMyReports = useCallback(async () => {
    setIsLoadingReports(true);
    try {
      const res = await fetch('/api/submissions/report');
      if (res.ok) {
        const json = (await res.json()) as { reports: ReportRow[] };
        setMyReports(json.reports);
      }
    } catch {
      // Non-critical — fail silently
    } finally {
      setIsLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    void fetchMyReports();
  }, [fetchMyReports]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/submissions/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: serviceId.trim(),
          reason,
          details: details.trim(),
          contactEmail: contactEmail.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to submit report');
      }

      setResult({ success: true, message: 'Report submitted. Thank you for helping keep listings accurate.' });
      setReason('');
      setDetails('');
      setContactEmail('');
      void fetchMyReports();
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'An error occurred' });
    } finally {
      setIsSubmitting(false);
    }
  }, [serviceId, reason, details, contactEmail, fetchMyReports]);

  const canSubmit = serviceId.trim().length > 0 && reason.length > 0 && details.trim().length >= 5;

  return (
    <main className="container mx-auto max-w-xl px-4 py-8">
      <div className="mb-4">
        <Link
          href={listingHref}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to listing
        </Link>
      </div>

      <PageHeader
        eyebrow="Record quality"
        title="Report a Listing"
        icon={<Flag className="h-6 w-6" aria-hidden="true" />}
        subtitle="Help keep service information accurate by reporting problems."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Stored records only</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Reviewed by ORAN staff</PageHeaderBadge>
            <PageHeaderBadge>Quality feedback workflow</PageHeaderBadge>
            <PageHeaderBadge>Need a missing listing? Use Submit a Resource</PageHeaderBadge>
          </>
        )}
      />

      <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Missing a resource entirely?
        {' '}
        <Link href="/submit-resource?compose=listing" className="font-semibold underline hover:no-underline">
          Submit a new resource for review
        </Link>
        {' '}through the structured card workflow.
      </div>

      {result && (
        <div className="mb-4">
          <FormAlert
            variant={result.success ? 'success' : 'error'}
            message={result.message}
            onDismiss={() => setResult(null)}
          />
        </div>
      )}

      {!serviceId && (
        <div
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-5"
        >
          <AlertTriangle className="inline h-4 w-4 mr-1.5 align-text-bottom" aria-hidden="true" />
          To report a specific listing, open the service page and click
          {' '}<span className="font-medium">Report a problem</span>.{' '}
          <Link href={directoryHref} className="underline hover:no-underline font-medium">
            Browse the directory
          </Link>{' '}to find a service.
        </div>
      )}

      {result?.success ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-700 font-medium">Thank you for your report</p>
          <p className="text-sm text-gray-500 mt-1">Our team will review it and take appropriate action.</p>
          <Link
            href={directoryHref}
            className="inline-block mt-4 text-sm text-action-base hover:underline"
          >
            Return to directory
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection
            title="Report details"
            description="Tell us what is wrong with this listing so reviewers can verify and correct it quickly."
          >
            <FormField id="service-id" label="Service ID" hint="The ID of the service listing to report">
              <input
                id="service-id"
                type="text"
                value={serviceId}
                disabled
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
            </FormField>

            <FormField id="reason" label="Reason for report">
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
              >
                <option value="">Select a reason…</option>
                {REPORT_REASONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>

            <FormField
              id="details"
              label="Details"
              hint="Please describe the issue in detail. Include what changed or what a reviewer should verify."
              charCount={details.length}
              maxChars={2000}
            >
              <textarea
                id="details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                required
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                placeholder="What is wrong with this listing?"
                maxLength={2000}
              />
            </FormField>
          </FormSection>

          <FormSection
            title="Follow-up"
            description="Optional contact details let the team follow up if they need clarification."
          >
            <FormField id="contact-email" label="Contact email (optional)" hint="We may follow up if we need more details">
              <input
                id="contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                placeholder="your@email.com"
              />
            </FormField>
          </FormSection>

          {/* Submit */}
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
            Submit Report
          </Button>

          <p className="text-xs text-gray-400 text-center">
            Reports are reviewed by our team. Abuse of the reporting system may result in restrictions.
          </p>
        </form>
      )}

      <FormSection
        title="What happens next"
        description="Reports go into a reviewer queue so ORAN can verify record changes without inventing new facts."
        className="mt-8"
      >
        <ul className="space-y-2 text-sm text-gray-600">
          <li>Reviewers compare your note against stored provider data and evidence.</li>
          <li>Listings are corrected, flagged, or removed only after verification.</li>
          <li>Optional contact details are used only if clarification is needed.</li>
        </ul>
      </FormSection>

      {/* ── My Reports ── */}
      {myReports.length > 0 && (
        <FormSection
          title="My Reports"
          description="Track the review status of listings you flagged for correction."
          className="mt-10"
        >
          <div className="space-y-3">
            {myReports.map((r) => {
              const age = daysAgo(r.created_at);
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        {r.title ?? 'Report'}
                      </p>
                      {r.reason && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Reason: {r.reason.replace(/_/g, ' ')}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatDate(r.created_at)}
                        {age > 0 && ` (${age}d ago)`}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.reviewer_notes && (
                    <div className="mt-2 rounded bg-gray-50 p-2 text-sm text-gray-600">
                      <span className="font-medium text-gray-500">Reviewer: </span>
                      {r.reviewer_notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FormSection>
      )}

      {isLoadingReports && myReports.length === 0 && (
        <div className="mt-8 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your reports…
        </div>
      )}
    </main>
  );
}

export default function ReportPageContent() {
  return (
    <ErrorBoundary>
      <React.Suspense fallback={<div className="container mx-auto max-w-xl px-4 py-8 text-center text-gray-400">Loading…</div>}>
        <ReportPageInner />
      </React.Suspense>
    </ErrorBoundary>
  );
}
