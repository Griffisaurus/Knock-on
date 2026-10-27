// R5 (M5, contract 6): the wetness mask. Surfaces Matter water touches darken and gloss up (environments.md §2.4: the
// Kitchen basin's wet state, roughness −0.3 and albedo −15 % at full wetness), and dry again over ~40 s after it leaves.
//
// A top-down grid over a rectangle of the world (the Kitchen sink by default in the Kitchen, else 8 m round the origin),
// n × n cells of (wetness 0–1, wet-line height m). Each frame, on the GPU, before the shadow pass:
//   1. clear the per-cell scratch (water count, highest water centre),
//   2. splat every live water grain of the Matter view (render-only: the same buffers the Matter surfaces draw),
//   3. resolve: wetness = max(previous × drying, count / 3), the wet line rises at once and sinks slowly as it dries.
// The part shader and the Studio floor read it (shaders.ts `wetness`, group 0 binding 12, no extra texture: the 16
// sampled-texture limit is untouched). Nothing here feeds back into the sim. Rebuilt on renderer.onRestore.

import type { Renderer, RenderHook } from './renderer.ts';
import { matterSource, type MatterView } from './matter/types.ts';
import { vramLedger } from './vram.ts';

const WGSL = /* wgsl */ `
struct WU { rect: vec4f, misc: vec4f }; // rect: x0, z0, cell, n · misc: dry factor, grains, posStride, units per metre
@group(0) @binding(0) var<uniform> u: WU;
@group(0) @binding(1) var<storage, read> pos: array<i32>;
@group(0) @binding(2) var<storage, read> mat: array<u32>;
@group(0) @binding(3) var<storage, read_write> scratch: array<atomic<i32>>; // per cell: count, max y (mm)
@group(0) @binding(4) var<storage, read_write> grid: array<vec2f>;

@compute @workgroup_size(256) fn clear(@builtin(global_invocation_id) g: vec3u) {
  let n = u32(u.rect.w);
  if (g.x >= n * n) { return; }
  atomicStore(&scratch[g.x * 2u], 0);
  atomicStore(&scratch[g.x * 2u + 1u], -2147483647);
}

@compute @workgroup_size(256) fn splat(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = g.x + g.y * nwg.x * 256u;
  if (i >= u32(u.misc.y)) { return; }
  if ((mat[i] & 255u) != 1u) { return; }
  let s = u32(u.misc.z);
  let w = vec3f(f32(pos[i * s]), f32(pos[i * s + 1u]), f32(pos[i * s + 2u])) / u.misc.w;
  let n = i32(u.rect.w);
  let c = vec2i(floor((w.xz - u.rect.xy) / u.rect.z));
  if (any(c < vec2i(0)) || any(c >= vec2i(n))) { return; }
  let k = u32(c.y * n + c.x);
  atomicAdd(&scratch[k * 2u], 1);
  atomicMax(&scratch[k * 2u + 1u], i32(w.y * 1000.0));
}

@compute @workgroup_size(256) fn resolve(@builtin(global_invocation_id) g: vec3u) {
  let n = u32(u.rect.w);
  if (g.x >= n * n) { return; }
  let cnt = f32(atomicLoad(&scratch[g.x * 2u]));
  let top = f32(atomicLoad(&scratch[g.x * 2u + 1u])) / 1000.0;
  var w = grid[g.x];
  let wasDry = w.x < 0.02;
  w.x *= u.misc.x;
  if (cnt > 0.0) {
    w.x = max(w.x, min(1.0, cnt / 3.0));
    w.y = select(max(w.y, top + 0.004), top + 0.004, wasDry);
  }
  if (w.x < 0.01) { w = vec2f(0.0, -1e3); }
  grid[g.x] = w;
}
`;

export class WetnessMask {
  private readonly r: Renderer;
  private device: GPUDevice;
  private pipes!: { clear: GPUComputePipeline; splat: GPUComputePipeline; resolve: GPUComputePipeline };
  private uniform!: GPUBuffer;
  private scratch: GPUBuffer | null = null;
  private grid: GPUBuffer | null = null;
  private bind: GPUBindGroup | null = null;
  private bindKey: unknown[] = [];
  private n = 256;
  /** World rect: x0, z0, size (m). */
  private rect: [number, number, number] = [-4, -4, 8];
  /** Seconds for wetness to fall to 1 / e once the water has gone. */
  dryS = 40;
  enabled = true;
  /** True once any water was seen (until clear): the grid is bound only then. */
  private live = false;
  private last = 0;

  constructor(renderer: Renderer, cells = 256) {
    this.r = renderer;
    this.n = cells;
    this.device = renderer.device;
    this.build();
    renderer.addHook(this.hook());
    renderer.onRestore(() => {
      this.device = renderer.device;
      this.scratch = null; this.grid = null; this.bind = null; this.live = false;
      this.build();
      renderer.addHook(this.hook());
    });
  }

