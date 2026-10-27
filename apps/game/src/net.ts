// NetClient: WebSocket session + DocStore wiring (MULTIPLAYER §5–8, ARCHITECTURE §6.1–6.2).

import { DocStore, WorldDoc } from '@knockon/docstore';
import { matterGrains } from '@knockon/sim'; // MI (M4)
import { decodeWorld, makeId, opFromWire, opToWire, type Op, type PartId } from '@knockon/format';
import {
  ClockSync, PROTO, decodeServer, encode, type ClientMsg, type PlayerInfo, type ServerMsgs, type WorldInfo,
  type RunState,
} from '@knockon/net';

export type NetEvent =
  | { type: 'status'; status: 'connecting' | 'online' | 'offline' | 'error'; message?: string }
  | { type: 'world'; title: string }
  | { type: 'doc' }
  | { type: 'peers'; players: PlayerInfo[] }
  | { type: 'presence'; msg: ServerMsgs['presence'] }
  | { type: 'chat'; msg: ServerMsgs['chat']; from: PlayerInfo | undefined }
  | { type: 'ping'; msg: ServerMsgs['ping'] }
  | { type: 'toast'; text: string; level?: 'info' | 'warn' | 'error' }
  | { type: 'locks'; locks: ReadonlyMap<PartId, number> }
  | { type: 'run'; msg: RunMsg };

export type RunMsg =
  | ['run.countdown', ServerMsgs['run.countdown']]
  | ['run.start', ServerMsgs['run.start']]
  | ['run.cancel', ServerMsgs['run.cancel']]
  | ['run.stop', ServerMsgs['run.stop']]
  | ['play', ServerMsgs['play']]
  | ['desync', ServerMsgs['desync']]
  | ['poke', ServerMsgs['poke']]
  | ['bakedMin', ServerMsgs['bakedMin']]
  | ['checkpoint', ServerMsgs['checkpoint']]
  /** A run already in progress when we (re)joined (MULTIPLAYER §8.3). */
  | ['run.resume', RunState];

