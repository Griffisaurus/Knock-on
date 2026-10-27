// The live session (MULTIPLAYER §4–9): players, ordering, locks, presence relay, runs, persistence.
// Transport-agnostic: the server feeds it bytes from WebSockets; tests feed it directly.

import { randomBytes } from 'node:crypto';
import { WorldDoc, tryApply, type Caps } from '@knockon/docstore';
import { encodeWorld, idSlot, opFromWire, opToWire, ID_SLOT_BASE, TIER_CAPS as FORMAT_TIER_CAPS, type Op, type PartId, type WorldSnapshot } from '@knockon/format';
import {
  PLAYER_COLORS, PROTO, ProtocolError, comparable, decodeClient, encode,
  type ClientMsgs, type ErrorCode, type PlayerInfo, type RunState, type ServerMsg, type ServerMsgs, type WorldInfo,
} from '@knockon/net';
import type { HostConfig } from './config.ts';
import type { WorldMeta, WorldStore } from './storage.ts';

// MI (M4): the header's counts.grains and requiredTier need the part types: the sim's Matter budget (matter/budget.ts).
// Loaded lazily so a host without the sim package still runs (its saves then keep the last known grain count).
void import('@knockon/sim').then((sim) => { WorldDoc.countGrains = sim.matterGrains; }).catch(() => { /* no sim package */ });


export interface Identity {
  readonly login: string | null;
  readonly name: string | null;
}

export interface Conn {
  send(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
  readonly identity: Identity;
}

interface Player {
  info: PlayerInfo;
  conn: Conn | null;
  resumeToken: string;
  disconnectedAt: number | null;
  rate: { window: number; ops: number; chat: number; presence: number };
  baked: number;
}

/** Placed-part caps by GPU tier (GAME_SPEC §15.2), from the format's one table (it has the 32 GB tier, D85: this copy
 * lacked it, so a session whose lowest tier was 32 fell back to the 4 GB cap; M5 close-out fix). */
export const TIER_CAPS: Record<number, number> = Object.fromEntries(FORMAT_TIER_CAPS.map((t) => [t.tier, t.parts]));
const RESUME_MS = 30_000;
const COMPACT_MS = 120_000;
const MAX_TEXT = 280;

export class Session {
  private readonly cfg: HostConfig;
  private readonly store: WorldStore;
  private readonly buildOf: () => string;
  private readonly now: () => number;

  private readonly players = new Map<1 | 2, Player>();
  private readonly conns = new Map<Conn, Player | null>();

  private meta!: WorldMeta;
  private base!: Omit<WorldSnapshot, 'parts' | 'links' | 'notes' | 'env'>;
  doc!: WorldDoc;
  seq = 0;
  private counters: Record<string, number> = {};
  private opsSinceCompact = 0;
  private lastCompact = 0;
  private readonly locks = new Map<PartId, { slot: 1 | 2; at: number }>();

  private run: (Omit<RunState, 'phase'> & { phase: RunState['phase']; timer: ReturnType<typeof setTimeout> | null; pokeSeq: number; sentBakedMin: number }) | null = null;
  /** Hash reports by tick, then slot: the hash and the pokes it was computed with (M5 desync fix, net hashes.ts). */
  private readonly hashes = new Map<number, Map<number, { h: string; pk: number | undefined }>>();
  /** MI (M4): Matter checksums by `${tick}:${slot}` (diagnostics for desync reports). */
  private readonly matterSums = new Map<string, string>();

  /** `build` may be a function: the host re-reads dist/build.json so a rebuild doesn't need a restart. */
  constructor(cfg: HostConfig, store: WorldStore, build: string | (() => string), now: () => number = Date.now) {
    this.cfg = cfg;
    this.store = store;
    this.buildOf = typeof build === 'function' ? build : () => build;
    this.now = now;
    const existing = store.list();
    this.openWorld(existing[0]?.id ?? store.create('My first machine').id);
  }

  get build(): string { return this.buildOf(); }

