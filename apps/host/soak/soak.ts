// M1 exit soak (PRODUCTION §2): two players, one host, a long session, zero desyncs.
//
// Starts a real Host Server and two headless clients that each run the deterministic Machine on the
// shared clock, exactly as the browser's sim worker does. Every message crosses a simulated relayed
// link (one-way 40–80 ms with jitter, order preserved). Both players poke parts at random during
// runs; the host compares state hashes; between runs the machine is edited. Prints a summary and
// exits non-zero on any desync or rejected poke.
//
//   node --disable-warning=ExperimentalWarning apps/host/soak/soak.ts --minutes 60
//
// Two-machine checks should run only in an isolated test environment. Use the same seed on both
// machines and a test URL provisioned specifically for that environment.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { DocStore, WorldDoc } from '@knockon/docstore';
import { decodeWorld, envSwitchPatch, makeId, metresToPos, opFromWire, opToWire, type LinkRecord, type Op, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { HashReporter, PROTO, decodeServer, encode, type ClientMsg, type ServerMsg } from '@knockon/net';
import { partDef } from '@knockon/parts-data';
import { Machine } from '@knockon/sim';
import { DEFAULTS } from '../src/config.ts';
import { startHost } from '../src/server.ts';

const args = process.argv.slice(2);
const arg = (name: string, d: number): number => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : d; };
const sarg = (name: string, d: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 ? String(args[i + 1]) : d; };
/** both: host + both players here (default) · a: host + player A here · b: player B joining `--url`. */
const PLAYER = sarg('player', 'both') as 'both' | 'a' | 'b';
const MINUTES = arg('minutes', 2);
const RUN_SECONDS = arg('run', 40);
const ONE_WAY = [arg('latency', 40), arg('latency-max', 80)] as const; // ms, relayed-link-like
const POKES_PER_SECOND = arg('pokes', 0.4);
// share of pokes sent too late on purpose (tick barely ahead): the partner must roll back
const LATE = arg('late', 0.3);
// M5 (orchestrator): soak another environment (`--env moon|hangar|…`: its gravity / air defaults come with it) and wind
const ENV = sarg('env', '');
const WIND = arg('wind', 0);
// M5 (orchestrator): who starts runs: 'a' (default), 'b', or 'alt' (alternating; U5's playtest saw desyncs on slot-2 starts)
const STARTER = sarg('starter', 'a') as 'a' | 'b' | 'alt';
// M5 desync fix: bake this many ticks ahead of the playhead, as the game's sim worker does (BAKE_AHEAD 480), so pokes land
// behind hashes already reported; `--ahead-b` gives player b a different lead (a slower partner). 0 = step on the clock.
const AHEAD = [arg('ahead', 0), arg('ahead-b', arg('ahead', 0))] as const;

// deterministic PRNG for the harness's own choices (not part of the sim)
let seed = arg('seed', 7) >>> 0;
const rand = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const stats = { errors: 0, runs: 0, ticks: [0, 0], hashes: [0, 0], pokes: 0, rollbacks: [0, 0], desyncs: 0, resyncs: 0, edits: 0 };

/**
 * A link with one-way latency and jitter that never reorders messages: a FIFO drained by one timer.
 * (One setTimeout per message reorders them: Node starts timers on a whole-millisecond clock, so two
 * messages sent in the same millisecond with sub-millisecond delays could fire in either order.)
 */
class Link {
  private readonly q: { at: number; fn: () => void }[] = [];
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  delay(fn: () => void): void {
    const at = Math.max(performance.now() + ONE_WAY[0] + rand() * (ONE_WAY[1] - ONE_WAY[0]), this.last);
    this.last = at;
    this.q.push({ at, fn });
    this.pump();
  }
  private pump(): void {
    if (this.timer || !this.q.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.q.length && this.q[0]!.at <= now + 0.5) this.q.shift()!.fn();
      this.pump();
    }, Math.max(0, this.q[0]!.at - performance.now()));
  }
}

class Client {
  readonly name: string;
  readonly idx: number;
  private ws!: WebSocket;
  private readonly up = new Link();
  private readonly down = new Link();
  slot = 0;
  isHost = false;
  store: DocStore | null = null;
  private seq = 0;
  private counter = 1000;
  private offset = 0;
  private readonly offsets: number[] = [];
  private J: JoltModule;
  m: Machine | null = null;
  runId: string | null = null;
  private startsAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** M5 desync fix: the game's hash bookkeeping (pokes seen per hash, re-reports after a rollback; net hashes.ts). */
  private readonly hashes = new HashReporter(60, 120);
  private pendingStarts: string | null = null;
  onRun: (type: string) => void = () => {};
  peers = 0;
  closed = false;

