// The browser side of the Matter layer (D92, M4_PLAN contract 2): the backend runs on the renderer's GPUDevice on the
// main thread, commanded by the sim worker.
//
//   sim worker   MatterWorkerLink (a sync MatterLink for the Machine's MatterHost): each Matter command goes to the
//                main thread as one transferable Int32Array; results come back through a SharedArrayBuffer, and the
//                worker blocks in Atomics.wait only when the rigid tick that needs a result (2N + 4) arrives before it
//                does: time dilation, never a skip (SIMULATION §8.5).
//   main thread  MatterHostMain runs the commands, in order, on the bake backend; results go into SAB slots.
//
// Two bake modes, chosen per run from the world's grain budget (run.ts):
//   'gpu'  the bake backend is MX's GPU backend here (big worlds: Sandstorm);
//   'cpu'  the worker runs MX's CPU backend itself (bit-identical, D91) and only mirrors its commands here (small
//          worlds: no round trip at all, so rollback re-simulation and Bake & Watch run at full CPU speed).
//
// Playback (normal Run, rollback, Bake & Watch): the bake runs ahead of the playhead (up to 4 s live, the whole run
// in Bake & Watch), so the bake backend's buffers show the future. A second GPU backend, the playback replica,
// replays the recorded command stream up to the playhead's Matter tick; R4 draws `view()`, which is the replica's.
// Scrubbing back (or a rollback that rewrites ticks the replica already showed) restores the nearest Matter snapshot
// at or before the target and replays forward. Commands are tiny next to particle state, so this keeps every grain
// visible at any playback position without storing particle frames (4M grains are 112 MB per frame).
//
// DOM-free at module scope: the worker imports MatterWorkerLink and MirrorLink from here too.

import type { MatterBackend, MatterLink, MatterSnapRef, MatterStepIn, MatterStepOut } from '@knockon/sim';
import { packIn, packOut, snapshotTick, unpackIn, unpackOut } from '@knockon/sim';
import type { MatterView } from '@knockon/matter';

// ---- shared memory layout ----------------------------------------------------------------------------------------

const SLOTS = 8;
const SLOT_HEADER = 4; // state (0 empty, 1 full), epoch, backend tick, length (i32 words)
const SLOT_WORDS = 65536; // 256 KB: 4,096 dynamic proxies × 7 + intakes × 4 + counts
const CTL = 16; // [0] stopped (1 lost, 2 released: UIFIX) · [1] reply state (0 idle, 1 chunk ready, 2 last chunk) · [2] chunk bytes · [3] total bytes
const REPLY_BYTES = 4 << 20;
const SAB_BYTES = (CTL + SLOTS * (SLOT_HEADER + SLOT_WORDS)) * 4 + REPLY_BYTES;
const slotAt = (k: number): number => CTL + k * (SLOT_HEADER + SLOT_WORDS);
const REPLY_AT = (CTL + SLOTS * (SLOT_HEADER + SLOT_WORDS)) * 4;
/** How long the worker waits for one result before giving up on the GPU host (device lost, tab frozen). */
const WAIT_LIMIT_MS = 30000;

/** Worker → main messages. `first` is the absolute Matter tick of backend tick 0 (−1 before Matter starts). */
export type MatterMsg =
  | { t: 'init'; mode: 'gpu' | 'cpu'; capacity: number; seed: number }
  | { t: 'step'; epoch: number; first: number; buf: Int32Array }
  | { t: 'snap'; id: number; btick: number; bytes?: Uint8Array }
  | { t: 'restore'; epoch: number; id: number; btick: number; first: number; bytes?: Uint8Array }
  | { t: 'release'; id: number }
  | { t: 'bytes'; id: number }
  | { t: 'destroy' };

/** What a run hands the worker so its MatterHost can reach the main thread. */
export interface MatterChannel { readonly port: MessagePort; readonly sab: SharedArrayBuffer; readonly mode: 'gpu' | 'cpu' }

// ---- sim worker side ---------------------------------------------------------------------------------------------

