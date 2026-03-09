/**
 * Demo script: runs the FULL ingestion pipeline (all 9 stages) against a real URL.
 *
 * Expects LLM_ENDPOINT and LLM_API_KEY in the environment.
 *
 * Usage:  npx tsx scripts/run-pipeline-demo.ts [url]
 */
import { PipelineOrchestrator } from '../src/agents/ingestion/pipeline/orchestrator';

const url = process.argv[2] ?? 'https://www.benefits.gov/benefit/361';

async function main() {
  console.log('='.repeat(72));
  console.log('ORAN Ingestion Pipeline — Full 9-Stage Live Demo');
  console.log('='.repeat(72));
  console.log(`Target URL  : ${url}`);
  console.log(`LLM Provider: ${process.env.LLM_PROVIDER ?? 'azure_openai (default)'}`);
  console.log(`LLM Model   : ${process.env.LLM_MODEL ?? '(default)'}`);
  console.log(`LLM Endpoint: ${process.env.LLM_ENDPOINT ? '✓ configured' : '✗ missing'}`);
  console.log(`LLM API Key : ${process.env.LLM_API_KEY ? '✓ configured' : '✗ missing'}`);
  console.log(`Timestamp   : ${new Date().toISOString()}`);
  console.log('');

  const orchestrator = new PipelineOrchestrator({
    config: {
      enableLlmExtraction: true,
      enableVerification: true,
      fetchTimeoutMs: 30_000,
      llmTimeoutMs: 120_000,
      stopOnFailure: true,
    },
  });

  console.log('Running all 9 stages...\n');

  const result = await orchestrator.processUrl({ sourceUrl: url, forceReprocess: false });

  console.log('\n' + '='.repeat(72));
  console.log('RESULT');
  console.log('='.repeat(72));
  console.log(`Status         : ${result.status}`);
  console.log(`Stages run     : ${result.stages.filter(s => s.status === 'completed').length}`);
  console.log(`Overall score  : ${result.confidenceScore ?? 'N/A'} (${result.confidenceTier ?? '—'})`);
  console.log(`Duration       : ${result.totalDurationMs} ms`);
  console.log(`Correlation ID : ${result.correlationId}`);
  if (result.status === 'failed') console.log(`Final stage    : ${result.finalStage}`);
  console.log('');

  // Per-stage summary
  console.log('Stage timings:');
  for (const s of result.stages) {
    const icon = s.status === 'completed' ? '✓' : s.status === 'skipped' ? '–' : '✗';
    console.log(`  ${icon} ${s.stage.padEnd(24)} ${String(s.durationMs ?? 0).padStart(6)} ms  ${s.status}`);
  }
}

main().catch((err) => {
  console.error('Pipeline crashed:', err);
  process.exit(1);
});
