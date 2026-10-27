// Run mode (GAME_SPEC §4.2, MULTIPLAYER §7): shared countdown and clock, bake-ahead simulation in the
// sim worker, a shared playhead (pause, speed, step, scrub) held at the slower partner's bake head,
// pokes with rollback, desync detection and checkpoint repair, solo preview, perfect reset on Stop.

import type { BodyInfo, SimEvent } from '@knockon/sim';
import type { NetClient, RunMsg } from './net.ts';
// MI (M4): the Matter layer's browser host (D92) and the world's grain budget
import { matterCapacity, matterGrains } from '@knockon/sim';
import { worldRequiredTier, type PartRecord, type SimFlags } from '@knockon/format';
import { MatterHostMain, setMatterHost } from './matterhost.ts';
/**
 * MI (M4): worlds up to this many grains bake Matter on the CPU in the sim worker (no GPU round trip); above, on the GPU.
 * MX's CPU reference measured ≈ 47 µs per particle per Matter tick (11,700 water: 552 ms), so only a few hundred grains
 * fit a 60 Hz budget there; everything else bakes on the GPU (and the CPU path is the fallback without a device).
 */
export const MATTER_CPU_GRAINS = 300;

/** Two u32 words from the world id (FNV-1a, two bases): the same on both machines, different per world. */
export function worldSeed(id: string): [number, number] {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return [a || 1, b || 1];
}
import type { FromWorker, PlayState, ToWorker } from './sim.worker.ts';

export type RunPhase = 'build' | 'countdown' | 'running';

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const;


/** UIFIX (D122): how long a stopped run's Matter host waits for the worker's 'destroy' before it's destroyed anyway. */
const MATTER_RELEASE_MS = 3000;
export class RunController {
  phase: RunPhase = 'build';
  runId: string | null = null;
  /** Solo preview (MULTIPLAYER §7.5): only the test system runs, the partner keeps building. */
  solo = false;
  paused = false;
  speed = 1;
  countdownEndsAt = 0; // local performance.now() time
  bodies: BodyInfo[] = [];
  transforms = new Float32Array(0);
  partIds: number[] = [];
  flags = new Uint8Array(0);
  /** Screen readouts per part (Machine.partMeters). */
  meters = new Uint8Array(0);
  linkIds: number[] = [];
  links = new Float32Array(0);
  /**
   * Critter state per part (contract 3, Machine.critterState): 4 bytes per part in partIds order.
   * Critters: [clip (CRITTER_CLIPS), flags (CritterFlagBits), emote (CRITTER_EMOTES, 0 none), fsm (CRITTER_FSM)];
   * critter-bound devices: [timer seconds, DeviceFlagBits, 0, phase]; other parts: zeros.
   */
  critters = new Uint8Array(0);
  /**
   * Carried items (Machine.critterCarry): pairs [critter index, carried part index] into partIds, one per
   * critter carrying something (Bandit's loot, drawn at his `prop_r` bone); usually empty.
   */
  carry = new Int32Array(0);
  /** U5 (M5): Machine.critterTargets (B5): pairs [BUZZ index, item index] into partIds, the item each BUZZ is after. */
  targets = new Int32Array(0);
  /** R5 (M5): Machine.grabberJoints (A5): 8 floats per GRABBER [part index, yaw, shoulder, elbow, wrist pitch, wrist roll, finger opening per side, held]. */
  grabbers = new Float32Array(0);
  /** G3: light beams this frame (Machine.lightBeams): [x0, y0, z0, x1, y1, z1, intensity, kind] per segment;
   * kind 0 TORCH ray, 1 LANCE ray, 2 LANCE cutting beam. */
  beams = new Float32Array(0);
  /** Playhead (fractional ticks), our bake head, and whether playback is waiting on a bake head. */
  tick = 0;
  baked = 0;
  waiting = false;
  readonly tickRate = 120;
  desyncs = 0;
  resyncs = 0;
  /**
   * U5 (M5): Settings › Performance › Physics threads, read once at boot (main.ts): the Jolt worker threads to ask the
   * sim worker for (0 = the single-threaded build), or undefined for its default (hardwareConcurrency − 3, D99).
   * Results never depend on it. `joltThreadsLive` is what the worker reported at the last run start (perf readout).
   */
  joltThreads: number | undefined = undefined;
  joltThreadsLive: number | null = null;
  /**
   * S3 time dilation (GAME_SPEC §6.5, SIMULATION §11: simRate = sim ticks per second / tickRate): how fast the sim
   * bakes. Below 1 while playback is held at our own bake head, the machine runs slower than real time.
   */
  simRate = 1;
  /** S3 Bake & Watch: progress while a whole run bakes before playback (null when not baking). */
  bake: { baked: number; target: number; rate: number; done: boolean; settled: boolean; keyframeMB: number } | null = null;
  private readonly bakeListeners: ((b: NonNullable<RunController['bake']>) => void)[] = [];
  private watchSpeed = 1;
  /** Every event played so far this run (timeline markers, toasts, Cascade Report). */
  readonly log: SimEvent[] = [];
  private startsAt = 0; // server time of tick 0
  private worker: Worker; // J5 (M5): replaced after a fatal sim error (newWorker)
  private readonly net: NetClient;
  private readonly toast: (text: string, level?: 'info' | 'warn' | 'error') => void;
  private readonly eventListeners: ((e: SimEvent[]) => void)[] = [];
  private soloSeq = 0;

