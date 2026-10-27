// Synthetic Matter buffers for R4's dev page and benchmarks (M4_PLAN order 4: develop the surfaces before MX's GPU
// backend exposes view()). Same layout as the backend (types.ts): pos/vel i32 × 3 per grain in 1/65,536 m and units
// per substep, mat u32 kind | variant << 8. The motion is analytic (a compute pass evaluates each grain's path at
// the current time), so it looks alive without a solver: falling streams with splashes, sloshing water, rolling
// marbles and a sliding avalanche band. Cosmetic test data only; never used by the sim.

import { KIND_MARBLE, KIND_SAND, KIND_WATER, type MatterView, type MatterViewSource } from './types.ts';

const U = 65536;
/** Grain motion modes (params.x). */
const STATIC = 0, STREAM = 1, WAVE = 2, ROLL = 3, SLIDE = 4;

/** Growable typed arrays (a 4M-grain field would be 128 M boxed numbers as plain arrays). */
class Builder {
  n = 0;
  base = new Int32Array(3 * 1024);
  params = new Float32Array(4 * 1024);
  mat = new Uint32Array(1024);
  reserve(k: number): void {
    if (this.n + k <= this.mat.length) return;
    const cap = Math.max(this.mat.length * 2, this.n + k);
    const b = new Int32Array(cap * 3); b.set(this.base); this.base = b;
    const p = new Float32Array(cap * 4); p.set(this.params); this.params = p;
    const m = new Uint32Array(cap); m.set(this.mat); this.mat = m;
  }
}

const WGSL = /* wgsl */ `
struct SU { time: f32, dt: f32, count: u32, pad: u32 };
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read> base: array<i32>;
@group(0) @binding(2) var<storage, read> params: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> pos: array<i32>;
@group(0) @binding(4) var<storage, read_write> vel: array<i32>;

fn at(i: u32, t: f32) -> vec3f {
  let b = vec3f(f32(base[i * 3u]), f32(base[i * 3u + 1u]), f32(base[i * 3u + 2u])) / 65536.0;
  let pr = params[i];
  let mode = u32(pr.x);
  if (mode == ${STREAM}u) {
    // spout at b; pr.y phase seed, pr.z fall height to the target surface, pr.w spread (m)
    let period = sqrt(2.0 * pr.z / 9.81) * 1.6;
    let tau = fract(t / period + pr.y) * period;
    let tHit = sqrt(2.0 * pr.z / 9.81);
    let a = pr.y * 6.2831853 * 7.0;
    let jitter = vec3f(cos(a), 0.0, sin(a)) * pr.w * fract(pr.y * 13.7);
    if (tau < tHit) { return b + jitter * 0.3 + vec3f(0.0, -0.5 * 9.81 * tau * tau, 0.0); }
    // splash: thrown outward and up from the impact point, falling back
    let s = tau - tHit;
    let out = normalize(jitter + vec3f(1e-4, 0.0, 0.0));
    let sp = 0.25 + 0.6 * fract(pr.y * 31.1);
    let h = b + jitter * 0.3 + vec3f(0.0, -pr.z, 0.0) + out * sp * s + vec3f(0.0, max(0.0, 1.2 * sp * s - 4.9 * s * s), 0.0);
    return h;
  }
  if (mode == ${WAVE}u) {
    // pr.y depth fraction (0 bottom … 1 surface), pr.z phase, pr.w amplitude (m)
    let k = 18.0;
    let w = 5.0;
    let ph = b.x * k - t * w + pr.z;
    let ph2 = b.z * k * 0.7 + t * w * 0.8;
    let amp = pr.w * pr.y * pr.y;
    return b + vec3f(cos(ph) * amp * 0.4, (sin(ph) + 0.6 * sin(ph2)) * amp, cos(ph2) * amp * 0.3);
  }
  if (mode == ${ROLL}u) {
    // circle of radius pr.z around b, angular speed pr.w, phase pr.y
    let a = pr.y + t * pr.w;
    return b + vec3f(cos(a), 0.0, sin(a)) * pr.z;
  }
  if (mode == ${SLIDE}u) {
    // slide down a dune face: pr.y phase, pr.z run length (m), pr.w slope (dy per dx, along +x)
    let s = fract(t * 0.18 + pr.y) * pr.z;
    return b + vec3f(s, -s * pr.w, 0.0);
  }
  return b;
}

@compute @workgroup_size(256) fn animate(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i >= su.count) { return; }
  if (u32(params[i].x) == ${STATIC}u) { return; }
  let p = at(i, su.time);
  let q = at(i, su.time - su.dt);
  let pf = vec3i(round(p * 65536.0));
  pos[i * 3u] = pf.x; pos[i * 3u + 1u] = pf.y; pos[i * 3u + 2u] = pf.z;
  let v = (p - q) / max(su.dt, 1e-4) / 240.0 * 65536.0;
  vel[i * 3u] = i32(v.x); vel[i * 3u + 1u] = i32(v.y); vel[i * 3u + 2u] = i32(v.z);
}
`;

