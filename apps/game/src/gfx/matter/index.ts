// Matter surfaces (RENDERING §3 passes 5/16, §8; GAME_SPEC §13 "Matter rendering"; M4 contract 3; stream R4).
//
// MatterRenderer registers one RenderHook. Per frame, when a Matter source has a view (MX's GPU backend through MI's
// host, or the dev page's synthetic buffers):
//   prepare      cull + LOD + compaction of every grain into draw lists, occupancy grid (wgsl.ts PREPARE_WGSL)
//   shadow       sand and marbles into the key light's shadow map (light-facing quads)
//   look prepass sand and marbles into the half-res depth: GTAO (contact darkening), fog and DOF see the piles
//   main pass    sand + marble impostors, GLINT marbles as meshes at LOD0, container fill contents (fill.ts)
//   afterOpaque  water and goo: sphere depth splat, thickness + foam + goo, bilateral smoothing (compute)
//   late pass    water / goo composite before glass (refraction, absorption, Fresnel IBL, foam; kn_slime for goo, X5)
// With no source (or no live grains) the hook records nothing and the frame is unchanged: the Studio and every look
// without Matter cost nothing.

import { lookAt, mul, perspective, type Mat4 } from '../../math.ts';
import { giWgsl } from '../gi.ts';
import type { Renderer } from '../renderer.ts';
import { PART_FS_WGSL } from '../shaders.ts';
import { VERTEX_STRIDE } from '../meshes.ts';
import { FillPass } from './fill.ts';
import { matterSource, RADIUS, type FillItem, type MatterView, type MatterViewSource } from './types.ts';
import {
  ARGS_PRE_POINTS, ARGS_SOLID, CTL, IMPACTS, FLUID_COMPOSITE_WGSL, FLUID_SMOOTH_WGSL, FLUID_SPLAT_WGSL, GRID_SHIFT, LIST, LISTS, MATTER_SHADE_WGSL, MU_BYTES,
  PREPARE_WGSL, PU_BYTES, SHADOW_WGSL,
} from './wgsl.ts';

export * from './types.ts';
export { ContainerFills, CONTAINER_TYPES } from './containers.ts';
export { DEFAULT_FILL } from './fill.ts';

type Tier = 4 | 8 | 12 | 16 | 32;

/** Quality by tier (RENDERING §12: transmission + Matter surfaces 1.5 ms on the 16 GB tier). */
export interface MatterQuality {
  /** Projected radius (px) from which a sand grain is an exact sphere (below: a flat quad). */
  readonly nearPx: number;
  /** Projected radius (px) from which a GLINT marble is the real mesh (LOD0). */
  readonly meshPx: number;
  /** Water targets at full (1) or half (0.5) internal resolution. */
  readonly waterScale: 1 | 0.5;
  /** Bilateral smoothing rounds (each a horizontal + vertical pass). */
  readonly blurRounds: number;
  /** Occupancy grid cells, log2. */
  readonly gridLog2: number;
  /** Grains cast into the key light's shadow map. */
  readonly shadows: boolean;
  /** Grains in the look's half-res depth prepass (GTAO / fog / DOF). */
  readonly prepass: boolean;
}

export const MATTER_QUALITY: Record<Tier, MatterQuality> = {
  4: { nearPx: 3, meshPx: 1e9, waterScale: 0.5, blurRounds: 1, gridLog2: 20, shadows: false, prepass: false },
  8: { nearPx: 2, meshPx: 20, waterScale: 0.5, blurRounds: 1, gridLog2: 21, shadows: true, prepass: true },
  12: { nearPx: 1.5, meshPx: 14, waterScale: 0.5, blurRounds: 2, gridLog2: 22, shadows: true, prepass: true },
  16: { nearPx: 1.5, meshPx: 12, waterScale: 1, blurRounds: 2, gridLog2: 23, shadows: true, prepass: true },
  32: { nearPx: 1.2, meshPx: 10, waterScale: 1, blurRounds: 2, gridLog2: 23, shadows: true, prepass: true },
};

