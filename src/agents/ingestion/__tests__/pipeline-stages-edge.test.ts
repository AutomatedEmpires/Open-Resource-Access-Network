import crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as checklistModule from '../checklist';
import * as fetcherModule from '../fetcher';
import type { FetchResult, Fetcher } from '../fetcher';
import type { LLMClient } from '../llm';
import * as llmModule from '../llm';
import { DEFAULT_PIPELINE_CONFIG } from '../pipeline/orchestrator';
import {
  BuildCandidateStage,
  DiscoverLinksStage,
  ExtractTextStage,
  FetchStage,
  LlmCategorizeStage,
  LlmExtractStage,
  ScoreStage,
  SourceCheckStage,
  VerifyStage,
} from '../pipeline/stages';
import type { PipelineContext, PipelineInput } from '../pipeline/types';
import * as sourceRegistryModule from '../sourceRegistry';

const createInput = (sourceUrl = 'https://example.gov/services'): PipelineInput => ({
  sourceUrl,
  forceReprocess: false,
});

const createContext = (overrides: Partial<PipelineContext> = {}): PipelineContext => ({
  input: createInput(),
  config: DEFAULT_PIPELINE_CONFIG,
  correlationId: 'edge-case-123',
  stageResults: [],
  startedAt: new Date(),
  ...overrides,
});

const createPipelineFetchResult = (
  overrides: Partial<PipelineContext['fetchResult']> = {}
): NonNullable<PipelineContext['fetchResult']> => ({
  canonicalUrl: 'https://example.gov/services',
  httpStatus: 200,
  contentType: 'text/html',
  contentHashSha256: 'a'.repeat(64),
  body: '<html><body>Test</body></html>',
  contentLength: 30,
  fetchedAt: new Date().toISOString(),
  ...overrides,
});