  constructor(name: string, idx: number, J: JoltModule) { this.name = name; this.idx = idx; this.J = J; }

  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    await new Promise<void>((res) => this.ws.once('open', () => res()));
    this.ws.on('close', () => { this.closed = true; });
    this.ws.on('message', (data: Buffer) => {
      const msg = decodeServer(new Uint8Array(data));
      this.down.delay(() => {
        try { this.onMsg(msg); } catch (err) { stats.errors++; console.error(`[${this.name}] harness error on ${msg[0]}:`, String(err)); }
      });
    });
    this.send(['hello', { proto: PROTO, build: 'soak', tier: 16, nickname: this.name }]);
    setInterval(() => this.send(['time', { t0: performance.now() }]), 1000).unref();
  }

  send(m: ClientMsg): void { this.up.delay(() => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(m)); }); }

  nextId(): number { return makeId(this.slot, ++this.counter); }

  submit(op: Op): void {
    const r = this.store!.applyLocal(op);
    if ('error' in r) return;
    this.send(['op', { clientOpId: r.clientOpId, baseSeq: this.store!.confirmedSeq, op: opToWire(op) }]);
  }

  private serverNow(): number { return performance.now() + this.offset; }

  private onMsg([type, p]: ServerMsg): void {
    switch (type) {
      case 'welcome': this.slot = p.you.slot; this.isHost = p.you.isHost; return;
      case 'peer': this.peers += p.event === 'join' ? 1 : p.event === 'leave' ? -1 : 0; return;
      case 'snapshot': {
        const w = decodeWorld(p.world);
        this.store = new DocStore(this.slot, WorldDoc.fromSnapshot(w), p.seq);
        this.peers = p.players.filter((q) => q.slot !== this.slot).length;
        return;
      }
      case 'op': this.store?.onRemote(p.seq, p.by, opFromWire(p.op)); return;
      case 'op.ack': this.store?.onAck(p.clientOpId, p.seq); return;
      case 'op.reject': console.error(`[${this.name}] op rejected ${p.clientOpId}: ${p.reason}`); this.store?.onReject(p.clientOpId, p.reason); return;
      case 'time': {
        const t1 = performance.now();
        this.offsets.push(p.serverTime - (p.t0 + t1) / 2);
        if (this.offsets.length > 8) this.offsets.shift();
        this.offset = [...this.offsets].sort((a, b) => a - b)[this.offsets.length >> 1]!;
        return;
      }
      case 'run.countdown': this.runId = p.runId; this.startsAt = p.startsAt; this.onRun('countdown'); return;
      case 'run.start': if (p.runId === this.runId) this.start(); return;
      case 'run.stop': case 'run.cancel': this.stop(); this.onRun('stop'); return;
      case 'poke': {
        if (!this.m || p.runId !== this.runId) return;
        this.m.addPoke({ tick: p.tick, seq: p.seq, partId: p.partId, kind: p.kind, data: p.data });
        this.hashes.poke(p.tick);
        if (p.tick < this.m.tick) {
          const was = this.m.tick;
          const back = this.m.restore(p.tick);
          if (back < 0) { stats.errors++; console.error(`[${this.name}] poke at ${p.tick} older than the rollback window (now ${was})`); return; }
          stats.rollbacks[this.idx]!++;
          this.hashes.rewind(back);
          while (this.m.tick < was) this.stepOnce();
        }
        return;
      }
      case 'desync':
        stats.desyncs++;
        console.error(`[${this.name}] DESYNC at tick ${p.tick}`);
        if (this.isHost && this.m) {
          const cp = this.m.exportCheckpoint(p.tick);
          if (cp) this.send(['checkpoint', { runId: this.runId!, tick: cp.tick, blob: cp.blob }]);
        }
        return;
      case 'checkpoint': {
        if (!this.m) return;
        const was = this.m.tick;
        const t = this.m.importCheckpoint(p.blob);
        this.hashes.rewind(t);
        while (this.m.tick < was) this.stepOnce();
        stats.resyncs++;
        return;
      }
      case 'error': console.error(`[${this.name}] error`, p); return;
      default:
    }
  }

  private start(): void {
    const doc = this.store!.confirmed();
    // M5 (orchestrator): the world's physics as the game's sim worker passes it (gravity, air, W5's zero-g zones and D26 wind)
    const env = doc.env as typeof doc.env & { zones?: boolean; wind?: unknown };
    this.m = new Machine(this.J, { parts: doc.parts, links: doc.links }, {
      preset: doc.env.preset, environment: doc.env.environment, gravityPercent: doc.env.gravity, airPercent: doc.env.air,
      ...(env.zones === false ? { zones: false } : {}), ...(env.wind ? { wind: env.wind as never } : {}),
    });
    this.hashes.reset();
    const startLocal = this.startsAt - this.offset;
    this.timer = setInterval(() => {
      if (!this.m) return;
      const playhead = Math.floor(((performance.now() - startLocal) * 120) / 1000);
      const target = playhead + AHEAD[this.idx]!;
      let n = 0;
      while (this.m.tick < target && n < 32) { this.stepOnce(); n++; }
      for (const r of this.hashes.take(this.m.tick)) { this.send(['hash', { runId: this.runId!, tick: r.tick, h: r.h, pk: r.pk }]); stats.hashes[this.idx]!++; }
      // Hand-of-God at random, scheduled ahead by the relayed input delay (MULTIPLAYER §7.3)
      if (rand() < (POKES_PER_SECOND * 8) / 1000) {
        const dyn = doc.parts.filter((q) => partDef(q.type)?.body.kind === 'dynamic');
        const q = dyn[Math.floor(rand() * dyn.length)];
        if (q) {
          const mass = partDef(q.type)!.body.mass;
          this.send(['poke', { runId: this.runId!, tick: Math.min(this.m.tick, playhead) + (rand() < LATE ? 2 : 36), partId: q.id, kind: 'impulse', data: [(rand() - 0.5) * mass * 4, rand() * mass * 3, (rand() - 0.5) * mass * 4] }]);
          stats.pokes++;
        }
      }
    }, 8);
  }

  private stepOnce(): void {
    this.m!.step();
    this.m!.drainEvents();
    stats.ticks[this.idx]!++;
    if (this.hashes.due(this.m!.tick)) this.hashes.record(this.m!.tick, this.m!.hash());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.m?.destroy();
    this.m = null;
  }
}