  /** The grid's world rectangle (x0, z0, size m); resets the grid. */
  setRect(x0: number, z0: number, size: number): void {
    if (x0 === this.rect[0] && z0 === this.rect[1] && size === this.rect[2]) return;
    this.rect = [x0, z0, size];
    this.reset();
  }

  /** Dry everything (Stop: a perfect reset). */
  reset(): void {
    if (this.grid) this.device.queue.writeBuffer(this.grid, 0, new Float32Array(this.n * this.n * 2).fill(0));
    this.live = false;
    this.r.setWetness(null, [0, 0, 1, 0]);
  }

  private build(): void {
    const d = this.device;
    const mod = d.createShaderModule({ label: 'wetness', code: WGSL });
    // one explicit layout for all three (each entry point uses a different subset)
    const C = GPUShaderStage.COMPUTE;
    const layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: C, buffer: { type: 'storage' } }, { binding: 4, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    const pl = d.createPipelineLayout({ bindGroupLayouts: [layout] });
    const make = (entryPoint: string): GPUComputePipeline => d.createComputePipeline({ label: `wetness.${entryPoint}`, layout: pl, compute: { module: mod, entryPoint } });
    this.pipes = { clear: make('clear'), splat: make('splat'), resolve: make('resolve') };
    this.layout = layout;
    this.uniform = d.createBuffer({ label: 'wetness.u', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  private layout!: GPUBindGroupLayout;

  private hook(): RenderHook {
    return {
      prepare: (enc) => this.prepare(enc),
      clear: () => this.reset(),
    };
  }

  private prepare(enc: GPUCommandEncoder): void {
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) * this.r.timeScale : 0;
    this.last = now;
    const view: MatterView | null | undefined = this.enabled ? matterSource()?.view?.() : null;
    if (!view || view.device !== this.device || !view.count) {
      if (this.live && dt > 0) this.resolveOnly(enc, dt);
      return;
    }
    const d = this.device, n = this.n, cells = n * n;
    vramLedger.scope('spectacle', () => {
      this.scratch ??= d.createBuffer({ label: 'wetness.scratch', size: cells * 8, usage: GPUBufferUsage.STORAGE });
      this.grid ??= d.createBuffer({ label: 'wetness.grid', size: cells * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    });
    this.write(dt, view.count, view.posStride ?? 3);
    const bind = this.bindFor(view.pos, view.mat);
    const ts = this.r.timer.compute('wetness');
    const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
    pass.setBindGroup(0, bind);
    pass.setPipeline(this.pipes.clear);
    pass.dispatchWorkgroups(Math.ceil(cells / 256));
    pass.setPipeline(this.pipes.splat);
    const groups = Math.ceil(view.count / 256);
    pass.dispatchWorkgroups(Math.min(groups, 32768), Math.ceil(groups / 32768));
    pass.setPipeline(this.pipes.resolve);
    pass.dispatchWorkgroups(Math.ceil(cells / 256));
    pass.end();
    if (!this.live) { this.live = true; }
    this.r.setWetness(this.grid, [this.rect[0], this.rect[1], this.rect[2] / n, n]);
  }

  /** No water this frame (Matter off, or a view on another device): only dry what's wet. */
  private resolveOnly(enc: GPUCommandEncoder, dt: number): void {
    if (!this.scratch || !this.grid) return;
    this.write(dt, 0, 3);
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindFor(this.scratch, this.scratch));
    pass.setPipeline(this.pipes.clear);
    pass.dispatchWorkgroups(Math.ceil((this.n * this.n) / 256));
    pass.setPipeline(this.pipes.resolve);
    pass.dispatchWorkgroups(Math.ceil((this.n * this.n) / 256));
    pass.end();
  }

  private write(dt: number, count: number, stride: number): void {
    const n = this.n;
    const b = new ArrayBuffer(32);
    const f = new Float32Array(b);
    f.set([this.rect[0], this.rect[1], this.rect[2] / n, n, Math.exp(-dt / this.dryS), count, stride, 65536], 0);
    this.device.queue.writeBuffer(this.uniform, 0, b);
  }

  private bindFor(pos: GPUBuffer, mat: GPUBuffer): GPUBindGroup {
    const key = [pos, mat, this.scratch, this.grid];
    if (!this.bind || key.some((k, i) => k !== this.bindKey[i])) {
      this.bindKey = key;
      // with no view (drying only) the scratch stands in for pos / mat: a read-write buffer can't also be read-only in
      // one bind group, so use the grid's own dummy copy there
      const ro = pos === this.scratch ? this.roDummy() : pos;
      const rm = mat === this.scratch ? this.roDummy() : mat;
      this.bind = this.device.createBindGroup({
        layout: this.layout,
        entries: [this.uniform, ro, rm, this.scratch!, this.grid!].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    }
    return this.bind;
  }
  private dummy: GPUBuffer | null = null;
  private roDummy(): GPUBuffer {
    this.dummy ??= this.device.createBuffer({ label: 'wetness.none', size: 16, usage: GPUBufferUsage.STORAGE });
    return this.dummy;
  }
}
