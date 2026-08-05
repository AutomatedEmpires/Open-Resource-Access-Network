import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standaloneRoot = resolve(repositoryRoot, '.next', 'standalone');
const serverPath = resolve(standaloneRoot, 'server.js');
const staticSource = resolve(repositoryRoot, '.next', 'static');

if (!existsSync(serverPath) || !existsSync(staticSource)) {
  throw new Error('Missing standalone production build. Run the build command before starting ORAN.');
}

const publicSource = resolve(repositoryRoot, 'public');
if (existsSync(publicSource)) {
  cpSync(publicSource, resolve(standaloneRoot, 'public'), { recursive: true });
}

cpSync(staticSource, resolve(standaloneRoot, '.next', 'static'), { recursive: true });

const server = spawn(process.execPath, [serverPath], {
  cwd: standaloneRoot,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
