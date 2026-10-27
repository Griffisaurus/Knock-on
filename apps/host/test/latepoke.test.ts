// M5 desync fix (docs/dev/M5_NOTES_DESYNC.md): a poke that lands behind state hashes a client has already reported must
// not look like a desync. Two Node clients follow the game's sim worker hash path (bake ahead of the playhead, hash every
// 60 ticks, report 120 ticks behind the bake head, roll back for a late poke: net HashReporter) against a real host
// session, with a real Machine each. The 2026-10-25 playtest case: one client has baked 4 s ahead when the poke
// arrives, the other (slow start, busy CPU) has not, so their first reports of the same ticks straddle the poke.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { makeId, metresToPos, snappedEuler, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { HashReporter, PROTO, comparable, decodeServer, encode, type ClientMsg, type ServerMsg, type ServerMsgs, type ServerType } from '@knockon/net';
import { Machine, type Poke } from '@knockon/sim';
import { DEFAULTS } from '../src/config.ts';
import { startHost, type RunningHost } from '../src/server.ts';

class Client {
  readonly ws: WebSocket;
  readonly got: ServerMsg[] = [];
  private waiters: { type: ServerType; resolve: (m: ServerMsg) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    this.ws.on('message', (data: Buffer) => {
      const msg = decodeServer(new Uint8Array(data));
      const i = this.waiters.findIndex((w) => w.type === msg[0]);
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(msg); else this.got.push(msg);
    });
  }
  async hello(): Promise<void> {
    await new Promise<void>((res) => this.ws.once('open', () => res()));
    this.send(['hello', { proto: PROTO, build: 'test', tier: 16 }]);
    await this.next('welcome');
    await this.next('snapshot');
  }
  send(m: ClientMsg): void { this.ws.send(encode(m)); }
  next<T extends ServerType>(type: T, timeoutMs = 3000): Promise<ServerMsgs[T]> {
    const i = this.got.findIndex((m) => m[0] === type);
    if (i >= 0) return Promise.resolve(this.got.splice(i, 1)[0]![1] as ServerMsgs[T]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
      this.waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m[1] as ServerMsgs[T]); } });
    });
  }
  /** Every message of `type` that has arrived (after letting the socket drain). */
  async all<T extends ServerType>(type: T): Promise<ServerMsgs[T][]> {
    await new Promise((r) => setTimeout(r, 250));
    return this.got.filter((m) => m[0] === type).map((m) => m[1] as ServerMsgs[T]);
  }
  close(): void { this.ws.close(); }
}

/**
 * The game client's run path for hashes (apps/game/src/sim.worker.ts): bake, record a hash every 60 ticks, report it
 * once the bake head is 120 ticks past it, roll back and re-bake for a poke behind the bake head. `legacy` reproduces
 * the reporting before the fix (no `pk`, re-baked ticks never reported again).
 */
class BakingClient {
  readonly m: Machine;
  readonly hashes = new HashReporter(60, 120);
  constructor(readonly net: Client, readonly runId: string, J: JoltModule, parts: PartRecord[], readonly legacy = false) {
    this.m = new Machine(J, { parts, links: [] });
  }
  bakeTo(tick: number): void {
    while (this.m.tick < tick) {
      this.m.step();
      this.m.drainEvents();
      if (this.hashes.due(this.m.tick)) this.hashes.record(this.m.tick, this.m.hash());
    }
    for (const r of this.hashes.take(this.m.tick)) this.net.send(['hash', { runId: this.runId, tick: r.tick, h: r.h, ...(this.legacy ? {} : { pk: r.pk }) }]);
  }
  /** A poke from the host (the game: sim.worker.ts 'poke'). `tamper` changes it locally: a real divergence. */
  poke(p: ServerMsgs['poke'], tamper = false): void {
    const poke: Poke = { tick: p.tick, seq: p.seq, partId: p.partId, kind: p.kind, data: tamper ? p.data.map((x) => x * 2) : p.data };
    this.m.addPoke(poke);
    this.hashes.poke(poke.tick);
    if (poke.tick < this.m.tick) {
      const was = this.m.tick;
      const back = this.m.restore(poke.tick);
      expect(back).toBeGreaterThanOrEqual(0);
      const sent = this.hashes.sent;
      this.hashes.rewind(back);
      if (this.legacy) this.hashes.sent = sent;
      this.bakeTo(was);
    }
  }
  destroy(): void { this.m.destroy(); }
}

// the rollback world of packages/sim/test/machine.test.ts: a ball rolls into a row of topple tiles
function world(): { parts: PartRecord[]; ball: number } {
  let n = 0;
  const parts: PartRecord[] = [];
  const add = (type: string, x: number, y: number, z: number): number => {
    const id = makeId(1, ++n);
    parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: snappedEuler(0, 0, 0), flags: 0 });
    return id;
  };
  add('thud', 0, 0.5, 0);
  for (let i = 0; i < 10; i++) add('topple_tile', 0.3 + i * 0.1, 0.075, 0);
  return { parts, ball: add('boing', -0.5, 0.12, 0) };
}

let J: JoltModule;
let host: RunningHost | null = null;
let dir = '';
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await host?.stop().catch(() => undefined);
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