  // ---- world ---------------------------------------------------------------------------------
  private openWorld(id: string): void {
    const w = this.store.load(id);
    this.meta = w.meta;
    const { parts: _p, links: _l, notes: _n, env: _e, terrain: _t, ...base } = w.snapshot;
    this.base = base;
    this.doc = WorldDoc.fromSnapshot(w.snapshot);
    this.seq = w.meta.seq;
    this.counters = { ...w.snapshot.counters };
    for (const e of w.journal) {
      const r = tryApply(this.doc, e.op, { maxParts: Infinity });
      if (!r.ok) throw new Error(`journal replay failed at seq ${e.seq}: ${r.reason}`);
      this.seq = e.seq;
      this.bumpCounters(e.op);
    }
    this.locks.clear();
    this.opsSinceCompact = w.journal.length;
    this.lastCompact = this.now();
    // S3: with no journal to replay, the file is exactly the snapshot a join sends
    this.encoded = w.journal.length ? null : { seq: this.seq, bytes: w.bytes };
  }

  /** S3: the encoded world at `seq` (world.knockon or the last compaction), so joins skip re-encoding a big world. */
  private encoded: { seq: number; bytes: Uint8Array } | null = null;

  snapshot(): WorldSnapshot {
    return this.doc.toSnapshot({ ...this.base, counters: { ...this.counters } });
  }

  /** S3: the current world as `.knockon` bytes (share service). */
  encodedWorld(): Uint8Array { return this.snapshotBytes(); }

  /** S3: snapshot bytes for a join: cached while no op has landed (a 1M-part world encodes in ~1.1 s). */
  private snapshotBytes(): Uint8Array {
    if (this.encoded?.seq === this.seq) return this.encoded.bytes;
    const bytes = encodeWorld(this.snapshot());
    this.encoded = { seq: this.seq, bytes };
    return bytes;
  }

  compact(): void {
    // S3: nothing to fold in: don't rewrite (and re-encode) an unchanged world on every join and leave
    if (this.opsSinceCompact === 0 && this.meta.seq === this.seq && this.encoded?.seq === this.seq) { this.lastCompact = this.now(); return; }
    this.meta = { ...this.meta, seq: this.seq, title: this.base.title };
    const bytes = this.store.compact(this.meta, this.snapshot(), this.cfg.backups.keep);
    this.encoded = { seq: this.seq, bytes };
    this.opsSinceCompact = 0;
    this.lastCompact = this.now();
  }

  worlds(): WorldInfo[] {
    return this.store.list().map((m) => ({ id: m.id, title: m.title, preset: m.preset, parts: m.parts, modified: m.modified }));
  }

  // ---- connections ---------------------------------------------------------------------------
  open(conn: Conn): void {
    this.conns.set(conn, null);
  }

  close(conn: Conn): void {
    const p = this.conns.get(conn);
    this.conns.delete(conn);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.disconnectedAt = this.now();
    this.broadcast(['peer', { event: 'leave', player: p.info }], p);
    if (![...this.players.values()].some((x) => x.conn)) this.compact();
  }

  /** Housekeeping, called every second: journal fsync, lock expiry, resume expiry, compaction. */
  tick(): void {
    const t = this.now();
    this.store.flush();
    const released: number[] = [];
    for (const [id, l] of this.locks) {
      const owner = this.players.get(l.slot);
      if (t - l.at > this.cfg.lockIdleMs || !owner || (owner.conn === null && t - (owner.disconnectedAt ?? t) > this.cfg.lockIdleMs)) {
        this.locks.delete(id);
        released.push(id);
      }
    }
    if (released.length) this.broadcast(['locks', { held: {}, released }]);
    for (const [slot, p] of this.players) {
      if (p.conn === null && p.disconnectedAt !== null && t - p.disconnectedAt > RESUME_MS) this.players.delete(slot);
    }
    if (this.opsSinceCompact >= this.cfg.compactEveryOps || (this.opsSinceCompact > 0 && t - this.lastCompact > COMPACT_MS)) this.compact();
  }

