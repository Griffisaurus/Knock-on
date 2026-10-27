// M2 stream D: organisation and module ops through the Host Server (namespace checks, counters, journal).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeWorld, encodeModule, makeId, makeSmallId, moduleFromSelection, moduleIdCount, opToWire, type Op, type PartRecord } from '@knockon/format';
import { PROTO, decodeServer, encode, type ClientMsg, type ServerMsg, type ServerMsgs, type ServerType } from '@knockon/net';
import { DEFAULTS } from '../src/config.ts';
import { startHost, type RunningHost } from '../src/server.ts';

class Client {
  readonly ws: WebSocket;
  private readonly queue: ServerMsg[] = [];
  private waiters: { types: ServerType[]; resolve: (m: ServerMsg) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    this.ws.on('message', (data: Buffer) => {
      const msg = decodeServer(new Uint8Array(data));
      const i = this.waiters.findIndex((w) => w.types.includes(msg[0]));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(msg); else this.queue.push(msg);
    });
  }
  send(m: ClientMsg): void { this.ws.send(encode(m)); }
  next<T extends ServerType>(...types: T[]): Promise<ServerMsgs[T]> {
    const i = this.queue.findIndex((m) => (types as ServerType[]).includes(m[0]));
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]![1] as ServerMsgs[T]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${types.join('/')}`)), 2000);
      this.waiters.push({ types, resolve: (m) => { clearTimeout(t); resolve(m[1] as ServerMsgs[T]); } });
    });
  }
  async join(): Promise<ServerMsgs['snapshot']> {
    await new Promise<void>((res) => this.ws.once('open', () => res()));
    this.send(['hello', { proto: PROTO, build: 'test', tier: 16 }]);
    await this.next('welcome');
    return this.next('snapshot');
  }
  private n = 0;
  async op(op: Op): Promise<ServerMsgs['op.ack'] | ServerMsgs['op.reject']> {
    const clientOpId = `c:${++this.n}`;
    this.send(['op', { clientOpId, baseSeq: 0, op: opToWire(op) }]);
    return this.next('op.ack', 'op.reject');
  }
  close(): void { this.ws.close(); }
}

const dirs: string[] = [];
let hosts: RunningHost[] = [];
async function boot(dir: string): Promise<RunningHost> {
  const h = await startHost({ ...DEFAULTS, port: 0, staticDir: null, dataDir: dir }, { build: 'test', log: false });
  hosts.push(h);
  return h;
}
afterEach(async () => {
  for (const h of hosts) await h.stop().catch(() => undefined);
  hosts = [];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const thud = (slot: number, n: number, x = 0): PartRecord => ({ id: makeId(slot, n), type: 'thud', pos: [x, 70, 0], rot: { tag: 0 }, flags: 0 });

describe('host: modules and organisation', () => {
  it('relays module ops, enforces the id namespace, bumps counters and persists across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knockon-mod-'));
    dirs.push(dir);
    const h1 = await boot(dir);
    const a = new Client(h1.url);
    await a.join();
    const b = new Client(h1.url);
    await b.join();

    const parts = new Map([[makeId(1, 1), thud(1, 1)], [makeId(1, 2), thud(1, 2, 640)]]);
    const def = moduleFromSelection(parts, new Map(), parts.keys(), { name: 'Pair', origin: [0, 0, 0] });
    const blob = encodeModule(def);
    const M = makeSmallId(1, 1);
    expect(await a.op({ k: 'ModuleSave', id: M, name: 'Pair', blob })).toHaveProperty('seq');
    expect(await b.next('op')).toMatchObject({ by: 1 });
    expect(await a.op({ k: 'LayerSet', id: makeSmallId(1, 2), name: 'Booms', flags: 1 })).toHaveProperty('seq');

    // player 2 may not place into player 1's id space
    const count = moduleIdCount(def);
    const bad = await b.op({ k: 'ModulePlace', moduleId: M, transform: { pos: [0, 0, 0], quarter: 0 }, idBase: makeId(1, 50), count, layer: 0 });
    expect(bad).toEqual({ clientOpId: 'c:1', reason: 'ID_NAMESPACE' });
    const ok = await b.op({ k: 'ModulePlace', moduleId: M, transform: { pos: [640, 0, 0], quarter: 1 }, idBase: makeId(2, 1) - 1, count, layer: makeSmallId(1, 2) });
    expect(ok).toHaveProperty('seq');
    expect(await b.op({ k: 'GroupSet', id: makeSmallId(2, 1), name: 'Mine', parent: 0, members: [makeId(2, 1), makeId(2, 2)] })).toHaveProperty('seq');
    a.close(); b.close();
    await new Promise((r) => setTimeout(r, 50));
    await h1.stop();
    hosts = hosts.filter((x) => x !== h1);

    // restart: the journal (module blob included) replays into the same world
    const h2 = await boot(dir);
    const c = new Client(h2.url);
    const snap = await c.join();
    const w = decodeWorld(snap.world);
    expect(w.modules?.map((m) => [m.id, m.name, m.blob.length])).toEqual([[M, 'Pair', blob.length]]);
    expect(w.layers).toEqual([{ id: makeSmallId(1, 2), name: 'Booms', flags: 1 }]);
    expect(w.groups).toEqual([{ id: makeSmallId(2, 1), name: 'Mine', parent: 0 }]);
    expect(w.parts.map((p) => [p.id, p.layer, p.group])).toEqual([[makeId(2, 1), makeSmallId(1, 2), makeSmallId(2, 1)], [makeId(2, 2), makeSmallId(1, 2), makeSmallId(2, 1)]]);
    expect(w.counters['2']).toBe(2); // the placement's ids are reserved for slot 2
    c.close();
  });
});
