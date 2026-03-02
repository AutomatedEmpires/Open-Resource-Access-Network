import { describe, expect, it } from 'vitest';

import { buildBootstrapRegistry } from '../sourceRegistry';

import type { LLMClient } from '../llm/client';

import type {
  PipelineContext,
  PipelineEvent,
  PipelineInput,
  PipelineStage,
} from '../pipeline/types';
import {
  createPipelineOrchestrator,
  DEFAULT_PIPELINE_CONFIG,
  PipelineOrchestrator,
} from '../pipeline/orchestrator';
import {
  SourceCheckStage,
  FetchStage,
  ExtractTextStage,
  DiscoverLinksStage,
  LlmExtractStage,
  LlmCategorizeStage,
  VerifyStage,
  ScoreStage,
  BuildCandidateStage,
  createPipelineStages,
} from '../pipeline/stages';

// ============================================================================
// Test Helpers
// ============================================================================

const createInput = (sourceUrl: string, opts?: Partial<PipelineInput>): PipelineInput => ({
  sourceUrl,
  forceReprocess: false,
  ...opts,
});

const createContext = (
  sourceUrl: string,
  overrides?: Partial<PipelineContext>
): PipelineContext => ({
  input: createInput(sourceUrl),
  config: DEFAULT_PIPELINE_CONFIG,
  correlationId: 'test-123',
  stageResults: [],
  startedAt: new Date(),
  ...overrides,
});

const mockLlmClient: LLMClient = {
  provider: 'test',
  model: 'test-model',
  async extract() {
    return {
      success: true,
      data: {
        services: [
          {
            organizationName: 'Food Bank Services',
            serviceName: 'Community Food Assistance',
            description: 'Community food assistance program',
            websiteUrl: 'https://example.gov/food',
            phones: [{ number: '555-000-0000', type: 'voice' }],
            hours: [],
            languages: [],
            isRemoteService: false,
          },
        ],
        confidences: [
          {
            organizationName: { confidence: 90 },
            serviceName: { confidence: 85 },
            description: { confidence: 80 },
            websiteUrl: { confidence: 70 },
          },
        ],
        pageType: 'service_listing',
      },
    };
  },
  async categorize() {
    return {
      success: true,
      data: {
        tags: [{ tag: 'food', confidence: 95 }],
        primaryCategory: 'food',
      },
    };
  },
  async healthCheck() {
    return true;
  },
};

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createPipelineOrchestrator', () => {
  it('creates orchestrator with default config', () => {
    const orchestrator = createPipelineOrchestrator();
    expect(orchestrator).toBeInstanceOf(PipelineOrchestrator);
    expect(orchestrator.getConfig()).toEqual(DEFAULT_PIPELINE_CONFIG);
  });

  it('creates orchestrator with custom config', () => {
    const orchestrator = createPipelineOrchestrator({
      config: { enableLlmExtraction: false },
    });
    expect(orchestrator.getConfig().enableLlmExtraction).toBe(false);
  });

  it('creates orchestrator with custom registry', () => {
    const customRegistry = buildBootstrapRegistry();
    const orchestrator = createPipelineOrchestrator({
      registry: customRegistry,
    });
    expect(orchestrator).toBeInstanceOf(PipelineOrchestrator);
  });
});

// ============================================================================
// Stage Factory Tests
// ============================================================================

describe('createPipelineStages', () => {
  it('creates all 9 pipeline stages', () => {
    const registry = buildBootstrapRegistry();
    const stages = createPipelineStages(registry);
    expect(stages).toHaveLength(9);
  });

  it('creates stages in correct order', () => {
    const registry = buildBootstrapRegistry();
    const stages = createPipelineStages(registry);
    const expectedOrder: PipelineStage[] = [
      'source_check',
      'fetch',
      'extract_text',
      'discover_links',
      'llm_extract',
      'llm_categorize',
      'verify',
      'score',
      'build_candidate',
    ];
    expect(stages.map((s) => s.stage)).toEqual(expectedOrder);
  });
});

// ============================================================================
// Individual Stage Tests
// ============================================================================

describe('SourceCheckStage', () => {
  const registry = buildBootstrapRegistry();
  const stage = new SourceCheckStage(registry);

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('source_check');
  });

  it('allows .gov URLs', async () => {
    const context = createContext('https://example.gov/services');

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.sourceCheck?.allowed).toBe(true);
    expect(context.sourceCheck?.trustLevel).toBe('allowlisted');
  });

  it('allows .edu URLs', async () => {
    const context = createContext('https://university.edu/resources');

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.sourceCheck?.allowed).toBe(true);
  });

  it('allows .mil URLs with quarantine trust level', async () => {
    const context = createContext('https://base.mil/services');

    const result = await stage.execute(context);
    expect(result.status).toBe('completed'); // Quarantine is still allowed
    expect(context.sourceCheck?.allowed).toBe(true);
    expect(context.sourceCheck?.trustLevel).toBe('quarantine');
  });

  it('denies unknown domains', async () => {
    const context = createContext('https://random-site.xyz/page');

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(context.sourceCheck?.allowed).toBe(false);
  });
});

