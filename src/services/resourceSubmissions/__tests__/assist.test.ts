import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetcherMocks = vi.hoisted(() => ({
  createPageFetcher: vi.fn(),
  createHtmlTextExtractor: vi.fn(),
  isFetchError: vi.fn(),
  fetch: vi.fn(),
  extract: vi.fn(),
}));

const llmMocks = vi.hoisted(() => ({
  getLLMConfigFromEnv: vi.fn(),
  createLLMClient: vi.fn(),
}));

vi.mock('@/agents/ingestion/fetcher', () => ({
  createPageFetcher: fetcherMocks.createPageFetcher,
  createHtmlTextExtractor: fetcherMocks.createHtmlTextExtractor,
  isFetchError: fetcherMocks.isFetchError,
}));

vi.mock('@/agents/ingestion/llm', () => ({
  getLLMConfigFromEnv: llmMocks.getLLMConfigFromEnv,
  createLLMClient: llmMocks.createLLMClient,
}));

import { createEmptyResourceSubmissionDraft } from '@/domain/resourceSubmission';
import { assistResourceSubmissionFromSource } from '@/services/resourceSubmissions/assist';

describe('assistResourceSubmissionFromSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetcherMocks.createPageFetcher.mockReturnValue({ fetch: fetcherMocks.fetch });
    fetcherMocks.createHtmlTextExtractor.mockReturnValue({ extract: fetcherMocks.extract });
  });

  it('falls back to source-only suggestions when no LLM config is available', async () => {
    const draft = createEmptyResourceSubmissionDraft('listing', 'public');

    fetcherMocks.fetch.mockResolvedValue({
      canonicalUrl: 'https://example.org/pantry',
      body: '<html>pantry</html>',
    });
    fetcherMocks.isFetchError.mockReturnValue(false);
    fetcherMocks.extract.mockReturnValue({
      title: 'Helping Hands Pantry - Example',
      metaDescription: 'Weekly grocery support for county residents.',
      text: 'Helping Hands Pantry offers weekly grocery support. Email help@example.org or call 555-123-4567 for food pantry assistance.',
      wordCount: 22,
    });
    llmMocks.getLLMConfigFromEnv.mockReturnValue({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: '',
      apiKey: '',
    });

    const result = await assistResourceSubmissionFromSource({
      draft,
      sourceUrl: 'https://example.org/pantry',
    });

    expect(result.summary.llmUsed).toBe(false);
    expect(result.patch.organization?.name).toBe('Helping Hands Pantry');
    expect(result.patch.organization?.email).toBe('help@example.org');
    expect(result.patch.organization?.phone).toBe('555-123-4567');
    expect(result.patch.service?.name).toBe('Helping Hands Pantry');
    expect(result.summary.categoriesSuggested).toContain('food');
    expect(result.summary.warnings).toContain('LLM assist is not configured. Applied source-based suggestions only.');
    expect(result.changedFields).toContain('service.name');
    expect(llmMocks.createLLMClient).not.toHaveBeenCalled();
  });

  it('merges extracted LLM suggestions and normalizes categorize tags into canonical taxonomy', async () => {
    const draft = createEmptyResourceSubmissionDraft('listing', 'host');

    fetcherMocks.fetch.mockResolvedValue({
      canonicalUrl: 'https://example.org/legal-help',
      body: '<html>legal help</html>',
    });
    fetcherMocks.isFetchError.mockReturnValue(false);
    fetcherMocks.extract.mockReturnValue({
      title: 'Example Legal Center',
      metaDescription: 'Free legal help and utility assistance.',
      text: 'Official service page content.',
      wordCount: 40,
    });
    llmMocks.getLLMConfigFromEnv.mockReturnValue({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: 'https://example.openai.azure.com',
      apiKey: 'test-key',
    });
    llmMocks.createLLMClient.mockResolvedValue({
      provider: 'mock',
      model: 'mock-model',
      extract: vi.fn().mockResolvedValue({
        success: true,
        data: {
          services: [{
            organizationName: 'Example Legal Center',
            serviceName: 'Legal and utility assistance',
            description: 'Legal aid plus utility bill advocacy.',
            category: 'legal',
            websiteUrl: 'https://example.org/legal-help',
            phones: [{ number: '555-222-3333', type: 'voice', context: 'Main intake' }],
            email: 'intake@example.org',
            address: {
              line1: '100 Justice Ave',
              line2: null,
              city: 'Boise',
              region: 'ID',
              postalCode: '83702',
              country: 'US',
            },
            hours: [{ dayOfWeek: 'monday', opensAt: '09:00', closesAt: '17:00', is24Hours: false, isClosed: false, notes: null }],
            eligibility: {
              description: 'Residents with utility shutoff notices may qualify.',
              ageMin: 18,
              ageMax: null,
              incomeRequirement: null,
              residencyRequirement: null,
              documentationRequired: ['Photo ID', 'Shutoff notice'],
              restrictions: [],
            },
            applicationProcess: 'Call the intake line to start.',
            fees: 'Free',
            languages: ['English', 'Spanish'],
            isRemoteService: false,
            serviceAreaDescription: 'Ada County',
          }],
          confidences: [{
            organizationName: { confidence: 80 },
            serviceName: { confidence: 90 },
            description: { confidence: 70 },
          }],
          pageType: 'service_listing',
        },
      }),
      categorize: vi.fn().mockResolvedValue({
        success: true,
        data: {
          tags: [
            { tag: 'legal', confidence: 92, reasoning: null },
            { tag: 'utilities', confidence: 84, reasoning: null },
          ],
          primaryCategory: 'legal',
        },
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    });

    const result = await assistResourceSubmissionFromSource({
      draft,
      sourceUrl: 'https://example.org/legal-help',
    });

    expect(result.summary.llmUsed).toBe(true);
    expect(result.summary.confidence).toBe(80);
    expect(result.patch.service?.name).toBe('Legal and utility assistance');
    expect(result.patch.organization?.email).toBe('intake@example.org');
    expect(result.patch.access?.serviceAreas).toEqual(['Ada County']);
    expect(result.patch.access?.requiredDocuments).toEqual(['Photo ID', 'Shutoff notice']);
    expect(result.patch.taxonomy?.categories).toEqual(['legal_aid', 'utility_assistance']);
    expect(result.summary.categoriesSuggested).toEqual(['legal_aid', 'utility_assistance']);
    expect(result.changedFields).toContain('taxonomy.categories');
    expect(llmMocks.createLLMClient).toHaveBeenCalledTimes(1);
  });
});
