// Screen-space AO and contact shadows (RENDERING §3 pass 14, §7 table, D79): from a half-resolution depth
// prepass (the renderer draws it with its own depth-only pipelines), one compute pass computes
//  - GTAO (Jimenez et al. 2016, after XeGTAO): N slice directions × M steps per side, analytic visible arc
//    with the projected normal reconstructed from depth; SSAO (normal-oriented hemisphere) on the 4 GB tier;
//  - screen-space contact shadows for the key light: a short ray toward the sun through the depth buffer
//    (the stand-in for G3's SDF contact shadows until the global SDF lands);
// then a depth-aware 4 × 4 blur. Output rgba16float (half res): r AO, g contact visibility, b view depth.
// The part shader upsamples it with depth weights (look/wgsl.ts lookAo).

import { giWgsl } from '../gi.ts';
import { FRAME_WGSL } from '../shaders.ts';
import type { LookTier } from './tiers.ts';

const AO_WGSL = (): string => /* wgsl */ `
${FRAME_WGSL}
${giWgsl(1)}
struct P {
  size: vec4f,     // xy AO size, zw 1/size
  ao: vec4f,       // x radius (m), y slices, z steps, w mode (0 ssao, 1 gtao)
  contact: vec4f,  // xyz sun direction (view space), w on
  misc: vec4f,     // x contact length (m), y contact thickness (m), z falloff, w probe GI on (half-res irradiance)
};
@group(0) @binding(5) var giOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var giSrc: texture_2d<f32>;
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> p: P;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;

const PI = 3.14159265;
const HALF_PI = 1.5707963;

/// View-space position (right-handed, −z forward) of a depth texel.
fn viewPos(q: vec2i) -> vec3f {
  let sz = vec2i(p.size.xy);
  let c = clamp(q, vec2i(0), sz - 1);
  let d = textureLoad(depthTex, c, 0);
  let uv = (vec2f(c) + 0.5) * p.size.zw;
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  let w = frame.invViewProj * ndc;
  let rel = w.xyz / w.w;
  return (frame.view * vec4f(rel, 1.0)).xyz;
}
fn viewAt(uv: vec2f) -> vec3f { return viewPos(vec2i(floor(uv * p.size.xy))); }
/// Screen uv of a view-space point.
fn uvOf(v: vec3f) -> vec2f {
  let z = max(-v.z, 1e-4);
  let t = frame.cluster.x;
  let ndc = vec2f(v.x / (z * t * frame.cluster.y), v.y / (z * t));
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}
fn ign(q: vec2f) -> f32 { return fract(52.9829189 * fract(dot(q, vec2f(0.06711056, 0.00583715)))); }

@compute @workgroup_size(8, 8)
fn ao(@builtin(global_invocation_id) gid: vec3u) {
  let q = vec2i(gid.xy);
  if (any(gid.xy >= vec2u(p.size.xy))) { return; }
  let d = textureLoad(depthTex, q, 0);
  if (d >= 1.0) { textureStore(outTex, q, vec4f(1.0, 1.0, 1e5, 1.0)); textureStore(giOut, q, vec4f(-1.0)); return; }
  let P0 = viewPos(q);
  // normal from the smaller depth difference on each axis (no smearing across silhouettes)
  let l = viewPos(q - vec2i(1, 0)); let r = viewPos(q + vec2i(1, 0));
  let u = viewPos(q - vec2i(0, 1)); let b = viewPos(q + vec2i(0, 1));
  let dx = select(P0 - l, r - P0, abs(r.z - P0.z) < abs(P0.z - l.z));
  let dy = select(P0 - u, b - P0, abs(b.z - P0.z) < abs(P0.z - u.z));
  var N = normalize(cross(dy, dx));
  let V = normalize(-P0);
  if (dot(N, V) < 0.0) { N = -N; }
  let z = -P0.z;
  // projected radius in AO texels
  let pxPerM = p.size.y / (2.0 * frame.cluster.x * z);
  let radiusPx = clamp(p.ao.x * pxPerM, 2.0, 96.0);
  let noise = ign(vec2f(q));
  let noise2 = ign(vec2f(q) + vec2f(17.0, 59.0));
  var vis = 1.0;
  if (p.ao.w > 0.5) {
    // GTAO
    let slices = u32(p.ao.y);
    let steps = u32(p.ao.z);
    var acc = 0.0;
    for (var s = 0u; s < slices; s++) {
      let phi = (f32(s) + noise) / f32(slices) * PI;
      let omega = vec2f(cos(phi), -sin(phi));          // screen space (y down)
      let dirV = vec3f(cos(phi), sin(phi), 0.0);       // view space (y up)
      let ortho = dirV - dot(dirV, V) * V;
      let axis = normalize(cross(ortho, V));
      let pn = N - axis * dot(N, axis);
      let pnl = max(length(pn), 1e-4);
      let signN = sign(dot(ortho, pn));
      let cosN = clamp(dot(pn, V) / pnl, -1.0, 1.0);
      let n = signN * acos(cosN);
      var hc0 = cos(n + HALF_PI);
      var hc1 = cos(n - HALF_PI);
      let low0 = hc0; let low1 = hc1;
      for (var j = 0u; j < steps; j++) {
        let t = (f32(j) + noise2) / f32(steps);
        let off = omega * max(t * t * radiusPx, f32(j) + 1.0) * p.size.zw;
        let uv0 = (vec2f(q) + 0.5) * p.size.zw;
        let S0 = viewAt(uv0 + off);
        let S1 = viewAt(uv0 - off);
        let h0 = S0 - P0; let h1 = S1 - P0;
        let l0 = length(h0); let l1 = length(h1);
        let f0 = clamp(1.0 - l0 / p.ao.x, 0.0, 1.0);
        let f1 = clamp(1.0 - l1 / p.ao.x, 0.0, 1.0);
        hc0 = max(hc0, mix(low0, dot(h0 / max(l0, 1e-5), V), f0));
        hc1 = max(hc1, mix(low1, dot(h1 / max(l1, 1e-5), V), f1));
      }
      var a0 = -acos(clamp(hc1, -1.0, 1.0));
      var a1 = acos(clamp(hc0, -1.0, 1.0));
      a0 = n + clamp(a0 - n, -HALF_PI, HALF_PI);
      a1 = n + clamp(a1 - n, -HALF_PI, HALF_PI);
      let i0 = (cosN + 2.0 * a0 * sin(n) - cos(2.0 * a0 - n)) * 0.25;
      let i1 = (cosN + 2.0 * a1 * sin(n) - cos(2.0 * a1 - n)) * 0.25;
      acc += pnl * (i0 + i1);
    }
    vis = clamp(acc / f32(slices), 0.0, 1.0);
  } else {
    // SSAO: samples in the normal-oriented hemisphere, projected to screen and compared with the depth
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(N.y) > 0.9);
    let T = normalize(cross(up, N));
    let B = cross(N, T);
    var occ = 0.0;
    let n = u32(p.ao.z) * 2u;
    for (var k = 0u; k < n; k++) {
      let a = (f32(k) + noise) * 2.3999632;
      let rr = sqrt((f32(k) + 0.5) / f32(n));
      let h = sqrt(1.0 - rr * rr);
      let sv = P0 + (T * cos(a) * rr + B * sin(a) * rr + N * h) * p.ao.x * mix(0.2, 1.0, fract(noise2 + f32(k) * 0.618));
      let S = viewAt(uvOf(sv));
      let dz = S.z - sv.z;
      if (dz > 0.01) { occ += clamp(1.0 - (dz - 0.01) / p.ao.x, 0.0, 1.0); }
    }
    vis = 1.0 - occ / f32(n);
  }
  // contact shadow toward the key light
  var contact = 1.0;
  if (p.contact.w > 0.5 && dot(N, p.contact.xyz) > 0.0) {
    let len = p.misc.x;
    let steps = 12;
    let start = P0 + N * 0.004 * z;
    for (var k = 1; k <= steps; k++) {
      let t = (f32(k) - 0.5 + noise) / f32(steps);
      let sp = start + p.contact.xyz * (len * t * t + 0.002);
      let suv = uvOf(sp);
      if (any(suv < vec2f(0.0)) || any(suv > vec2f(1.0))) { break; }
      let S = viewAt(suv);
      let dz = S.z - sp.z;
      if (dz > 0.002 * z && dz < p.misc.y) { contact = 1.0 - smoothstep(0.6, 1.0, t) * 0.5; break; }
    }
  }
  textureStore(outTex, q, vec4f(vis, contact, z, 1.0));
  // probe GI irradiance at half resolution (G3's probes; -1 = not covered): the part shader upsamples it
  var irr = vec3f(-1.0);
  if (p.misc.w > 0.5) {
    let wn = vec3f(dot(N, frame.view[0].xyz), dot(N, frame.view[1].xyz), dot(N, frame.view[2].xyz));
    let wp = vec3f(dot(P0, frame.view[0].xyz), dot(P0, frame.view[1].xyz), dot(P0, frame.view[2].xyz)) + frame.eye.xyz;
    irr = giIrradiance(wp, wn);
  }
  textureStore(giOut, q, vec4f(irr, 1.0));
}

@group(0) @binding(4) var srcTex: texture_2d<f32>;
/// Depth-aware 4 × 4 blur of the raw AO (removes the per-pixel rotation noise).
@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid: vec3u) {
  let q = vec2i(gid.xy);
  if (any(gid.xy >= vec2u(p.size.xy))) { return; }
  let c = textureLoad(srcTex, q, 0);
  let g0 = textureLoad(giSrc, q, 0);
  if (c.z >= 1e4) { textureStore(outTex, q, c); textureStore(giOut, q, g0); return; }
  var acc = vec2f(0.0);
  var wsum = 0.0;
  var gacc = vec3f(0.0);
  var gw = 0.0;
  let sz = vec2i(p.size.xy) - 1;
  for (var y = -2; y <= 1; y++) {
    for (var x = -2; x <= 1; x++) {
      let s = textureLoad(srcTex, clamp(q + vec2i(x, y), vec2i(0), sz), 0);
      let w = 1.0 / (1e-3 + abs(s.z - c.z) / c.z * 30.0);
      acc += s.xy * w;
      wsum += w;
      let g = textureLoad(giSrc, clamp(q + vec2i(x, y), vec2i(0), sz), 0);
      if (g.x >= 0.0) { gacc += g.rgb * w; gw += w; }
    }
  }
  textureStore(outTex, q, vec4f(acc / wsum, c.z, 1.0));
  textureStore(giOut, q, select(vec4f(-1.0), vec4f(gacc / max(gw, 1e-6), 1.0), gw > 0.0));
}
`;

