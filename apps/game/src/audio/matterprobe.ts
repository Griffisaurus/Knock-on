// M4 Matter audio probe (AUDIO.md §5: "GPU reduction per frame: count and mean speed in 3 radius bands"). Reduces
// the Matter particle buffers around the listener to 72 floats on the GPU and reads back only those 288 bytes,
// through a ring of 3 staging buffers, a frame or two late (fine for audio). Nothing big is ever read back.
//
//   pass 1  64 workgroups × 256 threads walk the grains (grid-stride, sampling every `stride`-th grain so a probe
//           touches at most ~1M grains, with the phase rotating per probe so every grain counts over time). Each
//           thread sums into a private [kind][band][8] array; a shared-memory tree reduction writes one row per
//           workgroup
//   pass 2  one workgroup adds the 64 rows
//
// Per (kind, band) the sums are: moving grains, Σ speed, Σ (x, y, z) × speed (relative to the listener), falling
// grains, every grain, Σ downward speed of the falling grains. Floats are fine here: this is audio, never sim state
// (Matter's own kernels stay integer). The CPU reference `reduceCpu()` computes the same thing for tests.
//
// Buffer layout (MX, packages/matter): pos and vel are flat array<i32>, stride 3, in units of 1/65,536 m and units
// per substep. `mat` holds the kind (0 sand, 1 water, 2 marble, 3 goo: X5, M5) in `matBits` bits per grain, packed 32/matBits per
// u32 (default 32: one u32 per grain, kind in the low 2 bits). Without `mat` every grain is sand.

/// <reference types="@webgpu/types" />

import { MATTER_HZ, SUBSTEPS, UNITS_PER_METRE } from '@knockon/matter';
import { MATTER_BANDS, MATTER_KINDS, emptyField, type MatterField } from './matter';
import type { Vec3 } from './types';

/** What the probe needs from the Matter backend's `view()` (M4 contract 1). */
export interface MatterViewLike {
  device: GPUDevice; pos: GPUBuffer; vel: GPUBuffer; mat?: GPUBuffer | null; count: number; tick?: number;
  /** Bits per grain in `mat` (32 = one u32 per grain, 8 = four per u32). Default 32. */
  matBits?: 8 | 16 | 32;
}

/** Sums per (kind, band). */
export const PROBE_VALUES = 8;
const K = MATTER_KINDS.length * MATTER_BANDS.length * PROBE_VALUES; // 72
const WGS = 64, WG = 256;
/** Grains touched per probe at most (the rest are sampled by stride). */
export const PROBE_MAX_SAMPLES = 1 << 20;
/** A grain is moving above this speed (m/s), falling below this vertical speed (m/s, downward). */
export const MOVE_MIN = 0.05, FALL_MIN = 0.3;
/** units → metres, and units per substep → m/s. */
export const POS_SCALE = 1 / UNITS_PER_METRE;
export const VEL_SCALE = (MATTER_HZ * SUBSTEPS) / UNITS_PER_METRE;

