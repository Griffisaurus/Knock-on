// Post v2 (RENDERING §9): dual-filter bloom over the resolved HDR image; then (M3, D79) froxel fog and
// sun shafts (or a uniform haze), the tilt-shift depth of field (half/quarter-res gather from a CoC from
// the look's half-res depth), exposure, the Khronos PBR Neutral tonemap (ART_BIBLE §10), the
// per-environment warm grading LUT, a soft vignette and fine film grain, sRGB encoding into the
// swapchain, and (M2) the screen-space selection outlines from the renderer's mask. TAA arrives with G3.

import { FOG_FAR, FOG_NEAR } from './look/fog.ts';
import { LUT_SIZE } from './look/lut.ts';

const FULLSCREEN = /* wgsl */ `
struct FsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> FsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: FsOut;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

const BLOOM_WGSL = /* wgsl */ `
${FULLSCREEN}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> texel: vec4f; // xy = 1 / source size, z = prefilter (1) or not

fn s(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }

@fragment fn down(i: FsOut) -> @location(0) vec4f {
  let t = texel.xy;
  // 13-tap downsample (Jimenez 2014)
  let a = s(i.uv + t * vec2f(-2., -2.)); let b = s(i.uv + t * vec2f(0., -2.)); let c = s(i.uv + t * vec2f(2., -2.));
  let d = s(i.uv + t * vec2f(-1., -1.)); let e = s(i.uv + t * vec2f(1., -1.));
  let f = s(i.uv + t * vec2f(-2., 0.)); let g = s(i.uv); let h = s(i.uv + t * vec2f(2., 0.));
  let j = s(i.uv + t * vec2f(-1., 1.)); let k = s(i.uv + t * vec2f(1., 1.));
  let l = s(i.uv + t * vec2f(-2., 2.)); let m = s(i.uv + t * vec2f(0., 2.)); let n = s(i.uv + t * vec2f(2., 2.));
  var col = (d + e + j + k) * 0.125 + g * 0.125 + (a + c + l + n) * 0.03125 + (b + f + h + m) * 0.0625;
  if (texel.z > 0.5) {
    // soft threshold so only genuinely bright things (sparks, flames, LEDs) bloom strongly
    let br = max(col.r, max(col.g, col.b));
    let knee = 0.6;
    let soft = clamp(br - 1.0 + knee, 0.0, 2.0 * knee);
    let w = max(soft * soft / (4.0 * knee + 1e-4), br - 1.0) / max(br, 1e-4);
    col *= w;
  }
  return vec4f(min(col, vec3f(256.0)), 1.0);
}

@fragment fn up(i: FsOut) -> @location(0) vec4f {
  let t = texel.xy;
  var c = s(i.uv) * 4.0;
  c += (s(i.uv + t * vec2f(-1., 0.)) + s(i.uv + t * vec2f(1., 0.)) + s(i.uv + t * vec2f(0., -1.)) + s(i.uv + t * vec2f(0., 1.))) * 2.0;
  c += s(i.uv + t * vec2f(-1., -1.)) + s(i.uv + t * vec2f(1., -1.)) + s(i.uv + t * vec2f(-1., 1.)) + s(i.uv + t * vec2f(1., 1.));
  return vec4f(c / 16.0, 1.0);
}
`;

/** Shared by the DOF passes and the composite: the look's inputs (fog, depth, CoC). */
const LOOK_POST_WGSL = /* wgsl */ `
struct P {
  a: vec4f,       // x exposure, y bloom strength, z time, w outline width (px, 0 = none)
  fog: vec4f,     // x mode (0 none, 1 haze, 2 froxel volume), y near, z far, w haze extinction (1/m)
  haze: vec4f,    // rgb haze colour, w LUT on
  dof: vec4f,     // x on, y focus distance (m), z in-focus half band (m), w max radius (full-res px)
  vig: vec4f,     // x vignette, y grain, z aspect, w photo CoC scale (px per (1/m)), 0 = tilt-shift
  size: vec4f,    // xy full-res size, zw depth texture size
  ext: vec4f,     // RENDER (beta polish, D125): x the gizmo's sharp mask is on (binding 7: no fog, no DOF under it)
};
@group(0) @binding(10) var<uniform> p: P;
@group(0) @binding(11) var depthTex: texture_2d<f32>;   // look AO texture: b = view depth (half res)
@group(0) @binding(12) var fogVol: texture_3d<f32>;
@group(0) @binding(13) var linSamp: sampler;