const lin = (h: string): [number, number, number] => [1, 3, 5].map((i) => {
  const v = parseInt(h.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}) as [number, number, number];

/** Looks (vfx §0.4 palette, matter.md): exposed so the dev page can tune them live. */
export const MATTER_LOOK = {
  sand: [...lin('#D6BE8E'), 0.92] as number[],
  sandVar: [0.16, 0.12, 0.06, 0.6] as number[],
  glint: [0.024, 0.57, 0.85, 0.12] as number[], // kn_ceramic_beam (the marble art's master)
  bearing: [0.92, 0.92, 0.94, 0.08] as number[], // kn_chrome
  /** Absorption per metre: 1 − Beam (#2FD6FF) scaled so 0.25 m of water reads as clearly tinted, never murky. */
  absorb: [3.2, 1.0, 0.2] as number[],
  refraction: 0.035,
  foam: 1.0,
  splat: 1.25,
  filter: 3.0,
  /** Debug views of the water composite: 0 off, 1 water pixels red, 2 thickness, 3 transmittance, 4 normals. */
  debug: 0 as number,
  /** X5 (M5): goo, kn_slime (#7DFF7A, transmission 0.6, SSS): albedo (linear), absorption per metre, subsurface, transmission. */
  goo: lin('#7DFF7A') as number[],
  gooAbsorb: 55,
  gooSss: 1.0,
  gooTransmission: 0.6,
};

const HDR: GPUTextureFormat = 'rgba16float';
const MSAA = 4;

export class MatterRenderer {
  readonly quality: MatterQuality;
  /** Overrides the registered source (dev page, benchmarks); null = `matterSource()`. */
  source: MatterViewSource | null = null;
  enabled = true;
  /** Water passes run when the last readback saw water (or always, when forced). */
  forceWater = false;
  /** Last read-back list sizes (one or two frames late): point, sandFar, near, marbleMesh, water, shadow, shadowPt. */
  readonly counts = new Uint32Array(LISTS);
  fill!: FillPass;
  private readonly r: Renderer;
  private d!: GPUDevice;
  private view: MatterView | null = null;
  private active = false;
  private waterSeen = 0;
  // prepare
  private pu!: GPUBuffer;
  private mu!: GPUBuffer;
  private ctl!: GPUBuffer;
  private entries: GPUBuffer | null = null;
  private entryCap = 0;
  private grid: GPUBuffer | null = null;
  private vgrid: GPUBuffer | null = null;
  private cls: GPUBuffer | null = null;
  /** Skip sand and marbles buried under full cells (no draw, no shadow); off for A/B. */
  cullBuried = true;
  private prepLayout!: GPUBindGroupLayout;
  private prep: Record<'reset' | 'clearGrid' | 'splat' | 'count' | 'plan' | 'scatter', GPUComputePipeline> | null = null;
  private prepBind: GPUBindGroup | null = null;
  private prepKey: unknown[] = [];
  // draws
  private grainLayout!: GPUBindGroupLayout;
  private grainBind: GPUBindGroup | null = null;
  private pipesBuilding = false;
  private pipes: {
    far: GPURenderPipeline; near: GPURenderPipeline; mesh: GPURenderPipeline; pre: GPURenderPipeline | null; shadow: GPURenderPipeline;
    point: GPURenderPipeline; prePoint: GPURenderPipeline | null; shadowPoint: GPURenderPipeline;
    depth: GPURenderPipeline; thick: GPURenderPipeline; resolve: GPURenderPipeline; composite: GPURenderPipeline;
    linear: GPUComputePipeline; blur: GPUComputePipeline;
  } | null = null;
  private shadowLayout!: GPUBindGroupLayout;
  private shadowBind: GPUBindGroup | null = null;
  // fluid
  private splatLayout!: GPUBindGroupLayout;
  private smoothLayout!: GPUBindGroupLayout;
  private compLayout!: GPUBindGroupLayout;
  private fluid: {
    w: number; h: number; depth: GPUTexture; thick: GPUTexture; a: GPUTexture; b: GPUTexture;
    groups: GPUBindGroup[]; splat: GPUBindGroup | null; splatDepth: GPUTexture | null; comp: GPUBindGroup | null; compScene: GPUTexture | null;
  } | null = null;
  private dirBufs!: GPUBuffer[];
  private waterThisFrame = false;
  private readbacks: { buf: GPUBuffer; busy: boolean }[] = [];
  private readonly partCode: string;
  stats = { slots: 0, frames: 0 };

  constructor(renderer: Renderer, tier: Tier) {
    this.r = renderer;
    this.quality = MATTER_QUALITY[tier] ?? MATTER_QUALITY[16];
    this.partCode = PART_FS_WGSL.replace('// @@GI@@', giWgsl(3));
    this.init();
    // V4 (M4): after a device loss the renderer rebuilds on a new device and drops its hooks: rebuild everything
    renderer.onRestore(() => this.init());
  }

  /** Creates every GPU object on the renderer's current device (boot, and again after a device-loss recovery). */
  private init(): void {
    this.d = this.r.device;
    const d = this.d;
    const renderer = this.r;
    // lazily built state from a previous device is dropped
    this.pipes = null; this.pipesBuilding = false; this.prep = null;
    this.entries = null; this.entryCap = 0; this.grid = null; this.vgrid = null; this.cls = null;
    this.prepBind = null; this.prepKey = []; this.grainBind = null; this.shadowBind = null; this.fluid = null;
    this.wScene = null; this.compWScene = null; this.blitBind = null; this.compScene = null; this.readbacks = [];
    this.active = false; this.waterSeen = 0; this.waterThisFrame = false;
    const U = GPUBufferUsage;
    this.pu = d.createBuffer({ label: 'matter.pu', size: PU_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.mu = d.createBuffer({ label: 'matter.mu', size: MU_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.ctl = d.createBuffer({ label: 'matter.ctl', size: CTL.words * 4, usage: U.STORAGE | U.INDIRECT | U.COPY_SRC | U.COPY_DST });
    const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.prepLayout = d.createBindGroupLayout({
      label: 'matter.prep',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, buffer: { type: 'uniform' } },
        { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: C, buffer: { type: 'storage' } }, { binding: 6, visibility: C, buffer: { type: 'storage' } },
        { binding: 7, visibility: C, buffer: { type: 'storage' } }, { binding: 8, visibility: C, buffer: { type: 'storage' } },
        { binding: 9, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    const prepMod = d.createShaderModule({ label: 'matter.prepare', code: PREPARE_WGSL });
    const prepPL = d.createPipelineLayout({ bindGroupLayouts: [this.prepLayout] });
    // async: no compile hitch, and a failure turns Matter off instead of invalidating every frame
    const cp = (entryPoint: string): Promise<GPUComputePipeline> => d.createComputePipelineAsync({ label: `matter.${entryPoint}`, layout: prepPL, compute: { module: prepMod, entryPoint } });
    void Promise.all([cp('reset'), cp('clearGrid'), cp('splat'), cp('count'), cp('plan'), cp('scatter')])
      .then(([reset, clearGrid, splat, count, plan, scatter]) => { this.prep = { reset, clearGrid, splat, count, plan, scatter }; })
      .catch((e: unknown) => { console.error('matter: prepare pipelines failed; Matter surfaces are off', e); this.enabled = false; });
    this.grainLayout = d.createBindGroupLayout({
      label: 'matter.grain',
      entries: [
        { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: V | F, buffer: { type: 'uniform' } },
      ],
    });
    this.shadowLayout = d.createBindGroupLayout({
      label: 'matter.shadow',
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } }, { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: V | F, buffer: { type: 'uniform' } },
      ],
    });
    this.splatLayout = d.createBindGroupLayout({
      label: 'matter.splat',
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } }, { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: V | F, buffer: { type: 'uniform' } },
        { binding: 4, visibility: F, texture: { sampleType: 'depth', multisampled: true } },
      ],
    });
    this.smoothLayout = d.createBindGroupLayout({
      label: 'matter.smooth',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, buffer: { type: 'uniform' } },
        { binding: 2, visibility: C, texture: { sampleType: 'depth' } },
        { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        { binding: 4, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
        { binding: 6, visibility: C, buffer: { type: 'uniform' } },
      ],
    });
    this.compLayout = d.createBindGroupLayout({
      label: 'matter.composite',
      entries: [
        { binding: 3, visibility: V | F, buffer: { type: 'uniform' } },
        { binding: 4, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float' } },
      ],
    });
    this.dirBufs = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0]].map((v) => {
      const b = d.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
      d.queue.writeBuffer(b, 0, new Int32Array(v));
      return b;
    });
    this.fill = new FillPass(renderer, this.partCode, this.fill);
    this.fill.useUniform(this.mu);
    const self = this;
    renderer.addHook({
      prepare: (enc) => self.prepare(enc),
      drawShadow: (pass) => self.drawShadow(pass),
      drawPrepass: (pass) => self.drawPrepass(pass),
      drawOpaque: (pass) => self.drawOpaque(pass),
      needsDepth: () => self.waterOn(),
      needsScene: () => self.waterOn(),
      afterOpaque: (enc, depth, scene) => self.afterOpaque(enc, depth, scene),
      drawMatter: (pass) => self.drawComposite(pass),
      glassScene: () => self.glassScene(),
    });
  }

  /** This frame's containers (main.ts: from the parts and `fill(part)` in keyframes). */
  setFills(items: readonly FillItem[]): void { this.fill.set(items); }

  /** Pure (the renderer may short-circuit the hook calls): water passes this frame. */
  private waterOn(): boolean { return (this.active && (this.forceWater || this.waterSeen > 0)) || this.fill.hasWater; }

  // ---- pipelines (built on first use: no cost until Matter appears) ------------------------------------

  /** The draw pipelines, built asynchronously on first use (null until ready; a failure turns Matter off). */
  private ensurePipes(): NonNullable<MatterRenderer['pipes']> | null {
    if (this.pipes) return this.pipes;
    if (this.pipesBuilding) return null;
    this.pipesBuilding = true;
    const d = this.d;
    const mt = this.r.matterTargets();
    const mod = d.createShaderModule({ label: 'matter.shade', code: `${this.partCode}\n${MATTER_SHADE_WGSL}\n${FLUID_COMPOSITE_WGSL}` });
    const pl = d.createPipelineLayout({ bindGroupLayouts: [mt.partLayout, this.grainLayout, mt.lookLayout, mt.giLayout] });
    const compPL = d.createPipelineLayout({ bindGroupLayouts: [mt.partLayout, this.compLayout, mt.lookLayout, mt.giLayout] });
    const depth: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const grain = (vs: string, fs: string, base: number): Promise<GPURenderPipeline> => d.createRenderPipelineAsync({
      label: `matter.${vs}`, layout: pl,
      vertex: { module: mod, entryPoint: vs, constants: { M_BASE: base } },
      fragment: { module: mod, entryPoint: fs, targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depth, multisample: { count: MSAA, alphaToCoverageEnabled: true },
    });
    const vbuf: GPUVertexBufferLayout = {
      arrayStride: VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm16x4' },
        { shaderLocation: 2, offset: 20, format: 'unorm8x4' }, { shaderLocation: 3, offset: 24, format: 'unorm8x4' },
        { shaderLocation: 4, offset: 28, format: 'unorm16x2' },
      ],
    };
    const shadowMod = d.createShaderModule({ label: 'matter.shadow', code: SHADOW_WGSL });
    const splatMod = d.createShaderModule({ label: 'matter.splat', code: FLUID_SPLAT_WGSL });
    const smoothMod = d.createShaderModule({ label: 'matter.smooth', code: FLUID_SMOOTH_WGSL });
    const splatPL = d.createPipelineLayout({ bindGroupLayouts: [this.splatLayout] });
    const smoothPL = d.createPipelineLayout({ bindGroupLayouts: [this.smoothLayout] });
    const P = {
      far: grain('vs_grain_far', 'fs_grain_far', LIST.sandFar),
      point: d.createRenderPipelineAsync({
        label: 'matter.point', layout: pl,
        vertex: { module: mod, entryPoint: 'vs_grain_point', constants: { M_BASE: LIST.point } },
        fragment: { module: mod, entryPoint: 'fs_grain_point', targets: [{ format: HDR }] },
        primitive: { topology: 'point-list' },
        depthStencil: depth, multisample: { count: MSAA },
      }),
      prePoint: this.quality.prepass ? d.createRenderPipelineAsync({
        label: 'matter.prepass_point', layout: pl,
        vertex: { module: mod, entryPoint: 'vs_grain_point_pre', constants: { M_BASE: LIST.point } },
        primitive: { topology: 'point-list' },
        depthStencil: { format: mt.prepassFormat, depthWriteEnabled: true, depthCompare: 'less' },
      }) : null,
      shadowPoint: d.createRenderPipelineAsync({
        label: 'matter.shadow_point', layout: d.createPipelineLayout({ bindGroupLayouts: [this.shadowLayout] }),
        vertex: { module: shadowMod, entryPoint: 'vs_shadow_point' },
        primitive: { topology: 'point-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }, // points take no depth bias: the shader pushes them back
      }),
      near: grain('vs_grain', 'fs_grain', LIST.near),
      mesh: d.createRenderPipelineAsync({
        label: 'matter.marble_mesh', layout: pl,
        vertex: { module: mod, entryPoint: 'vs_marble_mesh', buffers: [vbuf], constants: { M_BASE: LIST.marbleMesh } },
        fragment: { module: mod, entryPoint: 'fs_part', targets: [{ format: HDR }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth, multisample: { count: MSAA, alphaToCoverageEnabled: true },
      }),
      pre: this.quality.prepass ? d.createRenderPipelineAsync({
        label: 'matter.prepass', layout: pl,
        vertex: { module: mod, entryPoint: 'vs_grain_pre', constants: { M_BASE: LIST.near } }, // lists 2-3 (ARGS_SOLID)
        fragment: { module: mod, entryPoint: 'fs_grain_pre', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: mt.prepassFormat, depthWriteEnabled: true, depthCompare: 'less' },
      }) : null,
      shadow: d.createRenderPipelineAsync({
        label: 'matter.shadow', layout: d.createPipelineLayout({ bindGroupLayouts: [this.shadowLayout] }),
        vertex: { module: shadowMod, entryPoint: 'vs_shadow' },
        fragment: { module: shadowMod, entryPoint: 'fs_shadow', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
      }),
      depth: d.createRenderPipelineAsync({
        label: 'matter.water_depth', layout: splatPL,
        vertex: { module: splatMod, entryPoint: 'vs_depth' },
        fragment: { module: splatMod, entryPoint: 'fs_depth', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      thick: d.createRenderPipelineAsync({
        label: 'matter.water_thick', layout: splatPL,
        vertex: { module: splatMod, entryPoint: 'vs_thick' },
        fragment: {
          module: splatMod, entryPoint: 'fs_thick',
          targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      }),
      resolve: d.createRenderPipelineAsync({
        label: 'matter.water_resolve', layout: compPL,
        vertex: { module: mod, entryPoint: 'vs_water' },
        fragment: { module: mod, entryPoint: 'fs_water_resolve', targets: [{ format: HDR }] },
        primitive: { topology: 'triangle-list' },
      }),
      composite: d.createRenderPipelineAsync({
        label: 'matter.water_blit', layout: compPL,
        vertex: { module: mod, entryPoint: 'vs_water' },
        fragment: { module: mod, entryPoint: 'fs_water_blit', targets: [{ format: HDR }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: depth, multisample: { count: MSAA },
      }),
      linear: d.createComputePipelineAsync({ label: 'matter.water_linear', layout: smoothPL, compute: { module: smoothMod, entryPoint: 'linear' } }),
      blur: d.createComputePipelineAsync({ label: 'matter.water_blur', layout: smoothPL, compute: { module: smoothMod, entryPoint: 'blur' } }),
    };
    const keys = Object.keys(P) as (keyof typeof P)[];
    void Promise.all(keys.map((k) => P[k])).then((vals) => {
      const o: Record<string, unknown> = {};
      keys.forEach((k, i) => { o[k] = vals[i]; });
      this.pipes = o as unknown as NonNullable<MatterRenderer['pipes']>;
    }).catch((e: unknown) => { console.error('matter: draw pipelines failed; Matter surfaces are off', e); this.enabled = false; });
    return null;
  }

  // ---- prepare -----------------------------------------------------------------------------------------

  private prepare(enc: GPUCommandEncoder): void {
    this.waterThisFrame = false;
    this.compScene = null;
    this.fill.frame();
    const src = this.source ?? matterSource();
    const v = this.enabled ? src?.view?.() ?? null : null;
    this.view = v && v.count > 0 && v.device === this.d ? v : null;
    this.active = this.view !== null;
    if (this.active || this.fill.any) this.writeMu();
    if (!this.active) { this.waterSeen = 0; return; }
    const view = this.view!;
    if (!this.ensurePipes() || !this.prep) { this.active = false; return; }
    const d = this.d;
    const n = view.count;
    if (!this.entries || this.entryCap < n * 2) {
      this.entries?.destroy();
      this.entryCap = Math.max(1 << 16, Math.ceil(n * 2 * 1.25));
      this.entries = d.createBuffer({ label: 'matter.entries', size: this.entryCap * 16, usage: GPUBufferUsage.STORAGE });
      this.cls?.destroy();
      this.cls = d.createBuffer({ label: 'matter.cls', size: Math.ceil(this.entryCap / 2) * 4, usage: GPUBufferUsage.STORAGE });
      this.grainBind = this.shadowBind = null;
      if (this.fluid) this.fluid.splat = null;
    }
    const cells = 1 << this.quality.gridLog2;
    const vcells = 1 << 20;
    if (!this.grid) this.grid = d.createBuffer({ label: 'matter.grid', size: cells * 4, usage: GPUBufferUsage.STORAGE });
    if (!this.vgrid) this.vgrid = d.createBuffer({ label: 'matter.vgrid', size: vcells * 12, usage: GPUBufferUsage.STORAGE });
    const key = [view.pos, view.vel, view.mat, this.entries, this.grid, this.vgrid, this.cls];
    if (!this.prepBind || key.some((x, i) => x !== this.prepKey[i])) {
      this.prepKey = key;
      const frame = this.r.spectacleTargets().frameBuf;
      this.prepBind = d.createBindGroup({
        layout: this.prepLayout,
        entries: [frame, this.pu, view.pos, view.vel, view.mat, this.ctl, this.entries, this.grid, this.vgrid, this.cls!].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    }
    this.writeUniforms(view, cells, vcells);
    const ts = this.r.timer.compute('matter.prep');
    const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
    pass.setBindGroup(0, this.prepBind);
    const prep = this.prep;
    pass.setPipeline(prep.reset);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(prep.clearGrid);
    dispatch(pass, Math.max(cells, vcells));
    pass.setPipeline(prep.splat);
    dispatch(pass, n);
    pass.setPipeline(prep.count);
    dispatch(pass, n);
    pass.setPipeline(prep.plan);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(prep.scatter);
    dispatch(pass, n);
    pass.end();
    this.readCounts(enc);
    this.stats.slots = n;
    this.stats.frames++;
  }

  private writeUniforms(v: MatterView, cells: number, vcells: number): void {
    const r = this.r;
    const [, ih] = r.internalSize;
    const fov = r.fovDeg;
    const pxPerUnit = ih / 2 / Math.tan((fov * Math.PI) / 360);
    const e = r.eye;
    const fix = e.map((x) => Math.round(x * 65536));
    const b = new ArrayBuffer(PU_BYTES), i32 = new Int32Array(b), u32 = new Uint32Array(b), f = new Float32Array(b);
    i32.set([fix[0]!, fix[1]!, fix[2]!, v.count], 0);
    f.set([e[0] - fix[0]! / 65536, e[1] - fix[1]! / 65536, e[2] - fix[2]! / 65536, v.velScale ?? 240 / 65536], 4);
    u32.set([v.posStride ?? 3, v.velStride ?? 3, cells - 1, 1 | (this.quality.shadows ? 2 : 0)], 8);
    u32.set([cells - 1, vcells - 1, 40, this.cullBuried ? 1 : 0], 48);
    f.set([pxPerUnit, this.quality.nearPx, this.quality.meshPx, performance.now() / 1000], 12);
    f.set([RADIUS.sand, RADIUS.water, RADIUS.marble, RADIUS.goo], 16);
    const lib = r.lib;
    const lod = lib.has('marble') ? lib.meshes[lib.id('marble')]!.lods[0] : undefined;
    u32.set([lod?.indexCount ?? 0, lod?.firstIndex ?? 0, lod?.baseVertex ?? 0, 6], 20);
    planes(this.relViewProj()).forEach((p, k) => f.set(p, 24 + k * 4));
    this.d.queue.writeBuffer(this.pu, 0, b);
  }

  /** The shading uniform (grains, fill contents and water share it). */
  private writeMu(): void {
    const r = this.r;
    const [, ih] = r.internalSize;
    const pxPerUnit = ih / 2 / Math.tan((r.fovDeg * Math.PI) / 360);
    const m = new Float32Array(MU_BYTES / 4);
    const L = MATTER_LOOK;
    m.set([pxPerUnit, r.internalSize[0], ih, L.debug ? -Number(L.debug) : performance.now() / 1000], 0);
    m.set(L.sand, 4); m.set(L.sandVar, 8); m.set(L.glint, 12); m.set(L.bearing, 16);
    m.set([RADIUS.sand, RADIUS.water, RADIUS.marble, L.splat], 20);
    m.set([...L.absorb, L.refraction], 24);
    m.set([RADIUS.water * 2, L.foam, this.quality.waterScale, L.filter], 28);
    m.set([RADIUS.goo, RADIUS.goo * 2, L.gooSss, L.gooTransmission], 32); // X5: goo
    m.set([...L.goo, L.gooAbsorb], 36);
    this.d.queue.writeBuffer(this.mu, 0, m);
  }

  /** The un-jittered camera-relative view-projection (the renderer's own, for culling). */
  private relViewProj(): Mat4 {
    const r = this.r, t = r.target, e = r.eye;
    const aspect = r.canvas.width / Math.max(1, r.canvas.height);
    return mul(perspective((r.fovDeg * Math.PI) / 180, aspect, 0.02, 2000), lookAt([0, 0, 0], [t[0] - e[0], t[1] - e[1], t[2] - e[2]], [0, 1, 0]));
  }

  private readCounts(enc: GPUCommandEncoder): void {
    let s = this.readbacks.find((x) => !x.busy);
    if (!s) {
      if (this.readbacks.length >= 3) return;
      s = { buf: this.d.createBuffer({ size: CTL.words * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false };
      this.readbacks.push(s);
    }
    enc.copyBufferToBuffer(this.ctl, 0, s.buf, 0, CTL.words * 4);
    s.busy = true;
    const slot = s;
    queueMicrotask(() => {
      void slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const c = new Uint32Array(slot.buf.getMappedRange(0, CTL.words * 4));
        this.counts.set(c.subarray(0, LISTS));
        this.takeImpacts(new Int32Array(c.buffer, c.byteOffset + CTL.impacts * 4, 1 + IMPACTS * 3));
        slot.buf.unmap();
        slot.busy = false;
        this.waterSeen = this.counts[LIST.water]! > 0 ? 3 : Math.max(0, this.waterSeen - 1);
      }).catch(() => { slot.busy = false; });
    });
  }

  /** Sand impacts read back from the prepare pass → `onImpacts` (fx sand puffs), at most one per 6 cm cell per 0.4 s. */
  onImpacts: ((points: [number, number, number][]) => void) | null = null;
  private readonly puffAt = new Map<number, number>();
  private takeImpacts(w: Int32Array): void {
    const n = Math.min(IMPACTS, w[0]!);
    if (!n || !this.onImpacts) return;
    const now = performance.now();
    const out: [number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const p: [number, number, number] = [w[1 + k * 3]! / 65536, w[2 + k * 3]! / 65536, w[3 + k * 3]! / 65536];
      const key = Math.floor(p[0] / 0.06) * 73856093 ^ Math.floor(p[1] / 0.06) * 19349663 ^ Math.floor(p[2] / 0.06) * 83492791;
      if ((this.puffAt.get(key) ?? 0) > now) continue;
      this.puffAt.set(key, now + 400);
      out.push(p);
    }
    if (this.puffAt.size > 4096) this.puffAt.clear();
    if (out.length) this.onImpacts(out);
  }

  // ---- draws -------------------------------------------------------------------------------------------

  private grainGroup(): GPUBindGroup {
    this.grainBind ??= this.d.createBindGroup({
      layout: this.grainLayout,
      entries: [{ binding: 1, resource: { buffer: this.entries! } }, { binding: 2, resource: { buffer: this.ctl } }, { binding: 3, resource: { buffer: this.mu } }],
    });
    return this.grainBind;
  }

  private drawShadow(pass: GPURenderPassEncoder): void {
    if (this.active && this.quality.shadows) {
      const p = this.ensurePipes();
      if (!p) return;
      this.shadowBind ??= this.d.createBindGroup({
        layout: this.shadowLayout,
        entries: [this.r.spectacleTargets().frameBuf, this.entries!, this.ctl, this.mu].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      pass.setPipeline(p.shadow);
      pass.setBindGroup(0, this.shadowBind);
      pass.drawIndirect(this.ctl, argsOffset(LIST.shadow));
      pass.setPipeline(p.shadowPoint);
      pass.drawIndirect(this.ctl, argsOffset(LIST.shadowPt));
    }
    this.fill.drawShadow(pass);
  }

  private drawPrepass(pass: GPURenderPassEncoder): void {
    if (this.active) {
      const p = this.ensurePipes();
      if (p?.pre) {
        const mt = this.r.matterTargets();
        pass.setPipeline(p.pre);
        pass.setBindGroup(0, mt.group0);
        pass.setBindGroup(1, this.grainGroup());
        pass.setBindGroup(2, mt.look);
        pass.setBindGroup(3, mt.gi);
        pass.drawIndirect(this.ctl, argsOffset(ARGS_SOLID));
        if (p.prePoint) { pass.setPipeline(p.prePoint); pass.drawIndirect(this.ctl, argsOffset(ARGS_PRE_POINTS)); }
      }
    }
    this.fill.drawPrepass(pass);
  }

  private drawOpaque(pass: GPURenderPassEncoder): void {
    if (this.active) {
      const p = this.ensurePipes();
      if (!p) return;
      const mt = this.r.matterTargets();
      pass.setBindGroup(0, mt.group0);
      pass.setBindGroup(1, this.grainGroup());
      pass.setBindGroup(2, mt.look);
      pass.setBindGroup(3, mt.gi);
      pass.setPipeline(p.point);
      pass.drawIndirect(this.ctl, argsOffset(LIST.point));
      pass.setPipeline(p.far);
      pass.drawIndirect(this.ctl, argsOffset(LIST.sandFar));
      pass.setPipeline(p.near);
      pass.drawIndirect(this.ctl, argsOffset(LIST.near));
      const lib = this.r.lib;
      if (lib.has('marble') && lib.vertexBuffer && lib.indexBuffer) {
        pass.setPipeline(p.mesh);
        pass.setVertexBuffer(0, lib.vertexBuffer);
        pass.setIndexBuffer(lib.indexBuffer, 'uint32');
        pass.drawIndexedIndirect(this.ctl, argsOffset(LIST.marbleMesh));
      }
    }
    this.fill.drawOpaque(pass);
  }

  // ---- water -------------------------------------------------------------------------------------------

  private ensureFluid(): NonNullable<MatterRenderer['fluid']> {
    const [iw, ih] = this.r.internalSize;
    const s = this.quality.waterScale;
    const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    if (this.fluid && this.fluid.w === w && this.fluid.h === h) return this.fluid;
    if (this.fluid) for (const t of [this.fluid.depth, this.fluid.thick, this.fluid.a, this.fluid.b]) t.destroy();
    const d = this.d, T = GPUTextureUsage;
    const depth = d.createTexture({ label: 'matter.water.depth', size: [w, h], format: 'depth32float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING | T.COPY_SRC });
    // r thickness, g foam, b goo thickness (X5)
    const thick = d.createTexture({ label: 'matter.water.thick', size: [Math.max(1, w >> 1), Math.max(1, h >> 1)], format: 'rgba16float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    const mk = (label: string): GPUTexture => d.createTexture({ label, size: [w, h], format: 'rgba32float', usage: T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC }); // COPY_SRC: debug readback
    const a = mk('matter.water.a'), b = mk('matter.water.b');
    const frame = this.r.spectacleTargets().frameBuf;
    const g = (src: GPUTexture, dst: GPUTexture, dir: GPUBuffer): GPUBindGroup => d.createBindGroup({
      layout: this.smoothLayout,
      entries: [
        { binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: this.mu } },
        { binding: 2, resource: depth.createView() }, { binding: 3, resource: src.createView() },
        { binding: 4, resource: thick.createView() }, { binding: 5, resource: dst.createView() },
        { binding: 6, resource: { buffer: dir } },
      ],
    });
    // [linear: depth → a], [h: a → b], [v: b → a], [v final: b → a]
    const groups = [g(b, a, this.dirBufs[0]!), g(a, b, this.dirBufs[0]!), g(b, a, this.dirBufs[1]!), g(b, a, this.dirBufs[2]!)];
    this.fluid = { w, h, depth, thick, a, b, groups, splat: null, splatDepth: null, comp: null, compScene: null };
    return this.fluid;
  }

  private afterOpaque(enc: GPUCommandEncoder, sceneDepth: GPUTexture, scene: GPUTexture | null): void {
    this.waterThisFrame = this.waterOn() && scene !== null;
    if (!this.waterThisFrame || !scene) { this.compScene = null; return; }
    const p = this.ensurePipes();
    if (!p) { this.waterThisFrame = false; return; }
    const fl = this.ensureFluid();
    const d = this.d;
    this.fill.prepareWater(sceneDepth);
    this.entries ??= d.createBuffer({ label: 'matter.entries', size: 1 << 16, usage: GPUBufferUsage.STORAGE });
    if (!fl.splat || fl.splatDepth !== sceneDepth) {
      fl.splatDepth = sceneDepth;
      fl.splat = d.createBindGroup({
        layout: this.splatLayout,
        entries: [
          { binding: 0, resource: { buffer: this.r.spectacleTargets().frameBuf } }, { binding: 1, resource: { buffer: this.entries! } },
          { binding: 2, resource: { buffer: this.ctl } }, { binding: 3, resource: { buffer: this.mu } },
          { binding: 4, resource: sceneDepth.createView() },
        ],
      });
    }
    {
      const ts = this.r.timer.render('matter.water.splat');
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: fl.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        ...(ts ? { timestampWrites: ts } : {}),
      });
      if (this.active) {
        pass.setPipeline(p.depth);
        pass.setBindGroup(0, fl.splat);
        pass.drawIndirect(this.ctl, argsOffset(LIST.water));
      }
      this.fill.drawWaterDepth(pass);
      pass.end();
    }
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: fl.thick.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      if (this.active) {
        pass.setPipeline(p.thick);
        pass.setBindGroup(0, fl.splat);
        pass.drawIndirect(this.ctl, argsOffset(LIST.water));
      }
      this.fill.drawWaterThick(pass);
      pass.end();
    }
    {
      const ts = this.r.timer.compute('matter.water.smooth');
      const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
      const gx = Math.ceil(fl.w / 8), gy = Math.ceil(fl.h / 8);
      pass.setPipeline(p.linear);
      pass.setBindGroup(0, fl.groups[0]!);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(p.blur);
      const rounds = this.quality.blurRounds;
      for (let k = 0; k < rounds; k++) {
        pass.setBindGroup(0, fl.groups[1]!);
        pass.dispatchWorkgroups(gx, gy);
        pass.setBindGroup(0, fl.groups[k === rounds - 1 ? 3 : 2]!);
        pass.dispatchWorkgroups(gx, gy);
      }
      pass.end();
    }
    // the water over the opaque scene, resolved once (non-MSAA): the late pass blits it, and glass refracts it
    if (!this.wScene || this.wScene.width !== scene.width || this.wScene.height !== scene.height) {
      this.wScene?.destroy();
      this.wScene = d.createTexture({ label: 'matter.water.scene', size: [scene.width, scene.height], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      fl.comp = null;
    }
    if (!fl.comp || fl.compScene !== scene || this.compWScene !== this.wScene) {
      fl.compScene = scene;
      this.compWScene = this.wScene;
      const g = (tex: GPUTexture): GPUBindGroup => d.createBindGroup({
        layout: this.compLayout,
        entries: [{ binding: 3, resource: { buffer: this.mu } }, { binding: 4, resource: fl.a.createView() }, { binding: 5, resource: tex.createView() }],
      });
      fl.comp = g(scene);
      this.blitBind = g(this.wScene);
    }
    {
      const ts = this.r.timer.render('matter.water.shade');
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.wScene.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        ...(ts ? { timestampWrites: ts } : {}),
      });
      const mt = this.r.matterTargets();
      pass.setPipeline(p.resolve);
      pass.setBindGroup(0, mt.group0);
      pass.setBindGroup(1, fl.comp);
      pass.setBindGroup(2, mt.look);
      pass.setBindGroup(3, mt.gi);
      pass.draw(3);
      pass.end();
    }
    this.compScene = scene;
  }
  private compScene: GPUTexture | null = null;
  private wScene: GPUTexture | null = null;
  private compWScene: GPUTexture | null = null;
  private blitBind: GPUBindGroup | null = null;

  /** The opaque scene with the water resolved in, for the transmission pass (null: the renderer's own copy). */
  private glassScene(): GPUTexture | null { return this.waterThisFrame && this.compScene ? this.wScene : null; }

  private drawComposite(pass: GPURenderPassEncoder): void {
    if (!this.waterThisFrame || !this.compScene || !this.fluid) return;
    const p = this.ensurePipes();
    if (!p) return;
    if (!this.blitBind) return;
    const mt = this.r.matterTargets();
    pass.setPipeline(p.composite);
    pass.setBindGroup(0, mt.group0);
    pass.setBindGroup(1, this.blitBind);
    pass.setBindGroup(2, mt.look);
    pass.setBindGroup(3, mt.gi);
    pass.draw(3);
  }
}

const argsOffset = (slot: number): number => (CTL.args + slot * 5) * 4;

function dispatch(pass: GPUComputePassEncoder, n: number): void {
  const groups = Math.ceil(n / 256);
  if (groups <= 0) return;
  pass.dispatchWorkgroups(Math.min(groups, 32768), Math.ceil(groups / 32768));
}

/** Frustum planes (normalised, inward) of a WebGPU clip matrix (z in [0, 1]). */
function planes(m: Mat4): [number, number, number, number][] {
  const row = (r: number): number[] => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a: number[], b: number[], s: number): number[] => a.map((x, i) => x + s * b[i]!);
  return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), r2, add(r3, r2, -1)].map((p) => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    return [p[0]! / l, p[1]! / l, p[2]! / l, p[3]! / l];
  });
}

export { GRID_SHIFT };
