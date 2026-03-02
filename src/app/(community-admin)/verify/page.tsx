/**
 * /verify — Record Verification (deep-review)
 *
 * Full service detail view + decision form (verify / reject / escalate).
 * Accessed via /verify?id=<queueEntryId>.
 * Wired to GET /api/community/queue/[id] + PUT /api/community/queue/[id].
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ShieldCheck, ShieldX, AlertTriangle, ExternalLink,
  MapPin, Phone, Mail, Globe, Building2, FileText, Clock,
  CheckCircle2, XCircle, ArrowUpCircle, Loader2,
  Languages, ClipboardList, Accessibility, Tag,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Skeleton } from '@/components/ui/skeleton';
import type { VerificationStatus } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface LocationDetail {
  id: string;
  name: string | null;
  address_1: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PhoneDetail {
  id: string;
  number: string;
  type: string | null;
  description: string | null;
}

interface ConfidenceDetail {
  score: number;
  verification_confidence: number;
  eligibility_match: number;
  constraint_fit: number;
  computed_at: string;
}

interface EligibilityDetail {
  id: string;
  description: string;
  minimum_age: number | null;
  maximum_age: number | null;
  eligible_values: string[] | null;
}

interface RequiredDocDetail {
  id: string;
  document: string;
  type: string | null;
  uri: string | null;
}

interface LanguageDetail {
  id: string;
  language: string;
  note: string | null;
}

interface AccessibilityDetail {
  id: string;
  accessibility: string;
  details: string | null;
}

interface QueueDetail {
  id: string;
  service_id: string;
  status: VerificationStatus;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  service_name: string;
  service_description: string | null;
  service_url: string | null;
  service_email: string | null;
  service_status: string;
  organization_id: string;
  organization_name: string;
  organization_url: string | null;
  organization_email: string | null;
  organization_description: string | null;
  locations: LocationDetail[];
  phones: PhoneDetail[];
  confidenceScore: ConfidenceDetail | null;
  eligibility: EligibilityDetail[];
  required_documents: RequiredDocDetail[];
  languages: LanguageDetail[];
  accessibility: AccessibilityDetail[];
}

type Decision = 'verified' | 'rejected' | 'escalated';

// ============================================================
// CONSTANTS
// ============================================================

const STATUS_STYLES: Record<VerificationStatus, { color: string; label: string }> = {
  pending:   { color: 'bg-amber-100 text-amber-800 ring-amber-600/20',   label: 'Pending' },
  in_review: { color: 'bg-blue-100 text-blue-800 ring-blue-600/20',      label: 'In Review' },
  verified:  { color: 'bg-green-100 text-green-800 ring-green-600/20',   label: 'Verified' },
  rejected:  { color: 'bg-red-100 text-red-800 ring-red-600/20',         label: 'Rejected' },
  escalated: { color: 'bg-purple-100 text-purple-800 ring-purple-600/20', label: 'Escalated' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Safe hostname extraction — returns the raw URL string if parsing fails. */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="font-medium">{value}/100</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// COMPONENT
// ============================================================

