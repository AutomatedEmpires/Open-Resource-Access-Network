import { FEATURE_FLAGS } from '@/domain/constants';
import type { FeatureFlag } from '@/domain/types';
import type { FlagService, FlagServiceImplementation } from '@/services/flags/flags';
import { flagService, getFlagServiceImplementation } from '@/services/flags/flags';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { isAuthConfigured, shouldEnforceAuth } from '@/services/auth/session';
import { validateRuntimeEnv, type RuntimeEnvValidationResult } from '@/services/runtime/envContract';

export type ControlPlaneState = 'ready' | 'guarded' | 'planned';
export type IntegrationState = 'configured' | 'partial' | 'absent';

export interface ControlPlaneFlagSummary {
  name: string;
  enabled: boolean;
  rolloutPct: number;
  state: ControlPlaneState;
}

export interface ControlPlaneIntegrationStatus {
  id: string;
  label: string;
  category: 'identity' | 'ai' | 'observability' | 'communications' | 'data' | 'mapping';
  state: IntegrationState;
  requiredEnv: string[];
  missingEnv: string[];
  powers: string[];
}

export interface ControlPlaneOperatorStatus {
  id: string;
  title: string;
  mission: string;
  state: ControlPlaneState;
  score: number;
  trustModel: string;
  capabilities: string[];
  guardrails: string[];
  blockers: string[];
  accelerators: string[];
  evidencePaths: string[];
}

export interface ControlPlaneSnapshot {
  generatedAt: string;
  summary: {
    readinessScore: number;
    posture: 'worldclass_foundation' | 'enterprise_foundation' | 'guided_buildout';
    activeOperators: number;
    configuredIntegrations: number;
    strengths: string[];
    blockers: string[];
    nextMoves: string[];
  };
  trustModel: {
    principles: string[];
    enforcedControls: string[];
    openGaps: string[];
  };
  featureFlags: {
    implementation: FlagServiceImplementation;
    enabledCount: number;
    disabledCount: number;
    flags: ControlPlaneFlagSummary[];
  };
  integrations: ControlPlaneIntegrationStatus[];
  operators: ControlPlaneOperatorStatus[];
}

export interface BuildControlPlaneOptions {
  env?: Record<string, string | undefined>;
  flagService?: Pick<FlagService, 'getAllFlags'>;
  databaseConfigured?: boolean;
  authConfigured?: boolean;
  authEnforced?: boolean;
  flagImplementation?: FlagServiceImplementation;
  runtimeValidation?: RuntimeEnvValidationResult;
}