describe('FetchStage', () => {
  const stage = new FetchStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('fetch');
  });

  it('skips if fetchResult already exists', () => {
    const context = createContext('https://example.gov', {
      fetchResult: {
        canonicalUrl: 'https://example.gov',
        httpStatus: 200,
        contentType: 'text/html',
        contentHashSha256: 'abc123',
        body: '<html></html>',
        contentLength: 13,
        fetchedAt: new Date().toISOString(),
      },
    });

    expect(stage.shouldSkip?.(context)).toBe(true);
  });

  it('does not skip if no fetchResult', () => {
    const context = createContext('https://example.gov');

    expect(stage.shouldSkip?.(context)).toBe(false);
  });
});

describe('ExtractTextStage', () => {
  const stage = new ExtractTextStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('extract_text');
  });

  it('fails if no fetch result', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_fetch_result');
  });

  it('extracts text from HTML', async () => {
    const context = createContext('https://example.gov', {
      fetchResult: {
        canonicalUrl: 'https://example.gov',
        httpStatus: 200,
        contentType: 'text/html',
        contentHashSha256: 'abc123',
        body: '<html><head><title>Test Page</title></head><body><p>Hello World</p></body></html>',
        contentLength: 100,
        fetchedAt: new Date().toISOString(),
      },
    });

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.textExtraction?.title).toBe('Test Page');
    expect(context.textExtraction?.text).toContain('Hello World');
  });

  it('skips if textExtraction already exists', () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      textExtraction: {
        text: 'existing text',
        wordCount: 2,
      },
    };

    expect(stage.shouldSkip?.(context)).toBe(true);
  });
});

describe('DiscoverLinksStage', () => {
  const stage = new DiscoverLinksStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('discover_links');
  });

  it('fails if no fetch result', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_fetch_result');
  });

  it('discovers contact links', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      fetchResult: {
        canonicalUrl: 'https://example.gov',
        httpStatus: 200,
        contentType: 'text/html',
        contentHashSha256: 'abc123',
        body: '<html><body><a href="/contact">Contact Us</a></body></html>',
        contentLength: 100,
        fetchedAt: new Date().toISOString(),
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.discoveredLinks?.length).toBeGreaterThan(0);
    expect(context.discoveredLinks?.some(l => l.type === 'contact')).toBe(true);
  });
});

describe('LlmExtractStage', () => {
  const stage = new LlmExtractStage({ llmClient: mockLlmClient });

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('llm_extract');
  });

  it('fails if no text extraction', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_text_extraction');
  });

  it('skips when LLM extraction disabled', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: { ...DEFAULT_PIPELINE_CONFIG, enableLlmExtraction: false },
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      textExtraction: {
        text: 'test content',
        wordCount: 2,
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('skipped');
  });

  it('extracts using injected LLM client', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      textExtraction: {
        text: 'Service provides food assistance to families in need.',
        title: 'Food Bank Services',
        metaDescription: 'Community food assistance program',
        wordCount: 10,
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.llmExtraction?.organizationName).toBe('Food Bank Services');
    expect(context.llmExtraction?.serviceName).toBe('Community Food Assistance');
    expect(context.llmExtraction?.description).toContain('Community food assistance');
  });
});

describe('LlmCategorizeStage', () => {
  const stage = new LlmCategorizeStage({ llmClient: mockLlmClient });

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('llm_categorize');
  });

  it('fails if no LLM extraction', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_llm_extraction');
  });

  it('skips when LLM extraction disabled', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: { ...DEFAULT_PIPELINE_CONFIG, enableLlmExtraction: false },
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      llmExtraction: {
        organizationName: 'Test Org',
        serviceName: 'Test Service',
        description: 'Test description',
        confidence: 70,
        fieldConfidences: {},
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('skipped');
  });

  it('categorizes using injected LLM client', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      llmExtraction: {
        organizationName: 'Test Org',
        serviceName: 'Test Service',
        description: 'Provides groceries and food pantry services',
        confidence: 70,
        fieldConfidences: {},
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.llmCategorization?.categories).toContain('food');
    expect(context.llmCategorization?.categoryConfidences.food).toBe(95);
  });
});

