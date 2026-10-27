// Debris chunklets (GAME_SPEC §13, RENDERING §8): GPU rigid-lite micro chunks. Each chunk is a sphere
// proxy for collision (the global SDF from gi.ts plus the floor) drawn as one of four flat-shaded shard
// shapes. Chunks tumble, bounce with friction and spin from the contact, sleep when they settle, then
// either fade at the end of their life or persist as rubble until Stop. Purely visual: nothing here ever
// touches the sim (contract 3). Spawned from Break and Detonate events through fx.ts.
//
// Per frame: emit this frame's bursts into ring slots → simulate every slot up to the high-water mark,
// appending live chunks to a compact list → finalize the indirect draw args. Drawn in the opaque main pass
// (depth write, shadowed key light, probe GI when on) and into the shadow map.

import { FRAME_WGSL } from './shaders.ts';
import { giWgsl, type Gi, type GTier } from './gi.ts';

export interface DebrisBurst {
  readonly pos: readonly [number, number, number];
  readonly count: number;
  /** Spawn box half extents (m): chunks start anywhere inside it (a broken part's bounds). */
  readonly extent?: readonly [number, number, number];
  readonly dir?: readonly [number, number, number];
  /** 0 = along dir, 1 = full sphere. */
  readonly spread?: number;
  readonly speed: readonly [number, number];
  /** Sphere-proxy radius range (m). */
  readonly size: readonly [number, number];
  readonly life: readonly [number, number];
  /** Linear RGB albedo; each chunk picks a mix of color and color2. */
  readonly color: readonly [number, number, number];
  readonly color2?: readonly [number, number, number];
  /** Fraction of chunks that stay as rubble until Stop (the rest fade at the end of their life). */
  readonly persist?: number;
  /** 0 chunk (brick, stone), 1 splinter (wood), 2 shard (glass, shiny), 3 flake (paper, card). */
  readonly shape?: 0 | 1 | 2 | 3;
  /** Initial spin (rad/s). */
  readonly spin?: number;
}

/** Live chunk caps by tier (GAME_SPEC §13: 500k on 16 GB; D85: 1M on 32 GB). */
export const DEBRIS_CAP: Record<GTier, number> = { 4: 60_000, 8: 150_000, 12: 300_000, 16: 500_000, 32: 1_000_000 };

const C_BYTES = 64;
const BURST_BYTES = 96;
const MAX_BURSTS = 128;
const SHARD_VERTS = 36;

const COMMON = /* wgsl */ `
struct Chunk {
  pos: vec3f, radius: f32,
  vel: vec3f, age: f32,
  rot: vec4f,
  wxy: u32, wzLife: u32, color: u32, misc: u32,  // misc: shape 2 | sleep 1 << 2 | persist 1 << 3 | still frames << 8 | seed << 16
};
struct DU { capacity: u32, head: u32, emitCount: u32, burstCount: u32, high: u32, frameSeed: u32, dt: f32, time: f32, screenH: f32, _a: f32, _b: f32, _c: f32 };
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
`;

