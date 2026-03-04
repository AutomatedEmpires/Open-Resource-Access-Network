/**
 * Pipeline Module - Orchestrates the ingestion pipeline.
 *
 * This module chains all extraction stages together:
 * 1. Source Check - Validates URL against source registry
 * 2. Fetch - Downloads content with redirect tracking
 * 3. Extract Text - Converts HTML to readable text
 * 4. Discover Links - Finds contact/apply/eligibility links
 * 5. LLM Extract - Uses LLM to extract structured data
 * 6. LLM Categorize - Uses LLM to categorize services
 * 7. Verify - Runs verification checks
 * 8. Score - Computes confidence scores
 * 9. Build Candidate - Creates final candidate record
 *
 * @module
 */

// Types
export type {
  PipelineStageHandler,
  PipelineConfig,
  PipelineContext,
  PipelineEvent,
  PipelineEventListener,
  PipelineInput,
  PipelineResult,
  StageResult,
  SourceCheckResult,
  PipelineStage,
  StageStatus,
} from './types';

export { PipelineStageSchema, PipelineConfigSchema, StageStatusSchema } from './types';

// Orchestrator
export {
  PipelineOrchestrator,
  createPipelineOrchestrator,
  DEFAULT_PIPELINE_CONFIG,
  type PipelineOrchestratorOptions,
  type PipelineEventHandler,
  type PipelineResultStore,
} from './orchestrator';

// Individual stages (for testing / custom pipelines)
export {
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
} from './stages';
