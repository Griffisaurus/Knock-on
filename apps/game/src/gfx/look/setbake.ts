// Set lighting baked when the environment changes (RENDERING §6.2–6.3, D81 win-back 2):
//  - the static **set shadow map**: an orthographic sun shadow of the whole set (walls, window frames,
//    bench, shelves), cached until the set changes. It is the far cascade of the part shader's sun
//    shadow (multiplied with the near map, whose casters are the parts) and lights the froxel shafts;
//  - the **set IBL** (`ibl_<set>`): a cube rendered from a probe point inside the set (sun through the
//    windows with the set shadow, cool sky fill, emissive practicals and sky cards), then prefiltered
//    for GGX specular (one roughness per mip) and cosine-convolved into a small irradiance cube.
//    This is the in-engine bake of RENDERING §6.2; a Blender-baked file can replace it later.

import type { MeshLibrary } from '../meshes.ts';
import { VERTEX_STRIDE } from '../meshes.ts';
import type { Mat4, V3 } from '../../math.ts';
import { lookAt, mul } from '../../math.ts';

/** A set mesh at its preset offset; `shadow: false` / `ibl: false` leave it out of the set shadow / IBL bake. */
export interface SetMesh { readonly mesh: number; readonly offset: V3; readonly shadow?: boolean; readonly ibl?: boolean }

export interface SetLight {
  /** Direction to the sun (unit), its colour × intensity. */
  readonly sun: V3; readonly sunColor: readonly [number, number, number];
  /** Sky (window and world) colours for the bake's background and hemisphere fill. */
  readonly skyTop: readonly [number, number, number]; readonly horizon: readonly [number, number, number]; readonly ground: readonly [number, number, number];
  /** Emissive multiplier (practicals, sky cards) and the probe position (world). */
  readonly emissive: number; readonly probe: V3;
  /** Set bounds (world) for the set shadow map. */
  readonly bounds: { readonly min: V3; readonly max: V3 };
}

const BAKE_WGSL = /* wgsl */ `
struct U {
  vp: mat4x4f,        // face projection (world relative to the probe) or the set shadow view-projection
  shadow: mat4x4f,    // world → set shadow clip
  probe: vec4f,       // probe position (world); w = 1 for the IBL pass, 0 for the shadow pass
  offset: vec4f,      // set mesh offset (world)
  sun: vec4f,         // direction to the sun, w unused
  sunColor: vec4f,
  skyTop: vec4f, horizon: vec4f, ground: vec4f, // w of skyTop = emissive multiplier
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSamp: sampler_comparison;

struct VOut { @builtin(position) clip: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) col: vec4f, @location(3) mat: vec4f };
@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) col: vec4f, @location(3) mat: vec4f) -> VOut {
  var o: VOut;
  o.world = pos + u.offset.xyz;
  o.clip = u.vp * vec4f(o.world - u.probe.xyz * u.probe.w, 1.0);
  o.n = nrm.xyz;
  o.col = col;
  o.mat = mat;
  return o;
}
@vertex fn vs_shadow(@location(0) pos: vec3f) -> @builtin(position) vec4f {
  return u.vp * vec4f(pos + u.offset.xyz, 1.0);
}
fn sky(d: vec3f) -> vec3f {
  let up = mix(u.horizon.rgb, u.skyTop.rgb, smoothstep(-0.02, 0.7, d.y));
  return select(up, mix(u.horizon.rgb, u.ground.rgb, smoothstep(0.0, -0.4, d.y)), d.y < 0.0);
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  var n = normalize(i.n);
  // light the side the probe sees (cube faces mirror the winding, so front_facing is unreliable here)
  if (dot(n, u.probe.xyz - i.world) < 0.0) { n = -n; }
  let albedo = pow(i.col.rgb, vec3f(2.2));
  let p = u.shadow * vec4f(i.world + n * 0.02, 1.0);
  let suv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  var vis = 1.0;
  if (all(suv >= vec2f(0.0)) && all(suv <= vec2f(1.0)) && p.z < 1.0) { vis = textureSampleCompareLevel(shadowMap, shadowSamp, suv, p.z - 0.001); }
  let ndl = max(dot(n, u.sun.xyz), 0.0);
  // hemisphere fill + a little warm bounce from below (the bench and floor), then the sun
  let hemi = mix(u.ground.rgb * 0.6, u.skyTop.rgb, n.y * 0.5 + 0.5);
  var c = albedo * (u.sunColor.rgb * ndl * vis + hemi * 0.6);
  // emissive (practicals, sky cards): kind bytes 224+ are masters; mat.z is the emissive factor
  c += albedo * i.mat.z * 12.0 * u.skyTop.w;
  return vec4f(c, 1.0);
}

struct SkyOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vs_sky(@builtin(vertex_index) vi: u32) -> SkyOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return SkyOut(vec4f(p, 1.0, 1.0), p);
}
@group(0) @binding(3) var<uniform> face: mat4x4f; // columns: right, up, forward (world)
@fragment fn fs_sky(i: SkyOut) -> @location(0) vec4f {
  let d = normalize(face[0].xyz * i.ndc.x + face[1].xyz * i.ndc.y + face[2].xyz);
  var c = sky(d);
  // the sun's disc and glow, so glossy surfaces pick up a hot spot toward the windows
  let s = max(dot(d, u.sun.xyz), 0.0);
  c += u.sunColor.rgb * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.25) * u.probe.w;
  return vec4f(c, 1.0);
}
`;

