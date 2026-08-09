import { describe, expect, it } from 'vitest';
import { buildAgentControlPlaneSnapshot } from '@/services/agentic/controlPlane';
import type { FeatureFlag } from '@/domain/types';
import { FEATURE_FLAGS } from '@/domain/constants';

function makeFlag(name: string, enabled: boolean, rolloutPct = 100): FeatureFlag {
  const now = new Date('2026-03-07T00:00:00.000Z');
  return {
    id: `flag-${name}`,
    name,
    enabled,
    rolloutPct,
    createdAt: now,
    updatedAt: now,
  };
}

describe('buildAgentControlPlaneSnapshot', () => {
  it('builds an enterprise-oriented snapshot from env and flag posture', async () => {
    const snapshot = await buildAgentControlPlaneSnapshot({
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://oran_backend_runtime.tpatxospkuqvajusuryw:test@aws-0-us-east-1.pooler.supabase.com:6543/postgres?uselibpqcompat=true&sslmode=require',
        ORAN_DATABASE_ROLE: 'oran_backend_runtime',
        ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
        CRON_SECRET: 'vercel-cron-secret',
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
        CLERK_SECRET_KEY: 'sk_test_example',
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'ORAN <notifications@openresourceaccessnetwork.com>',
        VERCEL: '1',
        LLM_PROVIDER: 'anthropic',
        LLM_API_KEY: 'llm-key',
      },
      databaseConfigured: true,
      authConfigured: true,
      authEnforced: true,
      flagImplementation: 'database',
      flagService: {
        getAllFlags: async () => [
          makeFlag(FEATURE_FLAGS.MAP_ENABLED, true),
          makeFlag(FEATURE_FLAGS.CONTENT_SAFETY_CRISIS, true),
          makeFlag(FEATURE_FLAGS.LLM_SUMMARIZE, true),
          makeFlag(FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE, false, 0),
          makeFlag(FEATURE_FLAGS.VECTOR_SEARCH, false, 0),
          makeFlag(FEATURE_FLAGS.TELEMETRY_INTERACTIONS, false, 0),
        ],
      },
    });

    expect(snapshot.summary.readinessScore).toBeGreaterThan(60);
    expect(snapshot.summary.posture).toBe('worldclass_foundation');
    expect(snapshot.integrations.find((item) => item.id === 'sentry')?.state).toBe('configured');
    expect(snapshot.integrations.find((item) => item.id === 'resend')?.state).toBe('configured');
    expect(snapshot.operators.find((item) => item.id === 'trust_guardian')?.state).toBe('ready');
    expect(snapshot.featureFlags.implementation).toBe('database');
    expect(snapshot.trustModel.openGaps).not.toContain('feature flags are still backed by an in-memory store');
  });

  it('surfaces blockers when core runtime and AI foundations are absent', async () => {
    const snapshot = await buildAgentControlPlaneSnapshot({
      env: {
        NODE_ENV: 'production',
      },
      databaseConfigured: false,
      authConfigured: false,
      authEnforced: true,
      flagImplementation: 'in_memory',
      flagService: {
        getAllFlags: async () => [
          makeFlag(FEATURE_FLAGS.MAP_ENABLED, false, 0),
        ],
      },
    });

    const resourceAlignment = snapshot.operators.find((item) => item.id === 'resource_alignment');
    expect(snapshot.summary.posture).toBe('guided_buildout');
    expect(snapshot.summary.blockers).toContain('DATABASE_URL is not configured for verified resource storage.');
    expect(resourceAlignment?.state).toBe('planned');
    expect(snapshot.integrations.find((item) => item.id === 'ai_core')?.state).toBe('absent');
    expect(resourceAlignment?.blockers).not.toContain(
      'No LLM runtime is configured for ingestion extraction or admin assist.',
    );
    expect(snapshot.trustModel.openGaps).toContain('feature flags are still backed by an in-memory store');
  });

  it('reports an explicitly disabled ingestion AI runtime as intentionally absent', async () => {
    const snapshot = await buildAgentControlPlaneSnapshot({
      env: { NODE_ENV: 'development', LLM_PROVIDER: 'disabled' },
      databaseConfigured: false,
      authConfigured: false,
      authEnforced: false,
      flagImplementation: 'in_memory',
      flagService: { getAllFlags: async () => [] },
    });

    const ai = snapshot.integrations.find((item) => item.id === 'ai_core');
    expect(ai).toMatchObject({ state: 'absent', requiredEnv: [], missingEnv: [] });
  });
});
