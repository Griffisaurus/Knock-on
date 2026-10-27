import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeWorld, makeId, opToWire, type Op } from '@knockon/format';
import { PROTO, decodeServer, encode, type ClientMsg, type ServerMsg, type ServerMsgs, type ServerType } from '@knockon/net';
import { DEFAULTS, type HostConfig } from '../src/config.ts';
import { startHost, type RunningHost } from '../src/server.ts';

class TestClient {
  readonly ws: WebSocket;
  private readonly queue: ServerMsg[] = [];
  private waiters: { type: ServerType; resolve: (m: ServerMsg) => void }[] = [];
  closed: Promise<number>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws', { headers });
    this.ws.on('message', (data: Buffer) => {
      const msg = decodeServer(new Uint8Array(data));
      const i = this.waiters.findIndex((w) => w.type === msg[0]);
      if (i >= 0) { const w = this.waiters.splice(i, 1)[0]!; w.resolve(msg); } else this.queue.push(msg);
    });
    this.closed = new Promise((res) => this.ws.on('close', (code) => res(code)));
  }

  open(): Promise<void> { return new Promise((res) => this.ws.once('open', () => res())); }
  send(m: ClientMsg): void { this.ws.send(encode(m)); }

  next<T extends ServerType>(type: T, timeoutMs = 2000): Promise<ServerMsgs[T]> {
    const i = this.queue.findIndex((m) => m[0] === type);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]![1] as ServerMsgs[T]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
      this.waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m[1] as ServerMsgs[T]); } });
    });
  }

  async hello(build = 'test', extra: Partial<{ nickname: string; tier: number; resumeToken: string }> = {}): Promise<ServerMsgs['welcome']> {
    await this.open();
    this.send(['hello', { proto: PROTO, build, tier: extra.tier ?? 16, ...extra }]);
    return this.next('welcome');
  }

  close(): void { this.ws.close(); }
}

let dirs: string[] = [];
let hosts: RunningHost[] = [];

async function boot(over: Partial<HostConfig> = {}, dataDir?: string): Promise<RunningHost> {
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), 'knockon-'));
  if (!dataDir) dirs.push(dir);
  const h = await startHost({ ...DEFAULTS, port: 0, staticDir: null, dataDir: dir, countdownMs: 150, ...over }, { build: 'test', log: false });
  hosts.push(h);
  return h;
}

