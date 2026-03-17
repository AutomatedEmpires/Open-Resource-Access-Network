/**
 * Fast-track auto-publish policy engine.
 *
 * Evaluates canonical services for automatic promotion to live tables
 * based on source trust tier and canonical entity lifecycle/publication status.
 *
 * Policy rules:
 *  - Source system trust tier must be explicitly eligible for auto-publish
 *  - Canonical service lifecycle must be 'active'
 *  - Publication status must be 'unpublished' or 'published' (re-publish)
 *  - For 'trusted_partner' sources, a higher minimum confidence threshold applies
 *  - For 'curated' sources, a minimum confidence threshold applies
 *
 * This module is intended to be called after normalizeSourceRecord() creates
 * or refreshes canonical entities.
 */

import { promoteToLive } from './promoteToLive';
import type { IngestionStores } from './stores';
import type { CanonicalServiceRow, SourceSystemRow } from '@/db/schema';

// ── Policy configuration ──────────────────────────────────────

export interface AutoPublishPolicy {
  /** Trust tiers eligible for auto-publish (default: verified_publisher, curated). */
  eligibleTiers: string[];
  /** Minimum confidence (from sourceConfidenceSummary.overall) for trusted_partner sources. */
  trustedPartnerMinConfidence: number;
  /** Minimum confidence (from sourceConfidenceSummary.overall) for curated sources. */
  curatedMinConfidence: number;
  /** Minimum confidence for verified_publisher sources (default 60). */
  verifiedPublisherMinConfidence: number;
  /** Whether to auto-re-publish already-published services on refresh. */
  allowRepublish: boolean;
}

const DEFAULT_POLICY: AutoPublishPolicy = {
  eligibleTiers: ['verified_publisher', 'curated'],
  trustedPartnerMinConfidence: 90,
  curatedMinConfidence: 70,
  verifiedPublisherMinConfidence: 60,
  allowRepublish: true,
};

// ── Public types ──────────────────────────────────────────────

export interface AutoPublishCandidate {
  canonicalService: CanonicalServiceRow;
  sourceSystem: SourceSystemRow;
}

export type AutoPublishDecision = {
  canonicalServiceId: string;
} & (
  | { eligible: true; reason: string }
  | { eligible: false; reason: string }
);

export interface AutoPublishResult {
  evaluated: number;
  published: number;
  skipped: number;
  decisions: AutoPublishDecision[];
  errors: Array<{ canonicalServiceId: string; error: string }>;
}

export interface AutoPublishOptions {
  stores: IngestionStores;
  /** Canonical service IDs to evaluate. If empty, auto-discovers unpublished services. */
  canonicalServiceIds?: string[];
  /** Override default policy. */
  policy?: Partial<AutoPublishPolicy>;
  /** Actor for audit trail. */
  actorId?: string;
  /** Max services to process in one run. */
  limit?: number;
}

// ── Policy evaluation ─────────────────────────────────────────