  constructor(net: NetClient, toast: (text: string, level?: 'info' | 'warn' | 'error') => void) {
    this.net = net;
    this.toast = toast;
    this.worker = this.newWorker();
    net.on((e) => { if (e.type === 'run') this.onMsg(e.msg); });
  }

  /** The sim worker. J5 (M5): an uncaught error in it is reported, never silent. */
  private newWorker(): Worker {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    w.onerror = (ev: ErrorEvent) => { if (w === this.worker) this.toast(`Simulation: ${ev.message || 'the sim worker failed'}`, 'error'); };
    return w;
  }

  /**
   * J5 (M5): the sim worker dropped the run (a Jolt abort, above all `Aborted(OOM)`: the run outgrew its fixed physics
   * heap, which tops out at 4 GB; or an exception mid-step). The run stops (for everyone: a partner's run can't stay in
   * step with ours), the player is told why, and the worker is replaced so the next run starts on fresh memory (a
   * threaded module's shared heap is only freed when its worker goes).
   */
  private simFailed(f: NonNullable<Extract<FromWorker, { type: 'error' }>['fatal']>, message: string): void {
    if (f.runId !== this.runId) return; // a run that's already over
    const id = this.runId, solo = this.solo;
    this.worker.terminate();
    this.worker = this.newWorker();
    this.reset();
    if (!solo && id) this.net.send(['run.stop', { runId: id }]);
    const at = `${(f.tick / this.tickRate).toFixed(1)} s, ${f.awake.toLocaleString('en-US')} bodies awake`;
    this.toast(f.kind === 'oom'
      ? `This machine ran out of physics memory (${f.heapMB.toLocaleString('en-US')} MB at ${at}). The run stopped: try fewer parts moving at once.`
      : `The simulation failed at ${at} and the run stopped (${message})`, 'error');
  }

  onEvents(fn: (e: SimEvent[]) => void): void { this.eventListeners.push(fn); }

  /** S3 Bake & Watch progress hook (UI: a progress bar with the baked seconds, rate and ETA). */
  onBakeProgress(fn: (b: NonNullable<RunController['bake']>) => void): void { this.bakeListeners.push(fn); }

  /** Is playback waiting on our own bake head (time dilation, the cue to offer Bake & Watch)? */
  get dilated(): boolean { return this.phase === 'running' && this.waiting && this.simRate < 0.95; }

  /**
   * S3 Bake & Watch (GAME_SPEC §6.5): for machines too big to sim in real time. Holds the shared playhead, bakes up
   * to `seconds` of run (or until the machine has been still for 2 s) as fast as the sim goes, then plays it back
   * at `speed`, smooth at any camera because playback only reads keyframes.
   */
  bakeAndWatch(on: boolean | number = true, speed = 1): void {
    if (on === false) { this.cancelBake(); return; }
    const seconds = on === true ? 120 : on;
    if (this.phase !== 'running' || !this.runId || this.bake) return;
    this.watchSpeed = speed;
    this.setPlay({ paused: true });
    this.bake = { baked: this.baked, target: this.baked + seconds * this.tickRate, rate: 0, done: false, settled: false, keyframeMB: 0 };
    this.tell({ type: 'watch', seconds });
  }

  /** UI: Bake & Watch progress (null when not baking): baked / target ticks, bake rate (ticks/s), done, settled. */
  get bakeProgress(): RunController['bake'] { return this.bake; }