const SIM_WGSL = /* wgsl */ `
${FRAME_WGSL}
${COMMON}
${giWgsl(1)}
struct Burst {
  pos: vec3f, count: u32,
  dir: vec3f, spread: f32,
  extent: vec3f, first: u32,
  speed: vec2f, size: vec2f,
  life: vec2f, color: u32, color2: u32,
  persist: f32, shape: u32, spin: f32, seed: u32,
};
@group(0) @binding(0) var<uniform> u: DU;
@group(0) @binding(1) var<storage, read_write> chunks: array<Chunk>;
@group(0) @binding(2) var<storage, read_write> alive: array<u32>;
@group(0) @binding(3) var<storage, read_write> counter: array<atomic<u32>, 4>;
@group(0) @binding(4) var<storage, read_write> drawArgs: array<u32, 8>;
@group(0) @binding(5) var<storage, read> bursts: array<Burst>;
@group(0) @binding(6) var<uniform> frame: Frame;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(h: ptr<function, u32>) -> f32 { *h = pcg(*h); return f32(*h >> 8u) / 16777216.0; }

@compute @workgroup_size(1) fn begin() { atomicStore(&counter[0], 0u); atomicStore(&counter[1], 0u); }

@compute @workgroup_size(256) fn emit(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i >= u.emitCount) { return; }
  var b = 0u;
  for (var k = 1u; k < u.burstCount; k++) { if (bursts[k].first <= i) { b = k; } }
  let B = bursts[b];
  var h = pcg(i ^ (u.frameSeed * 2654435761u) ^ B.seed);
  let cz = 1.0 - B.spread * 2.0 * rnd(&h);
  let sz = sqrt(max(0.0, 1.0 - cz * cz));
  let ph = 6.2831853 * rnd(&h);
  let w = normalize(B.dir);
  let a = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(w.x) > 0.9);
  let t1 = normalize(cross(w, a));
  let t2 = cross(w, t1);
  let d = w * cz + (t1 * cos(ph) + t2 * sin(ph)) * sz;
  var c: Chunk;
  let off = (vec3f(rnd(&h), rnd(&h), rnd(&h)) * 2.0 - 1.0) * B.extent;
  c.pos = B.pos + off;
  c.radius = mix(B.size.x, B.size.y, rnd(&h) * rnd(&h));
  // chunks from the outside of the box fly faster and outward
  c.vel = (d + off * 1.5) * mix(B.speed.x, B.speed.y, rnd(&h));
  c.age = 0.0;
  let q = normalize(vec4f(rnd(&h) - 0.5, rnd(&h) - 0.5, rnd(&h) - 0.5, rnd(&h) - 0.5) + vec4f(1e-4));
  c.rot = q;
  let spin = (vec3f(rnd(&h), rnd(&h), rnd(&h)) * 2.0 - 1.0) * B.spin;
  let life = mix(B.life.x, B.life.y, rnd(&h));
  c.wxy = pack2x16float(spin.xy);
  c.wzLife = pack2x16float(vec2f(spin.z, life));
  let ca = unpack4x8unorm(B.color);
  let cb = unpack4x8unorm(B.color2);
  c.color = pack4x8unorm(mix(ca, cb, rnd(&h)) * (0.85 + 0.3 * rnd(&h)));
  let persist = select(0u, 8u, rnd(&h) < B.persist);
  c.misc = (B.shape & 3u) | persist | ((h & 0xffffu) << 16u);
  chunks[(u.head + i) % u.capacity] = c;
}

@compute @workgroup_size(256) fn simulate(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i >= u.high) { return; }
  var c = chunks[i];
  let wz = unpack2x16float(c.wzLife);
  let life = wz.y;
  let persist = (c.misc & 8u) != 0u;
  if (c.radius <= 0.0 || (!persist && c.age >= life + 0.6)) { return; }
  let dt = u.dt;
  var sleeping = (c.misc & 4u) != 0u;
  if (sleeping) {
    // wake when something moves into the chunk (a part slides over the rubble)
    if (dt > 0.0 && giSdf(c.pos) < c.radius * 0.3) { sleeping = false; c.misc &= ~4u; }
  }
  if (!sleeping && dt > 0.0) {
    var v = c.vel;
    var w = vec3f(unpack2x16float(c.wxy), wz.x);
    v.y -= 9.81 * dt;
    v *= 1.0 / (1.0 + 0.08 * dt);
    c.pos += v * dt;
    // integrate rotation: q' = q + 0.5 (w, 0) q dt
    let q = c.rot;
    let dq = vec4f(w.x * q.w + w.y * q.z - w.z * q.y, w.y * q.w + w.z * q.x - w.x * q.z, w.z * q.w + w.x * q.y - w.y * q.x, -w.x * q.x - w.y * q.y - w.z * q.z);
    c.rot = normalize(q + dq * 0.5 * dt);
    let d = giSdf(c.pos);
    var still = (c.misc >> 8u) & 255u;
    if (d < c.radius) {
      let n = giNormal(c.pos);
      c.pos += n * (c.radius - d);
      let vn = dot(v, n);
      if (vn < 0.0) {
        let e = select(0.35, 0.05, -vn < 0.6); // slow contacts don't bounce
        v -= (1.0 + e) * vn * n;
        let vt = v - dot(v, n) * n;
        let lt = length(vt);
        if (lt > 1e-5) { v -= vt * min(1.0, 0.6 * -vn / lt + 4.0 * dt); }
        // roll / tumble from the contact
        w = mix(w, cross(n, vt) / max(c.radius, 1e-3), 0.4);
      }
      w *= 1.0 / (1.0 + 3.0 * dt);
      if (length(v) < 0.12 && length(w) < 2.5) { still = min(still + 1u, 255u); } else { still = 0u; }
    } else {
      still = 0u;
    }
    if (still > 18u) {
      sleeping = true;
      v = vec3f(0.0);
      w = vec3f(0.0);
      c.misc |= 4u;
    }
    c.misc = (c.misc & ~0xff00u) | (still << 8u);
    c.vel = v;
    c.wxy = pack2x16float(w.xy);
    c.wzLife = pack2x16float(vec2f(w.z, life));
  }
  c.age += dt;
  if (!persist && c.age >= life + 0.6) { c.radius = 0.0; chunks[i] = c; return; }
  chunks[i] = c;
  // two draw lists: chunks in the view and at least ~half a pixel big; chunks in the shadow map's frustum
  // and bigger than a shadow texel (rubble far away or tiny costs nothing)
  let rel = c.pos - frame.eye.xyz;
  let r = c.radius * 1.4;
  let clip = frame.viewProj * vec4f(rel, 1.0);
  if (clip.w > -r) {
    let w = max(clip.w, 1e-3);
    let m = r / w * frame.viewProj[1][1];
    let ndc = clip.xy / w;
    if (all(abs(ndc) < vec2f(1.0 + 2.0 * m)) && m * u.screenH * 0.5 > 0.45) {
      let k = atomicAdd(&counter[0], 1u);
      if (k < u.capacity) { alive[k] = i; }
    }
  }
  let sc = frame.shadowMat * vec4f(rel, 1.0);
  if (all(abs(sc.xy) < vec2f(1.02)) && sc.z > -0.01 && sc.z < 1.01 && r > frame.params.z * 1.5) {
    let k = atomicAdd(&counter[1], 1u);
    if (k < u.capacity) { alive[u.capacity + k] = i; }
  }
}

@compute @workgroup_size(1) fn finalize() {
  drawArgs[0] = ${SHARD_VERTS}u;
  drawArgs[1] = min(atomicLoad(&counter[0]), u.capacity);
  drawArgs[2] = 0u;
  drawArgs[3] = 0u;
  drawArgs[4] = ${SHARD_VERTS}u;
  drawArgs[5] = min(atomicLoad(&counter[1]), u.capacity);
  drawArgs[6] = 0u;
  drawArgs[7] = 0u;
}
`;

