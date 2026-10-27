// HTTP + WebSocket front door (MULTIPLAYER §3): static game files with the
// cross-origin-isolation headers WebGPU threads need, plus the /ws session endpoint.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES } from '@knockon/net';
import type { HostConfig } from './config.ts';
import { type Conn, Session } from './session.ts';
import { WorldStore } from './storage.ts';
import { registerShare } from './share.ts';

export const SECURITY_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * J4 (M4, for MI): the WebSocket frame cap. Desync repair sends a whole checkpoint client → host, and a Matter world's
 * checkpoint outgrows the protocol's 4 MB (~150k grains). The socket accepts
 * up to 64 MB (KNOCKON_WS_MAX_MB overrides; never below net's MAX_MESSAGE_BYTES). The protocol's own limit
 * (@knockon/net MAX_MESSAGE_BYTES, used by decodeClient and MAX_CHECKPOINT_BYTES) must be raised to match by net's owner.
 */
export const WS_MAX_PAYLOAD_MB = 64;
export const LOOPBACK_HOST = '127.0.0.1';
export function wsMaxPayload(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.KNOCKON_WS_MAX_MB ?? WS_MAX_PAYLOAD_MB);
  return Math.max(MAX_MESSAGE_BYTES, Math.floor((Number.isFinite(mb) && mb > 0 ? mb : WS_MAX_PAYLOAD_MB) * 1048576));
}

export interface RunningHost {
  readonly app: FastifyInstance;
  readonly session: Session;
  readonly url: string;
  stop(): Promise<void>;
}

/** The build id the client must match: dist/build.json written by the game build, or "dev". */
export function readBuild(cfg: HostConfig): string {
  if (!cfg.staticDir) return 'dev';
  const p = join(cfg.staticDir, 'build.json');
  if (!existsSync(p)) return 'dev';
  const b = JSON.parse(readFileSync(p, 'utf8')) as { build?: unknown };
  return typeof b.build === 'string' ? b.build : 'dev';
}

export async function startHost(cfg: HostConfig, opts: { build?: string; log?: boolean } = {}): Promise<RunningHost> {
  const store = new WorldStore(cfg.dataDir);
  const session = new Session(cfg, store, opts.build ?? (() => readBuild(cfg)));
  const build = (): string => session.build;
  const app = Fastify({ logger: opts.log === false ? false : { level: cfg.logLevel }, bodyLimit: cfg.maxUploadMB * 1024 * 1024 });

  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true, build: build(), players: session.worlds().length >= 0 }));

  // S3: share links for worlds and modules (share.ts): upload, download, import, fetch from another host
  registerShare(app, {
    cfg, worlds: store, currentWorld: () => session.encodedWorld(),
    isHost: () => true,
  });

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    await app.register(fastifyStatic, { root: cfg.staticDir, index: ['index.html'], cacheControl: false });
    app.get('/check', (_req, reply) => reply.sendFile('check.html'));
  } else {
    app.get('/', async (_req, reply) => reply.type('text/plain').send('KNOCK-ON Host Server is running (no game build found; run `pnpm build`).'));
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: wsMaxPayload() });
  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws));
  });

  function attach(ws: WebSocket): void {
    ws.binaryType = 'nodebuffer';
    const conn: Conn = {
      identity: { login: null, name: null },
      send: (b) => { if (ws.readyState === ws.OPEN) ws.send(b); },
      close: (code, reason) => ws.close(code, reason),
    };
    session.open(conn);
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 10_000);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      session.message(conn, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    ws.on('close', () => { clearInterval(heartbeat); session.close(conn); });
    ws.on('error', () => ws.terminate());
  }

  const housekeeping = setInterval(() => session.tick(), 1000);
  await app.listen({ host: LOOPBACK_HOST, port: cfg.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  return {
    app, session, url: `http://${LOOPBACK_HOST}:${port}`,
    async stop() {
      clearInterval(housekeeping);
      for (const c of wss.clients) c.terminate();
      wss.close();
      await app.close();
      session.shutdown();
    },
  };
}