  /** UI: seconds left of a Bake & Watch at the current rate, or null. */
  get bakeEtaS(): number | null {
    const b = this.bake;
    return b && b.rate > 0 ? Math.max(0, (b.target - b.baked) / b.rate) : null;
  }

  /** Stops a Bake & Watch early and plays what's baked. */
  cancelBake(): void {
    if (!this.bake) return;
    this.tell({ type: 'live' });
    this.bake = null;
    this.setPlay({ paused: false, speed: this.watchSpeed });
  }

  private tell(m: ToWorker, transfer: Transferable[] = []): void {
    if (m.type === 'start') { this.sharedPlay = m.play; this.localPlay = null; this.warpFactor = 1; this.warpEnd = 0; this.warpNext = null; } // G3: warp base
    if (m.type === 'start') { const mt = this.startMatter(m.parts, m.simFlags, { environment: m.environment ?? '', sinkFill: m.sinkFill === true }); if (mt) { m = { ...m, matter: mt.matter }; transfer = [...transfer, ...mt.transfer]; } } // MI (M4)
    this.worker.postMessage(m, transfer);
  }

  // ---- MI (M4): the Matter layer (D92) -------------------------------------------------------------------------

  /** The renderer's device (Matter's GPU backend and playback replica share it, M4_PLAN contract 3) and this client's tier. */
  private matterDevice: GPUDevice | null = null;
  private matterTier = 16;
  private matterHost: MatterHostMain | null = null;
  /** Container fill per part (partIds order, 0–1; Machine.partFill: A4's containers, HOURGLASS, HELIO, MI's FISHBOWL / SCOOP): R4's fill pass. */
  fill = new Float32Array(0);
  /** Grains this run's world can have alive (counts.grains), and where its Matter bakes. */
  matterGrains = 0;
  matterMode: 'gpu' | 'cpu' | null = null;
  /** Live Matter grains at the playhead, [sand, water, marble] (keyframed, so right in Bake & Watch and scrubbing too);
   * empty while Matter is off. U4's world-card meter reads it. */
  matterCounts = new Int32Array(0);
  /** Smoothed ms per frame the bake spent blocked on Matter results ('gpu' runs): the Matter share of time dilation. */
  matterWaitMs = 0;

  /**
   * main.ts: hands over the renderer's GPUDevice and the client's tier once the renderer is up, and a way to hear about
   * device-loss recovery (V4: renderer.onRestore), after which Matter moves to the new device without changing outcomes.
   */
  attachMatter(device: GPUDevice, tier: number, onRestore?: (cb: (device: GPUDevice) => void) => void): void {
    this.matterDevice = device;
    this.matterTier = tier;
    onRestore?.((dev) => {
      this.matterDevice = dev;
      const h = this.matterHost;
      if (!h) return;
      h.deviceRestored(async () => new (await import('@knockon/matter/gpu')).MatterGpu(dev));
      void dev.lost.then(() => h.deviceLost());
    });
  }

  /** The run's main-thread Matter host (R4 draws matterhost.ts `matterView()`), or null. */
  get matter(): MatterHostMain | null { return this.matterHost; }

  private startMatter(parts: readonly PartRecord[], flags: SimFlags | undefined, env: { environment: string; sinkFill: boolean }): { matter: { channel: MatterHostMain['channel'] | null; capacity: number }; transfer: Transferable[] } | null {
    this.stopMatter();
    if (!flags?.matterGameplay) return null;
    const grains = matterGrains(parts, env);
    this.matterGrains = grains;
    const need = worldRequiredTier(parts.length, grains, env);
    if (need === 0 || need > this.matterTier) this.toast(need ? `This machine's Matter needs the ${need} GB tier` : 'This machine has more Matter than any tier holds', 'warn');
    const capacity = matterCapacity(grains);
    const mode: 'gpu' | 'cpu' = grains > MATTER_CPU_GRAINS && this.matterDevice ? 'gpu' : 'cpu'; // (CPU only without a device or for a few hundred grains)
    this.matterMode = mode;
    if (!this.matterDevice) return { matter: { channel: null, capacity }, transfer: [] }; // CPU in the worker, nothing drawn
    const device = this.matterDevice;
    // the GPU backend module touches WebGPU globals at load: imported lazily, so run.ts stays loadable in Node (tests)
    const host = new MatterHostMain(mode, async () => new (await import('@knockon/matter/gpu')).MatterGpu(device));
    void device.lost.then(() => host.deviceLost()); // V4 rebuilds the renderer; attachMatter's onRestore moves Matter over
    this.matterHost = host;
    setMatterHost(host);
    return { matter: { channel: host.channel, capacity }, transfer: [host.channel.port] };
  }

