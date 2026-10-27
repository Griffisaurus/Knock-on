// R5 (M5): the Future Tech effects (art/briefs/vfx.md §7, future.md / boom.md emitter rows), driven by part state.
//
//   SINGULARITY   screen-space lensing (Einstein ring, black core), photon ring, accretion disk (mesh + orbiting particles),
//                 infall streams, bodies stretched along the radius (render only), the collapse ring + one flash
//   RIFT GATES    membranes: a swirl, and on 12 GB+ a screen-space glimpse out of the partner gate; transit ripple + sparkles
//   STASIS FIELD  hex-lattice box (sweeps in from the corner nodes), the "time-stopped" look on bodies inside
//                 (shaders.ts stasisLook), particles inside freeze (particles.ts), drifting glints, shatter on release
//   TRACTOR BEAM  soft cone with travelling (pull) or standing (hold) rings, the hold ring, motes
//   HOVER PAD     underside glow, heat-shimmer column, ground ripple rings (faster under load), motes
//   FORCE WALL    hex-lattice plane that prints in from the pylons, impact ripples (cells to ≤ 80 %), fade out
//   COILGUN RING  exit ripple (ring + refraction), crawling arcs on the coils, a small exit flash
//   GRAV WELL     orb halo, a shimmer within 0.3 m, motes streaming in (attract) or out (repel), spin-up arcs
//
// Inputs (main.ts): every M5 part's pose, props, PartFlagBits and meter each frame (`frame`), and the sim events by name
// (`event`; unknown kinds are ignored). What each flag means is listed in docs/dev/M5_NOTES_R5.md. Cosmetic only.
// Budgets per tier follow vfx.md §7; Reduce flashing and Reduced motion are respected (distortion ≤ 30 %, no stretch).
// GPU: one instance buffer + a ripple buffer, a depth resolve when a warp is on screen; ledger pool 'spectacle';
// rebuilt on renderer.onRestore.

import { COILGUN, forceWallField, GRAV_WELL, HOVER, RIFT, RIFT_PAIRS, SINGULARITY, TRACTOR } from '@knockon/parts-data';
import { PartFlagBits } from '@knockon/sim';
import { hexLin } from '../../catalog.ts';
import type { V3 } from '../../math.ts';
import type { Fx } from '../fx.ts';
import { Kind, type Attractor, type StasisBox } from '../particles.ts';
import type { Renderer, RenderHook } from '../renderer.ts';
import { vramLedger } from '../vram.ts';
import { DEPTH_WGSL, FIELD_WGSL, INST_FLOATS, K, PRIM_VERTS, WARP_WGSL } from './wgsl.ts';

type Q4 = readonly [number, number, number, number];
type Tier = 4 | 8 | 12 | 16 | 32;

/** One M5 part as the renderer sees it this frame. */
export interface FuturePart {
  readonly id: number;
  readonly type: string;
  /** Current world pose of its base body (run), or its placed pose (build). */
  readonly pos: V3;
  readonly rot: Q4;
  /** The placed pose (HOVER PAD's base point). */
  readonly placed: { readonly pos: V3; readonly rot: Q4 };
  readonly props: Readonly<Record<string, number>>;
  /** PartFlagBits (run); 0 in build mode. */
  readonly flags: number;
  /** Machine.partMeters screen code (run): 0 dark, 1–21 level, 31 overload. */
  readonly meter: number;
}

export interface FutureCtx {
  readonly running: boolean;
  /** Run playhead (sim ticks) and rate: the Singularity's 6 s sequence follows the playhead (pause, scrub). */
  readonly tick: number;
  readonly tickRate: number;
  readonly reducedMotion: boolean;
  readonly reduceFlashing: boolean;
}

export const FUTURE_TYPES: ReadonlySet<string> = new Set(['rift_gate', 'grav_well', 'tractor_beam', 'hover_pad', 'force_wall', 'coilgun_ring', 'stasis_field', 'singularity']);

const TIER_INDEX: Record<Tier, number> = { 4: 0, 8: 1, 12: 2, 16: 3, 32: 4 };
const PLASMA: V3 = [1.0, 0.047, 0.42];
const PAIR_RGB: readonly V3[] = ['#FF3DAE', '#2FD6FF', '#FFB020', '#C6F432', '#2E5BFF', '#FF5B2E'].map((h) => hexLin(h) as unknown as V3);
const ON = PartFlagBits.lit;
const MAX_INST = 512;
/** St.t0 unset (a jump on the timeline can place a real start before tick 0). */
const NO_T0 = -1e12;

interface St {
  seen: number;
  on: boolean;
  /** Seconds since the last on / off edge (wall × time scale). */
  since: number;
  prevFlags: number;
  acc: number;
  acc2: number;
  ripples: { u: number; v: number; age: number; s: number }[];
  /** Rift transit ripple / Coilgun fire age (s), −1 none. */
  age: number;
  /** Singularity: the playhead tick it armed at (−1), whether its collapse fired. */
  t0: number;
  collapsed: boolean;
}

const qrot = (q: Q4, v: readonly number[]): V3 => {
  const tx = 2 * (q[1] * v[2]! - q[2] * v[1]!), ty = 2 * (q[2] * v[0]! - q[0] * v[2]!), tz = 2 * (q[0] * v[1]! - q[1] * v[0]!);
  return [v[0]! + q[3] * tx + (q[1] * tz - q[2] * ty), v[1]! + q[3] * ty + (q[2] * tx - q[0] * tz), v[2]! + q[3] * tz + (q[0] * ty - q[1] * tx)];
};
const qmul = (a: Q4, b: Q4): Q4 => [
  a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
  a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];