const DRAW_WGSL = /* wgsl */ `
${FRAME_WGSL}
${COMMON}
${giWgsl(1)}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> chunks: array<Chunk>;
@group(0) @binding(2) var<storage, read> alive: array<u32>;
@group(0) @binding(3) var<storage, read> shards: array<vec4f>; // per vertex: position (shape-local, unit), normal
@group(0) @binding(4) var shadowMap: texture_depth_2d;
@group(0) @binding(5) var shadowSampler: sampler_comparison;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) color: vec4f,
};

override CAP: u32 = 0u;
fn chunkVertex(ii: u32, vi: u32, n: ptr<function, vec3f>, col: ptr<function, vec4f>) -> vec3f {
  let c = chunks[alive[ii]];
  let shape = c.misc & 3u;
  let life = unpack2x16float(c.wzLife).y;
  var s = c.radius * 1.35;
  if ((c.misc & 8u) == 0u) { s *= 1.0 - smoothstep(life, life + 0.6, c.age); }
  let v = shards[(shape * ${SHARD_VERTS}u + vi) * 2u];
  let nn = shards[(shape * ${SHARD_VERTS}u + vi) * 2u + 1u];
  *n = qrot(c.rot, nn.xyz);
  *col = vec4f(unpack4x8unorm(c.color).rgb, f32(shape));
  return c.pos + qrot(c.rot, v.xyz * s) - frame.eye.xyz;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var n: vec3f;
  var col: vec4f;
  let rel = chunkVertex(ii, vi, &n, &col);
  var o: VOut;
  o.clip = frame.viewProj * vec4f(rel, 1.0);
  o.rel = rel;
  o.n = n;
  o.color = col;
  return o;
}

@vertex fn vs_shadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  var n: vec3f;
  var col: vec4f;
  let rel = chunkVertex(CAP + ii, vi, &n, &col);
  return frame.shadowMat * vec4f(rel, 1.0);
}

fn shadowAt(rel: vec3f, nrm: vec3f) -> f32 {
  let p = frame.shadowMat * vec4f(rel + nrm * frame.params.z * 2.0, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || p.z > 1.0) { return 1.0; }
  return textureSampleCompareLevel(shadowMap, shadowSampler, uv, p.z - 0.0003);
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  // the srgb-ish albedo the parts use (pow 2.2)
  let alb = pow(i.color.rgb, vec3f(2.2));
  let shape = u32(i.color.a + 0.5);
  let n0 = normalize(i.n);
  let v = normalize(-i.rel);
  let n = select(-n0, n0, dot(n0, v) >= 0.0);
  let world = i.rel + frame.eye.xyz;
  let sh = shadowAt(i.rel, n);
  var c = alb * frame.keyColor.rgb * frame.key.w * max(dot(n, frame.key.xyz), 0.0) * sh;
  c += alb * frame.keyColor.rgb * frame.fill.w * max(dot(n, frame.fill.xyz), 0.0);
  c += alb * frame.rimColor.rgb * frame.rim.w * max(dot(n, frame.rim.xyz), 0.0);
  var amb = giIrradiance(world, n);
  if (amb.x < 0.0) {
    amb = mix(frame.ground.rgb * frame.horizon.rgb * 0.9, frame.skyTop.rgb, n.y * 0.5 + 0.5) * 0.55;
  }
  c += alb * amb * giAo(world, n);
  // glass shards and the fresh faces of chunks catch a key-light glint
  let h = normalize(v + frame.key.xyz);
  let spec = pow(max(dot(n, h), 0.0), select(24.0, 90.0, shape == 2u)) * select(0.08, 0.9, shape == 2u);
  c += frame.keyColor.rgb * frame.key.w * spec * sh;
  return vec4f(c, 1.0);
}
`;

