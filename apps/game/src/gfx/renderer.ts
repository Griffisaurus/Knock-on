// Renderer v2 (RENDERING §3–6, §10): GPU-driven scene (compute frustum culling + LOD select into
// per-(mesh, LOD) buckets, one drawIndexedIndirect per bucket), camera-relative transforms, the Studio
// look (cyc floor + sky, key/fill/rim, one stabilised shadow map), HDR with MSAA, Spectacle particles,
// bloom and the PBR Neutral tonemap.
//
// M2 adds: a sorted transmission pass for glass and clear-poly shells (kn_glass, kn_poly_*); GPU-skinned
// critters; the "seeing inside" tools (section box with hatched caps, cutaway, x-ray); screen-space
// selection outlines from a mask; and environment overrides (Mega Kitchen look, no Studio floor).
//
// The scene instance buffer is rebuilt only when the document changes. During a run the sim's
// transforms are uploaded as-is (7 floats per body) and resolved on the GPU, so per-frame CPU work
// is one buffer write no matter how many parts move.

import { invert, lookAt, mul, norm, perspective, type Mat4, type V3 } from '../math.ts';
import { createGpu, GpuTimer, type GpuContext } from './gpu.ts';
import { generateMips } from './mips.ts';
import { LookPass } from './look/index.ts';
import { MORPH_SLOT, standardLibrary, VERTEX_STRIDE, type Geometry, type MeshLibrary, type MeshOptions } from './meshes.ts';
import { Particles } from './particles.ts';
import { Post } from './post.ts';
import { CLUSTER, CLUSTER_WGSL, CLUSTERS, CULL_WGSL, ENV_WGSL, FRAME_BYTES, FRAME_FAR, FRAME_SING, FRAME_STASIS, glassWgsl, MAX_LIGHTS, PART_FS_WGSL } from './shaders.ts';
import type { EarthFrame } from './setpieces.ts'; // RENDER (beta polish, D126)
import { FAR_PROXY_TEXELS, fitFar, fitLegacy, fitNear, NEAR_PROXY_TEXELS, SHADOW_PROXY_PX, SHADOW_SKIP_PX, shadowDistance, type Aabb, type CascadeFit } from './shadowfit.ts'; // RENDER (beta polish, D125)
import type { StasisBox } from './particles.ts';
import { SKIN_STRIDE, SkinLibrary, type SkinnedGeometry } from './skin.ts';
import { Gi, giWgsl } from './gi.ts'; // G3 (M3): global SDF + probe GI
import type { Shell } from './shockwave.ts';
import { Taa } from './taa.ts'; // G3 (M3): TAA upscaler, refraction shells, luminance meter
import { Impostors, impostorQuad, type ImpostorBucket } from './impostor.ts'; // S3 (M3): far-part impostors
import { probeHeadroom, RESERVE, TIER_BUDGET, vramGovernor, vramLedger, vramSummary } from './vram.ts'; // M4 (V4): VRAM ledger + governor

export type Rgb = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface SceneItem {
  readonly pos: readonly [number, number, number];
  readonly rot?: Quat;
  readonly size: readonly [number, number, number];
  readonly mesh: number;
  readonly color: Rgb; // linear
  readonly alpha?: number;
  readonly rough?: number;
  readonly metal?: number;
  readonly emissive?: number;
  readonly bevel?: boolean;
  readonly outline?: Rgb | null;
  readonly body?: number; // run transform index, -1 = static
  readonly hidden?: boolean;
  /** Engine-drawn screen content (kn_screen texels): 0 off, 1–21 bar level (n − 1) / 20, 31 overload. */
  readonly screen?: number;
  /** R5 (M5): LED icon on the mesh's `icon` screens (gfx/screens.ts: 0 dark, 1 + FACE_ICONS index). Art meshes only:
   * it takes the instance's metal byte, which art (master-material) meshes never read. */
  readonly icon?: number;
  /** R5 (M5): LED group levels (gfx/leds.ts ledCode: 2 bits per group 0–3) for art meshes with LED-group vertices; takes the
   * instance's rough byte, which art meshes never read. */
  readonly leds?: number;
  /** Overlay only: draw in the sorted transmission pass (TUBE glass); `color` is the tint. */
  readonly glass?: boolean;
  /** Overlay only: a link or port that the x-ray view shows through geometry. */
  readonly xray?: boolean;
  /**
   * DRAG (D117): overlay only: drawn last in the late pass, flat-lit, with no depth test, so parts never hide it (the
   * transform gizmo, ui/gizmo.ts). Top items keep their list order (painter's order); `alpha` blends them.
   */
  readonly top?: boolean;
  /** RENDER (beta polish, D126): overlay only: the backdrop Earth, lit at runtime (fs_earth, renderer.earth). Its mesh
   * is centred on the planet. */
  readonly earth?: boolean;
  /** RENDER (beta polish, D126): overlay only: which of the mesh's LODs to draw (default 0; set pieces far away). */
  readonly lod?: number;
}

/** A GPU-skinned instance (critters): model pose + 12 floats (3×4 rows) per joint, model space. */
export interface SkinnedItem {
  readonly mesh: number; // SkinLibrary id (renderer.addSkinnedMesh)
  readonly pos: readonly [number, number, number];
  readonly rot: Quat;
  readonly bones: Float32Array;
  /** Shape-key (morph target) weights, in the mesh's `targetNames` order. */
  readonly morph?: Float32Array;
  readonly color?: Rgb;
  readonly hidden?: boolean;
  /** R5 (M5): the LED face icon on its `icon` screens (SceneItem.icon). */
  readonly face?: number;
  /** R5 (M5): LED group levels (SceneItem.leds). */
  readonly leds?: number;
}

export type XrayMode = 'off' | 'links' | 'all';

/** G3 (M3): Spectacle hooks (volumes, debris, shock rings; fx.ts registers them). All optional. */
export interface RenderHook {
  /** Compute before the shadow pass (simulation); `dt` already carries renderer.timeScale. */
  simulate?(pass: GPUComputePassEncoder, dt: number, time: number): void;
  /** Draws into the shadow map (depth32float, camera-relative frame.shadowMat). */
  drawShadow?(pass: GPURenderPassEncoder): void;
  /** Opaque draws in the main MSAA pass (depth write). */
  drawOpaque?(pass: GPURenderPassEncoder): void;
  /** True when the hook needs the opaque depth this frame (splits off the late pass). */
  needsDepth?(): boolean;
  /** After the opaque pass: may read `depth` (internal-res MSAA depth24plus) in passes of its own, and
   * `scene` (the resolved opaque colour) when a hook asked for it with `needsScene` or glass is in view. */
  afterOpaque?(enc: GPUCommandEncoder, depth: GPUTexture, scene: GPUTexture | null): void;
  /** Late-pass draws (after glass, before particles). */
  drawLate?(pass: GPURenderPassEncoder): void;
  /** R4 (M4): compute of its own after the Spectacle pass, before the shadow pass (Matter: cull and compaction). */
  prepare?(enc: GPUCommandEncoder): void;
  /** R4 (M4): the opaque colour resolved into a sampleable copy this frame (Matter water refracts it). */
  needsScene?(): boolean;
  /** R4 (M4): draws into the look's half-res depth prepass (depth32float, no colour): AO, fog and DOF see them. */
  drawPrepass?(pass: GPURenderPassEncoder): void;
  /** R4 (M4): late-pass draws before the transmission pass (RENDERING §3 pass 16, Matter surfaces: water). */
  drawMatter?(pass: GPURenderPassEncoder): void;
  /** R4 (M4): the scene copy glass refracts this frame when a hook resolved more into it (water); null = the opaque copy. */
  glassScene?(): GPUTexture | null;
  /** Screen-space refraction shells for the present pass. */
  shells?(): readonly Shell[];
  /** Stop: drop everything. */
  clear?(): void;
}

export const INST_BYTES = 64;
const FLAG_HIDDEN = 1, FLAG_BEVEL = 2;
const MSAA = 4;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
const MASK_FORMAT: GPUTextureFormat = 'rgba8unorm';
const BUCKET_STRIDE = 256;
/** RENDER (beta polish, D125): impostors only under this many pixels across (sized by the mesh's real radius). */
export const IMPOSTOR_MAX_PX = 8;
const CULL_BYTES = 320; // RENDER (beta polish): + shadowR, camPlanes, sweep, lamp

/** CPU-side packing of SceneItems into the GPU instance layout (shaders.ts `Inst`). */
export class InstanceData {
  count = 0;
  buf: ArrayBuffer;
  private f: Float32Array;
  private u: Uint32Array;
  private i: Int32Array;
  readonly meshCounts: number[] = [];

  constructor(cap = 256) {
    this.buf = new ArrayBuffer(cap * INST_BYTES);
    this.f = new Float32Array(this.buf); this.u = new Uint32Array(this.buf); this.i = new Int32Array(this.buf);
  }

  reset(n: number): void {
    if (n * INST_BYTES > this.buf.byteLength) {
      this.buf = new ArrayBuffer(Math.max(n, 256) * INST_BYTES);
      this.f = new Float32Array(this.buf); this.u = new Uint32Array(this.buf); this.i = new Int32Array(this.buf);
    }
    this.count = n;
    this.meshCounts.length = 0;
  }

  set(k: number, it: SceneItem): void {
    const o = k * 16;
    const f = this.f, u = this.u;
    f[o] = it.pos[0]; f[o + 1] = it.pos[1]; f[o + 2] = it.pos[2]; u[o + 3] = it.mesh;
    const q = it.rot ?? [0, 0, 0, 1];
    f[o + 4] = q[0]; f[o + 5] = q[1]; f[o + 6] = q[2]; f[o + 7] = q[3];
    f[o + 8] = it.size[0]; f[o + 9] = it.size[1]; f[o + 10] = it.size[2];
    u[o + 11] = packRgba(it.color, it.alpha ?? 1);
    const flags = (it.hidden ? FLAG_HIDDEN : 0) | (it.bevel ? FLAG_BEVEL : 0) | (((it.screen ?? 0) & 31) << 3);
    u[o + 12] = ((it.leds !== undefined ? it.leds & 255 : q8(it.rough ?? 0.5)) |((it.icon !== undefined ? it.icon & 255 : q8(it.metal ?? 0)) << 8) | (q8(it.emissive ?? 0) << 16) | (flags << 24)) >>> 0;
    u[o + 13] = it.outline ? packRgba(it.outline, 1) : 0;
    this.i[o + 14] = it.body ?? -1;
    f[o + 15] = 0.5 * Math.hypot(it.size[0], it.size[1], it.size[2]);
    this.meshCounts[it.mesh] = (this.meshCounts[it.mesh] ?? 0) + 1;
  }

  meshOf(k: number): number { return this.u[k * 16 + 3]!; }
  outlineOf(k: number): number { return this.u[k * 16 + 13]!; }
  hiddenAt(k: number): boolean { return ((this.u[k * 16 + 12]! >>> 24) & FLAG_HIDDEN) !== 0; }
  bodyOf(k: number): number { return this.i[k * 16 + 14]!; }
  /** Position, rotation and size (scene: world or body-local in run mode). */
  poseOf(k: number): { pos: V3; rot: Quat; size: V3 } {
    const f = this.f, o = k * 16;
    return { pos: [f[o]!, f[o + 1]!, f[o + 2]!], rot: [f[o + 4]!, f[o + 5]!, f[o + 6]!, f[o + 7]!], size: [f[o + 8]!, f[o + 9]!, f[o + 10]!] };
  }
  /** Overwrites the body index (skinned instances: first bone). */
  setBody(k: number, b: number): void { this.i[k * 16 + 14] = b; }
  /** Overwrites one raw word (skinned instances reuse `mesh` = shape-key count, `outline` = weights offset). */
  setWord(k: number, word: number, v: number): void { this.u[k * 16 + word] = v >>> 0; }
}

const q8 = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
/** Linear RGB → sRGB-ish 8 bit (the shaders decode with pow 2.2). */
function packRgba(c: Rgb, a: number): number {
  return (q8(toSrgb(c[0])) | (q8(toSrgb(c[1])) << 8) | (q8(toSrgb(c[2])) << 16) | (q8(a) << 24)) >>> 0;
}
/** Linear RGBA → rgba8 as-is (selection mask colours). */
const packLinear = (c: Rgb, a: number): number => (q8(c[0]) | (q8(c[1]) << 8) | (q8(c[2]) << 16) | (q8(a) << 24)) >>> 0;
const qrotV = (q: Quat, v: readonly number[]): V3 => {
  const tx = 2 * (q[1] * v[2]! - q[2] * v[1]!), ty = 2 * (q[2] * v[0]! - q[0] * v[2]!), tz = 2 * (q[0] * v[1]! - q[1] * v[0]!);
  return [v[0]! + q[3] * tx + (q[1] * tz - q[2] * ty), v[1]! + q[3] * ty + (q[2] * tx - q[0] * tz), v[2]! + q[3] * tz + (q[0] * ty - q[1] * tx)];
};
const qmulQ = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
  a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

interface Flash { pos: V3; color: Rgb; radius: number; t0: number; dur: number }

export interface StudioLook {
  readonly cyc: Rgb;
  readonly key: V3; readonly fill: V3; readonly rim: V3;
  readonly keyI: number; readonly fillI: number; readonly rimI: number;
  readonly rimColor: Rgb;
  readonly etch: number;
  readonly exposure: number;
  /** Key light colour (default the Studio's slightly warm white). */
  readonly keyColor?: Rgb;
}

const lin = (h: string): Rgb => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as unknown as Rgb;
};
// art/briefs/environments.md §1.4, converted from Blender Z-up (front −Y) to engine Y-up (front +Z).
export const STUDIO_LIGHT: StudioLook = {
  cyc: lin('#BDB8AF'), key: norm([-1.6, 1.9, 1.5]), fill: norm([1.9, 0.9, 1.1]), rim: norm([0.3, 1.5, -1.8]),
  keyI: 2.6, fillI: 0.26 * 2.6, rimI: 0.9 * 2.6, rimColor: [0.86, 0.94, 1.0], etch: -0.06, exposure: 0.5,
};
export const STUDIO_DARK: StudioLook = {
  cyc: lin('#1C1F26'), key: norm([-0.9, 1.3, 0.9]), fill: [0, 1, 0], rim: norm([0.7, 0.8, -0.9]),
  keyI: 2.4, fillI: 0, rimI: 0.81 * 2.4, rimColor: [0.6, 0.85, 1.0], etch: 0.04, exposure: 1.1,
};
/** MEGA KITCHEN morning (environments.md §2.3): 4,300 K sun through the window (from −Z, 22° up, 20°
 * toward +X), warm haze, cool window-sky fill. Stand-in until the IBL and probes land. */
export const KITCHEN_MORNING: StudioLook = {
  cyc: lin('#E6D6C0'), key: norm([Math.sin(0.349) * Math.cos(0.384), Math.sin(0.384), -Math.cos(0.349) * Math.cos(0.384)]),
  fill: norm([0.4, 0.8, 1.0]), rim: norm([-0.6, 0.9, -0.5]), keyI: 3.0, fillI: 0.55, rimI: 0.9,
  rimColor: lin('#CFE6FF'), etch: 0, exposure: 0.55, keyColor: [1.0, 0.86, 0.7],
};