fn viewDepth(uv: vec2f) -> f32 {
  let q = clamp(vec2i(uv * p.size.zw), vec2i(0), vec2i(p.size.zw) - 1);
  return textureLoad(depthTex, q, 0).b;
}
/// Fog over the scene colour at view depth z (froxel volume or analytic haze).
fn applyFog(c: vec3f, uv: vec2f, z: f32) -> vec3f {
  if (p.fog.x < 0.5) { return c; }
  if (p.fog.x < 1.5) {
    let t = exp(-p.fog.w * min(z, 200.0));
    return c * t + p.haze.rgb * (1.0 - t);
  }
  let w = clamp(log(max(z, p.fog.y) / p.fog.y) / log(p.fog.z / p.fog.y), 0.0, 1.0);
  let f = textureSampleLevel(fogVol, linSamp, vec3f(uv, w), 0.0);
  return c * f.a + f.rgb;
}
/// Circle of confusion (0..1 of the max radius): tilt-shift band, or the thin-lens model in photo mode.
fn coc(z: f32) -> f32 {
  if (p.dof.x < 0.5) { return 0.0; }
  if (p.vig.w > 0.0) {
    return clamp(abs(1.0 / p.dof.y - 1.0 / max(z, 0.01)) * p.vig.w / p.dof.w, 0.0, 1.0);
  }
  let band = p.dof.z;
  return clamp((abs(z - p.dof.y) - band) / max(band * 1.5, 1e-3), 0.0, 1.0);
}
`;

const DOF_WGSL = /* wgsl */ `
${FULLSCREEN}
${LOOK_POST_WGSL}
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var src: texture_2d<f32>;      // the prep target (blur pass)
@group(0) @binding(2) var<uniform> t: vec4f;          // xy 1 / target size, z target / full scale
@group(0) @binding(7) var sharpTex: texture_2d<f32>;  // RENDER (beta polish, D125): the gizmo's coverage (output res)

/// Downsample + fog + CoC (alpha). RENDER (beta polish, D125): under the gizmo the CoC is 0, so the blur's gather
/// never spreads it into the soft background.
@fragment fn prep(i: FsOut) -> @location(0) vec4f {
  let o = t.xy * 0.25;
  var c = textureSampleLevel(hdr, linSamp, i.uv + vec2f(-o.x, -o.y), 0.0).rgb + textureSampleLevel(hdr, linSamp, i.uv + vec2f(o.x, -o.y), 0.0).rgb
        + textureSampleLevel(hdr, linSamp, i.uv + vec2f(-o.x, o.y), 0.0).rgb + textureSampleLevel(hdr, linSamp, i.uv + vec2f(o.x, o.y), 0.0).rgb;
  c *= 0.25;
  let z = viewDepth(i.uv);
  var k = coc(z);
  if (p.ext.x > 0.5) { k *= 1.0 - textureSampleLevel(sharpTex, linSamp, i.uv, 0.0).r; }
  return vec4f(applyFog(c, i.uv, z), k);
}

