// SDF global illumination (RENDERING §7, D79, D85): a global SDF clipmap stamped from the scene's
// instances, and DDGI-style probes sphere-traced against it. Stream G3 owns this; stream L3 consumes it
// in the look pass through `giWgsl(group)` + `gi.layout` / `gi.bindGroup` (the contract is in
// docs/dev/M3_NOTES_G3.md). Debris chunklets collide with the same SDF.
//
// Clipmap: L levels of N³ cells, level 0 = 8 m, ×4 per level, centred on the camera focus and snapped to
// 4-cell steps. A level is rebuilt when the scene changes, when its origin moves, and in a run at a per-level
// rate (level 0 every frame). Rebuild = clear a scratch buffer → stamp every instance's oriented box into the
// cells of its dilated AABB with atomicMin (20-bit signed distance | 12-bit albedo, so the nearest surface's
// colour wins) → finalize into one rgba8unorm 3D texture (distance over the ±band, albedo), levels stacked in z
// (8 bits over a 2-cell band is 1/64 cell; half the VRAM of rgba16float, which matters on a crowded 32 GB card).
// Cells outside the narrow band hold +band: a valid lower bound, so sphere tracing stays conservative.
//
// Probes: per level 16×8×16 (32×16×32 on tier 32), toroidally addressed so history survives scrolling.
// Each update traces 128 rays per probe (sphere-traced, the coarser level once the ray is far), shades hits
// with the key light (SDF shadow ray), fill, rim, the strongest 32 point lights (explosion flashes light the
// room) and, on tier 32, the previous probe irradiance at the hit (multi-bounce). Misses see the sky.
// Irradiance is stored as L1 spherical harmonics with an adaptive hysteresis (0.97, dropping when the light
// changes a lot so a blast shows within a few frames).

import { FRAME_WGSL } from './shaders.ts';
import { vramGovernor, type VramKnob } from './vram.ts';

export type GTier = 4 | 8 | 12 | 16 | 32;

interface GiTierCfg { sdf: boolean; n: number; levels: number; probes: boolean; probeLevels: number; pdim: [number, number, number]; stride: number; rays: number; bounce: boolean }

/** RENDERING §7 table + D85: SDF AO from 8 GB, probe GI half rate on 12 GB, full rate on 16 GB, 2× on 32 GB. */
export const GI_TIERS: Record<GTier, GiTierCfg> = {
  4: { sdf: false, n: 64, levels: 4, probes: false, probeLevels: 0, pdim: [16, 8, 16], stride: 8, rays: 64, bounce: false },
  8: { sdf: true, n: 96, levels: 4, probes: false, probeLevels: 0, pdim: [16, 8, 16], stride: 8, rays: 64, bounce: false },
  12: { sdf: true, n: 128, levels: 4, probes: true, probeLevels: 2, pdim: [16, 8, 16], stride: 8, rays: 128, bounce: false },
  16: { sdf: true, n: 128, levels: 4, probes: true, probeLevels: 2, pdim: [16, 8, 16], stride: 4, rays: 128, bounce: false },
  32: { sdf: true, n: 256, levels: 4, probes: true, probeLevels: 3, pdim: [32, 16, 32], stride: 4, rays: 128, bounce: true },
};

const LEVEL0 = 8; // m
const BAND = 2; // cells
const MAX_LEVELS = 4;
const PARAM_BYTES = 272; // + sky (M3 close-out)
const BUILD_SLOTS = 16;

/**
 * WGSL for consumers: declares the GI bindings at `@group(group)` and these functions (world space):
 *   giSdf(p) -> f32                     signed distance to the scene (floor included), 1e3 outside the clipmap
 *   giAlbedo(p) -> vec3f                albedo of the nearest surface
 *   giNormal(p) -> vec3f                SDF gradient
 *   giIrradiance(p, n) -> vec3f         probe GI: diffuse irradiance / π (multiply by albedo); sky ambient fallback
 *   giAo(p, n) -> f32                   SDF ambient occlusion, 1 = open
 *   giSoftShadow(p, l, maxT) -> f32     SDF soft shadow toward unit direction l, 1 = lit
 *   giProbesOn() -> bool
 * Bindings: 0 uniform GiParams, 1 texture_3d<f32> (rgba8unorm: r = distance / band × 0.5 + 0.5, gba = albedo), 2 filtering sampler,
 * 3 storage read probes (4 × vec4f per probe: L1 SH rgb, w = validity / hash).
 */
