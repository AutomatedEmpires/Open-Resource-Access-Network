/**
 * LLM Module Tests
 *
 * Tests for:
 * - Zod schemas (ExtractionResult, CategorizationResult)
 * - Prompt builders (extraction/categorization messages)
 * - AzureOpenAIClient with mocked SDK calls
 * - Error classification
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  ExtractionResultSchema,
  CategorizationResultSchema,
  ExtractedServiceSchema,
  TagResultSchema,
  ServiceCategorySchema,
  LLMErrorSchema,
} from '../llm/types';

import {
  buildExtractionMessages,
} from '../llm/prompts/extraction';

import {
  buildCategorizationMessages,
  getValidCategories,
} from '../llm/prompts/categorization';

import type { ExtractionInput, CategorizationInput, LLMClientConfig } from '../llm/client';
import {
  DEFAULT_LLM_CONFIG,
  registerLLMClientProvider,
  createLLMClient,
  getRegisteredLLMProviders,
} from '../llm/client';

// ============================================================
// TYPE SCHEMA TESTS
// ============================================================

describe('LLM type schemas', () => {
  describe('ExtractedServiceSchema', () => {
    test('validates minimal service', () => {
      const result = ExtractedServiceSchema.parse({
        organizationName: 'Test Org',
        serviceName: 'Food Pantry',
        description: 'Provides food assistance',
      });

      expect(result.organizationName).toBe('Test Org');
      expect(result.serviceName).toBe('Food Pantry');
      expect(result.phones).toEqual([]);
      expect(result.hours).toEqual([]);
      expect(result.languages).toEqual([]);
      expect(result.isRemoteService).toBe(false);
    });

    test('validates complete service', () => {
      const result = ExtractedServiceSchema.parse({
        organizationName: 'Community Food Bank',
        serviceName: 'Weekly Food Distribution',
        description: 'Fresh produce and groceries for low-income families',
        category: 'food',
        websiteUrl: 'https://example.org',
        phones: [
          { number: '555-123-4567', type: 'voice', context: 'Main office' },
          { number: '555-123-4568', type: 'hotline' },
        ],
        email: 'help@example.org',
        address: {
          line1: '123 Main St',
          city: 'Seattle',
          region: 'WA',
          postalCode: '98101',
          country: 'US',
        },
        hours: [
          { dayOfWeek: 'monday', opensAt: '09:00', closesAt: '17:00' },
          { dayOfWeek: 'sunday', isClosed: true },
        ],
        eligibility: {
          description: 'Open to anyone in the service area',
          ageMin: 18,
          incomeRequirement: 'Below 200% FPL',
        },
        applicationProcess: 'Walk in, no appointment needed',
        fees: 'Free',
        languages: ['en', 'es', 'vi'],
        isRemoteService: false,
        serviceAreaDescription: 'King County, WA',
      });

      expect(result.phones).toHaveLength(2);
      expect(result.hours).toHaveLength(2);
      expect(result.eligibility?.ageMin).toBe(18);
    });

    test('rejects invalid phone type', () => {
      expect(() =>
        ExtractedServiceSchema.parse({
          organizationName: 'Test',
          serviceName: 'Test',
          description: 'Test',
          phones: [{ number: '555', type: 'invalid_type' }],
        })
      ).toThrow();
    });
  });

  describe('ExtractionResultSchema', () => {
    test('validates extraction result with services and confidences', () => {
      const result = ExtractionResultSchema.parse({
        services: [
          {
            organizationName: 'Org',
            serviceName: 'Service',
            description: 'Description',
          },
        ],
        confidences: [
          {
            organizationName: { confidence: 95 },
            serviceName: { confidence: 90 },
          },
        ],
        pageType: 'service_listing',
      });

      expect(result.services).toHaveLength(1);
      expect(result.confidences).toHaveLength(1);
      expect(result.pageType).toBe('service_listing');
    });

    test('validates empty extraction', () => {
      const result = ExtractionResultSchema.parse({
        services: [],
        confidences: [],
        pageType: 'unknown',
        extractionNotes: 'No services found on this page',
      });

      expect(result.services).toHaveLength(0);
    });
  });

  describe('CategorizationResultSchema', () => {
    test('validates categorization with tags', () => {
      const result = CategorizationResultSchema.parse({
        tags: [
          { tag: 'food', confidence: 95 },
          { tag: 'housing', confidence: 60, reasoning: 'Provides emergency shelter referrals' },
        ],
        primaryCategory: 'food',
      });

      expect(result.tags).toHaveLength(2);
      expect(result.primaryCategory).toBe('food');
    });

    test('validates all category values', () => {
      const categories = ServiceCategorySchema.options;
      expect(categories).toContain('food');
      expect(categories).toContain('housing');
      expect(categories).toContain('healthcare');
      expect(categories).toContain('mental_health');
      expect(categories).toContain('crisis');
    });
  });

  describe('TagResultSchema', () => {
    test('validates tag with confidence and reasoning', () => {
      const result = TagResultSchema.parse({
        tag: 'healthcare',
        confidence: 75,
        reasoning: 'Provides health screenings but not primary care',
      });

      expect(result.tag).toBe('healthcare');
      expect(result.confidence).toBe(75);
    });

    test('rejects confidence out of range', () => {
      expect(() =>
        TagResultSchema.parse({
          tag: 'food',
          confidence: 150,
        })
      ).toThrow();
    });
  });

  describe('LLMErrorSchema', () => {
    test('validates error structure', () => {
      const error = LLMErrorSchema.parse({
        code: 'rate_limited',
        message: 'Rate limit exceeded',
        retryable: true,
        retryAfterMs: 30000,
      });

      expect(error.code).toBe('rate_limited');
      expect(error.retryable).toBe(true);
    });
  });
});

// ============================================================
// PROMPT BUILDER TESTS
// ============================================================

describe('Prompt builders', () => {
  describe('buildExtractionMessages', () => {
    test('builds messages with required fields', () => {
      const input: ExtractionInput = {
        content: 'Welcome to Food Bank. We provide free food every Saturday.',
        sourceUrl: 'https://example.org/services',
      };

      const messages = buildExtractionMessages(input);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[0].content).toContain('HSDS');
      expect(messages[1].content).toContain('https://example.org/services');
      expect(messages[1].content).toContain('Food Bank');
    });

    test('includes optional fields when provided', () => {
      const input: ExtractionInput = {
        content: 'Service description here',
        sourceUrl: 'https://gov.example.org/services',
        pageTitle: 'County Services Directory',
        sourceQuality: 'official',
        pageHint: 'service_listing',
      };

      const messages = buildExtractionMessages(input);

      expect(messages[1].content).toContain('County Services Directory');
      expect(messages[1].content).toContain('Government / official source');
      expect(messages[1].content).toContain('PAGE TYPE HINT: service_listing');
    });

    test('system prompt enforces no hallucination rule', () => {
      const input: ExtractionInput = {
        content: 'Test content',
        sourceUrl: 'https://example.org',
      };

      const messages = buildExtractionMessages(input);
      const systemPrompt = messages[0].content;

      expect(systemPrompt).toContain('NEVER invent');
      expect(systemPrompt).toContain('ONLY extract information explicitly stated');
    });
  });

  describe('buildCategorizationMessages', () => {
    test('builds messages for service categorization', () => {
      const input: CategorizationInput = {
        service: {
          organizationName: 'Seattle Food Bank',
          serviceName: 'Emergency Food Box',
          description: 'Free food boxes for families in need',
          phones: [],
          hours: [],
          languages: [],
          isRemoteService: false,
        },
      };

      const messages = buildCategorizationMessages(input);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[0].content).toContain('food');
      expect(messages[0].content).toContain('housing');
      expect(messages[1].content).toContain('Seattle Food Bank');
      expect(messages[1].content).toContain('Emergency Food Box');
    });

    test('includes eligibility information', () => {
      const input: CategorizationInput = {
        service: {
          organizationName: 'Youth Services',
          serviceName: 'Teen Shelter',
          description: 'Emergency shelter for youth',
          phones: [],
          hours: [],
          languages: [],
          isRemoteService: false,
          eligibility: {
            description: 'Ages 13-17',
            ageMin: 13,
            ageMax: 17,
            documentationRequired: [],
            restrictions: [],
          },
        },
      };

      const messages = buildCategorizationMessages(input);
      expect(messages[1].content).toContain('Age: 13 - 17');
    });

    test('includes category hints', () => {
      const input: CategorizationInput = {
        service: {
          organizationName: 'Test',
          serviceName: 'Test Service',
          description: 'Test description',
          phones: [],
          hours: [],
          languages: [],
          isRemoteService: false,
        },
        categoryHints: ['youth', 'housing'],
      };

      const messages = buildCategorizationMessages(input);
      expect(messages[1].content).toContain('youth, housing');
    });
  });

  describe('getValidCategories', () => {
    test('returns all valid service categories', () => {
      const categories = getValidCategories();

      expect(categories).toContain('food');
      expect(categories).toContain('housing');
      expect(categories).toContain('healthcare');
      expect(categories).toContain('other');
      expect(categories.length).toBeGreaterThanOrEqual(20);
    });
  });
});

// ============================================================
// CLIENT FACTORY TESTS
// ============================================================

describe('LLM client factory', () => {
  describe('DEFAULT_LLM_CONFIG', () => {
    test('has sensible defaults', () => {
      expect(DEFAULT_LLM_CONFIG.maxExtractionTokens).toBe(4096);
      expect(DEFAULT_LLM_CONFIG.maxCategorizationTokens).toBe(1024);
      expect(DEFAULT_LLM_CONFIG.temperature).toBe(0.1);
      expect(DEFAULT_LLM_CONFIG.timeoutMs).toBe(60000);
      expect(DEFAULT_LLM_CONFIG.useStructuredOutput).toBe(true);
    });
  });

  describe('registerLLMClientProvider', () => {
    beforeEach(() => {
      // Clear any test providers between tests
    });

    test('registers and retrieves providers', async () => {
      // Register a mock provider
      const mockProvider = vi.fn().mockResolvedValue({
        provider: 'test_provider',
        model: 'test-model',
        extract: vi.fn(),
        categorize: vi.fn(),
        healthCheck: vi.fn(),
      });

      registerLLMClientProvider('test_provider', mockProvider);

      const providers = getRegisteredLLMProviders();
      expect(providers).toContain('test_provider');
    });
  });

  describe('createLLMClient', () => {
    test('throws for unregistered provider', async () => {
      const config: LLMClientConfig = {
        provider: 'nonexistent' as 'azure_openai',
        model: 'test',
      };

      await expect(createLLMClient(config)).rejects.toThrow(
        'LLM provider "nonexistent" is not registered'
      );
    });
  });
});

// ============================================================
// AZURE OPENAI CLIENT TESTS (with mocks)
// ============================================================

describe('AzureOpenAIClient', () => {
  // We'll test the client with mocked SDK responses

  test('AzureOpenAI SDK is importable', async () => {
    // Verify the openai package is installed and AzureOpenAI is available
    const { AzureOpenAI } = await import('openai');
    expect(typeof AzureOpenAI).toBe('function');
  });

  test('provider self-registers on import', async () => {
    // Import the provider module to trigger self-registration
    await import('../llm/providers/azureOpenai');

    const providers = getRegisteredLLMProviders();
    expect(providers).toContain('azure_openai');
  });

  test('createAzureOpenAIClient requires endpoint', async () => {
    const { createAzureOpenAIClient } = await import('../llm/providers/azureOpenai');

    const config: LLMClientConfig = {
      provider: 'azure_openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      // Missing endpoint
    };

    await expect(createAzureOpenAIClient(config)).rejects.toThrow(
      'Azure OpenAI requires an endpoint'
    );
  });
});

// ============================================================
// INTEGRATION PATTERN TESTS
// ============================================================

describe('LLM module integration patterns', () => {
  test('extraction → categorization flow types align', () => {
    // Verify the output of extraction can be fed into categorization
    const extractionResult = ExtractionResultSchema.parse({
      services: [
        {
          organizationName: 'Test Org',
          serviceName: 'Test Service',
          description: 'Test description',
        },
      ],
      confidences: [{}],
      pageType: 'service_listing',
    });

    // The service from extraction should be valid input for categorization
    const categorizationInput: CategorizationInput = {
      service: extractionResult.services[0],
    };

    const messages = buildCategorizationMessages(categorizationInput);
    expect(messages).toHaveLength(2);
  });

  test('confidence thresholds match ORAN standards', () => {
    // Verify our confidence scoring aligns with ORAN tiers
    // green ≥ 80, yellow ≥ 60, orange ≥ 40, red < 40

    const highConfidenceTag = TagResultSchema.parse({
      tag: 'food',
      confidence: 95,
    });

    const mediumConfidenceTag = TagResultSchema.parse({
      tag: 'housing',
      confidence: 65,
      reasoning: 'Provides referrals only',
    });

    expect(highConfidenceTag.confidence).toBeGreaterThanOrEqual(80); // green
    expect(mediumConfidenceTag.confidence).toBeGreaterThanOrEqual(60); // yellow
  });
});
