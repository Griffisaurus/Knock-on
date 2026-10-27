// `pnpm dev`: Host Server (API + /ws only) on 127.0.0.1:8787 and Vite (with COOP/COEP) on :5173.
// Open http://localhost:5173 in two tabs to try co-op locally.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const procs = [];

function run(name, cmd, args, opts) {
  const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    for (const q of procs) if (q !== p) q.kill();
    process.exit(code ?? 0);
  });
  procs.push(p);
}

run('host', 'node', ['--disable-warning=ExperimentalWarning', 'apps/host/src/main.ts'], {
  env: { ...process.env, KNOCKON_STATIC: 'none', KNOCKON_DATA: process.env.KNOCKON_DATA ?? './data-dev' },
});
run('vite', 'pnpm', ['--filter', '@knockon/game', 'dev']);

process.on('SIGINT', () => { for (const p of procs) p.kill(); });