/** The sim worker's link in 'gpu' mode: commands out by message, results back through the SAB (blocking when late). */
export class MatterWorkerLink implements MatterLink {
  readonly kind = 'gpu-remote';
  private readonly ctl: Int32Array;
  private readonly bytesView: Uint8Array;
  private epoch = 1;
  private nextId = 1;
  private stepped = 0;
  private first = -1;
  private readonly btickOf = new Map<number, number>();
  /** Wall time spent blocked on results (ms), for the HUD's dilation readout. */
  waitedMs = 0;

  private readonly port: MessagePort;
  constructor(port: MessagePort, sab: SharedArrayBuffer, init: { capacity: number; seed: number }) {
    this.port = port;
    this.ctl = new Int32Array(sab);
    this.bytesView = new Uint8Array(sab);
    this.post({ t: 'init', mode: 'gpu', ...init });
  }

  private post(m: MatterMsg, transfer: Transferable[] = []): void { this.port.postMessage(m, transfer); }

  meta(first: number): void { this.first = first; }

  submit(input: MatterStepIn): void {
    const buf = packIn(input);
    this.stepped = input.tick + 1;
    this.post({ t: 'step', epoch: this.epoch, first: this.first, buf }, [buf.buffer]);
  }

  take(tick: number): MatterStepOut {
    const k = slotAt(tick % SLOTS);
    const c = this.ctl;
    let waited = 0;
    for (;;) {
      // UIFIX (D122): 1 = the GPU host failed (device lost, an error), 2 = it was released at the end of the run
      const stop = Atomics.load(c, 0);
      if (stop === 1) throw new Error('matter: the GPU host stopped (device lost?)');
      if (stop !== 0) throw new Error('matter: the run ended while the sim still waited on Matter');
      if (Atomics.load(c, k) === 1) {
        if (c[k + 1] === this.epoch && c[k + 2] === tick) {
          const out = unpackOut(c.slice(k + SLOT_HEADER, k + SLOT_HEADER + c[k + 3]!));
          Atomics.store(c, k, 0);
          return out;
        }
        if (c[k + 1] !== this.epoch) { Atomics.store(c, k, 0); continue; } // a result of a timeline a restore replaced
      }
      const t0 = performance.now();
      Atomics.wait(c, k, 0, 50);
      const dt = performance.now() - t0;
      waited += dt;
      this.waitedMs += dt;
      if (waited > WAIT_LIMIT_MS) throw new Error(`matter: no result for Matter tick ${tick} after ${WAIT_LIMIT_MS / 1000} s`);
    }
  }

  snapshot(): MatterSnapRef {
    const id = this.nextId++;
    this.btickOf.set(id, this.stepped);
    this.post({ t: 'snap', id, btick: this.stepped });
    return { id };
  }

  restore(ref: MatterSnapRef): void {
    this.epoch++;
    const btick = ref.bytes ? snapshotTick(ref.bytes) : this.btickOf.get(ref.id) ?? -1;
    if (btick >= 0) this.stepped = btick;
    this.post({ t: 'restore', epoch: this.epoch, id: ref.id, btick, first: this.first, ...(ref.bytes ? { bytes: ref.bytes.slice() } : {}) });
  }

  /** A snapshot's bytes from the main thread, in REPLY_BYTES chunks (desync export; rare). */
  bytes(ref: MatterSnapRef): Uint8Array {
    if (ref.bytes) return ref.bytes;
    const c = this.ctl;
    Atomics.store(c, 1, 0);
    this.post({ t: 'bytes', id: ref.id });
    let out: Uint8Array | null = null, off = 0, waited = 0;
    for (;;) {
      const st = Atomics.load(c, 1);
      if (st === 1 || st === 2) {
        const total = c[3]!, n = c[2]!;
        out ??= new Uint8Array(total);
        out.set(this.bytesView.subarray(REPLY_AT, REPLY_AT + n), off);
        off += n;
        Atomics.store(c, 1, 0);
        Atomics.notify(c, 1);
        if (st === 2) return out;
        continue;
      }
      if (Atomics.load(c, 0) !== 0) throw new Error('matter: the GPU host stopped');
      const t0 = performance.now();
      Atomics.wait(c, 1, 0, 50);
      waited += performance.now() - t0;
      if (waited > WAIT_LIMIT_MS) throw new Error('matter: snapshot export timed out');
    }
  }