export function giWgsl(group: number, probesAccess: 'read' | 'read_write' = 'read'): string {
  return /* wgsl */ `
struct GiParams {
  level: array<vec4f, ${MAX_LEVELS}>,   // xyz clip min corner (world), w = cell size (m)
  plevel: array<vec4f, ${MAX_LEVELS}>,  // xyz probe grid min corner (world, integer probe coords × spacing), w = spacing
  pbase: array<vec4i, ${MAX_LEVELS}>,   // xyz integer probe coordinate of plevel (toroidal addressing)
  dims: vec4u,     // x N, y levels, z probe levels, w flags (1 floor, 2 sdf valid, 4 probes on)
  pdims: vec4u,    // probes per axis, w = probes per level
  misc: vec4f,     // x floor y, y band (cells), z frame, w hysteresis
  misc2: vec4u,    // x update stride, y update phase, z rays per probe, w multi-bounce
  sky: vec4f,      // xyz a probe ray's miss radiance inside a set (its IBL's mean), w 1 = use it over the sky
};
@group(${group}) @binding(0) var<uniform> gi: GiParams;
@group(${group}) @binding(1) var giTex: texture_3d<f32>;
@group(${group}) @binding(2) var giSamp: sampler;
@group(${group}) @binding(3) var<storage, ${probesAccess}> giProbes: array<vec4f>;

fn giProbesOn() -> bool { return (gi.dims.w & 4u) != 0u; }

fn giTexAt(k: u32, p: vec3f) -> vec4f {
  let lv = gi.level[k];
  let n = f32(gi.dims.x);
  let m = 1.0 / n;
  let local = clamp((p - lv.xyz) / (lv.w * n), vec3f(m), vec3f(1.0 - m));
  let s = textureSampleLevel(giTex, giSamp, vec3f(local.xy, (f32(k) + local.z) / f32(gi.dims.y)), 0.0);
  return vec4f((s.r * 2.0 - 1.0) * gi.misc.y * lv.w, s.g, s.b, lv.w);
}

/// Distance + albedo from the finest clip level whose cell is at least minCell; w of the result is the
/// level's cell size (0 when no level contains p). Near a level's edge it blends into the next level so
/// consumers see no seam.
fn giSampleLod(p: vec3f, minCell: f32) -> vec4f {
  if ((gi.dims.w & 2u) == 0u) { return vec4f(1e3, 0.5, 0.5, 0.0); }
  let n = f32(gi.dims.x);
  let L = gi.dims.y;
  for (var k = 0u; k < L; k++) {
    let lv = gi.level[k];
    if (lv.w < minCell && k + 1u < L) { continue; }
    let local = (p - lv.xyz) / (lv.w * n);
    let m = 1.0 / n;
    if (all(local > vec3f(m)) && all(local < vec3f(1.0 - m))) {
      var s = giTexAt(k, p);
      let e3 = min(local, 1.0 - local);
      let edge = min(e3.x, min(e3.y, e3.z)) - m;
      if (edge < 0.1 && k + 1u < L) { s = mix(giTexAt(k + 1u, p), s, clamp(edge / 0.1, 0.0, 1.0)); }
      return s;
    }
  }
  return vec4f(1e3, 0.5, 0.5, 0.0);
}

fn giFloor(p: vec3f) -> f32 {
  return select(1e3, p.y - gi.misc.x, (gi.dims.w & 1u) != 0u);
}

fn giSdf(p: vec3f) -> f32 {
  return min(giSampleLod(p, 0.0).x, giFloor(p));
}

fn giSdfLod(p: vec3f, minCell: f32) -> vec2f {
  let s = giSampleLod(p, minCell);
  return vec2f(min(s.x, giFloor(p)), select(s.w, gi.level[0].w, s.w == 0.0));
}

fn giAlbedo(p: vec3f) -> vec3f {
  let n = f32(gi.dims.x);
  let L = gi.dims.y;
  if (giFloor(p) < 0.02 && (gi.dims.w & 1u) != 0u) {
    // the floor's albedo is the renderer's (frame.ground); consumers without the frame get a mid grey
    return vec3f(0.55);
  }
  for (var k = 0u; k < L; k++) {
    let lv = gi.level[k];
    let local = (p - lv.xyz) / (lv.w * n);
    if (all(local > vec3f(0.0)) && all(local < vec3f(1.0))) {
      let s = textureSampleLevel(giTex, giSamp, vec3f(local.xy, (f32(k) + local.z) / f32(L)), 0.0);
      return s.gba;
    }
  }
  return vec3f(0.5);
}

fn giNormal(p: vec3f) -> vec3f {
  let h = max(giSampleLod(p, 0.0).w, 0.01);
  let dx = giSdf(p + vec3f(h, 0.0, 0.0)) - giSdf(p - vec3f(h, 0.0, 0.0));
  let dy = giSdf(p + vec3f(0.0, h, 0.0)) - giSdf(p - vec3f(0.0, h, 0.0));
  let dz = giSdf(p + vec3f(0.0, 0.0, h)) - giSdf(p - vec3f(0.0, 0.0, h));
  let g = vec3f(dx, dy, dz);
  let l = length(g);
  return select(vec3f(0.0, 1.0, 0.0), g / l, l > 1e-6);
}

fn giAo(p: vec3f, n: vec3f) -> f32 {
  if ((gi.dims.w & 2u) == 0u) { return 1.0; }
  let h = max(gi.level[0].w, 0.01);
  var occ = 0.0;
  var w = 0.5;
  for (var i = 1; i <= 5; i++) {
    let d = h * f32(i) * 1.5;
    occ += w * max(0.0, d - giSdf(p + n * d)) / d;
    w *= 0.6;
  }
  return clamp(1.0 - occ * 1.4, 0.0, 1.0);
}

fn giSoftShadow(p: vec3f, l: vec3f, maxT: f32) -> f32 {
  if ((gi.dims.w & 2u) == 0u) { return 1.0; }
  let h = max(gi.level[0].w, 0.01);
  var t = h * 1.5;
  var res = 1.0;
  for (var i = 0; i < 32; i++) {
    let s = giSdfLod(p + l * t, t * 0.05);
    if (s.x < h * 0.15) { return 0.0; }
    res = min(res, 6.0 * s.x / t);
    t += max(s.x, s.y * 0.5);
    if (t > maxT) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

/// Toroidal storage index of an integer probe coordinate on probe level k.
fn giProbeIndex(k: u32, c: vec3i) -> u32 {
  let d = vec3i(gi.pdims.xyz);
  let m = ((c % d) + d) % d;
  return k * gi.pdims.w + u32(m.x + d.x * (m.y + d.y * m.z));
}

fn giShIrradiance(base: u32, n: vec3f) -> vec3f {
  let c0 = giProbes[base].rgb;
  let c1 = giProbes[base + 1u].rgb;
  let c2 = giProbes[base + 2u].rgb;
  let c3 = giProbes[base + 3u].rgb;
  // E(n) / pi with A0 = pi, A1 = 2pi/3, Y00 = 0.282095, Y1m = 0.488603 (y, z, x)
  let e = c0 * 0.282095 + (c1 * n.y + c2 * n.z + c3 * n.x) * (0.488603 * 2.0 / 3.0);
  return max(e, vec3f(0.0));
}

fn giIrradiance(p: vec3f, n: vec3f) -> vec3f {
  if (!giProbesOn()) { return vec3f(-1.0); }
  let d = vec3f(gi.pdims.xyz);
  for (var k = 0u; k < gi.dims.z; k++) {
    let sp = gi.plevel[k].w;
    let g = (p + n * sp * 0.25 - gi.plevel[k].xyz) / sp;
    if (any(g < vec3f(0.0)) || any(g > d - 1.0)) { continue; }
    let g0 = vec3i(floor(g));
    let f = g - vec3f(g0);
    var sum = vec3f(0.0);
    var wsum = 0.0;
    for (var i = 0u; i < 8u; i++) {
      let o = vec3i(i32(i & 1u), i32((i >> 1u) & 1u), i32((i >> 2u) & 1u));
      let tri = mix(1.0 - f, f, vec3f(o));
      let base = giProbeIndex(k, gi.pbase[k].xyz + g0 + o) * 4u;
      let valid = giProbes[base].w;
      let pp = gi.plevel[k].xyz + vec3f(g0 + o) * sp;
      let dir = normalize(pp - p + vec3f(1e-5));
      let bf = (dot(dir, n) + 1.0) * 0.5;
      let w = tri.x * tri.y * tri.z * valid * (bf * bf + 0.05);
      sum += giShIrradiance(base, n) * w;
      wsum += w;
    }
    if (wsum > 1e-4) { return sum / wsum; }
  }
  return vec3f(-1.0);
}
`;
}

