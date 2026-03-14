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

interface PollableSourceFeed {
  id: string;
  sourceSystemId: string;
  feedName: string;
  feedType: string;
  feedHandler: 'none' | 'hsds_api' | 'ndp_211' | 'azure_function';
  baseUrl?: string | null;
  healthcheckUrl?: string | null;
  authType?: string | null;
  profileUri?: string | null;
  jurisdictionScope?: {
    kind?: string;
    country?: string;
    stateProvince?: string;
  } | null;
  refreshIntervalHours?: number | null;
  isActive: boolean;
  lastPolledAt?: string | null;
  state?: {
    sourceFeedId: string;
    publicationMode?: 'canonical_only' | 'review_required' | 'auto_publish';
    autoPublishApprovedAt?: string | null;
    autoPublishApprovedBy?: string | null;
    emergencyPause?: boolean;
    includedDataOwners?: string[];
    excludedDataOwners?: string[];
    maxOrganizationsPerPoll?: number | null;
    checkpointCursor?: string | null;
    replayFromCursor?: string | null;
    lastAttemptStatus?: string;
    lastAttemptCompletedAt?: string | null;
    lastAttemptSummary?: Record<string, unknown>;
    notes?: string | null;
  } | null;
}

interface PollableSourceSystem {
  id: string;
  name: string;
  family: string;
  trustTier: 'verified_publisher' | 'trusted_partner' | 'curated' | 'community' | 'quarantine' | 'blocked';
  homepageUrl?: string | null;
  termsUrl?: string | null;
  licenseNotes?: string | null;
  hsdsProfileUri?: string | null;
  notes?: string | null;
  jurisdictionScope?: {
    kind?: string;
    country?: string;
    stateProvince?: string;
  } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  feeds: PollableSourceFeed[];
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

interface PollableSourceDraft {
  name: string;
  family: PollableSourceSystem['family'];
  trustTier: PollableSourceSystem['trustTier'];
  homepageUrl: string;
  termsUrl: string;
  licenseNotes: string;
  hsdsProfileUri: string;
  notes: string;
  jurisdictionKind: string;
  country: string;
  stateProvince: string;
  isActive: boolean;
  feedName: string;
  feedType: string;
  feedHandler: PollableSourceFeed['feedHandler'];
  baseUrl: string;
  healthcheckUrl: string;
  authType: string;
  feedProfileUri: string;
  feedIsActive: boolean;
  refreshIntervalHours: string;
}

interface FeedRolloutDraft {
  isActive: boolean;
  publicationMode: 'canonical_only' | 'review_required' | 'auto_publish';
  autoPublishApproved: boolean;
  emergencyPause: boolean;
  includedDataOwners: string;
  excludedDataOwners: string;
  maxOrganizationsPerPoll: string;
  notes: string;
}

interface IngestionOverview {
  feeds: {
    activeSystems: number;
    activeFeeds: number;
    pausedFeeds: number;
    autoPublishFeeds: number;
    failedFeeds: number;
    runningFeeds: number;
    pendingSourceRecords: number;
    erroredSourceRecords: number;
  };
  jobs: {
    queued: number;
    running: number;
    failed: number;
    completed24h: number;
  };
  candidates: {
    pending: number;
    inReview: number;
    published: number;
    ready: number;
  };
  submissions: {
    submitted: number;
    underReview: number;
    pendingDecision: number;
    slaBreached: number;
  };
  publication: {
    lifecycleEvents24h: number;
    exportSnapshots24h: number;
    approvedSubmissions24h: number;
  };
}

const EMPTY_SOURCE_DRAFT: SourceDraft = {
  displayName: '',
  trustLevel: 'quarantine',
  domainValue: '',
  domainType: 'exact_host',
  seedUrl: '',
};

const EMPTY_POLLABLE_SOURCE_DRAFT: PollableSourceDraft = {
  name: '',
  family: 'partner_api',
  trustTier: 'trusted_partner',
  homepageUrl: '',
  termsUrl: '',
  licenseNotes: '',
  hsdsProfileUri: '',
  notes: '',
  jurisdictionKind: 'national',
  country: 'US',
  stateProvince: '',
  isActive: true,
  feedName: '',
  feedType: 'api',
  feedHandler: 'ndp_211',
  baseUrl: 'https://api.211.org/resources/v2',
  healthcheckUrl: '',
  authType: 'api_key',
  feedProfileUri: '',
  feedIsActive: true,
  refreshIntervalHours: '12',
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

const SOURCE_SYSTEM_TRUST_STYLES: Record<string, string> = {
  verified_publisher: 'bg-green-50 text-green-700 border-green-200',
  trusted_partner: 'bg-sky-50 text-sky-700 border-sky-200',
  curated: 'bg-teal-50 text-teal-700 border-teal-200',
  community: 'bg-gray-50 text-gray-700 border-gray-200',
  quarantine: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-error-subtle text-error-strong border-error-soft',
};

const ACTIVE_STATE_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  inactive: 'bg-gray-50 text-gray-600 border-gray-200',
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

function toCommaSeparated(values?: string[] | null): string {
  return Array.isArray(values) ? values.join(', ') : '';
}

function createFeedRolloutDraft(feed: PollableSourceFeed): FeedRolloutDraft {
  return {
    isActive: feed.isActive,
    publicationMode: feed.state?.publicationMode ?? 'review_required',
    autoPublishApproved: Boolean(feed.state?.autoPublishApprovedAt && feed.state?.autoPublishApprovedBy),
    emergencyPause: feed.state?.emergencyPause ?? false,
    includedDataOwners: toCommaSeparated(feed.state?.includedDataOwners),
    excludedDataOwners: toCommaSeparated(feed.state?.excludedDataOwners),
    maxOrganizationsPerPoll: feed.state?.maxOrganizationsPerPoll ? String(feed.state.maxOrganizationsPerPoll) : '',
    notes: feed.state?.notes ?? '',
  };
}

function OverviewCard({
  title,
  subtitle,
  metrics,
}: {
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg bg-gray-50 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">{metric.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ============================================================
// Sources Tab
// ============================================================

function SourcesTab() {
  const { success, error: showError } = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [pollableSourceSystems, setPollableSourceSystems] = useState<PollableSourceSystem[]>([]);
  const [overview, setOverview] = useState<IngestionOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [systemActiveDrafts, setSystemActiveDrafts] = useState<Record<string, boolean>>({});
  const [feedRolloutDrafts, setFeedRolloutDrafts] = useState<Record<string, FeedRolloutDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_SOURCE_DRAFT);
  const [pollableDraft, setPollableDraft] = useState<PollableSourceDraft>(EMPTY_POLLABLE_SOURCE_DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrapSubmitting, setIsBootstrapSubmitting] = useState(false);
  const [savingSystemId, setSavingSystemId] = useState<string | null>(null);
  const [savingFeedId, setSavingFeedId] = useState<string | null>(null);
  const [bulkActionSystemId, setBulkActionSystemId] = useState<string | null>(null);
  const [replayingFeedId, setReplayingFeedId] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setOverviewError(null);
    try {
      const [registryRes, sourceSystemsRes] = await Promise.all([
        fetch('/api/admin/ingestion/sources'),
        fetch('/api/admin/ingestion/source-systems'),
      ]);

      if (!registryRes.ok) throw new Error(`Failed to fetch sources (${registryRes.status})`);
      if (!sourceSystemsRes.ok) {
        throw new Error(`Failed to fetch source systems (${sourceSystemsRes.status})`);
      }

      const registryData = await registryRes.json();
      const sourceSystemsData = await sourceSystemsRes.json();
      const nextSystems = sourceSystemsData.sourceSystems ?? [];
      setSources(registryData.sources ?? []);
      setPollableSourceSystems(nextSystems);
      setSystemActiveDrafts(
        Object.fromEntries(nextSystems.map((system: PollableSourceSystem) => [system.id, system.isActive])),
      );
      setFeedRolloutDrafts(
        Object.fromEntries(
          nextSystems.flatMap((system: PollableSourceSystem) =>
            system.feeds.map((feed) => [feed.id, createFeedRolloutDraft(feed)]),
          ),
        ),
      );

      try {
        const overviewRes = await fetch('/api/admin/ingestion/overview');
        if (!overviewRes.ok) {
          throw new Error(`Failed to fetch overview (${overviewRes.status})`);
        }
        const overviewData = await overviewRes.json();
        setOverview(overviewData.overview ?? null);
      } catch (overviewFetchError) {
        setOverview(null);
        setOverviewError(
          overviewFetchError instanceof Error
            ? overviewFetchError.message
            : 'Failed to load ingestion overview',
        );
      }
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

  const handleCreatePollableSource = useCallback(async () => {
    const name = pollableDraft.name.trim();
    const feedName = pollableDraft.feedName.trim();
    const baseUrl = pollableDraft.baseUrl.trim();
    const refreshIntervalHours = Number.parseInt(pollableDraft.refreshIntervalHours, 10);
    const country = pollableDraft.country.trim().toUpperCase();
    const stateProvince = pollableDraft.stateProvince.trim();

    const jurisdictionScope = {
      kind: pollableDraft.jurisdictionKind || undefined,
      country: country || undefined,
      stateProvince: stateProvince || undefined,
    };

    if (!name || !feedName || !baseUrl || !Number.isFinite(refreshIntervalHours)) {
      setError('Source system name, feed name, base URL, and refresh interval are required.');
      return;
    }

    setIsBootstrapSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ingestion/source-systems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          family: pollableDraft.family,
          trustTier: pollableDraft.trustTier,
          homepageUrl: pollableDraft.homepageUrl.trim() || undefined,
          termsUrl: pollableDraft.termsUrl.trim() || undefined,
          licenseNotes: pollableDraft.licenseNotes.trim() || undefined,
          hsdsProfileUri: pollableDraft.hsdsProfileUri.trim() || undefined,
          notes: pollableDraft.notes.trim() || undefined,
          jurisdictionScope,
          isActive: pollableDraft.isActive,
          initialFeed: {
            feedName,
            feedType: pollableDraft.feedType.trim() || 'api',
            feedHandler: pollableDraft.feedHandler,
            baseUrl,
            healthcheckUrl: pollableDraft.healthcheckUrl.trim() || undefined,
            authType: pollableDraft.authType.trim() || undefined,
            profileUri: pollableDraft.feedProfileUri.trim() || undefined,
            jurisdictionScope,
            refreshIntervalHours,
            isActive: pollableDraft.feedIsActive,
          },
        }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to create pollable source system');
      }

      setPollableDraft(EMPTY_POLLABLE_SOURCE_DRAFT);
      success('Pollable source system created.');
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create pollable source system';
      setError(message);
      showError(message);
    } finally {
      setIsBootstrapSubmitting(false);
    }
  }, [fetchSources, pollableDraft, showError, success]);

  const handleSaveSourceSystem = useCallback(async (systemId: string) => {
    setSavingSystemId(systemId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ingestion/source-systems/${systemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: systemActiveDrafts[systemId] ?? true }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to update source system');
      }
      success('Source system updated.');
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update source system';
      setError(message);
      showError(message);
    } finally {
      setSavingSystemId(null);
    }
  }, [fetchSources, showError, success, systemActiveDrafts]);