/** The machine both players run: every M1 channel (signal, fuse, power + gears, rope, wall). */
function seedMachine(c: Client): void {
  // M5: the environment (one EnvUpdate, as the settings panel does: W5's envSwitchPatch brings its physics defaults)
  if (ENV) {
    const cur = c.store!.confirmed().env;
    c.submit({ k: 'EnvUpdate', patch: { ...envSwitchPatch(cur, ENV), ...(ENV === 'hangar' ? { preset: 'warehouse' } : {}) } } as Op);
  }
  if (WIND > 0) c.submit({ k: 'EnvUpdate', patch: { wind: { speed: WIND, dir: 30 } } } as unknown as Op);
  const ids: Record<string, number> = {};
  const add = (name: string, type: string, x: number, y: number, z: number, props?: [number, number][]): void => {
    ids[name] = c.nextId();
    c.submit({ k: 'PartAdd', part: { id: ids[name]!, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: { tag: 0 }, flags: 0, ...(props ? { props } : {}) } });
  };
  const link = (kind: LinkRecord['kind'], a: string, ap: number, b: string, bp: number): void => {
    c.submit({ k: 'LinkAdd', link: { id: c.nextId(), kind, from: { part: ids[a]!, port: ap }, to: { part: ids[b]!, port: bp }, via: [], points: [], length: 0 } });
  };
  add('button', 'the_button', -1.5, 0, 0);
  add('ball', 'thud', -1.5, 0.6, 0);
  add('stickA', 'bangstick', 0, 0.039, 0);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) add(`b${r}${i}`, 'brik', 1.2 + (r % 2) * 0.1, 0.05 + r * 0.1, -0.2 + i * 0.1);
  add('wick', 'wick', -1.0, 0, 1.6);
  add('stickC', 'bangstick', 0.6, 0.039, 1.6, [[0, 10]]);
  for (let i = 0; i < 10; i++) add(`t${i}`, 'topple_tile', 1.6 + i * 0.1, 0.075, 1.6);
  add('mains', 'mains', -1.4, 0, -1.6);
  add('motor', 'motor', -0.8, 0, -1.6);
  add('cog1', 'cog', -0.3, 0.35, -1.6);
  add('cog2', 'cog', -0.1, 0.35, -1.6);
  add('cog3', 'cog', 0.15, 0.35, -1.6, [[0, 2]]);
  add('helio', 'helio', 1.0, 0.3, -1.4);
  add('anchor', 'anchor', 1.0, 0, -1.4);
  add('plank', 'plank', 2.5, 0.05, 0);
  add('wick2', 'wick', 2.5, 0, -0.55);
  link('cable_signal', 'button', 0, 'stickA', 0);
  link('fuse', 'wick', 0, 'stickC', 1);
  link('cable_power', 'mains', 0, 'motor', 0);
  link('band', 'motor', 1, 'cog1', 0);
  link('line', 'helio', 0, 'anchor', 0);
}