const WGSL = /* wgsl */ `
struct Params {
  listener: vec3<f32>, n: u32,
  stride: u32, phase: u32, matShift: u32, matBits: u32,
  posScale: f32, velScale: f32, moveMin: f32, fallMin: f32,
  b0: f32, b1: f32, b2: f32, hasMat: u32,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> pos: array<i32>;
@group(0) @binding(2) var<storage, read> vel: array<i32>;
@group(0) @binding(3) var<storage, read> mat: array<u32>;
@group(0) @binding(4) var<storage, read_write> rows: array<f32>;
const K: u32 = ${K}u;
const V: u32 = ${PROBE_VALUES}u;
var<workgroup> sh: array<f32, ${WG}>;

@compute @workgroup_size(${WG})
fn reduce(@builtin(local_invocation_index) lid: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  var acc: array<f32, ${K}>;
  let threads = nwg.x * ${WG}u;
  var j = wg.x * ${WG}u + lid;
  loop {
    let i = j * p.stride + p.phase;
    if (i >= p.n) { break; }
    let x = f32(pos[3u * i]) * p.posScale - p.listener.x;
    let y = f32(pos[3u * i + 1u]) * p.posScale - p.listener.y;
    let z = f32(pos[3u * i + 2u]) * p.posScale - p.listener.z;
    let d = sqrt(x * x + y * y + z * z);
    if (d < p.b2) {
      var band = 2u;
      if (d < p.b1) { band = 1u; }
      if (d < p.b0) { band = 0u; }
      var kind = 0u;
      if (p.hasMat == 1u) {
        let lane = i & ((1u << p.matShift) - 1u);
        kind = (mat[i >> p.matShift] >> (lane * p.matBits)) & 255u;
        kind = min(kind, ${MATTER_KINDS.length - 1}u); // X5 (M5): goo is kind 3
      }
      let vx = f32(vel[3u * i]) * p.velScale;
      let vy = f32(vel[3u * i + 1u]) * p.velScale;
      let vz = f32(vel[3u * i + 2u]) * p.velScale;
      let s = sqrt(vx * vx + vy * vy + vz * vz);
      let o = (kind * 3u + band) * V;
      acc[o + 6u] += 1.0;
      if (s > p.moveMin) {
        acc[o] += 1.0;
        acc[o + 1u] += s;
        acc[o + 2u] += x * s;
        acc[o + 3u] += y * s;
        acc[o + 4u] += z * s;
      }
      if (vy < -p.fallMin) {
        acc[o + 5u] += 1.0;
        acc[o + 7u] -= vy;
      }
    }
    j += threads;
  }
  for (var k = 0u; k < K; k++) {
    sh[lid] = acc[k];
    workgroupBarrier();
    var w = ${WG / 2}u;
    loop {
      if (w == 0u) { break; }
      if (lid < w) { sh[lid] += sh[lid + w]; }
      workgroupBarrier();
      w = w >> 1u;
    }
    if (lid == 0u) { rows[wg.x * K + k] = sh[0]; }
    workgroupBarrier();
  }
}
`;

const WGSL_SUM = /* wgsl */ `
const K: u32 = ${K}u;
@group(0) @binding(0) var<storage, read> rowsIn: array<f32>;
@group(0) @binding(1) var<storage, read_write> total: array<f32>;
@compute @workgroup_size(128)
fn sum(@builtin(local_invocation_index) lid: u32) {
  if (lid >= K) { return; }
  var s = 0.0;
  for (var w = 0u; w < ${WGS}u; w++) { s += rowsIn[w * K + lid]; }
  total[lid] = s;
}
`;

/** Turn the 72 sums into a MatterField (stride-scaled counts, means, world centroids). */
export function toField(sums: ArrayLike<number>, listener: Vec3, scale: number): MatterField {
  const f = emptyField();
  for (let k = 0; k < MATTER_KINDS.length; k++) {
    for (let b = 0; b < MATTER_BANDS.length; b++) {
      const o = (k * MATTER_BANDS.length + b) * PROBE_VALUES;
      const m = sums[o]!, ss = sums[o + 1]!, fall = sums[o + 5]!;
      const band = f.bands[k]![b]!;
      band.moving = m * scale;
      band.speed = m > 0 ? ss / m : 0;
      band.cx = listener[0] + (ss > 0 ? sums[o + 2]! / ss : 0);
      band.cy = listener[1] + (ss > 0 ? sums[o + 3]! / ss : 0);
      band.cz = listener[2] + (ss > 0 ? sums[o + 4]! / ss : 0);
      band.falling = fall * scale;
      band.fallSpeed = fall > 0 ? sums[o + 7]! / fall : 0;
      band.total = sums[o + 6]! * scale;
    }
  }
  return f;
}

/** Sampling stride for a grain count (≥ 1, so a probe touches at most PROBE_MAX_SAMPLES grains). */
export const strideFor = (count: number): number => Math.max(1, Math.ceil(count / PROBE_MAX_SAMPLES));

/**
 * CPU reference of the GPU reduction (tests, and a Node/CPU-backend fallback when the positions are on the
 * CPU). `kind(i)` returns 0–3 (3 goo, X5). Returns the raw sums (kinds × bands × 8, unscaled), in the same order as the GPU.
 */