describe('VerifyStage', () => {
  const stage = new VerifyStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('verify');
  });

  it('fails if no extraction', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_extraction');
  });

  it('skips when verification disabled', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: { ...DEFAULT_PIPELINE_CONFIG, enableVerification: false },
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      llmExtraction: {
        organizationName: 'Test Org',
        serviceName: 'Test Service',
        description: 'Test description',
        confidence: 70,
        fieldConfidences: {},
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('skipped');
  });

  it('runs verification checks', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      sourceCheck: {
        allowed: true,
        trustLevel: 'allowlisted' as const,
        sourceId: 'gov',
      },
      llmExtraction: {
        organizationName: 'Test Org',
        serviceName: 'Test Service',
        description: 'A comprehensive description of the service that provides assistance to community members.',
        websiteUrl: 'https://example.gov',
        phone: '555-1234',
        confidence: 70,
        fieldConfidences: {},
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.verificationResults).toBeDefined();
    expect(context.verificationResults?.length).toBeGreaterThan(0);

    // Check domain allowlist passes for .gov
    const domainCheck = context.verificationResults?.find(r => r.checkType === 'domain_allowlist');
    expect(domainCheck?.status).toBe('pass');
  });
});

describe('ScoreStage', () => {
  const stage = new ScoreStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('score');
  });

  it('fails if no extraction', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_extraction');
  });

  it('computes confidence scores', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      sourceCheck: {
        allowed: true,
        trustLevel: 'allowlisted' as const,
        sourceId: 'gov',
      },
      llmExtraction: {
        organizationName: 'Food Bank',
        serviceName: 'Food Assistance',
        description: 'A comprehensive food assistance program for families in need.',
        websiteUrl: 'https://example.gov',
        phone: '555-1234',
        address: {
          line1: '123 Main St',
          city: 'Springfield',
          region: 'IL',
          postalCode: '62701',
          country: 'US',
        },
        confidence: 70,
        fieldConfidences: {},
      },
      verificationResults: [
        { checkType: 'domain_allowlist', status: 'pass' as const, severity: 'info' as const },
        { checkType: 'contact_validity', status: 'pass' as const, severity: 'info' as const },
        { checkType: 'description_completeness', status: 'pass' as const, severity: 'info' as const },
      ],
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.candidateScore).toBeDefined();
    expect(context.candidateScore?.overall).toBeGreaterThan(0);
    expect(context.candidateScore?.tier).toBeDefined();
  });

  it('assigns green tier for high scores', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      sourceCheck: {
        allowed: true,
        trustLevel: 'allowlisted' as const,
        sourceId: 'gov',
      },
      llmExtraction: {
        organizationName: 'Food Bank',
        serviceName: 'Food Assistance',
        description: 'A comprehensive and detailed food assistance program for families in need in the community.',
        websiteUrl: 'https://example.gov',
        phone: '555-1234',
        address: {
          line1: '123 Main St',
          city: 'Springfield',
          region: 'IL',
          postalCode: '62701',
          country: 'US',
        },
        confidence: 90,
        fieldConfidences: {},
      },
      verificationResults: [
        { checkType: 'domain_allowlist', status: 'pass' as const, severity: 'info' as const },
        { checkType: 'contact_validity', status: 'pass' as const, severity: 'info' as const },
        { checkType: 'description_completeness', status: 'pass' as const, severity: 'info' as const },
      ],
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.candidateScore?.tier).toBe('green');
  });
});

describe('BuildCandidateStage', () => {
  const stage = new BuildCandidateStage();

  it('has correct stage identifier', () => {
    expect(stage.stage).toBe('build_candidate');
  });

  it('fails if no extraction', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_extraction');
  });

  it('generates candidate and extraction IDs', async () => {
    const context: PipelineContext = {
      input: createInput('https://example.gov'),
      config: DEFAULT_PIPELINE_CONFIG,
      correlationId: 'test-123',
      stageResults: [],
      startedAt: new Date(),
      fetchResult: {
        canonicalUrl: 'https://example.gov',
        httpStatus: 200,
        contentHashSha256: 'abc123',
        body: '<html></html>',
        contentLength: 13,
        fetchedAt: new Date().toISOString(),
      },
      llmExtraction: {
        organizationName: 'Test Org',
        serviceName: 'Test Service',
        description: 'Test description',
        confidence: 70,
        fieldConfidences: {},
      },
      candidateScore: {
        overall: 75,
        tier: 'yellow' as const,
        subScores: {
          verification: 80,
          completeness: 70,
          freshness: 75,
        },
      },
    };

    const result = await stage.execute(context);
    expect(result.status).toBe('completed');
    expect(context.candidateId).toBeDefined();
    expect(context.extractionId).toBeDefined();
    // UUIDs are 36 characters
    expect(context.candidateId?.length).toBe(36);
    expect(context.extractionId?.length).toBe(36);
  });
});

// ============================================================================
// Orchestrator Integration Tests
// ============================================================================

