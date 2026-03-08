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

function normalizeRolloutPct(rolloutPct: number | undefined): number {
  if (typeof rolloutPct !== 'number' || Number.isNaN(rolloutPct)) return 0;
  const clamped = Math.max(0, Math.min(100, rolloutPct));
  return Math.trunc(clamped);
}

function cloneFlag(flag: FeatureFlag): FeatureFlag {
  return {
    ...flag,
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
    true,
    100,
    'Run Azure AI Content Safety as a second-layer crisis gate after keyword checks.',
  ),
  makeFlag(FEATURE_FLAGS.VECTOR_SEARCH, false, 0, 'Enable pgvector-backed semantic search and re-ranking.'),
  makeFlag(FEATURE_FLAGS.LLM_INTENT_ENRICH, false, 0, 'Enable LLM-based intent enrichment for ambiguous chat queries.'),
  makeFlag(FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS, false, 0, 'Enable translated service descriptions post-retrieval.'),
  makeFlag(FEATURE_FLAGS.TTS_SUMMARIES, false, 0, 'Enable spoken service summaries via Azure Speech.'),
  makeFlag(FEATURE_FLAGS.LLM_ADMIN_ASSIST, false, 0, 'Enable LLM-assisted admin review suggestions.'),
  makeFlag(FEATURE_FLAGS.LLM_FEEDBACK_TRIAGE, false, 0, 'Enable LLM classification of submitted feedback comments.'),
  makeFlag(FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE, false, 0, 'Enable Azure Document Intelligence for PDF intake parsing.'),
  makeFlag(FEATURE_FLAGS.TELEMETRY_INTERACTIONS, false, 0, 'Enable privacy-safe UI breadcrumb telemetry.'),
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
    const existing = this.store.get(flagName);
    const defaultFlag = getDefaultFlag(flagName);
    const now = new Date();
    const actorUserId = options.actorUserId ?? null;
    this.store.set(flagName, {
      id: existing?.id ?? defaultFlag?.id ?? `flag-${flagName}`,
      name: flagName,
      enabled,
      rolloutPct: normalizeRolloutPct(rolloutPct),
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
    const normalizedRolloutPct = normalizeRolloutPct(rolloutPct);

    if (!isDatabaseConfigured()) {
      await this.fallback.setFlag(flagName, enabled, normalizedRolloutPct, options);
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
      [flagName, enabled, normalizedRolloutPct, description, actorUserId],
    );

    const after = rows[0] ? mapRowToFeatureFlag(rows[0]) : null;

    if (after) {
      await this.fallback.setFlag(flagName, enabled, normalizedRolloutPct, options);
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