export interface RendererOptions {
  /** GPU tier (GB): sizes the particle pool and shadow map (vfx.md §0.1). */
  readonly tier?: 4 | 8 | 12 | 16 | 32;
}

/** A scene instance whose mesh has shape keys (renderer.morphInstances): weights go to `setMorph(slot, …)`. */
export interface MorphInst { readonly idx: number; readonly mesh: number; readonly body: number; readonly slot: number; readonly names: readonly string[] }

interface GlassEntry { idx: number; mesh: number; overlay: boolean; center: V3; r: number }
interface MaskEntry { idx: number; mesh: number; color: number }
interface OverlayDraw { mesh: number; first: number; count: number; ghost: boolean; xray: boolean; top?: boolean; earth?: boolean; lod?: number }


export class Renderer {
  readonly canvas: HTMLCanvasElement;
  gpu!: GpuContext;
  device!: GPUDevice;
  timer!: GpuTimer;
  particles!: Particles;
  readonly lib: MeshLibrary = standardLibrary();
  /** Skinned meshes (critters): their own vertex, joints/weights and index buffers. */
  readonly skins = new SkinLibrary();
  look: StudioLook = STUDIO_LIGHT;
  /** Environment lighting override (MEGA KITCHEN); null = the Studio `look`. */
  envLook: StudioLook | null = null;
  /** The Studio's infinite floor + build grid; off when an environment brings its own floor. */
  drawFloor = true;
  /** Screen-space refraction offset (uv per unit view-space normal). */
  refraction = 0.03;
  /** Absolute view-projection (CPU picking and overlays). */
  viewProj: Mat4 = new Float32Array(16);
  eye: V3 = [0, 2, 3];
  target: V3 = [0, 0, 0];
  camRight: V3 = [1, 0, 0];
  camUp: V3 = [0, 1, 0];
  lostReason: string | null = null;
  /** G3 (M3): global SDF + probe GI (L3 binds `gi.layout` / `gi.bindGroup`, WGSL from gi.ts `giWgsl`). */
  gi!: Gi;
  /** G3 (M3): TAA upscaler (D60, D81). `upscale` = internal / output scale, 0 = auto (4K: 1440p, tier 32: 1800p). */
  taa!: Taa;
  upscale = 0;
  /** R5 (M5): this frame's stasis volumes (time-stopped look) and singularities (body stretch, strength 0–1); `stretch`
   * scales the stretch (0 under Reduced motion). Written by gfx/future each frame. */
  m5Frame: { stasis: readonly StasisBox[]; sing: readonly { pos: V3; strength: number }[]; stretch: number } = { stasis: [], sing: [], stretch: 1 };
  /** R5 (M5): the wetness grid (gfx/wetness.ts: vec2f per cell) and its rect [x0, z0, cell m, n]; null = dry everywhere. */
  private wetBuf: GPUBuffer | null = null;
  private wetDummy!: GPUBuffer;
  private wetRect: [number, number, number, number] = [0, 0, 1, 0];
  setWetness(buf: GPUBuffer | null, rect: readonly [number, number, number, number]): void {
    this.wetRect = [...rect] as [number, number, number, number];
    if (buf !== this.wetBuf) { this.wetBuf = buf; this.rebind(); }
  }
  /** G3 (M3): Spectacle time scale (hitstop, slow-mo): particles, volumes, debris and rings run at dt × this. */
  timeScale = 1;
  private hooks: RenderHook[] = [];
  private frameBufStill!: GPUBuffer;
  /** Internal render size (= the canvas unless upscaling). */
  private rw = 1;
  private rh = 1;
  runMode = false;
  /** Hovered scene instance (thin outline at half strength), -1 none. */
  hover = -1;
  hoverColor: Rgb = [1, 1, 1];
  cursor: V3 | null = null;
  buildGrid = 1;
  exposureBoost = 0;
  /** Cutaway focus (world); null = the camera target. Radius at the focus (m); 0 = auto from distance. */
  cutawayFocus: V3 | null = null;
  cutawayRadius = 0;
  /** Selection outline width in CSS px (scaled by devicePixelRatio). */
  outlinePx = 2;
  stats = { instances: 0, buckets: 0, overlay: 0, frameMs: 0, glass: 0, skinned: 0, mask: 0 };
  /** L3 (M3): the D79 look (texture sets, detail, IBL, AO, contact, fog, DOF, grade; look/index.ts). */
  lookPass!: LookPass;
  private prePipes!: { scene: GPURenderPipeline; overlay: GPURenderPipeline; skin: GPURenderPipeline };

