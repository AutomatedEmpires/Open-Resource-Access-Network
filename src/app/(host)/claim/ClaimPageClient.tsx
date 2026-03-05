/**
 * /claim — Organization Claim Page (Multi-Step Wizard)
 *
 * Hosts submit a claim to manage an organization on ORAN.
 * Three-step wizard: (1) Organization identity, (2) Contact & details, (3) Review & submit.
 * Submits to POST /api/host/claim → creates org + verification queue entry.
 */

'use client';

import React, { useCallback, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Building2, Globe, Send, ArrowRight, ArrowLeft,
  Mail, FileText, Phone,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { FormStepper, StepContent, type Step } from '@/components/ui/form-stepper';
import { SuccessCelebration } from '@/components/ui/success-celebration';
import { useUnsavedChanges } from '@/lib/hooks/useUnsavedChanges';

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

const STEPS: Step[] = [
  { id: 'identity', label: 'Organization', icon: <Building2 className="h-5 w-5" /> },
  { id: 'contact', label: 'Contact & Details', icon: <Mail className="h-5 w-5" /> },
  { id: 'review', label: 'Review & Submit', icon: <Send className="h-5 w-5" /> },
];

// ============================================================
// INPUT STYLE CONSTANT
// ============================================================

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 min-h-[44px] transition-shadow';

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 transition-shadow';

// ============================================================
// COMPONENT
// ============================================================

export default function ClaimPage() {
  // ── Form state ──
  const [orgName, setOrgName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [claimNotes, setClaimNotes] = useState('');

  // ── Flow state ──
  const [step, setStep] = useState(0);
  const [state, setState] = useState<ClaimState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<ClaimResult | null>(null);

  // ── Validation ──
  const step0Valid = orgName.trim().length > 0;
  const canSubmit = step0Valid && state !== 'submitting';

  // ── Unsaved changes guard ──
  const isDirty = useMemo(
    () => Boolean(orgName || description || url || email || phone || claimNotes),
    [orgName, description, url, email, phone, claimNotes],
  );
  useUnsavedChanges(isDirty && state !== 'success');

  // ── Step navigation ──
  const goNext = useCallback(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), []);
  const goBack = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // ── Submit ──
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
          phone: phone.trim() || undefined,
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

  // ── Reset ──
  const resetForm = useCallback(() => {
    setState('idle');
    setStep(0);
    setOrgName('');
    setDescription('');
    setUrl('');
    setEmail('');
    setPhone('');
    setClaimNotes('');
    setResult(null);
    setErrorMsg('');
  }, []);

  // ── Success state ──
  if (state === 'success' && result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <SuccessCelebration
          message="Claim Submitted!"
          subtitle={result.message}
          timeout={0}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/org">
            <Button className="gap-2 w-full sm:w-auto">
              Go to Dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
          <Button variant="outline" onClick={resetForm}>
            Submit Another Claim
          </Button>
        </div>
      </div>
    );
  }

  // ── Wizard form ──
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
          Claim an Organization
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Three quick steps to claim your organization on ORAN.
        </p>
      </div>

      {/* Stepper */}
      <FormStepper steps={STEPS} currentStep={step} className="mb-8" />

      <ErrorBoundary>
        {/* Error banner */}
        {state === 'error' && errorMsg && (
          <FormAlert
            variant="error"
            message={errorMsg}
            onDismiss={() => { setState('idle'); setErrorMsg(''); }}
            className="mb-6"
          />
        )}

        <form onSubmit={handleSubmit}>
          {/* ── Step 1: Organization Identity ── */}
          <StepContent active={step === 0}>
            <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-2">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Tell us about your organization
              </div>

              <FormField
                id="claim-org-name"
                label="Organization Name"
                required
                hint="The official or commonly known name of your organization."
              >
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g., Springfield Community Food Bank"
                  className={INPUT_CLASS}
                  required
                  maxLength={500}
                  autoFocus
                />
              </FormField>

              <FormField
                id="claim-description"
                label="Description"
                hint="What does your organization do? What communities do you serve?"
                charCount={description.length}
                maxChars={5000}
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of your organization and the services it provides."
                  rows={4}
                  className={TEXTAREA_CLASS}
                  maxLength={5000}
                />
              </FormField>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={!step0Valid}
                  className="gap-2"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </StepContent>

          {/* ── Step 2: Contact & Details ── */}
          <StepContent active={step === 1}>
            <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-2">
                <Globe className="h-4 w-4" aria-hidden="true" />
                Contact information &amp; verification details
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="claim-url"
                  label="Website"
                  hint="Helps community admins verify your organization."
                >
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.example.org"
                    className={INPUT_CLASS}
                    maxLength={2000}
                  />
                </FormField>

                <FormField id="claim-email" label="Contact Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@example.org"
                    className={INPUT_CLASS}
                    maxLength={500}
                  />
                </FormField>
              </div>

              <FormField id="claim-phone" label="Phone Number" hint="Optional — helps verification.">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className={INPUT_CLASS}
                  maxLength={30}
                />
              </FormField>

              <FormField
                id="claim-notes"
                label="Notes for Reviewer"
                hint="Your role at the organization, how to verify your association, etc."
                charCount={claimNotes.length}
                maxChars={2000}
              >
                <textarea
                  value={claimNotes}
                  onChange={(e) => setClaimNotes(e.target.value)}
                  placeholder="I am the executive director and can be reached at..."
                  rows={3}
                  className={TEXTAREA_CLASS}
                  maxLength={2000}
                />
              </FormField>

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={goBack} className="gap-2">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button type="button" onClick={goNext} className="gap-2">
                  Review
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </StepContent>

          {/* ── Step 3: Review & Submit ── */}
          <StepContent active={step === 2}>
            <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-2">
                <FileText className="h-4 w-4" aria-hidden="true" />
                Review your claim
              </div>

              {/* Review card */}
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-3">
                <ReviewRow icon={<Building2 className="h-4 w-4" />} label="Organization" value={orgName} />
                {description && <ReviewRow icon={<FileText className="h-4 w-4" />} label="Description" value={description} truncate />}
                {url && <ReviewRow icon={<Globe className="h-4 w-4" />} label="Website" value={url} />}
                {email && <ReviewRow icon={<Mail className="h-4 w-4" />} label="Email" value={email} />}
                {phone && <ReviewRow icon={<Phone className="h-4 w-4" />} label="Phone" value={phone} />}
                {claimNotes && <ReviewRow icon={<FileText className="h-4 w-4" />} label="Reviewer Notes" value={claimNotes} truncate />}
              </div>

              {/* What happens next */}
              <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                <Send className="h-5 w-5 mt-0.5 flex-shrink-0 text-blue-500" aria-hidden="true" />
                <div className="text-sm text-blue-900">
                  <p className="font-medium">What happens next?</p>
                  <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-blue-800">
                    <li>Your claim joins the verification queue.</li>
                    <li>A community admin reviews it (typically 1–3 business days).</li>
                    <li>Once approved, you can manage services and locations.</li>
                  </ol>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={goBack} className="gap-2">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button type="submit" disabled={!canSubmit} className="gap-2 min-w-[160px]">
                  {state === 'submitting' ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Submit Claim
                    </>
                  )}
                </Button>
              </div>
            </div>
          </StepContent>
        </form>
      </ErrorBoundary>
    </div>
  );
}

/* ── Review row helper ─────────────────────────────────────────── */

function ReviewRow({
  icon,
  label,
  value,
  truncate,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <span className="font-medium text-gray-600">{label}:</span>{' '}
        <span className={truncate ? 'line-clamp-2 text-gray-800' : 'text-gray-800'}>{value}</span>
      </div>
    </div>
  );
}
