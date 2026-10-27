// TAA upscaler (RENDERING §9, D60, D81): render the scene at an internal resolution with a sub-pixel
// Halton jitter, then resolve to the output resolution with temporal accumulation. Per output pixel:
// the current frame is sampled at the un-jittered position (Catmull-Rom), the history is reprojected
// with the closest depth in the 3×3 neighbourhood (camera motion; the dilation keeps edges), clipped to
// the current neighbourhood's YCoCg variance box, and blended with a weight that rises when the nearest
// internal sample lands close to the pixel centre (the upscale) and when the luminance disagrees (a
// reactive term for sparks and moving parts, which carry no motion vectors yet). Blending happens on
// 1/(1+luma)-weighted colour so HDR highlights don't flicker.
//
// The present pass then writes the output texture post.ts reads, bending it along the shock rings'
// screen-space refraction shells (shockwave.ts) with a touch of chromatic split. Without TAA the shells
// run on the native HDR image (copy back). A tiny luminance meter on the HDR image feeds the flash
// limiter's measured layer (fx.ts).

import { MAX_SHELLS, type Shell } from './shockwave.ts';

type Mat4 = Float32Array;

const RESOLVE_WGSL = /* wgsl */ `
struct TU {
  reproj: mat4x4f,     // current clip (un-jittered) → previous clip
  inSize: vec2f, outSize: vec2f,
  jitter: vec2f, reset: f32, sharpen: f32,
};
@group(0) @binding(0) var<uniform> u: TU;
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_multisampled_2d;
@group(0) @binding(3) var hist: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var outHist: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var outView: texture_storage_2d<rgba16float, write>; // what post reads (no shells this frame)

fn ycocg(c: vec3f) -> vec3f { return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25))); }
fn rgb(y: vec3f) -> vec3f { return vec3f(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
fn tm(c: vec3f) -> vec3f { return c / (1.0 + max(c.r, max(c.g, c.b))); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }

/// Catmull-Rom in 9 bilinear taps (5 used: the corners are negligible).
fn catmull(t: texture_2d<f32>, uv: vec2f, size: vec2f) -> vec3f {
  let pos = uv * size;
  let c = floor(pos - 0.5) + 0.5;
  let f = pos - c;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (c - 1.0) / size;
  let t3 = (c + 2.0) / size;
  let t12 = (c + w2 / w12) / size;
  var r = textureSampleLevel(t, samp, vec2f(t12.x, t0.y), 0.0).rgb * w12.x * w0.y;
  r += textureSampleLevel(t, samp, vec2f(t0.x, t12.y), 0.0).rgb * w0.x * w12.y;
  r += textureSampleLevel(t, samp, t12, 0.0).rgb * w12.x * w12.y;
  r += textureSampleLevel(t, samp, vec2f(t3.x, t12.y), 0.0).rgb * w3.x * w12.y;
  r += textureSampleLevel(t, samp, vec2f(t12.x, t3.y), 0.0).rgb * w12.x * w3.y;
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, vec3f(0.0));
}

@compute @workgroup_size(8, 8) fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2f(gid.xy);
  if (any(px >= u.outSize)) { return; }
  let uv = (px + 0.5) / u.outSize;
  // the jittered render shows at (x + j) what the un-jittered view shows at x
  let suv = uv + u.jitter / u.inSize;
  let ip = vec2i(floor(suv * u.inSize));
  let imax = vec2i(u.inSize) - 1;
  var mn = vec3f(1e9);
  var mx = vec3f(-1e9);
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var zmin = 1.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(ip + vec2i(x, y), vec2i(0), imax);
      let c = ycocg(tm(textureLoad(cur, q, 0).rgb));
      mn = min(mn, c); mx = max(mx, c);
      m1 += c; m2 += c * c;
      if (x == 0 || y == 0) { zmin = min(zmin, textureLoad(depthTex, q, 0)); } // a cross is enough to dilate
    }
  }
  let curC = catmull(cur, suv, u.inSize);
  // reproject with the closest depth (dilated motion: thin edges keep their history)
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let pc = u.reproj * vec4f(ndc, zmin, 1.0);
  let pn = pc.xy / pc.w;
  let puv = vec2f(pn.x * 0.5 + 0.5, 0.5 - pn.y * 0.5);
  let off = any(puv < vec2f(0.0)) || any(puv > vec2f(1.0)) || pc.w <= 0.0 || u.reset > 0.5;
  var outC = curC;
  if (!off) {
    let hC = catmull(hist, puv, u.outSize);
    let mean = m1 / 9.0;
    let sd = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
    let lo = max(mn, mean - sd * 1.25);
    let hi = min(mx, mean + sd * 1.25);
    let hy = ycocg(tm(hC));
    let cy = ycocg(tm(curC));
    // clip toward the box centre (not a per-channel clamp: keeps the hue)
    let ctr = (lo + hi) * 0.5;
    let ext = max((hi - lo) * 0.5, vec3f(1e-4));
    let dv = hy - ctr;
    let a = abs(dv / ext);
    let k = max(a.x, max(a.y, a.z));
    let hClip = select(hy, ctr + dv / k, k > 1.0);
    // current-frame weight: the nearest internal sample's distance to this pixel's centre (upscale)
    let dpx = abs(fract(suv * u.inSize) - 0.5) * 2.0;     // 0 at a sample centre
    let near = 1.0 - clamp(length(dpx) * 0.75, 0.0, 1.0);
    var alpha = mix(0.035, 0.16, near * near);
    // reactive: a big disagreement after clipping (sparks, a moving part with no motion vector)
    let diff = abs(hClip.x - cy.x) / (max(hClip.x, cy.x) + 0.02);
    alpha = max(alpha, clamp(diff * 0.6 - 0.15, 0.0, 0.45));
    outC = itm(rgb(mix(hClip, cy, alpha)));
  }
  let o = vec4f(max(outC, vec3f(0.0)), 1.0);
  textureStore(outHist, vec2i(gid.xy), o);
  if (u.sharpen < 0.5) { textureStore(outView, vec2i(gid.xy), o); }
}
`;

