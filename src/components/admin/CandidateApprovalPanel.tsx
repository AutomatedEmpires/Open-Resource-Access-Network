'use client';

import { useCallback, useEffect, useState } from 'react';

interface CurrentUserAssignment {
  id: string;
  status: 'pending' | 'claimed' | 'completed';
  outcome: string | null;
  expires_at: string | null;
}

interface CandidateAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
}

interface CandidateTag {
  id?: string;
  tagType: string;
  tagValue: string;
  displayLabel?: string;
  tagConfidence?: number;
}

interface TagConfirmation {
  id?: string;
  tagType: string;
  suggestedValue: string;
  suggestedConfidence: number;
  confirmationStatus: 'pending' | 'confirmed' | 'modified' | 'rejected' | 'auto_approved';
  confirmedValue?: string;
  agentReasoning?: string;
  evidenceRefs?: string[];
}

interface LlmSuggestion {
  id?: string;
  fieldName: string;
  suggestedValue: string;
  llmConfidence: number;
  suggestionStatus: 'pending' | 'accepted' | 'modified' | 'rejected';
  acceptedValue?: string;
  sourceEvidenceRefs?: string[];
}

interface VerificationCheck {
  checkId: string;
  checkType: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'pass' | 'fail' | 'unknown';
  details?: Record<string, unknown>;
  evidenceRefs?: string[];
}

interface EvidenceLink {
  id?: string;
  url: string;
  label: string;
  linkType: string;
  isVerified: boolean;
  isLinkAlive?: boolean;
  evidenceId?: string;
}

interface ReviewReadiness {
  canApprove: boolean;
  hasRequiredFields: boolean;
  hasRequiredTags: boolean;
  tagsConfirmed: boolean;
  meetsScoreThreshold: boolean;
  passesVerification: boolean;
  blockers: string[];
}

interface CandidateDetail {
  candidate: {
    fields?: {
      organizationName?: string;
      serviceName?: string;
      description?: string;
      websiteUrl?: string;
      phone?: string;
      phones?: Array<{ number: string; type?: string; context?: string }>;
      address?: CandidateAddress;
      isRemoteService?: boolean;
    };
    review?: { status?: string };
  };
  tags?: CandidateTag[];
  checks?: VerificationCheck[];
  links?: EvidenceLink[];
  tagConfirmations?: TagConfirmation[];
  suggestions?: LlmSuggestion[];
  reviewReadiness?: ReviewReadiness;
  canMutateEvidence?: boolean;
  currentUserAssignment: CurrentUserAssignment | null;
  assignmentProgress?: {
    completedReviewCount: number;
    openReviewCount: number;
    requiredMatchingReviewCount: number;
  };
}

interface CandidateApprovalPanelProps {
  candidateId: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}

type ReviewDecision = 'approved' | 'rejected' | 'escalated';
type EvidenceDecision = 'confirmed' | 'accepted' | 'modified' | 'rejected';

interface PendingEvidenceDecision {
  kind: 'tag' | 'suggestion';
  itemId: string;
  itemLabel: string;
  status: EvidenceDecision;
  value?: string;
}

const READINESS_LABELS: Record<string, string> = {
  missing_required_fields: 'Required service, contact, or access details are missing.',
  missing_required_tags: 'A category and geographic tag are required.',
  pending_tag_confirmation: 'Resolve all pending tag confirmations.',
  confidence_below_publish_threshold: 'The candidate confidence is below the configured threshold.',
  quarantine_source: 'The source is quarantined and cannot be approved for publication.',
  critical_verification_failure: 'A critical verification check failed.',
  domain_allowlist_failed: 'The source domain did not pass the allowlist check.',
};

function displayLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function evidenceDecisionLabel(status: EvidenceDecision) {
  if (status === 'confirmed') return 'tag confirmation';
  if (status === 'accepted') return 'suggestion acceptance';
  if (status === 'modified') return 'correction';
  return 'rejection';
}

function safeHttpUrl(input: string | undefined) {
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function controlledErrorMessage(status: number, body: unknown, fallback: string) {
  if (status === 400 || status === 404 || status === 409) {
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === 'string' && error.length <= 240) return error;
  }
  return fallback;
}