const ROT_Y180: Q4 = [0, 1, 0, 0];
const add = (a: readonly number[], b: readonly number[], s = 1): V3 => [a[0]! + b[0]! * s, a[1]! + b[1]! * s, a[2]! + b[2]! * s];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const scl = (a: readonly number[], s: number): V3 => [a[0]! * s, a[1]! * s, a[2]! * s];
const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** GPU side: pipelines, buffers, bind groups (rebuilt on a new device). */
class FutureGpu {
  readonly device: GPUDevice;
  readonly fieldPipe: GPURenderPipeline;
  readonly warpPipe: GPURenderPipeline;
  readonly depthPipe: GPUComputePipeline;
  readonly uniform: GPUBuffer;
  readonly fieldLayout: GPUBindGroupLayout;
  readonly warpLayout: GPUBindGroupLayout;
  inst: GPUBuffer;
  rip: GPUBuffer;
  private fieldBind: GPUBindGroup | null = null;
  private warpBind: GPUBindGroup | null = null;
  private warpKey: unknown[] = [];
  depthTex: GPUTexture | null = null;
  private depthBind: GPUBindGroup | null = null;
  private depthSrc: GPUTexture | null = null;
  readonly sampler: GPUSampler;
  private readonly frameBuf: GPUBuffer;