/** Between runs: nudge a random part, like a player tweaking the machine. */
function edit(c: Client): void {
  const parts = [...c.store!.doc.parts.values()].filter((p) => partDef(p.type)?.body.kind === 'dynamic');
  const p: PartRecord | undefined = parts[Math.floor(rand() * parts.length)];
  if (!p) return;
  c.submit({ k: 'PartUpdate', id: p.id, patch: { pos: [p.pos[0] + Math.round((rand() - 0.5) * 32), p.pos[1], p.pos[2] + Math.round((rand() - 0.5) * 32)] } });
  stats.edits++;
}

const report = (t0: number): void => {
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`[${mins} min] runs ${stats.runs} · ticks ${stats.ticks.join('/')} · hashes ${stats.hashes.join('/')} · pokes ${stats.pokes} · rollbacks ${stats.rollbacks.join('/')} · desyncs ${stats.desyncs} · resyncs ${stats.resyncs} · errors ${stats.errors}`);
};

function finish(): never {
  const ok = stats.desyncs === 0 && stats.errors === 0 && stats.runs > 0;
  console.log(`
SOAK ${ok ? 'PASS' : 'FAIL'}${PLAYER === 'both' ? '' : ` (player ${PLAYER})`}: ${JSON.stringify(stats)}`);
  process.exit(ok ? 0 : 1);
}

/** Player B on another machine: follows A's runs, pokes during them, edits after every other one. */
async function joiner(J: JoltModule): Promise<void> {
  const url = sarg('url', '');
  if (!url) throw new Error('--player b needs --url http://<host>:<port>');
  const b = new Client('Jo', 1, J);
  b.onRun = (type) => {
    if (type === 'countdown') stats.runs++;
    if (type === 'stop' && stats.runs % 2 === 0) setTimeout(() => edit(b), 900);
  };
  await b.connect(url);
  console.log(`soak (player b): joined ${url} · one-way latency ${ONE_WAY[0]}–${ONE_WAY[1]} ms added · ${POKES_PER_SECOND} pokes/s (${LATE * 100}% late)`);
  const t0 = Date.now(), end = t0 + MINUTES * 60_000;
  while (Date.now() < end && !b.closed) {
    await new Promise((r) => setTimeout(r, 30_000));
    report(t0);
  }
  b.stop();
  finish();
}

async function main(): Promise<void> {
  const J = await loadJolt('single');
  if (PLAYER === 'b') return joiner(J);
  const dir = mkdtempSync(join(tmpdir(), 'knockon-soak-'));
  const host = await startHost({ ...DEFAULTS, port: arg('port', 0), staticDir: null, dataDir: dir, countdownMs: 1000 }, { build: 'soak', log: false });
  const a = new Client('Sam', 0, J);
  const b = PLAYER === 'both' ? new Client('Jo', 1, J) : null;
  await a.connect(host.url);
  await new Promise((r) => setTimeout(r, 400));
  if (b) await b.connect(host.url);
  else {
    console.log(`soak (player a): listening locally on port ${new URL(host.url).port}; waiting for player b…`);
    while (a.peers < 1) await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1500));
  seedMachine(a);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`soak: ${MINUTES} min · runs of ${RUN_SECONDS} s · one-way latency ${ONE_WAY[0]}–${ONE_WAY[1]} ms added · ${POKES_PER_SECOND} pokes/s per player (${LATE * 100}% late)${AHEAD[0] || AHEAD[1] ? ` · baking ${AHEAD.join('/')} ticks ahead` : ''} · parts ${a.store!.doc.parts.size}, links ${a.store!.doc.links.size}`);
  const end = Date.now() + MINUTES * 60_000;
  const t0 = Date.now();
  while (Date.now() < end) {
    if (!b && a.peers < 1) { stats.errors++; console.error('player b left'); break; }
    stats.runs++;
    const starter = b && (STARTER === 'b' || (STARTER === 'alt' && stats.runs % 2 === 0)) ? b : a;
    starter.send(['run.request', {}]);
    await new Promise((r) => setTimeout(r, 1000 + RUN_SECONDS * 1000));
    starter.send(['run.stop', { runId: starter.runId ?? '' }]);
    await new Promise((r) => setTimeout(r, 800));
    if (b || stats.runs % 2) edit(stats.runs % 2 ? a : b!); // player b makes the even edits itself
    await new Promise((r) => setTimeout(r, 700));
    report(t0);
  }
  a.stop(); b?.stop();
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
  finish();
}

void main();