const FILTER_WGSL = /* wgsl */ `
struct FsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> FsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return FsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
struct F { face: u32, mode: u32, rough: f32, srcSize: f32 };
@group(0) @binding(0) var<uniform> f: F;
@group(0) @binding(1) var src: texture_cube<f32>;
@group(0) @binding(2) var samp: sampler;

fn dirOf(face: u32, uv: vec2f) -> vec3f {
  let a = uv * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -a.y, -a.x)); }
    case 1u: { return normalize(vec3f(-1.0, -a.y, a.x)); }
    case 2u: { return normalize(vec3f(a.x, 1.0, a.y)); }
    case 3u: { return normalize(vec3f(a.x, -1.0, -a.y)); }
    case 4u: { return normalize(vec3f(a.x, -a.y, 1.0)); }
    default: { return normalize(vec3f(-a.x, -a.y, -1.0)); }
  }
}
fn hammersley(i: u32, n: u32) -> vec2f {
  var b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10);
}
fn basis(n: vec3f) -> mat3x3f {
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.99);
  let t = normalize(cross(up, n));
  return mat3x3f(t, cross(n, t), n);
}
@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  let n = dirOf(f.face, i.uv);
  if (f.mode == 0u) { return vec4f(textureSampleLevel(src, samp, n, 0.0).rgb, 1.0); }
  let tbn = basis(n);
  if (f.mode == 2u) {
    // cosine-weighted irradiance (divided by pi: the shader multiplies by albedo)
    var acc = vec3f(0.0);
    let N = 256u;
    for (var k = 0u; k < N; k++) {
      let x = hammersley(k, N);
      let phi = 6.2831853 * x.y;
      let ct = sqrt(1.0 - x.x);
      let st = sqrt(x.x);
      let d = tbn * vec3f(cos(phi) * st, sin(phi) * st, ct);
      acc += textureSampleLevel(src, samp, d, 4.0).rgb;
    }
    return vec4f(acc / f32(N), 1.0);
  }
  // GGX prefilter (N = V = R), filtered importance sampling from the source mips
  let a = max(f.rough * f.rough, 0.002);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  let N = 96u;
  for (var k = 0u; k < N; k++) {
    let x = hammersley(k, N);
    let phi = 6.2831853 * x.y;
    let ct = sqrt((1.0 - x.x) / (1.0 + (a * a - 1.0) * x.x));
    let st = sqrt(1.0 - ct * ct);
    let h = tbn * vec3f(cos(phi) * st, sin(phi) * st, ct);
    let l = 2.0 * dot(n, h) * h - n;
    let ndl = dot(n, l);
    if (ndl > 0.0) {
      let d = (ct * ct * (a * a - 1.0) + 1.0);
      let pdf = (a * a) / (3.14159 * d * d) * 0.25;
      let saTexel = 4.0 * 3.14159 / (6.0 * f.srcSize * f.srcSize);
      let saSample = 1.0 / (f32(N) * pdf + 1e-4);
      let lod = select(0.5 * log2(saSample / saTexel) + 1.0, 0.0, f.rough == 0.0);
      acc += textureSampleLevel(src, samp, l, max(lod, 0.0)).rgb * ndl;
      wsum += ndl;
    }
  }
  return vec4f(acc / max(wsum, 1e-4), 1.0);
}
`;

