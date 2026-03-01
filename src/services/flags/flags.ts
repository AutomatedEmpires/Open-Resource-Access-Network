/**
 * ORAN Feature Flags Service
 * Lightweight in-memory implementation.
 *
 * Note: the `feature_flags` table exists in the DB schema, but runtime wiring is not
 * implemented yet.
 */

import type { FeatureFlag } from '@/domain/types';
import { FEATURE_FLAGS } from '@/domain/constants';

// ============================================================
// INTERFACE
// ============================================================

export interface FlagService {
  isEnabled(flagName: string): Promise<boolean>;
  getFlag(flagName: string): Promise<FeatureFlag | null>;
  setFlag(flagName: string, enabled: boolean, rolloutPct?: number): Promise<void>;
  getAllFlags(): Promise<FeatureFlag[]>;
}

// ============================================================
// IN-MEMORY IMPLEMENTATION
// ============================================================

type FlagStore = Map<string, FeatureFlag>;

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

function makeFlag(name: string, enabled: boolean, rolloutPct = 0): FeatureFlag {
  const now = new Date();
  return {
    id: `flag-${name}`,
    name,
    enabled,
    rolloutPct: normalizeRolloutPct(rolloutPct),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Default flags for local/test environments.
 * Runtime DB-backed flags are planned, but not yet wired.
 */
const DEFAULT_FLAGS: FeatureFlag[] = [
  makeFlag(FEATURE_FLAGS.LLM_SUMMARIZE, false, 0),
  makeFlag(FEATURE_FLAGS.MAP_ENABLED, true, 100),
  makeFlag(FEATURE_FLAGS.FEEDBACK_FORM, true, 100),
  makeFlag(FEATURE_FLAGS.HOST_CLAIMS, true, 100),
];

export class InMemoryFlagService implements FlagService {
  private readonly store: FlagStore;

  constructor(initialFlags?: FeatureFlag[]) {
    this.store = new Map();
    const flags = initialFlags ?? DEFAULT_FLAGS;
    for (const flag of flags) {
      this.store.set(flag.name, cloneFlag(flag));
    }
  }

  async isEnabled(flagName: string): Promise<boolean> {
    const flag = this.store.get(flagName);
    if (!flag) return false;
    if (!flag.enabled) return false;
    // Rollout percentage is only supported as 0% or 100% until a deterministic
    // subject-hash rollout mechanism is implemented.
    return normalizeRolloutPct(flag.rolloutPct) >= 100;
  }

  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    const flag = this.store.get(flagName);
    return flag ? cloneFlag(flag) : null;
  }

  async setFlag(flagName: string, enabled: boolean, rolloutPct = 100): Promise<void> {
    const existing = this.store.get(flagName);
    const now = new Date();
    this.store.set(flagName, {
      id: existing?.id ?? `flag-${flagName}`,
      name: flagName,
      enabled,
      rolloutPct: normalizeRolloutPct(rolloutPct),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    return Array.from(this.store.values(), cloneFlag);
  }
}

// Singleton for server-side use
export const flagService: FlagService = new InMemoryFlagService();
