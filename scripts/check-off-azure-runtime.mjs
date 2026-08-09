import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findProhibitedMicrosoftRuntimeSettings,
  isProhibitedMicrosoftEndpoint,
} from '../src/services/runtime/providerPolicyCore.js';
import {
  guardPrecedesEverySink,
  hasExecutableCall,
  parseWorkflowRunCommands,
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
const retiredDependencyPattern = /^(?:@azure\/|azure-maps-control$|applicationinsights$|@microsoft\/applicationinsights-)/iu;
for (const dependencyGroup of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const dependencyName of Object.keys(packageJson[dependencyGroup] ?? {})) {
    if (retiredDependencyPattern.test(dependencyName)) {
      violations.push(`package.json ${dependencyGroup}.${dependencyName}: retired provider dependency`);
    }
  }
}
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
  {
    path: 'src/services/geocoding/nominatim.ts',
    guardCall: guardProbeName,
    sinkPattern: /\bfetch\s*\(/u,
  },
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

if (!hasExecutableCall(
  read('src/instrumentation.ts'),
  'assertNoRetiredMicrosoftProviderSettings',
)) {
  violations.push('src/instrumentation.ts: retired Microsoft settings are not rejected at startup');
}

const retiredRuntimeAdapters = [
  'src/agents/ingestion/llm/providers/azureOpenai.ts',
  'src/services/admin/reviewAssist.ts',
  'src/services/chat/intentEnrich.ts',
  'src/services/chat/llm.ts',
  'src/services/feedback/triage.ts',
  'src/services/geocoding/azureMaps.ts',
  'src/services/i18n/translator.ts',
  'src/services/ingestion/docIntelligence.ts',
  'src/services/search/embeddings.ts',
  'src/services/tts/azureSpeech.ts',
];
for (const adapter of retiredRuntimeAdapters) {
  if (existsSync(resolve(root, adapter))) {
    violations.push(`${adapter}: retired provider adapter must be removed`);
  }
}

const productionSourceExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.yml',
  '.yaml',
]);
const retiredProviderModulePattern = /(?:from\s+['"][^'"]*(?:azure|foundry)[^'"]*['"]|import\s*\(\s*['"][^'"]*(?:azure|foundry)[^'"]*['"]\s*\)|require\s*\(\s*['"][^'"]*(?:azure|foundry)[^'"]*['"]\s*\))/iu;
const retiredProviderEnvPattern = /(?:process\s*\.\s*env\s*\.\s*(?:AZURE_|FOUNDRY_)|process\s*\.\s*env\s*\[\s*['"](?:AZURE_|FOUNDRY_)|(?:const|let|var)\s*\{[^}]*\b(?:AZURE_|FOUNDRY_))/u;
const retiredProviderWorkflowPattern = /(?:^|\s)uses\s*:\s*['"]?azure\//imu;
const retiredProviderWorkflowCliPattern = /(?:\baz\s+(?:account|ad|bicep|deployment|functionapp|group|identity|keyvault|login|monitor|role|storage|webapp)\b|\bazurerm\b|\bARM_(?:ACCESS_KEY|CLIENT_ID|CLIENT_SECRET|SUBSCRIPTION_ID|TENANT_ID)\b)/iu;

if (
  !retiredProviderModulePattern.test("const adapter = await import('./azureAdapter');")
  || !retiredProviderModulePattern.test("const adapter = require('./foundryAdapter');")
  || !retiredProviderEnvPattern.test("process.env['AZURE_OPENAI_KEY']")
  || !retiredProviderEnvPattern.test('const { FOUNDRY_ENDPOINT } = process.env;')
  || !retiredProviderWorkflowPattern.test('steps:\n  - uses: azure/login@v2')
  || !retiredProviderWorkflowCliPattern.test('run: az webapp deploy --name retired')
  || !isProhibitedMicrosoftEndpoint("const endpoint = 'https://retired.azurewebsites.net';")
) {
  violations.push('static policy engine: retired provider bypass probe failed');
}

function collectProductionSources(relativeDirectory) {
  if (!existsSync(resolve(root, relativeDirectory))) return [];
  const files = [];
  for (const entry of readdirSync(resolve(root, relativeDirectory), { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') files.push(...collectProductionSources(relativePath));
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    if (productionSourceExtensions.has(extension)) files.push(relativePath);
  }
  return files;
}

const retiredProviderScanExclusions = new Set([
  'src/services/runtime/providerPolicyCore.js',
  'scripts/check-off-azure-runtime.mjs',
]);

const productionSourcePaths = [
  ...collectProductionSources('src'),
  ...collectProductionSources('scripts'),
  ...collectProductionSources('.github/actions'),
  ...collectProductionSources('.github/workflows'),
];

for (const path of productionSourcePaths) {
  if (retiredProviderScanExclusions.has(path)) continue;
  const rawSource = read(path);
  const executableSource = stripJsCommentsAndStrings(rawSource);
  if (retiredProviderEnvPattern.test(rawSource) || /\b(?:AZURE_|FOUNDRY_)[A-Z0-9_]*\b/u.test(executableSource)) {
    violations.push(`${path}: executable retired provider environment access`);
  }
  if (retiredProviderModulePattern.test(rawSource)) {
    violations.push(`${path}: imports a retired provider module`);
  }
  if (isProhibitedMicrosoftEndpoint(rawSource)) {
    violations.push(`${path}: contains a hard-coded prohibited Microsoft endpoint`);
  }
  if (
    path.startsWith('.github/workflows/')
    && (retiredProviderWorkflowPattern.test(rawSource)
      || retiredProviderWorkflowCliPattern.test(rawSource)
      || /\b(?:AZURE_|FOUNDRY_)[A-Z0-9_]*\b/u.test(rawSource))
  ) {
    violations.push(`${path}: configures a retired provider workflow`);
  }
  if (/registerLLMClientProvider\(\s*['"]azure_openai['"]/u.test(rawSource)) {
    violations.push(`${path}: registers the retired Azure OpenAI provider`);
  }
}

if (existsSync(resolve(root, 'dist', 'host.json'))) {
  violations.push('dist/host.json: stale deployable Functions output must be removed');
}

for (const retiredPath of [
  'functions',
  'infra',
  'scripts/azure',
  'scripts/build-functions.mjs',
  '.github/agents/Azure_function_codegen_and_deployment.agent.md',
  '.github/agents/Azure_function_codegen_and_deployment.chatmode.md',
  'docs/foundry_integrations.md',
  'docs/platform/AZURE_DASHBOARD_MODERNIZATION.md',
  'docs/platform/DEPLOYMENT_AZURE.md',
  'docs/platform/INTEGRATION_CATALOG.md',
  'docs/platform/PLATFORM_AZURE.md',
]) {
  if (existsSync(resolve(root, retiredPath))) {
    violations.push(`${retiredPath}: retired Azure execution artifact must be removed`);
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
  if (existsSync(resolve(root, workflow))) {
    violations.push(`${workflow}: retired deployment workflow must be removed`);
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

if (
  !migrationWorkflowSource.includes('if [ "$GITHUB_REF" != "refs/heads/main" ]')
  || !migrationWorkflowSource.includes(
    'git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main',
  )
  || !migrationWorkflowSource.includes('if [ "$checkout_sha" != "$remote_main_sha" ]')
) {
  violations.push(`${migrationWorkflowPath}: production migrations must prove the exact remote main SHA`);
}

if (
  !migrationWorkflowSource.includes('SUPABASE_TARGET_SHA256')
  || migrationWorkflowSource.split('.databaseTarget == $database_target').length - 1 !== 2
) {
  violations.push(`${migrationWorkflowPath}: activation health must bind the deployed app to the selected Supabase target before and after SQL`);
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
