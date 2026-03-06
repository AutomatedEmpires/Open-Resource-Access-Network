/**
 * Build script for Azure Functions.
 *
 * Uses esbuild to bundle each function's index.ts into dist/functions/<name>/index.js,
 * resolving @/ path aliases to src/. The output is a deployable package under dist/
 * with host.json, function dirs (containing function.json), and compiled JS.
 */
import { build } from 'esbuild';
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FUNCTIONS_DIR = join(ROOT, 'functions');
const DIST_DIR = join(ROOT, 'dist');

// Discover all function directories (each has an index.ts)
const functionDirs = readdirSync(FUNCTIONS_DIR).filter((name) => {
  const dir = join(FUNCTIONS_DIR, name);
  return statSync(dir).isDirectory() && existsSync(join(dir, 'index.ts'));
});

console.log(`Building ${functionDirs.length} functions: ${functionDirs.join(', ')}`);

// Bundle each function
await build({
  entryPoints: functionDirs.map((name) => ({
    in: join(FUNCTIONS_DIR, name, 'index.ts'),
    out: join(name, 'index'),
  })),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: DIST_DIR,
  sourcemap: true,
  minify: false,
  // Resolve @/ path alias
  alias: {
    '@': join(ROOT, 'src'),
  },
  // Mark node built-ins and heavy native deps as external
  external: [
    'pg-native',
    'better-sqlite3',
    'mysql2',
    'tedious',
    'oracledb',
    // Node built-ins are automatically external with platform: 'node'
  ],
});

// Copy host.json to dist/
copyFileSync(join(FUNCTIONS_DIR, 'host.json'), join(DIST_DIR, 'host.json'));

// Copy function.json files to dist/<name>/ and fix scriptFile to relative
for (const name of functionDirs) {
  const srcJson = join(FUNCTIONS_DIR, name, 'function.json');
  if (existsSync(srcJson)) {
    const destDir = join(DIST_DIR, name);
    mkdirSync(destDir, { recursive: true });
    // Read, fix scriptFile path, and write
    const content = JSON.parse(readFileSync(srcJson, 'utf-8'));
    content.scriptFile = './index.js';
    writeFileSync(join(destDir, 'function.json'), JSON.stringify(content, null, 2) + '\n');
  }
}

console.log('Functions build complete. Output: dist/');