export function reduceCpu(pos: Int32Array, vel: Int32Array, kind: ((i: number) => number) | null, count: number, listener: Vec3, stride = 1, phase = 0): Float64Array {
  const acc = new Float64Array(K);
  const [b0, b1, b2] = MATTER_BANDS;
  for (let i = phase; i < count; i += stride) {
    const x = pos[3 * i]! * POS_SCALE - listener[0], y = pos[3 * i + 1]! * POS_SCALE - listener[1], z = pos[3 * i + 2]! * POS_SCALE - listener[2];
    const d = Math.sqrt(x * x + y * y + z * z);
    if (!(d < b2)) continue;
    const band = d < b0 ? 0 : d < b1 ? 1 : 2;
    const k = kind ? Math.min(MATTER_KINDS.length - 1, kind(i) & 255) : 0;
    const vx = vel[3 * i]! * VEL_SCALE, vy = vel[3 * i + 1]! * VEL_SCALE, vz = vel[3 * i + 2]! * VEL_SCALE;
    const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const o = (k * 3 + band) * PROBE_VALUES;
    const add = (j: number, v: number): void => { acc[o + j] = acc[o + j]! + v; };
    add(6, 1);
    if (s > MOVE_MIN) { add(0, 1); add(1, s); add(2, x * s); add(3, y * s); add(4, z * s); }
    if (vy < -FALL_MIN) { add(5, 1); add(7, -vy); }
  }
  return acc;
}

interface Slot { buf: GPUBuffer; busy: boolean; listener: Vec3; scale: number; t0: number }

export class MatterProbe {
  private pipeReduce: GPUComputePipeline | null = null;
  private pipeSum: GPUComputePipeline | null = null;
  private uniform: GPUBuffer | null = null;
  private rows: GPUBuffer | null = null;
  private total: GPUBuffer | null = null;
  private dummyMat: GPUBuffer | null = null;
  private slots: Slot[] = [];
  /** Bind group for pass 1 and the buffers it was made for (the backend may reallocate them). */
  private bind1: { pos: GPUBuffer; vel: GPUBuffer; mat: GPUBuffer; g: GPUBindGroup } | null = null;
  private bind2: GPUBindGroup | null = null;
  private latest: MatterField | null = null;
  /** Beta (D127): resolves when the newest request's reduction is in (`poll()` then returns it). */
  pending: Promise<void> | null = null;
  private phase = 0;
  private dead = false;
  private readonly params = new ArrayBuffer(64);
  readonly stats = { probes: 0, results: 0, skipped: 0, stride: 1, phase: 0, sampled: 0, lastMs: 0, maxMs: 0, errors: 0, gpuMs: -1 };
  /** GPU timestamps around the two passes, when the device has 'timestamp-query' (measured cost, not queueing). */
  private query: GPUQuerySet | null = null;
  private resolve: GPUBuffer | null = null;