/** Four shard shapes: perturbed boxes, flat-shaded (12 triangles, 36 vertices each). */
function shardGeometry(): Float32Array {
  const shapes: [number, number, number][] = [[0.8, 0.62, 0.7], [1.0, 0.16, 0.28], [0.9, 0.05, 0.7], [0.75, 0.04, 0.55]];
  let seed = 12345;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  const out = new Float32Array(4 * SHARD_VERTS * 8);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  shapes.forEach((sc, s) => {
    const corners: number[][] = [];
    for (let k = 0; k < 8; k++) {
      const c = [k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1];
      corners.push(c.map((v, a) => (v * (0.75 + 0.35 * rnd()) + (rnd() - 0.5) * 0.3) * sc[a]!));
    }
    let o = s * SHARD_VERTS * 8;
    for (const f of faces) {
      for (const tri of [[f[0]!, f[1]!, f[2]!], [f[0]!, f[2]!, f[3]!]]) {
        const [a, b, c] = tri.map((i) => corners[i]!) as [number[], number[], number[]];
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!, nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (const p of [a, b, c]) { out.set([p[0]!, p[1]!, p[2]!, 1, nx, ny, nz, 0], o); o += 8; }
      }
    }
  });
  return out;
}

const toSrgb8 = (c: number): number => Math.max(0, Math.min(255, Math.round(Math.max(0, c) ** (1 / 2.2) * 255)));
const packColor = (c: readonly number[]): number => (toSrgb8(c[0]!) | (toSrgb8(c[1]!) << 8) | (toSrgb8(c[2]!) << 16) | (255 << 24)) >>> 0;

export class Debris {
  readonly capacity: number;
  private readonly device: GPUDevice;
  private readonly chunks: GPUBuffer;
  private readonly alive: GPUBuffer;
  private readonly counter: GPUBuffer;
  private readonly drawArgs: GPUBuffer;
  private readonly burstBuf: GPUBuffer;
  private readonly uniform: GPUBuffer;
  private readonly pipes: Record<'begin' | 'emit' | 'simulate' | 'finalize', GPUComputePipeline>;
  private readonly simBind: GPUBindGroup;
  private readonly drawPipe: GPURenderPipeline;
  private readonly shadowPipe: GPURenderPipeline;
  private readonly drawBind: GPUBindGroup;
  private readonly gi: Gi;
  private queue: DebrisBurst[] = [];
  private head = 0;
  private high = 0;
  private frameNo = 0;
  private live = false;
  emittedTotal = 0;
  /** Render height in pixels (the sub-pixel cull). */
  screenH = 1080;
  private readonly burstData = new ArrayBuffer(MAX_BURSTS * BURST_BYTES);

