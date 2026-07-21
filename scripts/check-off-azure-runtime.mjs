import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findProhibitedMicrosoftRuntimeSettings,
  isProhibitedMicrosoftEndpoint,
} from '../src/services/runtime/providerPolicyCore.js';
import {
  guardPrecedesEverySink,
  hasExecutableCall,
  inspectArchivedWorkflowJobs,
  parseWorkflowRunCommands,
  shellExecutableLines,
  stripJsCommentsAndStrings,
} from './off-azure-static-policy-core.mjs';

const root = resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function parseNames(relativePath) {
  return read(relativePath)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseEnvExample(relativePath) {
  const env = {};
  for (const rawLine of read(relativePath).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return env;
}

const violations = [];

const guardProbeName = 'assertAllowedRuntimeEndpoint';
const guardDecoyProbe = [
  `import { ${guardProbeName} } from './policy';`,
  `// ${guardProbeName}(candidate);`,
  `const note = '${guardProbeName}(candidate)';`,
].join('\n');
if (
  hasExecutableCall(guardDecoyProbe, guardProbeName)
  || !hasExecutableCall(`${guardDecoyProbe}\n${guardProbeName}(candidate);`, guardProbeName)
  || !hasExecutableCall(
    'const result = `endpoint: $' + `{${guardProbeName}(candidate)}` + '`;',
    guardProbeName,
  )
) {
  violations.push('static policy engine: import/comment/string guard decoy probe failed');
}

const workflowProbe = inspectArchivedWorkflowJobs([
  'if: ${{ false }}',
  'jobs:',
  '  disabled:',
  '    if: ${{ false }}',
  '    runs-on: ubuntu-latest',
  '  bypassed:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - if: ${{ false }}',
  '        run: echo never',
].join('\n'));
if (
  workflowProbe.jobNames.join(',') !== 'disabled,bypassed'
  || workflowProbe.jobsWithoutHardDisable.join(',') !== 'bypassed'
) {
  violations.push('static policy engine: archived workflow job-level guard probe failed');
}

for (const name of findProhibitedMicrosoftRuntimeSettings(
  parseNames('.github/runtime/webapp-production-settings.txt'),
)) {
  violations.push(`production settings manifest: ${name}`);
}

for (const name of findProhibitedMicrosoftRuntimeSettings(parseEnvExample('.env.example'))) {
  violations.push(`environment template: ${name}`);
}

function inspectJsonValue(value, path = 'vercel.json') {
  if (typeof value === 'string') {
    if (isProhibitedMicrosoftEndpoint(value)) violations.push(`${path}: Microsoft endpoint`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => inspectJsonValue(entry, `${path}.${key}`));
  }
}

inspectJsonValue(JSON.parse(read('vercel.json')));

const packageJson = JSON.parse(read('package.json'));
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (/build-functions|--target\s+functions/iu.test(String(command))) {
    violations.push(`package.json scripts.${name}: retired Functions runtime command`);
  }
}

if (/Azure Functions|build:functions/iu.test(read('.github/workflows/ci.yml'))) {
  violations.push('.github/workflows/ci.yml: retired Functions runtime job');
}

const guardedEndpointConsumers = [
  { path: 'src/services/cache/redis.ts', guardCall: guardProbeName },
  { path: 'src/app/sitemap.ts', guardCall: guardProbeName },
  { path: 'src/instrumentation-client.ts', guardCall: guardProbeName },
  { path: 'src/sentry.server.config.ts', guardCall: guardProbeName },
  { path: 'src/sentry.edge.config.ts', guardCall: guardProbeName },
  { path: 'src/services/db/runtimeRole.ts', guardCall: guardProbeName },
  { path: 'src/agents/ingestion/fetcher/fetcher.ts', guardCall: guardProbeName },
  {
    path: 'src/agents/ingestion/connectorUtils.ts',
    guardCall: guardProbeName,
    sinkPattern: /\bfetchFn\s*\(/u,
  },
  { path: 'src/agents/ingestion/hsdsFeedConnector.ts', guardCall: 'fetchWithValidatedRedirects' },
  { path: 'src/agents/ingestion/ndp211Connector.ts', guardCall: 'fetchWithValidatedRedirects' },
  { path: 'src/agents/ingestion/llm/client.ts', guardCall: guardProbeName },
  { path: 'src/app/org/[id]/page.tsx', guardCall: guardProbeName },
  { path: 'src/app/(seeker)/service/[id]/page.tsx', guardCall: guardProbeName },
  { path: 'src/lib/hooks/useFormSubmit.ts', guardCall: guardProbeName },
  { path: 'scripts/bootstrap-source-feed.mjs', guardCall: guardProbeName },
  { path: 'scripts/provision-owner-access.mjs', guardCall: guardProbeName },
  { path: 'scripts/run-211-canary-report.mjs', guardCall: guardProbeName },
  { path: 'scripts/run-211-feed-status-report.mjs', guardCall: guardProbeName },
  { path: 'scripts/capture-ui-snapshots.mjs', guardCall: guardProbeName },
  { path: 'scripts/load-test.mjs', guardCall: guardProbeName },
  { path: 'scripts/run-pipeline-demo.ts', guardCall: guardProbeName },
  { path: 'scripts/validate-runtime-endpoint.mjs', guardCall: guardProbeName },
];

for (const { path, guardCall, sinkPattern } of guardedEndpointConsumers) {
  const source = read(path);
  if (!hasExecutableCall(source, guardCall)) {
    violations.push(`${path}: generic outbound endpoint is not guarded by an executable call at use`);
    continue;
  }
  if (sinkPattern && !guardPrecedesEverySink(source, guardCall, sinkPattern)) {
    violations.push(`${path}: endpoint guard does not precede every generic network sink`);
  }
}

if (!hasExecutableCall(
  read('scripts/validate-runtime-endpoint.mjs'),
  'assertExpectedSupabaseProjectDatabaseEndpoint',
)) {
  violations.push('scripts/validate-runtime-endpoint.mjs: Supabase project identity is not guarded at use');
}

for (const connector of [
  'src/agents/ingestion/hsdsFeedConnector.ts',
  'src/agents/ingestion/ndp211Connector.ts',
]) {
  if (/\bfetchFn\s*\(/u.test(stripJsCommentsAndStrings(read(connector)))) {
    violations.push(`${connector}: feed request bypasses manually validated redirect handling`);
  }
}

const directGenericClientPatterns = [
  {
    pattern: /new\s+Pool\s*\(\s*\{\s*connectionString:\s*process\.env\./u,
    label: 'constructs a database pool directly from an unguarded environment value',
  },
  {
    pattern: /Sentry\.init\s*\(\s*\{[\s\S]*?dsn:\s*process\.env\./u,
    label: 'initializes Sentry directly from an unguarded environment value',
  },
];

for (const consumer of guardedEndpointConsumers) {
  const source = stripJsCommentsAndStrings(read(consumer.path));
  for (const { pattern, label } of directGenericClientPatterns) {
    if (pattern.test(source)) violations.push(`${consumer.path}: ${label}`);
  }
}

const archivedBuilder = read('scripts/build-functions.mjs');
if (
  !archivedBuilder.includes('ORAN_LEGACY_AZURE_FUNCTIONS_ARCHIVED')
  || /from\s+['"]esbuild['"]|\bbuild\s*\(/u.test(archivedBuilder)
) {
  violations.push('scripts/build-functions.mjs: retired Functions builder is not a hard archive tripwire');
}

if (existsSync(resolve(root, 'dist', 'host.json'))) {
  violations.push('dist/host.json: stale deployable Functions output must be removed');
}

for (const archivedScript of [
  'scripts/azure/bootstrap.sh',
  'scripts/azure/github-oidc.sh',
  'scripts/azure/rotate-maps-sas.sh',
]) {
  const source = read(archivedScript);
  const executableLines = shellExecutableLines(source);
  if (
    executableLines[0] !== 'set -euo pipefail'
    || !executableLines[1]?.startsWith('echo ')
    || !executableLines[1]?.includes('ORAN_LEGACY_AZURE_PROVISIONING_ARCHIVED')
    || executableLines[2] !== 'exit 1'
  ) {
    violations.push(`${archivedScript}: retired Azure provisioner is not a hard archive tripwire`);
  }
}

const archivedHost = JSON.parse(read('functions/host.json'));
if (
  !Array.isArray(archivedHost.functions)
  || archivedHost.functions.length !== 0
  || 'extensionBundle' in archivedHost
  || 'extensions' in archivedHost
  || JSON.stringify(archivedHost).toLowerCase().includes('applicationinsights')
) {
  violations.push('functions/host.json: retired host must expose zero functions and no provider extensions');
}

for (const entry of readdirSync(resolve(root, 'functions'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const relativePath = `functions/${entry.name}/index.ts`;
  let source;
  try {
    source = read(relativePath);
  } catch {
    continue;
  }

  const exportedHandlerCount = source.match(/export\s+async\s+function\s+[A-Za-z0-9_]+/gu)?.length ?? 0;
  const guardedHandlerCount = source.match(
    /export\s+async\s+function\s+[A-Za-z0-9_]+\s*\([\s\S]{0,400}?\)\s*:\s*Promise<[\s\S]{0,300}?>\s*\{\s*assertLegacyAzureFunctionsArchived\(\);/gu,
  )?.length ?? 0;

  if (exportedHandlerCount === 0) {
    violations.push(`${relativePath}: archived handler export not found`);
    continue;
  }

  if (guardedHandlerCount !== exportedHandlerCount) {
    violations.push(`${relativePath}: exported handler bypasses the first-statement archive boundary`);
  }
}

if (/process\.env\.(?:AZURE_|FOUNDRY_)/u.test(read('src/app/api/maps/token/route.ts'))) {
  violations.push('maps token route: retired provider credential access');
}

const crisisAdapterSource = stripJsCommentsAndStrings(read('src/services/security/contentSafety.ts'));
if (
  /process\.env\.(?:AZURE_|FOUNDRY_)/u.test(crisisAdapterSource)
  || /\bfetch\s*\(/u.test(crisisAdapterSource)
) {
  violations.push('content safety adapter: crisis routing must remain provider-independent');
}

const chatOrchestratorSource = stripJsCommentsAndStrings(read('src/services/chat/orchestrator.ts'));
if (
  /checkCrisisContentSafety|checkSemanticCrisis|CONTENT_SAFETY_CRISIS/u.test(chatOrchestratorSource)
) {
  violations.push('chat orchestrator: crisis routing depends on a retired external safety provider');
}

const retiredWorkflows = [
  '.github/workflows/deploy-azure-appservice.yml',
  '.github/workflows/deploy-azure-functions.yml',
  '.github/workflows/deploy-infra.yml',
  '.github/workflows/rotate-azure-maps-sas.yml',
];

for (const workflow of retiredWorkflows) {
  const inspection = inspectArchivedWorkflowJobs(read(workflow));
  if (inspection.jobNames.length === 0) {
    violations.push(`${workflow}: archived workflow defines no inspectable jobs`);
  }
  for (const jobName of inspection.jobsWithoutHardDisable) {
    violations.push(`${workflow}: retired Microsoft job ${jobName} is not hard-disabled at job level`);
  }
}

const migrationWorkflowPath = '.github/workflows/db-migrate.yml';
const migrationWorkflowSource = read(migrationWorkflowPath);
const migrationCommands = parseWorkflowRunCommands(migrationWorkflowSource);
const endpointValidationCommand = 'node scripts/validate-runtime-endpoint.mjs SUPABASE_DB_URL SUPABASE_PROJECT_REF';
const endpointValidationCommands = migrationCommands.filter(
  (command) => command.text === endpointValidationCommand,
);

if (endpointValidationCommands.length !== 1) {
  violations.push(`${migrationWorkflowPath}: project-bound SUPABASE_DB_URL validator must run exactly once`);
} else {
  const validation = endpointValidationCommands[0];
  const mask = migrationCommands.find(
    (command) => command.text === 'echo "::add-mask::$SUPABASE_DB_URL"',
  );
  const exportToEnvironment = migrationCommands.find(
    (command) => command.text === 'echo "DATABASE_URL=$SUPABASE_DB_URL" >> "$GITHUB_ENV"',
  );
  if (
    !mask
    || mask.blockStartLine !== validation.blockStartLine
    || mask.lineNumber >= validation.lineNumber
  ) {
    violations.push(`${migrationWorkflowPath}: migration secret must be masked before endpoint validation`);
  }
  if (
    !exportToEnvironment
    || exportToEnvironment.blockStartLine !== validation.blockStartLine
    || exportToEnvironment.lineNumber <= validation.lineNumber
  ) {
    violations.push(`${migrationWorkflowPath}: SUPABASE_DB_URL must be validated before DATABASE_URL export`);
  }
  if (
    migrationCommands.some(
      (command) => /\bpsql\b/u.test(command.text) && command.lineNumber <= validation.lineNumber,
    )
  ) {
    violations.push(`${migrationWorkflowPath}: SUPABASE_DB_URL must be validated before every psql command`);
  }
}

if (!/^\s+SUPABASE_PROJECT_REF:\s*\$\{\{\s*vars\.SUPABASE_PROJECT_REF\s*\}\}\s*$/mu.test(
  migrationWorkflowSource,
)) {
  violations.push(`${migrationWorkflowPath}: SUPABASE_PROJECT_REF must come from the selected GitHub Environment`);
}

const controlledMigrationNames = [
  '0071_account_erasure_workflow.sql',
  '0072_account_erasure_index_gate.sql',
];
for (const filename of controlledMigrationNames) {
  if (!migrationWorkflowSource.includes(`"${filename}"`)) {
    violations.push(`${migrationWorkflowPath}: ${filename} must be refused by the generic runner`);
  }
}
const controlledGate = migrationCommands.find(
  (command) => command.text.includes('ACCOUNT_ERASURE_MANUAL_RUNBOOK_ONLY'),
);
const genericMigrationLoop = migrationCommands.find(
  (command) => command.text === 'while IFS= read -r file; do',
);
if (
  !controlledGate
  || !genericMigrationLoop
  || controlledGate.lineNumber >= genericMigrationLoop.lineNumber
  || !migrationCommands.some(
    (command) => command.blockStartLine === controlledGate.blockStartLine
      && command.lineNumber > controlledGate.lineNumber
      && command.lineNumber < genericMigrationLoop.lineNumber
      && command.text === 'exit 1',
  )
) {
  violations.push(`${migrationWorkflowPath}: controlled account-erasure migrations must fail before the generic loop`);
}

if (violations.length > 0) {
  console.error('Off-Azure runtime contract failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Off-Azure runtime contract satisfied.');