  constructor(r: Renderer) {
    const s = r.spectacleTargets();
    const d = this.device = s.device;
    this.frameBuf = s.frameBuf;
    const blend: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const base: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: VF, buffer: { type: 'read-only-storage' } },
    ];
    this.fieldLayout = d.createBindGroupLayout({ label: 'future.field', entries: base });
    this.warpLayout = d.createBindGroupLayout({
      label: 'future.warp',
      entries: [...base,
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }],
    });
    const mk = (code: string, label: string): GPURenderPipeline => {
      const mod = d.createShaderModule({ code, label });
      return d.createRenderPipeline({
        label, layout: d.createPipelineLayout({ bindGroupLayouts: [label === 'future.field' ? this.fieldLayout : this.warpLayout] }),
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: s.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
        multisample: { count: s.msaa },
      });
    };
    this.fieldPipe = mk(FIELD_WGSL, 'future.field');
    this.warpPipe = mk(WARP_WGSL, 'future.warp');
    const dm = d.createShaderModule({ code: DEPTH_WGSL, label: 'future.depth' });
    this.depthPipe = d.createComputePipeline({ label: 'future.depth', layout: 'auto', compute: { module: dm, entryPoint: 'resolveDepth' } });
    const scope = <T>(fn: () => T): T => vramLedger.scope('spectacle', fn);
    this.uniform = scope(() => d.createBuffer({ label: 'future.uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.inst = scope(() => d.createBuffer({ label: 'future.inst', size: MAX_INST * INST_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    this.rip = scope(() => d.createBuffer({ label: 'future.ripples', size: 256 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  field(): GPUBindGroup {
    this.fieldBind ??= this.device.createBindGroup({
      layout: this.fieldLayout,
      entries: [this.frameBuf, this.uniform, this.inst, this.rip].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return this.fieldBind;
  }

  warp(scene: GPUTexture): GPUBindGroup | null {
    if (!this.depthTex) return null;
    const key = [scene, this.depthTex];
    if (!this.warpBind || key.some((k, i) => k !== this.warpKey[i])) {
      this.warpKey = key;
      this.warpBind = this.device.createBindGroup({
        layout: this.warpLayout,
        entries: [
          ...[this.frameBuf, this.uniform, this.inst, this.rip].map((buffer, binding) => ({ binding, resource: { buffer } })),
          { binding: 4, resource: scene.createView() }, { binding: 5, resource: this.depthTex.createView() }, { binding: 6, resource: this.sampler },
        ],
      });
    }
    return this.warpBind;
  }

  /** Resolves the MSAA opaque depth into an r32float copy (nearest sample), sized to it. */
  resolveDepth(enc: GPUCommandEncoder, depth: GPUTexture, ts?: GPUComputePassTimestampWrites): void {
    if (!this.depthTex || this.depthTex.width !== depth.width || this.depthTex.height !== depth.height) {
      this.depthTex?.destroy();
      this.depthTex = vramLedger.scope('spectacle', () => this.device.createTexture({
        label: 'future.depth', size: [depth.width, depth.height], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }));
      this.depthSrc = null;
    }
    if (this.depthSrc !== depth || !this.depthBind) {
      this.depthSrc = depth;
      this.depthBind = this.device.createBindGroup({
        layout: this.depthPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: depth.createView() }, { binding: 1, resource: this.depthTex.createView() }],
      });
    }
    const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
    pass.setPipeline(this.depthPipe);
    pass.setBindGroup(0, this.depthBind);
    pass.dispatchWorkgroups(Math.ceil(depth.width / 8), Math.ceil(depth.height / 8));
    pass.end();
  }

  ensure(insts: number, rips: number): void {
    const d = this.device;
    if (insts * INST_FLOATS * 4 > this.inst.size) {
      this.inst.destroy();
      this.inst = vramLedger.scope('spectacle', () => d.createBuffer({ label: 'future.inst', size: insts * 2 * INST_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      this.fieldBind = null; this.warpBind = null;
    }
    if (rips * 16 > this.rip.size) {
      this.rip.destroy();
      this.rip = vramLedger.scope('spectacle', () => d.createBuffer({ label: 'future.ripples', size: rips * 2 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      this.fieldBind = null; this.warpBind = null;
    }
  }

  dispose(): void { this.inst.destroy(); this.rip.destroy(); this.uniform.destroy(); this.depthTex?.destroy(); }
}

/** One instance (wgsl.ts FI): origin + kind, three axes (+ w scalars), two param vectors, colour + intensity. */
function inst(o: readonly number[], kind: number, ax: readonly number[], axw: number, ay: readonly number[], ayw: number, az: readonly number[], azw: number,
  p: readonly number[], q: readonly number[], col: readonly number[], w: number): Float32Array {
  return new Float32Array([o[0]!, o[1]!, o[2]!, kind, ax[0]!, ax[1]!, ax[2]!, axw, ay[0]!, ay[1]!, ay[2]!, ayw, az[0]!, az[1]!, az[2]!, azw,
    p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0, q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 0, col[0]!, col[1]!, col[2]!, w]);
}

export class FutureFx {
  private readonly r: Renderer;
  private readonly fx: Fx;
  private readonly t: number;
  private gpu: FutureGpu;
  private readonly st = new Map<number, St>();
  private frameNo = 0;
  private time = 0;
  private lastTick = 0;
  /** Off: nothing is drawn or emitted (A/B timings). */
  enabled = true;
  /** True while a Singularity lens is on screen: main.ts turns the blast refraction shells off (boom.md: no double distortion). */
  lensActive = false;
  stats = { field: 0, warp: 0, parts: 0 };
  private quads: Float32Array[] = [];
  private boxes: Float32Array[] = [];
  private cones: Float32Array[] = [];
  private warps: Float32Array[] = [];
  private ripData: number[] = [];
  private scene: GPUTexture | null = null;
  private ctx: FutureCtx = { running: false, tick: 0, tickRate: 120, reducedMotion: false, reduceFlashing: true };
  private pendingEvents: { kind: string; part: number; pos: V3; mag: number; other: V3 | null }[] = [];

  constructor(renderer: Renderer, fx: Fx, tier: Tier) {
    this.r = renderer;
    this.fx = fx;
    this.t = TIER_INDEX[tier] ?? 3;
    this.gpu = new FutureGpu(renderer);
    renderer.addHook(this.hook());
    // M4 (V4) device loss: the renderer drops its hooks and rebuilds; rebuild ours on the new device
    renderer.onRestore(() => {
      this.gpu = new FutureGpu(renderer);
      this.scene = null;
      renderer.addHook(this.hook());
    });
  }

  private hook(): RenderHook {
    return {
      needsScene: () => this.enabled && this.warps.length > 0,
      afterOpaque: (enc, depth, scene) => {
        this.scene = scene;
        if (this.enabled && this.warps.length && scene) this.gpu.resolveDepth(enc, depth, this.r.timer.compute('future.depth'));
      },
      drawMatter: (pass) => {
        if (!this.enabled || !this.warps.length || !this.scene) return;
        const bind = this.gpu.warp(this.scene);
        if (!bind) return;
        pass.setPipeline(this.gpu.warpPipe);
        pass.setBindGroup(0, bind);
        const first = this.quads.length + this.boxes.length + this.cones.length;
        pass.draw(PRIM_VERTS.quad, this.warps.length, 0, first);
      },
      drawLate: (pass) => {
        if (!this.enabled) return;
        const n = this.quads.length + this.boxes.length + this.cones.length;
        if (!n) return;
        pass.setPipeline(this.gpu.fieldPipe);
        pass.setBindGroup(0, this.gpu.field());
        let first = 0;
        if (this.quads.length) pass.draw(PRIM_VERTS.quad, this.quads.length, 0, first);
        first += this.quads.length;
        if (this.boxes.length) pass.draw(PRIM_VERTS.box, this.boxes.length, 0, first);
        first += this.boxes.length;
        if (this.cones.length) pass.draw(PRIM_VERTS.cone, this.cones.length, 0, first);
      },
      clear: () => { this.st.clear(); this.pendingEvents = []; },
    };
  }

  private pick(v: readonly number[]): number { return v[Math.min(this.t, v.length - 1)]! * (this.t === 4 && v.length === 4 ? 2 : 1); }
  /** vfx §0.2 Hero / Ambient distance scale. */
  private far(p: readonly number[]): number { const e = this.r.eye; return Math.min(1, Math.max(0.1, (30 / Math.max(1, len(sub(p, e)))) ** 2)); }
  private emitN(s: St, rate: number, dt: number, which: 'acc' | 'acc2' = 'acc'): number {
    s[which] += rate * dt;
    const n = Math.floor(s[which]);
    s[which] -= n;
    return n;
  }

  /** A sim event (by name; unknown kinds are ignored). `partType` = the event's part; `other` = the other part's world position. */
  event(kind: string, partId: number, partType: string, pos: V3, mag: number, other: V3 | null, otherType = ''): void {
    if (!FUTURE_TYPES.has(partType) && !FUTURE_TYPES.has(otherType)) return;
    this.pendingEvents.push({ kind, part: FUTURE_TYPES.has(partType) ? partId : -1, pos, mag, other });
    if (!FUTURE_TYPES.has(partType) && otherType === 'force_wall') this.pendingEvents.at(-1)!.kind = `wall:${kind}`;
  }

  /** Per frame: every M5 part's state → this frame's instances, particles, lights, stasis volumes and singularities. */
  frame(parts: readonly FuturePart[], ctx: FutureCtx, wallDt: number): void {
    this.frameNo++;
    this.ctx = ctx;
    const dt = wallDt * this.r.timeScale;
    this.time += dt;
    this.quads = []; this.boxes = []; this.cones = []; this.warps = []; this.ripData = [];
    const stasis: StasisBox[] = [];
    const attract: (Attractor & { disk?: number; implode?: number })[] = [];
    const sing: { pos: V3; strength: number }[] = [];
    this.lensActive = false;
    if (!this.enabled) { this.flush(stasis, attract, sing); return; }
    // rift pairs: same pair colour, part order (1st + 2nd, 3rd + 4th…)
    const rifts = parts.filter((p) => p.type === 'rift_gate').sort((a, b) => a.id - b.id);
    const partner = new Map<number, FuturePart>();
    const byPair = new Map<number, FuturePart[]>();
    for (const g of rifts) { const k = g.props.pair ?? 0; byPair.set(k, [...(byPair.get(k) ?? []), g]); }
    for (const list of byPair.values()) for (let i = 0; i + 1 < list.length; i += 2) { partner.set(list[i]!.id, list[i + 1]!); partner.set(list[i + 1]!.id, list[i]!); }
    // glimpse budget: 0 / 0 / 1 / 2 pairs (tier 32: 4), nearest first
    const glimpses = new Set<number>();
    const gl = [0, 0, 1, 2, 4][this.t]!;
    if (gl) {
      const pairs = rifts.filter((g) => partner.has(g.id) && g.id < partner.get(g.id)!.id)
        .sort((a, b) => len(sub(a.pos, this.r.eye)) - len(sub(b.pos, this.r.eye))).slice(0, gl);
      for (const g of pairs) { glimpses.add(g.id); glimpses.add(partner.get(g.id)!.id); }
    }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const p of parts) {
      if (!FUTURE_TYPES.has(p.type)) continue;
      let s = this.st.get(p.id);
      if (!s) { s = { seen: 0, on: false, since: 99, prevFlags: 0, acc: 0, acc2: 0, ripples: [], age: -1, t0: NO_T0, collapsed: false }; this.st.set(p.id, s); }
      s.seen = this.frameNo;
      // A5's flags (channels/m5_*.ts): `lit` = the field is on, except TRACTOR BEAM (lit only while it carries: its beam
      // is on while powered) and SINGULARITY (armed for its 6 s; lit only once spun up)
      const on = p.type === 'tractor_beam' ? (p.flags & PartFlagBits.powered) !== 0 : p.type === 'singularity' ? (p.flags & PartFlagBits.armed) !== 0 : (p.flags & ON) !== 0;
      if (on !== s.on) { s.on = on; s.since = 0; } else s.since += dt;
      const evs = events.filter((e) => e.part === p.id || (e.kind.startsWith('wall:') && p.type === 'force_wall' && this.nearWall(p, e.pos)));
      switch (p.type) {
        case 'grav_well': this.gravWell(p, s, dt, attract); break;
        case 'tractor_beam': this.tractor(p, s, dt); break;
        case 'hover_pad': this.hover(p, s, dt); break;
        case 'force_wall': this.wall(p, s, dt, evs); break;
        case 'coilgun_ring': this.coilgun(p, s, dt, evs); break;
        case 'stasis_field': this.stasis(p, s, dt, stasis); break;
        case 'singularity': this.singularity(p, s, dt, attract, sing); break;
        case 'rift_gate': this.rift(p, s, dt, partner.get(p.id) ?? null, glimpses.has(p.id), evs); break;
      }
      s.prevFlags = p.flags;
    }
    for (const [id, s] of this.st) if (this.frameNo - s.seen > 2) this.st.delete(id);
    this.lastTick = ctx.tick;
    this.flush(stasis, attract, sing);
  }

  private flush(stasis: StasisBox[], attract: (Attractor & { disk?: number; implode?: number })[], sing: { pos: V3; strength: number }[]): void {
    const r = this.r;
    r.particles.stasis = stasis;
    r.particles.attractors = attract;
    r.m5Frame = { stasis, sing, stretch: this.ctx.reducedMotion ? 0 : 1 };
    // warps each sample the unbent scene, so they can't stack: while a Singularity lenses, only the lens and the rift
    // membranes draw (the lens first; the membranes over it), and the small shimmers and ripples wait
    if (this.warps.some((w) => w[3] === K.lens)) {
      this.warps = [...this.warps.filter((w) => w[3] === K.lens), ...this.warps.filter((w) => w[3] === K.rift)];
    }
    const all = [...this.quads, ...this.boxes, ...this.cones, ...this.warps];
    this.stats = { field: this.quads.length + this.boxes.length + this.cones.length, warp: this.warps.length, parts: this.st.size };
    const g = this.gpu;
    g.ensure(all.length, this.ripData.length / 4);
    if (all.length) {
      const buf = new Float32Array(all.length * INST_FLOATS);
      all.forEach((a, i) => buf.set(a, i * INST_FLOATS));
      g.device.queue.writeBuffer(g.inst, 0, buf);
    }
    if (this.ripData.length) g.device.queue.writeBuffer(g.rip, 0, new Float32Array(this.ripData));
    const [w, h] = r.internalSize;
    g.device.queue.writeBuffer(g.uniform, 0, new Float32Array([
      ...r.camRight, 0, ...r.camUp, 0, w, h, 1 / Math.max(1, w), 1 / Math.max(1, h),
      this.time, this.ctx.reducedMotion ? 0.3 : 1, this.t, 1,
    ]));
  }

  // ---- per part ------------------------------------------------------------------------------------------------------

  private world(p: FuturePart, local: readonly number[]): V3 { return add(p.pos, qrot(p.rot, local)); }
  private axis(p: FuturePart, dir: readonly number[]): V3 { return qrot(p.rot, dir); }

  private gravWell(p: FuturePart, s: St, dt: number, attract: (Attractor & { disk?: number; implode?: number })[]): void {
    if (!s.on) return;
    const orb = this.world(p, GRAV_WELL.core);
    const repel = (p.props.mode ?? 0) === 1;
    const spin = smooth(0, 0.6, s.since);
    this.quads.push(inst(orb, K.halo, [0, 0, 0], 0.16, [0, 0, 0], 0, [0, 0, 0], 0, [0.6 * spin, 0.42, 0.05, 0.9 * spin], [], PLASMA, 2.2));
    if (this.t >= 1) this.warps.push(inst(orb, K.shimmer, [0, 0, 0], 0.3, [0, 0, 0], 0, [0, 0, 0], 0, [0.006 * spin, 5], [], PLASMA, 1));
    // spin-up (0.6 s): crackles from the three arm tips to the orb (future.md EMIT__arc__tip_a/b/c)
    if (s.since < 0.6) {
      for (const a of [90, 210, 330]) {
        const rad = (a * Math.PI) / 180;
        this.fx.arc(this.world(p, [0.035 * Math.cos(rad), 0.085, -0.035 * Math.sin(rad)]), orb, 0.08, 0.5);
      }
    }
    const far = this.far(orb);
    const n = this.emitN(s, this.pick([40, 80, 160, 240]) * far * spin, dt);
    if (n > 0) {
      const ps = this.r.particles;
      if (repel) ps.emit({ pos: orb, count: n, kind: Kind.mote, dir: [0, 1, 0], spread: 1, speed: [0.25, 0.5], life: [1.2, 2], size: [0.006, 0.012], color: [1, 0.2, 0.6, 5], color2: [1, 0.6, 0.85, 4], gravity: 0, drag: 0.2, jitter: 0.05 });
      else ps.emit({ pos: orb, count: n, kind: Kind.infall, dir: [0, 1, 0], spread: 1, speed: [0.15, 0.3], life: [2, 3], size: [0.004, 0.008], color: [1, 0.25, 0.65, 5], color2: [1, 0.7, 0.9, 4], gravity: 0, drag: 0.1, jitter: 0.9 });
    }
    attract.push({ pos: orb, s: repel ? -0.15 : 0.35, rMin: 0.08, kill: repel ? 0 : 0.05, disk: 1.2 });
    this.r.light(orb, [1.1 * spin, 0.05, 0.45 * spin], 0.7);
  }

  private tractor(p: FuturePart, s: St, dt: number): void {
    if (!s.on) return;
    const lens = this.world(p, TRACTOR.lens);
    const dir = this.axis(p, [0, 0, 1]);
    const L = p.props.range ?? 1.5;
    const hold = Math.min(L, p.props.hold ?? 0.5);
    const holdMode = (p.props.mode ?? 0) === 1;
    const r1 = TRACTOR.r0 + (TRACTOR.r3 - TRACTOR.r0) * (L / 3);
    const load = p.meter > 0 && p.meter < 31 ? (p.meter - 1) / 20 : p.meter === 31 ? 1 : 0;
    const fadeIn = smooth(0, 0.2, s.since);
    this.cones.push(inst(lens, K.tractor, this.axis(p, [1, 0, 0]), 0, this.axis(p, [0, 1, 0]), 0, scl(dir, L), 0, [TRACTOR.r0, r1, L, holdMode ? 1 : 0], [hold, (p.flags & PartFlagBits.fault) !== 0 || load > 0.95 ? (this.ctx.reduceFlashing ? 0.6 : 1) : 0], PLASMA, 1.6 * fadeIn)); // strain flicker: ±15 % under Reduce flashing
    const ps = this.r.particles;
    const far = this.far(lens);
    const n = this.emitN(s, this.pick([60, 120, 240, 450]) * far, dt);
    if (n > 0) {
      // motes drifting toward the lens inside the beam (pull), or orbiting the hold point (hold, loaded)
      const at = add(lens, dir, holdMode ? hold : L * (0.3 + 0.6 * Math.random()));
      ps.emit({ pos: at, count: n, kind: Kind.mote, dir: holdMode ? [0, 1, 0] : scl(dir, -1), spread: holdMode ? 1 : 0.08, speed: holdMode ? [0.05, 0.15] : [0.6, 1.2], life: [0.6, 1.4], size: [0.004, 0.009], color: [1, 0.3, 0.7, 4], color2: [1, 0.9, 0.95, 3], gravity: 0, drag: holdMode ? 1.5 : 0.1, jitter: holdMode ? 0.08 : r1 * 0.6 });
    }
    this.r.light(lens, [0.9, 0.12, 0.45], 0.5);
    if (holdMode && load > 0) this.r.light(add(lens, dir, hold), [0.8, 0.1, 0.4], 0.35);
  }

  private hover(p: FuturePart, s: St, dt: number): void {
    if (!s.on) return;
    const pad = p.pos;
    const floorY = p.placed.pos[1];
    const h = pad[1] - floorY;
    const load = p.meter > 0 && p.meter < 31 ? (p.meter - 1) / 20 : p.meter === 31 ? 1 : 0;
    const k = smooth(0, 0.3, s.since);
    // underside glow disc (Field colour, 40 %)
    this.quads.push(inst(add(pad, [0, -0.002, 0]), K.disc, this.axis(p, [0.22, 0, 0]), 0, this.axis(p, [0, 0, 0.22]), 0, [0, 0, 0], 0, [], [], PLASMA, 0.4 * 3 * k * (1 + 0.5 * load)));
    if (h > 0.04 && h < HOVER.height + 0.15) {
      const ground: V3 = [pad[0], floorY + 0.003, pad[2]];
      // two ground ripple rings 0 → 0.4 m at 1.5 Hz (3 Hz under load), brighter loaded
      this.quads.push(inst(ground, K.ripples, [0.4, 0, 0], 0, [0, 0, 0.4], 0, [0, 0, 0], 0, [load > 0.05 ? 3 : 1.5, 1 + load], [], PLASMA, 1.3 * k));
      // heat-shimmer column (distortion off / half / full / full: Low off)
      if (this.t >= 1) this.warps.push(inst([pad[0], (pad[1] + floorY) / 2, pad[2]], K.column, [0, 0, 0], 0.17, [0, h / 2, 0], 0, [0, 0, 0], 0, [(this.t === 1 ? 0.5 : 1) * 0.0035 * k], [], PLASMA, 1));
      const n = this.emitN(s, this.pick([25, 50, 100, 200]) * this.far(ground) * k, dt);
      if (n > 0) this.r.particles.emit({ pos: ground, count: n, kind: Kind.mote, dir: [0, 1, 0], spread: 0.95, speed: [0.25, 0.5], life: [0.8, 1.4], size: [0.004, 0.008], color: [1, 0.25, 0.65, 3], gravity: 0.02, drag: 1.2, jitter: 0.12 });
    }
    this.r.light(add(pad, [0, -0.05, 0]), [0.7 * k, 0.05, 0.3 * k], 0.6);
  }

  private nearWall(p: FuturePart, at: readonly number[]): boolean {
    const W = p.props.width ?? 0.6, H = p.props.height ?? 0.4;
    const l = qrot(qinv(p.rot), sub(at, p.pos));
    return Math.abs(l[0]) <= W / 2 + 0.05 && l[1] >= -0.05 && l[1] <= H + 0.05 && Math.abs(l[2]) <= 0.2;
  }

  private wall(p: FuturePart, s: St, dt: number, evs: readonly { kind: string; pos: V3; mag: number }[]): void {
    const box = forceWallField(p.props);
    const c = this.world(p, box.at ?? [0, 0, 0]);
    const hw = box.size[0] / 2, hh = box.size[1] / 2;
    const ax = this.axis(p, [1, 0, 0]), ay = this.axis(p, [0, 1, 0]);
    for (const r of s.ripples) r.age += dt;
    s.ripples = s.ripples.filter((r) => r.age < 0.6);
    if (s.on) {
      const cap = this.pick([4, 8, 8, 8]);
      for (const e of evs) {
        const d = sub(e.pos, c);
        const str = Math.min(1, Math.max(0.25, (e.mag || 1) / 4));
        s.ripples.push({ u: dot(d, ax), v: dot(d, ay), age: 0, s: str });
        if (str > 0.6) this.r.particles.emit({ pos: e.pos, count: this.pick([20, 40, 80, 120]), kind: Kind.sparkle, dir: this.axis(p, [0, 0, 1]), spread: 1, speed: [0.2, 0.8], life: [0.3, 0.6], size: [0.008, 0.016], color: [1, 0.3, 0.7, 6], color2: [1, 0.9, 0.95, 5], gravity: 0.1, drag: 2, jitter: 0.01 });
      }
      while (s.ripples.length > cap) s.ripples.shift();
    }
    // on: prints in from the pylons in 0.25 s; off: fades in 0.2 s (no flicker)
    const print = s.on ? smooth(0, 0.25, s.since) : 1;
    const fade = s.on ? 1 : 1 - smooth(0, 0.2, s.since);
    if (fade <= 0.001) return;
    const first = this.ripData.length / 4;
    for (const r of s.ripples) this.ripData.push(r.u, r.v, r.age, r.s);
    this.quads.push(inst(c, K.wall, scl(ax, hw), 0, scl(ay, hh), 0, [0, 0, 0], 0, [hw, hh, print, fade], [first, s.ripples.length], PLASMA, 2.4));
  }

  private coilgun(p: FuturePart, s: St, dt: number, evs: readonly { kind: string; mag: number }[]): void {
    // A5: `Boost` mag 3 = a steel body boosted (mag 0 = a dud pass), `pressed` 0.12 s with it
    const fired = evs.some((e) => e.kind === 'Boost' && e.mag > 0) || ((p.flags & PartFlagBits.pressed) !== 0 && (s.prevFlags & PartFlagBits.pressed) === 0);
    const dirSign = (p.props.direction ?? 0) === 1 ? -1 : 1;
    const centre = this.world(p, COILGUN.centre);
    const axis = this.axis(p, [0, 0, dirSign]);
    const exit = add(centre, axis, 0.05);
    if (fired) {
      s.age = 0;
      // crawling arcs on the six coil packs (60° steps) and a small exit flash (never large)
      for (let k = 0; k < 6; k += 2) {
        const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3;
        this.fx.arc(this.world(p, [0.111 * Math.cos(a0), COILGUN.centre[1] + 0.111 * Math.sin(a0), 0]), this.world(p, [0.111 * Math.cos(a1), COILGUN.centre[1] + 0.111 * Math.sin(a1), 0]), 0.12, 0.6);
      }
      this.fx.fieldFlash(exit, [2.4, 0.3, 1.2], 0.8, 0.12);
      this.r.particles.emit({ pos: exit, count: this.pick([30, 60, 120, 200]), kind: Kind.sparkle, dir: axis, spread: 0.35, speed: [0.5, 2], life: [0.2, 0.45], size: [0.006, 0.012], color: [1, 0.35, 0.75, 6], color2: [0.9, 0.95, 1, 6], gravity: 0, drag: 2.5, jitter: 0.04 });
    }
    if (s.age < 0) return;
    s.age += dt;
    if (s.age > 0.45) { s.age = -1; return; }
    const u = s.age / 0.45;
    const rad = 0.08 + 0.3 * (1 - (1 - u) ** 2);
    const ex = this.axis(p, [1, 0, 0]), ey = this.axis(p, [0, 1, 0]);
    this.quads.push(inst(exit, K.ring, scl(ex, rad + 0.05), 0, scl(ey, rad + 0.05), 0, [0, 0, 0], 0, [rad / (rad + 0.05), 0.04, 1 - u], [], PLASMA, 4));
    if (this.t >= 1) this.warps.push(inst(exit, K.ripple, [0, 0, 0], rad + 0.08, [0, 0, 0], 0, [0, 0, 0], 0, [rad / (rad + 0.08), 0.12, 0.012 * (1 - u)], [], PLASMA, 1));
  }

  private stasis(p: FuturePart, s: St, dt: number, out: StasisBox[]): void {
    const W = p.props.width ?? 0.5, H = p.props.height ?? 0.5, D = p.props.depth ?? 0.5;
    const centre = this.world(p, [0, H / 2, 0]);
    const half: V3 = [W / 2, H / 2, D / 2];
    if (!s.on) {
      // release: the lattice shatters outward into sparkles with a time-snap (0.25 s)
      if (s.since === 0 && this.frameNo > 1) this.r.particles.emit({ pos: centre, count: this.pick([200, 200, 200, 200]), kind: Kind.sparkle, dir: [0, 1, 0], spread: 1, speed: [0.3, 1.2], life: [0.4, 0.8], size: [0.008, 0.016], color: [1, 0.3, 0.7, 6], color2: [1, 0.9, 0.95, 5], gravity: 0.2, drag: 1.5, jitter: Math.max(W, H, D) * 0.5 });
      const fade = 1 - smooth(0, 0.25, s.since);
      if (fade > 0.01) this.boxes.push(inst(centre, K.stasis, this.axis(p, [W / 2, 0, 0]), 0, this.axis(p, [0, H / 2, 0]), 0, this.axis(p, [0, 0, D / 2]), 0, [...half, 1], [fade], PLASMA, 2.2));
      return;
    }
    const sweep = smooth(0, 0.3, s.since);
    this.boxes.push(inst(centre, K.stasis, this.axis(p, [W / 2, 0, 0]), 0, this.axis(p, [0, H / 2, 0]), 0, this.axis(p, [0, 0, D / 2]), 0, [...half, sweep], [1], PLASMA, 2.2));
    out.push({ center: centre, half, rot: p.rot });
    if (s.since === 0) {
      // engage: a node flare at each corner lens (small, never large)
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) this.fx.fieldFlash(this.world(p, [x * (W / 2 - 0.02), 0.06, z * (D / 2 - 0.02)]), [1.2, 0.1, 0.5], 0.25, 0.3);
    }
    // slow drifting glints inside (100 / 200 / 400 / 800 per field)
    const live = this.pick([100, 200, 400, 800]) * this.far(centre);
    const n = this.emitN(s, live / 3, dt);
    for (let i = 0; i < n; i += 8) {
      const at = this.world(p, [(Math.random() - 0.5) * W, Math.random() * H, (Math.random() - 0.5) * D]);
      this.r.particles.emit({ pos: at, count: Math.min(8, n - i), kind: Kind.glint, dir: [0, 1, 0], spread: 1, speed: [0.005, 0.03], life: [2.5, 3.5], size: [0.004, 0.009], color: [1, 0.55, 0.85, 4], color2: [0.85, 0.95, 1, 4], gravity: 0, drag: 0.2, jitter: Math.min(W, D) * 0.15 });
    }
  }

  private singularity(p: FuturePart, s: St, dt: number, attract: (Attractor & { disk?: number; implode?: number })[], sing: { pos: V3; strength: number }[]): void {
    const c = this.ctx;
    const core = this.world(p, SINGULARITY.core);
    if (s.on && (s.since === 0 || s.t0 === NO_T0)) {
      s.collapsed = false;
      // armed this tick, or (after a jump on the timeline) some time ago: the countdown meter (1 + whole seconds left)
      // places it to within half a second
      const jumped = Math.abs(c.tick - this.lastTick) > 12 || s.since > 0;
      s.t0 = jumped && p.meter > 1 ? c.tick - Math.max(0, SINGULARITY.durationS + 0.5 - (p.meter - 1)) * c.tickRate : c.tick;
    }
    if (s.t0 === NO_T0) return;
    if (c.tick < s.t0) { s.t0 = NO_T0; return; } // scrubbed back before it armed
    const e = (c.tick - s.t0) / Math.max(1, c.tickRate);
    const D = SINGULARITY.durationS;
    if (e > D + 3) { if (!s.on) s.t0 = NO_T0; return; } // (the attractor stays 3 s after the collapse: no disk particle escapes)
    // 0–0.5 s the core grows Ø 0.05 → 0.3 m; 0.5–6 s the disk, streams and lensing (Einstein ring 0.6 → 1.5 m); 6 s collapse
    const grow = smooth(0, SINGULARITY.spinS, e);
    const collapse = e < D ? 0 : smooth(D, D + 0.15, e);
    const rc = (0.025 + 0.125 * grow) * (1 - collapse);
    const thE = (0.12 + 0.48 * grow + 0.9 * smooth(0.5, D, e)) * (1 - collapse);
    const disk = smooth(0.5, 0.9, e) * (1 - collapse);
    if (rc > 0.002) {
      this.lensActive = true;
      // the lens billboard is drawn 0.1 m in front of the camera, scaled to the lens's footprint at the core: per-pixel depth
      // decides what bends (wgsl.ts K.lens), and the black core hides whatever is behind its near side
      const rel = sub(core, this.r.eye);
      const dc = Math.max(1e-3, len(rel));
      const dn = Math.min(0.1, dc * 0.5);
      const R = thE * 2.3;
      this.warps.push(inst(add(this.r.eye, rel, dn / dc), K.lens, [0, 0, 0], R * dn / dc, [0, 0, 0], 0, [0, 0, 0], 0, [thE, rc, 1], [R, ...rel], [0, 0, 0], 1));
      // photon ring: a thin Plasma ring just outside the core
      this.quads.push(inst(core, K.halo, [0, 0, 0], rc * 1.6, [0, 0, 0], 0, [0, 0, 0], 0, [0, 1.05 / 1.6, 0.025, 1], [], PLASMA, 3.5));
    }
    if (disk > 0.01) {
      const R = 0.5;
      this.quads.push(inst(core, K.adisk, this.axis(p, [R, 0, 0]), 0, this.axis(p, [0, 0, R]), 0, [0, 0, 0], 0, [Math.max(0.05, rc * 1.25 / R), 3, disk], [rc], [1, 1, 1], 0.7));
      const far = this.far(core);
      const ps = this.r.particles;
      const nd = this.emitN(s, (this.pick([20000, 60000, 150000, 300000]) / 2.2) * far * disk, dt);
      // (many thin additive grains: each is faint, the disk's brightness is their sum)
      if (nd > 0) ps.emit({ pos: core, count: nd, kind: Kind.disk, dir: this.axis(p, [0, 1, 0]), spread: Math.max(0.12, rc * 1.3), speed: [2.2, 0.06], life: [1.6, 2.8], size: [0.002, 0.005], color: [1, 0.9, 0.8, 1.2 * (60000 / Math.max(20000, this.pick([20000, 60000, 150000, 300000])))], color2: [1, 0.6, 0.75, 1], gravity: 0, drag: 0.35, jitter: R });
      // infall: six streams from 1.3 m out, slowly turning, so it reads as debris pouring in rather than a haze
      const ni = this.emitN(s, (this.pick([5000, 15000, 40000, 80000]) / 2.4) * far * disk, dt, 'acc2');
      for (let k = 0; k < 6 && ni > 0; k++) {
        const a = k * 1.047 + this.time * 0.25 + p.id, el = 0.35 * Math.sin(k * 2.3 + p.id);
        ps.emit({ pos: core, count: Math.ceil(ni / 6), kind: Kind.infall, dir: [Math.cos(a), el, Math.sin(a)], spread: 0.004, speed: [0.3, 0.6], life: [1.6, 2.2], size: [0.002, 0.004], color: [1, 0.35, 0.7, 1.6], color2: [1, 0.85, 0.75, 1.6], gravity: 0, drag: 0.15, jitter: 1.3 });
      }
      sing.push({ pos: core, strength: disk });
      this.r.light(core, [2.2 * disk, 0.6 * disk, 0.9 * disk], 1.5);
    }
    // the disk and streams orbit the core until the collapse, which pulls everything left into it
    if (e > 0.5) attract.push({ pos: core, s: e < D ? 2.2 : 25, rMin: 0.04, kill: e < D ? Math.max(0.02, rc * 0.9) : 0.06, disk: 0.5, implode: e < D ? 0 : 9 });
    // collapse at 6 s: implosion snap, a Plasma shock ring, one flash (counts toward the limiter), the core pops
    if (e >= D && !s.collapsed) {
      s.collapsed = true;
      this.fx.fieldFlash(core, [6, 2.2, 4], 4, 0.35, c.reduceFlashing ? 0.5 : 1.2);
      this.r.particles.emit({ pos: core, count: this.pick([200, 300, 450, 600]), kind: Kind.sparkle, dir: [0, 1, 0], spread: 1, speed: [0.5, 3], life: [0.3, 0.7], size: [0.008, 0.02], color: [1, 0.3, 0.7, 8], color2: [1, 0.95, 0.9, 8], gravity: 0.3, drag: 1.5, jitter: 0.02 });
    }
    if (e >= D && e < D + 0.6) {
      const u = (e - D) / 0.6;
      const rad = 0.1 + 2.9 * (1 - (1 - u) ** 3);
      this.quads.push(inst(core, K.ring, this.axis(p, [rad * 1.1, 0, 0]), 0, this.axis(p, [0, 0, rad * 1.1]), 0, [0, 0, 0], 0, [1 / 1.1, 0.02 + 0.03 * u, 1 - u], [], PLASMA, 5));
    }
  }

  private rift(p: FuturePart, s: St, dt: number, partner: FuturePart | null, glimpse: boolean, evs: readonly { kind: string }[]): void {
    // A5: `Teleport` at the entry gate, `Emerge` at the exit (both `pressed` 0.2 s), `Bounce` for an overflow (a smaller
    // "bonk" ripple, no sparkles)
    const transit = evs.some((e) => e.kind === 'Teleport' || e.kind === 'Emerge') || ((p.flags & PartFlagBits.pressed) !== 0 && (s.prevFlags & PartFlagBits.pressed) === 0);
    const bonk = evs.some((e) => e.kind === 'Bounce');
    const centre = this.world(p, [RIFT.centre[0], RIFT.centre[1], RIFT.membrane + 0.0015]);
    const nrm = this.axis(p, [0, 0, 1]);
    const pair = PAIR_RGB[Math.max(0, Math.min(5, p.props.pair ?? 0))]!;
    if (bonk && !transit && s.age < 0) s.age = 0.2;
    if (transit && partner) {
      s.age = 0;
      // sparkles round the rim at this gate (no flash on teleport)
      const n = this.pick([120, 240, 400, 600]);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        this.r.particles.emit({ pos: this.world(p, [RIFT.radius * Math.cos(a), RIFT.centre[1] + RIFT.radius * Math.sin(a), RIFT.membrane + 0.01]), count: Math.ceil(n / 12), kind: Kind.sparkle, dir: nrm, spread: 0.6, speed: [0.2, 0.9], life: [0.35, 0.6], size: [0.006, 0.012], color: [pair[0] * 6, pair[1] * 6, pair[2] * 6, 1], color2: [5, 5, 5, 1], gravity: 0, drag: 2, jitter: 0.01 });
      }
    }
    if (s.age >= 0) { s.age += dt; if (s.age > 0.4) s.age = -1; }
    let q: Q4 = [0, 0, 0, 1];
    let pc: V3 = [0, 0, 0];
    if (partner) {
      q = qmul(qmul(partner.rot, ROT_Y180), qinv(p.rot));
      pc = sub(add(partner.pos, qrot(partner.rot, [RIFT.centre[0], RIFT.centre[1], RIFT.membrane])), this.r.eye);
    }
    const cool = (p.flags & PartFlagBits.armed) !== 0 ? 1 : 0;
    const R = RIFT.radius;
    // paired: in a run the sim says so (`lit`), in Build the pair colours and part order do
    const paired = partner !== null && (!this.ctx.running || (p.flags & ON) !== 0);
    this.warps.push(inst(centre, K.rift, scl(this.axis(p, [1, 0, 0]), R), pc[0], scl(this.axis(p, [0, 1, 0]), R), pc[1], nrm, pc[2],
      [paired ? 1 : 0, glimpse && paired ? 1 : 0, s.age, cool * 0.3], q, pair, 1));
    if (partner) this.r.light(add(centre, nrm, 0.05), [pair[0] * 0.5, pair[1] * 0.5, pair[2] * 0.5], 0.4);
  }
}

export { RIFT_PAIRS };