/// Gather blur (golden-angle disc, 32 taps); a tap counts only if its own blur reaches this pixel, so
/// sharp things don't bleed into the soft background.
@fragment fn blur(i: FsOut) -> @location(0) vec4f {
  let c0 = textureSampleLevel(src, linSamp, i.uv, 0.0);
  let maxR = p.dof.w * t.z;   // in target pixels
  let r0 = c0.a * maxR;
  if (r0 < 0.5) { return c0; }
  var acc = c0.rgb;
  var wsum = 1.0;
  let N = 32;
  for (var k = 1; k < N; k++) {
    let rr = sqrt(f32(k) / f32(N)) * r0;
    let a = f32(k) * 2.39996323;
    let uv = i.uv + vec2f(cos(a), sin(a)) * rr * t.xy;
    let s = textureSampleLevel(src, linSamp, uv, 0.0);
    let w = clamp(s.a * maxR - rr + 1.0, 0.0, 1.0);
    acc += s.rgb * w;
    wsum += w;
  }
  return vec4f(acc / wsum, c0.a);
}
`;

const COMPOSITE_WGSL = /* wgsl */ `
${FULLSCREEN}
${LOOK_POST_WGSL}
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(4) var mask: texture_2d<f32>; // selection mask: linear rgb, a = strength (renderer.ts)
@group(0) @binding(5) var dofTex: texture_2d<f32>;
@group(0) @binding(6) var lut: texture_3d<f32>;
@group(0) @binding(7) var sharpTex: texture_2d<f32>; // RENDER (beta polish, D125): the gizmo's coverage

fn neutral(c0: vec3f) -> vec3f {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - offset;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) { return c; }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(c, vec3f(newPeak), g);
}

fn toSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn hash3(q: vec3f) -> f32 {
  var h = vec3u(bitcast<u32>(q.x), bitcast<u32>(q.y), bitcast<u32>(q.z));
  h = h * 1664525u + 1013904223u;
  h.x += h.y * h.z; h.y += h.z * h.x; h.z += h.x * h.y;
  h ^= h >> vec3u(16u);
  h.x += h.y * h.z;
  return f32(h.x) / 4294967295.0;
}