const BUILD_WGSL = (n: number): string => /* wgsl */ `
${giWgsl(0)}
struct Inst {
  pos: vec3f, mesh: u32,
  rot: vec4f,
  size: vec3f, color: u32,
  mat: u32, outline: u32, body: i32, radius: f32,
};
struct Build { level: u32, end: u32, run: u32, first: u32, origin: vec4f }; // origin: this build's clip min corner + cell (the params switch at finalize)
@group(1) @binding(0) var<uniform> b: Build;
@group(1) @binding(1) var<storage, read> insts: array<Inst>;
@group(1) @binding(2) var<storage, read> xf: array<f32>;
@group(1) @binding(3) var<storage, read> bounds: array<vec4f>; // per mesh: center, half
@group(1) @binding(4) var<storage, read_write> grid: array<atomic<u32>>;
@group(1) @binding(5) var outTex: texture_storage_3d<rgba8unorm, write>;

const N: u32 = ${n}u;
const BAND: f32 = ${BAND}.0;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn qmul(a: vec4f, c: vec4f) -> vec4f {
  return vec4f(a.w * c.xyz + c.w * a.xyz + cross(a.xyz, c.xyz), a.w * c.w - dot(a.xyz, c.xyz));
}
fn sdBox(p: vec3f, h: vec3f) -> f32 {
  let q = abs(p) - h;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

@compute @workgroup_size(256) fn clear(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 256u;
  if (i < N * N * N) { atomicStore(&grid[i], 0xffffffffu); }
}

@compute @workgroup_size(64) fn stamp(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) li: u32) {
  let i = b.first + wg.x + wg.y * nwg.x;
  if (i >= b.end) { return; }
  let inst = insts[i];
  if ((((inst.mat >> 24u) & 255u) & 1u) != 0u) { return; }
  var pos = inst.pos;
  var rot = inst.rot;
  if (b.run != 0u && inst.body >= 0) {
    let o = u32(inst.body) * 7u;
    let br = vec4f(xf[o + 3u], xf[o + 4u], xf[o + 5u], xf[o + 6u]);
    pos = vec3f(xf[o], xf[o + 1u], xf[o + 2u]) + qrot(br, inst.pos);
    rot = qmul(br, inst.rot);
  }
  let mc = bounds[inst.mesh * 2u].xyz;
  let mh = bounds[inst.mesh * 2u + 1u].xyz;
  let size = abs(inst.size);
  let c = pos + qrot(rot, mc * size);
  let h = max(mh * size, vec3f(0.002));
  // R5 (M5): a rounded box (MeshInfo.round: a sphere stamps as a sphere), so round parts don't sit in their own corners
  let rr = clamp(bounds[inst.mesh * 2u].w, 0.0, 1.0) * min(h.x, min(h.y, h.z));
  // world AABB of the oriented box
  let ax = qrot(rot, vec3f(1.0, 0.0, 0.0));
  let ay = qrot(rot, vec3f(0.0, 1.0, 0.0));
  let az = qrot(rot, vec3f(0.0, 0.0, 1.0));
  let e = abs(ax) * h.x + abs(ay) * h.y + abs(az) * h.z;
  let lv = b.origin;
  let cell = lv.w;
  // parts much smaller than a coarse level's cell don't change its field (Domino Day's 100k tiles on levels 2–3)
  if (b.level > 0u && max(h.x, max(h.y, h.z)) < cell * 0.25) { return; }
  let lo = vec3i(floor((c - e - lv.xyz) / cell - BAND));
  let hi = vec3i(ceil((c + e - lv.xyz) / cell + BAND));
  let lo2 = max(lo, vec3i(0));
  let hi2 = min(hi, vec3i(i32(N) - 1));
  if (any(hi2 < lo2)) { return; }
  let span = vec3u(hi2 - lo2 + 1);
  let cells = span.x * span.y * span.z;
  let band = BAND * cell;
  let col = unpack4x8unorm(inst.color);
  let a12 = (u32(col.r * 15.0 + 0.5) << 8u) | (u32(col.g * 15.0 + 0.5) << 4u) | u32(col.b * 15.0 + 0.5);
  for (var k = li; k < cells; k += 64u) {
    let cx = k % span.x;
    let cy = (k / span.x) % span.y;
    let cz = k / (span.x * span.y);
    let cc = vec3i(lo2) + vec3i(vec3u(cx, cy, cz));
    let p = lv.xyz + (vec3f(cc) + 0.5) * cell;
    let d = p - c;
    let local = vec3f(dot(d, ax), dot(d, ay), dot(d, az));
    let sd = sdBox(local, h - vec3f(rr)) - rr;
    if (sd > band) { continue; }
    let q = u32(clamp((sd / band) * 0.5 + 0.5, 0.0, 1.0) * 1048574.0);
    atomicMin(&grid[u32(cc.x) + N * (u32(cc.y) + N * u32(cc.z))], (q << 12u) | a12);
  }
}

@compute @workgroup_size(4, 4, 4) fn finalize(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid >= vec3u(N))) { return; }
  let v = atomicLoad(&grid[gid.x + N * (gid.y + N * gid.z)]);
  let cell = b.origin.w;
  let band = BAND * cell;
  var d = band;
  var alb = vec3f(0.5);
  if (v != 0xffffffffu) {
    d = (f32(v >> 12u) / 1048574.0 * 2.0 - 1.0) * band;
    // stored as sRGB-ish 4 bits: decode with the parts' pow 2.2
    alb = pow(vec3f(f32((v >> 8u) & 15u), f32((v >> 4u) & 15u), f32(v & 15u)) / 15.0, vec3f(2.2));
  }
  textureStore(outTex, vec3u(gid.x, gid.y, gid.z + b.level * N), vec4f(clamp(d / band * 0.5 + 0.5, 0.0, 1.0), alb));
}
`;