  private stopMatter(): void {
    // UIFIX (D122): not destroyed here. The worker may be mid-tick, waiting on a Matter result: destroying the host under
    // it made that wait throw "the GPU host stopped (device lost?)" on every Stop. The worker's link says 'destroy' when
    // its machine goes (on the stop that follows), which destroys the host; the timer is the backstop for a dead worker.
    const h = this.matterHost;
    if (h) setTimeout(() => h.destroy(), MATTER_RELEASE_MS);
    this.matterHost = null;
    setMatterHost(null);
    this.fill = new Float32Array(0);
    this.matterCounts = new Int32Array(0);
    this.matterMode = null;
  }

  // ---- G3 (M3): hitstop and auto slow-mo (GAME_SPEC §13, contract 3: wall clock only) ----------------------
  // The sim never sees these: the worker keeps baking ticks exactly as before, and only the test system's
  // playback play-state is shifted (a local `play` message to the worker, never sent to the host). After the
  // warp, a shared run catches up to the shared playhead at 1.5× so both partners see the same tick again;
  // a solo preview just rebases its own playhead.

  /** This machine's playback pace relative to the shared playhead (0 hitstop, 0.25 slow-mo, 1.5 catching up). */
  warpFactor = 1;
  private sharedPlay: PlayState | null = null;
  private localPlay: PlayState | null = null;
  private warpEnd = 0;
  private warpNext: { factor: number; seconds: number } | null = null;

  private playTick(p: PlayState, at: number): number {
    return p.paused ? p.tick : p.tick + ((at - p.at) * this.tickRate * p.speed) / 1000;
  }

  /** Slows (factor < 1) or freezes (0) local playback for `seconds` of wall time. A stronger warp replaces a
   * weaker one; an equal or weaker one only extends it. */
  warp(factor: number, seconds: number): void {
    if (this.capture) { this.capture.warp?.(factor, seconds); return; } // C4: the capture clock plays warps in clip time
    const sp = this.sharedPlay;
    if (this.phase !== 'running' || !sp || sp.paused || seconds <= 0) return;
    const now = performance.now();
    if (now < this.warpEnd && this.warpFactor < 1) {
      // same strength: extend; weaker (slow-mo arriving during a hitstop): runs when this one ends
      if (factor === this.warpFactor) { this.warpEnd = Math.max(this.warpEnd, now + seconds * 1000); return; }
      if (factor > this.warpFactor) { this.warpNext = { factor, seconds }; return; }
    }
    const at = performance.timeOrigin + now;
    this.localPlay = { tick: this.playTick(this.localPlay ?? sp, at), speed: sp.speed * factor, paused: false, at };
    this.warpFactor = factor;
    this.warpEnd = now + seconds * 1000;
    this.worker.postMessage({ type: 'play', play: this.localPlay } satisfies ToWorker);
  }

  /** Call every frame: ends the warp, then catches up (shared run) or rebases (solo). */
  updateWarp(now: number): void {
    if (this.capture) return; // C4
    const sp = this.sharedPlay, lp = this.localPlay;
    if (!sp || !lp) { this.warpFactor = 1; return; }
    if (now < this.warpEnd) return;
    if (this.warpNext) { const n = this.warpNext; this.warpNext = null; this.warpFactor = 1; this.warp(n.factor, n.seconds); return; }
    const at = performance.timeOrigin + now;
    const lt = this.playTick(lp, at), st = this.playTick(sp, at);
    const done = (p: PlayState): void => {
      this.localPlay = null;
      this.warpFactor = 1;
      this.worker.postMessage({ type: 'play', play: p } satisfies ToWorker);
    };
    if (this.solo) { this.sharedPlay = { ...sp, tick: lt, at }; done(this.sharedPlay); return; }
    if (sp.paused || lt >= st - 0.25) { done(sp); return; }
    if (this.warpFactor !== 1.5) {
      this.localPlay = { tick: lt, speed: sp.speed * 1.5, paused: false, at };
      this.warpFactor = 1.5;
      this.worker.postMessage({ type: 'play', play: this.localPlay } satisfies ToWorker);
    }
  }

