import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { startHost } from './server.ts';

// Resolve host.config.json, ./data and ./apps/game/dist from the repo root, wherever we're started.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cfg = loadConfig(repoRoot);
const host = await startHost(cfg, { log: false });
const worlds = host.session.worlds().length;

console.log(`KNOCK-ON Host Server  build ${host.session.build}
  listening   ${host.url}   (local only)
  data        ${cfg.dataDir}   (${worlds} world${worlds === 1 ? '' : 's'})
  identity    player nicknames`);

const shutdown = async (): Promise<void> => {
  console.log('\nSaving and shutting down…');
  await host.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
