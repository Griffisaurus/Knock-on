// VRAM management (RENDERING §11, GAME_SPEC §15; M4 stream V4).
//
// - **Ledger:** every GPU buffer and texture created on the renderer's device is recorded by pool, with its
//   size computed from the descriptor (format, mips, layers, samples). The device's createBuffer /
//   createTexture are wrapped once (`attach`), so allocations from any module land here without edits;
//   destroy() (or garbage collection) releases them. The pool comes from the label (`gi.*`, `vol*`, `set.*`,
//   `matter*`, …), else from the innermost `scope(pool, fn)`, else render targets / other.
//   Code that allocates elsewhere (or wants a reservation counted) uses `register` / `release`.
// - **Probe:** at boot, check that the pools allocated later (Matter state + checkpoints, the bake-ahead
//   keyframe buffer) still fit inside the tier budget: allocate them as ≤ 256 MB chunks, touch every chunk
//   each step and time it. A failed allocation (out-of-memory error scope), a failed write/read check or
//   the touch bandwidth collapsing (WDDM paging to system memory: the M3 "VRAM oversubscription") stops the
//   probe; everything is freed at once. A short probe pre-steps the governor.
// - **Governor:** knobs (volume slots, GI resolution, texture size classes) register themselves with
//   discrete levels; under pressure (an out-of-memory error, a probe shortfall, device loss, frame spikes:
//   ≥ 3 frames over max(100 ms, 4 × the healthy frame) within 3 s, or a sustained slowdown: the recent median
//   over max(2.5 × healthy, healthy + 25 ms) for 1.5 s) it steps one level down a fixed
//   schedule; after 20 s without pressure it steps back up, and pins a level that brought pressure straight
//   back. It never touches Matter, the sim or anything gameplay.

export type VramPool =
  | 'targets' | 'textures' | 'meshes' | 'instances' | 'look' | 'gi' | 'volumes' | 'particles' | 'shadows'
  | 'spectacle' | 'matter' | 'keyframes' | 'probe' | 'other';

export type VramTier = 4 | 8 | 12 | 16 | 32;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** GAME_SPEC §15.2 resident budgets (D85: ≈ 22 GB on tier 32). */
export const TIER_BUDGET: Readonly<Record<VramTier, number>> = { 4: 2.8 * GB, 8: 5.5 * GB, 12: 8 * GB, 16: 10.4 * GB, 32: 22 * GB };

/**
 * Pools allocated after boot that the probe makes room for. Matter (MX / MI): the `matter` pool measured at the
 * tier's grain budget (T5 and G5, M5: the GPU backend, its playback replica (`matterhost.ts`) and the
 * MatterRenderer's draw lists; rewind checkpoints live in CPU memory) plus 5 %. Measured: 198 / 474 / 846 /
 * 1,588 / 3,042 MB at 250k / 1M / 2M / 4M / 8M grains (`MATTER_MEASURED_MB`). Keyframes: §15.1's 1.5 GB at
 * 16 GB, scaled by the resident budget (derived, not in the spec).
 */
export const MATTER_MEASURED_MB: Readonly<Record<VramTier, number>> = { 4: 198, 8: 474, 12: 846, 16: 1588, 32: 3042 };
export const RESERVE: Readonly<Record<VramTier, Partial<Record<VramPool, number>>>> = {
  4: { matter: 208 * MB, keyframes: 0.4 * GB },
  8: { matter: 498 * MB, keyframes: 0.8 * GB },
  12: { matter: 889 * MB, keyframes: 1.15 * GB },
  16: { matter: 1668 * MB, keyframes: 1.5 * GB },
  32: { matter: 3195 * MB, keyframes: 3.0 * GB },
};

// ---- texture sizes -------------------------------------------------------------------------------------

interface FormatInfo { bytes: number; block: number }