  message(conn: Conn, bytes: Uint8Array): void {
    let msg;
    try {
      msg = decodeClient(bytes);
    } catch (err) {
      if (err instanceof ProtocolError) return this.fail(conn, 'BAD_MESSAGE', err.message, false);
      throw err;
    }
    const player = this.conns.get(conn) ?? null;
    if (msg[0] === 'hello') return this.hello(conn, msg[1]);
    if (!player) return this.fail(conn, 'BAD_MESSAGE', 'say hello first', true);
    if (!this.rateOk(player, msg[0])) {
      // a dropped op must be rejected, or the sender's optimistic doc waits for an ack forever
      if (msg[0] === 'op') return this.send(player, ['op.reject', { clientOpId: String(msg[1].clientOpId), reason: 'RATE_LIMIT' }]);
      return this.fail(conn, 'RATE_LIMIT', `slow down (${msg[0]})`, false);
    }
    try {
      this.dispatch(player, msg);
    } catch (err) {
      this.fail(conn, 'BAD_MESSAGE', (err as Error).message, false);
    }
  }

  private dispatch(p: Player, msg: ReturnType<typeof decodeClient>): void {
    switch (msg[0]) {
      case 'op': return this.onOp(p, msg[1]);
      case 'lock': return this.onLock(p, msg[1].ids);
      case 'unlock': return this.onUnlock(p, msg[1].ids);
      case 'presence': return this.broadcast(['presence', { ...msg[1], by: p.info.slot }], p);
      case 'ping': return this.broadcast(['ping', { ...msg[1], by: p.info.slot }], p);
      case 'chat': {
        const text = String(msg[1].text ?? '').slice(0, MAX_TEXT);
        if (text.trim()) this.broadcast(['chat', { text, by: p.info.slot, at: this.now() }]);
        return;
      }
      case 'time': return this.send(p, ['time', { t0: Number(msg[1].t0), serverTime: this.now() }]);
      case 'run.request': return this.onRunRequest(p);
      case 'run.cancel': return this.onRunCancel(p, msg[1].runId);
      case 'run.stop': return this.onRunStop(p, msg[1].runId);
      case 'play': {
        if (!this.run || msg[1].runId !== this.run.runId) return;
        return this.broadcast(['play', { ...msg[1], atServerTime: this.now(), by: p.info.slot }]);
      }
      case 'baked': return this.onBaked(p, msg[1]);
      case 'poke': return this.onPoke(p, msg[1]);
      case 'hash': return this.onHash(p, msg[1]);
      case 'checkpoint': return this.onCheckpoint(p, msg[1]);
      case 'save': {
        this.compact();
        return this.send(p, ['saved', { worldId: this.meta.id, at: this.now() }]);
      }
      case 'join': return this.onJoin(p, msg[1]);
      case 'hello': return;
    }
  }

  // ---- hello ---------------------------------------------------------------------------------
  private hello(conn: Conn, h: ClientMsgs['hello']): void {
    if (h.proto !== PROTO) return this.fail(conn, 'PROTO_MISMATCH', `protocol ${String(h.proto)} != ${PROTO}`, true);
    if (h.build !== this.build) return this.fail(conn, 'BUILD_MISMATCH', 'The host updated the game. Reload.', true);
    const login = conn.identity.login;
    const tier = [4, 8, 12, 16, 32].includes(Number(h.tier)) ? Number(h.tier) : 4;
    // resume a recently dropped player
    let player: Player | undefined;
    if (typeof h.resumeToken === 'string') {
      player = [...this.players.values()].find((p) => p.resumeToken === h.resumeToken && p.conn === null);
    }
    if (player) {
      player.conn = conn;
      player.disconnectedAt = null;
      player.info = { ...player.info, tier };
      this.conns.set(conn, player);
      this.welcome(player);
      this.broadcast(['peer', { event: 'reconnect', player: player.info }], player);
      return;
    }
    const slot = ([1, 2] as const).slice(0, this.cfg.maxPlayers).find((s) => !this.players.has(s));
    if (!slot) return this.fail(conn, 'SESSION_FULL', 'Two players are already in this session.', true);
    const nickname = typeof h.nickname === 'string' ? h.nickname.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 24) : '';
    const name = conn.identity.name || nickname || `Player ${slot}`;
    const isHost = ![...this.players.values()].some((p) => p.info.isHost);
    player = {
      info: { slot, name, login, color: PLAYER_COLORS[slot].name, isHost, tier },
      conn, resumeToken: randomBytes(16).toString('hex'), disconnectedAt: null,
      rate: { window: 0, ops: 0, chat: 0, presence: 0 }, baked: 0,
    };
    this.players.set(slot, player);
    this.conns.set(conn, player);
    this.welcome(player);
    this.broadcast(['peer', { event: 'join', player: player.info }], player);
  }