export class AoPass {
  private readonly d: GPUDevice;
  depth!: GPUTexture;
  out!: GPUTexture;
  /** Half-res probe GI irradiance (rgb; -1 where the probes don't cover the pixel). */
  gi!: GPUTexture;
  private raw!: GPUTexture;
  private giRaw!: GPUTexture;
  private pipe: { ao: GPUComputePipeline; blur: GPUComputePipeline } | null = null;
  private giLayout: GPUBindGroupLayout | null = null;
  private readonly params: GPUBuffer;
  private binds: { ao: GPUBindGroup; blur: GPUBindGroup } | null = null;
  private readonly frameBuf: GPUBuffer;
  width = 0;
  height = 0;
  /** Bumped when the textures are recreated. */
  version = 0;

  constructor(device: GPUDevice, frameBuf: GPUBuffer) {
    this.d = device;
    this.frameBuf = frameBuf;
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this.bgl = bgl;
    this.params = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.resize(2, 2);
  }
  private readonly bgl: GPUBindGroupLayout;

  /** Half of the output size (call from the renderer's resize). */
  resize(fullW: number, fullH: number): void {
    const w = Math.max(1, Math.ceil(fullW / 2)), h = Math.max(1, Math.ceil(fullH / 2));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    for (const t of [this.depth, this.out, this.raw, this.gi, this.giRaw]) t?.destroy();
    const d = this.d;
    this.depth = d.createTexture({ label: 'look.depth½', size: [w, h], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const mk = (label: string): GPUTexture => d.createTexture({ label, size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    this.raw = mk('look.ao.raw');
    this.out = mk('look.ao');
    this.giRaw = mk('look.gi.raw');
    this.gi = mk('look.gi');
    const entries = (out: GPUTexture, src: GPUTexture, gout: GPUTexture, gsrc: GPUTexture): GPUBindGroupEntry[] => [
      { binding: 0, resource: { buffer: this.frameBuf } }, { binding: 1, resource: { buffer: this.params } },
      { binding: 2, resource: this.depth.createView() }, { binding: 3, resource: out.createView() }, { binding: 4, resource: src.createView() },
      { binding: 5, resource: gout.createView() }, { binding: 6, resource: gsrc.createView() },
    ];
    // the AO pass's sampled bindings (4, 6) are unused there: bind the blur's outputs (non-aliasing)
    this.binds = {
      ao: d.createBindGroup({ layout: this.bgl, entries: entries(this.raw, this.out, this.giRaw, this.gi) }),
      blur: d.createBindGroup({ layout: this.bgl, entries: entries(this.out, this.raw, this.gi, this.giRaw) }),
    };
    this.version++;
  }

  /** Records the AO + contact pass (after the depth prepass). `sunView` = direction to the key light, view space. */
  run(enc: GPUCommandEncoder, tier: LookTier, sunView: readonly number[], contact: boolean, gi: { layout: GPUBindGroupLayout; bindGroup: GPUBindGroup; on: boolean }, ts?: GPUComputePassTimestampWrites): void {
    if (!this.pipe || this.giLayout !== gi.layout) {
      // created on first use: the layout includes G3's GI bind group (group 1)
      this.giLayout = gi.layout;
      const mod = this.d.createShaderModule({ code: AO_WGSL(), label: 'look.ao' });
      const layout = this.d.createPipelineLayout({ bindGroupLayouts: [this.bgl, gi.layout] });
      this.pipe = {
        ao: this.d.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'ao' } }),
        blur: this.d.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'blur' } }),
      };
    }
    const radius = 0.22;
    this.d.queue.writeBuffer(this.params, 0, new Float32Array([
      this.width, this.height, 1 / this.width, 1 / this.height,
      radius, tier.aoSlices, tier.aoSteps, tier.ao === 'gtao' ? 1 : 0,
      sunView[0]!, sunView[1]!, sunView[2]!, contact ? 1 : 0,
      0.14, 0.06, 0, gi.on ? 1 : 0,
    ]));
    const pass = enc.beginComputePass(ts ? { timestampWrites: ts } : {});
    const gx = Math.ceil(this.width / 8), gy = Math.ceil(this.height / 8);
    pass.setPipeline(this.pipe.ao);
    pass.setBindGroup(0, this.binds!.ao);
    pass.setBindGroup(1, gi.bindGroup);
    pass.dispatchWorkgroups(gx, gy);
    pass.setPipeline(this.pipe.blur);
    pass.setBindGroup(1, gi.bindGroup);
    pass.setBindGroup(0, this.binds!.blur);
    pass.dispatchWorkgroups(gx, gy);
    pass.end();
  }
}