function EvidenceReferences({ references }: { references: string[] | undefined }) {
  const values = references?.filter(Boolean) ?? [];
  if (values.length === 0) return null;
  return (
    <p className="mt-2 break-words text-xs text-slate-500">
      Evidence: {values.map((reference, index) => {
        const safeUrl = safeHttpUrl(reference);
        return (
          <span key={`${reference}-${index}`}>
            {index > 0 ? ', ' : null}
            {safeUrl ? (
              <a href={safeUrl} target="_blank" rel="noreferrer" className="font-medium text-sky-800 underline">
                source {index + 1}
              </a>
            ) : reference}
          </span>
        );
      })}
    </p>
  );
}

export function CandidateApprovalPanel({ candidateId, onClose, onChanged }: CandidateApprovalPanelProps) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [tagValues, setTagValues] = useState<Record<string, string>>({});
  const [suggestionValues, setSuggestionValues] = useState<Record<string, string>>({});
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceSubmitting, setEvidenceSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationDecision, setConfirmationDecision] = useState<ReviewDecision | null>(null);
  const [pendingEvidenceDecision, setPendingEvidenceDecision] = useState<PendingEvidenceDecision | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ingestion/candidates/${candidateId}`, { signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(controlledErrorMessage(response.status, body, 'Unable to load this review.'));
      }
      setDetail(body as CandidateDetail);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Unable to load this review.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const submit = async (action: 'claim' | 'decide', decision?: ReviewDecision) => {
    const assignment = detail?.currentUserAssignment;
    if (!assignment) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/ingestion/candidates/${candidateId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          assignmentId: assignment.id,
          ...(decision ? { decision, notes: notes.trim() || undefined } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(controlledErrorMessage(response.status, body, 'The review action could not be completed.'));
      }
      setNotice(action === 'claim' ? 'Review claimed.' : 'Decision recorded.');
      setNotes('');
      setConfirmationDecision(null);
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review action could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEvidenceDecision = async (
    kind: 'tag' | 'suggestion',
    itemId: string,
    status: EvidenceDecision,
    value?: string,
  ) => {
    const actionKey = `${kind}:${itemId}`;
    setEvidenceSubmitting(actionKey);
    setError(null);
    setNotice(null);
    try {
      const isTag = kind === 'tag';
      const response = await fetch(
        `/api/admin/ingestion/candidates/${candidateId}/${isTag ? 'tags' : 'suggestions'}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isTag
            ? {
                confirmationId: itemId,
                status,
                ...(status === 'modified' ? { confirmedValue: value?.trim() } : {}),
                ...(evidenceNotes[actionKey]?.trim() ? { notes: evidenceNotes[actionKey].trim() } : {}),
              }
            : {
                suggestionId: itemId,
                status,
                ...(status === 'modified' ? { acceptedValue: value?.trim() } : {}),
                ...(evidenceNotes[actionKey]?.trim() ? { notes: evidenceNotes[actionKey].trim() } : {}),
              }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(controlledErrorMessage(response.status, body, 'The evidence decision could not be completed.'));
      }
      setNotice(`${isTag ? 'Tag' : 'AI suggestion'} decision recorded.`);
      setPendingEvidenceDecision(null);
      setTagValues((current) => ({ ...current, [itemId]: '' }));
      setSuggestionValues((current) => ({ ...current, [itemId]: '' }));
      setEvidenceNotes((current) => ({ ...current, [actionKey]: '' }));
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The evidence decision could not be completed.');
    } finally {
      setEvidenceSubmitting(null);
    }
  };

  const assignment = detail?.currentUserAssignment;
  const fields = detail?.candidate.fields;
  const sourceUrl = safeHttpUrl(fields?.websiteUrl);
  const address = fields?.address;
  const readiness = detail?.reviewReadiness;
  const canMutateEvidence = assignment?.status === 'claimed' && detail?.canMutateEvidence === true;
  const approveDisabled = submitting || evidenceSubmitting !== null || readiness?.canApprove !== true;

  const requestDecision = (decision: ReviewDecision) => {
    if (decision === 'approved' && readiness?.canApprove !== true) {
      setError('Resolve the review-readiness blockers before approving this candidate.');
      return;
    }
    if (decision !== 'approved' && notes.trim().length < 20) {
      setError('Add a substantive note of at least 20 characters before rejecting or escalating.');
      return;
    }
    setError(null);
    setConfirmationDecision(decision);
  };

  const requestEvidenceDecision = (decision: PendingEvidenceDecision) => {
    setError(null);
    setPendingEvidenceDecision(decision);
  };

  const decisionLabel = confirmationDecision === 'approved'
    ? 'approval'
    : confirmationDecision === 'rejected'
      ? 'rejection'
      : 'escalation';

  return (
    <section
      className="rounded-2xl border border-sky-300 bg-gradient-to-br from-sky-50 via-white to-slate-100 p-5 shadow-lg shadow-sky-950/10"
      aria-labelledby="candidate-review-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Independent review</p>
          <h3 id="candidate-review-title" className="mt-1 text-lg font-semibold text-slate-950">
            {fields?.serviceName ?? 'Candidate review'}
          </h3>
          {fields?.organizationName && <p className="text-sm text-slate-600">{fields.organizationName}</p>}
        </div>
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-white">
          Close
        </button>
      </div>

      {loading && <p className="mt-5 text-sm text-slate-600" role="status">Loading assigned review…</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950" role="status">{notice}</p>}
      {pendingEvidenceDecision && (
        <div role="alertdialog" aria-labelledby="candidate-evidence-confirmation" className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4">
          <p id="candidate-evidence-confirmation" className="text-sm font-semibold text-amber-950">
            Confirm {evidenceDecisionLabel(pendingEvidenceDecision.status)}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            This irreversible evidence decision applies to {pendingEvidenceDecision.itemLabel}.
          </p>
          {pendingEvidenceDecision.status === 'modified' && pendingEvidenceDecision.value && (
            <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-amber-950">
              Corrected value: {pendingEvidenceDecision.value}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={evidenceSubmitting !== null}
              onClick={() => void submitEvidenceDecision(
                pendingEvidenceDecision.kind,
                pendingEvidenceDecision.itemId,
                pendingEvidenceDecision.status,
                pendingEvidenceDecision.value,
              )}
              className="min-h-11 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirm evidence decision
            </button>
            <button
              type="button"
              disabled={evidenceSubmitting !== null}
              onClick={() => setPendingEvidenceDecision(null)}
              className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 text-sm font-semibold text-amber-950 disabled:opacity-50"
            >
              Cancel evidence decision
            </button>
          </div>
        </div>
      )}

      {!loading && detail && (
        <div className="mt-5 space-y-5">
          <section aria-labelledby="candidate-service-details" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-service-details" className="text-sm font-semibold text-slate-950">Service details</h4>
            {fields?.description
              ? <p className="mt-2 text-sm leading-6 text-slate-700">{fields.description}</p>
              : <p className="mt-2 text-sm text-amber-800">No service description was extracted.</p>}
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Phone</dt>
                <dd className="mt-0.5 text-slate-900">{fields?.phone ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Remote service</dt>
                <dd className="mt-0.5 text-slate-900">{fields?.isRemoteService ? 'Yes' : 'No'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-500">Address</dt>
                <dd className="mt-0.5 text-slate-900">
                  {address
                    ? [address.line1, address.line2, address.city, address.region, address.postalCode, address.country]
                        .filter(Boolean).join(', ')
                    : 'Not provided'}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="candidate-sources" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-sources" className="text-sm font-semibold text-slate-950">Source and evidence links</h4>
            <p className="mt-1 text-xs text-slate-500">Links are evidence for review, not a guarantee that service information is current.</p>
            <ul className="mt-3 space-y-3">
              {sourceUrl && (
                <li>
                  <a className="break-all text-sm font-medium text-sky-800 underline" href={sourceUrl} target="_blank" rel="noreferrer">Candidate website</a>
                  <span className="ml-2 text-xs text-slate-500">Extracted value</span>
                </li>
              )}
              {(detail.links ?? []).map((link, index) => {
                const safeUrl = safeHttpUrl(link.url);
                return (
                  <li key={link.id ?? `${link.url}-${index}`} className="text-sm">
                    {safeUrl ? (
                      <a href={safeUrl} target="_blank" rel="noreferrer" className="font-medium text-sky-800 underline">
                        {link.label || displayLabel(link.linkType)}
                      </a>
                    ) : <span className="font-medium text-slate-800">{link.label || displayLabel(link.linkType)}</span>}
                    <span className={`ml-2 text-xs font-medium ${link.isVerified ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {link.isVerified ? 'Verified link' : 'Not yet verified'}
                    </span>
                    {link.isLinkAlive === false && <span className="ml-2 text-xs font-medium text-red-800">Unavailable when last checked</span>}
                    {link.evidenceId && <p className="mt-1 break-words text-xs text-slate-500">Evidence: {link.evidenceId}</p>}
                  </li>
                );
              })}
              {!sourceUrl && (detail.links ?? []).length === 0 && <li className="text-sm text-amber-800">No safe source link is available for review.</li>}
            </ul>
          </section>

          <section aria-labelledby="candidate-tags" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-tags" className="text-sm font-semibold text-slate-950">Candidate tags</h4>
            {(detail.tags ?? []).length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {(detail.tags ?? []).map((tag, index) => (
                  <li key={tag.id ?? `${tag.tagType}-${tag.tagValue}-${index}`} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-800">
                    <span className="font-semibold">{displayLabel(tag.tagType)}:</span>{' '}
                    {tag.displayLabel ?? displayLabel(tag.tagValue)}
                    {typeof tag.tagConfidence === 'number' ? ` · ${tag.tagConfidence}%` : ''}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-amber-800">No candidate tags are recorded.</p>}
          </section>

          <section aria-labelledby="candidate-tag-confirmations" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-tag-confirmations" className="text-sm font-semibold text-slate-950">Tag confirmations</h4>
            <p className="mt-1 text-xs text-slate-500">Confirm, correct, or reject extracted tags before signing your review.</p>
            {(detail.tagConfirmations ?? []).length > 0 ? (
              <ul className="mt-3 space-y-3">
                {(detail.tagConfirmations ?? []).map((confirmation, index) => {
                  const confirmationId = confirmation.id;
                  const actionKey = confirmationId ? `tag:${confirmationId}` : `tag-missing-${index}`;
                  const busy = evidenceSubmitting === actionKey;
                  const pending = confirmation.confirmationStatus === 'pending';
                  return (
                    <li key={confirmationId ?? actionKey} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{displayLabel(confirmation.tagType)}: {displayLabel(confirmation.suggestedValue)}</p>
                          <p className="text-xs text-slate-500">Extraction confidence {confirmation.suggestedConfidence}%</p>
                        </div>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700">{displayLabel(confirmation.confirmationStatus)}</span>
                      </div>
                      {confirmation.agentReasoning && <p className="mt-2 text-xs text-slate-600">Extraction rationale: {confirmation.agentReasoning}</p>}
                      {confirmation.confirmedValue && confirmation.confirmedValue !== confirmation.suggestedValue && (
                        <p className="mt-2 text-xs font-medium text-slate-700">Reviewed value: {confirmation.confirmedValue}</p>
                      )}
                      <EvidenceReferences references={confirmation.evidenceRefs} />
                      {pending && canMutateEvidence && confirmationId && (
                        <div className="mt-3 space-y-2">
                          <label className="block text-xs font-medium text-slate-700" htmlFor={`tag-value-${confirmationId}`}>Corrected tag value</label>
                          <input
                            id={`tag-value-${confirmationId}`}
                            value={tagValues[confirmationId] ?? ''}
                            maxLength={2000}
                            onChange={(event) => setTagValues((current) => ({ ...current, [confirmationId]: event.target.value }))}
                            className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950"
                            placeholder="Only needed when modifying"
                          />
                          <label className="block text-xs font-medium text-slate-700" htmlFor={`tag-note-${confirmationId}`}>Decision note (optional)</label>
                          <input
                            id={`tag-note-${confirmationId}`}
                            value={evidenceNotes[actionKey] ?? ''}
                            maxLength={2000}
                            onChange={(event) => setEvidenceNotes((current) => ({ ...current, [actionKey]: event.target.value }))}
                            className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy} onClick={() => requestEvidenceDecision({ kind: 'tag', itemId: confirmationId, itemLabel: `${displayLabel(confirmation.tagType)}: ${displayLabel(confirmation.suggestedValue)}`, status: 'confirmed' })} className="min-h-11 rounded-lg bg-sky-800 px-3 text-sm font-semibold text-white disabled:opacity-50">Confirm tag</button>
                            <button type="button" disabled={busy || !(tagValues[confirmationId]?.trim())} onClick={() => requestEvidenceDecision({ kind: 'tag', itemId: confirmationId, itemLabel: `${displayLabel(confirmation.tagType)}: ${displayLabel(confirmation.suggestedValue)}`, status: 'modified', value: tagValues[confirmationId]?.trim() })} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 text-sm font-semibold text-sky-900 disabled:opacity-50">Save corrected tag</button>
                            <button type="button" disabled={busy} onClick={() => requestEvidenceDecision({ kind: 'tag', itemId: confirmationId, itemLabel: `${displayLabel(confirmation.tagType)}: ${displayLabel(confirmation.suggestedValue)}`, status: 'rejected' })} className="min-h-11 rounded-lg border border-red-500 bg-white px-3 text-sm font-semibold text-red-800 disabled:opacity-50">Reject tag</button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-slate-600">No tag confirmations require review.</p>}
          </section>

          <section aria-labelledby="candidate-suggestions" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-suggestions" className="text-sm font-semibold text-slate-950">AI-assisted field suggestions</h4>
            <p className="mt-1 text-xs text-slate-500">These values are unverified AI suggestions. Pending suggestions are excluded from publication unless you explicitly accept or correct them before the first completed review; evidence decisions are sealed after that point.</p>
            {(detail.suggestions ?? []).length > 0 ? (
              <ul className="mt-3 space-y-3">
                {(detail.suggestions ?? []).map((suggestion, index) => {
                  const suggestionId = suggestion.id;
                  const actionKey = suggestionId ? `suggestion:${suggestionId}` : `suggestion-missing-${index}`;
                  const busy = evidenceSubmitting === actionKey;
                  const pending = suggestion.suggestionStatus === 'pending';
                  return (
                    <li key={suggestionId ?? actionKey} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{displayLabel(suggestion.fieldName)}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{suggestion.suggestedValue}</p>
                          <p className="mt-1 text-xs text-slate-500">Model confidence {suggestion.llmConfidence}%</p>
                        </div>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700">{displayLabel(suggestion.suggestionStatus)}</span>
                      </div>
                      {suggestion.acceptedValue && suggestion.acceptedValue !== suggestion.suggestedValue && (
                        <p className="mt-2 whitespace-pre-wrap text-xs font-medium text-slate-700">Reviewed value: {suggestion.acceptedValue}</p>
                      )}
                      <EvidenceReferences references={suggestion.sourceEvidenceRefs} />
                      {pending && canMutateEvidence && suggestionId && (
                        <div className="mt-3 space-y-2">
                          <label className="block text-xs font-medium text-slate-700" htmlFor={`suggestion-value-${suggestionId}`}>Corrected value</label>
                          <textarea
                            id={`suggestion-value-${suggestionId}`}
                            value={suggestionValues[suggestionId] ?? ''}
                            maxLength={20_000}
                            rows={3}
                            onChange={(event) => setSuggestionValues((current) => ({ ...current, [suggestionId]: event.target.value }))}
                            className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950"
                            placeholder="Only needed when modifying"
                          />
                          <label className="block text-xs font-medium text-slate-700" htmlFor={`suggestion-note-${suggestionId}`}>Decision note (optional)</label>
                          <input
                            id={`suggestion-note-${suggestionId}`}
                            value={evidenceNotes[actionKey] ?? ''}
                            maxLength={2000}
                            onChange={(event) => setEvidenceNotes((current) => ({ ...current, [actionKey]: event.target.value }))}
                            className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy} onClick={() => requestEvidenceDecision({ kind: 'suggestion', itemId: suggestionId, itemLabel: `${displayLabel(suggestion.fieldName)} suggestion`, status: 'accepted' })} className="min-h-11 rounded-lg bg-sky-800 px-3 text-sm font-semibold text-white disabled:opacity-50">Accept suggestion</button>
                            <button type="button" disabled={busy || !(suggestionValues[suggestionId]?.trim())} onClick={() => requestEvidenceDecision({ kind: 'suggestion', itemId: suggestionId, itemLabel: `${displayLabel(suggestion.fieldName)} suggestion`, status: 'modified', value: suggestionValues[suggestionId]?.trim() })} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 text-sm font-semibold text-sky-900 disabled:opacity-50">Save corrected value</button>
                            <button type="button" disabled={busy} onClick={() => requestEvidenceDecision({ kind: 'suggestion', itemId: suggestionId, itemLabel: `${displayLabel(suggestion.fieldName)} suggestion`, status: 'rejected' })} className="min-h-11 rounded-lg border border-red-500 bg-white px-3 text-sm font-semibold text-red-800 disabled:opacity-50">Reject suggestion</button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-slate-600">No AI field suggestions are recorded.</p>}
          </section>

          <section aria-labelledby="candidate-verification" className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 id="candidate-verification" className="text-sm font-semibold text-slate-950">Verification checks</h4>
            {(detail.checks ?? []).length > 0 ? (
              <ul className="mt-3 space-y-2">
                {(detail.checks ?? []).map((check) => {
                  const message = typeof check.details?.message === 'string' ? check.details.message : null;
                  return (
                    <li key={check.checkId} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{displayLabel(check.checkType)}</span>
                        <span className={`text-xs font-semibold ${check.status === 'pass' ? 'text-emerald-800' : check.status === 'fail' ? 'text-red-800' : 'text-amber-800'}`}>
                          {displayLabel(check.status)} · {displayLabel(check.severity)}
                        </span>
                      </div>
                      {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
                      <EvidenceReferences references={check.evidenceRefs} />
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-amber-800">No verification checks are recorded.</p>}
          </section>

          <section aria-labelledby="candidate-readiness" className={`rounded-xl border p-4 ${readiness?.canApprove ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
            <h4 id="candidate-readiness" className="text-sm font-semibold text-slate-950">Review readiness</h4>
            {readiness ? (
              readiness.canApprove ? (
                <p className="mt-2 text-sm text-emerald-900">Static service, tag, confidence, and verification prerequisites are satisfied. Your independent approval does not guarantee service availability or user eligibility.</p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-amber-950">Resolve these blockers before approving. You may still reject or escalate with a substantive note.</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
                    {readiness.blockers.length > 0
                      ? readiness.blockers.map((blocker) => <li key={blocker}>{READINESS_LABELS[blocker] ?? displayLabel(blocker)}</li>)
                      : <li>The server did not confirm that the static approval gate is clear.</li>}
                  </ul>
                </>
              )
            ) : <p className="mt-2 text-sm text-amber-950">Readiness information is unavailable. Refresh before approving this candidate.</p>}
          </section>

          {detail.candidate.review?.status && (
            <p className="text-sm text-slate-600">Candidate status: <span className="font-semibold text-slate-900">{detail.candidate.review.status}</span></p>
          )}
          {!assignment && <p className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700">This candidate is not assigned to your reviewer profile.</p>}

          {assignment?.status === 'pending' && (
            <button type="button" disabled={submitting} onClick={() => void submit('claim')} className="min-h-11 rounded-lg bg-gradient-to-r from-sky-700 to-blue-900 px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">
              {submitting ? 'Claiming…' : 'Claim review'}
            </button>
          )}

          {assignment?.status === 'claimed' && (
            <div className="space-y-3">
              {!canMutateEvidence && (
                <p className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700">Evidence decisions are not available for this assignment. Review the recorded evidence and submit your own decision.</p>
              )}
              <label htmlFor="candidate-review-notes" className="block text-sm font-medium text-slate-800">Review notes <span className="font-normal text-slate-500">(optional)</span></label>
              <textarea
                id="candidate-review-notes"
                value={notes}
                maxLength={4000}
                rows={4}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 focus:border-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              <p className="text-xs text-slate-500">Rejection or escalation requires a substantive note of at least 20 characters and confirmation. Approval also requires explicit confirmation because every signed decision is immutable.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={approveDisabled} onClick={() => requestDecision('approved')} className="min-h-11 rounded-lg bg-gradient-to-r from-sky-700 to-blue-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" title={readiness?.canApprove ? undefined : 'Resolve review-readiness blockers first'}>Approve</button>
                <button type="button" disabled={submitting || evidenceSubmitting !== null} onClick={() => requestDecision('rejected')} className="min-h-11 rounded-lg border border-red-500 bg-white px-4 text-sm font-semibold text-red-800 disabled:opacity-50">Reject</button>
                <button type="button" disabled={submitting || evidenceSubmitting !== null} onClick={() => requestDecision('escalated')} className="min-h-11 rounded-lg border border-slate-400 bg-slate-100 px-4 text-sm font-semibold text-slate-800 disabled:opacity-50">Escalate</button>
              </div>
              {confirmationDecision && (
                <div role="alertdialog" aria-labelledby="candidate-decision-confirmation" className="rounded-lg border border-amber-400 bg-amber-50 p-4">
                  <p id="candidate-decision-confirmation" className="text-sm font-semibold text-amber-950">Confirm {decisionLabel}</p>
                  <p className="mt-1 text-sm text-amber-900">This signed decision becomes immutable review evidence.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={submitting} onClick={() => void submit('decide', confirmationDecision)} className="min-h-11 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white disabled:opacity-50">Confirm {decisionLabel}</button>
                    <button type="button" disabled={submitting} onClick={() => setConfirmationDecision(null)} className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 text-sm font-semibold text-amber-950 disabled:opacity-50">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {assignment?.status === 'completed' && (
            <p className="rounded-lg border border-sky-300 bg-white p-3 text-sm text-slate-700">Your independent decision is complete{assignment.outcome ? `: ${assignment.outcome}` : '.'}</p>
          )}
        </div>
      )}
    </section>
  );
}