describe('PipelineOrchestrator', () => {
  describe('processUrl', () => {
    it('returns failed status for disallowed URL', async () => {
      const orchestrator = createPipelineOrchestrator();
      const result = await orchestrator.processUrl(
        createInput('https://random-site.xyz/page')
      );

      expect(result.status).toBe('failed');
      expect(result.sourceCheck?.allowed).toBe(false);
      expect(result.finalStage).toBe('source_check');
    });

    it('returns correlation ID in result', async () => {
      const orchestrator = createPipelineOrchestrator();
      const result = await orchestrator.processUrl(
        createInput('https://example.gov', { correlationId: 'test-corr-123' })
      );

      expect(result.correlationId).toBe('test-corr-123');
    });

    it('generates correlation ID if not provided', async () => {
      const orchestrator = createPipelineOrchestrator();
      const result = await orchestrator.processUrl(
        createInput('https://example.gov')
      );

      expect(result.correlationId).toBeDefined();
      expect(result.correlationId.length).toBe(36); // UUID format
    });

    it('respects maxStages limit', async () => {
      const orchestrator = createPipelineOrchestrator();
      const result = await orchestrator.processUrl(
        createInput('https://example.gov', { maxStages: 1 })
      );

      // Should only run source_check stage
      expect(result.stages.length).toBe(1);
      expect(result.stages[0].stage).toBe('source_check');
      expect(result.finalStage).toBe('source_check');
    });

    it('emits pipeline events', async () => {
      const events: PipelineEvent[] = [];
      const orchestrator = createPipelineOrchestrator({
        onEvent: (event) => events.push(event),
      });

      await orchestrator.processUrl(
        createInput('https://example.gov', { maxStages: 1 })
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('pipeline_started');
      expect(events[events.length - 1].type).toBe('pipeline_completed');
    });

    it('stops on critical failure when stopOnFailure is true', async () => {
      const orchestrator = createPipelineOrchestrator({
        config: { stopOnFailure: true },
      });

      const result = await orchestrator.processUrl(
        createInput('https://random-site.xyz/page')
      );

      // Should stop after source_check fails
      expect(result.status).toBe('failed');
      expect(result.finalStage).toBe('source_check');
    });
  });

  describe('processBatch', () => {
    it('processes multiple URLs sequentially', async () => {
      const orchestrator = createPipelineOrchestrator();
      const inputs = [
        createInput('https://site1.gov', { maxStages: 1 }),
        createInput('https://site2.edu', { maxStages: 1 }),
      ];

      const results = await orchestrator.processBatch(inputs);

      expect(results.length).toBe(2);
      expect(results[0].sourceUrl).toBe('https://site1.gov');
      expect(results[1].sourceUrl).toBe('https://site2.edu');
    });

    it('respects maxUrls limit', async () => {
      const orchestrator = createPipelineOrchestrator();
      const inputs = Array.from({ length: 10 }, (_, i) =>
        createInput(`https://site${i}.gov`, { maxStages: 1 })
      );

      const results = await orchestrator.processBatch(inputs, { maxUrls: 3 });

      expect(results.length).toBe(3);
    });

    it('supports concurrent processing', async () => {
      const orchestrator = createPipelineOrchestrator();
      const inputs = [
        createInput('https://site1.gov', { maxStages: 1 }),
        createInput('https://site2.edu', { maxStages: 1 }),
        createInput('https://site3.gov', { maxStages: 1 }),
      ];

      const results = await orchestrator.processBatch(inputs, { maxConcurrent: 2 });

      expect(results.length).toBe(3);
    });
  });

  describe('getConfig', () => {
    it('returns readonly config copy', () => {
      const orchestrator = createPipelineOrchestrator();
      const config1 = orchestrator.getConfig();
      const config2 = orchestrator.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });
});

// ============================================================================
// Result Structure Tests
// ============================================================================

describe('PipelineResult structure', () => {
  it('includes all required fields', async () => {
    const orchestrator = createPipelineOrchestrator();
    const result = await orchestrator.processUrl(
      createInput('https://example.gov', { maxStages: 1 })
    );

    expect(result.sourceUrl).toBeDefined();
    expect(result.correlationId).toBeDefined();
    expect(result.status).toBeDefined();
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.stages).toBeInstanceOf(Array);
    expect(result.finalStage).toBeDefined();
  });

  it('has ISO timestamp format for dates', async () => {
    const orchestrator = createPipelineOrchestrator();
    const result = await orchestrator.processUrl(
      createInput('https://example.gov', { maxStages: 1 })
    );

    // ISO 8601 format check
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    expect(result.startedAt).toMatch(isoRegex);
    expect(result.completedAt).toMatch(isoRegex);
  });
});