export function evaluatePolicy(
  service: CanonicalServiceRow,
  sourceSystem: SourceSystemRow,
  policy: AutoPublishPolicy
): AutoPublishDecision {
  const svcId = service.id;

  // Gate 1: Lifecycle must be active
  if (service.lifecycleStatus !== 'active') {
    return { canonicalServiceId: svcId, eligible: false, reason: `lifecycle_status is '${service.lifecycleStatus}', expected 'active'` };
  }

  // Gate 2: Publication status check
  if (service.publicationStatus === 'published' && !policy.allowRepublish) {
    return { canonicalServiceId: svcId, eligible: false, reason: 'already published and republish not allowed' };
  }
  if (service.publicationStatus !== 'unpublished' && service.publicationStatus !== 'published') {
    return { canonicalServiceId: svcId, eligible: false, reason: `publication_status is '${service.publicationStatus}', expected 'unpublished' or 'published'` };
  }

  // Gate 3: Trust tier eligibility
  if (!policy.eligibleTiers.includes(sourceSystem.trustTier)) {
    return { canonicalServiceId: svcId, eligible: false, reason: `trust_tier '${sourceSystem.trustTier}' not in eligible tiers` };
  }

  // Gate 4: Confidence thresholds — ALL tiers must meet a minimum
  const summary = service.sourceConfidenceSummary as Record<string, unknown> | null;
  const rawOverall = typeof summary?.overall === 'number' ? summary.overall : 0;
  // Clamp to 0-100 to reject inflated values
  const overall = Math.max(0, Math.min(100, rawOverall));

  if (sourceSystem.trustTier === 'trusted_partner') {
    if (overall < policy.trustedPartnerMinConfidence) {
      return {
        canonicalServiceId: svcId,
        eligible: false,
        reason: `trusted_partner source confidence ${overall} < minimum ${policy.trustedPartnerMinConfidence}`,
      };
    }
  }

  if (sourceSystem.trustTier === 'curated') {
    if (overall < policy.curatedMinConfidence) {
      return { canonicalServiceId: svcId, eligible: false, reason: `curated source confidence ${overall} < minimum ${policy.curatedMinConfidence}` };
    }
  }

  if (sourceSystem.trustTier === 'verified_publisher') {
    if (overall < policy.verifiedPublisherMinConfidence) {
      return {
        canonicalServiceId: svcId,
        eligible: false,
        reason: `verified_publisher source confidence ${overall} < minimum ${policy.verifiedPublisherMinConfidence}`,
      };
    }
  }

  const isRepublish = service.publicationStatus === 'published';
  return {
    canonicalServiceId: svcId,
    eligible: true,
    reason: isRepublish
      ? `auto-republish: ${sourceSystem.trustTier} source, lifecycle active`
      : `auto-publish: ${sourceSystem.trustTier} source, lifecycle active`,
  };
}

// ── Main entry point ──────────────────────────────────────────

/**
 * Auto-publish eligible canonical services based on configurable policy.
 *
 * **External dependency**: each `CanonicalServiceRow` must have its
 * `winningSourceSystemId` populated (set during entity resolution or
 * ingestion normalization). Services without this field are skipped.
 */
export async function autoPublish(options: AutoPublishOptions): Promise<AutoPublishResult> {
  const { stores, actorId = 'system:auto-publish' } = options;
  const policy: AutoPublishPolicy = { ...DEFAULT_POLICY, ...options.policy };
  const limit = options.limit ?? 100;

  // Gather candidate services
  let services: CanonicalServiceRow[];
  if (options.canonicalServiceIds && options.canonicalServiceIds.length > 0) {
    const results = await Promise.all(
      options.canonicalServiceIds.map(id => stores.canonicalServices.getById(id))
    );
    services = results.filter((s): s is CanonicalServiceRow => s !== null);
  } else {
    // Discover unpublished active services
    services = await stores.canonicalServices.listByLifecycle('active', limit);
  }

  const decisions: AutoPublishDecision[] = [];
  const errors: Array<{ canonicalServiceId: string; error: string }> = [];
  let published = 0;
  let skipped = 0;

  for (const svc of services) {
    // Resolve the winning source system
    if (!svc.winningSourceSystemId) {
      decisions.push({
        canonicalServiceId: svc.id,
        eligible: false,
        reason: 'no winning source system assigned',
      });
      skipped++;
      continue;
    }

    const sourceSystem = await stores.sourceSystems.getById(svc.winningSourceSystemId);
    if (!sourceSystem) {
      decisions.push({
        canonicalServiceId: svc.id,
        eligible: false,
        reason: `winning source system ${svc.winningSourceSystemId} not found`,
      });
      skipped++;
      continue;
    }

    const decision = evaluatePolicy(svc, sourceSystem, policy);
    decisions.push(decision);

    if (!decision.eligible) {
      skipped++;
      continue;
    }

    // Auto-promote
    try {
      await promoteToLive({
        stores,
        canonicalServiceId: svc.id,
        actorId,
      });
      published++;
    } catch (err) {
      errors.push({
        canonicalServiceId: svc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  return {
    evaluated: services.length,
    published,
    skipped,
    decisions,
    errors,
  };
}