  release(ref: MatterSnapRef): void { this.btickOf.delete(ref.id); if (!ref.bytes) this.post({ t: 'release', id: ref.id }); }

  destroy(): void { this.post({ t: 'destroy' }); this.port.close(); }
}

/**
 * The sim worker's link in 'cpu' mode: MX's CPU backend runs here, synchronously (the inner link), and every command,
 * snapshot and restore is mirrored to the main thread so the playback replica can show the grains.
 */
export class MirrorLink implements MatterLink {
  readonly kind = 'cpu-mirrored';
  private epoch = 1;
  private stepped = 0;
  private first = -1;
  private readonly btickOf = new Map<number, number>();

  private readonly inner: MatterLink;
  private readonly port: MessagePort;
  constructor(inner: MatterLink, port: MessagePort, init: { capacity: number; seed: number }) {
    this.inner = inner;
    this.port = port;
    this.port.postMessage({ t: 'init', mode: 'cpu', ...init } satisfies MatterMsg);
  }

  meta(first: number): void { this.first = first; }

  submit(input: MatterStepIn): void {
    this.inner.submit(input);
    this.stepped = input.tick + 1;
    const buf = packIn(input);
    this.port.postMessage({ t: 'step', epoch: this.epoch, first: this.first, buf } satisfies MatterMsg, [buf.buffer]);
  }

  take(tick: number): MatterStepOut { return this.inner.take(tick); }

  snapshot(): MatterSnapRef {
    const ref = this.inner.snapshot();
    this.btickOf.set(ref.id, this.stepped);
    // the replica scrubs back from these (small worlds: kilobytes to a few MB every 2 s)
    if (ref.bytes) this.port.postMessage({ t: 'snap', id: ref.id, btick: this.stepped, bytes: ref.bytes.slice() } satisfies MatterMsg);
    return ref;
  }

  restore(ref: MatterSnapRef): void {
    this.inner.restore(ref);
    this.epoch++;
    const btick = this.btickOf.get(ref.id) ?? (ref.bytes ? snapshotTick(ref.bytes) : -1);
    if (btick >= 0) this.stepped = btick;
    this.port.postMessage({ t: 'restore', epoch: this.epoch, id: ref.id, btick, first: this.first, ...(btick < 0 && ref.bytes ? { bytes: ref.bytes.slice() } : {}) } satisfies MatterMsg);
  }

  bytes(ref: MatterSnapRef): Uint8Array { return this.inner.bytes(ref); }

  release(ref: MatterSnapRef): void {
    this.inner.release(ref);
    this.btickOf.delete(ref.id);
    this.port.postMessage({ t: 'release', id: ref.id } satisfies MatterMsg);
  }

  destroy(): void { this.inner.destroy(); this.port.postMessage({ t: 'destroy' } satisfies MatterMsg); this.port.close(); }
}

// ---- main thread side ------------------------------------------------------------------------------------------

/** Makes a backend on the shared device (async: run.ts imports the GPU module lazily). */
export type BackendFactory = () => MatterBackend | Promise<MatterBackend>;

interface Snap { btick: number; bytes: Uint8Array | null; pending: Promise<Uint8Array> | null }

/** Snapshot bytes kept on the main thread for the replica and the bake backend's restores (16 GB tier pool, §8.5). */
const SNAP_BUDGET = 1 << 30;

/**
 * The main thread's Matter host (one per run): the bake backend ('gpu' mode), the playback replica, the command log
 * and the snapshot store. R4 draws `view()`.
 */
