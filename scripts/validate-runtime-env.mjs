import { readFileSync } from 'node:fs';
import { validateRuntimeEnv } from '../src/services/runtime/envContractCore.js';

function parseArgs(argv) {
  const parsed = {
    target: '',
    namesFile: '',
    format: 'plain',
    nodeEnv: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      parsed.target = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--names-file') {
      parsed.namesFile = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--format') {
      parsed.format = argv[index + 1] ?? 'plain';
      index += 1;
      continue;
    }
    if (arg === '--node-env') {
      parsed.nodeEnv = argv[index + 1] ?? '';
      index += 1;
    }
  }

  return parsed;
}

function readNamesFile(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function emit(format, level, message) {
  if (format === 'github') {
    const prefix = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'notice';
    console.log(`::${prefix}::${message}`);
    return;
  }

  const tag = level.toUpperCase();
  console.log(`[${tag}] ${message}`);
}

function printUsageAndExit() {
  console.error(
    [
      'Usage:',
      '  node scripts/validate-runtime-env.mjs --target <webapp|functions> [--names-file path] [--node-env production] [--format plain|github]',
    ].join('\n'),
  );
  process.exit(1);
}

const options = parseArgs(process.argv.slice(2));

if (!options.target) {
  printUsageAndExit();
}

const envSource = options.namesFile ? readNamesFile(options.namesFile) : process.env;
const result = validateRuntimeEnv(options.target, envSource, {
  nodeEnv: options.nodeEnv || undefined,
});

if (!result.ok) {
  emit(
    options.format,
    'error',
    `Missing critical ${result.target} settings: ${result.missingCritical.join(', ')}`,
  );
}

if (result.warnings.length > 0) {
  emit(
    options.format,
    'warning',
    `Missing optional ${result.target} settings: ${result.warnings.join(', ')}`,
  );
}

if (!result.ok) {
  process.exit(1);
}

emit(
  options.format,
  'notice',
  `Runtime env contract satisfied for ${result.target} (${result.nodeEnv}).`,
);