// MI (M4): headers this client writes (exports, share links) carry the world's grain count and the tier it needs
WorldDoc.countGrains = matterGrains;

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<(e: NetEvent) => void>();
  readonly clock = new ClockSync();
  store: DocStore | null = null;
  /** The joined world's id (snapshot): both players share it, so it seeds the run (critter streams). */
  worldId = '';
  me: PlayerInfo | null = null;
  players: PlayerInfo[] = [];
  worlds: WorldInfo[] = [];
  readonly locks = new Map<PartId, number>();
  private counter = 0;
  private presenceAt = 0;
  private retry = 0;
  private readonly tier: number;
  private readonly nickname: string;

  constructor(tier: number, nickname: string) {
    this.tier = tier;
    this.nickname = nickname;
  }

  on(fn: (e: NetEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: NetEvent): void { for (const fn of this.listeners) fn(e); }

  connect(): void {
    this.emit({ type: 'status', status: 'connecting' });
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const resumeToken = sessionStorage.getItem('kn.resume') ?? undefined;
      this.send(['hello', {
        proto: PROTO, build: __KN_BUILD__, tier: this.tier,
        ...(this.nickname ? { nickname: this.nickname } : {}), ...(resumeToken ? { resumeToken } : {}),
      }]);
      for (let i = 0; i < 6; i++) setTimeout(() => this.send(['time', { t0: performance.now() }]), i * 250);
    };
    ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data as ArrayBuffer));
    ws.onclose = () => {
      this.emit({ type: 'status', status: 'offline' });
      if (this.retry < 20) setTimeout(() => this.connect(), Math.min(5000, 300 * 2 ** this.retry++));
    };
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  private onMessage(bytes: Uint8Array): void {
    const [type, p] = decodeServer(bytes);
    switch (type) {
      case 'welcome': {
        const m = p as ServerMsgs['welcome'];
        this.me = m.you;
        this.worlds = m.worlds;
        sessionStorage.setItem('kn.resume', m.resumeToken);
        this.emit({ type: 'status', status: 'online' });
        return;
      }
      case 'snapshot': {
        const m = p as ServerMsgs['snapshot'];
        this.worldId = m.worldId;
        const world = decodeWorld(m.world);
        this.store = new DocStore(this.me!.slot, WorldDoc.fromSnapshot(world), m.seq);
        this.counter = world.counters[String(this.me!.slot)] ?? 0;
        this.players = m.players;
        this.locks.clear();
        for (const [id, slot] of Object.entries(m.locks)) this.locks.set(Number(id), slot);
        this.emit({ type: 'world', title: world.title });
        this.emit({ type: 'peers', players: this.players });
        this.emit({ type: 'doc' });
        if (m.run) this.emit({ type: 'run', msg: ['run.resume', m.run] });
        return;
      }
      case 'op': {
        const m = p as ServerMsgs['op'];
        this.store?.onRemote(m.seq, m.by, opFromWire(m.op));
        this.emit({ type: 'doc' });
        return;
      }
      case 'op.ack': {
        const m = p as ServerMsgs['op.ack'];
        this.store?.onAck(m.clientOpId, m.seq);
        return;
      }
      case 'op.reject': {
        const m = p as ServerMsgs['op.reject'];
        this.store?.onReject(m.clientOpId, m.reason);
        this.emit({ type: 'doc' });
        const who = m.reason === 'LOCKED' ? `${this.partner()?.name ?? 'Your partner'} is holding that` : m.reason;
        this.emit({ type: 'toast', text: who, level: 'warn' });
        return;
      }
      case 'peer': {
        const m = p as ServerMsgs['peer'];
        this.players = [...this.players.filter((x) => x.slot !== m.player.slot), ...(m.event === 'leave' ? [] : [m.player])];
        this.emit({ type: 'peers', players: this.players });
        this.emit({ type: 'toast', text: `${m.player.name} ${m.event === 'leave' ? 'left' : m.event === 'join' ? 'joined' : 'reconnected'}` });
        return;
      }
      case 'locks': {
        const m = p as ServerMsgs['locks'];
        for (const [id, slot] of Object.entries(m.held)) this.locks.set(Number(id), slot);
        for (const id of m.released) this.locks.delete(id);
        this.emit({ type: 'locks', locks: this.locks });
        return;
      }
      case 'presence': return this.emit({ type: 'presence', msg: p as ServerMsgs['presence'] });
      case 'ping': return this.emit({ type: 'ping', msg: p as ServerMsgs['ping'] });
      case 'chat': {
        const m = p as ServerMsgs['chat'];
        return this.emit({ type: 'chat', msg: m, from: this.players.find((x) => x.slot === m.by) });
      }
      case 'time': {
        const m = p as ServerMsgs['time'];
        this.clock.add(m.t0, m.serverTime, performance.now());
        return;
      }
      case 'error': {
        const m = p as ServerMsgs['error'];
        if (m.code === 'BUILD_MISMATCH' || m.code === 'SESSION_FULL' || m.code === 'NOT_ALLOWED' || m.code === 'PROTO_MISMATCH') {
          this.retry = 99; // don't auto-reconnect into the same refusal
          this.emit({ type: 'status', status: 'error', message: m.message });
        } else {
          this.emit({ type: 'toast', text: m.message, level: 'error' });
        }
        return;
      }
      case 'run.countdown': case 'run.start': case 'run.cancel': case 'run.stop': case 'play': case 'desync': case 'poke': case 'bakedMin': case 'checkpoint':
        return this.emit({ type: 'run', msg: [type, p] as RunMsg });
      default:
        return;
    }
  }

  partner(): PlayerInfo | undefined {
    return this.players.find((x) => x.slot !== this.me?.slot);
  }

  nextId(): PartId {
    if (!this.me) throw new Error('not joined');
    this.counter += 1;
    return makeId(this.me.slot, this.counter);
  }

  /** Apply locally (optimistic) and send to the host. */
  submit(op: Op): boolean {
    if (!this.store) return false;
    const r = this.store.applyLocal(op);
    if ('error' in r) {
      this.emit({ type: 'toast', text: r.error, level: 'warn' });
      return false;
    }
    this.queueOp(['op', { clientOpId: r.clientOpId, baseSeq: this.store.confirmedSeq, op: opToWire(op) }]);
    this.emit({ type: 'doc' });
    return true;
  }

  // Ops go out at ≤ 150 per second (the host allows 200): a big paste or brush stroke drains over a
  // few seconds instead of tripping the rate limit. Order is preserved; the doc is already updated.
  private readonly opQueue: ClientMsg[] = [];
  private opWindow = { second: 0, sent: 0 };
  private opTimer: ReturnType<typeof setTimeout> | null = null;
  private queueOp(m: ClientMsg): void {
    this.opQueue.push(m);
    this.flushOps();
  }
  private flushOps(): void {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.opWindow.second) this.opWindow = { second, sent: 0 };
    while (this.opQueue.length && this.opWindow.sent < 150) { this.send(this.opQueue.shift()!); this.opWindow.sent++; }
    if (this.opQueue.length && !this.opTimer) {
      this.opTimer = setTimeout(() => { this.opTimer = null; this.flushOps(); }, 1000 - (performance.now() % 1000) + 5);
    }
  }

  undo(redo = false): void {
    if (!this.store) return;
    const r = redo ? this.store.redo() : this.store.undo();
    if (!r.ok) { this.emit({ type: 'toast', text: r.reason }); return; }
    // UIFIX (D122): behind any op still queued (a burst over 150 ops/s waits for the next second). Sent straight out, the
    // undo overtook the edit it undoes: the host saw the inverse first (rejected, so the edit came back) and the acks
    // arrived out of order.
    this.queueOp(['op', { clientOpId: r.clientOpId, baseSeq: this.store.confirmedSeq, op: opToWire(r.op) }]);
    this.emit({ type: 'doc' });
  }

  /** Throttled to 20 Hz (MULTIPLAYER §6). */
  presence(msg: ClientMsg & { 0: 'presence' }): void {
    const t = performance.now();
    if (t - this.presenceAt < 50) return;
    this.presenceAt = t;
    this.send(msg);
  }
}