  constructor(readonly device: GPUDevice) {
    try {
      const module = device.createShaderModule({ label: 'audio:matterprobe:reduce', code: WGSL });
      const moduleSum = device.createShaderModule({ label: 'audio:matterprobe:sum', code: WGSL_SUM });
      this.pipeReduce = device.createComputePipeline({ label: 'audio:matterprobe:reduce', layout: 'auto', compute: { module, entryPoint: 'reduce' } });
      this.pipeSum = device.createComputePipeline({ label: 'audio:matterprobe:sum', layout: 'auto', compute: { module: moduleSum, entryPoint: 'sum' } });
      this.uniform = device.createBuffer({ label: 'audio:matterprobe:params', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.rows = device.createBuffer({ label: 'audio:matterprobe:rows', size: WGS * K * 4, usage: GPUBufferUsage.STORAGE });
      this.total = device.createBuffer({ label: 'audio:matterprobe:total', size: K * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      if (device.features.has('timestamp-query')) {
        this.query = device.createQuerySet({ type: 'timestamp', count: 2 });
        this.resolve = device.createBuffer({ label: 'audio:matterprobe:ts', size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      }
      this.dummyMat = device.createBuffer({ label: 'audio:matterprobe:nomat', size: 16, usage: GPUBufferUsage.STORAGE });
      for (let i = 0; i < 3; i++) this.slots.push({ buf: device.createBuffer({ label: `audio:matterprobe:read${i}`, size: K * 4 + 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, listener: [0, 0, 0], scale: 1, t0: 0 });
      this.bind2 = device.createBindGroup({ layout: this.pipeSum.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.rows } }, { binding: 1, resource: { buffer: this.total } }] });
    } catch (err) {
      this.fail(err);
    }
  }

  get ok(): boolean { return !this.dead; }

  private fail(err: unknown): void {
    this.stats.errors++;
    if (!this.dead) console.warn('[audio] Matter probe disabled', err);
    this.dead = true;
  }

  /** Encode and submit one probe around `listener`. Returns false when it couldn't (no free readback slot, no grains, dead). */
  request(view: MatterViewLike, listener: Vec3): boolean {
    if (this.dead || !this.pipeReduce || !this.pipeSum || !this.uniform || !this.rows || !this.total || !this.bind2) return false;
    if (view.device !== this.device) return false;
    const n = Math.max(0, Math.floor(view.count || 0));
    if (n === 0) { this.latest = emptyField(); return false; }
    const slot = this.slots.find((s) => !s.busy);
    if (!slot) { this.stats.skipped++; return false; }
    try {
      const stride = strideFor(n);
      this.phase = (this.phase + 1) % stride;
      const bits = view.matBits ?? 32;
      const dv = new DataView(this.params);
      dv.setFloat32(0, listener[0], true); dv.setFloat32(4, listener[1], true); dv.setFloat32(8, listener[2], true); dv.setUint32(12, n, true);
      dv.setUint32(16, stride, true); dv.setUint32(20, this.phase, true); dv.setUint32(24, Math.log2(32 / bits), true); dv.setUint32(28, bits, true);
      dv.setFloat32(32, POS_SCALE, true); dv.setFloat32(36, VEL_SCALE, true); dv.setFloat32(40, MOVE_MIN, true); dv.setFloat32(44, FALL_MIN, true);
      dv.setFloat32(48, MATTER_BANDS[0], true); dv.setFloat32(52, MATTER_BANDS[1], true); dv.setFloat32(56, MATTER_BANDS[2], true); dv.setUint32(60, view.mat ? 1 : 0, true);
      this.device.queue.writeBuffer(this.uniform, 0, this.params);
      const mat = view.mat ?? this.dummyMat!;
      if (!this.bind1 || this.bind1.pos !== view.pos || this.bind1.vel !== view.vel || this.bind1.mat !== mat) {
        this.bind1 = {
          pos: view.pos, vel: view.vel, mat, g: this.device.createBindGroup({
            layout: this.pipeReduce.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: view.pos } }, { binding: 2, resource: { buffer: view.vel } },
              { binding: 3, resource: { buffer: mat } }, { binding: 4, resource: { buffer: this.rows } }],
          }),
        };
      }
      const enc = this.device.createCommandEncoder({ label: 'audio:matterprobe' });
      const pass = enc.beginComputePass(this.query ? { label: 'audio:matterprobe', timestampWrites: { querySet: this.query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : { label: 'audio:matterprobe' });
      pass.setPipeline(this.pipeReduce); pass.setBindGroup(0, this.bind1.g); pass.dispatchWorkgroups(WGS);
      pass.setPipeline(this.pipeSum); pass.setBindGroup(0, this.bind2); pass.dispatchWorkgroups(1);
      pass.end();
      enc.copyBufferToBuffer(this.total, 0, slot.buf, 0, K * 4);
      if (this.query && this.resolve) { enc.resolveQuerySet(this.query, 0, 2, this.resolve, 0); enc.copyBufferToBuffer(this.resolve, 0, slot.buf, K * 4, 16); }
      this.device.queue.submit([enc.finish()]);
      slot.busy = true; slot.listener = [listener[0], listener[1], listener[2]]; slot.scale = stride; slot.t0 = performance.now();
      this.stats.probes++; this.stats.stride = stride; this.stats.phase = this.phase; this.stats.sampled = Math.ceil(n / stride);
      const done = slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const raw = slot.buf.getMappedRange().slice(0);
        const sums = new Float32Array(raw, 0, K);
        if (this.query) { const ts = new BigUint64Array(raw, K * 4, 2); const ns = Number(ts[1]! - ts[0]!); if (ns > 0 && ns < 1e9) this.stats.gpuMs = ns / 1e6; }
        slot.buf.unmap();
        slot.busy = false;
        this.latest = toField(sums, slot.listener, slot.scale);
        const ms = performance.now() - slot.t0;
        this.stats.results++; this.stats.lastMs = ms; if (ms > this.stats.maxMs) this.stats.maxMs = ms;
      }, (err: unknown) => { slot.busy = false; this.fail(err); });
      this.pending = done; // beta (D127): clips wait for it (GameAudio.clipSettle)
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  /** The newest completed reduction (once), or null. */
  poll(): MatterField | null { const f = this.latest; this.latest = null; return f; }

  destroy(): void {
    this.dead = true;
    for (const b of [this.uniform, this.rows, this.total, this.dummyMat, this.resolve]) b?.destroy();
    this.query?.destroy();
    for (const s of this.slots) if (!s.busy) s.buf.destroy();
  }
}