@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  let raw = textureSampleLevel(hdr, samp, i.uv, 0.0).rgb;
  var base = raw;
  let z = viewDepth(i.uv);
  base = applyFog(base, i.uv, z);
  if (p.dof.x > 0.5) {
    let k = coc(z);
    if (k > 0.0) {
      let b = textureSampleLevel(dofTex, samp, i.uv, 0.0);
      base = mix(base, b.rgb, smoothstep(0.0, 0.35, max(k, b.a)));
    }
  }
  // RENDER (beta polish, D125): the transform gizmo stays sharp and unfogged (it's drawn over the scene, not in it)
  if (p.ext.x > 0.5) { base = mix(base, raw, textureLoad(sharpTex, vec2i(i.clip.xy), 0).r); }
  let b = textureSampleLevel(bloom, samp, i.uv, 0.0).rgb;
  let c = (base + b * p.a.y) * p.a.x;
  var o = toSrgb(clamp(neutral(max(c, vec3f(0.0))), vec3f(0.0), vec3f(1.0)));
  // grade (display space), then vignette and grain
  if (p.haze.w > 0.5) {
    let n = ${LUT_SIZE}.0;
    o = textureSampleLevel(lut, samp, o * ((n - 1.0) / n) + 0.5 / n, 0.0).rgb;
  }
  if (p.vig.x > 0.0) {
    let d = (i.uv - 0.5) * vec2f(p.vig.z, 1.0);
    let v = 1.0 - p.vig.x * smoothstep(0.25, 1.0, dot(d, d) * 2.2);
    o *= v;
  }
  if (p.vig.y > 0.0) {
    let g = hash3(vec3f(i.clip.xy, p.a.z)) + hash3(vec3f(i.clip.yx + 13.0, p.a.z)) - 1.0;
    // grain strongest in the mid-tones, as film does
    let l = dot(o, vec3f(0.2126, 0.7152, 0.0722));
    o += g * p.vig.y * (0.4 + 2.0 * l * (1.0 - l));
  }
  if (p.a.w > 0.0) {
    // screen-space selection outlines (RENDERING §10): the mask's silhouette, dilated by p.w pixels,
    // drawn outside it in the selecting player's colour, plus a faint fill inside
    let px = vec2i(i.clip.xy);
    let dim = vec2i(textureDimensions(mask)) - 1;
    let ctr = textureLoad(mask, px, 0);
    var edge = vec4f(0.0);
    let r = p.a.w;
    for (var k = 0; k < 16; k++) {
      let a = f32(k) * 0.3926991;
      let ring = select(r, r * 0.5, (k & 1) == 1);
      let q = clamp(px + vec2i(round(vec2f(cos(a), sin(a)) * ring)), vec2i(0), dim);
      let s = textureLoad(mask, q, 0);
      if (s.a > edge.a) { edge = s; }
    }
    if (ctr.a <= 0.0 && edge.a > 0.0) {
      o = mix(o, toSrgb(edge.rgb), edge.a);
    } else if (ctr.a > 0.0) {
      o = mix(o, toSrgb(ctr.rgb), 0.07 * ctr.a);
    }
  }
  // tiny dither against banding on the smooth cyc gradient
  let n = fract(sin(dot(i.clip.xy, vec2f(12.9898, 78.233)) + p.a.z) * 43758.5453);
  o += (n - 0.5) / 255.0;
  return vec4f(o, 1.0);
}
`;

const BLOOM_LEVELS = 6;

/** The look's post inputs for one frame (look/index.ts fills it). */
export interface PostLook {
  /** Half-res look texture with view depth in b (the AO pass output). */
  readonly depth: GPUTexture;
  readonly fog: { readonly mode: 0 | 1 | 2; readonly volume: GPUTexture | null; readonly haze: number; readonly hazeColor: readonly [number, number, number] };
  readonly dof: { readonly on: boolean; readonly focus: number; readonly band: number; readonly maxPx: number; readonly div: 2 | 4; readonly photoScale: number };
  readonly lut: GPUTexture | null;
  readonly vignette: number;
  readonly grain: number;
  readonly ts?: { readonly dof?: GPURenderPassTimestampWrites; readonly dofBlur?: GPURenderPassTimestampWrites };
}

export class Post {
  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly downPipe: { first: GPURenderPipeline; rest: GPURenderPipeline };
  private readonly upPipe: GPURenderPipeline;
  private readonly compPipe: GPURenderPipeline;
  private readonly dofPipe: { prep: GPURenderPipeline; blur: GPURenderPipeline };
  private readonly params: GPUBuffer;
  private readonly dofTexel: GPUBuffer;
  private readonly texelBufs: GPUBuffer[] = [];
  private mips: GPUTexture[] = [];
  private downBinds: GPUBindGroup[] = [];
  private upBinds: GPUBindGroup[] = [];
  private hdr: GPUTexture | null = null;
  private mask: GPUTexture | null = null;
  private sharp: GPUTexture | null = null;
  private dof: { a: GPUTexture; b: GPUTexture; div: number } | null = null;
  private compBind: GPUBindGroup | null = null;
  private dofBinds: { prep: GPUBindGroup; blur: GPUBindGroup } | null = null;
  private bindKey = '';
  private readonly dummy3d: GPUTexture;
  private readonly dummy2d: GPUTexture;
  bloomStrength = 0.06;

  constructor(device: GPUDevice, outFormat: GPUTextureFormat) {
    this.device = device;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    const bm = device.createShaderModule({ code: BLOOM_WGSL, label: 'bloom' });
    const mk = (entryPoint: string, blend?: GPUBlendState): GPURenderPipeline => device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bm, entryPoint: 'vs' },
      fragment: { module: bm, entryPoint, targets: [{ format: 'rgba16float', ...(blend ? { blend } : {}) }] },
    });
    this.downPipe = { first: mk('down'), rest: mk('down') };
    this.upPipe = mk('up', { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } });
    const cm = device.createShaderModule({ code: COMPOSITE_WGSL, label: 'composite' });
    this.compPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: cm, entryPoint: 'vs' },
      fragment: { module: cm, entryPoint: 'fs', targets: [{ format: outFormat }] },
    });
    const dm = device.createShaderModule({ code: DOF_WGSL, label: 'dof' });
    const dp = (entryPoint: string): GPURenderPipeline => device.createRenderPipeline({
      layout: 'auto', vertex: { module: dm, entryPoint: 'vs' }, fragment: { module: dm, entryPoint, targets: [{ format: 'rgba16float' }] },
    });
    this.dofPipe = { prep: dp('prep'), blur: dp('blur') };
    this.params = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dofTexel = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    for (let i = 0; i < BLOOM_LEVELS * 2; i++) {
      this.texelBufs.push(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
    this.dummy3d = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummy2d = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  /** Rebuilds the bloom chain for a new HDR target; `mask` is the selection-outline mask and `sharp` the gizmo's
   * coverage (RENDER, beta polish: kept out of fog and DOF), both at output size. */
  resize(hdr: GPUTexture, mask: GPUTexture, sharp: GPUTexture): void {
    for (const m of this.mips) m.destroy();
    this.mips = [];
    this.hdr = hdr;
    this.mask = mask;
    this.sharp = sharp;
    let w = hdr.width, h = hdr.height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.mips.push(this.device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
    }
    const bind = (pipe: GPURenderPipeline, src: GPUTexture, k: number, prefilter: number): GPUBindGroup => {
      this.device.queue.writeBuffer(this.texelBufs[k]!, 0, new Float32Array([1 / src.width, 1 / src.height, prefilter, 0]));
      return this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: src.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.texelBufs[k]! } }],
      });
    };
    this.downBinds = this.mips.map((_, i) => bind(i === 0 ? this.downPipe.first : this.downPipe.rest, i === 0 ? hdr : this.mips[i - 1]!, i, i === 0 ? 1 : 0));
    this.upBinds = this.mips.slice(1).map((m, i) => bind(this.upPipe, m, BLOOM_LEVELS + i, 0));
    this.dof?.a.destroy(); this.dof?.b.destroy();
    this.dof = null;
    this.bindKey = '';
  }

  private ensureDof(div: number): void {
    if (this.dof?.div === div || !this.hdr) return;
    this.dof?.a.destroy(); this.dof?.b.destroy();
    const w = Math.max(1, Math.ceil(this.hdr.width / div)), h = Math.max(1, Math.ceil(this.hdr.height / div));
    const mk = (): GPUTexture => this.device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.dof = { a: mk(), b: mk(), div };
    this.bindKey = '';
  }

  private rebind(look: PostLook | undefined): void {
    const fogTex = look?.fog.volume ?? this.dummy3d;
    const depth = look?.depth ?? this.dummy2d;
    const lut = look?.lut ?? this.dummy3d;
    const dofOn = !!look?.dof.on;
    if (dofOn) this.ensureDof(look!.dof.div);
    const key = [fogTex, depth, lut, this.dof?.a].map((t) => objId(t)).join(',');
    if (this.compBind && key === this.bindKey) return;
    this.bindKey = key;
    const common = (): GPUBindGroupEntry[] => [
      { binding: 10, resource: { buffer: this.params } }, { binding: 11, resource: depth.createView() },
      { binding: 12, resource: fogTex.createView() }, { binding: 13, resource: this.sampler },
    ];
    this.compBind = this.device.createBindGroup({
      layout: this.compPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.hdr!.createView() }, { binding: 1, resource: this.mips[0]!.createView() },
        { binding: 2, resource: this.sampler }, { binding: 4, resource: this.mask!.createView() },
        { binding: 5, resource: (this.dof?.a ?? this.dummy2d).createView() }, { binding: 6, resource: lut.createView() },
        { binding: 7, resource: (this.sharp ?? this.dummy2d).createView() },
        ...common(),
      ],
    });
    if (this.dof) {
      this.dofBinds = {
        prep: this.device.createBindGroup({
          layout: this.dofPipe.prep.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: this.hdr!.createView() }, { binding: 2, resource: { buffer: this.dofTexel } }, { binding: 7, resource: (this.sharp ?? this.dummy2d).createView() }, ...common()],
        }),
        blur: this.device.createBindGroup({
          layout: this.dofPipe.blur.getBindGroupLayout(0),
          entries: [{ binding: 1, resource: this.dof.b.createView() }, { binding: 2, resource: { buffer: this.dofTexel } }, ...common().filter((e) => e.binding === 10 || e.binding === 13)],
        }),
      };
    }
  }

  run(enc: GPUCommandEncoder, out: GPUTextureView, exposure: number, time: number, timestamp?: GPURenderPassTimestampWrites, outlinePx = 0, look?: PostLook, sharp = false): void {
    this.rebind(look);
    const hdr = this.hdr!;
    const dofOn = !!look?.dof.on && this.dof !== null;
    const P = new Float32Array(28);
    P.set([exposure, this.bloomStrength, time % 64, outlinePx], 0);
    P.set([look?.fog.mode ?? 0, FOG_NEAR, FOG_FAR, look?.fog.haze ?? 0], 4);
    P.set([...(look?.fog.hazeColor ?? [0, 0, 0]), look?.lut ? 1 : 0], 8);
    P.set([dofOn ? 1 : 0, look?.dof.focus ?? 1, look?.dof.band ?? 1, look?.dof.maxPx ?? 0], 12);
    P.set([look?.vignette ?? 0, look?.grain ?? 0, hdr.width / hdr.height, look?.dof.photoScale ?? 0], 16);
    P.set([hdr.width, hdr.height, look?.depth.width ?? 1, look?.depth.height ?? 1], 20);
    P.set([sharp ? 1 : 0, 0, 0, 0], 24); // RENDER (beta polish, D125)
    this.device.queue.writeBuffer(this.params, 0, P);
    const pass = (view: GPUTextureView, load: GPULoadOp, ts?: GPURenderPassTimestampWrites): GPURenderPassEncoder => enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: load, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      ...(ts ? { timestampWrites: ts } : {}),
    });
    for (let i = 0; i < this.mips.length; i++) {
      const p = pass(this.mips[i]!.createView(), 'clear');
      p.setPipeline(i === 0 ? this.downPipe.first : this.downPipe.rest);
      p.setBindGroup(0, this.downBinds[i]!);
      p.draw(3);
      p.end();
    }
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const p = pass(this.mips[i]!.createView(), 'load');
      p.setPipeline(this.upPipe);
      p.setBindGroup(0, this.upBinds[i]!);
      p.draw(3);
      p.end();
    }
    if (dofOn && this.dof && this.dofBinds) {
      const d = this.dof;
      this.device.queue.writeBuffer(this.dofTexel, 0, new Float32Array([1 / d.a.width, 1 / d.a.height, d.a.width / hdr.width, 0]));
      // prep into b, blur b → a (the composite reads a)
      const p1 = pass(d.b.createView(), 'clear', look?.ts?.dof);
      p1.setPipeline(this.dofPipe.prep);
      p1.setBindGroup(0, this.dofBinds.prep);
      p1.draw(3);
      p1.end();
      const p2 = pass(d.a.createView(), 'clear', look?.ts?.dofBlur);
      p2.setPipeline(this.dofPipe.blur);
      p2.setBindGroup(0, this.dofBinds.blur);
      p2.draw(3);
      p2.end();
    }
    const p = enc.beginRenderPass({
      colorAttachments: [{ view: out, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      ...(timestamp ? { timestampWrites: timestamp } : {}),
    });
    p.setPipeline(this.compPipe);
    p.setBindGroup(0, this.compBind!);
    p.draw(3);
    p.end();
  }
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objId(o: object | undefined): number {
  if (!o) return 0;
  let v = ids.get(o);
  if (v === undefined) ids.set(o, (v = nextId++));
  return v;
}
