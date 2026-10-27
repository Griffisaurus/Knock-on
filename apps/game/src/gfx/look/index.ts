// The D79 warm cinematic look (RENDERING §3 passes 14, 15, 18, 22; §6–7; §9; D79, D81, D82, D85).
// LookPass owns everything the look adds to the renderer:
//   bind group 2 of the part/glass/environment shaders (texture-set arrays, detail layer, set IBL, AO,
//   set shadow), the half-res depth prepass target + AO/contact compute (ao.ts), the set bake
//   (setbake.ts), froxel fog (fog.ts), the grading LUT (lut.ts), the DOF focus, and the live governor.
// The renderer calls, per frame: begin() → [shadow pass] → [depth prepass into `depthTarget`] → ao() →
// fog() → [main pass with `bind`] → [glass with `bindGlass`] → post(look.post()).

import type { Mat4, V3 } from '../../math.ts';
import { dofEnabled } from '../../ui/settings.ts';
import type { GpuTimer } from '../gpu.ts';
import type { MeshLibrary } from '../meshes.ts';
import type { PostLook } from '../post.ts';
import type { StudioLook } from '../renderer.ts';
import { AoPass } from './ao.ts';
import { FogPass } from './fog.ts';
import { Governor } from './governor.ts';
import { gradeTable, loadLutStrip, lutTexture, NEUTRAL_GRADE, parseCube } from './lut.ts';
import { hdrTexture, parseHdr } from './hdr.ts';
import { SetBake, type SetMesh } from './setbake.ts';
import { studioSet, type SetLook } from './sets.ts';
import { TexSets } from './textures.ts';
import { lookTier, type LookTier } from './tiers.ts';
import { Practicals, type Practical } from './practicals.ts';
import { LOOK_U_BYTES } from './wgsl.ts';

export { DETAIL } from './wgsl.ts';
export type { SetLook } from './sets.ts';

/** Feature switches for measurement and debugging (undefined = the tier's default). */
export interface LookForce { practicals?: boolean; texSets?: boolean; gi?: boolean; sdfShadow?: boolean; ao?: boolean; contact?: boolean; ibl?: boolean; detail?: boolean; shafts?: boolean; fog?: boolean; dof?: boolean; lut?: boolean; vignette?: boolean; setShadow?: boolean }

export interface LookFrameInput {
  readonly eye: V3; readonly target: V3; readonly fov: number;
  readonly width: number; readonly height: number;
  readonly runMode: boolean;
  /** Camera-relative view matrix (renderer writeFrame) and the direction to the key light (world). */
  readonly view: Mat4; readonly key: V3;
  /** The selection's world centre (Build), else null. */
  readonly selection: V3 | null;
  readonly lib: MeshLibrary;
  readonly light: StudioLook;
  readonly frameMs: number;
}

export class LookPass {
  readonly device: GPUDevice;
  readonly tier: LookTier;
  readonly tierId: number;
  readonly layout: GPUBindGroupLayout;
  readonly glassLayout: GPUBindGroupLayout;
  readonly tex: TexSets;
  readonly bake: SetBake;
  readonly aoPass: AoPass;
  readonly fogPass: FogPass;
  /** Practical lamps (spot cones; the shadowed one from 12 GB). */
  readonly practicals: Practicals;
  readonly governor = new Governor();
  /** Per-feature overrides (timings, debugging): `renderer.lookPass.force.dof = false`. */
  force: LookForce = {};
  /** Explicit DOF focus point (photo mode, the proof shot); null = selection in Build, camera target in Run. */
  focusPoint: V3 | null = null;
  /** Photo DOF: thin-lens CoC (px at 1080p per dioptre of defocus); 0 = the tilt-shift band. */
  photoCoc = 0;
  /** Weight of G3's probe GI over a set's baked IBL irradiance (the SDF holds the parts, not the set). */
  giBlend = 0.35;
  /** Max DOF radius in output px at 1440p (RENDERING §9: 6 px tilt-shift). */
  dofMaxPx1440 = 6;
  set: SetLook;
  private setMeshes: SetMesh[] = [];
  private bakeDirty = true;
  private lastLight: StudioLook | null = null;
  private readonly uBuf: GPUBuffer;
  private readonly u = new Float32Array(LOOK_U_BYTES / 4);
  private readonly samplers: { look: GPUSampler; clamp: GPUSampler; cmp: GPUSampler };
  private lut: GPUTexture;
  private lutFor = '';
  private bindCache: { key: string; group: GPUBindGroup } | null = null;
  private glassCache: { key: string; group: GPUBindGroup } | null = null;
  private focusDist = 3;
  private lastT = 0;
  private relSetShadow: Mat4 = new Float32Array(16);
  private eye: V3 = [0, 0, 0];
  private size: [number, number] = [1, 1];
  stats = { bakeMs: 0, bakes: 0, focus: 0, ibl: 'in-engine', lut: 'generated' };