  private welcome(p: Player): void {
    this.send(p, ['welcome', { you: p.info, serverBuild: this.build, worlds: this.worlds(), resumeToken: p.resumeToken }]);
    this.sendSnapshot(p);
  }

  private sendSnapshot(p: Player): void {
    const locks: Record<string, number> = {};
    for (const [id, l] of this.locks) locks[String(id)] = l.slot;
    const run: RunState | null = this.run
      ? { runId: this.run.runId, worldSeq: this.run.worldSeq, phase: this.run.phase, startsAt: this.run.startsAt, pokes: this.run.pokes }
      : null;
    this.send(p, ['snapshot', {
      worldId: this.meta.id, seq: this.seq, world: this.snapshotBytes(),
      players: [...this.players.values()].map((x) => x.info), locks, run,
    }]);
  }

  // ---- ops -------------------------------------------------------------------------------------
  private caps(): Caps {
    const tiers = [...this.players.values()].map((p) => p.info.tier);
    const tier = tiers.length ? Math.min(...tiers) : 4;
    return { maxParts: TIER_CAPS[tier] ?? TIER_CAPS[4]! };
  }

  private onOp(p: Player, m: ClientMsgs['op']): void {
    const clientOpId = String(m.clientOpId ?? '').slice(0, 64);
    const reject = (reason: string): void => this.send(p, ['op.reject', { clientOpId, reason }]);
    if (this.run) return reject('RUNNING');
    let op: Op;
    try { op = opFromWire(m.op); } catch (err) { return reject(`BAD_OP: ${(err as Error).message}`); }
    for (const id of createdIds(op)) if (idSlot(id) !== p.info.slot) return reject('ID_NAMESPACE');
    for (const id of mutatedIds(op)) {
      const l = this.locks.get(id);
      if (l && l.slot !== p.info.slot) return reject('LOCKED');
    }
    const r = tryApply(this.doc, op, this.caps());
    if (!r.ok) return reject(r.reason);
    this.seq += 1;
    this.bumpCounters(op);
    for (const id of r.touched) {
      const l = this.locks.get(id);
      if (l) l.at = this.now();
    }
    const wire = opToWire(op);
    this.store.append(this.meta.id, this.seq, p.info.slot, wire);
    this.opsSinceCompact += 1;
    this.send(p, ['op.ack', { clientOpId, seq: this.seq }]);
    this.broadcast(['op', { seq: this.seq, by: p.info.slot, op: wire }], p);
  }

  private bumpCounters(op: Op): void {
    for (const id of createdIds(op)) {
      const slot = String(idSlot(id));
      const counter = id - idSlot(id) * ID_SLOT_BASE;
      if ((this.counters[slot] ?? 0) < counter) this.counters[slot] = counter;
    }
  }

  // ---- locks -----------------------------------------------------------------------------------
  private onLock(p: Player, ids: unknown): void {
    if (!Array.isArray(ids) || ids.length > 10_000) throw new Error('bad lock ids');
    const held: Record<string, number> = {};
    for (const raw of ids) {
      const id = Number(raw);
      if (!this.doc.parts.has(id) && !this.doc.links.has(id) && !this.doc.notes.has(id)) continue;
      const l = this.locks.get(id);
      if (l && l.slot !== p.info.slot) continue;
      this.locks.set(id, { slot: p.info.slot, at: this.now() });
      held[String(id)] = p.info.slot;
    }
    this.broadcast(['locks', { held, released: [] }]);
  }

  private onUnlock(p: Player, ids: unknown): void {
    if (!Array.isArray(ids)) throw new Error('bad unlock ids');
    const released: number[] = [];
    for (const raw of ids) {
      const id = Number(raw);
      if (this.locks.get(id)?.slot === p.info.slot) { this.locks.delete(id); released.push(id); }
    }
    if (released.length) this.broadcast(['locks', { held: {}, released }]);
  }

