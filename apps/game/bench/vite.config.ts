// The perf harness's own Vite server (M3_PLAN rule 3: never the shared :8787 host or the shared dist/). Same config as
// the game, rooted at apps/game, on its own port, proxying /ws and /share to a local test server:
//
//   KNOCKON_PORT=8795 KNOCKON_DATA=<scratch>/host KNOCKON_STATIC=none node apps/host/src/main.ts
//   cd apps/game && npx vite --config bench/vite.config.ts      → http://localhost:5185/bench/
//
// KN_BENCH_PORT / KN_BENCH_HOST override the two ports.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, mergeConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import base from '../vite.config.ts';

const host = Number(process.env.KN_BENCH_HOST ?? 8795);
/** Where the harness drops results and frame grabs (POST /bench-out/<name>): KN_BENCH_OUT or <tmp>/knockon-bench. */
const outDir = process.env.KN_BENCH_OUT ?? join(tmpdir(), 'knockon-bench');

function benchOut(): Plugin {
  return {
    name: 'knockon-bench-out',
    configureServer(server) {
      server.middlewares.use('/bench-out/', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'out';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(outDir, { recursive: true });
          let body = Buffer.concat(chunks);
          const m = /^data:[^;]+;base64,/.exec(body.subarray(0, 64).toString());
          if (m) body = Buffer.from(body.subarray(m[0].length).toString(), 'base64');
          writeFileSync(join(outDir, name), body);
          res.end(join(outDir, name));
        });
      });
    },
  };
}

export default defineConfig((env: ConfigEnv) => {
  const b = (typeof base === 'function' ? (base as (e: ConfigEnv) => UserConfig)(env) : base) as UserConfig;
  return mergeConfig(b, {
    root: resolve(__dirname, '..'),
    plugins: [benchOut()],
    server: {
      port: Number(process.env.KN_BENCH_PORT ?? 5185),
      strictPort: true,
      // eight streams edit this checkout: no pushed reloads in the middle of a measurement (reload by hand)
      hmr: false,
      proxy: {
        '/ws': { target: `ws://127.0.0.1:${host}`, ws: true },
        '/share': { target: `http://127.0.0.1:${host}` },
      },
    },
  });
});