const createFetcherResult = (overrides: Partial<FetchResult> = {}): FetchResult => ({
  requestedUrl: 'https://example.gov/services',
  canonicalUrl: 'https://example.gov/services',
  httpStatus: 200,
  contentType: 'text/html',
  contentHashSha256: 'b'.repeat(64),
  body: '<html><body><a href="/contact">Contact</a></body></html>',
  contentLength: 52,
  fetchedAt: new Date().toISOString(),
  redirectChain: ['https://example.gov/services'],
  headers: {},
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pipeline stages edge cases', () => {
  it('returns source_check_error when source matching throws', async () => {
    vi.spyOn(sourceRegistryModule, 'matchSourceForUrl').mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    const stage = new SourceCheckStage([]);
    const result = await stage.execute(createContext());

    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      code: 'source_check_error',
      retryable: true,
    });
    expect(result.error?.message).toContain('registry unavailable');
  });

  it('stores fetch and evidence snapshots on successful fetch', async () => {
    const stage = new FetchStage();
    const fetchResult = createFetcherResult({
      redirectChain: ['https://example.gov/start', 'https://example.gov/services'],
    });
    const fetcher: Fetcher = {
      fetch: vi.fn().mockResolvedValue(fetchResult),
    };

    const context = createContext({
      fetcher,
      input: createInput('https://example.gov/start'),
    });

    const result = await stage.execute(context);

    expect(result.status).toBe('completed');
    expect(context.fetchResult).toBeDefined();
    expect(context.fetchResult?.canonicalUrl).toBe(fetchResult.canonicalUrl);
    expect(context.evidenceSnapshot?.canonicalUrl).toBe(fetchResult.canonicalUrl);
    expect(context.evidenceSnapshot?.evidenceId).toHaveLength(32);
    expect(result.metrics).toMatchObject({
      httpStatus: 200,
      redirectCount: 2,
      contentType: 'text/html',
    });
  });

  it('returns fetch_error when evidence builder throws', async () => {
    vi.spyOn(fetcherModule, 'createEvidenceBuilder').mockReturnValue({
      buildFromFetchResult: () => {
        throw new Error('snapshot build failed');
      },
    } as unknown as ReturnType<typeof fetcherModule.createEvidenceBuilder>);

    const stage = new FetchStage();
    const context = createContext({
      fetcher: {
        fetch: vi.fn().mockResolvedValue(createFetcherResult()),
      },
    });

    const result = await stage.execute(context);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('fetch_error');
    expect(result.error?.message).toContain('snapshot build failed');
  });

  it('returns extract_text_error when text extractor throws', async () => {
    vi.spyOn(fetcherModule, 'createHtmlTextExtractor').mockReturnValue({
      extract: () => {
        throw new Error('extractor crashed');
      },
    } as unknown as ReturnType<typeof fetcherModule.createHtmlTextExtractor>);

    const stage = new ExtractTextStage();
    const result = await stage.execute(
      createContext({
        fetchResult: createPipelineFetchResult(),
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('extract_text_error');
  });

  it('returns discover_links_error when link discovery throws', async () => {
    vi.spyOn(fetcherModule, 'createLinkDiscovery').mockReturnValue({
      discover: () => {
        throw new Error('discovery failed');
      },
    } as unknown as ReturnType<typeof fetcherModule.createLinkDiscovery>);

    const stage = new DiscoverLinksStage();
    const result = await stage.execute(
      createContext({
        fetchResult: createPipelineFetchResult(),
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('discover_links_error');
    expect(stage.shouldSkip?.(createContext({ discoveredLinks: [] }))).toBe(true);
  });

  it('returns llm_not_configured when LLM env config is missing', async () => {
    vi.spyOn(llmModule, 'getLLMConfigFromEnv').mockReturnValue({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: undefined,
      apiKey: undefined,
    });

    const stage = new LlmExtractStage();
    const result = await stage.execute(
      createContext({
        textExtraction: {
          text: 'service description',
          title: 'Example Service',
          wordCount: 2,
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('llm_not_configured');
  });

  it('surfaces LLM extraction failure from dynamically created client', async () => {
    const client: LLMClient = {
      provider: 'mock',
      model: 'mock-model',
      extract: vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'rate_limited', message: 'retry later', retryable: true },
      }),
      categorize: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(llmModule, 'getLLMConfigFromEnv').mockReturnValue({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: 'https://example.openai.azure.com',
      apiKey: 'test-key',
      apiVersion: '2024-08-01-preview',
    });
    const createClientSpy = vi.spyOn(llmModule, 'createLLMClient').mockResolvedValue(client);

    const stage = new LlmExtractStage();
    const result = await stage.execute(
      createContext({
        textExtraction: {
          text: 'service description',
          title: 'Example Service',
          wordCount: 2,
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('rate_limited');
    expect(createClientSpy).toHaveBeenCalledTimes(1);
  });

  it('returns invalid_response when extraction returns no services', async () => {
    const stage = new LlmExtractStage({
      llmClient: {
        provider: 'mock',
        model: 'mock-model',
        extract: vi.fn().mockResolvedValue({
          success: true,
          data: {
            services: [],
            confidences: [],
            pageType: 'unknown',
          },
        }),
        categorize: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
      },
    });

    const result = await stage.execute(
      createContext({
        textExtraction: {
          text: 'service description',
          title: 'Example Service',
          wordCount: 2,
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('invalid_response');
    expect(
      stage.shouldSkip?.(
        createContext({
          llmExtraction: {
            organizationName: 'Org',
            serviceName: 'Service',
            description: 'Description',
            confidence: 80,
            fieldConfidences: {},
          },
        })
      )
    ).toBe(true);
  });

  it('returns llm_not_configured from categorization when env config is missing', async () => {
    vi.spyOn(llmModule, 'getLLMConfigFromEnv').mockReturnValue({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: undefined,
      apiKey: undefined,
    });

    const stage = new LlmCategorizeStage();
    const result = await stage.execute(
      createContext({
        llmExtraction: {
          organizationName: 'Org',
          serviceName: 'Service',
          description: 'Description',
          confidence: 70,
          fieldConfidences: {},
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('llm_not_configured');
  });

  it('surfaces LLM categorization failure from client', async () => {
    const stage = new LlmCategorizeStage({
      llmClient: {
        provider: 'mock',
        model: 'mock-model',
        extract: vi.fn(),
        categorize: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'parse_error', message: 'bad output', retryable: false },
        }),
        healthCheck: vi.fn().mockResolvedValue(true),
      },
    });

    const result = await stage.execute(
      createContext({
        llmExtraction: {
          organizationName: 'Org',
          serviceName: 'Service',
          description: 'Description',
          confidence: 70,
          fieldConfidences: {},
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('parse_error');
    expect(
      stage.shouldSkip?.(
        createContext({
          llmCategorization: {
            categories: ['food'],
            categoryConfidences: { food: 90 },
          },
        })
      )
    ).toBe(true);
  });

  it('marks domain allowlist as unknown for quarantine trust level', async () => {
    const stage = new VerifyStage();
    const context = createContext({
      sourceCheck: {
        allowed: true,
        trustLevel: 'quarantine',
      },
      llmExtraction: {
        organizationName: 'Org',
        serviceName: 'Service',
        description: 'This is a long enough description to satisfy policy constraints.',
        confidence: 70,
        fieldConfidences: {},
      },
    });

    const result = await stage.execute(context);
    const domain = context.verificationResults?.find((r) => r.checkType === 'domain_allowlist');

    expect(result.status).toBe('completed');
    expect(domain?.status).toBe('unknown');
  });

  it('returns verify_error when malformed extraction causes runtime error', async () => {
    const stage = new VerifyStage();
    const result = await stage.execute(
      createContext({
        llmExtraction: {
          organizationName: 'Org',
          serviceName: 'Service',
          description: 'This is a long enough description to satisfy policy constraints.',
          confidence: 70,
          fieldConfidences: {},
          address: {
            city: 'Portland',
            region: 'OR',
            postalCode: '97201',
          } as unknown as NonNullable<PipelineContext['llmExtraction']>['address'],
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('verify_error');
    expect(stage.shouldSkip?.(createContext({ verificationResults: [] }))).toBe(true);
  });

  it('computes yellow tier for moderate score', async () => {
    const stage = new ScoreStage();
    const context = createContext({
      llmExtraction: {
        organizationName: 'Org',
        serviceName: 'Service',
        description: 'Detailed description long enough to count for completeness scoring in this stage.',
        websiteUrl: 'https://example.gov',
        confidence: 70,
        fieldConfidences: {},
      },
    });

    const result = await stage.execute(context);

    expect(result.status).toBe('completed');
    expect(context.candidateScore?.tier).toBe('yellow');
  });

  it('computes orange tier for lower score', async () => {
    const stage = new ScoreStage();
    const context = createContext({
      sourceCheck: {
        allowed: true,
        trustLevel: 'quarantine',
      },
      llmExtraction: {
        organizationName: 'Org',
        serviceName: 'Service',
        description: 'Detailed description long enough to count for completeness scoring in this stage.',
        confidence: 70,
        fieldConfidences: {},
      },
    });

    const result = await stage.execute(context);

    expect(result.status).toBe('completed');
    expect(context.candidateScore?.tier).toBe('orange');
    expect(context.candidateScore?.subScores.freshness).toBe(40);
  });

  it('computes red tier when scores are minimal and critical verification fails', async () => {
    const stage = new ScoreStage();
    const context = createContext({
      sourceCheck: {
        allowed: true,
        trustLevel: 'quarantine',
      },
      llmExtraction: {
        organizationName: '',
        serviceName: '',
        description: '',
        confidence: 10,
        fieldConfidences: {},
      },
      verificationResults: [
        {
          checkType: 'policy_constraints',
          status: 'fail',
          severity: 'critical',
        },
      ],
    });

    const result = await stage.execute(context);

    expect(result.status).toBe('completed');
    expect(context.candidateScore?.tier).toBe('red');
  });

  it('returns score_error when checklist generation throws', async () => {
    vi.spyOn(checklistModule, 'buildDefaultChecklist').mockImplementation(() => {
      throw new Error('checklist unavailable');
    });

    const stage = new ScoreStage();
    const result = await stage.execute(
      createContext({
        llmExtraction: {
          organizationName: 'Org',
          serviceName: 'Service',
          description: 'Description',
          confidence: 70,
          fieldConfidences: {},
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('score_error');
    expect(
      stage.shouldSkip?.(
        createContext({
          candidateScore: {
            overall: 70,
            tier: 'yellow',
            subScores: {
              verification: 70,
              completeness: 70,
              freshness: 70,
            },
          },
        })
      )
    ).toBe(true);
  });

  it('returns build_candidate_error when uuid generation fails', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('uuid failure');
    });

    const stage = new BuildCandidateStage();
    const result = await stage.execute(
      createContext({
        llmExtraction: {
          organizationName: 'Org',
          serviceName: 'Service',
          description: 'Description',
          confidence: 70,
          fieldConfidences: {},
        },
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('build_candidate_error');
    expect(stage.shouldSkip?.(createContext({ candidateId: 'already-built' }))).toBe(true);
  });
});