const PROBE_WGSL = (rays: number): string => /* wgsl */ `
${FRAME_WGSL}
${giWgsl(0, 'read_write')}
@group(1) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var<storage, read> lights: array<Light>;

const RAYS: u32 = ${rays}u;
var<workgroup> s0: array<vec3f, ${rays}>;
var<workgroup> s1: array<vec3f, ${rays}>;
var<workgroup> s2: array<vec3f, ${rays}>;
var<workgroup> s3: array<vec3f, ${rays}>;

fn hash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn skyRadiance(d: vec3f) -> vec3f {
  // inside a set a miss sees the room (walls, ceiling, windows: not in the SDF), not open sky
  if (gi.sky.w > 0.5) { return gi.sky.rgb; }
  return mix(frame.horizon.rgb, frame.skyTop.rgb, smoothstep(-0.02, 0.7, d.y));
}

/// Sphere trace; returns (t, cell) at a hit, t < 0 for a miss.
fn trace(o: vec3f, d: vec3f, maxT: f32) -> vec2f {
  var t = 0.0;
  for (var i = 0; i < 96; i++) {
    let p = o + d * t;
    let s = giSdfLod(p, t * 0.04);
    if (s.x >= 1e2) { return vec2f(-1.0, 0.0); }
    if (s.x < s.y * 0.2) { return vec2f(t, s.y); }
    t += max(s.x, s.y * 0.35);
    if (t > maxT) { break; }
  }
  return vec2f(-1.0, 0.0);
}

fn hitAlbedo(p: vec3f) -> vec3f {
  if ((gi.dims.w & 1u) != 0u && giFloor(p) < giSampleLod(p, 0.0).x) { return frame.ground.rgb; }
  return giAlbedo(p);
}

@compute @workgroup_size(${rays}) fn trace_probes(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) li: u32) {
  let perLevel = gi.pdims.w;
  let stride = gi.misc2.x;
  let slot = (wg.x + wg.y * nwg.x) * stride + gi.misc2.y;
  if (slot >= perLevel * gi.dims.z) { return; }
  let k = slot / perLevel;
  let local = slot % perLevel;
  let pd = vec3i(gi.pdims.xyz);
  // local = a position in the level's window (not toroidal): window coordinate → global coordinate
  let wc = vec3i(i32(local) % pd.x, (i32(local) / pd.x) % pd.y, i32(local) / (pd.x * pd.y));
  let gc = gi.pbase[k].xyz + wc;
  let sp = gi.plevel[k].w;
  let pp = gi.plevel[k].xyz + vec3f(wc) * sp;
  let base = giProbeIndex(k, gc) * 4u;

  // ray direction: spherical Fibonacci, rotated per frame
  var h = hash(li * 9781u + u32(gi.misc.z) * 6271u + slot * 13u);
  let fi = f32(li) + 0.5;
  let cz = 1.0 - 2.0 * fi / f32(RAYS);
  let sz = sqrt(max(0.0, 1.0 - cz * cz));
  let ph = fi * 2.39996323 + f32(h & 1023u) / 1023.0 * 6.2831853;
  let d = vec3f(cos(ph) * sz, cz, sin(ph) * sz);

  let maxT = sp * f32(pd.x) * 0.75;
  let hit = trace(pp, d, maxT);
  var L = vec3f(0.0);
  if (hit.x < 0.0) {
    L = skyRadiance(d);
  } else {
    let p = pp + d * hit.x;
    let n = giNormal(p);
    let alb = hitAlbedo(p);
    let lit = p + n * hit.y * 0.6;
    var E = vec3f(0.0);
    let kl = frame.key.xyz;
    let ndl = dot(n, kl);
    if (ndl > 0.0) {
      let sh = trace(lit, kl, sp * 8.0);
      if (sh.x < 0.0) { E += frame.keyColor.rgb * frame.key.w * ndl; }
    }
    E += frame.keyColor.rgb * frame.fill.w * max(dot(n, frame.fill.xyz), 0.0);
    E += frame.rimColor.rgb * frame.rim.w * max(dot(n, frame.rim.xyz), 0.0);
    let nl = min(frame.hover.z, 32u);
    for (var j = 0u; j < nl; j++) {
      let lp = lights[j];
      let dl = lp.pos.xyz - p;
      let dist = length(dl);
      if (dist < lp.pos.w) {
        let att = pow(1.0 - dist / lp.pos.w, 2.0);
        E += lp.color.rgb * att * max(dot(n, dl / max(dist, 1e-4)), 0.0);
      }
    }
    var bounce = vec3f(0.0);
    if (gi.misc2.w != 0u) {
      let ir = giIrradiance(p, n);
      if (ir.x >= 0.0) { bounce = ir; }
    }
    L = alb * (E / 3.14159265 + bounce);
  }
  // project onto L1 SH (Monte Carlo over the sphere: 4 pi / RAYS)
  let wgt = 12.5663706 / f32(RAYS);
  s0[li] = L * 0.282095 * wgt;
  s1[li] = L * 0.488603 * d.y * wgt;
  s2[li] = L * 0.488603 * d.z * wgt;
  s3[li] = L * 0.488603 * d.x * wgt;
  workgroupBarrier();
  for (var st = RAYS / 2u; st > 0u; st >>= 1u) {
    if (li < st) {
      s0[li] += s0[li + st]; s1[li] += s1[li + st]; s2[li] += s2[li + st]; s3[li] += s3[li + st];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    let valid = select(1.0, 0.0, giSdf(pp) < -sp * 0.05);
    let tag = f32((gc.x & 1023) | ((gc.y & 1023) << 10)) + f32(gc.z & 255) * 1048576.0;
    let old0 = giProbes[base];
    let fresh = giProbes[base + 1u].w != tag;
    var hy = gi.misc.w;
    let oldL = dot(old0.rgb, vec3f(0.3, 0.6, 0.1));
    let newL = dot(s0[0], vec3f(0.3, 0.6, 0.1));
    // a big change (an explosion flash, a part moving away) lowers the hysteresis so it shows quickly
    let ratio = (max(oldL, newL) + 1e-3) / (min(oldL, newL) + 1e-3);
    hy = select(hy, hy * 0.6, ratio > 1.6);
    hy = select(hy, 0.0, fresh);
    giProbes[base] = vec4f(mix(s0[0], old0.rgb, hy), valid);
    giProbes[base + 1u] = vec4f(mix(s1[0], giProbes[base + 1u].rgb, hy), tag);
    giProbes[base + 2u] = vec4f(mix(s2[0], giProbes[base + 2u].rgb, hy), 0.0);
    giProbes[base + 3u] = vec4f(mix(s3[0], giProbes[base + 3u].rgb, hy), 0.0);
  }
}
`;

/** The debug view (?gi=sdf | ?gi=gi): the scene sphere-traced through the global SDF. */
const DEBUG_WGSL = /* wgsl */ `
${FRAME_WGSL}
${giWgsl(1)}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> mode: vec4u;
struct VO { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VO;
  o.clip = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let a = frame.invViewProj * vec4f(i.ndc, 0.0, 1.0);
  let b = frame.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let d = normalize(b.xyz / b.w - a.xyz / a.w);
  let o = frame.eye.xyz;
  var t = 0.02;
  var hit = false;
  var steps = 0;
  for (var k = 0; k < 160; k++) {
    let s = giSdfLod(o + d * t, t * 0.01);
    steps = k;
    if (s.x >= 1e2) { break; }
    if (s.x < s.y * 0.1) { hit = true; break; }
    t += max(s.x, s.y * 0.3);
    if (t > 600.0) { break; }
  }
  if (!hit) { return vec4f(mix(frame.horizon.rgb, frame.skyTop.rgb, smoothstep(-0.02, 0.7, d.y)) * 0.6, 1.0); }
  let p = o + d * t;
  let n = giNormal(p);
  var alb = giAlbedo(p);
  if ((gi.dims.w & 1u) != 0u && giFloor(p) < giSampleLod(p, 0.0).x) { alb = frame.ground.rgb; }
  if (mode.x == 2u) {
    let ir = giIrradiance(p, n);
    return vec4f(alb * max(ir, vec3f(0.0)) * 1.5, 1.0);
  }
  let lit = max(dot(n, frame.key.xyz), 0.0) * 0.8 + 0.2;
  return vec4f(alb * lit * giAo(p, n) + vec3f(f32(steps) / 160.0, 0.0, 0.0) * 0.3, 1.0);
}
`;

export interface GiScene {
  readonly inst: GPUBuffer;
  readonly xf: GPUBuffer;
  readonly count: number;
  readonly run: boolean;
}

