import { execSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Cross-origin isolation (WebGPU threads, SharedArrayBuffer) in dev, matching the Host Server.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function buildId(command: string): string {
  if (command === 'serve') return 'dev';
  let rev = 'nogit';
  try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo yet */ }
  return `${rev}-${Date.now().toString(36)}`;
}

/** The build's output dir (`--outDir` included; M5: a scratch build must not write into the served dist). */
let outDir = resolve(__dirname, 'dist');

/** Writes dist/build.json so the Host Server can refuse mismatched clients (MULTIPLAYER §8.4). */
function buildManifest(id: string): Plugin {
  return {
    name: 'knockon-build-manifest',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      writeFileSync(resolve(outDir, 'build.json'), JSON.stringify({ build: id }, null, 1));
    },
  };
}

/** Serves assets/build/<dir> at /<dir> in dev and copies it into dist/<dir> on build (parts; kit = decal atlas). */
function buildAssets(dir: 'parts' | 'kit' | 'env'): Plugin {
  const src = resolve(__dirname, '../../assets/build', dir);
  const types: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.png': 'image/png' };
  return {
    name: `knockon-${dir}-assets`,
    configureServer(server) {
      server.middlewares.use(`/${dir}`, (req, res, next) => {
        const file = resolve(src, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]!));
        if (!file.startsWith(src + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (existsSync(src)) cpSync(src, resolve(outDir, dir), { recursive: true, filter: (f) => !f.endsWith('.report.json') });
    },
  };
}

/**
 * 3D part icons (D77, M3 contract 5): /parts/<type>/<type>.thumb.webp. The pipeline's own render in
 * assets/build/parts/<type>/ wins; otherwise the rendered icon set in art/style-samples/icons/ is served
 * in dev and copied into dist/parts/<type>/ on build (never over a pipeline render).
 */
function partThumbs(): Plugin {
  const icons = resolve(__dirname, '../../art/style-samples/icons');
  const built = resolve(__dirname, '../../assets/build/parts');
  return {
    name: 'knockon-part-thumbs',
    configureServer(server) {
      server.middlewares.use('/parts', (req, res, next) => {
        const m = /^\/([a-z0-9_]+)\/\1\.thumb\.webp$/.exec(decodeURIComponent((req.url ?? '/').split('?')[0]!));
        if (!m || existsSync(resolve(built, m[1]!, `${m[1]}.thumb.webp`))) return next();
        const file = resolve(icons, `${m[1]}.thumb.webp`);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Cache-Control', 'max-age=300');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(icons)) return;
      for (const f of readdirSync(icons)) {
        const m = /^([a-z0-9_]+)\.thumb\.webp$/.exec(f);
        if (!m) continue;
        const out = resolve(outDir, 'parts', m[1]!, f);
        if (existsSync(out)) continue;
        mkdirSync(resolve(outDir, 'parts', m[1]!), { recursive: true });
        cpSync(resolve(icons, f), out);
      }
    },
  };
}

export default defineConfig(({ command }) => {
  const id = buildId(command);
  return {
    define: { __KN_BUILD__: JSON.stringify(id) },
    plugins: [buildManifest(id), buildAssets('parts'), partThumbs(), buildAssets('kit'), buildAssets('env')], // env: MEGA KITCHEN (contract 5); partThumbs: 3D part icons (U3)
    server: {
      port: 5173,
      headers: isolation,
      // /share: S3's share-link service on the Host Server (the session bar's Share button and link import, U3)
      proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true }, '/share': { target: 'http://127.0.0.1:8787' } },
    },
    preview: { headers: isolation },
    optimizeDeps: { exclude: ['jolt-physics'] },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'), check: resolve(__dirname, 'check.html'), spikeJolt: resolve(__dirname, 'spike-jolt.html'),
          spikeMatter: resolve(__dirname, 'spike-matter.html'), spikeGpu: resolve(__dirname, 'spike-gpu.html'),
        },
      },
    },
  };
});