  // ---- runs ------------------------------------------------------------------------------------
  private onRunRequest(p: Player): void {
    if (this.run) return;
    const runId = randomBytes(6).toString('hex');
    const startsAt = this.now() + this.cfg.countdownMs;
    const timer = setTimeout(() => {
      if (!this.run || this.run.runId !== runId) return;
      this.run.phase = 'running';
      this.run.timer = null;
      this.broadcast(['run.start', { runId, worldSeq: this.seq }]);
    }, this.cfg.countdownMs);
    this.run = { runId, worldSeq: this.seq, phase: 'countdown', startsAt, pokes: [], timer, pokeSeq: 0, sentBakedMin: -1 };
    this.locks.clear();
    this.broadcast(['run.countdown', { runId, startsAt, by: p.info.slot }]);
  }

  private onRunCancel(p: Player, runId: string): void {
    if (!this.run || this.run.runId !== runId || this.run.phase !== 'countdown') return;
    if (this.run.timer) clearTimeout(this.run.timer);
    this.run = null;
    this.broadcast(['run.cancel', { runId, by: p.info.slot }]);
  }

  private onRunStop(p: Player, runId: string): void {
    if (!this.run || this.run.runId !== runId) return;
    if (this.run.timer) clearTimeout(this.run.timer);
    this.run = null;
    this.hashes.clear();
    this.matterSums.clear(); // MI (M4)
    for (const x of this.players.values()) x.baked = 0;
    this.broadcast(['run.stop', { runId, by: p.info.slot }]);
  }

  private onBaked(p: Player, m: ClientMsgs['baked']): void {
    if (!this.run || m.runId !== this.run.runId) return;
    p.baked = Math.max(p.baked, Number(m.tick) | 0);
    // M5: compare with what was last broadcast, not the previous min, so a partner whose worker hasn't reported yet
    // still holds the others at 0 (clients start unconstrained until the first bakedMin arrives)
    const after = this.bakedMin();
    if (after !== this.run.sentBakedMin) {
      this.run.sentBakedMin = after;
      this.broadcast(['bakedMin', { runId: m.runId, tick: after }]);
    }
  }

  private bakedMin(): number {
    const active = [...this.players.values()].filter((x) => x.conn);
    return active.length ? Math.min(...active.map((x) => x.baked)) : 0;
  }

  private onPoke(p: Player, m: ClientMsgs['poke']): void {
    if (!this.run || this.run.phase !== 'running' || m.runId !== this.run.runId) return;
    if (!Number.isInteger(m.tick) || m.tick < 0 || !Array.isArray(m.data) || m.data.length > 16) throw new Error('bad poke');
    this.run.pokeSeq += 1;
    const poke: ServerMsgs['poke'] = { ...m, seq: this.run.pokeSeq, by: p.info.slot };
    this.run.pokes.push(poke);
    this.broadcast(['poke', poke]); // everyone, sender included: the server order is the order
  }

  private onHash(p: Player, m: ClientMsgs['hash']): void {
    if (!this.run || m.runId !== this.run.runId) return;
    const tick = Number(m.tick) | 0;
    let byTick = this.hashes.get(tick);
    if (!byTick) { byTick = new Map(); this.hashes.set(tick, byTick); }
    byTick.set(p.info.slot, { h: String(m.h), pk: Number.isInteger(m.pk) ? m.pk : undefined });
    if (typeof m.mc === 'string') this.matterSums.set(`${tick}:${p.info.slot}`, m.mc.slice(0, 32)); // MI (M4)
    const active = [...this.players.values()].filter((x) => x.conn);
    // M5 desync fix: reports made with different pokes aren't comparable (the client that hadn't seen a poke yet sends
    // its re-baked hash after rolling back for it): the tick waits until they match
    const reports = [...byTick.values()];
    if (byTick.size >= active.length && active.length > 1 && comparable(reports.map((r) => r.pk))) {
      if (new Set(reports.map((r) => r.h)).size > 1) {
        // MI (M4): say whether the Matter layer diverged too (its checksum travels beside the hash)
        const mcs = active.map((x) => this.matterSums.get(`${tick}:${x.info.slot}`) ?? '');
        if (mcs.some((x) => x)) console.warn(`desync at tick ${tick}: Matter checksums ${new Set(mcs).size > 1 ? 'differ' : 'agree'} (${mcs.join(' / ')})`);
        this.broadcast(['desync', { runId: m.runId, tick }]);
      }
      for (const x of active) this.matterSums.delete(`${tick}:${x.info.slot}`);
      this.hashes.delete(tick);
    }
    if (this.hashes.size > 64) this.hashes.delete(Math.min(...this.hashes.keys()));
  }

