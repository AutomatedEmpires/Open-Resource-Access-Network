/**
 * ORAN Feature Flags Service
 *
 * Enterprise behavior:
 * - Database is authoritative when available.
 * - In-memory fallback preserves local/dev usability when DATABASE_URL is absent.
 * - Unknown flags fail closed.
 * - Partial rollouts are deterministic when a subject key is provided.
 */

import type { FeatureFlag } from '@/domain/types';
import { FEATURE_FLAGS } from '@/domain/constants';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';

export type FlagServiceImplementation = 'database' | 'in_memory';

export interface FlagUpdateOptions {
  actorUserId?: string;
  actorRole?: string;
  reason?: string;
}

export interface FlagService {
  isEnabled(flagName: string, subjectKey?: string): Promise<boolean>;
  getFlag(flagName: string): Promise<FeatureFlag | null>;
  setFlag(
    flagName: string,
    enabled: boolean,
    rolloutPct?: number,
    options?: FlagUpdateOptions,
  ): Promise<void>;
  getAllFlags(): Promise<FeatureFlag[]>;
}

interface FeatureFlagRow {
  id: string;
  name: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const FLAG_CACHE_TTL_MS = 5_000;

/**
 * These flags still point exclusively at retired Microsoft adapters. Database
 * state cannot reactivate them; a reviewed non-Microsoft implementation must
 * remove the corresponding name from this set as part of its release.
 */
const PROVIDER_BLOCKED_FLAGS = new Set<string>([
  FEATURE_FLAGS.LLM_SUMMARIZE,
  FEATURE_FLAGS.CONTENT_SAFETY_CRISIS,
  FEATURE_FLAGS.VECTOR_SEARCH,
  FEATURE_FLAGS.LLM_INTENT_ENRICH,
  FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS,
  FEATURE_FLAGS.TTS_SUMMARIES,
  FEATURE_FLAGS.LLM_ADMIN_ASSIST,
  FEATURE_FLAGS.LLM_FEEDBACK_TRIAGE,
  FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE,
]);

function normalizeRolloutPct(rolloutPct: number | undefined): number {
  if (typeof rolloutPct !== 'number' || Number.isNaN(rolloutPct)) return 0;
  const clamped = Math.max(0, Math.min(100, rolloutPct));
  return Math.trunc(clamped);
}

function cloneFlag(flag: FeatureFlag): FeatureFlag {
  const providerBlocked = PROVIDER_BLOCKED_FLAGS.has(flag.name);
  return {
    ...flag,
    enabled: providerBlocked ? false : flag.enabled,
    rolloutPct: providerBlocked ? 0 : flag.rolloutPct,
    createdAt: new Date(flag.createdAt),
    updatedAt: new Date(flag.updatedAt),
  };
}

function makeFlag(
  name: string,
  enabled: boolean,
  rolloutPct = 0,
  description?: string | null,
): FeatureFlag {
  const now = new Date();
  return {
    id: `flag-${name}`,
    name,
    enabled,
    rolloutPct: normalizeRolloutPct(rolloutPct),
    description: description ?? null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

const DEFAULT_FLAGS: FeatureFlag[] = [
  makeFlag(
    FEATURE_FLAGS.LLM_SUMMARIZE,
    false,
    0,
    'Enable LLM post-retrieval summarization using stored records only.',
  ),
  makeFlag(FEATURE_FLAGS.MAP_ENABLED, true, 100, 'Expose the seeker map and geospatial discovery features.'),
  makeFlag(FEATURE_FLAGS.FEEDBACK_FORM, true, 100, 'Allow seeker feedback/report submission flows.'),
  makeFlag(FEATURE_FLAGS.HOST_CLAIMS, true, 100, 'Allow organizations to submit host claims.'),
  makeFlag(FEATURE_FLAGS.TWO_PERSON_APPROVAL, false, 0, 'Require distinct reviewers for high-risk approval flows.'),
  makeFlag(FEATURE_FLAGS.SLA_ENFORCEMENT, false, 0, 'Enable workflow SLA enforcement side effects.'),
  makeFlag(FEATURE_FLAGS.AUTO_CHECK_GATE, false, 0, 'Allow automated gate checks to advance submissions.'),
  makeFlag(FEATURE_FLAGS.NOTIFICATIONS_IN_APP, true, 100, 'Enable in-app notification surfaces and events.'),
  makeFlag(
    FEATURE_FLAGS.CONTENT_SAFETY_CRISIS,
    false,
    0,
    'Reserved for a reviewed non-Microsoft second-layer crisis safety provider.',
  ),
  makeFlag(FEATURE_FLAGS.VECTOR_SEARCH, false, 0, 'Enable pgvector-backed semantic search and re-ranking.'),
  makeFlag(FEATURE_FLAGS.LLM_INTENT_ENRICH, false, 0, 'Enable LLM-based intent enrichment for ambiguous chat queries.'),
  makeFlag(FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS, false, 0, 'Enable translated service descriptions post-retrieval.'),
  makeFlag(FEATURE_FLAGS.TTS_SUMMARIES, false, 0, 'Enable spoken summaries after a provider review.'),
  makeFlag(FEATURE_FLAGS.LLM_ADMIN_ASSIST, false, 0, 'Enable LLM-assisted admin review suggestions.'),
  makeFlag(FEATURE_FLAGS.LLM_FEEDBACK_TRIAGE, false, 0, 'Enable LLM classification of submitted feedback comments.'),
  makeFlag(FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE, false, 0, 'Enable PDF intake parsing after a provider review.'),
  makeFlag(FEATURE_FLAGS.TELEMETRY_INTERACTIONS, false, 0, 'Enable privacy-safe UI breadcrumb telemetry.'),
  makeFlag(FEATURE_FLAGS.SEEKER_PLANS_ENABLED, false, 0, 'Enable the local-first seeker execution plan workspace and linked plan actions.'),
  makeFlag(FEATURE_FLAGS.SEEKER_REMINDERS_ENABLED, false, 0, 'Enable seeker reminder scheduling for plan items.'),
  makeFlag(FEATURE_FLAGS.SEEKER_ROUTE_FEASIBILITY_ENABLED, false, 0, 'Enable route-feasibility guidance for seeker execution items.'),
  makeFlag(FEATURE_FLAGS.SEEKER_EXECUTION_DASHBOARD_ENABLED, false, 0, 'Enable expanded dashboard summaries for seeker execution progress.'),
];

function getDefaultFlag(flagName: string): FeatureFlag | null {
  const match = DEFAULT_FLAGS.find((flag) => flag.name === flagName);
  return match ? cloneFlag(match) : null;
}

function createFlagMap(flags: FeatureFlag[]): Map<string, FeatureFlag> {
  return new Map(flags.map((flag) => [flag.name, cloneFlag(flag)]));
}

function mapRowToFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    rolloutPct: normalizeRolloutPct(row.rollout_pct),
    description: row.description,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mergeWithDefaultCatalog(rows: FeatureFlagRow[]): FeatureFlag[] {
  const flags = createFlagMap(DEFAULT_FLAGS);
  for (const row of rows) {
    flags.set(row.name, mapRowToFeatureFlag(row));
  }

  return Array.from(flags.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function hashBucket(subjectKey: string, flagName: string): number {
  const input = `${flagName}:${subjectKey}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0) % 100;
}

function evaluateFlag(flag: FeatureFlag | null, subjectKey?: string): boolean {
  if (!flag || !flag.enabled) return false;
  if (PROVIDER_BLOCKED_FLAGS.has(flag.name)) return false;
  if (flag.rolloutPct <= 0) return false;
  if (flag.rolloutPct >= 100) return true;
  if (!subjectKey) return false;
  return hashBucket(subjectKey, flag.name) < flag.rolloutPct;
}

export class InMemoryFlagService implements FlagService {
  private readonly store: Map<string, FeatureFlag>;

  constructor(initialFlags?: FeatureFlag[]) {
    this.store = createFlagMap(initialFlags ?? DEFAULT_FLAGS);
  }

  async isEnabled(flagName: string, subjectKey?: string): Promise<boolean> {
    const flag = this.store.get(flagName);
    return evaluateFlag(flag ? cloneFlag(flag) : null, subjectKey);
  }

  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    const flag = this.store.get(flagName);
    return flag ? cloneFlag(flag) : null;
  }

  async setFlag(
    flagName: string,
    enabled: boolean,
    rolloutPct = 100,
    options: FlagUpdateOptions = {},
  ): Promise<void> {
    const providerBlocked = PROVIDER_BLOCKED_FLAGS.has(flagName);
    const effectiveEnabled = providerBlocked ? false : enabled;
    const effectiveRolloutPct = providerBlocked ? 0 : normalizeRolloutPct(rolloutPct);
    const existing = this.store.get(flagName);
    const defaultFlag = getDefaultFlag(flagName);
    const now = new Date();
    const actorUserId = options.actorUserId ?? null;
    this.store.set(flagName, {
      id: existing?.id ?? defaultFlag?.id ?? `flag-${flagName}`,
      name: flagName,
      enabled: effectiveEnabled,
      rolloutPct: effectiveRolloutPct,
      description: existing?.description ?? defaultFlag?.description ?? null,
      createdByUserId: existing?.createdByUserId ?? defaultFlag?.createdByUserId ?? actorUserId,
      updatedByUserId: actorUserId ?? existing?.updatedByUserId ?? defaultFlag?.updatedByUserId ?? null,
      createdAt: existing?.createdAt ?? defaultFlag?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    return Array.from(this.store.values(), cloneFlag).sort((left, right) => left.name.localeCompare(right.name));
  }

  replaceAll(flags: FeatureFlag[]): void {
    this.store.clear();
    for (const flag of flags) {
      this.store.set(flag.name, cloneFlag(flag));
    }
  }
}

export class HybridFlagService implements FlagService {
  private readonly fallback: InMemoryFlagService;
  private cache:
    | { implementation: FlagServiceImplementation; flags: FeatureFlag[]; expiresAt: number }
    | null = null;

  constructor(fallback?: InMemoryFlagService) {
    this.fallback = fallback ?? new InMemoryFlagService();
  }

  private invalidateCache(): void {
    this.cache = null;
  }

  private async readFlagsFromSource(force = false): Promise<{
    implementation: FlagServiceImplementation;
    flags: FeatureFlag[];
  }> {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) {
      return {
        implementation: this.cache.implementation,
        flags: this.cache.flags.map(cloneFlag),
      };
    }

    if (!isDatabaseConfigured()) {
      const flags = await this.fallback.getAllFlags();
      this.cache = {
        implementation: 'in_memory',
        flags: flags.map(cloneFlag),
        expiresAt: Date.now() + FLAG_CACHE_TTL_MS,
      };
      return { implementation: 'in_memory', flags };
    }

    try {
      const rows = await executeQuery<FeatureFlagRow>(
        `SELECT id, name, enabled, rollout_pct, description, created_by_user_id,
                updated_by_user_id, created_at, updated_at
         FROM feature_flags`,
        [],
      );
      const flags = mergeWithDefaultCatalog(rows);
      this.fallback.replaceAll(flags);
      this.cache = {
        implementation: 'database',
        flags: flags.map(cloneFlag),
        expiresAt: Date.now() + FLAG_CACHE_TTL_MS,
      };
      return { implementation: 'database', flags };
    } catch {
      if (this.cache?.implementation === 'database') {
        this.cache = {
          implementation: 'database',
          flags: this.cache.flags.map(cloneFlag),
          expiresAt: Date.now() + FLAG_CACHE_TTL_MS,
        };
        return {
          implementation: 'database',
          flags: this.cache.flags.map(cloneFlag),
        };
      }

      const flags = await this.fallback.getAllFlags();
      this.cache = {
        implementation: 'in_memory',
        flags: flags.map(cloneFlag),
        expiresAt: Date.now() + FLAG_CACHE_TTL_MS,
      };
      return { implementation: 'in_memory', flags };
    }
  }

  async getImplementation(): Promise<FlagServiceImplementation> {
    const { implementation } = await this.readFlagsFromSource();
    return implementation;
  }

  async isEnabled(flagName: string, subjectKey?: string): Promise<boolean> {
    const flag = await this.getFlag(flagName);
    return evaluateFlag(flag, subjectKey);
  }

  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    const { flags } = await this.readFlagsFromSource();
    const match = flags.find((flag) => flag.name === flagName);
    return match ? cloneFlag(match) : null;
  }

  async setFlag(
    flagName: string,
    enabled: boolean,
    rolloutPct = 100,
    options: FlagUpdateOptions = {},
  ): Promise<void> {
    const providerBlocked = PROVIDER_BLOCKED_FLAGS.has(flagName);
    const effectiveEnabled = providerBlocked ? false : enabled;
    const normalizedRolloutPct = providerBlocked ? 0 : normalizeRolloutPct(rolloutPct);

    if (!isDatabaseConfigured()) {
      await this.fallback.setFlag(flagName, effectiveEnabled, normalizedRolloutPct, options);
      this.invalidateCache();
      return;
    }

    const before = await this.getFlag(flagName);
    const defaultFlag = getDefaultFlag(flagName);
    const description = before?.description ?? defaultFlag?.description ?? null;
    const actorUserId = options.actorUserId ?? null;
    const actorRole = options.actorRole ?? 'oran_admin';

    const rows = await executeQuery<FeatureFlagRow>(
      `INSERT INTO feature_flags
         (name, enabled, rollout_pct, description, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (name) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           rollout_pct = EXCLUDED.rollout_pct,
           description = COALESCE(feature_flags.description, EXCLUDED.description),
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()
       RETURNING id, name, enabled, rollout_pct, description, created_by_user_id,
                 updated_by_user_id, created_at, updated_at`,
      [flagName, effectiveEnabled, normalizedRolloutPct, description, actorUserId],
    );

    const after = rows[0] ? cloneFlag(mapRowToFeatureFlag(rows[0])) : null;

    if (after) {
      await this.fallback.setFlag(flagName, effectiveEnabled, normalizedRolloutPct, options);
      try {
        await executeQuery(
          `INSERT INTO audit_logs
             (actor_user_id, actor_role, action, resource_type, resource_id, before, after)
           VALUES ($1, $2, 'feature_flag.updated', 'feature_flag', $3, $4::jsonb, $5::jsonb)`,
          [
            actorUserId,
            actorRole,
            after.id,
            JSON.stringify(before ?? null),
            JSON.stringify({
              ...after,
              change_reason: options.reason ?? null,
            }),
          ],
        );
      } catch {
        // The primary write already succeeded; audit insertion is best-effort for
        // environments where the audit table is not yet migrated.
      }
    }

    this.invalidateCache();
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    const { flags } = await this.readFlagsFromSource();
    return flags.map(cloneFlag);
  }
}

export const flagService = new HybridFlagService();

export async function getFlagServiceImplementation(): Promise<FlagServiceImplementation> {
  return flagService.getImplementation();
}
