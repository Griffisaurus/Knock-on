// gpu-core (RENDERING §2): device with the adapter's max limits and the optional features we use,
// plus per-pass GPU timing from timestamp queries for the Perf HUD.

export interface GpuContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly features: ReadonlySet<string>;
  readonly description: string;
}

const LIMITS = [
  'maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage',
  'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupsPerDimension',
  // M3: the look's group 2 plus G3's GI group 3 put 17 sampled textures in the glass fragment stage (default 16)
  'maxSampledTexturesPerShaderStage',
] as const;
// M4 (V4): texture-compression-bc for the BC7 texture-set arrays (look/textures.ts; RENDERING §2)
const FEATURES = ['timestamp-query', 'shader-f16', 'indirect-first-instance', 'float32-filterable', 'rg11b10ufloat-renderable', 'dual-source-blending', 'texture-compression-bc'] as const;

export async function createGpu(): Promise<GpuContext> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const requiredFeatures = FEATURES.filter((f) => adapter.features.has(f)) as GPUFeatureName[];
  const requiredLimits: Record<string, number> = {};
  for (const k of LIMITS) requiredLimits[k] = adapter.limits[k];
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  const info = adapter.info;
  return {
    adapter, device, features: new Set(requiredFeatures),
    description: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' · ') || 'unknown GPU',
  };
}

// ---- GPU timing (G5, M5) -------------------------------------------------------------------------------------
//
// Each timed pass gets a begin / end timestamp pair. Two things made the old sums wrong (M5_NOTES_G5):
//  1. A slot is handed out when a caller *asks* for timestamp writes, but some callers then skip the pass (the
//     shadowed practical with no shadowed lamp, the volumetric march with no live grid, DOF before its targets
//     exist). Resolving a slot that no pass wrote this frame returns whatever an earlier frame left in it: D3D12
//     keeps the query heap, and Dawn only zero-fills slots that were never written at all. When Matter's
//     `matter.prep` pass shifted every later slot by one, `look.spot`'s unwritten slot held the previous
//     layout's `main` pass: 5–14 ms of phantom time.
//  2. The per-name map never forgot a name, so `total()` summed passes that no longer ran.
// Now every frame resolves into its own query region (one per readback buffer, so at most 3 frames in flight). A
// region is reused only after its previous frame was read back, so every stale value in it is ≤ that frame's
// largest timestamp: a pair is this frame's only when it's newer than that floor (`attributeFrame`). Names not
// seen for `STALE_FRAMES` resolved frames drop out, and `total()` sums only the passes of the last resolved frame.

/** Resolved frames a pass name may go unseen before it's dropped from `ms`. */
export const STALE_FRAMES = 30;

/** One resolved frame: the passes that really ran (ms each, repeats summed) and the frame's GPU span. */
export interface FrameTimes {
  readonly passes: ReadonlyMap<string, number>;
  /** First pass begin → last pass end (ms): the frame's GPU time, untimed work between passes included. */
  readonly spanMs: number;
  /** The largest timestamp in the region (written this frame or before): the region's next floor. */
  readonly maxT: bigint;
}

/**
 * Pure: attributes a frame's resolved timestamp pairs (`t[2k]`, `t[2k + 1]` for `names[k]`, ns) to its passes. A
 * pair counts only when both stamps are newer than `floor` (the region's largest timestamp before this frame)
 * and the pass is shorter than 1 s; anything else is a slot no pass wrote this frame.
 */
export function attributeFrame(names: readonly string[], t: ArrayLike<bigint>, floor: bigint): FrameTimes {
  const passes = new Map<string, number>();
  let lo: bigint | null = null, hi: bigint | null = null, maxT = floor;
  names.forEach((name, k) => {
    const b = t[k * 2], e = t[k * 2 + 1];
    if (b === undefined || e === undefined) return;
    if (b > maxT) maxT = b;
    if (e > maxT) maxT = e;
    if (b <= floor || e < b || e - b >= 1_000_000_000n) return;
    passes.set(name, (passes.get(name) ?? 0) + Number(e - b) / 1e6);
    if (lo === null || b < lo) lo = b;
    if (hi === null || e > hi) hi = e;
  });
  return { passes, spanMs: lo !== null && hi !== null ? Number((hi as bigint) - (lo as bigint)) / 1e6 : 0, maxT };
}

/** Pure bookkeeping behind `GpuTimer`: smoothed ms per pass, expiry of names that stopped running, the frame span. */
export class PassTimes {
  /** Smoothed ms per pass name (EMA 0.9 / 0.1); names unseen for `STALE_FRAMES` frames are removed. */
  readonly ms = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private frameNo = 0;
  private span = 0;
  private liveNames: readonly string[] = [];