/** Bytes per texel (or per block for compressed formats) and block size. */
export function formatInfo(f: GPUTextureFormat): FormatInfo {
  if (f.startsWith('bc1') || f.startsWith('bc4')) return { bytes: 8, block: 4 };
  if (f.startsWith('bc') || f.startsWith('astc-4x4')) return { bytes: 16, block: 4 };
  if (f.startsWith('etc2-rgb8') || f.startsWith('eac-r11')) return { bytes: 8, block: 4 };
  if (f.startsWith('etc2') || f.startsWith('eac')) return { bytes: 16, block: 4 };
  if (f.startsWith('astc')) return { bytes: 16, block: 4 }; // other ASTC block sizes: approximate
  const by: Record<string, number> = {
    r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, stencil8: 1,
    r16uint: 2, r16sint: 2, r16float: 2, rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2, depth16unorm: 2,
    rgba16float: 8, rgba16uint: 8, rgba16sint: 8, rg32float: 8, rg32uint: 8, rg32sint: 8,
    rgba32float: 16, rgba32uint: 16, rgba32sint: 16, 'depth32float-stencil8': 5,
  };
  return { bytes: by[f] ?? 4, block: 1 };
}

function dims(size: GPUExtent3D): [number, number, number] {
  if (Symbol.iterator in Object(size)) {
    const a = [...(size as Iterable<number>)];
    return [a[0] ?? 1, a[1] ?? 1, a[2] ?? 1];
  }
  const s = size as GPUExtent3DDict;
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1];
}

/** Bytes a texture occupies (all mips, layers and samples; compressed formats by block). */
export function textureBytes(desc: GPUTextureDescriptor): number {
  const [w, h, d] = dims(desc.size);
  const { bytes, block } = formatInfo(desc.format);
  const mips = desc.mipLevelCount ?? 1;
  const is3d = desc.dimension === '3d';
  let total = 0;
  for (let m = 0; m < mips; m++) {
    const mw = Math.max(1, w >> m), mh = Math.max(1, h >> m), md = is3d ? Math.max(1, d >> m) : d;
    total += Math.ceil(mw / block) * Math.ceil(mh / block) * md * bytes;
  }
  return total * (desc.sampleCount ?? 1);
}

// ---- ledger --------------------------------------------------------------------------------------------

interface Entry { pool: VramPool; label: string; bytes: number; kind: 'buffer' | 'texture' | 'reserve' }

const LABEL_POOLS: readonly [RegExp, VramPool][] = [
  [/^matter|^mx\.|^mi\./i, 'matter'],
  [/^gi\./, 'gi'],
  [/^vol/, 'volumes'],
  [/shadow/i, 'shadows'],
  [/^set\.(albedo|nrmorm)|^detail$|^bc7\.|^impostor/, 'textures'],
  [/^look\./, 'look'],
  [/particle/i, 'particles'],
  [/^keyframe|^bake\./i, 'keyframes'],
  [/^vram\.probe/, 'probe'],
];

export class VramLedger {
  private readonly entries = new Map<number, Entry>();
  private nextId = 1;
  private readonly scopes: VramPool[] = [];
  private readonly registry = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry<number>((id) => this.release(id)) : null;
  private attached = new WeakSet<GPUDevice>();
  /** Bytes per pool (live). */
  readonly pools = new Map<VramPool, number>();
  total = 0;
  peak = 0;
  allocations = 0;

  /** Wraps the device's createBuffer / createTexture so every allocation is recorded (idempotent). */
  attach(device: GPUDevice): void {
    if (this.attached.has(device)) return;
    this.attached.add(device);
    const cb = device.createBuffer.bind(device);
    const ct = device.createTexture.bind(device);
    device.createBuffer = (desc: GPUBufferDescriptor): GPUBuffer => {
      const b = cb(desc);
      this.track(b, 'buffer', desc.size, desc.label ?? '', false);
      return b;
    };
    device.createTexture = (desc: GPUTextureDescriptor): GPUTexture => {
      const t = ct(desc);
      this.track(t, 'texture', textureBytes(desc), desc.label ?? '', (desc.usage & GPUTextureUsage.RENDER_ATTACHMENT) !== 0);
      return t;
    };
  }

  /** Runs `fn` with allocations attributed to `pool` (unless their label names another). */
  scope<T>(pool: VramPool, fn: () => T): T {
    this.scopes.push(pool);
    try { return fn(); } finally { this.scopes.pop(); }
  }