  private onCheckpoint(p: Player, m: ClientMsgs['checkpoint']): void {
    if (!this.run || m.runId !== this.run.runId) return;
    if (!this.authority() || this.authority() !== p) throw new Error('only the sync authority sends checkpoints');
    if (!(m.blob instanceof Uint8Array)) throw new Error('bad checkpoint');
    this.broadcast(['checkpoint', { runId: m.runId, tick: Number(m.tick) | 0, blob: m.blob }], p);
  }

  /** The host player if connected, otherwise the lowest connected slot (MULTIPLAYER §7.4). */
  authority(): Player | undefined {
    const active = [...this.players.values()].filter((x) => x.conn).sort((a, b) => a.info.slot - b.info.slot);
    return active.find((x) => x.info.isHost) ?? active[0];
  }

  private onJoin(p: Player, m: ClientMsgs['join']): void {
    if (!p.info.isHost) return this.send(p, ['error', { code: 'NOT_HOST', message: 'Only the host can switch worlds.' }]);
    if (this.run) return;
    this.compact();
    if ('worldId' in m) this.openWorld(String(m.worldId));
    else this.openWorld(this.store.create(String(m.newWorld.name).slice(0, 80), String(m.newWorld.preset)).id);
    for (const x of this.players.values()) if (x.conn) this.sendSnapshot(x);
  }

  // ---- plumbing --------------------------------------------------------------------------------
  private rateOk(p: Player, type: string): boolean {
    const second = Math.floor(this.now() / 1000);
    if (p.rate.window !== second) p.rate = { window: second, ops: 0, chat: 0, presence: 0 };
    if (type === 'op' || type === 'lock' || type === 'unlock') return ++p.rate.ops <= 200;
    if (type === 'chat') return ++p.rate.chat <= 5;
    if (type === 'presence' || type === 'ping') return ++p.rate.presence <= 40;
    return true;
  }

  private send(p: Player, msg: ServerMsg): void {
    p.conn?.send(encode(msg));
  }

  private broadcast(msg: ServerMsg, except?: Player): void {
    const bytes = encode(msg);
    for (const p of this.players.values()) if (p !== except && p.conn) p.conn.send(bytes);
  }

  private fail(conn: Conn, code: ErrorCode, message: string, close: boolean): void {
    conn.send(encode(['error', { code, message }]));
    if (close) {
      this.conns.delete(conn);
      conn.close(4000, code);
    }
  }

  shutdown(): void {
    if (this.run?.timer) clearTimeout(this.run.timer);
    this.compact();
    this.store.closeJournal();
  }
}

/** Ids an op creates (must be in the sender's namespace, MULTIPLAYER §5.3). */
export function createdIds(op: Op): PartId[] {
  switch (op.k) {
    case 'PartAdd': return [op.part.id];
    case 'LinkAdd': return [op.link.id];
    case 'NoteAdd': return [op.note.id];
    // M2 stream D: a module placement creates ids idBase+1 .. idBase+count (DATA_FORMATS §4)
    case 'ModulePlace': return Array.from({ length: op.count }, (_, i) => op.idBase + 1 + i);
    case 'Batch': return op.ops.flatMap(createdIds);
    default: return [];
  }
}

/** Ids an op changes or deletes (lock checks). */
export function mutatedIds(op: Op): PartId[] {
  switch (op.k) {
    case 'PartUpdate': case 'LinkUpdate': case 'NoteUpdate': return [op.id];
    case 'PartRemove': case 'LinkRemove': case 'NoteRemove': return [...op.ids];
    case 'GroupSet': return op.members ? [...op.members] : []; // M2 stream D: regrouping a held part is a mutation
    case 'Batch': return op.ops.flatMap(mutatedIds);
    default: return [];
  }
}