  private abs(serverTime: number): number { return performance.timeOrigin + (serverTime - this.net.clock.offset); }

  /** Space: LET IT RIP in build, cancel during the countdown, pause/resume while running. */
  primary(): void {
    if (this.phase === 'build') this.net.send(['run.request', {}]);
    else if (this.phase === 'countdown' && this.runId) this.net.send(['run.cancel', { runId: this.runId }]);
    else if (this.phase === 'running') this.setPlay({ paused: !this.paused });
  }

  /** Shift+Space: run only here, on a snapshot of the world (MULTIPLAYER §7.5). */
  soloPreview(): void {
    if (this.phase !== 'build' || !this.net.store) return;
    this.solo = true;
    this.runId = `solo-${Date.now().toString(36)}`;
    this.log.length = 0;
    this.speed = 1;
    const doc = this.net.store.doc;
    this.tell({
      type: 'start', runId: this.runId, parts: [...doc.parts.values()], links: [...doc.links.values()], gravity: doc.env.gravity, air: doc.env.air, preset: doc.env.preset, environment: doc.env.environment, seed: worldSeed(this.net.worldId),
      tickRate: 120, play: { tick: 0, speed: 1, paused: false, at: performance.timeOrigin + performance.now() + 300 }, terrain: doc.activeTerrain(), // S3: Backlot
      simFlags: doc.simFlags, sinkFill: doc.env.sinkFill === true, zones: doc.env.zones !== false, wind: doc.env.wind ?? null, // MI (M4): sim flags, D98's sink fill; W5 (M5): zero-g zones, wind
      ...(this.joltThreads !== undefined ? { joltThreads: this.joltThreads } : {}), // U5 (M5): Settings › Performance
    });
    this.toast('Solo preview: only you see this run. Backspace stops.');
  }

  /** Backspace: stop and return to build (perfect reset: the doc was never touched). */
  stop(): void {
    if (this.solo) { this.reset(); this.toast('Back to building.'); return; }
    if (this.runId && this.phase !== 'build') this.net.send(['run.stop', { runId: this.runId }]);
  }

  /** Shared playhead change: pause, speed, step, scrub (MULTIPLAYER §7.2). */
  /**
   * `ahead` (UIFIX, D122): a tick past the bake head is kept (the Cascade Report's chain steps): the worker shows the
   * newest baked frame and bakes on until it gets there (as a capture's seek does). Otherwise it's clamped to the bake.
   */
  setPlay(change: { tick?: number; speed?: number; paused?: boolean }, ahead = false): void {
    if (this.phase !== 'running' || !this.runId) return;
    const tick = Math.max(0, ahead ? change.tick ?? this.tick : Math.min(change.tick ?? this.tick, this.baked));
    const speed = change.speed ?? this.speed, paused = change.paused ?? this.paused;
    if (this.solo) { this.applyPlay({ tick, speed, paused, at: performance.timeOrigin + performance.now() }); return; }
    this.net.send(['play', { runId: this.runId, tick, speed, paused }]);
  }

