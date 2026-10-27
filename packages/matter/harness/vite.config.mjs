// MX's private harness server (M4_PLAN rule 10: port 5201 only). No imports, so it runs with apps/game's vite:
//   apps/game/node_modules/.bin/vite --config packages/matter/harness/vite.config.mjs
// Pages: /?mode=proof (CPU = GPU), /?mode=perf&n=1000000, /?mode=sandstorm&ticks=600 (vendor matrix).
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export default {
  root,
  server: { port: 5201, strictPort: true, hmr: false, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  clearScreen: false,
  logLevel: 'warn',
};