/** Equirect (lat-long) HDR → cube face: u = 0.5 faces −Z (engine), u grows toward +X; v = 0 is straight up. */
const EQUI_WGSL = /* wgsl */ `
struct FsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> FsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return FsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
struct E { face: u32, flip: u32, scale: f32, pad: f32 };
@group(0) @binding(0) var<uniform> e: E;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
fn dirOf(face: u32, uv: vec2f) -> vec3f {
  let a = uv * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -a.y, -a.x)); }
    case 1u: { return normalize(vec3f(-1.0, -a.y, a.x)); }
    case 2u: { return normalize(vec3f(a.x, 1.0, a.y)); }
    case 3u: { return normalize(vec3f(a.x, -1.0, -a.y)); }
    case 4u: { return normalize(vec3f(a.x, -a.y, 1.0)); }
    default: { return normalize(vec3f(-a.x, -a.y, -1.0)); }
  }
}
@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  let d = dirOf(e.face, i.uv);
  var u = 0.5 + atan2(d.x, -d.z) / 6.2831853;
  if (e.flip != 0u) { u = 1.0 - u; }
  let v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265;
  return vec4f(textureSampleLevel(src, samp, vec2f(u, v), 0.0).rgb * e.scale, 1.0);
}
`;

const FACES: readonly [V3, V3, V3][] = [
  // forward, right (screen +x), up (screen +y): the WebGPU cube face convention
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

/** Perspective cube-face matrix (90°, z in [0, 1]) for world positions relative to the probe. */
function faceMatrix(f: number, near: number, far: number): Mat4 {
  const [F, R, U] = FACES[f]!;
  const A = far / (far - near), B = (-far * near) / (far - near);
  // clip = (R·p, U·p, A·(F·p) + B, F·p); column-major
  return new Float32Array([
    R[0], U[0], A * F[0], F[0],
    R[1], U[1], A * F[1], F[1],
    R[2], U[2], A * F[2], F[2],
    0, 0, B, 0,
  ]);
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1;
  return m;
}

export class SetBake {
  private readonly d: GPUDevice;
  readonly shadowMap: GPUTexture;
  /** World → set shadow clip (multiply by T(eye) for camera-relative use). */
  shadowVP: Mat4 = new Float32Array(16);
  shadowOn = false;
  readonly spec: GPUTexture;
  readonly irr: GPUTexture;
  private readonly src: GPUTexture;
  private readonly depth: GPUTexture;
  private readonly uBuf: GPUBuffer;
  private readonly fBufs: GPUBuffer[] = [];
  private readonly pipes: { lit: GPURenderPipeline; shadow: GPURenderPipeline; sky: GPURenderPipeline; filter: GPURenderPipeline; filterIrr: GPURenderPipeline };
  private readonly cmpSampler: GPUSampler;
  private readonly linSampler: GPUSampler;
  readonly specMips: number;
  /** A baked equirect IBL (E3b's Cycles bake) used instead of rendering the cube from the set; × scale. */
  equirect: { tex: GPUTexture; scale: number; flip: boolean } | null = null;
  private equiPipe: GPURenderPipeline | null = null;
  /** Bumped after each bake (the look bind group is rebuilt only when the textures change, not per bake). */
  bakes = 0;
  lastMs = 0;

  constructor(device: GPUDevice, shadowSize: number, iblSize: number) {
    const d = this.d = device;
    this.shadowMap = d.createTexture({ label: 'set.shadow', size: [shadowSize, shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.specMips = Math.floor(Math.log2(iblSize)) - 1; // stop at 4² (roughness 1)
    const cube = (label: string, size: number, mips: number): GPUTexture => d.createTexture({
      label, size: [size, size, 6], format: 'rgba16float', mipLevelCount: mips, dimension: '2d',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.src = cube('ibl.src', iblSize, Math.floor(Math.log2(iblSize)) + 1);
    this.spec = cube('ibl.spec', iblSize, this.specMips);
    this.irr = cube('ibl.irr', 16, 1);
    this.depth = d.createTexture({ size: [iblSize, iblSize], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.uBuf = d.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cmpSampler = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.linSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    const mod = d.createShaderModule({ code: BAKE_WGSL, label: 'setbake' });
    const fmod = d.createShaderModule({ code: FILTER_WGSL, label: 'iblfilter' });
    const vb: GPUVertexBufferLayout = {
      arrayStride: VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm16x4' },
        { shaderLocation: 2, offset: 20, format: 'unorm8x4' }, { shaderLocation: 3, offset: 24, format: 'unorm8x4' },
      ],
    };
    const bgl = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } },
      ],
    });
    this.bgl = bgl;
    const sbgl = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    this.sbgl = sbgl;
    const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const target = { format: 'rgba16float' as GPUTextureFormat };
    this.pipes = {
      lit: d.createRenderPipeline({
        layout, vertex: { module: mod, entryPoint: 'vs', buffers: [vb] }, fragment: { module: mod, entryPoint: 'fs', targets: [target] },
        primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      sky: d.createRenderPipeline({
        layout, vertex: { module: mod, entryPoint: 'vs_sky' }, fragment: { module: mod, entryPoint: 'fs_sky', targets: [target] },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      }),
      shadow: d.createRenderPipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [sbgl] }),
        vertex: { module: mod, entryPoint: 'vs_shadow', buffers: [{ arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 },
      }),
      filter: d.createRenderPipeline({ layout: 'auto', vertex: { module: fmod, entryPoint: 'vs' }, fragment: { module: fmod, entryPoint: 'fs', targets: [target] } }),
      filterIrr: d.createRenderPipeline({ layout: 'auto', vertex: { module: fmod, entryPoint: 'vs' }, fragment: { module: fmod, entryPoint: 'fs', targets: [target] } }),
    };
    for (let i = 0; i < 6 * 24; i++) this.fBufs.push(d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    // faces' (right, up, forward) bases for the sky
    const fb = new Float32Array(16 * 6);
    FACES.forEach(([F, R, U], f) => fb.set([...R, 0, ...U, 0, ...F, 0, 0, 0, 0, 1], f * 16));
    // dynamic offsets must be 256-aligned: write each face's basis at f * 256 in a bigger buffer
    this.faceBufAligned = d.createBuffer({ size: 256 * 6, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    for (let f = 0; f < 6; f++) d.queue.writeBuffer(this.faceBufAligned, f * 256, fb, f * 16, 16);
  }
  private readonly bgl: GPUBindGroupLayout;
  private readonly sbgl: GPUBindGroupLayout;
  private readonly faceBufAligned: GPUBuffer;

  /**
   * Re-bakes the set shadow and the IBL. `sets` are the set meshes (none for the Studio: the IBL is then
   * just its sky). Call after the mesh library has been uploaded.
   */
  bake(lib: MeshLibrary, sets: readonly SetMesh[], L: SetLight): void {
    const t0 = performance.now();
    const d = this.d;
    // set shadow: ortho from the sun over the set bounds
    const b = L.bounds;
    const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const ext = 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const s = L.sun;
    const view = lookAt([c[0] + s[0] * ext * 2, c[1] + s[1] * ext * 2, c[2] + s[2] * ext * 2], c, Math.abs(s[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    this.shadowVP = mul(ortho(-ext, ext, -ext, ext, 0.01, ext * 4), view);
    this.shadowOn = sets.length > 0;

    const u = new Float32Array(64);
    const write = (vp: Mat4, probeW: number, offset: V3): void => {
      u.set(vp, 0); u.set(this.shadowVP, 16);
      u.set([L.probe[0], L.probe[1], L.probe[2], probeW], 32);
      u.set([offset[0], offset[1], offset[2], 0], 36);
      u.set([s[0], s[1], s[2], 0], 40);
      u.set([...L.sunColor, 1], 44);
      u.set([...L.skyTop, L.emissive], 48); u.set([...L.horizon, 1], 52); u.set([...L.ground, 1], 56);
      d.queue.writeBuffer(this.uBuf, 0, u);
    };
    const draw = (pass: GPURenderPassEncoder, which: 'shadow' | 'ibl'): void => {
      pass.setVertexBuffer(0, lib.vertexBuffer!);
      pass.setIndexBuffer(lib.indexBuffer!, 'uint32');
      for (const sm of sets) {
        if (sm[which] === false) continue;
        const lod = lib.meshes[sm.mesh]?.lods[0];
        if (lod) pass.drawIndexed(lod.indexCount, 1, lod.firstIndex, lod.baseVertex, 0);
      }
    };
    // every set mesh shares one offset (one environment at a time)
    const offset: V3 = sets[0]?.offset ?? [0, 0, 0];
    {
      write(this.shadowVP, 0, offset);
      const enc = d.createCommandEncoder({ label: 'set.shadow' });
      const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowMap.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      if (sets.length && lib.vertexBuffer) {
        pass.setPipeline(this.pipes.shadow);
        pass.setBindGroup(0, d.createBindGroup({ layout: this.sbgl, entries: [{ binding: 0, resource: { buffer: this.uBuf } }] }));
        draw(pass, 'shadow');
      }
      pass.end();
      d.queue.submit([enc.finish()]);
    }
    // IBL source cube: sky, then the set, per face (one submit per face: the uniform changes)
    const bind = d.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.uBuf } }, { binding: 1, resource: this.shadowMap.createView() },
        { binding: 2, resource: this.cmpSampler }, { binding: 3, resource: { buffer: this.faceBufAligned, size: 64 } },
      ],
    });
    if (this.equirect) this.fromEquirect(this.equirect);
    else for (let f = 0; f < 6; f++) {
      write(faceMatrix(f, 0.05, 200), 1, offset);
      const enc = d.createCommandEncoder({ label: 'ibl.face' });
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.src.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, bind, [f * 256]);
      pass.setPipeline(this.pipes.sky);
      pass.draw(3);
      if (sets.length && lib.vertexBuffer) { pass.setPipeline(this.pipes.lit); draw(pass, 'ibl'); }
      pass.end();
      d.queue.submit([enc.finish()]);
    }
    // source mips (box-ish: each level samples the one above), then GGX per spec mip, then irradiance
    const enc = d.createCommandEncoder({ label: 'ibl.filter' });
    let fb = 0;
    const filter = (pipe: GPURenderPipeline, dst: GPUTexture, mip: number, srcView: GPUTextureView, mode: number, rough: number, srcSize: number): void => {
      for (let f = 0; f < 6; f++) {
        const buf = this.fBufs[fb++ % this.fBufs.length]!;
        d.queue.writeBuffer(buf, 0, new Uint32Array([f, mode, 0, 0]));
        d.queue.writeBuffer(buf, 8, new Float32Array([rough, srcSize]));
        const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }, { binding: 1, resource: srcView }, { binding: 2, resource: this.linSampler }] });
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1, baseMipLevel: mip, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg);
        pass.draw(3);
        pass.end();
      }
    };
    const srcMips = this.src.mipLevelCount;
    // (the fBufs ring holds 144 uniforms; one encoder uses 6 × (srcMips − 1 + specMips + 1) = 96 at 256²)
    for (let m = 1; m < srcMips; m++) filter(this.pipes.filter, this.src, m, this.src.createView({ dimension: 'cube', baseMipLevel: m - 1, mipLevelCount: 1 }), 0, 0, 0);
    const all = this.src.createView({ dimension: 'cube' });
    for (let m = 0; m < this.specMips; m++) filter(this.pipes.filter, this.spec, m, all, m === 0 ? 0 : 1, m / (this.specMips - 1), this.src.width);
    filter(this.pipes.filterIrr, this.irr, 0, all, 2, 1, this.src.width);
    d.queue.submit([enc.finish()]);
    this.bakes++;
    this.lastMs = performance.now() - t0;
  }

  private fromEquirect(eq: { tex: GPUTexture; scale: number; flip: boolean }): void {
    const d = this.d;
    if (!this.equiPipe) {
      const mod = d.createShaderModule({ code: EQUI_WGSL, label: 'ibl.equirect' });
      this.equiPipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] } });
    }
    const pipe = this.equiPipe;
    const samp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat' });
    for (let f = 0; f < 6; f++) {
      const ub = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const a = new ArrayBuffer(16);
      new Uint32Array(a).set([f, eq.flip ? 1 : 0]);
      new Float32Array(a).set([eq.scale], 2);
      d.queue.writeBuffer(ub, 0, a);
      const enc = d.createCommandEncoder({ label: 'ibl.equi' });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.src.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: eq.tex.createView() }, { binding: 2, resource: samp }] }));
      pass.draw(3);
      pass.end();
      d.queue.submit([enc.finish()]);
    }
  }
}
