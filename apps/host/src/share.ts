// Share service (GAME_SPEC §17.2, DATA_FORMATS §7, MULTIPLAYER §9): a content-addressed blob store on the Host
// Server for worlds and modules too big for a URL fragment. A blob's id is a hash of its bytes, so sharing the
// same thing twice gives the same link, and a link can't be pointed at different content later.
// (Ids are the first 64 bits of a SHA-256 of the bytes, as 16 hex digits.)
//
//   POST /share                     body: a .knockon world or .knockmod module (validated, never partially loaded)
//                                   → { id, kind, title, parts, bytes, link }
//   POST /share/world               shares the session's current world (anyone in the session)
//   GET  /share/:id                 the blob (application/octet-stream), for the partner or another host
//   GET  /share/:id/meta            { id, kind, title, parts, bytes, created }
//   POST /share/:id/import          worlds: a new world in this host's list
//   POST /share/fetch {url}         another host's /share/:id, fetched server-side and stored here (host only)
//
// Blobs live in <data>/shares/<id>.knockon|.knockmod with a <id>.json sidecar. Uploads honour maxUploadMB.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeModule, decodeWorld, type WorldSnapshot } from '@knockon/format';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HostConfig } from './config.ts';
import type { WorldStore } from './storage.ts';

export interface ShareMeta {
  readonly id: string;
  readonly kind: 'world' | 'module';
  readonly title: string;
  readonly parts: number;
  readonly bytes: number;
  readonly created: number;
}

const ID = /^[0-9a-f]{16}$/;

/** Validates a blob as a world or module (the full decoder: counts, ranges, CRCs). Throws on anything else. */
export function inspectBlob(bytes: Uint8Array): { kind: 'world'; world: WorldSnapshot; title: string; parts: number } | { kind: 'module'; title: string; parts: number } {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'KNON') {
    const world = decodeWorld(bytes);
    return { kind: 'world', world, title: world.title, parts: world.parts.length };
  }
  if (magic === 'KNMD') {
    const mod = decodeModule(bytes);
    return { kind: 'module', title: mod.meta.name, parts: mod.parts.length };
  }
  throw new Error('not a .knockon world or .knockmod module');
}

/** Content id: the first 16 hex digits of the bytes' SHA-256. */
export function blobId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export class ShareStore {
  readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, 'shares');
    mkdirSync(this.root, { recursive: true });
  }

  private file(id: string, kind: ShareMeta['kind']): string { return join(this.root, `${id}.${kind === 'world' ? 'knockon' : 'knockmod'}`); }

  /** Stores validated bytes; returns the meta (the same id for the same bytes). */
  put(bytes: Uint8Array, now = Date.now()): ShareMeta {
    const info = inspectBlob(bytes);
    const id = blobId(bytes);
    const existing = this.meta(id);
    if (existing) return existing;
    const meta: ShareMeta = { id, kind: info.kind, title: info.title.slice(0, 120), parts: info.parts, bytes: bytes.length, created: now };
    writeFileSync(this.file(id, info.kind), bytes);
    writeFileSync(join(this.root, `${id}.json`), JSON.stringify(meta));
    return meta;
  }

  meta(id: string): ShareMeta | null {
    if (!ID.test(id)) return null;
    const p = join(this.root, `${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ShareMeta) : null;
  }

  get(id: string): { meta: ShareMeta; bytes: Uint8Array } | null {
    const meta = this.meta(id);
    if (!meta) return null;
    return { meta, bytes: new Uint8Array(readFileSync(this.file(id, meta.kind))) };
  }

  list(): ShareMeta[] {
    return readdirSync(this.root).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(this.root, f), 'utf8')) as ShareMeta)
      .sort((a, b) => b.created - a.created);
  }
}

export interface ShareDeps {
  readonly cfg: HostConfig;
  readonly worlds: WorldStore;
  /** The session's current world, encoded (POST /share/world). */
  readonly currentWorld: () => Uint8Array;
  /** Is this request from the host player? */
  readonly isHost: (req: FastifyRequest) => boolean;
}

/** Registers the /share routes on the host's Fastify app. */
export function registerShare(app: FastifyInstance, deps: ShareDeps): ShareStore {
  const store = new ShareStore(deps.cfg.dataDir);
  const limit = deps.cfg.maxUploadMB * 1024 * 1024;
  app.addContentTypeParser(['application/octet-stream', 'application/x-knockon', 'application/x-knockmod'], { parseAs: 'buffer', bodyLimit: limit }, (_req, body, done) => done(null, body));
  const link = (id: string): string => `/#s=${id}`;
  const bad = (reply: FastifyReply, code: number, message: string): FastifyReply => reply.code(code).send({ error: message });
  const save = (reply: FastifyReply, bytes: Uint8Array): FastifyReply => {
    try {
      const meta = store.put(bytes);
      return reply.send({ ...meta, link: link(meta.id) });
    } catch (err) {
      return bad(reply, 400, (err as Error).message);
    }
  };

  app.post('/share', async (req, reply) => {
    const body = req.body;
    if (!(body instanceof Uint8Array) || !body.length) return bad(reply, 400, 'send the .knockon / .knockmod bytes (application/octet-stream)');
    return save(reply, new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  });

  app.post('/share/world', async (_req, reply) => save(reply, deps.currentWorld()));

  app.get<{ Params: { id: string } }>('/share/:id', async (req, reply) => {
    const hit = store.get(req.params.id);
    if (!hit) return bad(reply, 404, 'no such share');
    return reply.type('application/octet-stream').header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Disposition', `attachment; filename="${hit.meta.id}.${hit.meta.kind === 'world' ? 'knockon' : 'knockmod'}"`).send(Buffer.from(hit.bytes));
  });

  app.get<{ Params: { id: string } }>('/share/:id/meta', async (req, reply) => {
    const meta = store.meta(req.params.id);
    return meta ? reply.send(meta) : bad(reply, 404, 'no such share');
  });

  app.post<{ Params: { id: string } }>('/share/:id/import', async (req, reply) => {
    if (!deps.isHost(req)) return bad(reply, 403, 'only the host can import worlds');
    const hit = store.get(req.params.id);
    if (!hit) return bad(reply, 404, 'no such share');
    if (hit.meta.kind !== 'world') return bad(reply, 400, 'modules are placed from the Library, not imported as worlds');
    const world = decodeWorld(hit.bytes);
    const meta = deps.worlds.importWorld(world, world.title || 'Shared machine');
    return reply.send({ worldId: meta.id, title: meta.title, parts: meta.parts });
  });

  app.post<{ Body: { url?: unknown } }>('/share/fetch', async (req, reply) => {
    if (!deps.isHost(req)) return bad(reply, 403, 'only the host can fetch from another host');
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    let u: URL;
    try { u = new URL(url); } catch { return bad(reply, 400, 'bad url'); }
    // only another KNOCK-ON host's share blobs: http(s) and the /share/<id> shape (no arbitrary fetches)
    const m = /^\/share\/([0-9a-f]{16})$/.exec(u.pathname);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !m) return bad(reply, 400, 'expected https://<host>/share/<id>');
    const res = await fetch(u, { redirect: 'error' });
    if (!res.ok) return bad(reply, 502, `remote host answered ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > limit) return bad(reply, 413, 'too large');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > limit) return bad(reply, 413, 'too large');
    if (blobId(bytes) !== m[1]) return bad(reply, 502, 'remote blob does not match its id');
    return save(reply, bytes);
  });

  return store;
}