  /** Records memory the ledger can't see (or a reservation); returns an id for `update` / `release`. */
  register(pool: VramPool, label: string, bytes: number): number {
    const id = this.nextId++;
    this.add(id, { pool, label, bytes, kind: 'reserve' });
    return id;
  }

  update(id: number, bytes: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.bump(e.pool, bytes - e.bytes);
    e.bytes = bytes;
  }

  release(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    this.bump(e.pool, -e.bytes);
  }

  /** Drops every entry (device lost: the old device's memory is gone). */
  clear(): void {
    this.entries.clear();
    this.pools.clear();
    this.total = 0;
  }

  bytes(pool?: VramPool): number { return pool ? this.pools.get(pool) ?? 0 : this.total; }

  /** The largest allocations of a pool (debugging). */
  top(pool: VramPool | null, n = 5): { label: string; bytes: number }[] {
    return [...this.entries.values()].filter((e) => !pool || e.pool === pool).sort((a, b) => b.bytes - a.bytes).slice(0, n)
      .map((e) => ({ label: e.label || `(${e.kind})`, bytes: e.bytes }));
  }

  private classify(label: string, rt: boolean): VramPool {
    for (const [re, pool] of LABEL_POOLS) if (re.test(label)) return pool;
    const s = this.scopes[this.scopes.length - 1];
    if (s) return s;
    return rt ? 'targets' : 'other';
  }

  private track(obj: GPUBuffer | GPUTexture, kind: 'buffer' | 'texture', bytes: number, label: string, rt: boolean): void {
    const id = this.nextId++;
    this.add(id, { pool: this.classify(label, rt), label, bytes, kind });
    this.allocations++;
    this.registry?.register(obj, id, obj);
    const destroy = obj.destroy.bind(obj);
    obj.destroy = (): undefined => { this.release(id); this.registry?.unregister(obj); destroy(); return undefined; };
  }

  private add(id: number, e: Entry): void {
    this.entries.set(id, e);
    this.bump(e.pool, e.bytes);
  }

  private bump(pool: VramPool, d: number): void {
    this.pools.set(pool, (this.pools.get(pool) ?? 0) + d);
    this.total += d;
    if (this.total > this.peak) this.peak = this.total;
  }
}

// ---- probe ---------------------------------------------------------------------------------------------

export interface ProbeStep { bytes: number; ms: number; gbps: number; wall: number }
export interface ProbeResult {
  /** Bytes requested and bytes that fitted before the first failure. */
  readonly target: number;
  readonly fitted: number;
  readonly ok: boolean;
  readonly reason: 'fits' | 'oom' | 'validation' | 'readback' | 'paging' | 'timeout' | 'lost' | 'skipped';
  readonly steps: readonly ProbeStep[];
  readonly ms: number;
}

/**
 * Allocates `target` bytes as chunks, touching all chunks after each new one (clearBuffer, timed with GPU timestamps
 * when available, else on the queue)
 * and checking a write/read round trip in the newest chunk. Stops at the first out-of-memory or validation
 * error, failed round trip, or when the touch bandwidth falls under `pagingRatio` of the best seen (paging to
 * system memory). Frees everything before returning.
 */