/** Global SDF clipmap + probe GI. Created by the renderer at init; `update` runs in the frame's compute. */
export class Gi {
  /** The tier's config, or the VRAM governor's reduced one (M4 V4: `reconfigure`). */
  cfg: GiTierCfg;
  readonly layout: GPUBindGroupLayout;
  bindGroup!: GPUBindGroup;
  /** On by default from 12 GB (D79); switchable (Settings, the live governor). */
  probesOn: boolean;
  /** Master switch (benchmarks, the governor): off = no SDF, no probes, consumers get their fallbacks. */
  enabled = true;
  /** 'off' | 'sdf' | 'gi': the debug view replaces the frame with the sphere-traced SDF. */
  debug: 'off' | 'sdf' | 'gi' = 'off';
  stats = { levelsBuilt: 0, probesTraced: 0 };
  private readonly device: GPUDevice;
  private n: number;
  private readonly params: GPUBuffer;
  private tex: GPUTexture;
  private readonly sampler: GPUSampler;
  private probes: GPUBuffer;
  private scratch: GPUBuffer;
  private readonly buildRing: GPUBuffer;
  private buildBind: GPUBindGroup | null = null;
  private buildBindKey: { inst: GPUBuffer | null; xf: GPUBuffer | null; bounds: GPUBuffer | null } = { inst: null, xf: null, bounds: null };
  private job: { k: number; o: [number, number, number]; next: number; count: number; run: boolean; version: number; statics: boolean } | null = null;
  /** The set's static boxes (setStatic), stamped after the instances: Inst records, unit-box bounds. */
  private statics: { inst: GPUBuffer; bounds: GPUBuffer; count: number; bind: GPUBindGroup | null; xf: GPUBuffer | null } | null = null;
  /** Instances stamped per frame across all builds (tier 32's 256³ levels cost more per instance). */
  stampBudget: number;
  private bounds: GPUBuffer;
  private boundsCount = 0;
  private pipes: { clear: GPUComputePipeline; stamp: GPUComputePipeline; finalize: GPUComputePipeline; probes: GPUComputePipeline | null };
  private readonly buildLayout: GPUBindGroupLayout;
  private probeBind1: GPUBindGroup | null;
  private readonly writeLayout: GPUBindGroupLayout;
  private writeBind: GPUBindGroup;
  private debugPipe: GPURenderPipeline | null = null;
  private debugBind: GPUBindGroup | null = null;
  private readonly debugMode: GPUBuffer;
  private origins: [number, number, number][] = [];
  private built: boolean[] = [];
  private builtVersion: number[] = [];
  private lastBuilt: number[] = [0, 0, 0, 0];
  private version = 1;
  private frameNo = 0;
  private floorOn = true;
  /** Height of the analytic floor (world y): the Studio's y = 0, or the set's floor (setStatic). */
  private floorY = 0;
  /** A probe ray's miss radiance inside a set (engine units; the renderer sets it from the set IBL), else the sky. */
  missRadiance: readonly number[] | null = null;
  private sdfValid = false;
  private readonly levels: number;