async function session(): Promise<{ a: Client; b: Client; runId: string }> {
  J ??= await loadJolt('single');
  dir = mkdtempSync(join(tmpdir(), 'knockon-latepoke-'));
  host = await startHost({ ...DEFAULTS, port: 0, staticDir: null, dataDir: dir, countdownMs: 50 }, { build: 'test', log: false });
  const a = new Client(host.url); await a.hello();
  const b = new Client(host.url); await b.hello();
  clients.push(a, b);
  b.send(['run.request', {}]);
  const { runId } = await a.next('run.start');
  await b.next('run.start');
  return { a, b, runId };
}

/**
 * Player 2 starts slowly and pokes early; player 1 has baked 4 s ahead and reported hashes up to tick 360 without the
 * poke. Returns the desyncs the host flagged.
 */
async function latePoke(opts: { legacy?: boolean; tamper?: boolean } = {}): Promise<{ desyncs: number[] }> {
  const { a, b, runId } = await session();
  const { parts, ball } = world();
  const p1 = new BakingClient(a, runId, J, parts, opts.legacy), p2 = new BakingClient(b, runId, J, parts, opts.legacy);
  try {
    p1.bakeTo(480); // reports ticks 60..360
    p2.bakeTo(150); // reports none yet (its playhead, held at its bake head, is near 28)
    b.send(['poke', { runId, tick: 40, partId: ball, kind: 'impulse', data: [3, 0.5, 0] }]);
    const pa = await a.next('poke'), pb = await b.next('poke');
    p1.poke(pa); // rolls back to tick 0..40 and re-bakes to 480
    p2.poke(pb, opts.tamper); // rolls back too (150 > 40)
    p1.bakeTo(960);
    p2.bakeTo(960);
    const desyncs = (await a.all('desync')).map((d) => d.tick);
    expect(await b.all('desync')).toHaveLength(desyncs.length);
    return { desyncs };
  } finally {
    p1.destroy(); p2.destroy();
  }
}

describe('late pokes and desync detection (M5 desync fix)', () => {
  it('reports made before a poke reached the client are stale, not a desync', async () => {
    expect((await latePoke()).desyncs).toEqual([]);
  }, 60_000);

  it('reproduces the playtest without the fix: every hash tick between the poke and the fast client\'s report horizon', async () => {
    expect((await latePoke({ legacy: true })).desyncs).toEqual([60, 120, 180, 240, 300, 360]);
  }, 60_000);

  it('still flags a real divergence after the rollback, at the first hash after the poke', async () => {
    const { desyncs } = await latePoke({ tamper: true });
    expect(desyncs[0]).toBe(60);
    expect(desyncs.length).toBeGreaterThan(5); // every tick after it: nobody adopts a checkpoint in this test
  }, 60_000);

  it('host: holds a tick until both reports saw the same pokes, then compares', async () => {
    const { a, b, runId } = await session();
    a.send(['hash', { runId, tick: 60, h: 'stale', pk: 0 }]);
    b.send(['hash', { runId, tick: 60, h: 'fresh', pk: 1 }]);
    expect(await a.all('desync')).toEqual([]);
    a.send(['hash', { runId, tick: 60, h: 'fresh', pk: 1 }]); // re-baked after the rollback
    a.send(['hash', { runId, tick: 120, h: 'x', pk: 1 }]);
    b.send(['hash', { runId, tick: 120, h: 'y', pk: 1 }]);
    expect(await a.all('desync')).toEqual([{ runId, tick: 120 }]);
    // reports without pk (older clients, the soak harness) compare as before
    a.send(['hash', { runId, tick: 180, h: 'x' }]);
    b.send(['hash', { runId, tick: 180, h: 'y', pk: 3 }]);
    expect((await b.all('desync')).map((d) => d.tick)).toEqual([120, 180]);
  });

  it('host: a partner that has not baked yet holds the others at 0 (bakedMin is broadcast at once)', async () => {
    const { a, b, runId } = await session();
    a.send(['baked', { runId, tick: 300 }]); // b's worker is still loading: the min stays 0, but clients must hear it
    expect(await a.next('bakedMin')).toEqual({ runId, tick: 0 });
    b.send(['baked', { runId, tick: 120 }]);
    expect(await a.next('bakedMin')).toEqual({ runId, tick: 120 });
  });
});

describe('HashReporter', () => {
  it('counts the pokes each hash saw and re-reports re-baked ticks after a rewind', () => {
    const r = new HashReporter(60, 120);
    for (let t = 60; t <= 480; t += 60) r.record(t, `h${t}`);
    expect(r.take(480).map((x) => [x.tick, x.pk])).toEqual([[60, 0], [120, 0], [180, 0], [240, 0], [300, 0], [360, 0]]);
    r.poke(100); // applied in the step 100 → 101: hashes from tick 120 on depend on it
    expect([r.pokesBefore(100), r.pokesBefore(101)]).toEqual([0, 1]);
    r.rewind(90);
    for (let t = 120; t <= 480; t += 60) r.record(t, `h${t}'`);
    expect(r.take(480).map((x) => [x.tick, x.pk])).toEqual([[120, 1], [180, 1], [240, 1], [300, 1], [360, 1]]);
    expect(r.take(600).map((x) => x.tick)).toEqual([420, 480]);
  });

  it('comparable: same pokes, or a report that does not say', () => {
    expect(comparable([1, 1])).toBe(true);
    expect(comparable([0, 1])).toBe(false);
    expect(comparable([undefined, 1])).toBe(true);
  });
});