  private readonly tier: 4 | 8 | 12 | 16 | 32;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private frameBuf!: GPUBuffer;
  private frameData = new ArrayBuffer(FRAME_BYTES);
  private colorMs!: GPUTexture;
  private depth!: GPUTexture;
  private hdr!: GPUTexture;
  /** Resolved opaque scene: what glass refracts. */
  private sceneTex!: GPUTexture;
  private maskTex!: GPUTexture;
  /** RENDER (beta polish, D125): the gizmo's coverage at output size (post keeps fog and DOF off under it). */
  private sharpTex!: GPUTexture;
  private shadowMap!: GPUTexture;
  private shadowSize = 2048;
  /** RENDER (beta polish, D125): the far key-light cascade (half the near map's size) and its frame-uniform copy. */
  private shadowFarMap!: GPUTexture;
  private frameBufFar!: GPUBuffer;
  private farFit: CascadeFit | null = null;
  private nearFit: CascadeFit | null = null;
  /** Per mesh: LOD0 box centre and half extents (vs_shadow_box), two vec4f each. */
  private shadowBoxes!: GPUBuffer;
  /** The scene's world bounds for fitting the cascades (setScene; grown in run mode), null = empty. */
  private sceneBox: { min: V3; max: V3 } | null = null;
  private boundsCursor = 0;
  /** Debug and benches: false = the M5 single map (whole-scene casters at LOD1), for before/after timings. */
  shadowFit = true;
  /** Debug and benches: false = LOD, impostor and frustum sizing by `inst.radius` (0.5 × |size|) as in M5, for before/after. */
  lodByMesh = true;
  /** Debug: false = the gizmo goes through fog and DOF like the scene (before D125's fix), for before/after shots. */
  gizmoSharp = true;
  /** RENDER (beta polish, D126): this frame's backdrop Earth, set by the environment view; null = none. */
  earth: EarthFrame | null = null;
  private shadowSampler!: GPUSampler;
  /** Shared decal atlas (kn_decal, shared_kit §6): 1×1 transparent until `loadDecalAtlas`. */
  private decalTex!: GPUTexture;
  private decalSampler!: GPUSampler;
  private post!: Post;
  private partLayout!: GPUBindGroupLayout;
  private shadowLayout!: GPUBindGroupLayout;
  private bucketLayout!: GPUBindGroupLayout;
  private cullLayout!: GPUBindGroupLayout;
  private glassLayout!: GPUBindGroupLayout;
  private dualSource = false;
  private pipes!: {
    opaque: GPURenderPipeline; opaqueClip: GPURenderPipeline; overlay: GPURenderPipeline; ghost: GPURenderPipeline;
    shadow: GPURenderPipeline; shadowClip: GPURenderPipeline; shadowBox: GPURenderPipeline; sky: GPURenderPipeline; floor: GPURenderPipeline; cull: GPUComputePipeline;
    glassBack: GPURenderPipeline; glassFront: GPURenderPipeline; xrayGlow: GPURenderPipeline; xrayHidden: GPURenderPipeline;
    mask: GPURenderPipeline; skin: GPURenderPipeline; skinClip: GPURenderPipeline; skinShadow: GPURenderPipeline;
    top: GPURenderPipeline; // DRAG (D117): the gizmo, no depth test
    topMask: GPURenderPipeline; // RENDER (beta polish, D125): its coverage for post (no fog, no DOF under it)
    earth: GPURenderPipeline; // RENDER (beta polish, D126): the backdrop Earth, lit at runtime
  };
  // scene
  private inst!: GPUBuffer;
  private instCap = 0;
  private xf!: GPUBuffer;
  private xfCap = 0;
  private xfCpu: Float32Array = new Float32Array(0);
  private overlayBuf!: GPUBuffer;
  private overlayCap = 0;
  private readonly overlayData = new InstanceData();
  private overlayDraws: OverlayDraw[] = [];
  private overlayGlass: GlassEntry[] = [];
  private sceneCount = 0;
  private meshTable!: GPUBuffer;
  private bucketBase!: GPUBuffer;
  private bucketUniform!: GPUBuffer;
  private bucketBind!: GPUBindGroup;
  private buckets: { mesh: number; lod: number; glass: boolean; impostor?: boolean; proxy?: boolean }[] = [];
  /** RENDER (beta polish, D125): the shadow box-proxy buckets (one per opaque mesh in the scene). */
  private proxyBuckets: number[] = [];
  private impostorTexVersion = -1;
  /** S3 (M3): octahedral impostors for far parts (gfx/impostor.ts); set `impostors.thresholdPx` (Arena, Megastructure). */
  impostors: Impostors | null = null;
  private impostorBuckets: ImpostorBucket[] = [];
  private impostorQuadMesh = 0;
  private argsTemplate = new Uint32Array(0);
  private views!: { cam: CullViewRes; shadow: CullViewRes; far: CullViewRes; spot: CullViewRes };
  private binds!: {
    scene: GPUBindGroup; shadow: GPUBindGroup; overlay: GPUBindGroup; glassScene: GPUBindGroup; glassOverlay: GPUBindGroup;
    mask: GPUBindGroup; skin: GPUBindGroup; skinShadow: GPUBindGroup; overlayStill: GPUBindGroup;
    shadowFar: GPUBindGroup; skinShadowFar: GPUBindGroup; shadowSpot: GPUBindGroup;
  };
  private glassTexBind: GPUBindGroup | null = null;
  private sceneDirty = true;
  private lastScene = new InstanceData();
  private sceneGlass: { idx: number; mesh: number }[] = [];
  private lockOutlines: MaskEntry[] = [];
  private selection: readonly number[] = [];
  private selectionRgb: Rgb | null = null;
  private section: { min: V3; max: V3 } | null = null;
  private cutaway = false;
  private xray: XrayMode = 'off';
  // per-frame CPU lists
  private glassList!: GPUBuffer;
  private glassListCap = 0;
  private glassDraws: GlassEntry[] = [];
  private maskBuf!: GPUBuffer;
  private maskCap = 0;
  private maskDraws: MaskEntry[] = [];
  private skinInst!: GPUBuffer;
  private skinInstCap = 0;
  private readonly skinData = new InstanceData();
  private bones!: GPUBuffer;
  private bonesCap = 0;
  private skinDraws: { mesh: number }[] = [];
  private dummy!: GPUBuffer;
  /** Part shape keys: [0] weights base, [1 + instance] slot, then MORPH_SLOT weights per slot (f32 bits). */
  private morphInst!: GPUBuffer;
  private morphInstWords = 0;
  private morphWeights = new Float32Array(0);
  private morphBase = 1;
  /** Scene instances with shape keys, rebuilt by setScene (the part-morph driver writes their weights). */
  morphInstances: readonly MorphInst[] = [];
  private flashes: Flash[] = [];
  private lightBuf!: GPUBuffer;
  private clusterBuf!: GPUBuffer;
  private clusterPipe!: GPUComputePipeline;
  private clusterBind!: GPUBindGroup;
  private readonly lightData = new Float32Array(MAX_LIGHTS * 8);
  /** Steady lights this frame (wick flames, burning fuses): cleared after every draw. */
  private steady: Flash[] = [];
  private lastFrame = 0;
  private readonly t0 = performance.now();

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    this.tier = opts.tier ?? 8;
  }

  async init(): Promise<void> {
    this.gpu = await createGpu();
    const d = this.device = this.gpu.device;
    // M4 (V4): every allocation on this device goes into the VRAM ledger; out-of-memory errors are VRAM
    // pressure; a lost device is rebuilt in place (recover) unless the page destroyed it on purpose
    vramLedger.attach(d);
    d.lost.then((info) => (this.owner ?? this).onLost(d, info));
    d.addEventListener('uncapturederror', (e) => {
      const err = (e as GPUUncapturedErrorEvent).error;
      if (typeof GPUOutOfMemoryError !== 'undefined' && err instanceof GPUOutOfMemoryError) vramGovernor.pressure('oom', err.message);
      console.error('WebGPU:', err.message);
    });
    // shader compile errors with line numbers, instead of a later "invalid pipeline"
    const create = d.createShaderModule.bind(d);
    d.createShaderModule = (desc: GPUShaderModuleDescriptor): GPUShaderModule => {
      const m = create(desc);
      void m.getCompilationInfo().then((info) => {
        for (const msg of info.messages) if (msg.type === 'error') console.error(`WGSL ${desc.label ?? ''}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
      });
      return m;
    };
    this.timer = new GpuTimer(this.gpu, 40); // G3: room for the M3 look + Spectacle passes
    this.dualSource = this.gpu.features.has('dual-source-blending');
    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
    this.frameBuf = d.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowSize = this.tier >= 12 ? 4096 : 2048;
    this.shadowMap = d.createTexture({ label: 'shadow.map', size: [this.shadowSize, this.shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.shadowSampler = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    // RENDER (beta polish, D125): the far cascade at half the near map's resolution
    const farSize = this.shadowSize / 2;
    this.shadowFarMap = d.createTexture({ label: 'shadow.far', size: [farSize, farSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.frameBufFar = d.createBuffer({ label: 'frame.far', size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowBoxes = d.createBuffer({ label: 'shadow.boxes', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.dummy = d.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
    this.morphInst = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.morphInstWords = 4;

    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
    const ro = { type: 'read-only-storage' as const };
    this.partLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: V, buffer: ro }, { binding: 2, visibility: V, buffer: ro }, { binding: 3, visibility: V, buffer: ro },
        { binding: 4, visibility: F, texture: { sampleType: 'depth' } },
        { binding: 5, visibility: F, sampler: { type: 'comparison' } },
        { binding: 6, visibility: F, buffer: ro }, { binding: 7, visibility: F, buffer: ro },
        { binding: 8, visibility: F, texture: { sampleType: 'float' } }, { binding: 9, visibility: F, sampler: { type: 'filtering' } },
        { binding: 10, visibility: V, buffer: ro }, { binding: 11, visibility: V, buffer: ro },
        { binding: 12, visibility: F, buffer: ro }, // R5 (M5): the wetness grid (gfx/wetness.ts)
        { binding: 13, visibility: F, texture: { sampleType: 'depth' } }, // RENDER (beta polish, D125): the far key-light cascade
      ],
    });
    this.wetDummy = d.createBuffer({ label: 'wet.none', size: 16, usage: GPUBufferUsage.STORAGE });
    this.glassLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, texture: { sampleType: 'float' } }] });
    this.decalTex = d.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.decalSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    this.lightBuf = d.createBuffer({ size: MAX_LIGHTS * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.clusterBuf = d.createBuffer({ size: CLUSTERS * (CLUSTER.per + 1) * 4, usage: GPUBufferUsage.STORAGE });
    const clusterMod = d.createShaderModule({ code: CLUSTER_WGSL, label: 'clusters' });
    this.clusterPipe = d.createComputePipeline({ layout: 'auto', compute: { module: clusterMod, entryPoint: 'assign' } });
    this.clusterBind = d.createBindGroup({
      layout: this.clusterPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameBuf } }, { binding: 1, resource: { buffer: this.lightBuf } }, { binding: 2, resource: { buffer: this.clusterBuf } }],
    });
    this.shadowLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: V, buffer: ro }, { binding: 2, visibility: V, buffer: ro }, { binding: 3, visibility: V, buffer: ro },
        { binding: 10, visibility: V, buffer: ro }, { binding: 11, visibility: V, buffer: ro },
        { binding: 14, visibility: V, buffer: ro }, // RENDER (beta polish, D125): per-mesh boxes for the shadow proxies
      ],
    });
    this.bucketLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
    this.cullLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: ro }, { binding: 2, visibility: C, buffer: ro },
        { binding: 3, visibility: C, buffer: ro }, { binding: 4, visibility: C, buffer: ro },
        { binding: 5, visibility: C, buffer: { type: 'storage' } }, { binding: 6, visibility: C, buffer: { type: 'storage' } },
      ],
    });

    // L3 (M3): the shading modules read G3's GI at group 3 (giWgsl spliced in at the look's marker)
    const withGi = (code: string): string => code.replace('// @@GI@@', giWgsl(3));
    const partMod = d.createShaderModule({ code: withGi(PART_FS_WGSL), label: 'parts' });
    const glassMod = d.createShaderModule({ code: withGi(glassWgsl(this.dualSource)), label: 'glass' });
    const envMod = d.createShaderModule({ code: withGi(ENV_WGSL), label: 'env' });
    const cullMod = d.createShaderModule({ code: CULL_WGSL, label: 'cull' });
    // L3 (M3): group 2 is the D79 look (look/index.ts); glass adds the resolved opaque scene to it; group 3 is G3's GI
    this.lookPass = vramLedger.scope('look', () => new LookPass(d, this.frameBuf, this.tier)); // M4 (V4): ledger pools
    this.gi = vramLedger.scope('gi', () => new Gi(d, this.tier, this.frameBuf, this.lightBuf, HDR_FORMAT, MSAA));
    const partPL = d.createPipelineLayout({ bindGroupLayouts: [this.partLayout, this.bucketLayout, this.lookPass.layout, this.gi.layout] });
    const glassPL = d.createPipelineLayout({ bindGroupLayouts: [this.partLayout, this.bucketLayout, this.lookPass.glassLayout, this.gi.layout] });
    const shadowPL = d.createPipelineLayout({ bindGroupLayouts: [this.shadowLayout, this.bucketLayout] });
    const vbuf: GPUVertexBufferLayout = {
      arrayStride: VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm16x4' },
        { shaderLocation: 2, offset: 20, format: 'unorm8x4' }, { shaderLocation: 3, offset: 24, format: 'unorm8x4' },
        { shaderLocation: 4, offset: 28, format: 'unorm16x2' },
      ],
    };
    const skinBuf: GPUVertexBufferLayout = {
      arrayStride: SKIN_STRIDE,
      attributes: [{ shaderLocation: 5, offset: 0, format: 'uint8x4' }, { shaderLocation: 6, offset: 4, format: 'unorm8x4' }],
    };
    const morphBuf: GPUVertexBufferLayout = { arrayStride: 4, attributes: [{ shaderLocation: 7, offset: 0, format: 'uint32' }] };
    const posOnly: GPUVertexBufferLayout = { arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] };
    const depth = (write: boolean, compare: GPUCompareFunction = 'less'): GPUDepthStencilState => ({ format: 'depth24plus', depthWriteEnabled: write, depthCompare: compare });
    const premul: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const additive: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
    // opaque passes resolve alpha-tested decal edges (and the soft cutaway edge) with alpha-to-coverage
    const part = (vs: string, blend: GPUBlendState | null, cull: GPUCullMode = 'back', buffers: GPUVertexBufferLayout[] = [vbuf]): GPURenderPipeline => d.createRenderPipeline({
      layout: partPL,
      vertex: { module: partMod, entryPoint: vs, buffers },
      fragment: { module: partMod, entryPoint: 'fs_part', targets: [{ format: HDR_FORMAT, ...(blend ? { blend } : {}) }], ...(blend ? { constants: { PREMUL: 1 } } : {}) },
      primitive: { topology: 'triangle-list', cullMode: cull, frontFace: 'ccw' },
      depthStencil: depth(!blend),
      multisample: { count: MSAA, alphaToCoverageEnabled: !blend },
    });
    // transmission: dst × T + C with dual-source blending (coloured tint), else a scalar T
    const glassBlend: GPUBlendState = this.dualSource
      ? { color: { srcFactor: 'one', dstFactor: 'src1' as GPUBlendFactor }, alpha: { srcFactor: 'zero', dstFactor: 'one' } }
      : { color: { srcFactor: 'one', dstFactor: 'src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
    const glass = (cull: GPUCullMode): GPURenderPipeline => d.createRenderPipeline({
      layout: glassPL,
      vertex: { module: glassMod, entryPoint: 'vs_list', buffers: [vbuf] },
      fragment: { module: glassMod, entryPoint: 'fs_glass', targets: [{ format: HDR_FORMAT, blend: glassBlend }] },
      primitive: { topology: 'triangle-list', cullMode: cull, frontFace: 'ccw' },
      depthStencil: depth(false),
      multisample: { count: MSAA },
    });
    const xray = (vs: string, hidden: boolean): GPURenderPipeline => d.createRenderPipeline({
      layout: partPL,
      vertex: { module: partMod, entryPoint: vs, buffers: vs === 'vs_scene' ? [vbuf, morphBuf] : [vbuf] },
      fragment: { module: partMod, entryPoint: 'fs_xray', targets: [{ format: HDR_FORMAT, blend: additive }], constants: { XRAY_HIDDEN: hidden ? 1 : 0 } },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: depth(false, hidden ? 'greater' : 'always'),
      multisample: { count: MSAA },
    });
    this.pipes = {
      opaque: part('vs_scene', null, 'back', [vbuf, morphBuf]),
      opaqueClip: part('vs_scene', null, 'none', [vbuf, morphBuf]),
      overlay: part('vs_overlay', null),
      ghost: part('vs_overlay', premul),
      skin: part('vs_skin', null, 'back', [vbuf, skinBuf, morphBuf]),
      skinClip: part('vs_skin', null, 'none', [vbuf, skinBuf, morphBuf]),
      shadow: d.createRenderPipeline({
        layout: shadowPL,
        vertex: { module: partMod, entryPoint: 'vs_shadow', buffers: [posOnly, morphBuf] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
      }),
      shadowClip: d.createRenderPipeline({
        layout: shadowPL,
        vertex: { module: partMod, entryPoint: 'vs_shadow_clip', buffers: [posOnly, morphBuf] },
        fragment: { module: partMod, entryPoint: 'fs_shadow_clip', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
      }),
      // RENDER (beta polish, D125): shadow casters a few pixels across, as their mesh's box
      shadowBox: d.createRenderPipeline({
        layout: shadowPL,
        vertex: { module: partMod, entryPoint: 'vs_shadow_box', buffers: [posOnly] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
      }),
      skinShadow: d.createRenderPipeline({
        layout: shadowPL,
        vertex: { module: partMod, entryPoint: 'vs_skin_shadow', buffers: [posOnly, skinBuf] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
      }),
      sky: d.createRenderPipeline({
        layout: partPL, // L3 (M3): the environment shaders read the look's group 2 too
        vertex: { module: envMod, entryPoint: 'vs_sky' },
        fragment: { module: envMod, entryPoint: 'fs_sky', targets: [{ format: HDR_FORMAT }] },
        depthStencil: depth(false, 'always'),
        multisample: { count: MSAA },
      }),
      floor: d.createRenderPipeline({
        layout: partPL,
        vertex: { module: envMod, entryPoint: 'vs_floor' },
        fragment: { module: envMod, entryPoint: 'fs_floor', targets: [{ format: HDR_FORMAT }] },
        depthStencil: depth(true),
        multisample: { count: MSAA },
      }),
      cull: d.createComputePipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.cullLayout] }), compute: { module: cullMod, entryPoint: 'cull' } }),
      glassBack: glass('front'),
      glassFront: glass('back'),
      xrayGlow: xray('vs_overlay', false),
      xrayHidden: xray('vs_scene', true),
      // DRAG (D117): the transform gizmo: flat-lit, premultiplied, never depth-tested (drawn over the parts)
      top: d.createRenderPipeline({
        layout: partPL,
        vertex: { module: partMod, entryPoint: 'vs_overlay', buffers: [vbuf] },
        fragment: { module: partMod, entryPoint: 'fs_top', targets: [{ format: HDR_FORMAT, blend: premul }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(false, 'always'),
        multisample: { count: MSAA },
      }),
      earth: d.createRenderPipeline({
        layout: partPL,
        vertex: { module: partMod, entryPoint: 'vs_overlay', buffers: [vbuf] },
        fragment: { module: partMod, entryPoint: 'fs_earth', targets: [{ format: HDR_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true),
        multisample: { count: MSAA },
      }),
      topMask: d.createRenderPipeline({
        layout: partPL,
        vertex: { module: partMod, entryPoint: 'vs_overlay', buffers: [vbuf] },
        fragment: { module: partMod, entryPoint: 'fs_top_mask', targets: [{ format: 'r8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      }),
      mask: d.createRenderPipeline({
        layout: partPL,
        vertex: { module: partMod, entryPoint: 'vs_mask', buffers: [vbuf, morphBuf] },
        fragment: { module: partMod, entryPoint: 'fs_mask', targets: [{ format: MASK_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      }),
    };
    // L3 (M3): the look's half-res depth prepass (AO, contact shadows, fog and DOF read it): vertex only
    const pre = (vs: string, buffers: GPUVertexBufferLayout[]): GPURenderPipeline => d.createRenderPipeline({
      layout: partPL, vertex: { module: partMod, entryPoint: vs, buffers },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.prePipes = { scene: pre('vs_scene', [vbuf, morphBuf]), overlay: pre('vs_overlay', [vbuf]), skin: pre('vs_skin', [vbuf, skinBuf, morphBuf]) };

    const cap = { 4: 1 << 20, 8: 4 << 20, 12: 8 << 20, 16: 16 << 20, 32: 32 << 20 }[this.tier];
    const maxByLimit = Math.floor(Math.min(d.limits.maxStorageBufferBindingSize, d.limits.maxBufferSize, 1 << 30) / 32);
    this.particles = vramLedger.scope('particles', () => new Particles(d, this.frameBuf, Math.min(cap, maxByLimit), HDR_FORMAT, MSAA));
    this.impostorQuadMesh = this.lib.add('impostor:quad', [impostorQuad()]); // S3
    this.impostors = vramLedger.scope('textures', () => new Impostors(d, this.lib, HDR_FORMAT, MSAA, this.bucketLayout));
    this.post = new Post(d, this.format);
    // G3 (M3): GI and the upscaler; the mask pass reads an un-jittered copy of the frame uniform
    this.gi ??= new Gi(d, this.tier, this.frameBuf, this.lightBuf, HDR_FORMAT, MSAA); // (L3: created before the part layouts)
    this.taa = new Taa(d);
    this.frameBufStill = d.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ensureXf(7 * 64);
    this.setScene(new InstanceData());
    this.resize();
  }

  // ---- scene -------------------------------------------------------------------------------------

  /** Loads the shared decal atlas (sRGB colour, linear alpha) with a full mip chain; false when not built. */
  async loadDecalAtlas(url: string): Promise<boolean> {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const d = this.device;
      const mips = Math.floor(Math.log2(Math.max(img.width, img.height))) + 1;
      const tex = d.createTexture({
        size: [img.width, img.height], format: 'rgba8unorm-srgb', mipLevelCount: mips,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      d.queue.copyExternalImageToTexture({ source: img }, { texture: tex }, [img.width, img.height]);
      generateMips(d, tex);
      this.decalTex.destroy();
      this.decalTex = tex;
      this.decalUrl = url; // M4 (V4): reloaded after device loss
      this.sceneDirty = true; // rebinds with the new view
      return true;
    } catch {
      return false;
    }
  }

  addMesh(name: string, lods: readonly Geometry[], lodSwitch: readonly number[] = [], opts: MeshOptions = {}): number {
    const id = this.lib.add(name, lods, lodSwitch, opts);
    this.sceneDirty = true;
    return id;
  }

  /** Registers a GPU-skinned mesh (critters); returns its id for SkinnedItem.mesh. */
  addSkinnedMesh(name: string, geom: SkinnedGeometry, jointCount: number): number {
    return this.skins.add(name, geom, jointCount);
  }

  /** Replaces the whole scene. Call when the document (or run start/stop, locks) changes. */
  setScene(data: InstanceData): void { vramLedger.scope('instances', () => this.setSceneNow(data)); } // M4 (V4): ledger pool
  private setSceneNow(data: InstanceData): void {
    const d = this.device;
    this.lastScene = data;
    vramLedger.scope('meshes', () => this.lib.upload(d));
    // S3: octahedral atlases for the scene's art meshes (Arena, Megastructure); RENDER (beta polish): with their texture sets
    const tx = this.lookPass?.tex;
    this.impostors?.ensure(data.meshCounts, tx ? { a1k: tx.cls(0).albedo, a2k: tx.cls(1).albedo, version: tx.version } : undefined);
    this.impostorTexVersion = tx?.version ?? -1;
    if (this.impostors) this.impostors.dirty = false;
    this.gi?.setMeshBounds(this.lib.meshes); // G3: SDF stamping uses each mesh's box
    this.gi?.sceneChanged();
    const n = data.count;
    if (n > this.instCap || !this.inst) {
      this.inst?.destroy();
      this.instCap = Math.max(256, n * 1.5 | 0);
      this.inst = d.createBuffer({ size: this.instCap * INST_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    if (n) d.queue.writeBuffer(this.inst, 0, data.buf, 0, n * INST_BYTES);
    this.sceneCount = n;
    this.stats.instances = n;
    // glass instances (sorted on the CPU each frame) and partner/lock outlines (selection mask)
    this.sceneGlass = [];
    this.lockOutlines = [];
    for (let k = 0; k < n; k++) {
      const mesh = data.meshOf(k);
      if (this.lib.meshes[mesh]?.glass) this.sceneGlass.push({ idx: k, mesh });
      const ol = data.outlineOf(k);
      if (ol >>> 24) {
        const c = [ol & 255, (ol >> 8) & 255, (ol >> 16) & 255].map((v) => (v / 255) ** 2.2);
        this.lockOutlines.push({ idx: k, mesh, color: packLinear(c as unknown as Rgb, 0.9) });
      }
    }

    this.buildMorphTable(data);

    // Buckets: one per (mesh, LOD); each gets a region as large as that mesh's instance count.
    this.buckets = [];
    const meshRows: number[] = [];
    const bases: number[] = [];
    let region = 0;
    this.lib.meshes.forEach((m, id) => {
      const count = data.meshCounts[id] ?? 0;
      // S3: a baked impostor is one more bucket after the LODs (the cull pass sees bit 8 of lodCount)
      const imp = !!this.impostors?.enabled && count > 0 && this.impostors.layerOf(id) >= 0;
      // RENDER (beta polish, D125): opaque meshes in the scene get a shadow box-proxy bucket after those (bit 9)
      const proxy = count > 0 && !m.glass && !!m.half && m.half.every((h) => h > 0);
      meshRows.push(this.buckets.length, m.lods.length | (imp ? 0x100 : 0) | (proxy ? 0x200 : 0));
      const sw = [m.lodSwitch[0] ?? 0, m.lodSwitch[1] ?? 0, m.radius, ...m.center]; // RENDER (beta polish): + the LOD0 bounding sphere
      meshRows.push(...sw.map((x) => new Uint32Array(new Float32Array([x]).buffer)[0]!));
      m.lods.forEach((_, lod) => {
        this.buckets.push({ mesh: id, lod, glass: m.glass });
        bases.push(region);
        region += count;
      });
      if (imp) {
        this.buckets.push({ mesh: id, lod: m.lods.length, glass: false, impostor: true });
        bases.push(region);
        region += count;
      }
      if (proxy) {
        this.buckets.push({ mesh: id, lod: m.lods.length + (imp ? 1 : 0), glass: false, proxy: true });
        bases.push(region);
        region += count;
      }
    });
    this.impostorBuckets = this.buckets.flatMap((b, i) => (b.impostor ? [{ bucket: i, mesh: b.mesh }] : []));
    this.proxyBuckets = this.buckets.flatMap((b, i) => (b.proxy ? [i] : []));
    {
      // RENDER (beta polish, D125): per-mesh LOD0 boxes for the proxies, and the scene's bounds for the cascades
      const boxes = new Float32Array(Math.max(8, this.lib.meshes.length * 8));
      this.lib.meshes.forEach((m, i) => { boxes.set([...m.center, 0, ...(m.half ?? [0, 0, 0]), 0], i * 8); });
      if (this.shadowBoxes.size < boxes.byteLength) {
        this.shadowBoxes.destroy();
        this.shadowBoxes = d.createBuffer({ label: 'shadow.boxes', size: boxes.byteLength * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      }
      d.queue.writeBuffer(this.shadowBoxes, 0, boxes);
      this.sceneBox = this.computeSceneBox(data);
      this.boundsCursor = 0;
    }
    this.impostors?.writeTable(this.lib.meshes.length);
    const meshTable = new Uint32Array(meshRows);
    this.meshTable?.destroy();
    this.meshTable = d.createBuffer({ size: Math.max(16, meshTable.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.meshTable, 0, meshTable);
    this.bucketBase?.destroy();
    this.bucketBase = d.createBuffer({ size: Math.max(16, bases.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.bucketBase, 0, new Uint32Array(bases));
    const bu = new Uint32Array((this.buckets.length * BUCKET_STRIDE) / 4);
    bases.forEach((b, i) => { bu[(i * BUCKET_STRIDE) / 4] = b; });
    this.bucketUniform?.destroy();
    this.bucketUniform = d.createBuffer({ size: Math.max(BUCKET_STRIDE, bu.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.bucketUniform, 0, bu);
    this.bucketBind = d.createBindGroup({ layout: this.bucketLayout, entries: [{ binding: 0, resource: { buffer: this.bucketUniform, size: 16 } }] });
    this.argsTemplate = new Uint32Array(this.buckets.length * 5);
    this.buckets.forEach((b, i) => {
      const lod = b.impostor ? this.lib.meshes[this.impostorQuadMesh]!.lods[0]! // S3: impostors draw a quad
        : b.proxy ? this.lib.meshes[this.lib.id('box')]!.lods[0]! : this.lib.meshes[b.mesh]!.lods[b.lod]!; // RENDER: proxies the unit box
      this.argsTemplate.set([lod.indexCount, 0, lod.firstIndex, lod.baseVertex, 0], i * 5);
    });
    this.stats.buckets = this.buckets.length;

    for (const v of Object.values(this.views ?? {})) { v.args.destroy(); v.visible.destroy(); v.uniform.destroy(); }
    const mkView = (): CullViewRes => {
      const args = d.createBuffer({ label: 'cull.args', size: Math.max(20, this.argsTemplate.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      const visible = d.createBuffer({ size: Math.max(16, region * 4), usage: GPUBufferUsage.STORAGE });
      const uniform = d.createBuffer({ size: CULL_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      return { args, visible, uniform, bind: null };
    };
    this.views = { cam: mkView(), shadow: mkView(), far: mkView(), spot: mkView() }; // RENDER (beta polish): + far cascade, spot lamp
    this.rebind();
    this.sceneDirty = false;
  }

  /** Shape-key slots for the scene's morphing instances (only the few part types that have shape keys). */
  private buildMorphTable(data: InstanceData): void {
    const n = data.count;
    const list: MorphInst[] = [];
    for (let k = 0; k < n; k++) {
      const mesh = data.meshOf(k);
      const names = this.lib.meshes[mesh]?.targetNames ?? [];
      if (names.length) list.push({ idx: k, mesh, body: data.bodyOf(k), slot: list.length, names });
    }
    this.morphInstances = list;
    this.morphBase = 1 + (list.length ? n : 0);
    this.morphWeights = new Float32Array(list.length * MORPH_SLOT);
    const words = Math.max(4, this.morphBase + list.length * MORPH_SLOT);
    if (words > this.morphInstWords) {
      this.morphInst.destroy();
      this.morphInstWords = Math.max(words, this.morphInstWords * 2);
      this.morphInst = this.device.createBuffer({ size: this.morphInstWords * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    const u = new Uint32Array(this.morphBase);
    u[0] = this.morphBase;
    if (list.length) { u.fill(0xffffffff, 1); for (const m of list) u[1 + m.idx] = m.slot; }
    this.device.queue.writeBuffer(this.morphInst, 0, u);
    if (list.length) this.device.queue.writeBuffer(this.morphInst, this.morphBase * 4, this.morphWeights);
  }

  /** Sets shape key `k` of a morph slot (MorphInst.slot) for the next frame. */
  setMorph(slot: number, k: number, w: number): void {
    if (k < MORPH_SLOT && slot >= 0 && slot * MORPH_SLOT + k < this.morphWeights.length) this.morphWeights[slot * MORPH_SLOT + k] = w;
  }

  /** Run transforms: 7 floats per body (x, y, z, qx, qy, qz, qw), body order. */
  setBodyTransforms(t: Float32Array): void {
    this.xfCpu = t;
    if (this.ensureXf(t.length)) this.rebind();
    if (t.length) this.device.queue.writeBuffer(this.xf, 0, t.buffer, t.byteOffset, t.byteLength);
  }

  /** Overrides one body's transform on the GPU for this frame only (render-side: a carried item follows
   * the critter's animated hand). Call after `setBodyTransforms`. */
  patchBody(b: number, pos: readonly number[], rot: readonly number[]): void {
    if (b < 0 || (b + 1) * 7 > this.xfCap) return;
    this.device.queue.writeBuffer(this.xf, b * 28, new Float32Array([pos[0]!, pos[1]!, pos[2]!, rot[0]!, rot[1]!, rot[2]!, rot[3]!]));
  }

  private ensureXf(floats: number): boolean {
    if (this.xf && floats <= this.xfCap) return false;
    this.xf?.destroy();
    this.xfCap = Math.max(floats, this.xfCap * 2, 7 * 64);
    this.xf = this.device.createBuffer({ size: this.xfCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    return true;
  }

  /** Small per-frame list (ghosts, drones, markers, links, TUBE glass): drawn directly, no culling. */
  setOverlay(items: readonly SceneItem[]): void {
    // order: opaque, ghosts, glass (sorted later), then by x-ray flag and mesh; DRAG (D117): on-top items last, in list order
    const cls = (it: SceneItem): number => (it.top ? 3 : it.glass ? 2 : (it.alpha ?? 1) < 1 ? 1 : 0);
    const sorted = items.map((it, i) => ({ it, i, c: cls(it), x: it.xray ? 1 : 0 }))
      .sort((a, b) => a.c - b.c || (a.c === 3 ? a.i - b.i : a.x - b.x || a.it.mesh - b.it.mesh || a.i - b.i));
    this.overlayData.reset(sorted.length);
    sorted.forEach((s, k) => this.overlayData.set(k, s.it));
    this.overlayDraws = [];
    this.overlayGlass = [];
    sorted.forEach((s, k) => {
      if (s.c === 2) {
        const m = this.lib.meshes[s.it.mesh];
        if (!m) return;
        const q = s.it.rot ?? [0, 0, 0, 1];
        const c = qrotV(q, [m.center[0] * s.it.size[0], m.center[1] * s.it.size[1], m.center[2] * s.it.size[2]]);
        this.overlayGlass.push({ idx: k, mesh: s.it.mesh, overlay: true, center: [s.it.pos[0] + c[0], s.it.pos[1] + c[1], s.it.pos[2] + c[2]], r: m.radius * Math.max(...s.it.size) });
        return;
      }
      const last = this.overlayDraws.at(-1);
      const ghost = s.c === 1, xray = s.x === 1 && s.c !== 3, top = s.c === 3, earth = !!s.it.earth && s.c === 0;
      const lod = Math.max(0, Math.min((this.lib.meshes[s.it.mesh]?.lods.length ?? 1) - 1, s.it.lod ?? 0));
      if (last && last.mesh === s.it.mesh && last.ghost === ghost && last.xray === xray && !!last.top === top && !!last.earth === earth && (last.lod ?? 0) === lod && last.first + last.count === k) last.count++;
      else this.overlayDraws.push({ mesh: s.it.mesh, first: k, count: 1, ghost, xray, ...(top ? { top } : {}), ...(earth ? { earth } : {}), ...(lod ? { lod } : {}) });
    });
    if (sorted.length > this.overlayCap || !this.overlayBuf) {
      this.overlayBuf?.destroy();
      this.overlayCap = Math.max(64, sorted.length * 2);
      this.overlayBuf = this.device.createBuffer({ size: this.overlayCap * INST_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.rebind();
    }
    if (sorted.length) this.device.queue.writeBuffer(this.overlayBuf, 0, this.overlayData.buf, 0, sorted.length * INST_BYTES);
    this.stats.overlay = sorted.length;
  }

  /** This frame's skinned instances (critters). Bones: 12 floats per joint, the mesh's joint count. */
  setSkinned(items: readonly SkinnedItem[]): void {
    if (this.recovering) return; // M4 (V4): the skins re-upload to the new device once it exists
    const d = this.device;
    if (this.skins.upload(d)) this.rebind(); // new skinned geometry (and its morph table)
    const live = items.filter((it) => !it.hidden && this.skins.meshes[it.mesh]);
    let joints = 0, morphs = 0;
    for (const it of live) { const m = this.skins.meshes[it.mesh]!; joints += m.jointCount; morphs += m.targetNames.length; }
    this.skinData.reset(live.length);
    // bones (12 floats per joint) first, then each instance's shape-key weights
    const bones = new Float32Array(Math.max(12, joints * 12 + morphs));
    let jb = 0, wb = joints * 12;
    this.skinDraws = [];
    live.forEach((it, k) => {
      const m = this.skins.meshes[it.mesh]!;
      this.skinData.set(k, { pos: it.pos, rot: it.rot, size: [1, 1, 1], mesh: it.mesh, color: it.color ?? [1, 1, 1], ...(it.face !== undefined ? { icon: it.face } : {}), ...(it.leds !== undefined ? { leds: it.leds } : {}) }); // R5 (M5): face icon, LED groups
      this.skinData.setBody(k, jb);
      bones.set(it.bones.subarray(0, m.jointCount * 12), jb * 12);
      jb += m.jointCount;
      const T = m.targetNames.length;
      this.skinData.setWord(k, 3, it.morph && T ? T : 0);
      this.skinData.setWord(k, 13, wb);
      if (it.morph && T) bones.set(it.morph.subarray(0, T), wb);
      wb += T;
      this.skinDraws.push({ mesh: it.mesh });
    });
    let grow = false;
    if (!this.skinInst || live.length > this.skinInstCap) {
      this.skinInst?.destroy();
      this.skinInstCap = Math.max(16, live.length * 2);
      this.skinInst = d.createBuffer({ size: this.skinInstCap * INST_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      grow = true;
    }
    if (!this.bones || bones.length > this.bonesCap) {
      this.bones?.destroy();
      this.bonesCap = Math.max(12 * 256, bones.length * 2);
      this.bones = d.createBuffer({ size: this.bonesCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      grow = true;
    }
    if (grow) this.rebind();
    if (live.length) {
      d.queue.writeBuffer(this.skinInst, 0, this.skinData.buf, 0, live.length * INST_BYTES);
      d.queue.writeBuffer(this.bones, 0, bones, 0, wb);
    }
    this.stats.skinned = live.length;
  }

  // ---- seeing inside (contract 4: the UI calls these) ------------------------------------------------

  /** Clips everything outside the axis-aligned box (cut faces are capped with a hatch); null = off. */
  setSectionBox(box: { min: V3; max: V3 } | null): void {
    this.section = box ? { min: [...box.min] as V3, max: [...box.max] as V3 } : null;
  }

  get sectionBox(): { min: V3; max: V3 } | null { return this.section; }

  /** Cuts away the walls and shells between the camera and `cutawayFocus` (default: the camera target). */
  setCutaway(on: boolean): void { this.cutaway = on; }

  get cutawayOn(): boolean { return this.cutaway; }

  /** X-ray: 'links' dims the art and shows links/ports through it; 'all' also shows hidden parts. */
  setXray(mode: XrayMode): void { this.xray = mode; }

  get xrayMode(): XrayMode { return this.xray; }

  /** Screen-space outline for these scene instances in `rgb` (the selecting player's colour). */
  setSelection(instances: readonly number[], rgb: Rgb | null): void {
    this.selection = rgb ? [...instances] : [];
    this.selectionRgb = rgb;
  }

  private rebind(): void {
    if (!this.views || !this.inst) return;
    const d = this.device;
    this.overlayBuf ??= d.createBuffer({ size: 64 * INST_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.overlayCap ||= 64;
    this.glassList ??= d.createBuffer({ size: 256 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.glassListCap ||= 256;
    this.maskBuf ??= d.createBuffer({ size: 128 * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.maskCap ||= 128;
    this.skinInst ??= d.createBuffer({ size: 16 * INST_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.skinInstCap ||= 16;
    this.bones ??= d.createBuffer({ size: 12 * 256 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bonesCap ||= 12 * 256;
    const shadowView = this.shadowMap.createView();
    const farView = this.shadowFarMap.createView();
    this.frameBufSpot ??= d.createBuffer({ label: 'frame.spot', size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const decalView = this.decalTex.createView();
    const partGroup = (insts: GPUBuffer, xf: GPUBuffer, visible: GPUBuffer, frame = this.frameBuf): GPUBindGroup => d.createBindGroup({
      layout: this.partLayout,
      entries: [
        { binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: insts } },
        { binding: 2, resource: { buffer: xf } }, { binding: 3, resource: { buffer: visible } },
        { binding: 4, resource: shadowView }, { binding: 5, resource: this.shadowSampler },
        { binding: 6, resource: { buffer: this.lightBuf } }, { binding: 7, resource: { buffer: this.clusterBuf } },
        { binding: 8, resource: decalView }, { binding: 9, resource: this.decalSampler },
        { binding: 10, resource: { buffer: this.lib.morphTableBuffer! } }, { binding: 11, resource: { buffer: this.morphInst } },
        { binding: 12, resource: { buffer: this.wetBuf ?? this.wetDummy } },
        { binding: 13, resource: farView }, // RENDER (beta polish, D125)
      ],
    });
    const shadowGroup = (insts: GPUBuffer, xf: GPUBuffer, visible: GPUBuffer, frame = this.frameBuf): GPUBindGroup => d.createBindGroup({
      layout: this.shadowLayout,
      entries: [
        { binding: 0, resource: { buffer: frame } }, { binding: 1, resource: { buffer: insts } },
        { binding: 2, resource: { buffer: xf } }, { binding: 3, resource: { buffer: visible } },
        { binding: 10, resource: { buffer: this.lib.morphTableBuffer! } }, { binding: 11, resource: { buffer: this.morphInst } },
        { binding: 14, resource: { buffer: this.shadowBoxes } }, // RENDER (beta polish, D125)
      ],
    });
    this.binds = {
      scene: partGroup(this.inst, this.xf, this.views.cam.visible),
      overlay: partGroup(this.overlayBuf, this.xf, this.views.cam.visible),
      glassScene: partGroup(this.inst, this.xf, this.glassList),
      glassOverlay: partGroup(this.overlayBuf, this.xf, this.glassList),
      mask: partGroup(this.inst, this.xf, this.maskBuf, this.frameBufStill), // G3: output-res mask, no TAA jitter
      overlayStill: partGroup(this.overlayBuf, this.xf, this.views.cam.visible, this.frameBufStill), // RENDER: the gizmo's coverage
      skin: partGroup(this.skinInst, this.bones, this.skins.morphBuffer ?? this.dummy),
      shadow: shadowGroup(this.inst, this.xf, this.views.shadow.visible),
      skinShadow: shadowGroup(this.skinInst, this.bones, this.dummy),
      // RENDER (beta polish, D125): the far cascade and the shadowed lamp draw the scene through their own frame copies
      shadowFar: shadowGroup(this.inst, this.xf, this.views.far.visible, this.frameBufFar),
      skinShadowFar: shadowGroup(this.skinInst, this.bones, this.dummy, this.frameBufFar),
      shadowSpot: shadowGroup(this.inst, this.xf, this.views.spot.visible, this.frameBufSpot),
    };
    for (const v of [this.views.cam, this.views.shadow, this.views.far, this.views.spot]) {
      v.bind = d.createBindGroup({
        layout: this.cullLayout,
        entries: [v.uniform, this.inst, this.xf, this.meshTable, this.bucketBase, v.args, v.visible]
          .map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    }
  }

  // ---- camera, lights, effects -----------------------------------------------------------------------

  setCamera(eye: V3, target: V3, fovDeg = 40): void {
    this.eye = eye;
    this.target = target;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective((fovDeg * Math.PI) / 180, aspect, 0.02, 2000);
    this.viewProj = mul(proj, lookAt(eye, target, [0, 1, 0]));
    const fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    this.camRight = norm([-fwd[2], 0, fwd[0]]);
    const r = this.camRight;
    this.camUp = norm([r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]]);
    this.fov = fovDeg;
  }
  private fov = 40;
  get fovDeg(): number { return this.fov; }

  /** A light for this frame only (flames, fuse fronts); call every frame it should shine. */
  light(pos: V3, color: Rgb, radius: number): void {
    this.steady.push({ pos, color, radius, t0: 0, dur: 1 });
  }

  /** A short-lived point light (explosion flash, fuse glow). */
  flash(pos: V3, color: Rgb, radius: number, dur: number): void {
    this.flashes.push({ pos, color, radius, t0: performance.now(), dur: dur * 1000 });
    if (this.flashes.length > 64) this.flashes.shift();
  }

  // ---- frame -----------------------------------------------------------------------------------------

  resize(): void {
    // L3 (M3): × the live governor's internal resolution step (look/governor.ts)
    // G3 (M3): with the TAA upscaler the canvas is the output size and the governor's scale goes into the
    // internal size instead; without it the governor scales the canvas as before
    const base = Math.min(window.devicePixelRatio || 1, 2) * this.resolutionScale;
    const gov = this.lookPass?.renderScale ?? 1;
    const oh = Math.max(1, Math.floor(this.canvas.clientHeight * base));
    const up = this.upscaleFor(oh);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * base * (up ? 1 : gov)));
    const ch = up ? oh : Math.max(1, Math.floor(this.canvas.clientHeight * base * gov));
    this.taa.enabled = up > 0;
    this.taa.scale = up * gov;
    const [w, h] = this.taa.internalSize(cw, ch);
    if (this.canvas.width === cw && this.canvas.height === ch && this.hdr && this.rw === w && this.rh === h) return;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.rw = w;
    this.rh = h;
    for (const t of [this.colorMs, this.depth, this.hdr, this.sceneTex, this.maskTex, this.sharpTex]) t?.destroy();
    const d = this.device;
    this.colorMs = d.createTexture({ size: [w, h], format: HDR_FORMAT, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    // G3: the depth is read by the volumetrics and the TAA resolve; the HDR target takes the shells' copy-back
    this.depth = d.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.hdr = d.createTexture({ size: [w, h], format: HDR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.sceneTex = d.createTexture({ size: [w, h], format: HDR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.maskTex = d.createTexture({ size: [cw, ch], format: MASK_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.sharpTex = d.createTexture({ label: 'gizmo.sharp', size: [cw, ch], format: 'r8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.glassTexBind = d.createBindGroup({ layout: this.glassLayout, entries: [{ binding: 0, resource: this.sceneTex.createView() }] });
    this.taa.resize(this.hdr, this.depth, cw, ch);
    this.post.resize(this.taa.enabled ? this.taa.out! : this.hdr, this.maskTex, this.sharpTex);
  }

  draw(): void {
    if (this.recovering) return; // M4 (V4): the device was lost and is being rebuilt
    // G5 (M5): the governors read the GPU frame time (gpu.ts `frameMs`: first timed pass → last, stale slots excluded)
    const gpuMs = this.timer.enabled && this.timer.frameMs > 0 ? this.timer.frameMs : undefined;
    vramGovernor.frame(performance.now(), gpuMs); // M4 (V4): frame spikes → VRAM pressure; slow restore
    this.maybeProbe();
    // RENDER (beta polish, D125): impostors re-bake (and the buckets rebuild) when the texture sets changed under them
    if (this.impostors?.enabled && this.lookPass && this.lookPass.tex.version !== this.impostorTexVersion && !this.lookPass.tex.pending.size) this.sceneDirty = true;
    if (this.sceneDirty) this.setScene(this.lastScene);
    this.resize();
    const now = performance.now();
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / 60;
    this.stats.frameMs = this.stats.frameMs * 0.9 + (now - (this.lastFrame || now)) * 0.1;
    this.lastFrame = now;
    const time = (now - this.t0) / 1000;
    const d = this.device;
    if (this.skins.upload(d)) this.rebind(); // skinned meshes added since the last setSkinned

    const relVP = this.relativeViewProj();
    const shadowVP = this.shadowMatrix();
    // G3 (M3): the TAA jitter goes into the frame's view-projection only (culling stays un-jittered);
    // the mask pass reads an un-jittered copy
    const jit = this.taa.jitter();
    const jitVP = jit[0] || jit[1] ? this.taa.jittered(relVP, jit) : relVP;
    this.writeFrame(jitVP, shadowVP, time, now);
    {
      const f = new Float32Array(this.frameData);
      f.set(relVP, 0);
      f.set(invert(relVP), 16);
      this.device.queue.writeBuffer(this.frameBufStill, 0, this.frameData);
    }
    const sdt = dt * this.timeScale;
    this.writeCull(this.views.cam, relVP, 0);
    // RENDER (beta polish, D125): shadow casters by size on screen (one LOD coarser, box proxies, sub-pixel skipped)
    this.writeCull(this.views.shadow, shadowVP, this.shadowFit ? -1 : 2, this.nearFit?.texel ?? 0, NEAR_PROXY_TEXELS);
    const far = this.farFit;
    if (far) {
      this.writeCull(this.views.far, far.mat, -1, far.texel, FAR_PROXY_TEXELS);
      const ff = new Float32Array(this.frameData);
      const saved = ff.slice(32, 48);
      ff.set(far.mat, 32);
      d.queue.writeBuffer(this.frameBufFar, 0, this.frameData);
      ff.set(saved, 32);
    }
    const spotVP = this.spotCullMatrix(); // the shadowed practical's casters, culled on the GPU too
    if (spotVP) {
      // the lamp's map: texels per metre of distance from the lamp (perspective), real meshes down to 1.5 texels
      const pr = this.lookPass.practicals, sp = pr.list[pr.shadowIndex]!;
      const tpm = (2 * Math.tan((Math.min(170, 2 * sp.outerConeDeg + 6) * Math.PI) / 360)) / pr.size;
      this.writeCull(this.views.spot, spotVP, -1, 1, NEAR_PROXY_TEXELS, [sp.pos[0]!, sp.pos[1]!, sp.pos[2]!, tpm]);
    }
    this.prepareGlass(relVP);
    this.prepareMask();
    if (this.morphInstances.length) this.device.queue.writeBuffer(this.morphInst, this.morphBase * 4, this.morphWeights);
    const clip = this.section !== null || this.cutaway;
    // R4 (M4): Matter water refracts the resolved opaque scene, like glass
    const hasGlass = this.glassDraws.length > 0;
    const sceneCopy = hasGlass || this.hooks.some((h) => h.needsScene?.());
    // G3 (M3): a separate late pass when glass or a Spectacle hook needs the opaque depth (or the GI debug view)
    const late = sceneCopy || this.gi.debug !== 'off' || this.hooks.some((h) => h.needsDepth?.());
    // L3 (M3): look uniforms, set bake (when the environment changed), DOF focus, governor
    const relView = lookAt([0, 0, 0], [this.target[0] - this.eye[0], this.target[1] - this.eye[1], this.target[2] - this.eye[2]], [0, 1, 0]);
    this.lookPass.begin({
      eye: this.eye, target: this.target, fov: this.fov, width: this.rw, height: this.rh, runMode: this.runMode, // G3: internal size (TAA)
      // G5 (M5): the look governor reads GPU time when there is one; the frame interval can't fall under the display's
      // refresh period (16.7 ms at 60 Hz), so on it the governor never restored a step and stepped down on any pacing jitter
      view: relView, key: this.look0().key, selection: this.selectionCenter(), lib: this.lib, light: this.look0(), frameMs: gpuMs ?? this.stats.frameMs,
    });

    const enc = d.createCommandEncoder();
    this.timer.begin();
    {
      const ts = this.timer.compute('cull');
      const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
      pass.setPipeline(this.clusterPipe);
      pass.setBindGroup(0, this.clusterBind);
      pass.dispatchWorkgroups(Math.ceil(CLUSTERS / 64));
      pass.setPipeline(this.pipes.cull);
      const groups = Math.ceil(this.sceneCount / 64);
      if (groups > 0) {
        for (const v of [this.views.cam, this.views.shadow, ...(far ? [this.views.far] : []), ...(spotVP ? [this.views.spot] : [])]) {
          pass.setBindGroup(0, v.bind!);
          pass.dispatchWorkgroups(Math.min(groups, 32768), Math.ceil(groups / 32768));
        }
      }
      pass.end();
    }
    {
      // G3 (M3): global SDF clipmap rebuilds + probe GI updates
      const ts = this.timer.compute('gi');
      // L3 (M3): the live governor's drop order (shafts, DOF, then GI) and the look's force switch gate the probes
      this.gi.probesOn = this.gi.cfg.probes && this.lookPass.governor.state.gi && this.lookPass.force.gi !== false;
      const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
      this.gi.missRadiance = this.lookPass?.iblMean ?? null; // inside a set, probe misses see the room (M3 close-out)
      this.gi.update(pass, { inst: this.inst, xf: this.xf, count: this.sceneCount, run: this.runMode }, this.target);
      pass.end();
    }
    {
      const ts = this.timer.compute('particles');
      const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
      this.particles.update(pass, sdt, time, this.camRight, this.camUp);
      pass.end();
    }
    if (this.hooks.some((h) => h.simulate)) {
      // G3 (M3): volumetric grids, debris chunklets
      const ts = this.timer.compute('spectacle');
      const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
      for (const h of this.hooks) h.simulate?.(pass, sdt, time);
      pass.end();
    }
    for (const h of this.hooks) h.prepare?.(enc); // R4 (M4): Matter cull + compaction (its own timed pass)
    {
      const ts = this.timer.render('shadow');
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowMap.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        ...(ts ? { timestampWrites: ts } : {}),
      });
      pass.setPipeline(this.section ? this.pipes.shadowClip : this.pipes.shadow);
      pass.setBindGroup(0, this.binds.shadow);
      this.drawBuckets(pass, this.views.shadow.args, false);
      this.drawProxies(pass, this.binds.shadow, this.views.shadow.args); // RENDER (beta polish, D125)
      if (this.skinDraws.length) {
        pass.setPipeline(this.pipes.skinShadow);
        pass.setBindGroup(0, this.binds.skinShadow);
        this.drawSkinned(pass);
      }
      for (const h of this.hooks) h.drawShadow?.(pass); // G3: debris
      pass.end();
    }
    if (far) {
      // RENDER (beta polish, D125): the far cascade: parts and critters only (Matter and debris shadows stay near the focus)
      const ts = this.timer.render('shadow.far');
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowFarMap.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        ...(ts ? { timestampWrites: ts } : {}),
      });
      pass.setPipeline(this.section ? this.pipes.shadowClip : this.pipes.shadow);
      pass.setBindGroup(0, this.binds.shadowFar);
      this.drawBuckets(pass, this.views.far.args, false);
      this.drawProxies(pass, this.binds.shadowFar, this.views.far.args);
      if (this.skinDraws.length) {
        pass.setPipeline(this.pipes.skinShadow);
        pass.setBindGroup(0, this.binds.skinShadowFar);
        this.drawSkinned(pass);
      }
      pass.end();
    }
    this.drawLookPrepass(enc, relView);
    this.drawSpotShadow(enc); // L3 (M3): the shadowed practical lamp (12 GB and up)
    {
      const ts = this.timer.render('main');
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.colorMs.createView(), resolveTarget: (sceneCopy ? this.sceneTex : this.hdr).createView(),
          loadOp: 'clear', storeOp: late ? 'store' : 'discard', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
        depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: late ? 'store' : 'discard' },
        ...(ts ? { timestampWrites: ts } : {}),
      });
      pass.setBindGroup(0, this.binds.scene);
      pass.setBindGroup(1, this.bucketBind, [0]);
      pass.setBindGroup(2, this.lookPass.bind); // L3 (M3)
      pass.setBindGroup(3, this.gi.bindGroup); // L3 (M3): G3's GI for the look
      pass.setPipeline(this.pipes.sky);
      pass.draw(3);
      pass.setPipeline(this.pipes.floor);
      pass.draw(6);
      pass.setPipeline(clip ? this.pipes.opaqueClip : this.pipes.opaque);
      this.drawBuckets(pass, this.views.cam.args, false);
      if (this.impostorBuckets.length && this.impostors) {
        // S3: far parts as octahedral impostors (the cull pass filled their buckets)
        this.impostors.draw(pass, this.impostorBuckets, this.views.cam.args, {
          frame: this.frameBuf, insts: this.inst, xf: this.xf, visible: this.views.cam.visible, bucketBind: this.bucketBind, bucketStride: BUCKET_STRIDE,
          quad: this.lib.meshes[this.impostorQuadMesh]!.lods[0]!,
        });
        pass.setBindGroup(0, this.binds.scene);
        pass.setBindGroup(1, this.bucketBind, [0]);
      }
      if (this.skinDraws.length) {
        pass.setPipeline(clip ? this.pipes.skinClip : this.pipes.skin);
        pass.setBindGroup(0, this.binds.skin);
        pass.setBindGroup(1, this.bucketBind, [0]);
        this.drawSkinned(pass, true);
      }
      this.drawOverlay(pass, false);
      for (const h of this.hooks) h.drawOpaque?.(pass); // G3: debris chunklets
      if (!late) this.drawLate(pass, false);
      pass.end();
    }
    if (late) for (const h of this.hooks) h.afterOpaque?.(enc, this.depth, sceneCopy ? this.sceneTex : null); // G3: volumetric raymarch (reads depth); R4: Matter water splats
    if (late) {
      // transmission: continue on the MSAA target (per-sample depth test) and refract the resolved opaque scene;
      // G3: also the late Spectacle draws (volumes, shock rings) when they need the opaque depth
      const ts = this.timer.render(hasGlass ? 'glass' : 'late');
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.colorMs.createView(), resolveTarget: this.hdr.createView(), loadOp: 'load', storeOp: 'discard' }],
        depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'discard' },
        ...(ts ? { timestampWrites: ts } : {}),
      });
      this.drawLate(pass, hasGlass);
      pass.end();
    }
    {
      // G3 (M3): luminance meter (flash limiter), TAA resolve to the output size, refraction shells
      const shells = this.hooks.flatMap((h) => h.shells?.() ?? []);
      this.taa.run(enc, this.hdr, relVP, invert(relVP), this.eye, shells, this.canvas.width / Math.max(1, this.canvas.height), this.timer.compute('taa'));
    }
    const outline = this.maskDraws.length > 0;
    if (outline) {
      const ts = this.timer.render('mask');
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.maskTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        ...(ts ? { timestampWrites: ts } : {}),
      });
      pass.setPipeline(this.pipes.mask);
      pass.setBindGroup(0, this.binds.mask);
      pass.setBindGroup(1, this.bucketBind, [0]);
      pass.setBindGroup(2, this.lookPass.bind); // L3 (M3): part pipelines share the look's group 2
      pass.setBindGroup(3, this.gi.bindGroup);
      pass.setVertexBuffer(0, this.lib.vertexBuffer!);
      pass.setVertexBuffer(1, this.lib.morphIndexBuffer!);
      pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
      this.maskDraws.forEach((m, k) => {
        const lod = this.lib.meshes[m.mesh]?.lods[0];
        if (lod) pass.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, k);
      });
      pass.end();
    }
    // RENDER (beta polish, D125): the gizmo's coverage at output size, un-jittered, so post keeps fog and DOF off it
    const tops = this.gizmoSharp ? this.overlayDraws.filter((o) => o.top) : [];
    if (tops.length) {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.sharpTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.setPipeline(this.pipes.topMask);
      pass.setBindGroup(0, this.binds.overlayStill);
      pass.setBindGroup(1, this.bucketBind, [0]);
      pass.setBindGroup(2, this.lookPass.bind);
      pass.setBindGroup(3, this.gi.bindGroup);
      pass.setVertexBuffer(0, this.lib.vertexBuffer!);
      pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
      for (const o of tops) {
        const lod = this.lib.meshes[o.mesh]!.lods[0]!;
        pass.drawIndexed(lod.indexCount, o.count, lod.firstIndex, lod.baseVertex, o.first);
      }
      pass.end();
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const postLook = this.lookPass.post(this.timer); // L3 (M3): fog, DOF, LUT, vignette, grain
    this.post.run(enc, this.context.getCurrentTexture().createView(), this.look0().exposure * 2 ** this.exposureBoost, time, this.timer.render('post'), outline ? Math.max(1, Math.round(this.outlinePx * dpr)) : 0, postLook, tops.length > 0);
    this.timer.resolve(enc);
    d.queue.submit([enc.finish()]);
  }

  private look0(): StudioLook { return this.envLook ?? this.look; }

  // ---- M4 (V4): VRAM probe, debug readout, device-loss recovery ---------------------------------------------

  /**
   * Boot probe (RENDERING §11): 'reserve' checks the tier budget still has room for the pools allocated later
   * (Matter state + checkpoints, keyframes: vram.ts RESERVE), 'full' for the whole rest of the budget. It runs
   * ~1.5 s after the first frame, when the boot pools are allocated and primed. Builds default to 'reserve';
   * the dev server defaults to 'off' while M4's streams share one GPU (`?vramprobe=1` or `=full` turns it on).
   */
  vramProbe: 'off' | 'reserve' | 'full' = ((): 'off' | 'reserve' | 'full' => {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('vramprobe');
    return q === 'full' ? 'full' : q === '1' || q === 'reserve' ? 'reserve' : q === '0' ? 'off' : import.meta.env?.DEV ? 'off' : 'reserve';
  })();
  private probeFrames = 0;

  private maybeProbe(): void {
    if (this.probeFrames < 0 || ++this.probeFrames < 90) return;
    this.probeFrames = -1;
    void this.runVramProbe();
  }

  /** Runs the headroom probe now (also for tests); the governor pre-steps when it comes up short. */
  async runVramProbe(mode = this.vramProbe): Promise<Awaited<ReturnType<typeof probeHeadroom>> | null> {
    const reserve = Object.values(RESERVE[this.tier]).reduce((a, b) => a + (b ?? 0), 0) - vramLedger.bytes('matter') - vramLedger.bytes('keyframes');
    const room = TIER_BUDGET[this.tier] - vramLedger.total;
    const target = Math.max(0, mode === 'full' ? room : Math.min(room, reserve));
    if (mode === 'off' || target <= 0) {
      vramGovernor.applyProbe({ target, fitted: 0, ok: true, reason: 'skipped', steps: [], ms: 0 });
      return null;
    }
    const res = await probeHeadroom(this.device, target);
    vramGovernor.applyProbe(res);
    console.info(`VRAM probe: ${res.reason}, ${(res.fitted / 2 ** 30).toFixed(2)} of ${(res.target / 2 ** 30).toFixed(2)} GB in ${res.ms.toFixed(0)} ms`);
    return res;
  }

  /** The debug readout's VRAM line (ledger by pool, governor level, pressure signals, probe). */
  vramLine(): string {
    const t = this.lookPass?.tex;
    const tex = t ? ` · sets ${t.layers} ${t.bc ? 'BC7' : 'rgba8'} (${t.stats.ktx2} ktx2, ${t.stats.png} png${t.bc ? `, ${t.stats.gpuBc7 / 3} gpu-encoded` : ''})` : '';
    return vramSummary(this.tier, `${tex}${this.recoveries ? ` · device restored ×${this.recoveries}` : ''}`);
  }

  private recovering = false;
  private simulatedLoss = false;
  /** After a recovery the replacement's device-lost handler forwards here (the replacement is discarded). */
  private owner: Renderer | null = null;
  private restoreCbs: ((r: Renderer) => void)[] = [];
  private decalUrl: string | null = null;
  /** Device losses survived (debug readout). */
  recoveries = 0;
  lastRecoveryMs = 0;

  /**
   * Subscribes to device-loss recovery: after the renderer has rebuilt itself on a new device (its pipelines,
   * scene, meshes, texture sets, look and GI), RenderHooks are gone and every owner of GPU resources made
   * with the old device rebuilds them here (Fx: volumes, debris, rings, beams; Matter; terrain). Returns an
   * unsubscribe function.
   */
  onRestore(cb: (r: Renderer) => void): () => void {
    this.restoreCbs.push(cb);
    return () => { this.restoreCbs = this.restoreCbs.filter((c) => c !== cb); };
  }

  /** Debug and tests: destroys the device the way a loss would; the renderer rebuilds itself. */
  simulateDeviceLoss(): void {
    this.simulatedLoss = true;
    this.device.destroy();
  }

  private onLost(d: GPUDevice, info: GPUDeviceLostInfo): void {
    if (d !== this.device) return;
    if (info.reason === 'destroyed' && !this.simulatedLoss) { this.lostReason = info.message || 'device destroyed'; return; }
    this.simulatedLoss = false;
    vramGovernor.pressure('lost', info.message);
    void this.recover(info.message || info.reason);
  }

  /**
   * Rebuilds on a new device: a fresh Renderer is initialised on it and its GPU state is moved into this one,
   * keeping the CPU state (meshes, scene, camera, view modes, look settings); then texture sets, the decal
   * atlas, the environment look and GI statics are replayed and the restore callbacks run. The sim worker is
   * untouched. On failure `lostReason` is set (main.ts shows its blocker).
   */
  private async recover(why: string): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    const t0 = performance.now();
    console.warn(`WebGPU device lost (${why}): rebuilding the renderer`);
    try {
      const oldLook = this.lookPass, oldGi = this.gi;
      await Promise.allSettled([...oldLook.tex.pending]);
      const journal = [...oldLook.tex.journal];
      oldLook.tex.dispose();
      oldGi.dispose();
      vramLedger.clear();
      const fresh = new Renderer(this.canvas, { tier: this.tier });
      const self = this as unknown as Record<string, unknown>, other = fresh as unknown as Record<string, unknown>;
      // the meshes and skins (CPU data) carry over: re-upload them to the new device
      other['lib'] = this.lib;
      other['skins'] = this.skins;
      (this.lib as unknown as { dirty: boolean }).dirty = true;
      (this.skins as unknown as { dirty: boolean }).dirty = this.skins.meshes.length > 0;
      // until the skins re-upload (first draw), bind groups must not see the old device's buffers
      Object.assign(this.skins, { vertexBuffer: null, skinBuffer: null, morphIndexBuffer: null, morphBuffer: null, indexBuffer: null });
      await fresh.init();
      fresh.owner = this;
      // CPU state stays; everything else (device, pipelines, buffers, textures, passes) comes from `fresh`
      const keep = new Set(['canvas', 'lib', 'skins', 'look', 'envLook', 'drawFloor', 'refraction', 'viewProj', 'eye', 'target', 'camRight', 'camUp',
        'upscale', 'timeScale', 'runMode', 'hover', 'hoverColor', 'cursor', 'buildGrid', 'exposureBoost', 'cutawayFocus', 'cutawayRadius', 'outlinePx',
        'lastScene', 'selection', 'selectionRgb', 'section', 'cutaway', 'xray', 'flashes', 'steady', 'fov', 'resolutionScale', 'tier', 't0',
        'lostReason', 'recovering', 'owner', 'restoreCbs', 'decalUrl', 'recoveries', 'lastRecoveryMs', 'vramProbe', 'probeFrames', 'morphInstances',
        'shadowFit', 'gizmoSharp', 'earth', 'lodByMesh']); // RENDER (beta polish)
      for (const k of Object.keys(other)) if (!keep.has(k)) self[k] = other[k];
      this.hooks = [];
      this.sceneDirty = true;
      // replay: look settings and environment, GI switches and statics, texture sets (same layer codes), decals
      const lp = this.lookPass;
      lp.force = oldLook.force;
      lp.governor.enabled = oldLook.governor.enabled;
      lp.setEnvironment(oldLook.set, (oldLook as unknown as { setMeshes: Parameters<LookPass['setEnvironment']>[1] }).setMeshes);
      lp.setPracticals(oldLook.practicals.list);
      this.gi.restoreFrom(oldGi);
      const sets = lp.tex.replay(journal);
      if (this.decalUrl) void this.loadDecalAtlas(this.decalUrl);
      this.setScene(this.lastScene);
      for (const cb of this.restoreCbs) {
        try { cb(this); } catch (e) { console.error('device restore callback:', e); }
      }
      this.recoveries++;
      this.lastRecoveryMs = performance.now() - t0;
      void sets.then(() => console.info(`WebGPU device restored in ${this.lastRecoveryMs.toFixed(0)} ms (texture sets reloaded after ${(performance.now() - t0).toFixed(0)} ms)`));
    } catch (e) {
      console.error('WebGPU device recovery failed:', e);
      this.lostReason = `device lost (${why}); recovery failed: ${(e as Error).message}`;
    } finally {
      this.recovering = false;
    }
  }

  // ---- G3 (M3): Spectacle hooks, GI, upscaler ---------------------------------------------------------

  /** Internal / output scale for this output height: `upscale` when set, else auto (D81: 4K on 16 GB renders
   * 1440p internal; D85: tier 32 ≥ 1800p). 0 = native (4× MSAA, no TAA). */
  private upscaleFor(outH: number): number {
    if (this.upscale > 0) return this.upscale >= 1 ? 0 : this.upscale;
    const target = this.tier >= 32 ? 1800 : this.tier >= 16 ? 1440 : this.tier >= 12 ? 1440 : 1080;
    return outH > target * 1.05 ? target / outH : 0;
  }

  /** Registers Spectacle hooks (fx.ts). */
  addHook(h: RenderHook): void { this.hooks.push(h); }

  /** Stop: every hook drops its live effects. */
  clearHooks(): void { for (const h of this.hooks) h.clear?.(); }

  /** Direction to the key light (world). */
  get keyDir(): V3 { return this.look0().key; }

  /** Internal render size (the canvas size unless upscaling). */
  get internalSize(): [number, number] { return [this.rw, this.rh]; }

  /** What the Spectacle systems need to build their pipelines against the renderer's targets. */
  spectacleTargets(): { device: GPUDevice; frameBuf: GPUBuffer; shadowView: GPUTextureView; shadowFarView: GPUTextureView; shadowSampler: GPUSampler; colorFormat: GPUTextureFormat; msaa: number; gi: Gi } {
    return { device: this.device, frameBuf: this.frameBuf, shadowView: this.shadowMap.createView(), shadowFarView: this.shadowFarMap.createView(), shadowSampler: this.shadowSampler, colorFormat: HDR_FORMAT, msaa: MSAA, gi: this.gi };
  }

  /** R4 (M4): what Matter surfaces need to shade like parts: the part pipeline's group layouts (0 part, 2 look,
   * 3 GI; Matter brings its own group 1) and this frame's bind groups for them (re-read every frame: they are
   * rebuilt on scene and size changes). */
  matterTargets(): { partLayout: GPUBindGroupLayout; lookLayout: GPUBindGroupLayout; giLayout: GPUBindGroupLayout; group0: GPUBindGroup; look: GPUBindGroup; gi: GPUBindGroup; prepassFormat: GPUTextureFormat; tier: 4 | 8 | 12 | 16 | 32 } {
    return { partLayout: this.partLayout, lookLayout: this.lookPass.layout, giLayout: this.gi.layout, group0: this.binds.overlay, look: this.lookPass.bind, gi: this.gi.bindGroup, prepassFormat: 'depth32float', tier: this.tier };
  }

  /** L3 (M3): extra internal-resolution factor (benchmarks force 4K output, the governor has its own). */
  resolutionScale = 1;

  /** L3 (M3): world centre of the selection (Build: instance poses are world), for the DOF focus. */
  private selectionCenter(): V3 | null {
    if (!this.selectionRgb || !this.selection.length || this.runMode) return null;
    const s: V3 = [0, 0, 0];
    let n = 0;
    for (const i of this.selection) {
      if (i < 0 || i >= this.sceneCount) continue;
      const p = this.lastScene.poseOf(i).pos;
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; n++;
    }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : null;
  }

  private frameBufSpot: GPUBuffer | null = null;

  /**
   * L3 (M3): the shadowed practical's map: the look draws the cached set casters, this adds the scene's opaque instances
   * inside the lamp's frustum, through a copy of the frame uniform whose shadowMat is the lamp's camera-relative matrix
   * (so vs_shadow is reused as-is). RENDER (beta polish, D125): the instances are culled on the GPU by the same compute
   * pass as the views (`views.spot`, the lamp's frustum planes) and drawn per bucket, indirect, with the shadow LOD
   * policy. The M5 CPU cone test cost 7.4–8 ms per frame at 400k parts (M5_NOTES_T5 finding 2).
   */
  private drawSpotShadow(enc: GPUCommandEncoder): void {
    this.lookPass.practicalShadow(enc, this.lib, (pass, vp) => {
      const pr = this.lookPass.practicals, s = pr.list[pr.shadowIndex];
      if (!s || !this.sceneCount || !this.frameBufSpot) return;
      const d = this.device, e = this.eye;
      d.queue.writeBuffer(this.frameBufSpot, 0, this.frameData);
      d.queue.writeBuffer(this.frameBufSpot, 128, mul(vp, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e[0], e[1], e[2], 1])));
      pass.setPipeline(this.pipes.shadow);
      pass.setBindGroup(0, this.binds.shadowSpot);
      this.drawBuckets(pass, this.views.spot.args, false);
      this.drawProxies(pass, this.binds.shadowSpot, this.views.spot.args);
    }, this.timer);
  }

  /** L3 (M3): the look's half-res depth prepass (scene buckets, critters, opaque overlays incl. the set),
   * then its AO + contact compute and the froxel fog (look/index.ts). */
  private drawLookPrepass(enc: GPUCommandEncoder, relView: Mat4): void {
    const lp = this.lookPass;
    const ts = this.timer.render('look.pre');
    const pass = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: lp.depthTarget.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      ...(ts ? { timestampWrites: ts } : {}),
    });
    pass.setBindGroup(0, this.binds.scene);
    pass.setBindGroup(1, this.bucketBind, [0]);
    pass.setBindGroup(2, lp.bind);
    pass.setBindGroup(3, this.gi.bindGroup);
    pass.setPipeline(this.prePipes.scene);
    this.drawBuckets(pass, this.views.cam.args, false);
    if (this.skinDraws.length) {
      pass.setPipeline(this.prePipes.skin);
      pass.setBindGroup(0, this.binds.skin);
      pass.setBindGroup(1, this.bucketBind, [0]);
      this.drawSkinned(pass, true);
    }
    const draws = this.overlayDraws.filter((o) => !o.ghost && !o.xray && !o.top);
    if (draws.length) {
      pass.setPipeline(this.prePipes.overlay);
      pass.setBindGroup(0, this.binds.overlay);
      pass.setBindGroup(1, this.bucketBind, [0]);
      pass.setVertexBuffer(0, this.lib.vertexBuffer!);
      pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
      for (const o of draws) {
        const lod = this.lib.meshes[o.mesh]!.lods[o.lod ?? 0]!;
        pass.drawIndexed(lod.indexCount, o.count, lod.firstIndex, lod.baseVertex, o.first);
      }
    }
    for (const h of this.hooks) h.drawPrepass?.(pass); // R4 (M4): Matter grains (AO, fog and DOF see them)
    pass.end();
    lp.ao(enc, relView, this.look0().key, this.gi, this.timer);
    lp.fog(enc, this.frameBuf, this.shadowMap, this.timer);
  }

  /** Opaque overlay draws (late = false) or ghosts (late = true). */
  private drawOverlay(pass: GPURenderPassEncoder, ghosts: boolean, top = false): void {
    const draws = this.overlayDraws.filter((o) => (top ? !!o.top : !o.top && o.ghost === ghosts));
    if (!draws.length) return;
    pass.setBindGroup(0, this.binds.overlay);
    pass.setBindGroup(1, this.bucketBind, [0]);
    pass.setVertexBuffer(0, this.lib.vertexBuffer!);
    pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
    const base = top ? this.pipes.top : ghosts ? this.pipes.ghost : this.pipes.overlay;
    let cur: GPURenderPipeline | null = null;
    for (const o of draws) {
      const pipe = o.earth ? this.pipes.earth : base; // RENDER (beta polish, D126): the runtime-lit Earth
      if (pipe !== cur) { pass.setPipeline(pipe); cur = pipe; }
      const lod = this.lib.meshes[o.mesh]!.lods[o.lod ?? 0]!;
      pass.drawIndexed(lod.indexCount, o.count, lod.firstIndex, lod.baseVertex, o.first);
    }
  }

  /** After the opaque scene: sorted glass, ghosts, x-ray glows, particles. */
  private drawLate(pass: GPURenderPassEncoder, glass: boolean): void {
    for (const h of this.hooks) h.drawMatter?.(pass); // R4 (M4): Matter water (pass 16) before transmission (17)
    if (glass && this.glassDraws.length) {
      pass.setBindGroup(1, this.bucketBind, [0]);
      // L3 (M3): the look's group 2 + the opaque copy (R4: with the water resolved in, when there is water)
      let glassScene = this.sceneTex;
      for (const h of this.hooks) glassScene = h.glassScene?.() ?? glassScene;
      pass.setBindGroup(2, this.lookPass.bindGlass(glassScene));
      pass.setBindGroup(3, this.gi.bindGroup);
      pass.setVertexBuffer(0, this.lib.vertexBuffer!);
      pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
      let group: boolean | null = null;
      this.glassDraws.forEach((g, k) => {
        const lod = this.lib.meshes[g.mesh]?.lods[0];
        if (!lod) return;
        if (group !== g.overlay) { pass.setBindGroup(0, g.overlay ? this.binds.glassOverlay : this.binds.glassScene); group = g.overlay; }
        // back faces first, then front faces: a closed shell sorts itself
        pass.setPipeline(this.pipes.glassBack);
        pass.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, k);
        pass.setPipeline(this.pipes.glassFront);
        pass.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, k);
      });
    }
    // L3 (M3): ghosts and x-ray use the part layout's groups 2 and 3 (also in a late pass without glass)
    pass.setBindGroup(2, this.lookPass.bind);
    pass.setBindGroup(3, this.gi.bindGroup);
    this.drawOverlay(pass, true);
    if (this.xray !== 'off') {
      if (this.xray === 'all') {
        pass.setPipeline(this.pipes.xrayHidden);
        pass.setBindGroup(0, this.binds.scene);
        this.drawBuckets(pass, this.views.cam.args, false);
      }
      const links = this.overlayDraws.filter((o) => o.xray);
      if (links.length) {
        pass.setPipeline(this.pipes.xrayGlow);
        pass.setBindGroup(0, this.binds.overlay);
        pass.setBindGroup(1, this.bucketBind, [0]);
        pass.setVertexBuffer(0, this.lib.vertexBuffer!);
        pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
        for (const o of links) {
          const lod = this.lib.meshes[o.mesh]!.lods[0]!;
          pass.drawIndexed(lod.indexCount, o.count, lod.firstIndex, lod.baseVertex, o.first);
        }
      }
    }
    this.gi.drawDebug(pass); // G3: ?gi=sdf | gi debug view (replaces the frame)
    for (const h of this.hooks) h.drawLate?.(pass); // G3: shock rings, volumetric composite
    this.particles.draw(pass);
    // DRAG (D117): the transform gizmo, over everything (frame graph pass 20, RENDERING §10)
    pass.setBindGroup(2, this.lookPass.bind);
    pass.setBindGroup(3, this.gi.bindGroup);
    this.drawOverlay(pass, false, true);
  }

  /** RENDER (beta polish, D125): the shadow box proxies the cull put in each mesh's proxy bucket. */
  private drawProxies(pass: GPURenderPassEncoder, bind: GPUBindGroup, args: GPUBuffer): void {
    if (!this.proxyBuckets.length || this.section) return;
    pass.setPipeline(this.pipes.shadowBox);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, this.lib.vertexBuffer!);
    pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
    for (const b of this.proxyBuckets) {
      pass.setBindGroup(1, this.bucketBind, [b * BUCKET_STRIDE]);
      pass.drawIndexedIndirect(args, b * 20);
    }
  }

  /** RENDER (beta polish, D125): the shadowed practical's camera-relative matrix when its map renders this frame, else null. */
  private spotCullMatrix(): Mat4 | null {
    const pr = this.lookPass.practicals;
    if (!this.lookPass.practicalShadowOn || !pr.list[pr.shadowIndex] || !this.sceneCount) return null;
    const e = this.eye;
    return mul(pr.vp, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e[0], e[1], e[2], 1]));
  }

  private drawBuckets(pass: GPURenderPassEncoder, args: GPUBuffer, glass: boolean): void {
    pass.setVertexBuffer(0, this.lib.vertexBuffer!);
    pass.setVertexBuffer(1, this.lib.morphIndexBuffer!);
    pass.setIndexBuffer(this.lib.indexBuffer!, 'uint32');
    for (let b = 0; b < this.buckets.length; b++) {
      if (this.buckets[b]!.glass !== glass || this.buckets[b]!.impostor || this.buckets[b]!.proxy) continue; // S3: impostors draw in drawImpostors; RENDER: proxies in drawProxies
      pass.setBindGroup(1, this.bucketBind, [b * BUCKET_STRIDE]);
      pass.drawIndexedIndirect(args, b * 20);
    }
  }

  private drawSkinned(pass: GPURenderPassEncoder, morph = false): void {
    if (!this.skins.vertexBuffer) return;
    pass.setBindGroup(1, this.bucketBind, [0]);
    pass.setVertexBuffer(0, this.skins.vertexBuffer);
    pass.setVertexBuffer(1, this.skins.skinBuffer!);
    if (morph) pass.setVertexBuffer(2, this.skins.morphIndexBuffer!);
    pass.setIndexBuffer(this.skins.indexBuffer!, 'uint32');
    this.skinDraws.forEach((s, k) => {
      const m = this.skins.meshes[s.mesh]!;
      pass.drawIndexed(m.indexCount, 1, m.firstIndex, m.baseVertex, k);
    });
  }

  /** Glass instances in view, farthest first (CPU: there are few). */
  private prepareGlass(relVP: Mat4): void {
    const list: GlassEntry[] = [];
    const pl = planes(relVP);
    const e = this.eye, data = this.lastScene, xf = this.xfCpu;
    const visible = (c: V3, r: number): boolean => pl.every((p) => p[0] * (c[0] - e[0]) + p[1] * (c[1] - e[1]) + p[2] * (c[2] - e[2]) + p[3] >= -r);
    for (const g of this.sceneGlass) {
      if (data.hiddenAt(g.idx)) continue;
      const m = this.lib.meshes[g.mesh]!;
      const p = data.poseOf(g.idx);
      let pos: V3 = p.pos, rot: Quat = p.rot;
      const b = data.bodyOf(g.idx);
      if (this.runMode && b >= 0 && xf.length >= b * 7 + 7) {
        const bq: Quat = [xf[b * 7 + 3]!, xf[b * 7 + 4]!, xf[b * 7 + 5]!, xf[b * 7 + 6]!];
        const w = qrotV(bq, pos);
        pos = [xf[b * 7]! + w[0], xf[b * 7 + 1]! + w[1], xf[b * 7 + 2]! + w[2]];
        rot = qmulQ(bq, rot);
      }
      const c = qrotV(rot, [m.center[0] * p.size[0], m.center[1] * p.size[1], m.center[2] * p.size[2]]);
      const center: V3 = [pos[0] + c[0], pos[1] + c[1], pos[2] + c[2]];
      const r = m.radius * Math.max(...p.size);
      if (this.section && !boxHit(this.section, center, r)) continue;
      if (visible(center, r)) list.push({ idx: g.idx, mesh: g.mesh, overlay: false, center, r });
    }
    for (const g of this.overlayGlass) if (visible(g.center, g.r)) list.push(g);
    const d2 = (c: V3): number => (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2;
    list.sort((a, b) => d2(b.center) - d2(a.center));
    this.glassDraws = list;
    this.stats.glass = list.length;
    if (!list.length) return;
    if (list.length > this.glassListCap) {
      this.glassList.destroy();
      this.glassListCap = list.length * 2;
      this.glassList = this.device.createBuffer({ size: this.glassListCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.rebind();
    }
    this.device.queue.writeBuffer(this.glassList, 0, Uint32Array.from(list, (g) => g.idx));
  }

  /** Selection mask entries in draw order (later wins): hover, partner/lock outlines, the selection. */
  private prepareMask(): void {
    const data = this.lastScene, n = this.sceneCount;
    const out: MaskEntry[] = [];
    const add = (idx: number, color: number): void => { if (idx >= 0 && idx < n && !data.hiddenAt(idx)) out.push({ idx, mesh: data.meshOf(idx), color }); };
    if (this.hover >= 0) add(this.hover, packLinear(this.hoverColor, 0.5));
    for (const l of this.lockOutlines) add(l.idx, l.color);
    if (this.selectionRgb) { const c = packLinear(this.selectionRgb, 1); for (const i of this.selection) add(i, c); }
    this.maskDraws = out;
    this.stats.mask = out.length;
    if (!out.length) return;
    if (out.length > this.maskCap) {
      this.maskBuf.destroy();
      this.maskCap = out.length * 2;
      this.maskBuf = this.device.createBuffer({ size: this.maskCap * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.rebind();
    }
    const u = new Uint32Array(out.length * 2);
    out.forEach((m, k) => { u[k * 2] = m.idx; u[k * 2 + 1] = m.color; });
    this.device.queue.writeBuffer(this.maskBuf, 0, u);
  }

  private relativeViewProj(): Mat4 {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const t = this.target, e = this.eye;
    return mul(perspective((this.fov * Math.PI) / 180, aspect, 0.02, 2000), lookAt([0, 0, 0], [t[0] - e[0], t[1] - e[1], t[2] - e[2]], [0, 1, 0]));
  }

  /**
   * The key light's cascades (RENDER, beta polish, D125; gfx/shadowfit.ts): the near map around the camera focus, fitted
   * to the scene's bounds, and the far map over the rest of the view up to the shadow distance (null when the near map
   * holds everything in view). Returns the near map's camera-relative matrix (frame.shadowMat).
   */
  private shadowMatrix(): Mat4 {
    const e = this.eye, f = this.target, key = this.look0().key;
    if (this.runMode) this.growSceneBox();
    if (!this.shadowFit) {
      this.nearFit = fitLegacy(key, e, f, this.shadowSize); // the M5 single map, for before/after timings
      this.farFit = null;
    } else {
      this.nearFit = fitNear(key, e, f, this.shadowSize, this.sceneBox);
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      this.farFit = fitFar(key, e, f, this.fov, aspect, this.shadowSize / 2, this.sceneBox, this.nearFit);
    }
    this.shadowTexel = this.nearFit.texel;
    return this.nearFit.mat;
  }

  /** The scene's world bounds (instance centres ± radius; run mode composes the body transforms), padded 1 m. */
  private computeSceneBox(data: InstanceData): { min: V3; max: V3 } | null {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    const xf = this.xfCpu;
    for (let k = 0; k < data.count; k++) {
      if (data.hiddenAt(k)) continue;
      const p = data.poseOf(k);
      let pos: V3 = p.pos;
      const b = data.bodyOf(k);
      if (b >= 0 && xf.length >= b * 7 + 7 && this.runMode) {
        const w = qrotV([xf[b * 7 + 3]!, xf[b * 7 + 4]!, xf[b * 7 + 5]!, xf[b * 7 + 6]!], pos);
        pos = [xf[b * 7]! + w[0], xf[b * 7 + 1]! + w[1], xf[b * 7 + 2]! + w[2]];
      }
      const r = 0.5 * Math.hypot(p.size[0], p.size[1], p.size[2]) * Math.max(1, this.lib.meshes[data.meshOf(k)]?.radius ?? 1);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, pos[i]! - r); max[i] = Math.max(max[i]!, pos[i]! + r); }
    }
    if (!Number.isFinite(min[0])) return null;
    return { min: [min[0] - 1, Math.min(min[1], 0) - 1, min[2] - 1], max: [max[0] + 1, max[1] + 1, max[2] + 1] };
  }

  /** Run mode: grows the scene's bounds by up to 32k bodies per frame (round robin), so flying parts keep their shadows. */
  private growSceneBox(): void {
    const xf = this.xfCpu, n = Math.floor(xf.length / 7);
    if (!n) return;
    const b = this.sceneBox ?? { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3 };
    let grew = false;
    for (let c = 0; c < Math.min(n, 32768); c++) {
      const i = (this.boundsCursor + c) % n, o = i * 7;
      for (let k = 0; k < 3; k++) {
        const v = xf[o + k]!;
        if (!Number.isFinite(v)) continue;
        if (v - 2 < b.min[k]!) { b.min[k] = v - 2; grew = true; }
        if (v + 2 > b.max[k]!) { b.max[k] = v + 2; grew = true; }
      }
    }
    this.boundsCursor = (this.boundsCursor + Math.min(n, 32768)) % n;
    if (grew || !this.sceneBox) this.sceneBox = b;
  }

  private shadowTexel = 0.01;

  private writeFrame(relVP: Mat4, shadowVP: Mat4, time: number, now: number): void {
    const f = new Float32Array(this.frameData), u = new Uint32Array(this.frameData);
    const L = this.look0();
    f.set(relVP, 0);
    f.set(invert(relVP), 16);
    f.set(shadowVP, 32);
    f.set([this.eye[0], this.eye[1], this.eye[2], time], 48);
    f.set([...L.key, L.keyI], 52);
    f.set([...L.fill, L.fillI], 56);
    f.set([...L.rim, L.rimI], 60);
    f.set([...(L.keyColor ?? [1, 0.98, 0.95]), 1], 64);
    f.set([...L.rimColor, 1], 68);
    const c = L.cyc;
    f.set([c[0] * 1.15, c[1] * 1.15, c[2] * 1.17, 1], 72); // sky top: a touch brighter and cooler
    f.set([c[0], c[1], c[2], 1], 76); // horizon = cove colour
    f.set([c[0] * 0.92, c[1] * 0.92, c[2] * 0.92, L.etch], 80); // floor albedo
    f.set([1, this.runMode ? 1 : 0, this.shadowTexel, this.runMode ? 0 : this.buildGrid], 84);
    const cur = this.cursor;
    f.set(cur ? [cur[0], cur[1], cur[2], 1] : [0, 0, 0, 0], 88);
    u[92] = 0xffffffff;
    u[93] = 0;
    // point lights: fading flashes + this frame's steady lights, strongest first, up to the cap
    this.flashes = this.flashes.filter((l) => now - l.t0 < l.dur);
    const live = [
      ...this.flashes.map((l) => ({ l, k: (1 - (now - l.t0) / l.dur) ** 2 })),
      ...this.steady.map((l) => ({ l, k: 1 })),
    ].sort((a, b) => b.k * b.l.radius - a.k * a.l.radius).slice(0, MAX_LIGHTS);
    this.steady = [];
    u[94] = live.length;
    live.forEach(({ l, k }, i) => {
      this.lightData.set([l.pos[0], l.pos[1], l.pos[2], l.radius, l.color[0] * k, l.color[1] * k, l.color[2] * k, 1], i * 8);
    });
    if (live.length) this.device.queue.writeBuffer(this.lightBuf, 0, this.lightData, 0, live.length * 8);
    // relative view matrix + projection parameters for clustering
    const e = this.eye, t = this.target;
    f.set(lookAt([0, 0, 0], [t[0] - e[0], t[1] - e[1], t[2] - e[2]], [0, 1, 0]), 96);
    f.set([Math.tan((this.fov * Math.PI) / 360), this.canvas.width / Math.max(1, this.canvas.height), CLUSTER.near, CLUSTER.far], 112);
    // M2: section box, cutaway, x-ray, refraction, floor
    const s = this.section;
    f.set(s ? [s.min[0], s.min[1], s.min[2], 1] : [0, 0, 0, 0], 116);
    f.set(s ? [s.max[0], s.max[1], s.max[2], 0] : [0, 0, 0, 0], 120);
    if (this.cutaway) {
      const fc = this.cutawayFocus ?? this.target;
      const dist = Math.hypot(fc[0] - e[0], fc[1] - e[1], fc[2] - e[2]);
      f.set([fc[0], fc[1], fc[2], this.cutawayRadius > 0 ? this.cutawayRadius : Math.max(0.2, dist * 0.2)], 124);
    } else f.set([0, 0, 0, 0], 124);
    f.set([this.xray === 'off' ? 0 : this.xray === 'links' ? 1 : 2, this.refraction, this.drawFloor ? 1 : 0, 0], 128);
    // R5 (M5): stasis volumes (the time-stopped look) and singularities (body stretch), set per frame by gfx/future
    const m5 = this.m5Frame;
    const ns = Math.min(FRAME_STASIS, m5.stasis.length), ng = Math.min(FRAME_SING, m5.sing.length);
    f.set([ns, ng, m5.stretch, time], 132);
    for (let k = 0; k < ns; k++) {
      const b = m5.stasis[k]!;
      f.set([b.center[0], b.center[1], b.center[2], 0, b.half[0], b.half[1], b.half[2], 0, b.rot[0], b.rot[1], b.rot[2], b.rot[3]], 136 + k * 12);
    }
    for (let k = 0; k < ng; k++) { const s = m5.sing[k]!; f.set([s.pos[0], s.pos[1], s.pos[2], s.strength], 136 + FRAME_STASIS * 12 + k * 4); }
    f.set(this.wetBuf ? this.wetRect : [0, 0, 1, 0], 136 + FRAME_STASIS * 12 + FRAME_SING * 4); // R5 (M5): wetness grid
    // RENDER (beta polish, D125): the far cascade (fade over the last 20 % of the shadow distance) and both depth biases
    // (the near one keeps M5's 0.0002 of the plain focus box's depth range, in world units)
    const nf = this.nearFit, ff = this.farFit;
    if (ff) {
      const sd = shadowDistance(Math.hypot(this.target[0] - this.eye[0], this.target[1] - this.eye[1], this.target[2] - this.eye[2]));
      f.set(ff.mat, FRAME_FAR);
      f.set([1, sd * 0.8, sd, ff.texel], FRAME_FAR + 16);
    } else f.set([0, 0, 0, 0], FRAME_FAR + 16);
    const nearRange = nf ? nf.zFar - nf.zNear : 1;
    const nearBias = nf ? (0.0002 * 2 * (nf.ext * 4 + 20)) / nearRange : 0.0002;
    f.set([nearBias, ff ? (2 * ff.texel) / (ff.zFar - ff.zNear) : 0, 0, 0], FRAME_FAR + 20);
    // RENDER (beta polish, D126): the runtime-lit Earth
    const ea = this.earth;
    f.set(ea ? [...ea.axis, ea.angle, ...ea.sun, 2] : [0, 1, 0, 0, 0, 1, 0, 0], FRAME_FAR + 24);
    this.device.queue.writeBuffer(this.frameBuf, 0, this.frameData);
  }

  /** fixedLod: 0 by distance (camera), n > 0 always LOD n − 1, −1 shadow casters (RENDER, D125: by size on screen). */
  private writeCull(v: CullViewRes, vp: Mat4, fixedLod: number, texel = 0, proxyTexels = 0, lamp?: readonly number[]): void {
    const b = new ArrayBuffer(CULL_BYTES);
    const f = new Float32Array(b), u = new Uint32Array(b);
    planes(vp).forEach((p, i) => f.set(p, i * 4));
    f.set([this.eye[0], this.eye[1], this.eye[2], 0], 24);
    const projScale = 1 / Math.tan((this.fov * Math.PI) / 360);
    f[28] = projScale;
    // S3: impostor size as a projected radius / half-height (camera view only; the shadow view keeps meshes)
    // RENDER (beta polish, D125): with real mesh sizes, impostors switch in under IMPOSTOR_MAX_PX across (the preset's 24 px
    // stays the ceiling): at 24 px their flatter shading popped visibly (STITCH, BRIK); M5's oversized radius had hidden it
    const impPx = this.lodByMesh ? Math.min(this.impostors?.thresholdPx ?? 0, IMPOSTOR_MAX_PX) : this.impostors?.thresholdPx ?? 0;
    f[29] = fixedLod === 0 && this.impostorBuckets.length && this.impostors ? impPx / Math.max(1, this.internalSize[1]) : 0;
    if (fixedLod < 0) {
      // RENDER (beta polish, D125): projected radius / half-height for the box proxies (none with the section box: they
      // aren't clipped) and the skip size
      const half = Math.max(1, this.internalSize[1]) / 2;
      f[30] = this.section ? 1e-9 : SHADOW_PROXY_PX / half;
      f[31] = SHADOW_SKIP_PX / half;
      // and by size in that map: a box under `proxyTexels` texels of radius, nothing under a third of a texel
      f[44] = this.section ? 0 : texel * proxyTexels;
      f[45] = texel * 0.35;
      f[46] = v === this.views.far ? 1 : 0; // the far map draws every caster at its coarsest LOD
      // casters whose shadow can't reach the view (behind the camera, off to the sides) are skipped: the camera's planes
      // with the shadow distance as the far plane, each sphere swept along −key as far as the longest shadow
      const sb = this.sceneBox, key = this.look0().key;
      if (sb && this.shadowFit) {
        const aspect = this.canvas.width / Math.max(1, this.canvas.height);
        const t = this.target, e = this.eye;
        const sd = shadowDistance(Math.hypot(t[0] - e[0], t[1] - e[1], t[2] - e[2]));
        const cam = mul(perspective((this.fov * Math.PI) / 180, aspect, 0.02, sd), lookAt([0, 0, 0], [t[0] - e[0], t[1] - e[1], t[2] - e[2]], [0, 1, 0]));
        planes(cam).forEach((p, i) => f.set(p, 48 + i * 4));
        const len = Math.min(400, (sb.max[1] - sb.min[1]) / Math.max(0.1, key[1]) + 2);
        if (!lamp) f.set([-key[0], -key[1], -key[2], len], 72);
      }
      if (lamp) f.set(lamp, 76);
    }
    f[47] = this.lodByMesh ? 0 : 1; // RENDER (beta polish, D125): 1 = M5's sizing (debug)
    u[32] = this.sceneCount; u[33] = this.runMode ? 1 : 0; u[34] = Math.max(0, fixedLod); u[35] = this.buckets.length;
    const s = this.section;
    if (s) { f.set([s.min[0], s.min[1], s.min[2], 1], 36); f.set([s.max[0], s.max[1], s.max[2], 0], 40); }
    this.device.queue.writeBuffer(v.uniform, 0, b);
    if (this.argsTemplate.length) this.device.queue.writeBuffer(v.args, 0, this.argsTemplate);
  }
}

interface CullViewRes { args: GPUBuffer; visible: GPUBuffer; uniform: GPUBuffer; bind: GPUBindGroup | null }

function boxHit(b: { min: V3; max: V3 }, c: V3, r: number): boolean {
  let d2 = 0;
  for (let i = 0; i < 3; i++) { const q = Math.max(b.min[i]!, Math.min(b.max[i]!, c[i]!)) - c[i]!; d2 += q * q; }
  return d2 <= r * r;
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1;
  return m;
}

/** Frustum planes (normalised, pointing inward) from a WebGPU clip matrix (z in [0, 1]). */
function planes(m: Mat4): [number, number, number, number][] {
  const row = (r: number): number[] => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a: number[], b: number[], s: number): number[] => a.map((x, i) => x + s * b[i]!);
  return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), r2, add(r3, r2, -1)].map((p) => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    return [p[0]! / l, p[1]! / l, p[2]! / l, p[3]! / l];
  });
}
