/**
 * ORAN Feature Flags Service
 * Lightweight in-memory implementation backed by the feature_flags table.
 */

import type { FeatureFlag } from '@/domain/types';

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

function makeFlag(name: string, enabled: boolean, rolloutPct = 0): FeatureFlag {
  const now = new Date();
  return {
    id: `flag-${name}`,
    name,
    enabled,
    rolloutPct,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Default flags for local/test environments.
 * In production these come from the database.
 */
const DEFAULT_FLAGS: FeatureFlag[] = [
  makeFlag('llm_summarize',  false, 0),
  makeFlag('map_enabled',    true,  100),
  makeFlag('feedback_form',  true,  100),
  makeFlag('host_claims',    true,  100),
];

export class InMemoryFlagService implements FlagService {
  private readonly store: FlagStore;

  constructor(initialFlags?: FeatureFlag[]) {
    this.store = new Map();
    const flags = initialFlags ?? DEFAULT_FLAGS;
    for (const flag of flags) {
      this.store.set(flag.name, flag);
    }
  }

  async isEnabled(flagName: string): Promise<boolean> {
    const flag = this.store.get(flagName);
    if (!flag) return false;
    if (!flag.enabled) return false;
    // Rollout percentage: for 100% just return true, otherwise false until
    // a proper user-hash-based rollout is implemented.
    // NOTE: Full percentage rollout requires a deterministic user identifier hash.
    // Using simple threshold check here; integrate user ID hashing for production.
    return flag.rolloutPct >= 100;
  }

  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    return this.store.get(flagName) ?? null;
  }

  async setFlag(flagName: string, enabled: boolean, rolloutPct = 100): Promise<void> {
    const existing = this.store.get(flagName);
    const now = new Date();
    this.store.set(flagName, {
      id: existing?.id ?? `flag-${flagName}`,
      name: flagName,
      enabled,
      rolloutPct,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    return Array.from(this.store.values());
  }
}

// Singleton for server-side use
export const flagService: FlagService = new InMemoryFlagService();