export default function VerifyPage() {
  const searchParams = useSearchParams();
  const entryId = searchParams.get('id');

  const [entry, setEntry] = useState<QueueDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision form
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── Fetch detail ──
  const fetchDetail = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/queue/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load entry');
      }
      const json = (await res.json()) as QueueDetail;
      setEntry(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entry');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (entryId) {
      void fetchDetail(entryId);
    } else {
      setIsLoading(false);
    }
  }, [entryId, fetchDetail]);

  // ── Submit decision ──
  const handleSubmit = useCallback(async () => {
    if (!entryId || !decision) return;
    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch(`/api/community/queue/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          notes: notes.trim() || undefined,
          reviewerUserId: 'current-user', // Placeholder — replaced by auth
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Decision submission failed');
      }
      const body = (await res.json()) as { message: string };
      setSubmitResult({ success: true, message: body.message });
      // Refresh the entry to show updated status
      void fetchDetail(entryId);
    } catch (e) {
      setSubmitResult({ success: false, message: e instanceof Error ? e.message : 'Submission failed' });
    } finally {
      setIsSubmitting(false);
    }
  }, [entryId, decision, notes, fetchDetail]);

  const canDecide = entry && ['pending', 'in_review'].includes(entry.status);

  // ── No ID provided ──
  if (!entryId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
        <p className="text-gray-500 font-medium">No entry selected</p>
        <p className="text-gray-400 text-sm mt-1">
          Select an entry from the{' '}
          <Link href="/queue" className="text-blue-600 hover:underline">
            verification queue
          </Link>
          {' '}to begin review.
        </p>
      </div>
    );
  }

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-red-400 mb-3" aria-hidden="true" />
        <p className="text-gray-700 font-medium">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void fetchDetail(entryId)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!entry) return null;

  const statusStyle = STATUS_STYLES[entry.status];

  return (
    <ErrorBoundary>
      {/* Back link + header */}
      <div className="mb-6">
        <Link href="/queue" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Queue
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600" aria-hidden="true" />
              {entry.service_name}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {entry.organization_name}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${statusStyle.color}`}
          >
            {statusStyle.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Service detail */}
        <div className="lg:col-span-2 space-y-6">
          {/* Service info */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Service Details</h2>
            <dl className="space-y-3">
              {entry.service_description && (
                <div>
                  <dt className="text-xs font-medium text-gray-500">Description</dt>
                  <dd className="mt-0.5 text-sm text-gray-800">{entry.service_description}</dd>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {entry.service_url && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 flex items-center gap-1">
                      <Globe className="h-3 w-3" aria-hidden="true" /> Website
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      <a
                        href={entry.service_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        {safeHostname(entry.service_url)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                )}
                {entry.service_email && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 flex items-center gap-1">
                      <Mail className="h-3 w-3" aria-hidden="true" /> Email
                    </dt>
                    <dd className="mt-0.5 text-sm text-gray-800">{entry.service_email}</dd>
                  </div>
                )}
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Service Status</dt>
                <dd className="mt-0.5 text-sm text-gray-800 capitalize">{entry.service_status}</dd>
              </div>
            </dl>
          </section>

          {/* Organization info */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Organization
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-gray-500">Name</dt>
                <dd className="mt-0.5 text-sm text-gray-800">{entry.organization_name}</dd>
              </div>
              {entry.organization_description && (
                <div>
                  <dt className="text-xs font-medium text-gray-500">Description</dt>
                  <dd className="mt-0.5 text-sm text-gray-800">{entry.organization_description}</dd>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {entry.organization_url && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 flex items-center gap-1">
                      <Globe className="h-3 w-3" aria-hidden="true" /> Website
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      <a
                        href={entry.organization_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        {safeHostname(entry.organization_url)}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                )}
                {entry.organization_email && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 flex items-center gap-1">
                      <Mail className="h-3 w-3" aria-hidden="true" /> Email
                    </dt>
                    <dd className="mt-0.5 text-sm text-gray-800">{entry.organization_email}</dd>
                  </div>
                )}
              </div>
            </dl>
          </section>

          {/* Locations */}
          {entry.locations.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Locations ({entry.locations.length})
              </h2>
              <div className="space-y-3">
                {entry.locations.map((loc) => (
                  <div key={loc.id} className="border border-gray-100 rounded-md p-3">
                    {loc.name && <p className="text-sm font-medium text-gray-800">{loc.name}</p>}
                    {(loc.address_1 || loc.city) && (
                      <p className="text-sm text-gray-600 mt-0.5">
                        {[loc.address_1, loc.city, loc.state_province, loc.postal_code]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    )}
                    {loc.latitude != null && loc.longitude != null && (
                      <p className="text-xs text-gray-400 mt-1">
                        Approx. coords: {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Phones */}
          {entry.phones.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Phone className="h-4 w-4" aria-hidden="true" />
                Phone Numbers ({entry.phones.length})
              </h2>
              <div className="space-y-2">
                {entry.phones.map((ph) => (
                  <div key={ph.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-800 font-medium">{ph.number}</span>
                    <span className="text-gray-500 text-xs capitalize">
                      {ph.type ?? 'voice'}{ph.description ? ` — ${ph.description}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Eligibility criteria */}
          {entry.eligibility.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                Eligibility Criteria ({entry.eligibility.length})
              </h2>
              <div className="space-y-3">
                {entry.eligibility.map((e) => (
                  <div key={e.id} className="border border-gray-100 rounded-md p-3">
                    <p className="text-sm text-gray-800">{e.description}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {e.minimum_age != null && (
                        <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          Min age: {e.minimum_age}
                        </span>
                      )}
                      {e.maximum_age != null && (
                        <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          Max age: {e.maximum_age}
                        </span>
                      )}
                      {e.eligible_values?.map((v) => (
                        <span
                          key={v}
                          className="inline-flex items-center rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Required documents */}
          {entry.required_documents.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <FileText className="h-4 w-4" aria-hidden="true" />
                Required Documents ({entry.required_documents.length})
              </h2>
              <div className="space-y-2">
                {entry.required_documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-md p-3">
                    <div>
                      <p className="text-gray-800 font-medium">{doc.document}</p>
                      {doc.type && (
                        <span className="text-xs text-gray-500 capitalize">{doc.type}</span>
                      )}
                    </div>
                    {doc.uri && (
                      <a
                        href={doc.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1"
                      >
                        View <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Languages */}
          {entry.languages.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Languages className="h-4 w-4" aria-hidden="true" />
                Languages ({entry.languages.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {entry.languages.map((l) => (
                  <span
                    key={l.id}
                    className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 ring-1 ring-inset ring-teal-600/20"
                    title={l.note ?? undefined}
                  >
                    {l.language.toUpperCase()}
                    {l.note && <span className="ml-1 text-teal-500">({l.note})</span>}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Accessibility */}
          {entry.accessibility.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Accessibility className="h-4 w-4" aria-hidden="true" />
                Accessibility ({entry.accessibility.length})
              </h2>
              <div className="space-y-2">
                {entry.accessibility.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 text-sm">
                    <Tag className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <span className="text-gray-800 capitalize">{a.accessibility.replace(/_/g, ' ')}</span>
                      {a.details && <p className="text-xs text-gray-500 mt-0.5">{a.details}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column — Confidence + Decision */}
        <div className="space-y-6">
          {/* Confidence score */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Confidence Score</h2>
            {entry.confidenceScore ? (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-4xl font-bold text-gray-900">{entry.confidenceScore.score}</p>
                  <p className="text-xs text-gray-500 mt-1">Overall Score</p>
                </div>
                <div className="space-y-3">
                  <ScoreMeter label="Verification" value={entry.confidenceScore.verification_confidence} />
                  <ScoreMeter label="Eligibility Match" value={entry.confidenceScore.eligibility_match} />
                  <ScoreMeter label="Constraint Fit" value={entry.confidenceScore.constraint_fit} />
                </div>
                <p className="text-xs text-gray-400 text-center">
                  Last computed: {formatDate(entry.confidenceScore.computed_at)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">No confidence score yet</p>
            )}
          </section>

          {/* Queue metadata */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden="true" />
              Queue Info
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Submitted</dt>
                <dd className="text-gray-800">{formatDate(entry.created_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Last Updated</dt>
                <dd className="text-gray-800">{formatDate(entry.updated_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Submitted By</dt>
                <dd className="text-gray-800 truncate max-w-[180px]">{entry.submitted_by_user_id}</dd>
              </div>
              {entry.assigned_to_user_id && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Assigned To</dt>
                  <dd className="text-gray-800 truncate max-w-[180px]">{entry.assigned_to_user_id}</dd>
                </div>
              )}
              {entry.notes && (
                <div>
                  <dt className="text-gray-500 mb-1">Notes</dt>
                  <dd className="text-gray-800 text-xs bg-gray-50 rounded p-2">{entry.notes}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* Decision form */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Verification Decision</h2>

            {submitResult && (
              <div
                className={`flex items-center gap-2 rounded-md p-3 mb-4 text-sm ${
                  submitResult.success
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
                role="alert"
              >
                {submitResult.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                {submitResult.message}
              </div>
            )}

            {canDecide ? (
              <div className="space-y-4">
                {/* Decision radio options */}
                <fieldset>
                  <legend className="text-xs font-medium text-gray-500 mb-2">Select decision</legend>
                  <div className="space-y-2">
                    <label className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${decision === 'verified' ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        name="decision"
                        value="verified"
                        checked={decision === 'verified'}
                        onChange={() => setDecision('verified')}
                        className="h-4 w-4 text-green-600"
                      />
                      <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Verify</p>
                        <p className="text-xs text-gray-500">Confirm this record is accurate and current</p>
                      </div>
                    </label>

                    <label className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${decision === 'rejected' ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        name="decision"
                        value="rejected"
                        checked={decision === 'rejected'}
                        onChange={() => setDecision('rejected')}
                        className="h-4 w-4 text-red-600"
                      />
                      <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Reject</p>
                        <p className="text-xs text-gray-500">Record has issues — send back to host</p>
                      </div>
                    </label>

                    <label className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${decision === 'escalated' ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        name="decision"
                        value="escalated"
                        checked={decision === 'escalated'}
                        onChange={() => setDecision('escalated')}
                        className="h-4 w-4 text-purple-600"
                      />
                      <ArrowUpCircle className="h-4 w-4 text-purple-600" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Escalate</p>
                        <p className="text-xs text-gray-500">Needs ORAN admin review</p>
                      </div>
                    </label>
                  </div>
                </fieldset>

                {/* Notes */}
                <div>
                  <label htmlFor="verify-notes" className="block text-xs font-medium text-gray-500 mb-1">
                    Notes {decision === 'rejected' && <span className="text-red-500">(required for rejection)</span>}
                  </label>
                  <textarea
                    id="verify-notes"
                    rows={4}
                    maxLength={5000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      decision === 'rejected'
                        ? 'Describe what needs to be corrected…'
                        : 'Optional notes for this decision…'
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">{notes.length}/5000</p>
                </div>

                {/* Submit */}
                <Button
                  className="w-full gap-2"
                  disabled={
                    !decision ||
                    isSubmitting ||
                    (decision === 'rejected' && !notes.trim())
                  }
                  onClick={() => void handleSubmit()}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      Submit Decision
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="text-center py-4">
                <ShieldX className="h-8 w-8 text-gray-300 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-gray-500">
                  This entry has already been reviewed ({statusStyle.label}).
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
