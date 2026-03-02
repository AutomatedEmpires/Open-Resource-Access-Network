/**
 * /claim — Organization Claim Page
 *
 * Hosts submit a claim to manage an organization on ORAN.
 * Collects org name, description, website, contact email, and reviewer notes.
 * Submits to POST /api/host/claim → creates org + verification queue entry.
 */

'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle, AlertTriangle, ArrowRight, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';

// ============================================================
// TYPES
// ============================================================

interface ClaimResult {
  success: boolean;
  organizationId: string;
  serviceId: string;
  message: string;
}

type ClaimState = 'idle' | 'submitting' | 'success' | 'error';

// ============================================================
// COMPONENT
// ============================================================

export default function ClaimPage() {
  const [orgName, setOrgName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [claimNotes, setClaimNotes] = useState('');
  const [state, setState] = useState<ClaimState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<ClaimResult | null>(null);

  const canSubmit = orgName.trim().length > 0 && state !== 'submitting';

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setState('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/host/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: orgName.trim(),
          description: description.trim() || undefined,
          url: url.trim() || undefined,
          email: email.trim() || undefined,
          claimNotes: claimNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Claim submission failed');
      }

      const json = (await res.json()) as ClaimResult;
      setResult(json);
      setState('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Claim submission failed');
      setState('error');
    }
  }, [canSubmit, orgName, description, url, email, claimNotes]);

  // ── Success state ──
  if (state === 'success' && result) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle className="mx-auto h-10 w-10 text-green-600" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Claim Submitted</h1>
          <p className="mt-2 text-sm text-gray-700">{result.message}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/org">
              <Button className="gap-2">
                Go to Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setState('idle');
                setOrgName('');
                setDescription('');
                setUrl('');
                setEmail('');
                setClaimNotes('');
                setResult(null);
              }}
            >
              Submit Another Claim
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // ── Form state ──
  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
          Claim an Organization
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Claim your organization to manage its services, locations, and team on ORAN.
          A community administrator will review your request.
        </p>
      </div>

      <ErrorBoundary>
        {/* Info box */}
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <Info className="h-5 w-5 mt-0.5 flex-shrink-0 text-blue-600" aria-hidden="true" />
          <div className="text-sm text-blue-900">
            <p className="font-medium">What happens next?</p>
            <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-blue-800">
              <li>Your claim is added to the verification queue.</li>
              <li>A community admin reviews the claim (typically 1–3 business days).</li>
              <li>Once approved, you can manage services and locations for this organization.</li>
            </ol>
          </div>
        </div>

        {/* Error */}
        {state === 'error' && errorMsg && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Submission failed</p>
              <p className="text-xs mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Organization name */}
          <div>
            <label htmlFor="claim-org-name" className="block text-sm font-medium text-gray-700 mb-1">
              Organization Name <span className="text-red-500">*</span>
            </label>
            <input
              id="claim-org-name"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g., Springfield Community Food Bank"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              required
              maxLength={500}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="claim-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="claim-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your organization and the services it provides."
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={5000}
            />
          </div>

          {/* Website */}
          <div>
            <label htmlFor="claim-url" className="block text-sm font-medium text-gray-700 mb-1">
              Website
            </label>
            <input
              id="claim-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.org"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              maxLength={2000}
            />
            <p className="mt-1 text-xs text-gray-500">Helps community admins verify your organization.</p>
          </div>

          {/* Contact email */}
          <div>
            <label htmlFor="claim-email" className="block text-sm font-medium text-gray-700 mb-1">
              Contact Email
            </label>
            <input
              id="claim-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@example.org"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              maxLength={500}
            />
          </div>

          {/* Notes for reviewer */}
          <div>
            <label htmlFor="claim-notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes for Reviewer
            </label>
            <textarea
              id="claim-notes"
              value={claimNotes}
              onChange={(e) => setClaimNotes(e.target.value)}
              placeholder="Your role at the organization, how to verify your association, etc."
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={2000}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
              {state === 'submitting' ? 'Submitting…' : 'Submit Claim'}
            </Button>
          </div>
        </form>
      </ErrorBoundary>
    </main>
  );
}