const PRESENT_WGSL = /* wgsl */ `
struct Sh { c: vec4f };  // x cx, y cy, z r, w strength; width = r * 0.18 (min 0.01)
struct PU { size: vec2f, aspect: f32, count: f32, sh: array<vec4f, ${MAX_SHELLS}>, wd: array<vec4f, ${MAX_SHELLS / 4}> };
@group(0) @binding(0) var<uniform> u: PU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8) fn present(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2f(gid.xy);
  if (any(px >= u.size)) { return; }
  let uv = (px + 0.5) / u.size;
  var off = vec2f(0.0);
  let n = u32(u.count);
  for (var i = 0u; i < n; i++) {
    let s = u.sh[i];
    let w = u.wd[i / 4u][i % 4u];
    let d = (uv - s.xy) * vec2f(u.aspect, 1.0);
    let dist = length(d);
    let x = (dist - s.z) / w;
    // a lens-shaped shell: pushes outward across the band, strongest on the leading edge
    let f = s.w * x * exp(-x * x * 1.6);
    off += select(vec2f(0.0), d / dist, dist > 1e-5) * f * vec2f(1.0 / u.aspect, 1.0);
  }
  var c: vec3f;
  if (n == 0u) {
    c = textureLoad(src, vec2i(gid.xy), 0).rgb;
  } else {
    // a slight chromatic split along the bend
    c = vec3f(
      textureSampleLevel(src, samp, uv - off * 1.15, 0.0).r,
      textureSampleLevel(src, samp, uv - off, 0.0).g,
      textureSampleLevel(src, samp, uv - off * 0.85, 0.0).b);
  }
  textureStore(dst, vec2i(gid.xy), vec4f(c, 1.0));
}
`;

