/**
 * Report a Service Listing — Client Component
 *
 * Allows any user (authenticated or anonymous) to report incorrect,
 * closed, or suspicious listing information.
 * Wired to POST /api/submissions/report.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Flag, Send, Loader2, CheckCircle2, ArrowLeft, Clock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, daysAgo } from '@/lib/format';
import type { SubmissionStatus } from '@/domain/types';

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
  }, [serviceId, reason, details, contactEmail]);

  const canSubmit = serviceId.trim().length > 0 && reason.length > 0 && details.trim().length >= 5;

  return (
    <main className="container mx-auto max-w-xl px-4 py-8">
      <div className="mb-4">
        <Link
          href={serviceId ? `/service/${serviceId}` : '/directory'}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to listing
        </Link>
      </div>

      <PageHeader
        title="Report a Listing"
        icon={<Flag className="h-6 w-6" aria-hidden="true" />}
        subtitle="Help keep service information accurate by reporting problems."
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

      {!serviceId && (
        <div
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-5"
        >
          <AlertTriangle className="inline h-4 w-4 mr-1.5 align-text-bottom" aria-hidden="true" />
          To report a specific listing, open the service page and click
          {' '}<span className="font-medium">Report a problem</span>.{' '}
          <Link href="/directory" className="underline hover:no-underline font-medium">
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
            href="/directory"
            className="inline-block mt-4 text-sm text-blue-600 hover:underline"
          >
            Return to directory
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Service ID */}
          <FormField id="service-id" label="Service ID" hint="The ID of the service listing to report">
            <input
              id="service-id"
              type="text"
              value={serviceId}
              disabled
              className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
          </FormField>

          {/* Reason */}
          <FormField id="reason" label="Reason for report">
            <select
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            >
              <option value="">Select a reason…</option>
              {REPORT_REASONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>

          {/* Details */}
          <FormField
            id="details"
            label="Details"
            hint="Please describe the issue in detail"
            charCount={details.length}
            maxChars={2000}
          >
            <textarea
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What is wrong with this listing?"
              maxLength={2000}
            />
          </FormField>

          {/* Contact email (optional) */}
          <FormField id="contact-email" label="Contact email (optional)" hint="We may follow up if we need more details">
            <input
              id="contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              placeholder="your@email.com"
            />
          </FormField>

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

      {/* ── My Reports ── */}
      {myReports.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Flag className="h-5 w-5 text-blue-500" aria-hidden="true" />
            My Reports
          </h2>
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
        </section>
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