export class MatterHostMain {
  readonly mode: 'gpu' | 'cpu';
  private readonly port: MessagePort;
  private readonly ctl: Int32Array;
  private readonly bytesView: Uint8Array;
  private bake: MatterBackend | null = null;
  private replica: MatterBackend | null = null;
  /**
   * Ordering: steps go to the backend as soon as they arrive (MX's GPU backend queues ticks back to back, and two are in
   * flight under the fixed latency), each after the last barrier. Barriers (init, snapshot, restore, export) wait for
   * every step in flight, so a snapshot or restore sees exactly the ticks before it.
   */
  private barrier: Promise<void> = Promise.resolve();
  private readonly inflight = new Set<Promise<unknown>>();
  private cfg: { capacity: number; seed: number } = { capacity: 0, seed: 0 };
  /** The bake timeline: commands by backend tick, and how many the bake backend has stepped. */
  private readonly log = new Map<number, Int32Array>();
  private stepped = 0;
  private first = -1;
  private epoch = 0;
  private readonly snaps = new Map<number, Snap>();
  private snapBytes = 0;
  /** Replica state: the backend tick it shows, whether a step is in flight, and a forced re-seek. */
  private rTick = 0;
  private rBusy = false;
  private rDirty = false;
  private rInitial: Uint8Array | null = null;
  /** 'gpu' runs: the playhead is within 2 Matter ticks of the bake head, so view() shows the bake backend and the
   * replica rests (no double GPU cost while the run is dilated); it re-seeks when the bake pulls ahead again. */
  private follow = false;
  /** Device loss (V4's renderer.onRestore): the bake backend is gone until deviceRestored(); commands keep being logged. */
  private lost = false;
  /** Backend ticks received on the current timeline (the bake must have computed all of them). */
  private next = 0;
  /** Snapshots requested while the device was lost (taken when the recovery replay reaches their tick). */
  private deferred: Snap[] = [];
  private redo = false;
  /** Device losses survived (debug). */
  recoveries = 0;
  private destroyed = false;
  /** Stats (HUD, profiling): Matter ticks the bake ran, the replica's lag behind the playhead (Matter ticks), and the
   * smoothed time from a command's arrival to its result in the SAB (ms). */
  bakeTicks = 0;
  replicaLag = 0;
  stepMs = 0;

  /** Creates the channel; hand `channel` to the sim worker in its `start` message (port transferred). */
  readonly channel: MatterChannel;

  private factory: BackendFactory;
  constructor(mode: 'gpu' | 'cpu', factory: BackendFactory) {
    this.factory = factory;
    this.mode = mode;
    const mc = new MessageChannel();
    const sab = new SharedArrayBuffer(SAB_BYTES);
    this.ctl = new Int32Array(sab);
    this.bytesView = new Uint8Array(sab);
    this.port = mc.port1;
    this.port.onmessage = (ev: MessageEvent<MatterMsg>) => this.onMsg(ev.data);
    this.channel = { port: mc.port2, sab, mode };
  }

  /** The particle buffers R4 draws: the playback replica's (GPU backends only), or null before it exists. */
  view(): MatterView | null {
    // dilated (the playhead is at the bake head): the bake backend already shows the playhead's tick
    if (this.follow && this.bake?.view) { try { return this.bake.view() as MatterView; } catch { /* fall through */ } }
    const r = this.replica;
    if (!r?.view || !this.rInitial) return null;
    try { return r.view() as MatterView; } catch { return null; } // a backend that can't draw (yet)
  }

  /** Is anything running yet (the first Matter command has arrived)? */
  get started(): boolean { return this.first >= 0; }

  /** Runs `fn` after every step in flight and the previous barrier; later steps wait for it. */
  private serial(fn: () => Promise<void> | void): void {
    const prev = [this.barrier, ...this.inflight];
    this.barrier = Promise.all(prev).then(fn).catch((err: unknown) => this.fail(err));
  }

