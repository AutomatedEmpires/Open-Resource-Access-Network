import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAzureOpenAIClient } from '@/agents/ingestion/llm/providers/azureOpenai';
import { verifyCandidate } from '../../../../functions/verifyCandidate';
import { isReviewAssistConfigured } from '@/services/admin/reviewAssist';
import { isConfigured as isIntentEnrichmentConfigured } from '@/services/chat/intentEnrich';
import { summarizeWithLLM } from '@/services/chat/llm';
import { isFeedbackTriageConfigured } from '@/services/feedback/triage';
import {
  geocode,
  isConfigured as isGeocodingConfigured,
  reverseGeocode,
} from '@/services/geocoding/azureMaps';
import {
  isConfigured as isTranslatorConfigured,
  translate,
} from '@/services/i18n/translator';
import { isDocIntelligenceConfigured } from '@/services/ingestion/docIntelligence';
import { embedForQuery } from '@/services/search/embeddings';
import { checkCrisisContentSafety } from '@/services/security/contentSafety';
import {
  isConfigured as isSpeechConfigured,
  synthesizeSpeech,
} from '@/services/tts/azureSpeech';

const fetchMock = vi.hoisted(() => vi.fn());

describe('retired Microsoft provider adapters', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AZURE_MAPS_KEY', 'retired');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com');
    vi.stubEnv('AZURE_OPENAI_KEY', 'retired');
    vi.stubEnv('AZURE_SPEECH_KEY', 'retired');
    vi.stubEnv('AZURE_SPEECH_REGION', 'westus2');
    vi.stubEnv('AZURE_TRANSLATOR_KEY', 'retired');
    vi.stubEnv('AZURE_TRANSLATOR_ENDPOINT', 'https://api.cognitive.microsofttranslator.com');
    vi.stubEnv('AZURE_TRANSLATOR_REGION', 'westus2');
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'https://oran.cognitiveservices.azure.com');
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', 'retired');
    vi.stubEnv('AZURE_CONTENT_SAFETY_ENDPOINT', 'https://oran.cognitiveservices.azure.com');
    vi.stubEnv('AZURE_CONTENT_SAFETY_KEY', 'retired');
    vi.stubEnv('FOUNDRY_ENDPOINT', 'https://oran.openai.azure.com');
    vi.stubEnv('FOUNDRY_KEY', 'retired');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('cannot become configured in production even when retired secrets return', async () => {
    expect(isGeocodingConfigured()).toBe(false);
    expect(isReviewAssistConfigured()).toBe(false);
    expect(isIntentEnrichmentConfigured()).toBe(false);
    expect(isFeedbackTriageConfigured()).toBe(false);
    expect(isTranslatorConfigured()).toBe(false);
    expect(isDocIntelligenceConfigured()).toBe(false);
    expect(isSpeechConfigured()).toBe(false);

    await expect(geocode('123 Main Street')).resolves.toEqual([]);
    await expect(reverseGeocode(47.6, -122.3)).resolves.toBeNull();
    await expect(synthesizeSpeech('hello')).resolves.toBeNull();
    await expect(embedForQuery('food help')).resolves.toBeNull();
    await expect(checkCrisisContentSafety('I feel hopeless')).resolves.toBe(false);
    await expect(summarizeWithLLM([], {
      category: 'general',
      rawQuery: 'help',
      urgencyQualifier: 'standard',
    })).rejects.toThrow('LLM summarization provider is not configured');
    await expect(translate({ text: 'hello', to: 'es' })).resolves.toMatchObject({
      originalText: 'hello',
      translatedText: 'hello',
    });
    await expect(verifyCandidate({
      candidateId: 'candidate-1',
      sourceUrl: 'https://example.org/service',
      correlationId: 'correlation-1',
      confidenceScore: 80,
      confidenceTier: 'green',
      enqueuedAt: '2026-07-14T00:00:00.000Z',
    })).rejects.toThrow('Legacy Azure Functions are archived');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects direct construction of the retired Azure LLM provider', async () => {
    await expect(createAzureOpenAIClient({
      provider: 'azure_openai',
      model: 'gpt-4o',
      endpoint: 'https://oran.openai.azure.com',
      apiKey: 'retired',
    })).rejects.toThrow('Azure OpenAI provider is retired');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