const LUMA_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<storage, read_write> sum: array<atomic<u32>, 2>;
var<workgroup> part: array<f32, 64>;
@compute @workgroup_size(8, 8) fn luma(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  // a 64 × 36 grid of bilinear taps over the frame
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(64.0, 40.0);
  let c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  part[li] = select(0.0, dot(c, vec3f(0.2126, 0.7152, 0.0722)), gid.y < 40u);
  workgroupBarrier();
  for (var s = 32u; s > 0u; s >>= 1u) {
    if (li < s) { part[li] += part[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { atomicAdd(&sum[0], u32(min(part[0], 4000.0) * 1000.0)); }
}
`;

/** Halton(2, 3) sequence, 16 phases, centred on 0 (internal pixels). */
function halton(i: number, b: number): number {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}
const JITTER: [number, number][] = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export class Taa {
  /** Upscaling on: the scene renders at `scale` × output and is resolved here. */
  enabled = false;
  /** Internal / output resolution (D81: 1440p → 1296p internal at 4K on 16 GB, ≥ 1800p on 32 GB). */
  scale = 1;
  readonly device: GPUDevice;
  private readonly sampler: GPUSampler;
  private readonly resolvePipe: GPUComputePipeline;
  private readonly presentPipe: GPUComputePipeline;
  private readonly lumaPipe: GPUComputePipeline;
  private readonly resolveU: GPUBuffer;
  private readonly presentU: GPUBuffer;
  private readonly lumaSum: GPUBuffer;
  private readonly lumaRead: { buf: GPUBuffer; busy: boolean }[] = [];
  private hist: GPUTexture[] = [];
  /** What post.ts reads when upscaling (output resolution). */
  out: GPUTexture | null = null;
  private tmp: GPUTexture | null = null;
  private frame = 0;
  private cur = 0;
  private prevVP: Mat4 | null = null;
  private prevEye: readonly number[] = [0, 0, 0];
  private reset = true;
  private inW = 1; private inH = 1; private outW = 1; private outH = 1;
  private binds: { resolve: GPUBindGroup[]; present: GPUBindGroup[]; nativePresent: GPUBindGroup | null; luma: GPUBindGroup | null } = { resolve: [], present: [], nativePresent: null, luma: null };
  /** Latest frame-average luminance (pre-exposure), one or two frames late; -1 until measured. */
  luminance = -1;
  onLuminance: ((l: number) => void) | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const mk = (code: string, entryPoint: string, label: string): GPUComputePipeline => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code, label }), entryPoint } });
    this.resolvePipe = mk(RESOLVE_WGSL, 'resolve', 'taa.resolve');
    this.presentPipe = mk(PRESENT_WGSL, 'present', 'taa.present');
    this.lumaPipe = mk(LUMA_WGSL, 'luma', 'taa.luma');
    this.resolveU = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.presentU = device.createBuffer({ size: 16 + MAX_SHELLS * 16 + MAX_SHELLS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lumaSum = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  }

  /** Internal size for an output size (multiples of 2 for the half-res volumetrics). */
  internalSize(outW: number, outH: number): [number, number] {
    if (!this.enabled) return [outW, outH];
    return [Math.max(2, Math.round((outW * this.scale) / 2) * 2), Math.max(2, Math.round((outH * this.scale) / 2) * 2)];
  }

  /** (Re)binds for new targets. `hdr` = internal HDR, `depth` = internal MSAA depth. */
  resize(hdr: GPUTexture, depth: GPUTexture, outW: number, outH: number): void {
    const d = this.device;
    for (const t of this.hist) t.destroy();
    this.out?.destroy();
    this.tmp?.destroy();
    this.hist = [];
    this.out = null;
    this.tmp = null;
    this.inW = hdr.width; this.inH = hdr.height; this.outW = outW; this.outH = outH;
    const rt = (w: number, h: number, label: string, extra = 0): GPUTexture => d.createTexture({
      label, size: [w, h], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | extra,
    });
    if (this.enabled) {
      this.hist = [rt(outW, outH, 'taa.hist0'), rt(outW, outH, 'taa.hist1')];
      this.out = rt(outW, outH, 'taa.out', GPUTextureUsage.RENDER_ATTACHMENT);
      this.binds.resolve = [0, 1].map((k) => d.createBindGroup({
        layout: this.resolvePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.resolveU } }, { binding: 1, resource: hdr.createView() },
          { binding: 2, resource: depth.createView() }, { binding: 3, resource: this.hist[1 - k]!.createView() },
          { binding: 4, resource: this.sampler }, { binding: 5, resource: this.hist[k]!.createView() },
          { binding: 6, resource: this.out!.createView() },
        ],
      }));
      this.binds.present = [0, 1].map((k) => this.presentBind(this.hist[k]!, this.out!));
      this.binds.nativePresent = null;
    } else {
      this.tmp = rt(hdr.width, hdr.height, 'taa.tmp');
      this.binds.resolve = [];
      this.binds.present = [];
      this.binds.nativePresent = this.presentBind(hdr, this.tmp);
    }
    this.binds.luma = d.createBindGroup({
      layout: this.lumaPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: hdr.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.lumaSum } }],
    });
    this.reset = true;
  }

  private presentBind(src: GPUTexture, dst: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.presentPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.presentU } }, { binding: 1, resource: src.createView() },
        { binding: 2, resource: this.sampler }, { binding: 3, resource: dst.createView() },
      ],
    });
  }

  /** This frame's jitter (internal pixels), or [0, 0] when off. */
  jitter(): [number, number] {
    if (!this.enabled) return [0, 0];
    return JITTER[this.frame % JITTER.length]!;
  }

  /** Applies a jitter (internal pixels) to a clip matrix (column-major), in place on a copy. */
  jittered(m: Mat4, j: readonly [number, number]): Mat4 {
    const o = new Float32Array(m);
    const ox = (2 * j[0]) / this.inW, oy = (-2 * j[1]) / this.inH;
    for (let c = 0; c < 4; c++) { o[c * 4] = o[c * 4]! + ox * o[c * 4 + 3]!; o[c * 4 + 1] = o[c * 4 + 1]! + oy * o[c * 4 + 3]!; }
    return o;
  }

  /** Forces the next frame to drop its history (cuts, teleports, resize). */
  cut(): void { this.reset = true; }

  /**
   * Records the luminance meter, the TAA resolve (when on) and the present pass with the shells.
   * `relVP` = this frame's un-jittered camera-relative view-projection; `eye` = world eye.
   * Returns true when the native HDR image was rewritten in place (shells without TAA).
   */
  run(enc: GPUCommandEncoder, hdr: GPUTexture, relVP: Mat4, invRelVP: Mat4, eye: readonly number[], shells: readonly Shell[], aspect: number, timer?: GPUComputePassTimestampWrites): void {
    const d = this.device;
    const pass = enc.beginComputePass(timer ? { timestampWrites: timer } : {});
    // luminance meter (flash limiter, measured layer)
    if (this.binds.luma && this.onLuminance) {
      pass.setPipeline(this.lumaPipe);
      pass.setBindGroup(0, this.binds.luma);
      pass.dispatchWorkgroups(8, 5);
    }
    const pu = new Float32Array(4 + MAX_SHELLS * 4 + MAX_SHELLS);
    pu.set([this.enabled ? this.outW : this.inW, this.enabled ? this.outH : this.inH, aspect, shells.length], 0);
    shells.forEach((s, i) => { pu.set([s.cx, s.cy, s.r, s.s], 4 + i * 4); pu[4 + MAX_SHELLS * 4 + i] = s.w; });
    d.queue.writeBuffer(this.presentU, 0, pu);
    if (this.enabled && this.out) {
      // reprojection: current clip (un-jittered, camera-relative) → world → previous clip
      const prev = this.prevVP ?? relVP;
      const de = [eye[0]! - this.prevEye[0]!, eye[1]! - this.prevEye[1]!, eye[2]! - this.prevEye[2]!];
      const T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, de[0]!, de[1]!, de[2]!, 1]);
      const reproj = mul4(mul4(prev, T), invRelVP);
      const j = this.jitter();
      const ub = new Float32Array(28);
      ub.set(reproj, 0);
      // w (named sharpen in the shader) = 1 when the present pass runs (shells), so resolve skips its copy
      ub.set([this.inW, this.inH, this.outW, this.outH, j[0], j[1], this.reset ? 1 : 0, shells.length ? 1 : 0], 16);
      d.queue.writeBuffer(this.resolveU, 0, ub);
      const k = this.cur;
      pass.setPipeline(this.resolvePipe);
      pass.setBindGroup(0, this.binds.resolve[k]!);
      pass.dispatchWorkgroups(Math.ceil(this.outW / 8), Math.ceil(this.outH / 8));
      if (shells.length) {
        pass.setPipeline(this.presentPipe);
        pass.setBindGroup(0, this.binds.present[k]!);
        pass.dispatchWorkgroups(Math.ceil(this.outW / 8), Math.ceil(this.outH / 8));
      }
      this.cur = 1 - k;
      this.prevVP = new Float32Array(relVP);
      this.prevEye = [eye[0]!, eye[1]!, eye[2]!];
      this.reset = false;
    } else if (shells.length && this.binds.nativePresent && this.tmp) {
      pass.setPipeline(this.presentPipe);
      pass.setBindGroup(0, this.binds.nativePresent);
      pass.dispatchWorkgroups(Math.ceil(this.inW / 8), Math.ceil(this.inH / 8));
    }
    pass.end();
    if (!this.enabled && shells.length && this.tmp) enc.copyTextureToTexture({ texture: this.tmp }, { texture: hdr }, [this.inW, this.inH]);
    if (this.binds.luma && this.onLuminance) this.readLuma(enc);
    this.frame++;
  }

  private readLuma(enc: GPUCommandEncoder): void {
    let slot = this.lumaRead.find((r) => !r.busy);
    if (!slot) {
      if (this.lumaRead.length >= 3) { enc.clearBuffer(this.lumaSum); return; }
      slot = { buf: this.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false };
      this.lumaRead.push(slot);
    }
    enc.copyBufferToBuffer(this.lumaSum, 0, slot.buf, 0, 16);
    enc.clearBuffer(this.lumaSum);
    slot.busy = true;
    const s = slot;
    queueMicrotask(() => {
      void s.buf.mapAsync(GPUMapMode.READ).then(() => {
        const v = new Uint32Array(s.buf.getMappedRange(0, 16))[0]! / 1000 / (64 * 40);
        s.buf.unmap();
        s.busy = false;
        this.luminance = v;
        this.onLuminance?.(v);
      }).catch(() => { s.busy = false; });
    });
  }
}

function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}