  constructor(device: GPUDevice, tier: GTier, frameBuf: GPUBuffer, lightBuf: GPUBuffer, private readonly colorFormat: GPUTextureFormat, private readonly msaa: number) {
    this.device = device;
    this.cfg = GI_TIERS[tier] ?? GI_TIERS[16];
    this.n = this.cfg.n;
    this.levels = this.cfg.levels;
    this.probesOn = this.cfg.probes;
    const n = this.n, L = this.levels;
    this.params = device.createBuffer({ label: 'gi.params', size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.tex = device.createTexture({
      label: 'gi.sdf', size: [n, n, n * L], dimension: '3d', format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    const pcount = Math.max(1, this.cfg.probeLevels) * this.cfg.pdim[0] * this.cfg.pdim[1] * this.cfg.pdim[2];
    this.probes = device.createBuffer({ label: 'gi.probes', size: pcount * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.scratch = device.createBuffer({ label: 'gi.scratch', size: this.cfg.sdf ? n * n * n * 4 : 16, usage: GPUBufferUsage.STORAGE });
    this.buildRing = device.createBuffer({ label: 'gi.build', size: BUILD_SLOTS * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.stampBudget = n >= 256 ? 16_000 : 60_000;
    this.bounds = device.createBuffer({ size: 32 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.debugMode = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const C = GPUShaderStage.COMPUTE, F = GPUShaderStage.FRAGMENT, V = GPUShaderStage.VERTEX;
    // the consumers' layout (read-only probes): fragment + compute + vertex
    this.layout = device.createBindGroupLayout({
      label: 'gi.layout',
      entries: [
        { binding: 0, visibility: C | F | V, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C | F | V, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: C | F | V, sampler: { type: 'filtering' } },
        { binding: 3, visibility: C | F | V, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.writeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: C, sampler: { type: 'filtering' } },
        { binding: 3, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    this.bindGroup = device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: this.tex.createView() },
        { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.probes } },
      ],
    });
    this.writeBind = device.createBindGroup({
      layout: this.writeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: this.tex.createView() },
        { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.probes } },
      ],
    });
    this.buildLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: C, buffer: { type: 'storage' } },
        { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
      ],
    });
    const bmod = device.createShaderModule({ code: BUILD_WGSL(n), label: 'gi.build' });
    const bpl = device.createPipelineLayout({ bindGroupLayouts: [this.layout, this.buildLayout] });
    const mk = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: bpl, compute: { module: bmod, entryPoint } });
    let probesPipe: GPUComputePipeline | null = null;
    let probeBind1: GPUBindGroup | null = null;
    if (this.cfg.probes) {
      const pl1 = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } }],
      });
      const pmod = device.createShaderModule({ code: PROBE_WGSL(this.cfg.rays), label: 'gi.probes' });
      probesPipe = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [this.writeLayout, pl1] }), compute: { module: pmod, entryPoint: 'trace_probes' } });
      probeBind1 = device.createBindGroup({ layout: pl1, entries: [{ binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: lightBuf } }] });
      this.probeL1 = pl1;
    }
    this.pipes = { clear: mk('clear'), stamp: mk('stamp'), finalize: mk('finalize'), probes: probesPipe };
    this.probeBind1 = probeBind1;
    this.frameBufRef = frameBuf;
    for (let k = 0; k < L; k++) { this.origins.push([1e9, 1e9, 1e9]); this.built.push(false); this.builtVersion.push(0); }
    if (this.cfg.sdf) this.prime();
    // M4 (V4): the VRAM governor's 'gi' knob (full, half resolution, off)
    this.base = this.cfg;
    const b = this.base;
    const half: Partial<GiTierCfg> = { n: Math.max(64, b.n / 2), pdim: b.pdim[0] > 16 ? [16, 8, 16] : b.pdim, probeLevels: Math.min(b.probeLevels, 2) };
    const bytesOf = (c: GiTierCfg): number => (c.sdf ? c.n ** 3 * this.levels * 4 + c.n ** 3 * 4 : 0) + Math.max(1, c.probeLevels) * c.pdim[0] * c.pdim[1] * c.pdim[2] * 64;
    const cfgOf = (l: number): GiTierCfg => (l === 0 ? b : l === 1 ? { ...b, ...half } : { ...b, sdf: false, probes: false, n: 16 });
    this.knob = {
      name: 'gi', levels: ['full', '½', 'off'], level: 0,
      set: (l) => { this.knob.level = l; this.reconfigure(cfgOf(l)); },
      saves: (l) => (b.sdf ? bytesOf(b) - bytesOf(cfgOf(l)) : 0),
    };
    vramGovernor.register(this.knob);
  }
  private readonly frameBufRef: GPUBuffer;
  private probeL1: GPUBindGroupLayout | null = null;
  /** M4 (V4): the tier's config (the knob's level 0). */
  private readonly base: GiTierCfg;
  private readonly knob: VramKnob;

  /**
   * M4 (V4): rebuilds the clipmap, scratch, probes and build pipelines for `cfg` (same levels; the layouts and
   * so every consumer's bind group layout are unchanged). Every level is rebuilt over the next frames.
   */
  reconfigure(cfg: GiTierCfg): void {
    if (cfg === this.cfg) return;
    const d = this.device;
    this.tex.destroy();
    this.probes.destroy();
    this.scratch.destroy();
    this.cfg = cfg;
    this.n = cfg.n;
    const n = this.n, L = this.levels;
    this.tex = d.createTexture({ label: 'gi.sdf', size: [n, n, n * L], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    const pcount = Math.max(1, cfg.probeLevels) * cfg.pdim[0] * cfg.pdim[1] * cfg.pdim[2];
    this.probes = d.createBuffer({ label: 'gi.probes', size: pcount * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.scratch = d.createBuffer({ label: 'gi.scratch', size: cfg.sdf ? n * n * n * 4 : 16, usage: GPUBufferUsage.STORAGE });
    this.stampBudget = n >= 256 ? 16_000 : 60_000;
    const entries = (): GPUBindGroupEntry[] => [
      { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: this.tex.createView() },
      { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.probes } },
    ];
    this.bindGroup = d.createBindGroup({ label: 'gi.bind', layout: this.layout, entries: entries() });
    this.writeBind = d.createBindGroup({ layout: this.writeLayout, entries: entries() });
    const bmod = d.createShaderModule({ code: BUILD_WGSL(n), label: 'gi.build' });
    const bpl = d.createPipelineLayout({ bindGroupLayouts: [this.layout, this.buildLayout] });
    const mk = (entryPoint: string): GPUComputePipeline => d.createComputePipeline({ layout: bpl, compute: { module: bmod, entryPoint } });
    let probes: GPUComputePipeline | null = null;
    if (cfg.probes && this.probeL1) {
      const pmod = d.createShaderModule({ code: PROBE_WGSL(cfg.rays), label: 'gi.probes' });
      probes = d.createComputePipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.writeLayout, this.probeL1] }), compute: { module: pmod, entryPoint: 'trace_probes' } });
    }
    this.pipes = { clear: mk('clear'), stamp: mk('stamp'), finalize: mk('finalize'), probes };
    this.noTexBind = null;
    this.buildBind = null;
    this.buildBindKey = { inst: null, xf: null, bounds: null };
    if (this.statics) this.statics.bind = null;
    this.job = null;
    this.built = this.built.map(() => false);
    this.origins = this.origins.map(() => [1e9, 1e9, 1e9]);
    this.sdfValid = false;
    if (cfg.sdf) this.prime();
    else this.device.queue.writeBuffer(this.probes, 0, new Uint8Array(64));
    this.writeParams();
  }

  /** Stops answering the VRAM governor (device loss replaced this instance). */
  dispose(): void { vramGovernor.unregister(this.knob); }

  private lastStatic: { boxes: Parameters<Gi['setStatic']>[0]; floorY: number } | null = null;

  /** M4 (V4): takes over a lost device's Gi settings (switches, floor, the set's static boxes). */
  restoreFrom(old: Gi): void {
    this.probesOn = old.probesOn;
    this.enabled = old.enabled;
    this.debug = old.debug;
    this.missRadiance = old.missRadiance;
    this.floorOn = old.floorOn;
    if (old.lastStatic) this.setStatic(old.lastStatic.boxes, old.lastStatic.floorY);
  }

  /**
   * At init (behind the loading screen): touch the scratch buffer and every texel of the clipmap once. The first
   * write to these fresh allocations (512 MB + 64 MB on tier 32) cost a 15 ms GPU frame when it happened in play.
   */
  private prime(): void {
    const d = this.device, n = this.n;
    const groups = Math.ceil((n * n * n) / 256);
    const dummy = d.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE });
    const bind = d.createBindGroup({
      layout: this.buildLayout,
      entries: [
        { binding: 0, resource: { buffer: this.buildRing, size: 32 } }, { binding: 1, resource: { buffer: dummy } },
        { binding: 2, resource: { buffer: dummy } }, { binding: 3, resource: { buffer: dummy } },
        { binding: 4, resource: { buffer: this.scratch } }, { binding: 5, resource: this.tex.createView() },
      ],
    });
    const ring = new ArrayBuffer(this.levels * 256);
    for (let k = 0; k < this.levels; k++) {
      new Uint32Array(ring, k * 256, 4).set([k, 0, 0, 0]);
      new Float32Array(ring, k * 256 + 16, 4).set([0, 0, 0, (LEVEL0 * 4 ** k) / n]);
    }
    d.queue.writeBuffer(this.buildRing, 0, ring);
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (let k = 0; k < this.levels; k++) {
      pass.setBindGroup(0, this.bindGroupNoTex);
      pass.setBindGroup(1, bind, [k * 256]);
      pass.setPipeline(this.pipes.clear);
      pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
      pass.setPipeline(this.pipes.finalize);
      pass.dispatchWorkgroups(n / 4, n / 4, n / 4);
    }
    pass.end();
    enc.clearBuffer(this.probes);
    d.queue.submit([enc.finish()]);
  }

  /** The scene's instances changed (setScene): every level rebuilds. */
  sceneChanged(): void { this.version++; }

  /** The Studio's analytic floor (y = 0) joins the SDF when on. */
  setFloor(on: boolean): void { if (on !== this.floorOn) { this.floorOn = on; } }

  /**
   * An environment set's static geometry (M3 close-out, D79 side-by-side): its collider boxes (axis-aligned,
   * world space) join the SDF after the instances, and the analytic floor moves to the set's floor height.
   * Before this the SDF held only parts with the floor at y = 0, which in the Tinker Lab Desk preset is the
   * bench top: everything under the bench sat "inside" the floor and fell back to unoccluded IBL.
   * Room-sized boxes (any half extent over 3 m: the floor slab, long walls) are skipped; a box's stamp loops
   * over its cells, and the analytic floor stands in for the slab. `[]` with y 0 restores the Studio.
   */
  setStatic(boxes: readonly { center: readonly number[]; half: readonly number[]; albedo?: readonly number[] }[], floorY: number): void {
    this.lastStatic = { boxes, floorY }; // M4 (V4): replayed onto a rebuilt Gi after device loss
    this.floorY = floorY;
    const keep = boxes.filter((b) => Math.max(b.half[0]!, b.half[1]!, b.half[2]!) <= 3);
    this.statics?.inst.destroy();
    this.statics?.bounds.destroy();
    this.statics = null;
    if (keep.length) {
      // Inst (BUILD_WGSL): pos, mesh | rot | size, color | mat, outline, body, radius = 16 words
      const buf = new ArrayBuffer(keep.length * 64);
      const f = new Float32Array(buf), u = new Uint32Array(buf), s = new Int32Array(buf);
      keep.forEach((b, i) => {
        const o = i * 16;
        f.set([b.center[0]!, b.center[1]!, b.center[2]!], o);
        u[o + 3] = 0; // mesh 0 of the statics' bounds: the unit box
        f.set([0, 0, 0, 1], o + 4);
        f.set([b.half[0]!, b.half[1]!, b.half[2]!], o + 8);
        const a = b.albedo ?? [0.5, 0.5, 0.5];
        u[o + 11] = (Math.round(a[0]! * 255) | (Math.round(a[1]! * 255) << 8) | (Math.round(a[2]! * 255) << 16) | (255 << 24)) >>> 0;
        u[o + 12] = 0; u[o + 13] = 0; s[o + 14] = -1; f[o + 15] = 0;
      });
      const d = this.device;
      const inst = d.createBuffer({ size: buf.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(inst, 0, buf);
      const bounds = d.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(bounds, 0, new Float32Array([0, 0, 0, 0, 1, 1, 1, 0]));
      this.statics = { inst, bounds, count: keep.length, bind: null, xf: null };
    }
    this.version++;
  }

  /** Per-mesh bounds (center, half) from the renderer's mesh library. */
  setMeshBounds(meshes: readonly { center: readonly number[]; half?: readonly number[]; radius: number; round?: number }[]): void {
    if (meshes.length === this.boundsCount) return;
    const a = new Float32Array(Math.max(1, meshes.length) * 8);
    meshes.forEach((m, i) => {
      const h = m.half ?? [m.radius, m.radius, m.radius];
      // R5 (M5): w = the hull's roundness (meshes.ts MeshInfo.round); no half (a sphere stand-in) is round
      a.set([m.center[0]!, m.center[1]!, m.center[2]!, m.half ? m.round ?? 0 : 1, h[0]!, h[1]!, h[2]!, 0], i * 8);
    });
    if (a.byteLength > this.bounds.size) {
      this.bounds.destroy();
      this.bounds = this.device.createBuffer({ size: a.byteLength * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    this.device.queue.writeBuffer(this.bounds, 0, a);
    this.boundsCount = meshes.length;
    this.version++;
  }

  /** Records this frame's clipmap rebuilds and probe updates. `focus` = the camera target (world). */
  update(pass: GPUComputePassEncoder, scene: GiScene, focus: readonly number[]): void {
    this.frameNo++;
    const cfg = this.cfg;
    if (!cfg.sdf || !this.enabled) { this.sdfValid = false; this.built = this.built.map(() => false); this.writeParams(); return; }
    const n = this.n, L = this.levels;
    // which levels to rebuild this frame
    const todo: number[] = [];
    const want: [number, number, number][] = [];
    for (let k = 0; k < L; k++) {
      const cell = (LEVEL0 * 4 ** k) / n;
      const snap = cell * 4;
      const o: [number, number, number] = [0, 1, 2].map((a) => Math.floor((focus[a]! - (n * cell) / 2) / snap) * snap) as [number, number, number];
      const moved = o.some((v, a) => v !== this.origins[k]![a]);
      const rate = 1 << k; // run: level 0 every frame, 1 every 2nd, 2 every 4th, 3 every 8th
      const dyn = scene.run && (this.frameNo + k) % rate === 0;
      want[k] = o;
      if (moved || this.builtVersion[k] !== this.version || dyn || !this.built[k]) todo.push(k);
    }
    // Builds run as jobs with a per-frame instance budget (a 100k-part world never stalls a frame): clear the
    // scratch, stamp `stampBudget` instances a frame into it, finalize into the texture, then switch that level's
    // origin in the params. One job at a time; level 0 first, then the stalest level.
    this.stats.levelsBuilt = 0;
    const groups = Math.ceil((n * n * n) / 256);
    const icount = scene.count;
    let budget = this.stampBudget;
    let slot = 0;
    // a new instance count invalidates the job's ranges; a same-size rebuild just keeps going (the level stays
    // marked with the job's starting version, so it is queued again)
    if (this.job && this.job.count !== icount) this.job = null;
    const bind = (): GPUBindGroup => {
      if (this.buildBindKey.inst !== scene.inst || this.buildBindKey.xf !== scene.xf || this.buildBindKey.bounds !== this.bounds || !this.buildBind) {
        this.buildBind = this.device.createBindGroup({
          layout: this.buildLayout,
          entries: [
            { binding: 0, resource: { buffer: this.buildRing, size: 32 } }, { binding: 1, resource: { buffer: scene.inst } },
            { binding: 2, resource: { buffer: scene.xf } }, { binding: 3, resource: { buffer: this.bounds } },
            { binding: 4, resource: { buffer: this.scratch } }, { binding: 5, resource: this.tex.createView() },
          ],
        });
        this.buildBindKey = { inst: scene.inst, xf: scene.xf, bounds: this.bounds };
      }
      return this.buildBind;
    };
    const staticBind = (): GPUBindGroup => {
      const st = this.statics!;
      if (!st.bind || st.xf !== scene.xf) {
        st.bind = this.device.createBindGroup({
          layout: this.buildLayout,
          entries: [
            { binding: 0, resource: { buffer: this.buildRing, size: 32 } }, { binding: 1, resource: { buffer: st.inst } },
            { binding: 2, resource: { buffer: scene.xf } }, { binding: 3, resource: { buffer: st.bounds } },
            { binding: 4, resource: { buffer: this.scratch } }, { binding: 5, resource: this.tex.createView() },
          ],
        });
        st.xf = scene.xf;
      }
      return st.bind;
    };
    const ring = new ArrayBuffer(BUILD_SLOTS * 256);
    const go = (pipe: GPUComputePipeline, first: number, end: number, x: number, y: number, z = 1, statics = false): boolean => {
      if (slot >= BUILD_SLOTS) return false;
      const j = this.job!;
      const u = new Uint32Array(ring, slot * 256, 4), f = new Float32Array(ring, slot * 256 + 16, 4);
      // statics never ride bodies: run 0 keeps the stamp from reading body transforms
      u.set([j.k, end, j.run && !statics ? 1 : 0, first]);
      f.set([j.o[0], j.o[1], j.o[2], (LEVEL0 * 4 ** j.k) / n]);
      pass.setBindGroup(0, this.bindGroupNoTex);
      pass.setBindGroup(1, statics ? staticBind() : bind(), [slot * 256]);
      pass.setPipeline(pipe);
      pass.dispatchWorkgroups(x, y, z);
      slot++;
      return true;
    };
    while (budget > 0 && slot < BUILD_SLOTS - 2) {
      if (!this.job) {
        // unbuilt levels first (finest first), then the most overdue by its run rate (level k wants every 2^k frames)
        const due = (k: number): number => (this.built[k] ? (this.frameNo - this.lastBuilt[k]!) / (1 << k) : 1e9 - k);
        const next = todo.length ? todo.reduce((a, b) => (due(b) > due(a) ? b : a)) : undefined;
        if (next === undefined) break;
        todo.splice(todo.indexOf(next), 1);
        this.job = { k: next, o: want[next]!, next: 0, count: icount, run: scene.run, version: this.version, statics: false };
        go(this.pipes.clear, 0, 0, Math.min(groups, 65535), Math.ceil(groups / 65535));
      }
      const j = this.job;
      const m = Math.min(budget, j.count - j.next);
      if (m > 0) {
        go(this.pipes.stamp, j.next, j.next + m, Math.min(m, 65535), Math.ceil(m / 65535));
        j.next += m;
        budget -= m;
      }
      if (j.next >= j.count && !j.statics && this.statics) {
        // the set's boxes, once per build (a few hundred, cheap next to the instance budget)
        const sc = this.statics.count;
        if (!go(this.pipes.stamp, 0, sc, Math.min(sc, 65535), Math.ceil(sc / 65535), 1, true)) break;
        j.statics = true;
        budget -= sc;
      }
      if (j.next >= j.count) {
        go(this.pipes.finalize, 0, 0, n / 4, n / 4, n / 4);
        this.origins[j.k] = j.o;
        this.built[j.k] = true;
        this.builtVersion[j.k] = j.version;
        this.lastBuilt[j.k] = this.frameNo;
        this.stats.levelsBuilt++;
        this.job = null;
        budget -= Math.max(1, icount >> 3); // a finalize costs about an eighth of a full stamp: at most ~2 levels a frame
      }
    }
    if (slot) this.device.queue.writeBuffer(this.buildRing, 0, ring, 0, slot * 256);
    this.sdfValid = this.built[0]!;
    this.writeParams();
    // probes
    this.stats.probesTraced = 0;
    if (this.pipes.probes && this.probesOn && this.sdfValid) {
      const per = cfg.pdim[0] * cfg.pdim[1] * cfg.pdim[2];
      const total = per * cfg.probeLevels;
      const count = Math.ceil(total / cfg.stride);
      pass.setPipeline(this.pipes.probes);
      pass.setBindGroup(0, this.writeBind);
      pass.setBindGroup(1, this.probeBind1!);
      pass.dispatchWorkgroups(Math.min(count, 65535), Math.ceil(count / 65535));
      this.stats.probesTraced = count;
    }
  }

  /** Build passes can't sample the texture they write: a bind group with the params and probes only. */
  private get bindGroupNoTex(): GPUBindGroup {
    if (!this.noTexBind) {
      const dummy = this.device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
      this.noTexBind = this.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: dummy.createView() },
          { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.probes } },
        ],
      });
    }
    return this.noTexBind;
  }
  private noTexBind: GPUBindGroup | null = null;

  private writeParams(): void {
    const cfg = this.cfg, n = this.n;
    const b = new ArrayBuffer(PARAM_BYTES);
    const f = new Float32Array(b), u = new Uint32Array(b), i = new Int32Array(b);
    for (let k = 0; k < MAX_LEVELS; k++) {
      const cell = (LEVEL0 * 4 ** k) / n;
      const o = this.origins[k] ?? [0, 0, 0];
      f.set([o[0], o[1], o[2], cell], k * 4);
      // probe window: the clip level's xz, centred vertically on the clip centre
      const sp = (LEVEL0 * 4 ** k) / cfg.pdim[0];
      const cx = o[0] + (n * cell) / 2, cy = o[1] + (n * cell) / 2, cz = o[2] + (n * cell) / 2;
      const base = [Math.floor(cx / sp - cfg.pdim[0] / 2 + 0.5), Math.floor(cy / sp - cfg.pdim[1] / 2 + 0.5), Math.floor(cz / sp - cfg.pdim[2] / 2 + 0.5)];
      f.set([base[0]! * sp, base[1]! * sp, base[2]! * sp, sp], 16 + k * 4);
      i.set([base[0]!, base[1]!, base[2]!, 0], 32 + k * 4);
    }
    const flags = (this.floorOn ? 1 : 0) | (this.sdfValid ? 2 : 0) | (this.probesOn && cfg.probes && this.sdfValid ? 4 : 0);
    u.set([n, this.levels, cfg.probeLevels, flags], 48);
    u.set([cfg.pdim[0], cfg.pdim[1], cfg.pdim[2], cfg.pdim[0] * cfg.pdim[1] * cfg.pdim[2]], 52);
    f.set([this.floorY, BAND, this.frameNo, 0.97], 56);
    u.set([cfg.stride, this.frameNo % cfg.stride, cfg.rays, cfg.bounce ? 1 : 0], 60);
    const m = this.missRadiance;
    f.set(m ? [m[0]!, m[1]!, m[2]!, 1] : [0, 0, 0, 0], 64);
    this.device.queue.writeBuffer(this.params, 0, b);
  }

  /** Draws the debug view (fullscreen, in a pass on the HDR MSAA target) when `debug` is on. */
  drawDebug(pass: GPURenderPassEncoder): void {
    if (this.debug === 'off') return;
    if (!this.debugPipe) {
      const d = this.device;
      const mod = d.createShaderModule({ code: DEBUG_WGSL, label: 'gi.debug' });
      const l0 = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      this.debugPipe = d.createRenderPipeline({
        layout: d.createPipelineLayout({ bindGroupLayouts: [l0, this.layout] }),
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.colorFormat }] },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        multisample: { count: this.msaa },
      });
      this.debugBind = d.createBindGroup({ layout: l0, entries: [{ binding: 0, resource: { buffer: this.frameBufRef } }, { binding: 1, resource: { buffer: this.debugMode } }] });
    }
    this.device.queue.writeBuffer(this.debugMode, 0, new Uint32Array([this.debug === 'gi' ? 2 : 1, 0, 0, 0]));
    pass.setPipeline(this.debugPipe);
    pass.setBindGroup(0, this.debugBind!);
    pass.setBindGroup(1, this.bindGroup);
    pass.draw(3);
  }

  get sdfReady(): boolean { return this.sdfValid; }
}