  /** Issues a step right after the last barrier, without waiting for earlier steps' readbacks. */
  private issue(input: MatterStepIn, epoch: number): void {
    const t0 = performance.now();
    const p = this.barrier.then(() => this.bake!.step(input)).then((out) => {
      this.stepped = Math.max(this.stepped, input.tick + 1);
      this.bakeTicks++;
      const dt = performance.now() - t0;
      this.stepMs = this.stepMs ? this.stepMs * 0.9 + dt * 0.1 : dt;
      this.writeResult(epoch, out);
    }).catch((err: unknown) => this.fail(err));
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private fail(err: unknown): void {
    // a lost device fails whatever was in flight, usually before its `lost` promise resolves: give that a moment, and if
    // it's a loss, recovery re-runs everything, so the worker only waits (dilates)
    if (!this.lost && !this.destroyed) { setTimeout(() => this.failNow(err), 300); return; }
    this.failNow(err);
  }

  private failNow(err: unknown): void {
    if (this.lost || this.destroyed) { console.warn('matter host (device lost, recovering):', err); return; }
    console.error('matter host:', err);
    Atomics.store(this.ctl, 0, 1); // the worker's wait throws instead of hanging
    Atomics.notify(this.ctl, slotAt(0), Infinity);
    for (let k = 0; k < SLOTS; k++) Atomics.notify(this.ctl, slotAt(k), Infinity);
  }

  private onMsg(m: MatterMsg): void {
    if (this.destroyed) return;
    switch (m.t) {
      case 'init':
        this.cfg = { capacity: m.capacity, seed: m.seed };
        this.serial(async () => {
          if (this.mode === 'gpu') { this.bake = await this.factory(); await this.bake.init(this.cfg); }
          // the replica only draws: if it can't start, the run goes on without visible grains
          void (async () => {
            try {
              const r = await this.factory();
              await r.init(this.cfg);
              this.replica = r;
              this.rInitial = await r.snapshot();
            } catch (err) { console.warn('matter: no playback replica', err); }
          })();
        });
        return;
      case 'step': {
        const input = unpackIn(m.buf);
        this.first = m.first;
        this.log.set(input.tick, m.buf);
        this.epoch = m.epoch;
        this.next = input.tick + 1;
        if (this.mode === 'cpu') { this.stepped = input.tick + 1; return; }
        if (this.lost) return; // logged: recovery re-runs it on the new device
        this.issue(input, m.epoch);
        return;
      }
      case 'snap': {
        const s: Snap = { btick: m.btick, bytes: m.bytes ?? null, pending: null };
        this.snaps.set(m.id, s);
        if (m.bytes) this.snapBytes += m.bytes.length;
        else if (this.lost) this.deferred.push(s); // taken during recovery, when the replay reaches its tick
        else this.serial(async () => {
          // a full barrier: later steps wait for the snapshot's readback, so they can't change the state it copies
          s.pending = this.bake!.snapshot();
          const bytes = await s.pending;
          s.bytes = bytes; s.pending = null; this.snapBytes += bytes.length;
        });
        this.trimSnaps();
        return;
      }
      case 'restore': {
        const s = this.snaps.get(m.id);
        const btick = m.btick >= 0 ? m.btick : s?.btick ?? (m.bytes ? Math.max(0, snapshotTick(m.bytes)) : 0);
        this.first = m.first;
        this.epoch = m.epoch;
        // the timeline after the restored point is rewritten: forget its commands; the replica re-seeks if it showed any
        for (const k of [...this.log.keys()]) if (k >= btick) this.log.delete(k);
        if (this.rTick > btick) this.rDirty = true;
        if (m.bytes) { const own: Snap = { btick, bytes: m.bytes, pending: null }; this.snaps.set(m.id, own); this.snapBytes += m.bytes.length; }
        this.next = btick;
        if (this.mode === 'cpu') { this.stepped = btick; return; }
        if (this.lost) { this.redo = true; return; } // a running recovery starts over from the newest snapshot ≤ `next`
        this.serial(async () => {
          const bytes = m.bytes ?? s?.bytes ?? (s?.pending ? await s.pending : null);
          if (!bytes) throw new Error(`matter: restore of unknown snapshot ${m.id}`);
          await this.bake!.restore(bytes);
          this.stepped = btick;
        });
        return;
      }
      case 'release': {
        const s = this.snaps.get(m.id);
        if (s?.bytes) this.snapBytes -= s.bytes.length;
        this.snaps.delete(m.id);
        return;
      }
      case 'bytes':
        this.serial(async () => {
          const s = this.snaps.get(m.id);
          const bytes = s?.bytes ?? (s?.pending ? await s.pending : null);
          if (!bytes) throw new Error(`matter: export of unknown snapshot ${m.id}`);
          await this.sendReply(bytes);
        });
        return;
      case 'destroy': this.destroy(); return;
    }
  }

  private writeResult(epoch: number, out: MatterStepOut): void {
    const a = packOut(out);
    if (a.length > SLOT_WORDS) throw new Error(`matter: result of ${a.length} words is over the slot size`);
    const k = slotAt(out.tick % SLOTS);
    const c = this.ctl;
    c.set(a, k + SLOT_HEADER);
    c[k + 1] = epoch; c[k + 2] = out.tick; c[k + 3] = a.length;
    Atomics.store(c, k, 1);
    Atomics.notify(c, k);
  }

  /** Bytes to the blocked worker in REPLY_BYTES chunks (it acks each by clearing ctl[1]). */
  private async sendReply(bytes: Uint8Array): Promise<void> {
    const c = this.ctl;
    for (let off = 0; off < bytes.length || off === 0; off += REPLY_BYTES) {
      while (Atomics.load(c, 1) !== 0) await new Promise((r) => setTimeout(r, 1));
      const n = Math.min(REPLY_BYTES, bytes.length - off);
      this.bytesView.set(bytes.subarray(off, off + n), REPLY_AT);
      c[2] = n; c[3] = bytes.length;
      Atomics.store(c, 1, off + n >= bytes.length ? 2 : 1);
      Atomics.notify(c, 1);
      if (n === 0) break;
    }
  }

  /** Keeps snapshot bytes within the budget: the oldest go first (the worker's own budget usually frees them sooner). */
  private trimSnaps(): void {
    if (this.snapBytes <= SNAP_BUDGET) return;
    for (const [id, s] of this.snaps) {
      if (this.snapBytes <= SNAP_BUDGET) break;
      if (!s.bytes) continue;
      this.snapBytes -= s.bytes.length;
      this.snaps.delete(id);
    }
  }

  /**
   * Playback (call every frame with the playhead's rigid tick): moves the replica to that Matter tick, a few steps per
   * frame, restoring the nearest snapshot first when it has to go back (scrub, or a rollback rewrote what it showed).
   */
  playback(rigidTick: number): void {
    const r = this.replica;
    if (!r || this.rBusy || this.destroyed || !this.rInitial) return;
    if (this.first < 0) {
      if (this.rTick !== 0) { this.rBusy = true; void this.reseek(0).finally(() => { this.rBusy = false; }); }
      return;
    }
    const target = Math.min(Math.floor(rigidTick / 2) - this.first, this.stepped);
    if (target < 0) return;
    this.follow = this.mode === 'gpu' && !!this.bake && target >= this.stepped - 2;
    if (this.follow) { this.replicaLag = 0; return; }
    this.replicaLag = Math.max(0, target - this.rTick);
    if (this.rDirty || target < this.rTick || target - this.rTick > 600) {
      this.rBusy = true;
      void this.reseek(target).finally(() => { this.rBusy = false; });
      return;
    }
    if (target === this.rTick) return;
    this.rBusy = true;
    void (async () => {
      try {
        // ≤ 4 Matter ticks per frame (queued back to back: one readback wait, not four): playback at up to 4× real
        // time keeps up; faster catches up over a few frames
        const steps: Promise<unknown>[] = [];
        for (let n = 0; n < 4 && this.rTick < target; n++) {
          const buf = this.log.get(this.rTick);
          if (!buf) { this.rDirty = true; break; }
          steps.push(r.step(unpackIn(buf)));
          this.rTick++;
        }
        await Promise.all(steps);
      } catch (err) { console.error('matter replica:', err); this.rDirty = true; } finally { this.rBusy = false; }
    })();
  }

  /**
   * Capture (C4, orchestrator M4): resolves once the replica shows exactly the Matter tick of `rigidTick`, so an offline
   * frame never draws particles a tick behind the rigid playback. Polls with timers, not the clock: capture swaps
   * the main thread's performance.now for a fixed frame clock. False if the replica is gone or doesn't get there.
   */
  async playbackTo(rigidTick: number, maxPolls = 20000): Promise<boolean> {
    for (let n = 0; n < maxPolls; n++) {
      if (!this.replica || this.destroyed || !this.rInitial) return false;
      if (!this.rBusy) {
        if (this.first < 0) { if (this.rTick === 0) return true; }
        else {
          const target = Math.min(Math.floor(rigidTick / 2) - this.first, this.stepped);
          if (target < 0 || this.follow || (!this.rDirty && this.rTick === target)) return true;
        }
        this.playback(rigidTick);
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    return false;
  }

  /** Restores the replica to the newest snapshot at or before `target` (or its empty start) and replays up to it. */
  private async reseek(target: number): Promise<void> {
    const r = this.replica!;
    let best: Snap | null = null;
    for (const s of this.snaps.values()) if (s.bytes && s.btick <= target && (!best || s.btick > best.btick)) best = s;
    try {
      await r.restore(best?.bytes ?? this.rInitial!);
      this.rTick = best?.btick ?? 0;
      this.rDirty = false;
      const steps: Promise<unknown>[] = [];
      for (let n = 0; this.rTick < target && n < 240; n++) {
        const buf = this.log.get(this.rTick);
        if (!buf) break;
        steps.push(r.step(unpackIn(buf)));
        this.rTick++;
      }
      await Promise.all(steps);
    } catch (err) { console.error('matter replica seek:', err); }
  }

  /** The renderer's device was lost: stop issuing to the dead backends (run.ts wires `device.lost`). */
  deviceLost(): void {
    if (this.lost || this.destroyed) return;
    this.lost = true;
    this.replica = null;
    this.rInitial = null;
    this.follow = false;
  }

  /**
   * V4's renderer rebuilt itself on a new device: new backends on it, the bake restored from the newest CPU snapshot at or
   * before the last tick received, and the logged commands re-run from there (results are rewritten into the SAB; the
   * worker never saw a gap, it only waited). Matter is deterministic, so nothing the sim sees changes.
   */
  deviceRestored(factory: BackendFactory): void {
    if (this.destroyed) return;
    this.lost = true;
    this.factory = factory;
    const old = this.bake;
    this.bake = null;
    try { old?.destroy(); } catch { /* it died with its device */ }
    this.barrier = (async () => {
      try {
        if (this.mode === 'gpu') {
          const be = await factory();
          await be.init(this.cfg);
          const empty = await be.snapshot(); // backend tick 0 (the timeline's start, when no snapshot is older)
          this.bake = be;
          let t = 0;
          do {
            // (again if the worker rolled back meanwhile)
            this.redo = false;
            let best: Snap | null = null;
            for (const sn of this.snaps.values()) if (sn.bytes && sn.btick <= this.next && (!best || sn.btick > best.btick)) best = sn;
            await be.restore(best?.bytes ?? empty);
            t = best?.btick ?? 0;
            // replay, taking the snapshots asked for meanwhile when their tick comes (each one awaited: a full barrier)
            for (; t < this.next && !this.redo; t++) {
              for (const d of this.deferred) if (d.btick === t && !d.bytes) { d.bytes = await be.snapshot(); this.snapBytes += d.bytes.length; }
              const buf = this.log.get(t);
              if (!buf) throw new Error(`matter: recovery has no command for backend tick ${t}`);
              const out = await be.step(unpackIn(buf));
              this.writeResult(this.epoch, out);
            }
          } while (this.redo);
          for (const d of this.deferred) if (d.btick === t && !d.bytes) { d.bytes = await be.snapshot(); this.snapBytes += d.bytes.length; }
          this.deferred = [];
          this.stepped = t;
        }
        this.lost = false;
        this.recoveries++;
        this.rTick = 0;
        this.rDirty = true;
        void (async () => {
          try {
            const r = await factory();
            await r.init(this.cfg);
            this.replica = r;
            this.rInitial = await r.snapshot();
          } catch (err) { console.warn('matter: no playback replica after the device loss', err); }
        })();
      } catch (err) {
        this.lost = false;
        this.fail(err);
      }
    })();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    Atomics.store(this.ctl, 0, 2); // UIFIX (D122): released, not lost (1)
    for (let k = 0; k < SLOTS; k++) Atomics.notify(this.ctl, slotAt(k), Infinity);
    this.port.close();
    this.bake?.destroy();
    this.replica?.destroy();
    this.log.clear();
    this.snaps.clear();
  }
}

// ---- the renderer's view (R4) -------------------------------------------------------------------------------------

let current: MatterHostMain | null = null;

/** run.ts sets the run's host (null on Stop). */
export function setMatterHost(h: MatterHostMain | null): void { current = h; }

/**
 * R4: the Matter particle buffers to draw this frame (MX backend.ts MatterView: pos / vel / mat on the shared device,
 * `count` live grains), already at the playhead's Matter tick. Null when no Matter is running.
 */
export function matterView(): MatterView | null {
  return current?.view() ?? null;
}