  constructor(device: GPUDevice, frameBuf: GPUBuffer, tier: number) {
    this.device = device;
    this.tierId = tier;
    this.tier = lookTier(tier);
    const F = GPUShaderStage.FRAGMENT;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 1, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: F, sampler: { type: 'filtering' } },
      { binding: 4, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: F, texture: { sampleType: 'float', viewDimension: 'cube' } },
      { binding: 6, visibility: F, texture: { sampleType: 'float', viewDimension: 'cube' } },
      { binding: 7, visibility: F | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 8, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 9, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 10, visibility: F, sampler: { type: 'filtering' } },
      { binding: 11, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 12, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 14, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 16, visibility: F, texture: { sampleType: 'depth' } },
    ];
    this.layout = device.createBindGroupLayout({ label: 'look', entries });
    this.glassLayout = device.createBindGroupLayout({ label: 'look.glass', entries: [...entries, { binding: 15, visibility: F, texture: { sampleType: 'float' } }] });
    this.tex = new TexSets(device, this.tier.texSize);
    this.bake = new SetBake(device, this.tier.setShadow, this.tier.iblSize);
    this.aoPass = new AoPass(device, frameBuf);
    this.fogPass = new FogPass(device);
    this.practicals = new Practicals(device, tier >= 12);
    this.uBuf = device.createBuffer({ label: 'look.u', size: LOOK_U_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.samplers = {
      look: device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 }),
      clamp: device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }),
      cmp: device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' }),
    };
    this.lut = lutTexture(device, gradeTable(NEUTRAL_GRADE));
    this.set = studioSet({ cyc: [0.5, 0.5, 0.5], key: [0, 1, 0], fill: [0, 1, 0], rim: [0, 1, 0], keyI: 1, fillI: 0, rimI: 0, rimColor: [1, 1, 1], etch: 0, exposure: 1 });
  }

  /** Whether G3's probe GI may run this frame (tier ≥ 12, and the governor hasn't dropped it). */
  get giAllowed(): boolean { return this.tierId >= 12 && this.governor.state.gi; }
  /** Internal resolution scale from the governor (the renderer's resize applies it). */
  get renderScale(): number { return this.governor.state.scale; }

  /** Switches the environment look (EnvView): set meshes for the bake, or none (Studio). */
  setEnvironment(set: SetLook, meshes: readonly SetMesh[]): void {
    const key = (s: SetMesh): string => `${s.mesh}@${s.offset.join(',')}`;
    if (set === this.set && meshes.length === this.setMeshes.length && meshes.every((m, i) => key(m) === key(this.setMeshes[i]!))) return;
    this.set = set;
    this.setMeshes = [...meshes];
    this.bakeDirty = true;
    void this.loadLut(set);
    void this.loadIbl(set);
  }

  /** The set's baked IBL file (E3b), when it has one; else the in-engine bake from the set mesh. */
  private iblFor = '';
  private async loadIbl(set: SetLook): Promise<void> {
    const want = set.iblFile ?? '';
    if (want === this.iblFor) return;
    this.iblFor = want;
    const old = this.bake.equirect;
    this.bake.equirect = null;
    old?.tex.destroy();
    this.iblMean = null;
    if (!want) return;
    try {
      const res = await fetch(want);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('html')) return;
      const desc = await res.json() as { file?: string; format?: string; meanRadiance?: number[] };
      if (!desc.file || (desc.format && desc.format !== 'equirect-hdr')) return;
      const hr = await fetch('/' + desc.file.replace(/^\/+/, ''));
      if (!hr.ok) return;
      const img = parseHdr(await hr.arrayBuffer());
      if (this.iblFor !== want) return;
      this.bake.equirect = { tex: hdrTexture(this.device, img), scale: set.iblScale ?? 1, flip: this.iblFlip };
      // the room's mean radiance in engine units, as the diffuse IBL is shaded: GI probe rays that miss see this
      const mr = desc.meanRadiance;
      this.iblMean = mr?.length === 3 ? mr.map((v) => v * (set.iblScale ?? 1) * set.ibl.diffuse) : null;
      this.bakeDirty = true;
      this.stats.ibl = desc.file;
    } catch (e) {
      console.warn('ibl:', e);
    }
  }
  /** Mirror the equirect's u (if a bake's handedness differs). */
  iblFlip = false;
  /** The loaded set IBL's mean radiance (engine units), for the GI's probe misses (M3 close-out); null = none. */
  iblMean: number[] | null = null;

  private async loadLut(set: SetLook): Promise<void> {
    if (this.lutFor === set.id) return;
    this.lutFor = set.id;
    let table: Uint8Array | null = null;
    if (set.lutFile) {
      try {
        const r = await fetch(set.lutFile);
        if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) table = parseCube(await r.text());
      } catch { /* the generated grade stands in */ }
    }
    if (!table && set.lutPng) table = await loadLutStrip(set.lutPng);
    this.stats.lut = table ? (set.lutPng ?? set.lutFile ?? '') : 'generated';
    if (this.lutFor !== set.id) return;
    const old = this.lut;
    this.lut = lutTexture(this.device, table ?? gradeTable(set.grade));
    old.destroy();
  }

  private on(k: keyof LookForce, dflt: boolean): boolean { return this.force[k] ?? dflt; }

  get aoOn(): boolean { return this.on('ao', true); }
  get contactOn(): boolean { return this.on('contact', this.tier.contact); }
  get shaftsOn(): boolean { return this.on('shafts', this.tier.fog === 'shafts' && this.governor.state.shafts) && this.set.fog !== null && this.on('fog', true); }
  get dofOn(): boolean {
    // U3: Settings › Graphics › DOF, off under Reduce motion (dofEnabled covers both)
    return this.on('dof', this.tier.dof && dofEnabled() && this.governor.state.dof);
  }

  /** Per frame, after the renderer's setScene/upload and writeFrame: uniforms, bake, focus, governor. */
  begin(f: LookFrameInput): void {
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    this.governor.update(f.frameMs, dt);
    if (this.set.id === 'studio' && f.light !== this.lastLight) { this.set = studioSet(f.light); this.bakeDirty = true; }
    if (f.light !== this.lastLight) { this.lastLight = f.light; this.bakeDirty = true; }
    if (this.bakeDirty && f.lib.vertexBuffer) {
      this.bakeDirty = false;
      const L = f.light, s = this.set, kc = L.keyColor ?? [1, 0.98, 0.95];
      this.bake.bake(f.lib, this.setMeshes, {
        sun: L.key, sunColor: [kc[0] * L.keyI * s.sunScale, kc[1] * L.keyI * s.sunScale, kc[2] * L.keyI * s.sunScale],
        skyTop: s.sky.top, horizon: s.sky.horizon, ground: s.sky.ground, emissive: s.emissive, probe: s.probe, bounds: s.bounds,
      });
      this.stats.bakeMs = this.bake.lastMs;
      this.stats.bakes = this.bake.bakes;
    }
    // DOF focus: explicit point, else the selection in Build, else the camera target (the director's action in Run)
    const fp = this.focusPoint ?? (!f.runMode && f.selection ? f.selection : f.target);
    const fwd = norm3([f.target[0] - f.eye[0], f.target[1] - f.eye[1], f.target[2] - f.eye[2]]);
    const want = Math.max(0.05, (fp[0] - f.eye[0]) * fwd[0] + (fp[1] - f.eye[1]) * fwd[1] + (fp[2] - f.eye[2]) * fwd[2]);
    this.focusDist = this.focusPoint ? want : this.focusDist + (want - this.focusDist) * (1 - Math.exp(-dt / 0.13));
    this.stats.focus = this.focusDist;
    // camera-relative set shadow
    this.eye = f.eye;
    const e = f.eye;
    const toWorld = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e[0], e[1], e[2], 1]);
    this.relSetShadow = mulM(this.bake.shadowVP, toWorld);
    this.size = [f.width, f.height];
    this.aoPass.resize(f.width, f.height);
    const t = this.tier;
    if (this.shaftsOn) this.fogPass.resize(Math.ceil(f.width / t.froxelPx), Math.ceil(f.height / t.froxelPx), t.froxelZ);
    const u = this.u;
    u.set(this.relSetShadow, 0);
    const iblOn = this.on('ibl', this.set.ibl.diffuse > 0);
    u.set([this.aoOn ? 1 : 0, this.contactOn ? 1 : 0, iblOn ? 1 : 0, this.set.ibl.diffuse], 16);
    u.set([this.bake.specMips - 1, this.on('detail', t.detail) ? 1 : 0, 1.0, 4.0], 20);
    u.set([this.set.ibl.spec, this.on('setShadow', this.bake.shadowOn) ? 1 : 0, this.on('detail', t.detail) ? 1 : 0, 1.0], 24);
    u.set([f.width, f.height, this.aoPass.width, this.aoPass.height], 28);
    u.set([...fwd, 0], 32);
    u.set([this.set.ibl.hemi, 1, now / 1000 % 1000, this.on('texSets', true) ? 1 : 0], 36);
    // G3's GI (D79: probe GI by default from 12 GB; SDF AO from 8 GB; SDF contact shadows from 12 GB)
    const giW = this.on('gi', this.giAllowed) ? (iblOn ? this.giBlend : 1) : 0;
    u.set([giW, this.on('gi', this.tierId >= 8) ? 0.6 : 0, this.on('sdfShadow', this.tierId >= 12) ? 0.7 : 0, 0.35], 40);
    // practicals: the spot table and the shadowed lamp's camera-relative matrix
    const kc = f.light.keyI;
    this.practicals.wattScale = (kc / 9 / (4 * Math.PI)) * (this.set.practicalScale ?? 1);
    const n = this.on('practicals', true) ? this.practicals.write(u, 64) : 0;
    u[44] = n;
    u.set(mulM(this.practicals.vp, toWorld), 48);
    this.device.queue.writeBuffer(this.uBuf, 0, u);
  }

  /** Sets the environment's practical lamps (preset world coordinates; E3b's data or the stand-in's). */
  setPracticals(list: readonly Practical[]): void { this.practicals.set(list); }

  /** RENDER (beta polish, D125): whether practicalShadow will render the shadowed lamp's map this frame. */
  get practicalShadowOn(): boolean { return this.on('practicals', true) && this.practicals.shadows && this.practicals.shadowIndex >= 0; }

  /** Records the shadowed practical's map (static set casters cached, parts drawn by the renderer). */
  practicalShadow(enc: GPUCommandEncoder, lib: MeshLibrary, drawParts: (pass: GPURenderPassEncoder, vp: Mat4) => void, timer?: GpuTimer): void {
    if (!this.on('practicals', true)) return;
    const key = this.setMeshes.map((m) => `${m.mesh}@${m.offset.join(',')}`).join(';');
    this.practicals.render(enc, lib, this.setMeshes, key, drawParts, () => timer?.render('look.spot')); // G5 (M5): only when it runs
  }

  /** Bind group 2 for the opaque, skinned and environment pipelines. */
  get bind(): GPUBindGroup {
    const key = this.resKey();
    if (this.bindCache?.key === key) return this.bindCache.group;
    const group = this.device.createBindGroup({ label: 'look', layout: this.layout, entries: this.entries() });
    this.bindCache = { key, group };
    return group;
  }

  /** Bind group 2 for the glass pipelines (+ the resolved opaque scene at binding 15). */
  bindGlass(sceneTex: GPUTexture): GPUBindGroup {
    const key = `${this.resKey()}|${objId(sceneTex)}`;
    if (this.glassCache?.key === key) return this.glassCache.group;
    const group = this.device.createBindGroup({ label: 'look.glass', layout: this.glassLayout, entries: [...this.entries(), { binding: 15, resource: sceneTex.createView() }] });
    this.glassCache = { key, group };
    return group;
  }

  private resKey(): string { return `${this.tex.version}|${this.aoPass.version}|${objId(this.lut)}`; }

  private entries(): GPUBindGroupEntry[] {
    const arr = (t: GPUTexture): GPUTextureView => t.createView({ dimension: '2d-array' });
    return [
      { binding: 0, resource: arr(this.tex.cls(0).albedo) }, { binding: 1, resource: arr(this.tex.cls(0).nrmOrm) },
      { binding: 11, resource: arr(this.tex.cls(1).albedo) }, { binding: 12, resource: arr(this.tex.cls(1).nrmOrm) },
      { binding: 3, resource: this.samplers.look }, { binding: 4, resource: arr(this.tex.detail) },
      { binding: 5, resource: this.bake.spec.createView({ dimension: 'cube' }) }, { binding: 6, resource: this.bake.irr.createView({ dimension: 'cube' }) },
      { binding: 7, resource: { buffer: this.uBuf } }, { binding: 8, resource: this.aoPass.out.createView() },
      { binding: 9, resource: this.bake.shadowMap.createView() }, { binding: 10, resource: this.samplers.clamp },
      { binding: 14, resource: this.aoPass.gi.createView() },
      { binding: 16, resource: this.practicals.map.createView() },
    ];
  }

  /** The half-res depth prepass target (the renderer draws it with its depth-only pipelines). */
  get depthTarget(): GPUTexture { return this.aoPass.depth; }

  /** AO + contact shadows (after the prepass). */
  ao(enc: GPUCommandEncoder, view: Mat4, key: V3, gi: { layout: GPUBindGroupLayout; bindGroup: GPUBindGroup }, timer?: GpuTimer): void {
    // direction to the key light in view space (rotation part of the camera-relative view)
    const sv = [
      view[0]! * key[0] + view[4]! * key[1] + view[8]! * key[2],
      view[1]! * key[0] + view[5]! * key[1] + view[9]! * key[2],
      view[2]! * key[0] + view[6]! * key[1] + view[10]! * key[2],
    ];
    const giOn = this.u[40]! > 0; // probe GI weight (written in begin)
    if (!this.aoOn && !this.contactOn && !giOn) return;
    this.aoPass.run(enc, this.tier, sv, this.contactOn, { ...gi, on: giOn }, timer?.compute('look.ao'));
  }

  /** Froxel fog with sun shafts (tiers and sets with shafts only). */
  fog(enc: GPUCommandEncoder, frameBuf: GPUBuffer, shadowMap: GPUTexture, timer?: GpuTimer): void {
    if (!this.shaftsOn || !this.set.fog) return;
    this.fogPass.run(enc, frameBuf, shadowMap, this.bake.shadowMap, this.samplers.cmp, this.relSetShadow, this.bake.shadowOn, this.set.fog, timer?.compute('look.fog'));
  }

  /** Post inputs for this frame. */
  post(timer?: GpuTimer): PostLook {
    const fog = this.set.fog;
    const shafts = this.shaftsOn;
    const fogMode: 0 | 1 | 2 = !fog || !this.on('fog', true) ? 0 : shafts ? 2 : 1;
    const h = this.size[1];
    const photo = this.photoCoc > 0;
    const maxPx = photo ? 18 * (h / 1080) : this.dofMaxPx1440 * (h / 1440);
    const dof = this.dofOn || (photo && this.force.dof !== false);
    const ts = dof ? timer?.render('look.dof') : undefined;
    const tsBlur = dof ? timer?.render('look.dof.blur') : undefined;
    return {
      depth: this.aoPass.out,
      fog: { mode: fogMode, volume: shafts ? this.fogPass.volume : null, haze: fog?.haze ?? 0, hazeColor: fog?.hazeColor ?? [0, 0, 0] },
      dof: { on: dof, focus: this.focusDist, band: this.focusDist * 0.35, maxPx, div: this.tier.dofDiv, photoScale: photo ? this.photoCoc * (h / 1080) : 0 },
      lut: this.on('lut', true) ? this.lut : null,
      vignette: this.on('vignette', true) ? this.set.vignette : 0,
      grain: this.on('vignette', true) ? this.set.grain : 0,
      ...(ts ? { ts: { dof: ts, ...(tsBlur ? { dofBlur: tsBlur } : {}) } } : {}),
    };
  }
}

function norm3(v: readonly number[]): V3 {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function mulM(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objId(o: object): number {
  let v = ids.get(o);
  if (v === undefined) ids.set(o, (v = nextId++));
  return v;
}