/** Deterministic hash → [0, 1). */
function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function push(b: Builder, p: readonly number[], mode: number, a: number, c: number, d: number, kind: number, variant = 0): void {
  b.reserve(1);
  const i = b.n++;
  b.base[i * 3] = Math.round(p[0]! * U); b.base[i * 3 + 1] = Math.round(p[1]! * U); b.base[i * 3 + 2] = Math.round(p[2]! * U);
  b.params[i * 4] = mode; b.params[i * 4 + 1] = a; b.params[i * 4 + 2] = c; b.params[i * 4 + 3] = d;
  b.mat[i] = kind | (variant << 8);
}

/** A sand cone on y = 0 (radius, height) filled on a jittered 4 mm lattice. */
function sandPile(b: Builder, cx: number, cz: number, radius: number, height: number, r: () => number): void {
  const s = 0.0041;
  for (let y = 0.002; y < height; y += s * 0.82) {
    const rr = radius * (1 - y / height);
    for (let x = -rr; x <= rr; x += s) for (let z = -rr; z <= rr; z += s) {
      if (x * x + z * z > rr * rr) continue;
      push(b, [cx + x + (r() - 0.5) * 0.0008, y + 0.00195, cz + z + (r() - 0.5) * 0.0008], STATIC, 0, 0, 0, KIND_SAND);
    }
  }
}

export type SyntheticScene = 'demo' | 'sandstorm' | 'water' | 'marbles' | 'none';

export interface SyntheticOptions {
  readonly scene: SyntheticScene;
  /** Sandstorm grain count (1M, 4M). */
  readonly grains?: number;
  /** World offset (m) of the scene (e.g. the Tinker Lab bench top). */
  readonly at?: readonly [number, number, number];
}

/** Builds the scene's grains on the CPU (once) and animates them on the GPU each frame. */
export class SyntheticMatter implements MatterViewSource {
  readonly count: number;
  readonly counts = { sand: 0, water: 0, marble: 0 };
  private readonly device: GPUDevice;
  private readonly bufs: { pos: GPUBuffer; vel: GPUBuffer; mat: GPUBuffer; base: GPUBuffer; params: GPUBuffer; su: GPUBuffer };
  private readonly pipe: GPUComputePipeline;
  private readonly bind: GPUBindGroup;
  private readonly t0 = performance.now();
  private last = 0;
  private tick = 0;
  /** Time scale (0 freezes the motion for stills). */
  speed = 1;
  private simTime = 0;
  private lastWall = performance.now();

  constructor(device: GPUDevice, opts: SyntheticOptions) {
    this.device = device;
    const b = new Builder();
    const r = rnd(1234);
    const at = opts.at ?? [0, 0, 0];
    if (opts.scene === 'demo' || opts.scene === 'water' || opts.scene === 'marbles') buildDemo(b, r, opts.scene);
    if (opts.scene === 'sandstorm') { b.reserve(opts.grains ?? 1_000_000); buildSandstorm(b, r, opts.grains ?? 1_000_000); }
    for (let i = 0; i < b.n; i++) {
      const k = b.mat[i]! & 255;
      if (k === KIND_SAND) this.counts.sand++; else if (k === KIND_WATER) this.counts.water++; else this.counts.marble++;
      b.base[i * 3]! += Math.round(at[0] * U); b.base[i * 3 + 1]! += Math.round(at[1] * U); b.base[i * 3 + 2]! += Math.round(at[2] * U);
    }
    this.count = b.n;
    const n = Math.max(1, this.count);
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const mk = (label: string, data: ArrayBufferView & { byteLength: number }): GPUBuffer => {
      const buf = device.createBuffer({ label, size: Math.max(16, data.byteLength), usage: S });
      device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength);
      return buf;
    };
    const base = b.base.subarray(0, n * 3);
    this.bufs = {
      pos: mk('synthetic.pos', base), vel: mk('synthetic.vel', new Int32Array(n * 3)), mat: mk('synthetic.mat', b.n ? b.mat.subarray(0, n) : new Uint32Array([255])),
      base: mk('synthetic.base', base), params: mk('synthetic.params', b.params.subarray(0, n * 4)),
      su: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };
    const mod = device.createShaderModule({ label: 'synthetic.matter', code: WGSL });
    this.pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'animate' } });
    this.bind = device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [this.bufs.su, this.bufs.base, this.bufs.params, this.bufs.pos, this.bufs.vel].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  /** Advances the analytic motion (call once per frame before rendering). */
  step(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastWall) / 1000) * this.speed;
    this.lastWall = now;
    this.simTime += dt;
    if (!this.count) return;
    const u = new ArrayBuffer(16);
    new Float32Array(u).set([this.simTime, Math.max(dt, 1 / 240)]);
    new Uint32Array(u)[2] = this.count;
    this.device.queue.writeBuffer(this.bufs.su, 0, u);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    const groups = Math.ceil(this.count / 256);
    pass.dispatchWorkgroups(Math.min(groups, 32768), Math.ceil(groups / 32768));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.tick++;
    this.last = now - this.t0;
  }

  view(): MatterView | null {
    if (!this.count) return null;
    return { device: this.device, pos: this.bufs.pos, vel: this.bufs.vel, mat: this.bufs.mat, count: this.count, tick: this.tick };
  }

  destroy(): void { for (const b of Object.values(this.bufs)) b.destroy(); }
}