afterEach(async () => {
  for (const h of hosts) await h.stop().catch(() => undefined);
  hosts = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const thud = (slot: number, n: number): Op => ({ k: 'PartAdd', part: { id: makeId(slot, n), type: 'thud', pos: [0, 70, 0], rot: { tag: 0 }, flags: 0 } });

describe('host session', () => {
  it('welcomes two players, relays ops in order, and enforces the cap', async () => {
    const h = await boot();
    const a = new TestClient(h.url);
    const wa = await a.hello('test', { nickname: 'Sam' });
    expect(wa.you).toMatchObject({ slot: 1, name: 'Sam', color: 'beam', isHost: true });
    const snap = await a.next('snapshot');
    expect(decodeWorld(snap.world).parts).toEqual([]);

    const b = new TestClient(h.url);
    const wb = await b.hello('test', { nickname: 'Jo' });
    expect(wb.you).toMatchObject({ slot: 2, name: 'Jo', color: 'plasma', isHost: false });
    await b.next('snapshot');
    expect((await a.next('peer')).event).toBe('join');

    a.send(['op', { clientOpId: '1:1', baseSeq: 0, op: opToWire(thud(1, 1)) }]);
    expect(await a.next('op.ack')).toEqual({ clientOpId: '1:1', seq: 1 });
    expect(await b.next('op')).toMatchObject({ seq: 1, by: 1 });

    // id namespace: player 2 may not create ids in slot 1's space
    b.send(['op', { clientOpId: '2:1', baseSeq: 1, op: opToWire(thud(1, 2)) }]);
    expect((await b.next('op.reject')).reason).toBe('ID_NAMESPACE');

    // locks: player 1 holds the part, player 2's move is rejected
    a.send(['lock', { ids: [makeId(1, 1)] }]);
    expect((await b.next('locks')).held).toEqual({ [String(makeId(1, 1))]: 1 });
    b.send(['op', { clientOpId: '2:2', baseSeq: 1, op: opToWire({ k: 'PartUpdate', id: makeId(1, 1), patch: { flags: 1 } }) }]);
    expect((await b.next('op.reject')).reason).toBe('LOCKED');

    // presence and chat relay
    b.send(['presence', { cam: [0, 1, 2, 0, 0, 0, 1], tool: 'place' }]);
    expect((await a.next('presence')).by).toBe(2);
    b.send(['chat', { text: 'boom incoming' }]);
    expect((await a.next('chat')).text).toBe('boom incoming');

    // third player is turned away
    const c = new TestClient(h.url);
    await c.open();
    c.send(['hello', { proto: PROTO, build: 'test', tier: 16 }]);
    expect((await c.next('error')).code).toBe('SESSION_FULL');
    expect(await c.closed).toBe(4000);
    a.close(); b.close();
  });

  it('rejects a mismatched build', async () => {
    const h = await boot();
    const a = new TestClient(h.url);
    await a.open();
    a.send(['hello', { proto: PROTO, build: 'stale', tier: 8 }]);
    expect((await a.next('error')).code).toBe('BUILD_MISMATCH');
  });

  it('runs a shared countdown, orders pokes, and flags desyncs', async () => {
    const h = await boot();
    const a = new TestClient(h.url); await a.hello(); await a.next('snapshot');
    const b = new TestClient(h.url); await b.hello(); await b.next('snapshot');
    a.send(['run.request', {}]);
    const cd = await b.next('run.countdown');
    const start = await a.next('run.start');
    expect(start.runId).toBe(cd.runId);
    await b.next('run.start');

    // editing is disabled during a run
    a.send(['op', { clientOpId: '1:1', baseSeq: 0, op: opToWire(thud(1, 1)) }]);
    expect((await a.next('op.reject')).reason).toBe('RUNNING');

    b.send(['poke', { runId: cd.runId, tick: 300, partId: 5, kind: 'impulse', data: [1, 2, 3] }]);
    expect((await a.next('poke')).seq).toBe(1);
    expect((await b.next('poke')).seq).toBe(1);

    a.send(['hash', { runId: cd.runId, tick: 60, h: 'aaaa' }]);
    b.send(['hash', { runId: cd.runId, tick: 60, h: 'aaaa' }]);
    a.send(['hash', { runId: cd.runId, tick: 120, h: 'aaaa' }]);
    b.send(['hash', { runId: cd.runId, tick: 120, h: 'bbbb' }]);
    expect(await a.next('desync')).toEqual({ runId: cd.runId, tick: 120 });

    b.send(['run.stop', { runId: cd.runId }]);
    expect((await a.next('run.stop')).by).toBe(2);
    a.close(); b.close();
  });

  it('persists the world across a restart (journal + compaction)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knockon-'));
    dirs.push(dir);
    const h1 = await boot({}, dir);
    const a = new TestClient(h1.url); await a.hello(); await a.next('snapshot');
    for (let i = 1; i <= 5; i++) {
      a.send(['op', { clientOpId: `1:${i}`, baseSeq: i - 1, op: opToWire(thud(1, i)) }]);
      await a.next('op.ack');
    }
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    await h1.stop();
    hosts = hosts.filter((x) => x !== h1);

    const h2 = await boot({}, dir);
    const b = new TestClient(h2.url); await b.hello();
    const snap = await b.next('snapshot');
    expect(snap.seq).toBe(5);
    expect(decodeWorld(snap.world).parts.map((p) => p.id)).toEqual([1, 2, 3, 4, 5].map((n) => makeId(1, n)));
    expect(decodeWorld(snap.world).counters['1']).toBe(5);
    b.close();
  });

  it('lets a dropped player resume their slot', async () => {
    const h = await boot();
    const a = new TestClient(h.url);
    const w = await a.hello();
    await a.next('snapshot');
    a.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 30));
    const a2 = new TestClient(h.url);
    const w2 = await a2.hello('test', { resumeToken: w.resumeToken });
    expect(w2.you.slot).toBe(1);
    a2.close();
  });

  it('rejects ops over the rate limit instead of dropping them (the sender rolls them back)', async () => {
    const h = await boot();
    const a = new TestClient(h.url);
    await a.hello();
    await a.next('snapshot');
    // 3× the 200 ops/s limit in one burst, so a loaded machine (the bucket refilling mid-burst) still trips it
    const N = 600;
    for (let n = 1; n <= N; n++) a.send(['op', { clientOpId: `1:${n}`, baseSeq: 0, op: opToWire(thud(1, n)) }]);
    await new Promise((r) => setTimeout(r, 500));
    const drain = async (type: 'op.ack' | 'op.reject'): Promise<number> => {
      let n = 0;
      for (;;) { try { await a.next(type, 1000); n++; } catch { return n; } }
    };
    const acks = await drain('op.ack'), rejects = await drain('op.reject');
    expect(acks + rejects).toBe(N);
    expect(rejects).toBeGreaterThan(0);
    a.close();
  }, 20_000);
});