  /** Adds one resolved frame. */
  add(f: FrameTimes): void {
    if (!f.passes.size) return; // nothing of this frame was written (or it was all stale): no information
    this.frameNo++;
    for (const [name, v] of f.passes) {
      this.ms.set(name, (this.ms.get(name) ?? v) * 0.9 + v * 0.1);
      this.seen.set(name, this.frameNo);
    }
    this.liveNames = [...f.passes.keys()];
    this.span = this.span ? this.span * 0.9 + f.spanMs * 0.1 : f.spanMs;
    for (const [name, at] of this.seen) {
      if (this.frameNo - at > STALE_FRAMES) { this.seen.delete(name); this.ms.delete(name); }
    }
  }

  /** The passes the last resolved frame ran. */
  get live(): readonly string[] { return this.liveNames; }

  /** Sum of the smoothed ms of the last resolved frame's passes (stale names excluded). */
  total(): number {
    let s = 0;
    for (const n of this.liveNames) s += this.ms.get(n) ?? 0;
    return s;
  }

  /** Smoothed GPU frame span (first begin → last end, ms). */
  get frameMs(): number { return this.span; }
}

interface ReadSlot { buf: GPUBuffer; busy: boolean; names: string[]; region: number; floor: bigint }

/** GPU time per named pass (ms, smoothed). Disabled silently when timestamp-query is missing. */
export class GpuTimer {
  readonly enabled: boolean;
  private readonly times = new PassTimes();
  private readonly device: GPUDevice;
  private readonly max: number;
  private readonly qs: GPUQuerySet | null = null;
  private readonly resolveBuf: GPUBuffer | null = null;
  /** One per frame in flight; `region` k owns query slots [k·max·2, (k + 1)·max·2), `floor` its largest timestamp so far. */
  private readonly readBufs: ReadSlot[] = [];
  private cur: ReadSlot | null = null;
  /** The pass names requested this frame (in request order; a pass may still have skipped its slot). */
  private names: string[] = [];

  constructor(gpu: GpuContext, maxPasses = 24) {
    this.device = gpu.device;
    this.max = maxPasses;
    this.enabled = gpu.features.has('timestamp-query');
    if (!this.enabled) return;
    this.qs = this.device.createQuerySet({ type: 'timestamp', count: maxPasses * 2 * 3 });
    this.resolveBuf = this.device.createBuffer({ size: maxPasses * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  }

  /** Smoothed ms per pass name (passes unseen for `STALE_FRAMES` resolved frames drop out). */
  get ms(): ReadonlyMap<string, number> { return this.times.ms; }

  /** The passes the last resolved frame really ran. */
  get live(): readonly string[] { return this.times.live; }

  /** Starts a frame: picks a free query region, or leaves the frame untimed when 3 frames are already in flight. */
  begin(): void {
    this.names = [];
    this.cur = null;
    if (!this.qs) return;
    let slot = this.readBufs.find((r) => !r.busy);
    if (!slot && this.readBufs.length < 3) {
      slot = { buf: this.device.createBuffer({ size: this.max * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, names: [], region: this.readBufs.length, floor: 0n };
      this.readBufs.push(slot);
    }
    this.cur = slot ?? null;
  }

  /** Timestamp writes for a compute pass. Ask only when the pass will be encoded (an unused slot is wasted). */
  compute(name: string): GPUComputePassTimestampWrites | undefined {
    return this.writes(name);
  }

  /** Timestamp writes for a render pass. Ask only when the pass will be encoded (an unused slot is wasted). */
  render(name: string): GPURenderPassTimestampWrites | undefined {
    return this.writes(name);
  }

  private writes(name: string): { querySet: GPUQuerySet; beginningOfPassWriteIndex: number; endOfPassWriteIndex: number } | undefined {
    if (!this.qs || !this.cur || this.names.length >= this.max) return undefined;
    const i = this.cur.region * this.max * 2 + this.names.length * 2;
    this.names.push(name);
    return { querySet: this.qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }

  /** Call after the last timed pass, before finishing the encoder. */
  resolve(enc: GPUCommandEncoder): void {
    const s = this.cur;
    this.cur = null;
    if (!this.qs || !this.resolveBuf || !s || !this.names.length) return;
    const n = this.names.length, base = s.region * this.max * 2;
    // one shared resolve buffer: each frame's resolve → copy runs in order on the queue before the next frame's
    enc.resolveQuerySet(this.qs, base, n * 2, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, s.buf, 0, n * 16);
    s.names = this.names;
    s.busy = true;
    queueMicrotask(() => {
      void s.buf.mapAsync(GPUMapMode.READ).then(() => {
        const f = attributeFrame(s.names, new BigUint64Array(s.buf.getMappedRange(0, s.names.length * 16)), s.floor);
        s.floor = f.maxT;
        s.buf.unmap();
        s.busy = false;
        this.times.add(f);
      }).catch(() => { s.busy = false; });
    });
  }

  /** Sum of the smoothed times of the passes the last resolved frame ran (ms). */
  total(): number { return this.times.total(); }

  /**
   * The GPU frame time (ms, smoothed): first timed pass begin → last timed pass end of each frame, so the untimed
   * work between passes (copies, resolves, barriers) counts too. What the governors read (RENDERING §11).
   */
  get frameMs(): number { return this.times.frameMs; }
}