  constructor(device: GPUDevice, tier: GTier, gi: Gi, frameBuf: GPUBuffer, shadowView: GPUTextureView, shadowSampler: GPUSampler,
    colorFormat: GPUTextureFormat, msaa: number) {
    this.device = device;
    this.gi = gi;
    this.capacity = Math.min(DEBRIS_CAP[tier] ?? DEBRIS_CAP[16], Math.floor(device.limits.maxStorageBufferBindingSize / C_BYTES));
    const S = GPUBufferUsage.STORAGE;
    this.chunks = device.createBuffer({ label: 'debris.chunks', size: this.capacity * C_BYTES, usage: S | GPUBufferUsage.COPY_DST });
    this.alive = device.createBuffer({ label: 'debris.alive', size: this.capacity * 8, usage: S | GPUBufferUsage.COPY_DST }); // camera list, shadow list
    this.counter = device.createBuffer({ size: 16, usage: S | GPUBufferUsage.COPY_DST });
    this.drawArgs = device.createBuffer({ label: 'debris.args', size: 32, usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.burstBuf = device.createBuffer({ size: MAX_BURSTS * BURST_BYTES, usage: S | GPUBufferUsage.COPY_DST });
    this.uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // touch the pool at init (behind the loading screen) rather than in the first blast's frame
    { const enc = device.createCommandEncoder(); enc.clearBuffer(this.chunks); enc.clearBuffer(this.alive); device.queue.submit([enc.finish()]); }
    const shards = shardGeometry();
    const shardBuf = device.createBuffer({ size: shards.byteLength, usage: S | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(shardBuf, 0, shards);

    const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const simLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4].map((b) => ({ binding: b, visibility: C, buffer: { type: 'storage' as const } })),
        { binding: 5, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: C, buffer: { type: 'uniform' } },
      ],
    });
    const smod = device.createShaderModule({ code: SIM_WGSL, label: 'debris.sim' });
    const spl = device.createPipelineLayout({ bindGroupLayouts: [simLayout, gi.layout] });
    const mk = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: spl, compute: { module: smod, entryPoint } });
    this.pipes = { begin: mk('begin'), emit: mk('emit'), simulate: mk('simulate'), finalize: mk('finalize') };
    this.simBind = device.createBindGroup({
      layout: simLayout,
      entries: [this.uniform, this.chunks, this.alive, this.counter, this.drawArgs, this.burstBuf, frameBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });

    const drawEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 5, visibility: F, sampler: { type: 'comparison' } },
    ];
    const drawLayout = device.createBindGroupLayout({ entries: drawEntries });
    const dmod = device.createShaderModule({ code: DRAW_WGSL, label: 'debris.draw' });
    const dpl = device.createPipelineLayout({ bindGroupLayouts: [drawLayout, gi.layout] });
    this.drawPipe = device.createRenderPipeline({
      layout: dpl,
      vertex: { module: dmod, entryPoint: 'vs' },
      fragment: { module: dmod, entryPoint: 'fs', targets: [{ format: colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: msaa },
    });
    // the shadow pass renders into the shadow map, so its bind group must not also sample it
    const shadowLayout = device.createBindGroupLayout({ entries: drawEntries.slice(0, 4) });
    this.shadowPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [shadowLayout, gi.layout] }),
      vertex: { module: dmod, entryPoint: 'vs_shadow', constants: { CAP: this.capacity } },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
    });
    this.drawBind = device.createBindGroup({
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: this.chunks } },
        { binding: 2, resource: { buffer: this.alive } }, { binding: 3, resource: { buffer: shardBuf } },
        { binding: 4, resource: shadowView }, { binding: 5, resource: shadowSampler },
      ],
    });
    this.shadowBind = device.createBindGroup({
      layout: shadowLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: this.chunks } },
        { binding: 2, resource: { buffer: this.alive } }, { binding: 3, resource: { buffer: shardBuf } },
      ],
    });
  }
  private readonly shadowBind: GPUBindGroup;

  emit(b: DebrisBurst): void { if (b.count > 0) this.queue.push(b); }

  /** Records emit/simulate/finalize (dt already includes the playback time scale). */
  update(pass: GPUComputePassEncoder, dt: number, time: number): void {
    const bursts = this.queue.splice(0, MAX_BURSTS);
    if (!this.live && !bursts.length) return;
    const f = new Float32Array(this.burstData), w = new Uint32Array(this.burstData);
    let total = 0, n = 0;
    const maxPerFrame = Math.min(this.capacity, 200_000);
    for (const b of bursts) {
      const count = Math.min(b.count, maxPerFrame - total);
      if (count <= 0) break;
      const o = n * (BURST_BYTES / 4);
      const dir = b.dir ?? [0, 1, 0];
      const e = b.extent ?? [0, 0, 0];
      f.set([b.pos[0], b.pos[1], b.pos[2]], o); w[o + 3] = count;
      f.set([dir[0], dir[1], dir[2], b.spread ?? 1], o + 4);
      f.set([e[0], e[1], e[2]], o + 8); w[o + 11] = total;
      f.set([b.speed[0], b.speed[1], b.size[0], b.size[1], b.life[0], b.life[1]], o + 12);
      w[o + 18] = packColor(b.color); w[o + 19] = packColor(b.color2 ?? b.color);
      f[o + 20] = b.persist ?? 0; w[o + 21] = b.shape ?? 0; f[o + 22] = b.spin ?? 12; w[o + 23] = (n * 2654435761 + this.frameNo * 97) >>> 0;
      total += count;
      n++;
    }
    if (n) this.device.queue.writeBuffer(this.burstBuf, 0, this.burstData, 0, n * BURST_BYTES);
    this.high = Math.min(this.capacity, Math.max(this.high, this.head + total));
    if (this.head + total > this.capacity) this.high = this.capacity;
    const ub = new ArrayBuffer(48), uw = new Uint32Array(ub), uf = new Float32Array(ub);
    uw.set([this.capacity, this.head, total, n, this.high, this.frameNo]);
    uf[6] = Math.min(dt, 1 / 20); uf[7] = time; uf[8] = this.screenH;
    this.device.queue.writeBuffer(this.uniform, 0, ub);
    pass.setBindGroup(0, this.simBind);
    pass.setBindGroup(1, this.gi.bindGroup);
    pass.setPipeline(this.pipes.begin);
    pass.dispatchWorkgroups(1);
    if (total > 0) {
      pass.setPipeline(this.pipes.emit);
      const g = Math.ceil(total / 256);
      pass.dispatchWorkgroups(Math.min(g, 32768), Math.ceil(g / 32768));
    }
    if (this.high > 0) {
      pass.setPipeline(this.pipes.simulate);
      const g = Math.ceil(this.high / 256);
      pass.dispatchWorkgroups(Math.min(g, 32768), Math.ceil(g / 32768));
    }
    pass.setPipeline(this.pipes.finalize);
    pass.dispatchWorkgroups(1);
    this.head = (this.head + total) % this.capacity;
    this.emittedTotal += total;
    this.frameNo++;
    this.live = true;
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.live) return;
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBind);
    pass.setBindGroup(1, this.gi.bindGroup);
    pass.drawIndirect(this.drawArgs, 0);
  }

  drawShadow(pass: GPURenderPassEncoder): void {
    if (!this.live) return;
    pass.setPipeline(this.shadowPipe);
    pass.setBindGroup(0, this.shadowBind);
    pass.setBindGroup(1, this.gi.bindGroup);
    pass.drawIndirect(this.drawArgs, 16);
  }

  /** Stop: rubble and every flying chunk go (perfect reset). */
  clear(): void {
    this.queue = [];
    this.head = 0;
    this.high = 0;
    this.live = false;
    this.device.queue.writeBuffer(this.drawArgs, 0, new Uint32Array([SHARD_VERTS, 0, 0, 0, SHARD_VERTS, 0, 0, 0]));
  }

  /** Live chunk count (async, debug/HUD). */
  async liveCount(): Promise<number> {
    const rb = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.drawArgs, 0, rb, 0, 16);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const v = new Uint32Array(rb.getMappedRange())[1]!;
    rb.unmap();
    rb.destroy();
    return v;
  }
}