export async function probeHeadroom(device: GPUDevice, target: number, opts: { chunk?: number; pagingRatio?: number; maxMs?: number } = {}): Promise<ProbeResult> {
  const t0 = performance.now();
  const chunk = Math.min(opts.chunk ?? 256 * MB, device.limits.maxBufferSize);
  const ratio = opts.pagingRatio ?? 0.25;
  const maxMs = opts.maxMs ?? 4000;
  const chunks: GPUBuffer[] = [];
  const steps: ProbeStep[] = [];
  const read = device.createBuffer({ label: 'vram.probe.read', size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  let reason: ProbeResult['reason'] = 'fits';
  let fitted = 0;
  let best = 0;
  const pattern = new Uint32Array(64).map((_, i) => (0x9e3779b9 * (i + 1)) >>> 0);
  let lost = false;
  void device.lost.then(() => { lost = true; });
  let slowSteps = 0;
  const tsq = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const tsRes = tsq ? device.createBuffer({ label: 'vram.probe.ts', size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const tsRead = tsq ? device.createBuffer({ label: 'vram.probe.tsread', size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  try {
    while (fitted < target) {
      const size = Math.min(chunk, target - fitted);
      device.pushErrorScope('out-of-memory');
      device.pushErrorScope('validation');
      const b = device.createBuffer({ label: `vram.probe.${chunks.length}`, size: Math.ceil(size / 256) * 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      chunks.push(b);
      // touch everything allocated so far (a working set over the budget pages on every touch), timed on the GPU
      // when the adapter can (our own frames drained first), then a write/read round trip in the newest chunk
      await device.queue.onSubmittedWorkDone();
      const enc = device.createCommandEncoder();
      if (tsq) enc.beginComputePass({ timestampWrites: { querySet: tsq, beginningOfPassWriteIndex: 0 } }).end();
      for (const c of chunks) enc.clearBuffer(c);
      if (tsq && tsRes && tsRead) {
        enc.beginComputePass({ timestampWrites: { querySet: tsq, endOfPassWriteIndex: 1 } }).end();
        enc.resolveQuerySet(tsq, 0, 2, tsRes, 0);
        enc.copyBufferToBuffer(tsRes, 0, tsRead, 0, 16);
      }
      const ts = performance.now();
      device.queue.submit([enc.finish()]);
      device.queue.writeBuffer(b, b.size - 256, pattern);
      const enc2 = device.createCommandEncoder();
      enc2.copyBufferToBuffer(b, b.size - 256, read, 0, 256);
      device.queue.submit([enc2.finish()]);
      await device.queue.onSubmittedWorkDone();
      const wall = performance.now() - ts;
      let ms = wall;
      const val = await device.popErrorScope();
      const oom = await device.popErrorScope();
      if (lost) { reason = 'lost'; break; }
      if (oom) { reason = 'oom'; break; }
      if (val) { reason = 'validation'; break; }
      await read.mapAsync(GPUMapMode.READ);
      const got = new Uint32Array(read.getMappedRange().slice(0));
      read.unmap();
      if (got.some((v, i) => v !== pattern[i])) { reason = 'readback'; break; }
      if (tsRead) {
        await tsRead.mapAsync(GPUMapMode.READ);
        const t = new BigUint64Array(tsRead.getMappedRange().slice(0));
        tsRead.unmap();
        const gpu = Number(t[1]! - t[0]!) / 1e6;
        if (gpu > 0 && gpu < 60_000) ms = gpu;
      }
      const touched = chunks.reduce((s, c) => s + c.size, 0);
      const gbps = touched / GB / Math.max(ms, 0.01) * 1000;
      steps.push({ bytes: touched, ms, gbps, wall });
      // paging: two steps in a row much slower per byte than the best on the GPU, or whose submit → done wall
      // time is long (WDDM makes evicted allocations resident between submissions: that wait isn't GPU time).
      // Other processes on a shared GPU add noise, hence the second step and the absolute floors.
      const slowStep = steps.length >= 3 && ((gbps < best * ratio && ms > 20) || wall > Math.max(150, 20 * (steps[0]?.wall ?? 1)));
      slowSteps = slowStep ? slowSteps + 1 : 0;
      best = Math.max(best, gbps);
      if (slowSteps >= 2) { reason = 'paging'; fitted -= chunk; break; }
      fitted += size;
      if (performance.now() - t0 > maxMs && fitted < target) { reason = 'timeout'; break; }
    }
  } finally {
    for (const c of chunks) c.destroy();
    read.destroy();
    tsq?.destroy(); tsRes?.destroy(); tsRead?.destroy();
  }
  fitted = Math.max(0, fitted);
  return { target, fitted, ok: reason === 'fits', reason, steps, ms: performance.now() - t0 };
}

// ---- governor ------------------------------------------------------------------------------------------

/** A subsystem's memory knob: level 0 = full; higher levels free memory (and lose quality). */
export interface VramKnob {
  readonly name: string;
  /** Labels per level (index = level). */
  readonly levels: readonly string[];
  level: number;
  set(level: number): void;
  /** Bytes this level frees compared with level 0 (estimate, for the probe's pre-step). */
  saves?(level: number): number;
}

export type PressureReason = 'oom' | 'spikes' | 'slow' | 'lost' | 'probe' | 'manual';

/** The step-down order: [knob, level]. Biggest savings with the least visible loss first. */
const SCHEDULE: readonly (readonly [string, number])[] = [
  ['volumes', 1], // fluid grid slots halved (8 → 4 on tier 32: −0.8 GB)
  ['gi', 1], // global SDF clipmap at half resolution (tier 32: 256³ → 128³, −0.3 GB)
  ['textures', 1], // the 2048² texture-set class drops to 1024² (−75 % of it)
  ['volumes', 2], // a quarter of the slots
  ['gi', 2], // GI off (consumers fall back to IBL + GTAO)
  ['volumes', 3], // no grids (blasts use the particle fallback)
];

export interface GovernorEvent { t: number; reason: PressureReason | 'restore' | 'pin'; level: number; detail?: string }

export class VramGovernor {
  enabled = true;
  readonly knobs = new Map<string, VramKnob>();
  /** Global level: the first `level` entries of the schedule (that have a registered knob) are applied. */
  level = 0;
  /** Levels below this are pinned (pressure came straight back after a step up) until `pinUntil`. */
  floor = 0;
  private pinUntil = 0;
  readonly events: GovernorEvent[] = [];
  readonly counts: Record<PressureReason, number> = { oom: 0, spikes: 0, slow: 0, lost: 0, probe: 0, manual: 0 };
  // spike detector
  private readonly window: number[] = [];
  private spikes: number[] = [];
  private lastFrame = 0;
  private quietSince = performance.now();
  private holdUntil = performance.now() + 3000; // boot: pipelines compile, pools prime
  private lastUp = -1e9;
  private lastStep = 0;
  /** Spike rule (ms): a frame over max(minMs, factor × median of the last 120). */
  spikeMinMs = 100;
  spikeFactor = 4;
  /** Sustained rule: the median of the last 30 frames over max(factor × healthy, healthy + addMs) for `sustainMs`. */
  sustainFactor = 2.5;
  sustainAddMs = 25;
  sustainMs = 1500;
  /** The healthy frame time (ms): the median while calm, followed slowly. */
  baseline = 0;
  /** The healthy GPU time of the timed passes (ms), when known. */
  gpuBase = 0;
  private slowSince = 0;
  restoreAfterMs = 20_000;
  lastSpikeMs = 0;
  probe: ProbeResult | null = null;

  /** The frame clock when frames are running (tests drive it), else wall time. */
  private clock(): number { return this.lastFrame || performance.now(); }

  register(knob: VramKnob): void {
    this.knobs.set(knob.name, knob);
    const want = this.wanted().get(knob.name) ?? 0;
    if (knob.level !== want) knob.set(want);
  }

  unregister(knob: VramKnob): void { if (this.knobs.get(knob.name) === knob) this.knobs.delete(knob.name); }

  get maxLevel(): number { return SCHEDULE.length; }

  /** Knob levels for the current global level. */
  private wanted(level = this.level): Map<string, number> {
    const m = new Map<string, number>();
    for (const [k, l] of SCHEDULE.slice(0, level)) m.set(k, Math.max(m.get(k) ?? 0, l));
    return m;
  }

  private apply(): void {
    const want = this.wanted();
    for (const k of this.knobs.values()) {
      const l = Math.min(want.get(k.name) ?? 0, k.levels.length - 1);
      if (k.level !== l) k.set(l);
    }
  }

  /** Sets the global level (0 … maxLevel); skips schedule entries whose knob isn't registered. */
  setLevel(level: number, reason: GovernorEvent['reason'], detail?: string): void {
    let l = Math.max(0, Math.min(this.maxLevel, level));
    // skip schedule entries without a registered knob, so every step changes something
    const has = (a: number, b: number): boolean => SCHEDULE.slice(a, b).some(([k]) => this.knobs.has(k));
    if (l > this.level) while (l < this.maxLevel && !has(this.level, l)) l++;
    else if (l < this.level) while (l > 0 && !has(l, this.level)) l--;
    if (l === this.level || (l > this.level && !has(this.level, l)) || (l < this.level && !has(l, this.level))) return;
    this.level = l;
    this.apply();
    this.events.push({ t: this.clock(), reason, level: l, ...(detail ? { detail } : {}) });
    if (this.events.length > 64) this.events.shift();
    this.lastStep = this.clock();
    this.holdUntil = this.clock() + 2000; // freed memory settles before the spike rule judges again
    this.spikes = [];
  }

  /** Bytes the knobs free at a global level (their own estimates). */
  savings(level: number): number {
    const want = this.wanted(level);
    let s = 0;
    for (const k of this.knobs.values()) s += k.saves?.(Math.min(want.get(k.name) ?? 0, k.levels.length - 1)) ?? 0;
    return s;
  }

  /** A pressure signal: steps down one level (rate-limited to one step a second, except device loss). */
  pressure(reason: PressureReason, detail?: string): void {
    this.counts[reason]++;
    this.quietSince = this.clock();
    if (!this.enabled) return;
    const now = this.clock();
    if (reason !== 'lost' && now - this.lastStep < 1000) return;
    // pressure right after a step up: pin the level we came from
    if (now - this.lastUp < 10_000 && this.level < this.maxLevel) {
      this.floor = this.level + 1;
      this.pinUntil = now + 120_000;
      this.events.push({ t: now, reason: 'pin', level: this.floor, detail: `pressure ${((now - this.lastUp) / 1000).toFixed(1)} s after a step up` });
    }
    this.setLevel(this.level + 1, reason, detail);
  }

  /** Pre-steps after a probe that came up short: the first level whose knobs free the shortfall. */
  applyProbe(res: ProbeResult): void {
    this.probe = res;
    if (res.ok || res.reason === 'skipped') return;
    this.counts.probe++;
    const deficit = res.target - res.fitted;
    let l = this.level + 1;
    while (l < this.maxLevel && this.savings(l) - this.savings(this.level) < deficit) l++;
    this.setLevel(l, 'probe', `${fmtBytes(deficit)} short (${res.reason})`);
  }

  /**
   * Call once per frame with performance.now() (and the GPU time of the frame's timed passes when the adapter
   * has timestamp queries): the spike / slowdown detectors and the slow restore. With GPU times, a slow frame
   * only counts when the GPU work grew with it: paging stretches the passes that touch evicted memory, while a
   * throttled presentation (an occluded window, a hidden dev pane) stretches only the interval.
   */
  frame(now: number, gpuMs?: number): void {
    const dt = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (!dt) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    if (hidden || dt > 10_000) { this.holdUntil = now + 1000; return; } // tab switches and suspensions aren't pressure
    this.window.push(dt);
    if (this.window.length > 120) this.window.shift();
    const cur = this.median(30);
    if (!this.baseline && this.window.length >= 60) this.baseline = this.median(120);
    const base = this.baseline || 16.7;
    let slow = false;
    if (now > this.holdUntil && this.window.length >= 30) {
      // spikes: single frames far over the healthy frame (paging stalls: M3 saw 200–450 ms)
      const gpuGrew = gpuMs === undefined || !this.gpuBase || gpuMs > Math.max(2, 1.5 * this.gpuBase);
      if (dt > Math.max(this.spikeMinMs, this.spikeFactor * base) && gpuGrew) {
        this.spikes.push(now);
        this.lastSpikeMs = dt;
        this.quietSince = now;
      }
      // sustained: the recent median stays far over the healthy one (paging every frame looks slow, not spiky)
      slow = cur > Math.max(this.sustainFactor * base, base + this.sustainAddMs) && (gpuMs === undefined || gpuMs > 0.25 * cur);
      if (slow) { this.slowSince ||= now; this.quietSince = now; } else this.slowSince = 0;
    }
    this.spikes = this.spikes.filter((t) => now - t < 3000);
    if (this.spikes.length >= 3) {
      this.spikes = [];
      this.pressure('spikes', `${this.lastSpikeMs.toFixed(0)} ms frames (healthy ${base.toFixed(1)} ms)`);
      return;
    }
    if (this.slowSince && now - this.slowSince > this.sustainMs) {
      this.slowSince = 0;
      this.pressure('slow', `median ${cur.toFixed(0)} ms for ${(this.sustainMs / 1000).toFixed(1)} s (healthy ${base.toFixed(1)} ms)`);
      return;
    }
    // the healthy frame follows calm stretches slowly (a heavier scene raises it; paging doesn't)
    if (this.baseline && !slow && !this.spikes.length && cur < this.baseline * 1.5) this.baseline = this.baseline * 0.995 + cur * 0.005;
    if (gpuMs !== undefined && gpuMs > 0 && !slow && !this.spikes.length) this.gpuBase = this.gpuBase ? this.gpuBase * 0.99 + Math.min(gpuMs, this.gpuBase * 1.5) * 0.01 : gpuMs;
    if (this.pinUntil && now > this.pinUntil) { this.floor = 0; this.pinUntil = 0; }
    if (this.enabled && this.level > this.floor && now - this.quietSince > this.restoreAfterMs && now - this.lastStep > this.restoreAfterMs) {
      this.lastUp = now;
      this.setLevel(this.level - 1, 'restore');
      this.quietSince = now;
    }
  }

  private median(n = 120): number {
    if (!this.window.length) return 16.7;
    const s = this.window.slice(-n).sort((a, b) => a - b);
    return s[s.length >> 1]!;
  }

  /** Active knob levels, e.g. "volumes ½ · gi ½". */
  describe(): string {
    const parts: string[] = [];
    for (const k of this.knobs.values()) if (k.level > 0) parts.push(`${k.name} ${k.levels[k.level]}`);
    return parts.join(' · ') || 'full';
  }
}

// ---- the renderer's instances (one renderer per page; modules register knobs here) ---------------------

export const vramLedger = new VramLedger();
export const vramGovernor = new VramGovernor();

const POOL_ORDER: readonly VramPool[] = ['textures', 'volumes', 'gi', 'particles', 'targets', 'shadows', 'instances', 'meshes', 'look', 'spectacle', 'matter', 'keyframes', 'other'];
const SHORT: Partial<Record<VramPool, string>> = { textures: 'tex', volumes: 'vol', particles: 'part', targets: 'rt', shadows: 'shadow', instances: 'inst', meshes: 'mesh', spectacle: 'fx' };

export function fmtBytes(b: number): string {
  return b >= GB ? `${(b / GB).toFixed(2)} GB` : b >= MB ? `${(b / MB).toFixed(0)} MB` : `${(b / 1024).toFixed(0)} KB`;
}

/** The debug readout's VRAM line (F9 / ?debug). */
export function vramSummary(tier: VramTier, extra = ''): string {
  const L = vramLedger, G = vramGovernor;
  const pools = POOL_ORDER.map((p) => [p, L.bytes(p)] as const).filter(([, b]) => b >= MB).map(([p, b]) => `${SHORT[p] ?? p} ${fmtBytes(b)}`);
  const pr = !G.probe ? '' : G.probe.reason === 'skipped' ? ' · probe off'
    : ` · probe ${G.probe.ok ? 'ok' : G.probe.reason} ${fmtBytes(G.probe.fitted)}/${fmtBytes(G.probe.target)} (${G.probe.ms.toFixed(0)} ms)`;
  const sig = Object.entries(G.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' ');
  return `VRAM ${fmtBytes(L.total)} of ${fmtBytes(TIER_BUDGET[tier])} (peak ${fmtBytes(L.peak)}): ${pools.join(' · ')}` +
    ` · governor L${G.level}${G.floor ? ` (pinned ≥ ${G.floor})` : ''} ${G.describe()}${sig ? ` · pressure ${sig}` : ''}${pr}${extra}`;
}
