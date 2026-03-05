import { describe, expect, it } from 'vitest';

import * as fetcherIndex from '../fetcher';
import * as fetcherModule from '../fetcher/fetcher';
import * as htmlExtractorModule from '../fetcher/htmlExtractor';
import * as linkDiscoveryModule from '../fetcher/linkDiscovery';
import * as evidenceBuilderModule from '../fetcher/evidenceBuilder';
import * as dedupeModule from '../fetcher/dedupIntegration';

import * as llmIndex from '../llm';
import * as llmClientModule from '../llm/client';
import * as llmPromptsIndex from '../llm/prompts';
import * as llmExtractionPromptModule from '../llm/prompts/extraction';
import * as llmCategorizationPromptModule from '../llm/prompts/categorization';
import * as llmProvidersIndex from '../llm/providers';
import * as azureProviderModule from '../llm/providers/azureOpenai';

import * as pipelineIndex from '../pipeline';
import * as pipelineOrchestratorModule from '../pipeline/orchestrator';
import * as pipelineStagesModule from '../pipeline/stages';

describe('ingestion barrel indexes', () => {
  it('re-exports fetcher module entry points', () => {
    expect(fetcherIndex.createPageFetcher).toBe(fetcherModule.createPageFetcher);
    expect(fetcherIndex.extractTextFromHtml).toBe(htmlExtractorModule.extractTextFromHtml);
    expect(fetcherIndex.discoverLinks).toBe(linkDiscoveryModule.discoverLinks);
    expect(fetcherIndex.buildEvidenceSnapshot).toBe(evidenceBuilderModule.buildEvidenceSnapshot);
    expect(fetcherIndex.computeExtractKeySha256).toBe(dedupeModule.computeExtractKeySha256);
  });

  it('re-exports llm module entry points and prompts/providers indexes', () => {
    expect(llmIndex.createLLMClient).toBe(llmClientModule.createLLMClient);
    expect(llmIndex.getLLMConfigFromEnv).toBe(llmClientModule.getLLMConfigFromEnv);
    expect(llmIndex.buildExtractionMessages).toBe(llmExtractionPromptModule.buildExtractionMessages);
    expect(llmIndex.buildCategorizationMessages).toBe(llmCategorizationPromptModule.buildCategorizationMessages);
    expect(llmPromptsIndex.buildExtractionMessages).toBe(llmExtractionPromptModule.buildExtractionMessages);
    expect(llmPromptsIndex.getValidCategories).toBe(llmCategorizationPromptModule.getValidCategories);
    expect(llmProvidersIndex.createAzureOpenAIClient).toBe(azureProviderModule.createAzureOpenAIClient);
  });

  it('re-exports pipeline orchestrator and stage constructors', () => {
    expect(pipelineIndex.createPipelineOrchestrator).toBe(pipelineOrchestratorModule.createPipelineOrchestrator);
    expect(pipelineIndex.DEFAULT_PIPELINE_CONFIG).toBe(pipelineOrchestratorModule.DEFAULT_PIPELINE_CONFIG);
    expect(pipelineIndex.createPipelineStages).toBe(pipelineStagesModule.createPipelineStages);
    expect(pipelineIndex.ScoreStage).toBe(pipelineStagesModule.ScoreStage);
  });
});