/** Look-dev scene on the Studio floor: a sand pile with a falling stream, a water basin with a pour, marbles. */
function buildDemo(b: Builder, r: () => number, scene: SyntheticScene): void {
  if (scene === 'demo') {
    sandPile(b, -0.32, 0.02, 0.16, 0.09, r);
    // sand stream onto the pile's top from 0.4 m up
    for (let i = 0; i < 2500; i++) push(b, [-0.32, 0.48, 0.02], STREAM, r(), 0.4, 0.006, KIND_SAND);
  }
  if (scene === 'demo' || scene === 'water') {
    // water basin: 0.30 × 0.08 × 0.24 m at 1 cm spacing (≈ 5.8 L), surface sloshing; the dev page draws the tank
    const cx = scene === 'water' ? 0 : 0.28, cz = 0.02, wx = 0.30, wz = 0.24, h = 0.08, s = 0.0098;
    for (let y = 0.006; y < h; y += s) for (let x = -wx / 2 + 0.005; x < wx / 2; x += s) for (let z = -wz / 2 + 0.005; z < wz / 2; z += s) {
      push(b, [cx + x + (r() - 0.5) * 0.002, y + 0.012, cz + z + (r() - 0.5) * 0.002], WAVE, y / h, r() * 0.3, 0.006, KIND_WATER);
    }
    // a pour into the basin from 0.35 m up (splashes on the surface)
    for (let i = 0; i < 1600; i++) push(b, [cx - 0.06, 0.45, cz], STREAM, r(), 0.36, 0.008, KIND_WATER);
  }
  if (scene === 'demo' || scene === 'marbles') {
    const z0 = scene === 'marbles' ? 0 : 0.26;
    for (let i = 0; i < 220; i++) {
      const a = r() * Math.PI * 2, rr = 0.03 + Math.sqrt(r()) * 0.16;
      push(b, [Math.cos(a) * rr, 0.008, z0 + Math.sin(a) * rr * 0.5], STATIC, 0, 0, 0, KIND_MARBLE, r() < 0.25 ? 1 : 0);
    }
    for (let i = 0; i < 24; i++) push(b, [0, 0.008, z0], ROLL, r() * 6.28, 0.22 + r() * 0.04, 0.6 + r() * 0.4, KIND_MARBLE, i % 4 === 0 ? 1 : 0);
  }
}

/** "Sandstorm"-like benchmark field: dunes over a 4 × 4 m valley holding `grains` grains, a tenth sliding. */
function buildSandstorm(b: Builder, r: () => number, grains: number): void {
  const area = 4;
  const dune = (x: number, z: number): number => 0.12 + 0.1 * Math.sin(x * 2.1) * Math.cos(z * 1.7) + 0.06 * Math.sin(x * 4.3 + z * 3.1);
  // mean height ≈ 0.12 m; lattice spacing so the volume holds `grains` grains
  const s = Math.cbrt((area * area * 0.12) / grains);
  outer: for (let x = -area / 2; x < area / 2; x += s) for (let z = -area / 2; z < area / 2; z += s) {
    const h = dune(x, z);
    for (let y = s * 0.5; y < h; y += s) {
      if (b.n >= grains) break outer;
      const slide = y > h - s * 3 && r() < 0.3;
      push(b, [x + (r() - 0.5) * s * 0.3, y, z + (r() - 0.5) * s * 0.3], slide ? SLIDE : STATIC, r(), 0.25, 0.3, KIND_SAND);
    }
  }
}
