// S3 share service (apps/host/src/share.ts) and the cached join snapshot (session.ts).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_WORLD, decodeWorld, encodeModule, encodeWorld, makeId, moduleFromSelection, type PartRecord } from '@knockon/format';
import { DEFAULTS } from '../src/config.ts';
import { startHost, type RunningHost } from '../src/server.ts';

const dirs: string[] = [];
const hosts: RunningHost[] = [];

async function boot(over: Partial<typeof DEFAULTS> = {}): Promise<RunningHost> {
  const dir = mkdtempSync(join(tmpdir(), 'knockon-share-'));
  dirs.push(dir);
  const h = await startHost({ ...DEFAULTS, port: 0, staticDir: null, dataDir: dir, ...over }, { build: 'test', log: false });
  hosts.push(h);
  return h;
}

afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop().catch(() => undefined);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const part = (n: number): PartRecord => ({ id: makeId(1, n), type: 'brik', pos: [n * 128, 32, 0], rot: { tag: 0 }, flags: 0 });
const world = (n: number, title = 'Shared') => ({ ...EMPTY_WORLD, title, parts: Array.from({ length: n }, (_, i) => part(i + 1)), counters: { 1: n } });

describe('share service', () => {
  it('stores a world by content id, serves it back byte for byte, and imports it as a new world', async () => {
    const h = await boot();
    const bytes = encodeWorld(world(50, 'Brick row'));
    const up = await fetch(`${h.url}/share`, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(200);
    const meta = await up.json() as { id: string; kind: string; parts: number; link: string };
    expect(meta).toMatchObject({ kind: 'world', parts: 50, link: `/#s=${meta.id}` });
    expect(meta.id).toMatch(/^[0-9a-f]{16}$/);
    // the same bytes give the same id
    const again = await (await fetch(`${h.url}/share`, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' } })).json() as { id: string };
    expect(again.id).toBe(meta.id);
    const got = new Uint8Array(await (await fetch(`${h.url}/share/${meta.id}`)).arrayBuffer());
    expect(got).toEqual(bytes);
    const imp = await (await fetch(`${h.url}/share/${meta.id}/import`, { method: 'POST' })).json() as { worldId: string; parts: number };
    expect(imp.parts).toBe(50);
    expect(h.session.worlds().some((w) => w.id === imp.worldId && w.title === 'Brick row')).toBe(true);
  });

  it('accepts modules (not importable as worlds) and rejects anything else', async () => {
    const h = await boot();
    const sel = new Map([part(1), part(2)].map((p) => [p.id, p] as const));
    const mod = encodeModule(moduleFromSelection(sel, new Map(), sel.keys(), { name: 'Pair', author: 'test', origin: [0, 0, 0] }));
    const up = await (await fetch(`${h.url}/share`, { method: 'POST', body: mod, headers: { 'content-type': 'application/octet-stream' } })).json() as { id: string; kind: string; parts: number };
    expect(up).toMatchObject({ kind: 'module', parts: 2 });
    expect((await fetch(`${h.url}/share/${up.id}/import`, { method: 'POST' })).status).toBe(400);
    const junk = await fetch(`${h.url}/share`, { method: 'POST', body: new Uint8Array([1, 2, 3, 4, 5]), headers: { 'content-type': 'application/octet-stream' } });
    expect(junk.status).toBe(400);
    expect((await fetch(`${h.url}/share/0123456789abcdef`)).status).toBe(404);
    expect((await fetch(`${h.url}/share/..%2F..%2Fmeta`)).status).toBe(404);
  });

  it('shares the current world, and another host fetches it by link (content checked against the id)', async () => {
    const a = await boot();
    const b = await boot();
    const cur = await (await fetch(`${a.url}/share/world`, { method: 'POST' })).json() as { id: string; kind: string };
    expect(cur.kind).toBe('world');
    const res = await fetch(`${b.url}/share/fetch`, { method: 'POST', body: JSON.stringify({ url: `${a.url}/share/${cur.id}` }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(cur.id);
    const bad = await fetch(`${b.url}/share/fetch`, { method: 'POST', body: JSON.stringify({ url: `${a.url}/healthz` }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
  });

  it('a join snapshot of an unchanged world is the stored file (no re-encode), and decodes to the same world', async () => {
    const h = await boot();
    const enc = h.session.encodedWorld();
    expect(h.session.encodedWorld()).toBe(enc); // cached
    expect(decodeWorld(enc).title).toBe('My first machine');
  });
});