  step(dir: 1 | -1): void { this.setPlay({ paused: true, tick: Math.round(this.tick) + dir * 4 }); }
  jump(seconds: number): void { this.setPlay({ tick: this.tick + seconds * this.tickRate }); }
  faster(dir: 1 | -1): void {
    const i = SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]);
    this.setPlay({ speed: SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + dir))]! });
  }

  private applyPlay(p: PlayState): void {
    this.paused = p.paused;
    this.speed = p.speed;
    this.sharedPlay = p; // G3: a shared play change ends any local warp
    this.localPlay = null;
    this.warpFactor = 1;
    this.warpEnd = 0;
    this.warpNext = null;
    if (this.capture) return; // C4: remembered; applied when the capture ends
    this.tell({ type: 'play', play: p });
  }

  // ---- C4 (M4): the capture clock (RENDERING §13, contract 5) ----------------------------------------------
  // An offline render (or photo mode) drives the test system's playback by tick: playback is held locally, shared play
  // changes are remembered and applied when it ends, hitstop / slow-mo go to the capture's own clip-time clock, and
  // our own bake head (not the partner's) bounds how far it may look. The partner never sees any of it.

  private capture: { warp?: (factor: number, seconds: number) => void; seek: { tick: number; done: (ok: boolean) => void } | null; resumeTick: number } | null = null;
  /** The host's last bakedMin (restored when a capture ends). */
  private hostBakedMin = Infinity;

  /** Is playback held by a capture? */
  get capturing(): boolean { return this.capture !== null; }

  /** Holds local playback at the current tick for a capture. False when there's no run or a Bake & Watch is baking. */
  captureBegin(opts: { warp?: (factor: number, seconds: number) => void } = {}): boolean {
    if (this.phase !== 'running' || !this.runId || this.capture || this.bake) return false;
    this.capture = { ...(opts.warp ? { warp: opts.warp } : {}), seek: null, resumeTick: this.tick };
    this.localPlay = null;
    this.warpFactor = 1;
    this.warpEnd = 0;
    this.warpNext = null;
    this.worker.postMessage({ type: 'bakedMin', tick: Number.MAX_SAFE_INTEGER } satisfies ToWorker);
    this.worker.postMessage({ type: 'play', play: { tick: this.tick, speed: 1, paused: true, at: performance.timeOrigin + performance.now() } } satisfies ToWorker);
    return true;
  }

  /**
   * Moves the held playhead to `tick` (fractional) and resolves once the worker has sent that exact frame (the sim
   * bakes ahead of a held playhead on its own). Resolves false if the capture or the run ended first.
   */
  captureSeek(tick: number): Promise<boolean> {
    const c = this.capture;
    if (!c || this.phase !== 'running') return Promise.resolve(false);
    c.seek?.done(false);
    return new Promise((resolve) => {
      c.seek = { tick, done: resolve };
      this.worker.postMessage({ type: 'play', play: { tick, speed: 1, paused: true, at: performance.timeOrigin + performance.now() } } satisfies ToWorker);
    });
  }

  /** Releases playback: back to the shared playhead (or, solo, where it was), the partner's bake head bounding it again. */
  captureEnd(): void {
    const c = this.capture;
    if (!c) return;
    c.seek?.done(false);
    this.capture = null;
    if (this.phase !== 'running') return;
    this.worker.postMessage({ type: 'bakedMin', tick: this.hostBakedMin } satisfies ToWorker);
    const sp = this.sharedPlay;
    if (sp) {
      // solo: carry on from where the capture began; shared: rejoin the shared playhead (paused or playing)
      const p: PlayState = this.solo ? { ...sp, tick: c.resumeTick, at: performance.timeOrigin + performance.now() } : sp;
      this.sharedPlay = p;
      this.worker.postMessage({ type: 'play', play: p } satisfies ToWorker);
    }
  }

  /** Hand-of-God (MULTIPLAYER §7.3): scheduled a little ahead so the partner gets it in time. */
  poke(partId: number, kind: 'impulse' | 'drag' | 'release', data: number[]): void {
    if (this.phase !== 'running' || !this.runId) return;
    const tick = Math.floor(this.tick) + (this.solo ? 2 : this.net.clock.inputDelayTicks(this.tickRate));
    if (this.solo) { this.tell({ type: 'poke', poke: { tick, seq: ++this.soloSeq, partId, kind, data } }); return; }
    this.net.send(['poke', { runId: this.runId, tick, partId, kind, data }]);
  }

  private onMsg([type, m]: RunMsg): void {
    if (this.solo) return; // a solo preview ignores the shared run
    switch (type) {
      case 'run.countdown': {
        this.phase = 'countdown';
        this.runId = m.runId;
        this.startsAt = m.startsAt;
        const serverNow = performance.now() + this.net.clock.offset;
        this.countdownEndsAt = performance.now() + Math.max(0, m.startsAt - serverNow);
        return;
      }
      case 'run.resume': {
        // joined mid-run: same snapshot, same start time, same pokes → the same run; the worker
        // bakes up to the shared playhead at full speed and playback joins in
        this.runId = m.runId;
        this.startsAt = m.startsAt;
        if (m.phase === 'countdown') {
          this.phase = 'countdown';
          const serverNow = performance.now() + this.net.clock.offset;
          this.countdownEndsAt = performance.now() + Math.max(0, m.startsAt - serverNow);
          return;
        }
        // tick 0 is a server time: wait until the clock offset is measured before placing it
        const go = (): void => {
          if (this.runId !== m.runId) return;
          if (!this.net.clock.ready) { setTimeout(go, 100); return; }
          this.onMsg(['run.start', { runId: m.runId, worldSeq: m.worldSeq }]);
          for (const pk of m.pokes) this.tell({ type: 'poke', poke: { tick: pk.tick, seq: pk.seq, partId: pk.partId, kind: pk.kind, data: pk.data } });
          this.toast('Rejoined the run in progress');
        };
        go();
        return;
      }
      case 'run.start': {
        if (m.runId !== this.runId || !this.net.store) return;
        // the confirmed world (run.start's worldSeq), not our optimistic one: an edit still in flight
        // would put a part in our machine that our partner's doesn't have
        const doc = this.net.store.confirmed();
        this.log.length = 0;
        this.speed = 1;
        // tick 0 happens at the server's startsAt on both machines (clock offset, MULTIPLAYER §7.2)
        this.tell({
          type: 'start', runId: m.runId, parts: doc.parts, links: doc.links, gravity: doc.env.gravity, air: doc.env.air, preset: doc.env.preset, environment: doc.env.environment, seed: worldSeed(this.net.worldId),
          tickRate: 120, play: { tick: 0, speed: 1, paused: false, at: this.abs(this.startsAt) }, terrain: doc.terrain, // S3: Backlot
          simFlags: doc.simFlags, sinkFill: doc.env.sinkFill === true, zones: doc.env.zones !== false, wind: doc.env.wind ?? null, // MI (M4): sim flags, D98's sink fill; W5 (M5): zero-g zones, wind
          ...(this.joltThreads !== undefined ? { joltThreads: this.joltThreads } : {}), // U5 (M5): Settings › Performance
        });
        return;
      }
      case 'run.cancel':
      case 'run.stop':
        this.reset();
        if (type === 'run.stop') this.toast(m.by === this.net.me?.slot ? 'Stopped. Back to building.' : `${this.who(m.by)} stopped the run`);
        return;
      case 'play':
        if (m.runId !== this.runId) return;
        if (m.paused !== this.paused) this.toast(`${this.who(m.by)} ${m.paused ? 'paused' : 'resumed'}`);
        else if (m.speed !== this.speed) this.toast(`${this.who(m.by)}: ${m.speed}×`);
        this.applyPlay({ tick: m.tick, speed: m.speed, paused: m.paused, at: this.abs(m.atServerTime) });
        return;
      case 'bakedMin':
        if (m.runId !== this.runId) return;
        this.hostBakedMin = m.tick; // C4: held back while a capture looks past the partner's bake head
        if (!this.capture) this.tell({ type: 'bakedMin', tick: m.tick });
        return;
      case 'desync':
        if (m.runId !== this.runId) return;
        this.desyncs += 1;
        // the sync authority sends its checkpoint; the partner adopts it (MULTIPLAYER §7.4)
        if (this.isAuthority()) this.tell({ type: 'exportCheckpoint', tick: m.tick });
        else this.toast(`Out of sync at ${(m.tick / 120).toFixed(1)} s, re-syncing…`, 'warn');
        return;
      case 'checkpoint':
        if (m.runId !== this.runId) return;
        this.tell({ type: 'importCheckpoint', blob: m.blob }, [m.blob.buffer]);
        return;
      case 'poke':
        if (m.runId !== this.runId) return;
        this.tell({ type: 'poke', poke: { tick: m.tick, seq: m.seq, partId: m.partId, kind: m.kind, data: m.data } });
        return;
    }
  }

  private isAuthority(): boolean {
    const me = this.net.me;
    if (!me) return false;
    const others = this.net.players.filter((p) => p.slot !== me.slot);
    if (me.isHost) return true;
    return !others.some((p) => p.isHost) && others.every((p) => p.slot > me.slot);
  }

  private onWorker(m: FromWorker): void {
    if (m.type === 'error' && m.fatal) { this.simFailed(m.fatal, m.message); return; } // J5 (M5)
    if (m.type === 'error') { this.toast(`Simulation: ${m.message}`, 'error'); return; }
    if (m.runId !== this.runId) return; // stale message from a previous run
    switch (m.type) {
      case 'ready':
        this.bodies = m.bodies;
        this.partIds = m.parts;
        this.linkIds = m.links;
        if (m.joltThreads !== undefined) this.joltThreadsLive = m.joltThreads; // U5 (M5)
        this.phase = 'running';
        this.paused = false;
        this.tick = 0;
        return;
      case 'frame':
        // S3: an empty array means no body moved since the last frame: keep the one we have (no re-upload)
        if (m.transforms.length || !this.transforms.length) this.transforms = m.transforms;
        if (m.waiting && m.rate > 0) this.simRate = Math.min(1, m.rate / this.tickRate);
        else if (!m.waiting) this.simRate = 1;
        this.flags = m.flags;
        this.meters = m.meters;
        this.links = m.links;
        this.critters = m.critters;
        this.carry = m.carry;
        this.beams = m.beams;
        this.tick = m.tick;
        this.baked = m.baked;
        this.waiting = m.waiting;
        if (m.fill) this.fill = m.fill; // MI (M4)
        if (m.matterCounts) this.matterCounts = m.matterCounts; // MI (M4)
        if (m.targets) this.targets = m.targets; // U5 (M5)
        if (m.grabbers) this.grabbers = m.grabbers; // R5 (M5)
        if (m.matterWaitMs !== undefined) this.matterWaitMs = this.matterWaitMs * 0.9 + m.matterWaitMs * 0.1; // MI (M4)
        this.matterHost?.playback(m.tick); // MI (M4): the playback replica follows the playhead
        // C4: a capture's seek is done when the worker sends that exact tick (events below are delivered first)
        if (this.capture?.seek && this.capture.seek.tick === m.tick) {
          const done = this.capture.seek.done;
          this.capture.seek = null;
          if (m.events.length) {
            while (this.log.length && this.log.at(-1)!.tick > m.events[0]!.tick) this.log.pop();
            this.log.push(...m.events);
            for (const fn of this.eventListeners) fn(m.events);
          }
          done(true);
          return;
        }
        if (m.events.length) {
          // a scrub back replays events: keep the log to what's at or before the playhead
          while (this.log.length && this.log.at(-1)!.tick > m.events[0]!.tick) this.log.pop();
          this.log.push(...m.events);
          for (const fn of this.eventListeners) fn(m.events);
        }
        return;
      case 'hash':
        if (!this.solo) this.net.send(['hash', { runId: m.runId, tick: m.tick, h: m.h, ...(m.mc ? { mc: m.mc } : {}), pk: m.pk }]); // MI (M4): mc; M5: pk (desync fix)
        return;
      case 'baked':
        if (!this.solo) this.net.send(['baked', { runId: m.runId, tick: m.tick }]);
        return;
      case 'bakeProgress': {
        const b = { baked: m.baked, target: m.target, rate: m.rate, done: m.done, settled: m.settled, keyframeMB: m.keyframeMB };
        this.bake = b.done ? null : b;
        for (const fn of this.bakeListeners) fn(b);
        if (b.done && !this.capture) this.setPlay({ paused: false, speed: this.watchSpeed });
        return;
      }
      case 'checkpoint':
        this.net.send(['checkpoint', { runId: m.runId, tick: m.tick, blob: m.blob }]);
        this.toast(`Sent a re-sync point at ${(m.tick / 120).toFixed(1)} s`);
        return;
      case 'resynced':
        this.resyncs += 1;
        this.toast(`Re-synced at ${(m.tick / 120).toFixed(1)} s`);
        return;
    }
  }

  private who(slot: number): string {
    return slot === this.net.me?.slot ? 'You' : (this.net.players.find((p) => p.slot === slot)?.name ?? 'Your partner');
  }

  private reset(): void {
    if (this.capture) { this.capture.seek?.done(false); this.capture = null; } // C4
    this.stopMatter(); // MI (M4)
    this.hostBakedMin = Infinity;
    this.tell({ type: 'stop' });
    this.sharedPlay = null; // G3
    this.localPlay = null;
    this.warpFactor = 1;
    this.warpEnd = 0;
    this.warpNext = null;
    this.phase = 'build';
    this.runId = null;
    this.solo = false;
    this.paused = false;
    this.speed = 1;
    this.bodies = [];
    this.transforms = new Float32Array(0);
    this.partIds = [];
    this.flags = new Uint8Array(0);
    this.meters = new Uint8Array(0);
    this.linkIds = [];
    this.links = new Float32Array(0);
    this.critters = new Uint8Array(0);
    this.carry = new Int32Array(0);
    this.targets = new Int32Array(0); // U5 (M5)
    this.grabbers = new Float32Array(0); // R5 (M5)
    this.beams = new Float32Array(0);
    this.tick = 0;
    this.baked = 0;
    this.waiting = false;
    this.bake = null; // S3
    this.simRate = 1;
  }

  countdownLeft(now: number): number {
    return Math.max(0, Math.ceil((this.countdownEndsAt - now) / 1000));
  }
}