  const handleSaveFeedRollout = useCallback(async (feedId: string) => {
    const draft = feedRolloutDrafts[feedId];
    if (!draft) return;

    setSavingFeedId(feedId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ingestion/source-feeds/${feedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: draft.isActive,
          state: {
            publicationMode: draft.publicationMode,
            autoPublishApproved: draft.autoPublishApproved,
            emergencyPause: draft.emergencyPause,
            includedDataOwners: draft.includedDataOwners
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
            excludedDataOwners: draft.excludedDataOwners
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
            maxOrganizationsPerPoll: draft.maxOrganizationsPerPoll
              ? Number.parseInt(draft.maxOrganizationsPerPoll, 10)
              : null,
            notes: draft.notes.trim() || null,
          },
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to update source feed');
      }
      success('Source feed controls updated.');
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update source feed';
      setError(message);
      showError(message);
    } finally {
      setSavingFeedId(null);
    }
  }, [feedRolloutDrafts, fetchSources, showError, success]);

  const handleReplayFeed = useCallback(async (feedId: string) => {
    setReplayingFeedId(feedId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/ingestion/source-feeds/${feedId}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to queue replay for source feed');
      }
      success('Feed replay queued from checkpoint.');
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to queue replay for source feed';
      setError(message);
      showError(message);
    } finally {
      setReplayingFeedId(null);
    }
  }, [fetchSources, showError, success]);

  const handleBulkSystemFeedAction = useCallback(async (
    systemId: string,
    feedIds: string[],
    payload: {
      isActive?: boolean;
      state?: {
        publicationMode?: FeedRolloutDraft['publicationMode'];
        emergencyPause?: boolean;
      };
      useCheckpointAsReplay?: boolean;
    },
    successMessage: string,
  ) => {
    if (feedIds.length === 0) return;

    setBulkActionSystemId(systemId);
    setError(null);
    try {
      const response = await fetch('/api/admin/ingestion/source-feeds/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedIds, ...payload }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to update system feed controls');
      }
      success(successMessage);
      await fetchSources();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update system feed controls';
      setError(message);
      showError(message);
    } finally {
      setBulkActionSystemId(null);
    }
  }, [fetchSources, showError, success]);

  if (isLoading) return <SkeletonCard />;
  if (error) {
    return (
      <div className="space-y-3">
        <FormAlert variant="error" message={error} />
        <Button variant="outline" size="sm" onClick={fetchSources}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Cross-family operations overview</p>
            <p className="mt-1 text-sm text-gray-600">
              Read-only summary of feed health, candidate flow, review backlog, and recent publication activity.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchSources}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Refresh all
          </Button>
        </div>
        {overviewError ? <FormAlert variant="error" message={overviewError} /> : null}
        {overview ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <OverviewCard
              title="Feed governance"
              subtitle="Structured source polling and assertion health."
              metrics={[
                { label: 'Active feeds', value: overview.feeds.activeFeeds },
                { label: 'Paused feeds', value: overview.feeds.pausedFeeds },
                { label: 'Failed feeds', value: overview.feeds.failedFeeds },
              ]}
            />
            <OverviewCard
              title="Candidate pipeline"
              subtitle="Queue and job activity across discovery and extraction runs."
              metrics={[
                { label: 'Queued jobs', value: overview.jobs.queued },
                { label: 'Running jobs', value: overview.jobs.running },
                { label: 'Failed jobs', value: overview.jobs.failed },
              ]}
            />
            <OverviewCard
              title="Review backlog"
              subtitle="Current cross-family human-governance workload."
              metrics={[
                { label: 'Pending candidates', value: overview.candidates.pending },
                { label: 'Pending submissions', value: overview.submissions.pendingDecision },
                { label: 'SLA breached', value: overview.submissions.slaBreached },
              ]}
            />
            <OverviewCard
              title="Recent publication"
              subtitle="Signals that seeker-visible state has changed in the last 24 hours."
              metrics={[
                { label: 'Ready candidates', value: overview.candidates.ready },
                { label: 'Live events 24h', value: overview.publication.lifecycleEvents24h },
                { label: 'Snapshots 24h', value: overview.publication.exportSnapshots24h },
              ]}
            />
          </div>
        ) : overviewError ? null : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
            Overview data unavailable.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-900">Register pollable source system</p>
          <p className="mt-1 text-sm text-gray-600">
            Bootstrap a structured source system plus its initial pollable feed for HSDS or 211 ingestion.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Source system name" id="pollable-source-name" required>
            <input
              type="text"
              value={pollableDraft.name}
              onChange={(event) => setPollableDraft((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Family" id="pollable-source-family" required>
            <select
              value={pollableDraft.family}
              onChange={(event) => setPollableDraft((current) => ({ ...current, family: event.target.value as PollableSourceDraft['family'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="partner_api">Partner API</option>
              <option value="hsds_api">HSDS API</option>
              <option value="government_open_data">Government open data</option>
              <option value="partner_export">Partner export</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          <FormField label="Trust tier" id="pollable-source-trust-tier" required>
            <select
              value={pollableDraft.trustTier}
              onChange={(event) => setPollableDraft((current) => ({ ...current, trustTier: event.target.value as PollableSourceDraft['trustTier'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="verified_publisher">Verified publisher</option>
              <option value="trusted_partner">Trusted partner</option>
              <option value="curated">Curated</option>
              <option value="community">Community</option>
              <option value="quarantine">Quarantine</option>
              <option value="blocked">Blocked</option>
            </select>
          </FormField>
          <FormField label="Homepage URL" id="pollable-source-homepage-url">
            <input
              type="url"
              value={pollableDraft.homepageUrl}
              onChange={(event) => setPollableDraft((current) => ({ ...current, homepageUrl: event.target.value }))}
              placeholder="https://apiportal.211.org/"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="System status" id="pollable-source-system-active" hint="Inactive systems stay registered but do not participate in polling.">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={pollableDraft.isActive}
                onChange={(event) => setPollableDraft((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active
            </label>
          </FormField>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Terms URL" id="pollable-source-terms-url">
            <input
              type="url"
              value={pollableDraft.termsUrl}
              onChange={(event) => setPollableDraft((current) => ({ ...current, termsUrl: event.target.value }))}
              placeholder="https://apiportal.211.org/terms"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="HSDS / profile URI" id="pollable-source-profile-uri">
            <input
              type="url"
              value={pollableDraft.hsdsProfileUri}
              onChange={(event) => setPollableDraft((current) => ({ ...current, hsdsProfileUri: event.target.value }))}
              placeholder="https://api.211.org/hsds-profile"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="License notes" id="pollable-source-license-notes">
            <input
              type="text"
              value={pollableDraft.licenseNotes}
              onChange={(event) => setPollableDraft((current) => ({ ...current, licenseNotes: event.target.value }))}
              placeholder="Licensed for ORAN ingestion and governed publication review"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Notes" id="pollable-source-notes">
            <input
              type="text"
              value={pollableDraft.notes}
              onChange={(event) => setPollableDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Operational notes for staging / production rollout"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Jurisdiction kind" id="pollable-source-jurisdiction-kind">
            <select
              value={pollableDraft.jurisdictionKind}
              onChange={(event) => setPollableDraft((current) => ({ ...current, jurisdictionKind: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="national">National</option>
              <option value="statewide">Statewide</option>
              <option value="regional">Regional</option>
              <option value="local">Local</option>
              <option value="virtual">Virtual</option>
            </select>
          </FormField>
          <FormField label="Country" id="pollable-source-country">
            <input
              type="text"
              value={pollableDraft.country}
              onChange={(event) => setPollableDraft((current) => ({ ...current, country: event.target.value }))}
              placeholder="US"
              maxLength={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm uppercase"
            />
          </FormField>
          <FormField label="State / province" id="pollable-source-state-province">
            <input
              type="text"
              value={pollableDraft.stateProvince}
              onChange={(event) => setPollableDraft((current) => ({ ...current, stateProvince: event.target.value }))}
              placeholder="CA"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Feed name" id="pollable-source-feed-name" required>
            <input
              type="text"
              value={pollableDraft.feedName}
              onChange={(event) => setPollableDraft((current) => ({ ...current, feedName: event.target.value }))}
              placeholder="211 Export V2"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Feed type" id="pollable-source-feed-type" required>
            <input
              type="text"
              value={pollableDraft.feedType}
              onChange={(event) => setPollableDraft((current) => ({ ...current, feedType: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Feed handler" id="pollable-source-feed-handler" required>
            <select
              value={pollableDraft.feedHandler}
              onChange={(event) => setPollableDraft((current) => ({ ...current, feedHandler: event.target.value as PollableSourceDraft['feedHandler'] }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="ndp_211">211 NDP</option>
              <option value="hsds_api">HSDS API</option>
              <option value="azure_function">Azure Function</option>
              <option value="none">None</option>
            </select>
          </FormField>
          <FormField label="Refresh interval (hours)" id="pollable-source-refresh-interval" required>
            <input
              type="number"
              min={1}
              max={720}
              value={pollableDraft.refreshIntervalHours}
              onChange={(event) => setPollableDraft((current) => ({ ...current, refreshIntervalHours: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Auth type" id="pollable-source-auth-type">
            <input
              type="text"
              value={pollableDraft.authType}
              onChange={(event) => setPollableDraft((current) => ({ ...current, authType: event.target.value }))}
              placeholder="api_key"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Feed status" id="pollable-source-feed-active">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={pollableDraft.feedIsActive}
                onChange={(event) => setPollableDraft((current) => ({ ...current, feedIsActive: event.target.checked }))}
              />
              Active
            </label>
          </FormField>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <FormField label="Base URL" id="pollable-source-base-url" required hint="Example: https://api.211.org/resources/v2">
            <input
              type="url"
              value={pollableDraft.baseUrl}
              onChange={(event) => setPollableDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Healthcheck URL" id="pollable-source-healthcheck-url">
            <input
              type="url"
              value={pollableDraft.healthcheckUrl}
              onChange={(event) => setPollableDraft((current) => ({ ...current, healthcheckUrl: event.target.value }))}
              placeholder="https://api.211.org/health"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Feed profile URI" id="pollable-source-feed-profile-uri">
            <input
              type="url"
              value={pollableDraft.feedProfileUri}
              onChange={(event) => setPollableDraft((current) => ({ ...current, feedProfileUri: event.target.value }))}
              placeholder="https://api.211.org/profile"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </FormField>
          <div className="flex items-end">
            <Button type="button" onClick={() => void handleCreatePollableSource()} disabled={isBootstrapSubmitting}>
              {isBootstrapSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create pollable source
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Pollable source systems</p>
            <p className="mt-1 text-sm text-gray-600">
              Structured feed sources that the unified poller can fetch and normalize.
            </p>
          </div>
          <span className="text-sm text-gray-600">
            {pollableSourceSystems.length} system{pollableSourceSystems.length !== 1 ? 's' : ''}
          </span>
        </div>
        {pollableSourceSystems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No pollable source systems configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <caption className="sr-only">Pollable source systems</caption>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">System</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Family</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Trust</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Feeds</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {pollableSourceSystems.map((system) => (
                  <tr key={system.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{system.name}</div>
                      {system.homepageUrl ? (
                        <div className="mt-1 text-xs text-gray-500">{system.homepageUrl}</div>
                      ) : null}
                      {system.notes ? <div className="mt-1 text-xs text-gray-500">{system.notes}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <StatusBadge status={system.isActive ? 'active' : 'inactive'} styles={ACTIVE_STATE_STYLES} />
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={systemActiveDrafts[system.id] ?? system.isActive}
                            onChange={(event) => setSystemActiveDrafts((current) => ({
                              ...current,
                              [system.id]: event.target.checked,
                            }))}
                          />
                          Pollable
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingSystemId === system.id}
                          onClick={() => void handleSaveSourceSystem(system.id)}
                        >
                          {savingSystemId === system.id ? 'Saving…' : 'Save system'}
                        </Button>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={bulkActionSystemId === system.id}
                            onClick={() => void handleBulkSystemFeedAction(
                              system.id,
                              system.feeds.map((feed) => feed.id),
                              { state: { emergencyPause: true } },
                              'All system feeds paused.',
                            )}
                          >
                            Pause all feeds
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={bulkActionSystemId === system.id}
                            onClick={() => void handleBulkSystemFeedAction(
                              system.id,
                              system.feeds.map((feed) => feed.id),
                              { state: { emergencyPause: false, publicationMode: 'review_required' } },
                              'All system feeds returned to review-required polling.',
                            )}
                          >
                            Review all feeds
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={bulkActionSystemId === system.id}
                            onClick={() => void handleBulkSystemFeedAction(
                              system.id,
                              system.feeds.map((feed) => feed.id),
                              { useCheckpointAsReplay: true },
                              'Replay queued for all system feeds.',
                            )}
                          >
                            Replay all feeds
                          </Button>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{system.family.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={system.trustTier} styles={SOURCE_SYSTEM_TRUST_STYLES} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="space-y-2">
                        {system.feeds.map((feed) => (
                          <div key={feed.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            {(() => {
                              const rolloutDraft = feedRolloutDrafts[feed.id] ?? createFeedRolloutDraft(feed);
                              return (
                                <>
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-gray-900">{feed.feedName}</div>
                              <StatusBadge status={feed.isActive ? 'active' : 'inactive'} styles={ACTIVE_STATE_STYLES} />
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {feed.feedHandler} · {feed.feedType} · every {feed.refreshIntervalHours ?? '?'}h
                            </div>
                            {feed.baseUrl ? <div className="mt-1 text-xs text-gray-500">{feed.baseUrl}</div> : null}
                            {feed.profileUri ? <div className="mt-1 text-xs text-gray-500">Profile: {feed.profileUri}</div> : null}
                            {feed.jurisdictionScope?.kind || feed.jurisdictionScope?.country || feed.jurisdictionScope?.stateProvince ? (
                              <div className="mt-1 text-xs text-gray-500">
                                Scope: {[feed.jurisdictionScope?.kind, feed.jurisdictionScope?.stateProvince, feed.jurisdictionScope?.country].filter(Boolean).join(' · ')}
                              </div>
                            ) : null}
                            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              <FormField label="Feed active" id={`feed-active-${feed.id}`}>
                                <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={rolloutDraft.isActive}
                                    onChange={(event) => setFeedRolloutDrafts((current) => ({
                                      ...current,
                                      [feed.id]: { ...rolloutDraft, isActive: event.target.checked },
                                    }))}
                                  />
                                  Enabled for polling
                                </label>
                              </FormField>
                              <FormField label="Publication mode" id={`feed-publication-mode-${feed.id}`}>
                                <select
                                  value={rolloutDraft.publicationMode}
                                  onChange={(event) => setFeedRolloutDrafts((current) => ({
                                    ...current,
                                    [feed.id]: {
                                      ...rolloutDraft,
                                      publicationMode: event.target.value as FeedRolloutDraft['publicationMode'],
                                      autoPublishApproved:
                                        event.target.value === 'auto_publish'
                                          ? rolloutDraft.autoPublishApproved
                                          : false,
                                    },
                                  }))}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
                                >
                                  <option value="canonical_only">Canonical only</option>
                                  <option value="review_required">Review required</option>
                                  <option value="auto_publish">Auto publish</option>
                                </select>
                              </FormField>
                              <FormField
                                label="Auto-publish approval"
                                id={`feed-auto-publish-approved-${feed.id}`}
                                hint="Required before auto-publish can promote canonical records into live tables. Scope changes clear approval."
                              >
                                <div className="space-y-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700">
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      aria-label="Approve this feed for auto-publish"
                                      checked={rolloutDraft.autoPublishApproved}
                                      disabled={rolloutDraft.publicationMode !== 'auto_publish'}
                                      onChange={(event) => setFeedRolloutDrafts((current) => ({
                                        ...current,
                                        [feed.id]: { ...rolloutDraft, autoPublishApproved: event.target.checked },
                                      }))}
                                    />
                                    Explicitly approve this feed for auto-publish
                                  </label>
                                  <div className="text-[11px] text-gray-500">
                                    {feed.state?.autoPublishApprovedAt && feed.state?.autoPublishApprovedBy
                                      ? `Current approval: ${feed.state.autoPublishApprovedBy} on ${formatDateSafe(feed.state.autoPublishApprovedAt)}`
                                      : 'No active auto-publish approval recorded.'}
                                  </div>
                                </div>
                              </FormField>
                              <FormField label="Emergency pause" id={`feed-emergency-pause-${feed.id}`}>
                                <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={rolloutDraft.emergencyPause}
                                    onChange={(event) => setFeedRolloutDrafts((current) => ({
                                      ...current,
                                      [feed.id]: { ...rolloutDraft, emergencyPause: event.target.checked },
                                    }))}
                                  />
                                  Pause scheduled polling
                                </label>
                              </FormField>
                              <FormField label="Include data owners" id={`feed-included-owners-${feed.id}`} hint="Comma-separated canary scope.">
                                <input
                                  type="text"
                                  value={rolloutDraft.includedDataOwners}
                                  onChange={(event) => setFeedRolloutDrafts((current) => ({
                                    ...current,
                                    [feed.id]: { ...rolloutDraft, includedDataOwners: event.target.value },
                                  }))}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
                                />
                              </FormField>
                              <FormField label="Exclude data owners" id={`feed-excluded-owners-${feed.id}`} hint="Comma-separated exclusions.">
                                <input
                                  type="text"
                                  value={rolloutDraft.excludedDataOwners}
                                  onChange={(event) => setFeedRolloutDrafts((current) => ({
                                    ...current,
                                    [feed.id]: { ...rolloutDraft, excludedDataOwners: event.target.value },
                                  }))}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
                                />
                              </FormField>
                              <FormField label="Max orgs / poll" id={`feed-max-orgs-${feed.id}`} hint="Blank keeps connector default.">
                                <input
                                  type="number"
                                  min={1}
                                  max={1000}
                                  value={rolloutDraft.maxOrganizationsPerPoll}
                                  onChange={(event) => setFeedRolloutDrafts((current) => ({
                                    ...current,
                                    [feed.id]: { ...rolloutDraft, maxOrganizationsPerPoll: event.target.value },
                                  }))}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
                                />
                              </FormField>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                              <FormField label="Rollout notes" id={`feed-rollout-notes-${feed.id}`} hint="Operator notes stored with the feed state.">
                                <input
                                  type="text"
                                  value={rolloutDraft.notes}
                                  onChange={(event) => setFeedRolloutDrafts((current) => ({
                                    ...current,
                                    [feed.id]: { ...rolloutDraft, notes: event.target.value },
                                  }))}
                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
                                />
                              </FormField>
                              <div className="flex items-end">
                                <div className="flex flex-wrap items-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={savingFeedId === feed.id}
                                    onClick={() => void handleSaveFeedRollout(feed.id)}
                                  >
                                    {savingFeedId === feed.id ? 'Saving…' : 'Save feed controls'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={replayingFeedId === feed.id}
                                    onClick={() => void handleReplayFeed(feed.id)}
                                  >
                                    {replayingFeedId === feed.id ? 'Queueing…' : 'Replay from checkpoint'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                            {(feed.state?.lastAttemptStatus || feed.state?.checkpointCursor || feed.state?.replayFromCursor) ? (
                              <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-white px-3 py-2 text-[11px] text-gray-600">
                                <div>Status: {feed.state?.lastAttemptStatus ?? 'idle'}</div>
                                <div>Checkpoint: {feed.state?.checkpointCursor ?? 'none'}</div>
                                <div>Replay from: {feed.state?.replayFromCursor ?? 'none'}</div>
                              </div>
                            ) : null}
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDateSafe(system.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
      {sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          No ingestion registry sources configured yet.
        </div>
      ) : (
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
      )}
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
              className={`inline-flex min-h-[44px] items-center px-3 rounded-md text-xs font-medium transition-colors ${
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
                className={`inline-flex min-h-[44px] items-center px-2.5 rounded-md text-xs font-medium transition-colors ${
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
                className={`inline-flex min-h-[44px] items-center px-2.5 rounded-md text-xs font-medium transition-colors ${
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