function hasEnv(env: Record<string, string | undefined>, key: string): boolean {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function countConfigured(keys: readonly string[], env: Record<string, string | undefined>): number {
  return keys.filter((key) => hasEnv(env, key)).length;
}

function integrationState(keys: readonly string[], env: Record<string, string | undefined>): IntegrationState {
  const configuredCount = countConfigured(keys, env);
  if (configuredCount === keys.length) return 'configured';
  if (configuredCount > 0) return 'partial';
  return 'absent';
}

function compositeAiState(env: Record<string, string | undefined>): {
  state: IntegrationState;
  requiredEnv: string[];
  missingEnv: string[];
} {
  const keyGroups = [
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY'],
    ['LLM_ENDPOINT', 'LLM_API_KEY'],
    ['FOUNDRY_ENDPOINT', 'FOUNDRY_KEY'],
  ] as const;

  for (const group of keyGroups) {
    if (group.every((key) => hasEnv(env, key))) {
      return { state: 'configured', requiredEnv: [...group], missingEnv: [] };
    }
  }

  const flattened = Array.from(new Set(keyGroups.flatMap((group) => group)));
  const anyPresent = flattened.some((key) => hasEnv(env, key));
  return {
    state: anyPresent ? 'partial' : 'absent',
    requiredEnv: flattened,
    missingEnv: flattened.filter((key) => !hasEnv(env, key)),
  };
}

function buildFlagSummary(flags: FeatureFlag[]): ControlPlaneFlagSummary[] {
  return flags
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((flag) => ({
      name: flag.name,
      enabled: flag.enabled,
      rolloutPct: flag.rolloutPct,
      state: flag.enabled && flag.rolloutPct >= 100 ? 'ready' : flag.enabled ? 'guarded' : 'planned',
    }));
}

function getFlagReady(flagMap: Map<string, FeatureFlag>, name: string): boolean {
  const flag = flagMap.get(name);
  if (!flag) return false;
  return flag.enabled && flag.rolloutPct >= 100;
}

function operatorStateFromChecks(baseReady: boolean, blockers: string[], accelerators: string[]): ControlPlaneState {
  if (!baseReady) return 'planned';
  if (blockers.length > 0 || accelerators.length > 0) return 'guarded';
  return 'ready';
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreOperator(baseReady: boolean, blockers: string[], accelerators: string[]): number {
  if (!baseReady) {
    return clampScore(35 - blockers.length * 8);
  }
  return clampScore(92 - blockers.length * 14 - accelerators.length * 6);
}

export async function buildAgentControlPlaneSnapshot(
  options: BuildControlPlaneOptions = {},
): Promise<ControlPlaneSnapshot> {
  const env = options.env ?? process.env;
  const runtimeValidation = options.runtimeValidation ?? validateRuntimeEnv('webapp', env);
  const databaseConfigured = options.databaseConfigured ?? isDatabaseConfigured();
  const authConfigured = options.authConfigured ?? isAuthConfigured();
  const authEnforced = options.authEnforced ?? shouldEnforceAuth();
  const activeFlagService = options.flagService ?? flagService;
  const flagImplementation = options.flagImplementation ?? await getFlagServiceImplementation();
  const flags = await activeFlagService.getAllFlags();
  const flagMap = new Map(flags.map((flag) => [flag.name, flag]));

  const aiCore = compositeAiState(env);
  const integrations: ControlPlaneIntegrationStatus[] = [
    {
      id: 'entra_id',
      label: 'Microsoft Entra ID',
      category: 'identity',
      state: integrationState(
        ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID'],
        env,
      ),
      requiredEnv: ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID'],
      missingEnv: ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID'].filter(
        (key) => !hasEnv(env, key),
      ),
      powers: ['role-based auth', 'admin route protection', 'host/community/ORAN personas'],
    },
    {
      id: 'app_insights',
      label: 'Azure Application Insights',
      category: 'observability',
      state: integrationState(['APPLICATIONINSIGHTS_CONNECTION_STRING'], env),
      requiredEnv: ['APPLICATIONINSIGHTS_CONNECTION_STRING'],
      missingEnv: ['APPLICATIONINSIGHTS_CONNECTION_STRING'].filter((key) => !hasEnv(env, key)),
      powers: ['AI telemetry', 'release verification', 'operator diagnostics'],
    },
    {
      id: 'azure_maps',
      label: 'Azure Maps',
      category: 'mapping',
      state: integrationState(['AZURE_MAPS_KEY', 'AZURE_MAPS_SAS_TOKEN'], env),
      requiredEnv: ['AZURE_MAPS_KEY', 'AZURE_MAPS_SAS_TOKEN'],
      missingEnv: ['AZURE_MAPS_KEY', 'AZURE_MAPS_SAS_TOKEN'].filter((key) => !hasEnv(env, key)),
      powers: [
        'server geocoding',
        'interactive map SAS-token brokering',
        'geospatial search',
        'resource discovery',
      ],
    },
    {
      id: 'ai_core',
      label: 'Azure OpenAI / Foundry LLM Runtime',
      category: 'ai',
      state: aiCore.state,
      requiredEnv: aiCore.requiredEnv,
      missingEnv: aiCore.missingEnv,
      powers: ['chat summarization', 'ingestion extraction', 'admin review assist'],
    },
    {
      id: 'content_safety',
      label: 'Azure AI Content Safety',
      category: 'ai',
      state: integrationState(['AZURE_CONTENT_SAFETY_ENDPOINT', 'AZURE_CONTENT_SAFETY_KEY'], env),
      requiredEnv: ['AZURE_CONTENT_SAFETY_ENDPOINT', 'AZURE_CONTENT_SAFETY_KEY'],
      missingEnv: ['AZURE_CONTENT_SAFETY_ENDPOINT', 'AZURE_CONTENT_SAFETY_KEY'].filter(
        (key) => !hasEnv(env, key),
      ),
      powers: ['second-layer crisis detection', 'semantic safety screening'],
    },
    {
      id: 'document_intelligence',
      label: 'Azure Document Intelligence',
      category: 'ai',
      state: integrationState(
        ['AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_KEY'],
        env,
      ),
      requiredEnv: ['AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_KEY'],
      missingEnv: ['AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_KEY'].filter(
        (key) => !hasEnv(env, key),
      ),
      powers: ['PDF intake extraction', 'structured evidence capture'],
    },
    {
      id: 'translator',
      label: 'Azure AI Translator',
      category: 'ai',
      state: integrationState(
        ['AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_ENDPOINT', 'AZURE_TRANSLATOR_REGION'],
        env,
      ),
      requiredEnv: ['AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_ENDPOINT', 'AZURE_TRANSLATOR_REGION'],
      missingEnv: ['AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_ENDPOINT', 'AZURE_TRANSLATOR_REGION'].filter(
        (key) => !hasEnv(env, key),
      ),
      powers: ['multilingual service descriptions', 'language access'],
    },
    {
      id: 'speech',
      label: 'Azure Speech',
      category: 'ai',
      state: integrationState(['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'], env),
      requiredEnv: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'],
      missingEnv: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'].filter((key) => !hasEnv(env, key)),
      powers: ['spoken service summaries', 'voice accessibility'],
    },
    {
      id: 'communication_email',
      label: 'Azure Communication Services',
      category: 'communications',
      state: integrationState(
        ['AZURE_COMMUNICATION_CONNECTION_STRING', 'AZURE_COMMUNICATION_SENDER_ADDRESS'],
        env,
      ),
      requiredEnv: ['AZURE_COMMUNICATION_CONNECTION_STRING', 'AZURE_COMMUNICATION_SENDER_ADDRESS'],
      missingEnv: ['AZURE_COMMUNICATION_CONNECTION_STRING', 'AZURE_COMMUNICATION_SENDER_ADDRESS'].filter(
        (key) => !hasEnv(env, key),
      ),
      powers: ['notification delivery', 'operator escalations', 'transactional messaging'],
    },
    {
      id: 'redis',
      label: 'Azure Cache for Redis',
      category: 'data',
      state: integrationState(['REDIS_URL'], env),
      requiredEnv: ['REDIS_URL'],
      missingEnv: ['REDIS_URL'].filter((key) => !hasEnv(env, key)),
      powers: ['multi-instance rate limiting', 'semantic cache', 'search caching'],
    },
  ];

  const integrationById = new Map(integrations.map((integration) => [integration.id, integration]));

  const trustSafetyBlockers: string[] = [];
  const trustSafetyAccelerators: string[] = [];
  if (!runtimeValidation.ok) {
    trustSafetyBlockers.push(`Runtime contract is incomplete: ${runtimeValidation.missingCritical.join(', ')}`);
  }
  if (!authEnforced) {
    trustSafetyBlockers.push('Fail-closed auth enforcement is not active for this runtime.');
  }
  if (integrationById.get('content_safety')?.state !== 'configured') {
    trustSafetyAccelerators.push('Wire Azure AI Content Safety for semantic crisis detection.');
  }
  if (!getFlagReady(flagMap, FEATURE_FLAGS.CONTENT_SAFETY_CRISIS)) {
    trustSafetyAccelerators.push('Promote content_safety_crisis to 100% rollout.');
  }
  if (integrationById.get('app_insights')?.state !== 'configured') {
    trustSafetyAccelerators.push('Complete Application Insights wiring for safety telemetry.');
  }
  const trustSafetyBaseReady = runtimeValidation.ok && authEnforced;

  const resourceAlignmentBlockers: string[] = [];
  const resourceAlignmentAccelerators: string[] = [];
  if (!databaseConfigured) {
    resourceAlignmentBlockers.push('DATABASE_URL is not configured for verified resource storage.');
  }
  if (aiCore.state === 'absent') {
    resourceAlignmentBlockers.push('No LLM runtime is configured for ingestion extraction or admin assist.');
  } else if (aiCore.state === 'partial') {
    resourceAlignmentBlockers.push('LLM runtime credentials are partially configured.');
  }
  if (!hasEnv(env, 'INTERNAL_API_KEY')) {
    resourceAlignmentBlockers.push('INTERNAL_API_KEY is missing for Functions to App trust.')
  }
  if (integrationById.get('document_intelligence')?.state !== 'configured') {
    resourceAlignmentAccelerators.push('Complete Azure Document Intelligence for PDF/form evidence intake.');
  }
  if (!getFlagReady(flagMap, FEATURE_FLAGS.DOC_INTELLIGENCE_INTAKE)) {
    resourceAlignmentAccelerators.push('Enable doc_intelligence_intake after document workflows are validated.');
  }
  if (!getFlagReady(flagMap, FEATURE_FLAGS.VECTOR_SEARCH)) {
    resourceAlignmentAccelerators.push('Promote vector_search to move retrieval toward multilingual semantic matching.');
  }
  const resourceAlignmentBaseReady = databaseConfigured && aiCore.state === 'configured' && hasEnv(env, 'INTERNAL_API_KEY');

  const governanceBlockers: string[] = [];
  const governanceAccelerators: string[] = [];
  if (!databaseConfigured) {
    governanceBlockers.push('Database-backed workflow tables are unavailable.');
  }
  if (!authEnforced) {
    governanceBlockers.push('Admin/host governance depends on enforced auth and role checks.');
  }
  if (integrationById.get('communication_email')?.state !== 'configured') {
    governanceAccelerators.push('Complete Azure Communication Services for escalation delivery beyond in-app notices.');
  }
  if (integrationById.get('app_insights')?.state !== 'configured') {
    governanceAccelerators.push('Instrument governance actions in Application Insights for audit-grade visibility.');
  }
  const governanceBaseReady = databaseConfigured && authEnforced;

  const accessBlockers: string[] = [];
  const accessAccelerators: string[] = [];
  if (!getFlagReady(flagMap, FEATURE_FLAGS.MAP_ENABLED)) {
    accessBlockers.push('Map access is not fully enabled.');
  }
  if (integrationById.get('azure_maps')?.state !== 'configured') {
    accessBlockers.push('Azure Maps is not fully configured for geospatial discovery.');
  }
  if (integrationById.get('translator')?.state !== 'configured' || !getFlagReady(flagMap, FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS)) {
    accessAccelerators.push('Complete Translator wiring and 100% rollout for multilingual descriptions.');
  }
  if (integrationById.get('speech')?.state !== 'configured' || !getFlagReady(flagMap, FEATURE_FLAGS.TTS_SUMMARIES)) {
    accessAccelerators.push('Enable Azure Speech summaries for voice-first accessibility.');
  }
  const accessBaseReady = getFlagReady(flagMap, FEATURE_FLAGS.MAP_ENABLED) && integrationById.get('azure_maps')?.state === 'configured';

  const releaseBlockers: string[] = [];
  const releaseAccelerators: string[] = [];
  if (!runtimeValidation.ok) {
    releaseBlockers.push(`Runtime contract is incomplete: ${runtimeValidation.missingCritical.join(', ')}`);
  }
  if (integrationById.get('app_insights')?.state !== 'configured') {
    releaseBlockers.push('Application Insights is required for enterprise release telemetry.');
  }
  if (integrationById.get('redis')?.state !== 'configured') {
    releaseAccelerators.push('Redis remains the missing piece for multi-instance rate limiting and shared cache coherence.');
  }
  if (flagImplementation !== 'database') {
    releaseAccelerators.push('Promote the feature flag backend to the database-backed catalog across all deployed environments.');
  }
  if (!getFlagReady(flagMap, FEATURE_FLAGS.TELEMETRY_INTERACTIONS)) {
    releaseAccelerators.push('Enable privacy-safe telemetry_interactions once governance approves the rollout.');
  }
  const releaseBaseReady = runtimeValidation.ok && integrationById.get('app_insights')?.state === 'configured';

  const operators: ControlPlaneOperatorStatus[] = [
    {
      id: 'trust_guardian',
      title: 'Trust Guardian Operator',
      mission: 'Protect seekers with crisis-first safety, fail-closed identity, privacy-aware telemetry, and safe write boundaries.',
      state: operatorStateFromChecks(trustSafetyBaseReady, trustSafetyBlockers, trustSafetyAccelerators),
      score: scoreOperator(trustSafetyBaseReady, trustSafetyBlockers, trustSafetyAccelerators),
      trustModel: 'Keyword-first crisis routing, semantic safety second layer, same-origin write policy, and production fail-closed auth.',
      capabilities: [
        'crisis-first chat routing',
        'semantic self-harm detection',
        'same-origin protection for authenticated writes',
        'runtime readiness verification',
      ],
      guardrails: [
        'no PII in telemetry',
        'cross-site state-changing requests blocked',
        'protected routes fail closed in production',
      ],
      blockers: trustSafetyBlockers,
      accelerators: trustSafetyAccelerators,
      evidencePaths: [
        'src/services/security/contentSafety.ts',
        'src/proxy.ts',
        'src/app/api/health/route.ts',
        'docs/SECURITY_PRIVACY.md',
      ],
    },
    {
      id: 'resource_alignment',
      title: 'Resource Alignment Operator',
      mission: 'Continuously ingest, score, and route real-world resources into a verified, publish-safe resource graph.',
      state: operatorStateFromChecks(resourceAlignmentBaseReady, resourceAlignmentBlockers, resourceAlignmentAccelerators),
      score: scoreOperator(resourceAlignmentBaseReady, resourceAlignmentBlockers, resourceAlignmentAccelerators),
      trustModel: 'LLM-assisted extraction is constrained to staging, scored deterministically, and never published without human approval.',
      capabilities: [
        '9-stage ingestion orchestration',
        'candidate scoring and publish readiness',
        'canonical provenance layering',
        'coverage gap and confidence regression scanning',
      ],
      guardrails: [
        'seekers only read stored records',
        'human review before publish',
        'internal Functions bridge protected by shared secret',
      ],
      blockers: resourceAlignmentBlockers,
      accelerators: resourceAlignmentAccelerators,
      evidencePaths: [
        'src/agents/ingestion/pipeline/orchestrator.ts',
        'src/agents/ingestion/publish.ts',
        'docs/agents/AGENTS_OVERVIEW.md',
        'docs/DECISIONS/ADR-0007-hsds-211-federation-canonical-model.md',
      ],
    },
    {
      id: 'governance_workbench',
      title: 'Governance Workbench Operator',
      mission: 'Coordinate human approvals, scopes, SLAs, appeals, and audit visibility across the civic operations surface.',
      state: operatorStateFromChecks(governanceBaseReady, governanceBlockers, governanceAccelerators),
      score: scoreOperator(governanceBaseReady, governanceBlockers, governanceAccelerators),
      trustModel: 'Role-aware workflows, two-person controls, and escalation lanes keep automation subordinate to accountable operators.',
      capabilities: [
        'scope grants and approvals',
        'triage queues and appeals',
        'SLA warnings and escalations',
        'host/community/ORAN admin separation',
      ],
      guardrails: [
        'RBAC on admin surfaces',
        'rate limiting on privileged APIs',
        'audit-first workflow design',
      ],
      blockers: governanceBlockers,
      accelerators: governanceAccelerators,
      evidencePaths: [
        'src/app/api/admin/scopes/route.ts',
        'src/app/api/admin/appeals/route.ts',
        'src/services/escalation/engine.ts',
        'docs/governance/OPERATING_MODEL.md',
      ],
    },
    {
      id: 'access_mobility',
      title: 'Access & Mobility Operator',
      mission: 'Help people discover relevant resources across geography, language, and interaction mode with grounded access pathways.',
      state: operatorStateFromChecks(accessBaseReady, accessBlockers, accessAccelerators),
      score: scoreOperator(accessBaseReady, accessBlockers, accessAccelerators),
      trustModel: 'Map, translation, and voice features are additive experience layers on top of verified resource records.',
      capabilities: [
        'map-based resource discovery',
        'multilingual service descriptions',
        'voice summary delivery',
        'language-access expansion paths',
      ],
      guardrails: [
        'approximate location by default',
        'translations are post-retrieval enhancements, not source-of-truth facts',
        'voice and map layers never bypass verification',
      ],
      blockers: accessBlockers,
      accelerators: accessAccelerators,
      evidencePaths: [
        'src/services/geocoding/azureMaps.ts',
        'src/services/i18n/translator.ts',
        'src/services/tts/azureSpeech.ts',
        'docs/DECISIONS/ADR-0006-opt-in-device-geolocation.md',
      ],
    },
    {
      id: 'release_observatory',
      title: 'Release Observatory Operator',
      mission: 'Give operators a continuously inspectable deployment, health, and telemetry posture before and after release.',
      state: operatorStateFromChecks(releaseBaseReady, releaseBlockers, releaseAccelerators),
      score: scoreOperator(releaseBaseReady, releaseBlockers, releaseAccelerators),
      trustModel: 'Every release should prove runtime readiness, security headers, and deployment health before operators trust it.',
      capabilities: [
        'runtime env contract validation',
        'App Service and Functions preflight checks',
        'health endpoint verification',
        'typed Application Insights events',
      ],
      guardrails: [
        'deploys validate app settings before publish',
        'health checks fail closed on config gaps',
        'security headers verified after deployment',
      ],
      blockers: releaseBlockers,
      accelerators: releaseAccelerators,
      evidencePaths: [
        '.github/workflows/deploy-azure-appservice.yml',
        '.github/workflows/deploy-azure-functions.yml',
        'src/services/runtime/envContract.ts',
        'src/services/telemetry/appInsights.ts',
      ],
    },
  ];

  const readyOperators = operators.filter((operator) => operator.state === 'ready').length;
  const configuredIntegrations = integrations.filter((integration) => integration.state === 'configured').length;
  const guardedOperators = operators.filter((operator) => operator.state === 'guarded').length;

  const summaryBlockers = Array.from(
    new Set(
      operators.flatMap((operator) => operator.blockers),
    ),
  );

  const nextMoves = Array.from(
    new Set([
      ...operators.flatMap((operator) => operator.accelerators),
      ...(flagImplementation === 'database'
        ? []
        : ['Replace the in-memory feature flag store with a DB-backed or remotely audited flag backend.']),
      'Extend the control plane into a dedicated ORAN-admin dashboard once operator ownership is finalized.',
    ]),
  ).slice(0, 6);

  const strengths = [
    'retrieval-first, publish-after-review architecture',
    'centralized runtime readiness contract',
    'same-origin protection for authenticated writes',
    'role-aware admin/community/host separation',
  ];

  if (authConfigured) {
    strengths.push('external identity provider is configured for enterprise role enforcement');
  } else {
    summaryBlockers.push('Microsoft Entra ID is not fully configured for enterprise identity flows.');
  }

  if (configuredIntegrations >= 4) {
    strengths.push('broad Azure-native integration surface already present in code');
  }

  const readinessScore = clampScore(
    (readyOperators * 22)
      + (guardedOperators * 14)
      + (configuredIntegrations * 4)
      + (runtimeValidation.ok ? 8 : 0)
      + (databaseConfigured ? 8 : 0),
  );

  const posture: ControlPlaneSnapshot['summary']['posture'] =
    readinessScore >= 85
      ? 'worldclass_foundation'
      : readinessScore >= 65
        ? 'enterprise_foundation'
        : 'guided_buildout';

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      readinessScore,
      posture,
      activeOperators: readyOperators,
      configuredIntegrations,
      strengths,
      blockers: summaryBlockers,
      nextMoves,
    },
    trustModel: {
      principles: [
        'retrieval-first answers only from stored records',
        'human approval before public publish',
        'privacy-first telemetry and location handling',
        'role-based governance with explicit escalation paths',
      ],
      enforcedControls: [
        'runtime env contract validation',
        'same-origin protection on authenticated writes',
        'rate limiting across public and privileged APIs',
        'health endpoint verifies configuration before declaring healthy',
      ],
      openGaps: [
        ...(flagImplementation === 'database'
          ? []
          : ['feature flags are still backed by an in-memory store']),
        'redis-backed multi-instance rate limiting is still planned',
        'nonce-based CSP is still planned',
      ],
    },
    featureFlags: {
      implementation: flagImplementation,
      enabledCount: flags.filter((flag) => flag.enabled && flag.rolloutPct >= 100).length,
      disabledCount: flags.filter((flag) => !flag.enabled || flag.rolloutPct < 100).length,
      flags: buildFlagSummary(flags),
    },
    integrations,
    operators,
  };
}
