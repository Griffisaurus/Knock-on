// Volumetric fire, smoke and dust (GAME_SPEC §13, RENDERING §8 "Volumetric fire and smoke"): a pool of
// 3D stable-fluids grids. Cosmetic only: driven by Detonate / Ignite / flame / Break events through fx.ts,
// never read by the sim.
//
// Each active grid steps once per frame (dt = the playback-scaled frame time):
//   curl(vel) → advect velocity (semi-Lagrangian, trilinear) + buoyancy (temperature up, soot down) +
//   vorticity confinement + sources → advect density / temperature / fuel with combustion (fuel burns into
//   heat and soot; the burn feeds an expansion term into the divergence) → divergence → Jacobi pressure
//   (warm-started from the grid's last pressure) → projection → a half-resolution light volume (key-light
//   transmittance, 8 steps, and sky openness).
// The floor is a solid boundary; the other faces are open (pressure 0) and fade density near the edge.
// Fields are rgba16float (velocity; density, temperature, fuel, burn) and r32float (pressure). Grids share
// their transient textures (the second velocity, pressure, divergence, curl), so a grid costs 28 B a cell.
// Every slot is allocated and touched once at init, so a first blast never pays for fresh VRAM.
//
// Rendering: each active grid's box is rasterised (back faces, so the camera may be inside) into a
// half-resolution target; the fragment marches the box from the eye to the opaque depth with blue-noise
// jitter, accumulating blackbody emission and lit scattering (key light through the light volume, sky,
// and the fire's own glow), back to front with premultiplied "over". The late pass composites it before
// the particles. Chained blasts merge: an event inside an active grid's box injects into that grid.

import { FRAME_WGSL } from './shaders.ts';
import type { GTier } from './gi.ts';

import { vramGovernor, type VramKnob } from './vram.ts';

type V3 = [number, number, number];

/** GAME_SPEC §15.2 + D85: fluid grids per tier. */
export const VOLUME_TIERS: Record<GTier, { grids: number; n: number; jacobi: number }> = {
  4: { grids: 2, n: 96, jacobi: 8 },
  8: { grids: 4, n: 128, jacobi: 10 },
  12: { grids: 6, n: 128, jacobi: 12 },
  16: { grids: 6, n: 160, jacobi: 12 },
  32: { grids: 8, n: 192, jacobi: 16 },
};

export type VolumeKind = 'fire' | 'smoke' | 'dust';
const KIND_ID: Record<VolumeKind, number> = { fire: 0, smoke: 1, dust: 2 };

/** A source for one frame: injects inside a sphere (world units). */
export interface VolumeSource {
  readonly pos: readonly [number, number, number];
  readonly radius: number;
  /** Per second (scaled by dt) unless `burst` is set (then a one-off amount). */
  readonly density?: number;
  readonly temp?: number;
  readonly fuel?: number;
  /** Outward speed at the rim (m/s), plus a directional velocity. */
  readonly expand?: number;
  readonly vel?: readonly [number, number, number];
  readonly burst?: boolean;
}

interface KindParams { turb: number; buoy: number; weight: number; cool: number; diss: number; burn: number; heat: number; soot: number; vort: number; albedo: V3; emission: number; expansion: number }
const KINDS: Record<VolumeKind, KindParams> = {
  fire: { turb: 140, buoy: 1.1, weight: 0.15, cool: 2.0, diss: 0.1, burn: 4.0, heat: 2.5, soot: 1.8, vort: 4.0, albedo: [0.3, 0.31, 0.34], emission: 5.0, expansion: 0.35 },
  smoke: { turb: 90, buoy: 0.9, weight: 0.05, cool: 2.0, diss: 0.2, burn: 3.0, heat: 1.0, soot: 0.35, vort: 1.2, albedo: [0.34, 0.36, 0.4], emission: 3.0, expansion: 0.15 },
  dust: { turb: 10, buoy: 0.0, weight: 0.25, cool: 2.0, diss: 0.3, burn: 0, heat: 0, soot: 0, vort: 0.8, albedo: [0.55, 0.52, 0.47], emission: 0, expansion: 0 },
};

const MAX_SRC = 6; // 16 + 6 × 48 B after the 128 B header: fits GU_BYTES
const GU_BYTES = 512;

const GU_WGSL = /* wgsl */ `
struct Src { pos: vec3f, radius: f32, amount: vec4f, vel: vec4f };  // pos/radius in cells; amount: density, temp, fuel, expand (cells/s); vel cells/s, w = burst (1) or rate (0)
struct GU {
  origin: vec3f, h: f32,
  n: u32, N: u32, kind: u32, nsrc: u32,
  dt: f32, time: f32, fade: f32, floorY: f32,
  buoy: f32, weight: f32, cool: f32, diss: f32,
  burn: f32, heat: f32, soot: f32, vort: f32,
  albedo: vec3f, emission: f32,
  lightDir: vec3f, expansion: f32,
  turb: f32, _p0: f32, _p1: f32, _p2: f32,
  src: array<Src, ${MAX_SRC}>,
};
@group(0) @binding(0) var<uniform> g: GU;
fn inDomain(c: vec3i) -> bool { return all(c >= vec3i(0)) && all(c < vec3i(i32(g.n))); }
fn solid(c: vec3i) -> bool { return g.origin.y + (f32(c.y) + 0.5) * g.h < g.floorY; }
fn uvwOf(p: vec3f) -> vec3f {
  let n = f32(g.n);
  return clamp(p, vec3f(0.5), vec3f(n - 0.5)) / f32(g.N);
}
`;

const SIM_WGSL = /* wgsl */ `
${GU_WGSL}
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var velIn: texture_3d<f32>;
@group(0) @binding(3) var scalIn: texture_3d<f32>;
@group(0) @binding(4) var curlIn: texture_3d<f32>;
@group(0) @binding(5) var pIn: texture_3d<f32>;
@group(0) @binding(6) var divIn: texture_3d<f32>;
@group(0) @binding(7) var outV: texture_storage_3d<rgba16float, write>;
@group(0) @binding(8) var outS: texture_storage_3d<rgba16float, write>;
@group(0) @binding(9) var outF: texture_storage_3d<r32float, write>;

fn ld(t: texture_3d<f32>, c: vec3i) -> vec4f {
  return textureLoad(t, clamp(c, vec3i(0), vec3i(i32(g.n) - 1)), 0);
}

@compute @workgroup_size(4, 4, 4) fn clear(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  textureStore(outV, c, vec4f(0.0));
  textureStore(outS, c, vec4f(0.0));
  textureStore(outF, c, vec4f(0.0));
}

@compute @workgroup_size(4, 4, 4) fn curl(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  let L = ld(velIn, c - vec3i(1, 0, 0)).xyz; let R = ld(velIn, c + vec3i(1, 0, 0)).xyz;
  let B = ld(velIn, c - vec3i(0, 1, 0)).xyz; let T = ld(velIn, c + vec3i(0, 1, 0)).xyz;
  let D = ld(velIn, c - vec3i(0, 0, 1)).xyz; let U = ld(velIn, c + vec3i(0, 0, 1)).xyz;
  let w = vec3f((T.z - B.z) - (U.y - D.y), (U.x - D.x) - (R.z - L.z), (R.y - L.y) - (T.x - B.x)) * 0.5;
  textureStore(outV, c, vec4f(w, length(w)));
}

fn hash3(c: vec3i, salt: u32) -> vec3f {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (salt * 2654435761u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  let a = h ^ (h >> 13u);
  let b = a * 3266489917u;
  return vec3f(f32(a & 1023u), f32((b >> 10u) & 1023u), f32((b >> 20u) & 1023u)) / 1023.0;
}

fn srcFalloff(c: vec3f, s: Src) -> f32 {
  let d = length(c - s.pos);
  return clamp(1.0 - d / max(s.radius, 0.5), 0.0, 1.0);
}

@compute @workgroup_size(4, 4, 4) fn advect_vel(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  if (solid(c)) { textureStore(outV, c, vec4f(0.0)); return; }
  let p = vec3f(c) + 0.5;
  let v0 = ld(velIn, c).xyz;                       // cells / s
  var v = textureSampleLevel(velIn, samp, uvwOf(p - v0 * g.dt), 0.0).xyz;
  let s = ld(scalIn, c);
  // buoyancy (temperature lifts, soot weighs) in cells / s²
  v.y += (g.buoy * s.y - g.weight * s.x) * g.dt / g.h;
  // vorticity confinement: N = ∇|ω| / |∇|ω||, f = ε h (N × ω)
  let wl = ld(curlIn, c - vec3i(1, 0, 0)).w; let wr = ld(curlIn, c + vec3i(1, 0, 0)).w;
  let wb = ld(curlIn, c - vec3i(0, 1, 0)).w; let wt = ld(curlIn, c + vec3i(0, 1, 0)).w;
  let wd = ld(curlIn, c - vec3i(0, 0, 1)).w; let wu = ld(curlIn, c + vec3i(0, 0, 1)).w;
  let grad = vec3f(wr - wl, wt - wb, wu - wd) * 0.5;
  let gl = length(grad);
  if (gl > 1e-5) {
    let N = grad / gl;
    let w = ld(curlIn, c).xyz;
    v += cross(N, w) * g.vort * g.dt;
  }
  for (var k = 0u; k < g.nsrc; k++) {
    let sr = g.src[k];
    let f = srcFalloff(p, sr);
    if (f > 0.0) {
      // radial expansion growing to the expand speed at the rim, plus the source's own velocity
      let rel = (p - sr.pos) / max(sr.radius, 0.5) + (hash3(c, k + 7u) - 0.5) * 0.9;
      let k = select(min(1.0, f * g.dt * 8.0), clamp(f * 3.0, 0.0, 1.0), sr.vel.w > 0.5);
      v = mix(v, rel * sr.amount.w + sr.vel.xyz, k);
    }
  }
  // flicker: hot gas gets a little random push each step (the projection keeps its curl: small eddies)
  v += (hash3(c, u32(g.time * 60.0)) - 0.5) * min(s.y, 3.0) * g.turb * g.dt;
  v *= 1.0 / (1.0 + 0.15 * g.dt);
  textureStore(outV, c, vec4f(v, 0.0));
}

@compute @workgroup_size(4, 4, 4) fn advect_scal(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  if (solid(c)) { textureStore(outS, c, vec4f(0.0)); return; }
  let p = vec3f(c) + 0.5;
  let v0 = ld(velIn, c).xyz;
  var s = textureSampleLevel(scalIn, samp, uvwOf(p - v0 * g.dt), 0.0);
  // combustion: hot fuel burns into heat and soot
  var burn = 0.0;
  if (g.burn > 0.0 && s.z > 0.0 && s.y > 0.15) {
    burn = s.z * (1.0 - exp(-g.burn * g.dt));
    s.z -= burn;
    s.y += burn * g.heat;
    s.x += burn * g.soot;
  }
  for (var k = 0u; k < g.nsrc; k++) {
    let sr = g.src[k];
    let f = srcFalloff(p, sr);
    if (f > 0.0) {
      let rate = select(g.dt, 1.0, sr.vel.w > 0.5);
      let j = 0.55 + 0.9 * hash3(c, k + 3u);   // lumpy sources: no perfect spheres
      s.x += sr.amount.x * f * rate * j.x;
      s.y = max(s.y, sr.amount.y * f * j.y);
      s.z += sr.amount.z * f * rate * j.z;
    }
  }
  s.y *= exp(-g.cool * g.dt);
  s.x *= exp(-(g.diss + g.fade) * g.dt);
  s.z *= exp(-0.5 * g.dt);
  // open sides: thin out near the domain edge so nothing piles up on the walls
  let n = f32(g.n);
  let e = min(min(p.x, n - p.x), min(min(p.z, n - p.z), n - p.y));
  s.x *= smoothstep(0.0, 4.0, e);
  s.w = burn / max(g.dt, 1e-4);
  textureStore(outS, c, clamp(s, vec4f(0.0), vec4f(60.0)));
}

@compute @workgroup_size(4, 4, 4) fn divergence(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  let L = select(ld(velIn, c - vec3i(1, 0, 0)).x, 0.0, c.x == 0);
  let R = select(ld(velIn, c + vec3i(1, 0, 0)).x, 0.0, c.x == i32(g.n) - 1);
  let B = select(ld(velIn, c - vec3i(0, 1, 0)).y, 0.0, solid(c - vec3i(0, 1, 0)) || c.y == 0);
  let T = select(ld(velIn, c + vec3i(0, 1, 0)).y, 0.0, c.y == i32(g.n) - 1);
  let D = select(ld(velIn, c - vec3i(0, 0, 1)).z, 0.0, c.z == 0);
  let U = select(ld(velIn, c + vec3i(0, 0, 1)).z, 0.0, c.z == i32(g.n) - 1);
  // gas expansion from combustion pushes outward
  let burn = ld(scalIn, c).w;
  let div = 0.5 * ((R - L) + (T - B) + (U - D)) - burn * g.expansion;
  textureStore(outF, c, vec4f(div, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(4, 4, 4) fn jacobi(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  if (solid(c)) { textureStore(outF, c, vec4f(0.0)); return; }
  let pc = ld(pIn, c).x;
  // open faces: p = 0 outside; floor / solid: Neumann (dp/dn = 0)
  let pl = select(ld(pIn, c - vec3i(1, 0, 0)).x, 0.0, c.x == 0);
  let pr = select(ld(pIn, c + vec3i(1, 0, 0)).x, 0.0, c.x == i32(g.n) - 1);
  let pb = select(ld(pIn, c - vec3i(0, 1, 0)).x, pc, c.y == 0 || solid(c - vec3i(0, 1, 0)));
  let pt = select(ld(pIn, c + vec3i(0, 1, 0)).x, 0.0, c.y == i32(g.n) - 1);
  let pd = select(ld(pIn, c - vec3i(0, 0, 1)).x, 0.0, c.z == 0);
  let pu = select(ld(pIn, c + vec3i(0, 0, 1)).x, 0.0, c.z == i32(g.n) - 1);
  let div = ld(divIn, c).x;
  textureStore(outF, c, vec4f((pl + pr + pb + pt + pd + pu - div) / 6.0, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(4, 4, 4) fn project(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (!inDomain(c)) { return; }
  if (solid(c)) { textureStore(outV, c, vec4f(0.0)); return; }
  let pc = ld(pIn, c).x;
  let pl = select(ld(pIn, c - vec3i(1, 0, 0)).x, 0.0, c.x == 0);
  let pr = select(ld(pIn, c + vec3i(1, 0, 0)).x, 0.0, c.x == i32(g.n) - 1);
  let pb = select(ld(pIn, c - vec3i(0, 1, 0)).x, pc, c.y == 0 || solid(c - vec3i(0, 1, 0)));
  let pt = select(ld(pIn, c + vec3i(0, 1, 0)).x, 0.0, c.y == i32(g.n) - 1);
  let pd = select(ld(pIn, c - vec3i(0, 0, 1)).x, 0.0, c.z == 0);
  let pu = select(ld(pIn, c + vec3i(0, 0, 1)).x, 0.0, c.z == i32(g.n) - 1);
  var v = ld(velIn, c).xyz - 0.5 * vec3f(pr - pl, pt - pb, pu - pd);
  // keep the fluid from leaving through the floor
  if (solid(c - vec3i(0, 1, 0)) && v.y < 0.0) { v.y = 0.0; }
  textureStore(outV, c, vec4f(clamp(v, vec3f(-80.0), vec3f(80.0)), 0.0));
}
`;

const LIGHT_WGSL = /* wgsl */ `
${GU_WGSL}
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var scalIn: texture_3d<f32>;
@group(0) @binding(3) var outL: texture_storage_3d<rgba16float, write>;
const EXT: f32 = 8.0;
@compute @workgroup_size(4, 4, 4) fn light(@builtin(global_invocation_id) gid: vec3u) {
  let hn = g.n / 2u;
  if (any(gid >= vec3u(hn))) { return; }
  let p = (vec3f(gid) + 0.5) * 2.0;           // cells
  let l = normalize(g.lightDir);
  var od = 0.0;
  let st = max(f32(g.n) / 20.0, 2.0);
  for (var i = 1; i <= 8; i++) {
    let q = p + l * st * f32(i);
    if (any(q < vec3f(0.0)) || any(q > vec3f(f32(g.n)))) { break; }
    od += textureSampleLevel(scalIn, samp, uvwOf(q), 0.0).x * st;
  }
  var ou = 0.0;
  for (var i = 1; i <= 4; i++) {
    let q = p + vec3f(0.0, st * 1.5 * f32(i), 0.0);
    if (q.y > f32(g.n)) { break; }
    ou += textureSampleLevel(scalIn, samp, uvwOf(q), 0.0).x * st * 1.5;
  }
  let k = EXT * g.h;
  textureStore(outL, vec3i(gid), vec4f(exp(-od * k), exp(-ou * k * 0.6), 0.0, 1.0));
}
`;

const MARCH_WGSL = /* wgsl */ `
${FRAME_WGSL}
${GU_WGSL}
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var scalTex: texture_3d<f32>;
@group(0) @binding(3) var lightTex: texture_3d<f32>;
@group(1) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var depthTex: texture_depth_multisampled_2d;
@group(1) @binding(2) var<uniform> vp: vec4f; // xy = 1 / half-res target size, z = frame counter, w = steps scale

const EXT: f32 = 8.0;

struct VO { @builtin(position) clip: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  // a unit cube from 36 vertices (two triangles per face)
  var idx = array<u32, 36>(0u, 2u, 1u, 1u, 2u, 3u, 4u, 5u, 6u, 5u, 7u, 6u, 0u, 1u, 4u, 1u, 5u, 4u, 2u, 6u, 3u, 3u, 6u, 7u, 0u, 4u, 2u, 2u, 4u, 6u, 1u, 3u, 5u, 3u, 7u, 5u);
  let k = idx[vi];
  let c = vec3f(f32(k & 1u), f32((k >> 1u) & 1u), f32((k >> 2u) & 1u));
  let world = g.origin + c * f32(g.n) * g.h;
  var o: VO;
  o.clip = frame.viewProj * vec4f(world - frame.eye.xyz, 1.0);
  // the camera inside the box: clamp to the near plane so the back faces still cover the screen
  o.clip.z = min(o.clip.z, o.clip.w * 0.9999);
  return o;
}

fn blackbody(t: f32) -> vec3f {
  // art-directed fire ramp, clipped before white (vfx §1.6): deep red → orange → amber → warm yellow
  let a = smoothstep(0.25, 0.9, t);
  let b = smoothstep(0.8, 1.8, t);
  let c = smoothstep(1.6, 3.5, t);
  return vec3f(0.75, 0.16, 0.01) * a + vec3f(0.25, 0.36, 0.06) * b + vec3f(0.0, 0.3, 0.2) * c;
}

fn h31(p: vec3f) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.zyx + 31.32);
  return fract((r.x + r.y) * r.z);
}
/// Trilinear value noise: the grid carries the motion, this carries the billows the grid can't resolve.
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3f(1, 0, 0)), u.x), mix(h31(i + vec3f(0, 1, 0)), h31(i + vec3f(1, 1, 0)), u.x), u.y),
    mix(mix(h31(i + vec3f(0, 0, 1)), h31(i + vec3f(1, 0, 1)), u.x), mix(h31(i + vec3f(0, 1, 1)), h31(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}

fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let px = i.clip.xy;
  let full = vec2i(px * 2.0);
  let ndc = vec2f(px.x * vp.x * 2.0 - 1.0, 1.0 - px.y * vp.y * 2.0);
  let a = frame.invViewProj * vec4f(ndc, 0.0, 1.0);
  let b = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = a.xyz / a.w;
  let rd = normalize(b.xyz / b.w - ro);
  let dims = vec2i(textureDimensions(depthTex)) - 1;
  let dz = textureLoad(depthTex, clamp(full, vec2i(0), dims), 0);
  let sp = frame.invViewProj * vec4f(ndc, dz, 1.0);
  let tScene = select(1e6, dot(sp.xyz / sp.w, rd), dz < 1.0);
  // box in camera-relative space
  let bmin = g.origin - frame.eye.xyz;
  let bmax = bmin + vec3f(f32(g.n) * g.h);
  let inv = 1.0 / rd;
  let t0 = (bmin - vec3f(0.0)) * inv;
  let t1 = (bmax - vec3f(0.0)) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  let ts = max(tn, 0.0);
  let te = min(tf, tScene);
  if (te <= ts) { discard; }
  let step = g.h * 1.4 * vp.w;
  let nsteps = min(i32((te - ts) / step) + 1, 320);
  var t = ts + step * fract(ign(px) + vp.z * 0.618034);
  var trans = 1.0;
  var acc = vec3f(0.0);
  let key = frame.keyColor.rgb * frame.key.w;
  let sky = frame.skyTop.rgb;
  let invN = 1.0 / f32(g.N);
  let nn = f32(g.n);
  for (var s = 0; s < nsteps; s++) {
    if (t > te) { break; }
    let cp = (rd * t - bmin) / g.h;           // cells
    let uvw = clamp(cp, vec3f(0.5), vec3f(nn - 0.5)) * invN;
    var v = textureSampleLevel(scalTex, samp, uvw, 0.0);
    if (v.x > 0.002 || v.y > 0.2) {
      // sub-cell billows: two octaves of noise in grid space, drifting up with the smoke
      let q = cp / f32(g.n) * 18.0 + vec3f(0.0, -frame.eye.w * 0.6, 0.0);
      let nz = vnoise(q) * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
      v.x = max(0.0, v.x * (0.35 + 1.3 * nz) - 0.04 * (1.0 - nz));
      v.y *= 0.75 + 0.5 * nz;
    }
    // soft domain edges (the floor side excepted): no box silhouette when smoke reaches a wall
    let e3 = min(cp, vec3f(nn) - cp);
    let bottom = cp.y + select(4.0, 0.0, g.origin.y > g.floorY + g.h * 2.0);
    let edge = smoothstep(0.0, 4.0, min(min(e3.x, e3.z), min(nn - cp.y, bottom)));
    if (v.x * edge > 0.002 || v.y > 0.2) {
      let lt = textureSampleLevel(lightTex, samp, uvw, 0.0);
      let sigma = v.x * edge * EXT;
      let ds = min(step, te - t);
      let att = exp(-sigma * ds);
      // lit scattering: key through the light volume (forward-scattering lobe), sky through the top,
      // plus the fire's own glow on the smoke around it
      let glow = blackbody(v.y) * g.emission;
      // hot gas is all emission; soot scatters as it cools
      let cold = 1.0 - smoothstep(0.4, 1.6, v.y);
      let scat = g.albedo * (key * lt.r * 1.3 + sky * lt.g * 0.8) * cold + g.albedo * glow * 0.3;
      acc += trans * scat * (1.0 - att);
      acc += trans * glow * clamp(v.y - 0.2, 0.0, 4.0) * ds * 6.0 * max(att, 0.2);
      trans *= att;
      if (trans < 0.01) { break; }
    }
    t += step;
  }
  return vec4f(acc, 1.0 - trans);
}

`;

const COMPOSITE_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct VO { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VO;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, i.uv, 0.0);
  if (c.a <= 0.0005) { discard; }
  return c;
}
`;

interface Grid {
  active: boolean;
  kind: VolumeKind;
  origin: V3;
  h: number;
  n: number;
  age: number;
  life: number;
  idle: number;   // seconds since the last source
  parity: number;
  fresh: boolean; // needs a clear
  sources: VolumeSource[];
}

interface SlotRes {
  velA: GPUTexture; scalA: GPUTexture; scalB: GPUTexture; pA: GPUTexture; light: GPUTexture;
  uniform: GPUBuffer;
  binds: {
    clear: GPUBindGroup; curl: GPUBindGroup; advV: GPUBindGroup[]; advS: GPUBindGroup[]; div: GPUBindGroup[];
    jacAB: GPUBindGroup; jacBA: GPUBindGroup; project: GPUBindGroup; light: GPUBindGroup[]; march: GPUBindGroup[];
  };
}

export class Volumes {
  readonly n: number;
  readonly count: number;
  jacobi: number;
  /** Quality knob (1 = full march step); the live governor can raise it. */
  stepScale = 1;
  /** Governor knobs (fx.ts): every grid at half rate; new grids at this fraction of their cells. */
  forceHalf = false;
  cellScale = 1;
  stats = { active: 0, cells: 0 };
  private readonly device: GPUDevice;
  private readonly grids: Grid[] = [];
  private readonly slots: (SlotRes | undefined)[] = [];
  private readonly pipes: Record<'clear' | 'curl' | 'advV' | 'advS' | 'div' | 'jacobi' | 'project' | 'light', GPUComputePipeline>;
  private readonly marchPipe: GPURenderPipeline;
  private readonly compositePipe: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly marchUniform: GPUBuffer;
  private marchShared: GPUBindGroup | null = null;
  private compositeBind: GPUBindGroup | null = null;
  private half: GPUTexture | null = null;
  private readonly frameBuf: GPUBuffer;
  private frameNo = 0;
  private time = 0;
  floorY = 0;
  private drawn = false;

  constructor(device: GPUDevice, tier: GTier, frameBuf: GPUBuffer, colorFormat: GPUTextureFormat, msaa: number) {
    this.device = device;
    this.frameBuf = frameBuf;
    const cfg = VOLUME_TIERS[tier] ?? VOLUME_TIERS[16];
    this.n = cfg.n;
    this.count = cfg.grids;
    this.jacobi = cfg.jacobi;
    const N = this.n;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    const tex3 = (label: string, format: GPUTextureFormat, size = N): GPUTexture => device.createTexture({
      label, size: [size, size, size], dimension: '3d', format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const smod = device.createShaderModule({ code: SIM_WGSL, label: 'volume.sim' });
    const lmod = device.createShaderModule({ code: LIGHT_WGSL, label: 'volume.light' });
    const mk = (mod: GPUShaderModule, entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint } });
    this.pipes = {
      clear: mk(smod, 'clear'), curl: mk(smod, 'curl'), advV: mk(smod, 'advect_vel'), advS: mk(smod, 'advect_scal'),
      div: mk(smod, 'divergence'), jacobi: mk(smod, 'jacobi'), project: mk(smod, 'project'), light: mk(lmod, 'light'),
    };
    const mmod = device.createShaderModule({ code: MARCH_WGSL, label: 'volume.march' });
    const over: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    this.marchPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mmod, entryPoint: 'vs' },
      fragment: { module: mmod, entryPoint: 'fs', targets: [{ format: 'rgba16float', blend: over }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
    });
    const cmod = device.createShaderModule({ code: COMPOSITE_WGSL, label: 'volume.composite' });
    this.compositePipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: cmod, entryPoint: 'vs' },
      fragment: { module: cmod, entryPoint: 'fs', targets: [{ format: colorFormat, blend: over }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: msaa },
    });
    this.marchUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const bg = (pipe: GPUComputePipeline | GPURenderPipeline, entries: [number, GPUBindingResource][]): GPUBindGroup => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0), entries: entries.map(([binding, resource]) => ({ binding, resource })),
    });
    // slots are built (and primed) at init by prime(); the shared transients come with the first slot
    this.makeSlot = (s: number): SlotRes => {
      // M4 (V4): the shared transients live on the instance so the VRAM knob can free them with the last slot
      this.sharedTex ??= { velB: tex3('vol.velB', 'rgba16float'), curl: tex3('vol.curl', 'rgba16float'), pB: tex3('vol.pB', 'r32float'), div: tex3('vol.div', 'r32float') };
      const { velB, curl, pB, div } = this.sharedTex;
      const velA = tex3(`vol${s}.velA`, 'rgba16float');
      const scalA = tex3(`vol${s}.scalA`, 'rgba16float');
      const scalB = tex3(`vol${s}.scalB`, 'rgba16float');
      const pA = tex3(`vol${s}.pA`, 'r32float');
      const light = tex3(`vol${s}.light`, 'rgba16float', N / 2); // 8-bit transmittance bands on smooth smoke
      const uniform = device.createBuffer({ size: GU_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const U: [number, GPUBindingResource] = [0, { buffer: uniform }];
      const v = (t: GPUTexture): GPUTextureView => t.createView();
      const scal = [scalA, scalB];
      const P = this.pipes;
      return {
        velA, scalA, scalB, pA, light, uniform,
        binds: {
          clear: bg(P.clear, [U, [7, v(velA)], [8, v(scalA)], [9, v(pA)]]),
          curl: bg(P.curl, [U, [2, v(velA)], [7, v(curl)]]),
          advV: [0, 1].map((p) => bg(P.advV, [U, [1, this.sampler], [2, v(velA)], [3, v(scal[p]!)], [4, v(curl)], [7, v(velB)]])),
          advS: [0, 1].map((p) => bg(P.advS, [U, [1, this.sampler], [2, v(velA)], [3, v(scal[p]!)], [8, v(scal[1 - p]!)]])),
          div: [0, 1].map((p) => bg(P.div, [U, [2, v(velB)], [3, v(scal[1 - p]!)], [9, v(div)]])),
          jacAB: bg(P.jacobi, [U, [5, v(pA)], [6, v(div)], [9, v(pB)]]),
          jacBA: bg(P.jacobi, [U, [5, v(pB)], [6, v(div)], [9, v(pA)]]),
          project: bg(P.project, [U, [2, v(velB)], [5, v(pA)], [7, v(velA)]]),
          light: [0, 1].map((p) => bg(P.light, [U, [1, this.sampler], [2, v(scal[1 - p]!)], [3, v(light)]])),
          march: [0, 1].map((p) => bg(this.marchPipe, [U, [1, this.sampler], [2, v(scal[1 - p]!)], [3, v(light)]])),
        },
      };
    };
    for (let s = 0; s < this.count; s++) {
      this.grids.push({ active: false, kind: 'fire', origin: [0, 0, 0], h: 0.05, n: N, age: 0, life: 0, idle: 0, parity: 0, fresh: true, sources: [] });
    }
    this.limit = this.count;
    this.prime();
    // M4 (V4): the VRAM governor's 'volumes' knob: slots full, ½, ¼, none (blasts keep their particle fallback)
    const slotBytes = N ** 3 * 28 + (N / 2) ** 3 * 8, sharedBytes = N ** 3 * 24;
    const limitOf = (l: number): number => [this.count, Math.ceil(this.count / 2), Math.max(1, Math.ceil(this.count / 4)), 0][l] ?? this.count;
    this.knob = {
      name: 'volumes', levels: ['full', '½', '¼', 'off'], level: 0,
      set: (l) => { this.knob.level = l; this.setLimit(limitOf(l)); },
      saves: (l) => (this.count - limitOf(l)) * slotBytes + (limitOf(l) === 0 ? sharedBytes : 0),
    };
    vramGovernor.register(this.knob);
  }
  private readonly makeSlot: (s: number) => SlotRes;
  private sharedTex: { velB: GPUTexture; curl: GPUTexture; pB: GPUTexture; div: GPUTexture } | null = null;
  /** M4 (V4): slots in use (the VRAM knob lowers it; grids at or above it are freed). */
  limit = 0;
  private readonly knob: VramKnob;

  /** M4 (V4): frees the slots at or above `n` (their grids end now) or builds and primes the ones below it. */
  setLimit(n: number): void {
    n = Math.max(0, Math.min(this.count, n));
    for (let s = n; s < this.count; s++) {
      const g = this.grids[s]!;
      g.active = false;
      g.sources = [];
      const r = this.slots[s];
      if (r) { for (const t of [r.velA, r.scalA, r.scalB, r.pA, r.light]) t.destroy(); r.uniform.destroy(); this.slots[s] = undefined; }
    }
    if (n === 0 && this.sharedTex) { for (const t of Object.values(this.sharedTex)) t.destroy(); this.sharedTex = null; }
    const was = this.limit;
    this.limit = n;
    if (n > was) this.prime(was, n);
  }

  /** Stops answering the VRAM governor (device loss replaced this instance). */
  dispose(): void { vramGovernor.unregister(this.knob); }

  /**
   * At init (behind the loading screen): allocate every slot and touch all its textures once (GAME_SPEC §15.1
   * budgets the pool). Allocating lazily put the first writes to fresh 192³ textures into the first blast's
   * frame: one 15 ms spectacle frame on tier 32 in Kiloton.
   */
  private prime(from = 0, to = this.count): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    this.grids.forEach((g, s) => {
      if (s < from || s >= to) return; // M4 (V4): the VRAM knob primes only the slots it brings back
      const res = (this.slots[s] ??= this.makeSlot(s));
      const full: Grid = { ...g, n: this.n };
      this.writeUniform(full, res.uniform, 0, 0, [0, 1, 0]);
      for (const bind of [res.binds.clear]) {
        pass.setPipeline(this.pipes.clear);
        pass.setBindGroup(0, bind);
        const w = this.n / 4;
        pass.dispatchWorkgroups(w, w, w);
      }
      // one empty step touches the rest (the second scalar texture, the shared transients, the light volume)
      const w = this.n / 4, B = res.binds;
      for (const [pipe, bind] of [[this.pipes.curl, B.curl], [this.pipes.advV, B.advV[0]!], [this.pipes.advS, B.advS[0]!], [this.pipes.div, B.div[0]!],
        [this.pipes.jacobi, B.jacAB], [this.pipes.jacobi, B.jacBA], [this.pipes.project, B.project]] as const) {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(w, w, w);
      }
      pass.setPipeline(this.pipes.light);
      for (const p of [0, 1]) { pass.setBindGroup(0, B.light[p]!); pass.dispatchWorkgroups(Math.ceil(this.n / 8), Math.ceil(this.n / 8), Math.ceil(this.n / 8)); }
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  get anyActive(): boolean { return this.grids.some((g) => g.active); }

  /** Active grids of a kind (fire volumes are capped per tier, vfx §1.6). */
  countOf(kind: VolumeKind): number { return this.grids.filter((g) => g.active && g.kind === kind).length; }

  /**
   * Adds a source to a grid of this kind: an active grid whose box holds the point (chained blasts merge),
   * else a free slot, else the oldest grid of the pool is recycled. `extent` sizes a new grid (m).
   * Returns false when no grid could take it (the caller keeps its particle fallback).
   */
  inject(kind: VolumeKind, src: VolumeSource, extent: number, life: number, opts: { cells?: number; lift?: number; cap?: boolean } = {}): boolean {
    const p = src.pos;
    const holds = (g: Grid, m: number): boolean => {
      const e = g.n * g.h;
      return p[0] > g.origin[0] + e * m && p[0] < g.origin[0] + e * (1 - m) && p[1] > g.origin[1] - 0.1 && p[1] < g.origin[1] + e * (1 - 2 * m)
        && p[2] > g.origin[2] + e * m && p[2] < g.origin[2] + e * (1 - m);
    };
    let g = this.grids.find((q) => q.active && q.kind === kind && q.n * q.h >= extent * 0.6 && holds(q, 0.18));
    if (g) {
      g.life = Math.max(g.life, g.age + life);
      if (g.sources.length < MAX_SRC) g.sources.push(src);
      g.idle = 0;
      return true;
    }
    if (opts.cap) return false; // this kind is at its grid cap: merge only
    const usable = this.grids.slice(0, this.limit); // M4 (V4): the VRAM knob's slot limit
    g = usable.find((q) => !q.active);
    if (!g) {
      // recycle the grid closest to the end of its life (never one younger than 0.4 s)
      const cands = usable.filter((q) => q.age > 0.4);
      if (!cands.length) return false;
      g = cands.reduce((a, b) => (a.life - a.age < b.life - b.age ? a : b));
    }
    const si = this.grids.indexOf(g);
    this.slots[si] ??= this.makeSlot(si);
    const cells = Math.min(this.n, Math.max(32, Math.round(((opts.cells ?? this.n) * this.cellScale) / 4) * 4));
    const h = extent / cells;
    const lift = opts.lift ?? 0.2;
    g.active = true;
    g.kind = kind;
    g.n = cells;
    g.h = h;
    g.origin = [p[0] - extent / 2, Math.max(this.floorY - h * 1.5, p[1] - extent * lift), p[2] - extent / 2];
    g.age = 0;
    g.life = life;
    g.idle = 0;
    g.parity = 0;
    g.fresh = true;
    g.sources = [src];
    return true;
  }

  /** Drops every grid (Stop). */
  clear(): void { for (const g of this.grids) { g.active = false; g.sources = []; } }

  /** Records the simulation of every active grid into a compute pass. */
  /** Camera (world eye, tan of half the vertical FOV): far grids step at half rate. */
  eye: readonly number[] = [0, 0, 0];
  tanHalfFov = 0.36;

  update(pass: GPUComputePassEncoder, dt0: number, lightDir: readonly number[]): void {
    this.frameNo++;
    this.drawn = false; // march() sets it again when it runs this frame
    this.time += dt0;
    let active = 0, cells = 0;
    this.grids.forEach((g, s) => {
      if (!g.active) return;
      // a grid under ~12 % of the screen height steps every other frame with twice the dt (its own parity)
      const e = g.n * g.h;
      const dist = Math.max(0.1, Math.hypot(g.origin[0] + e / 2 - this.eye[0]!, g.origin[1] + e / 2 - this.eye[1]!, g.origin[2] + e / 2 - this.eye[2]!));
      const small = this.forceHalf || e / (2 * dist * this.tanHalfFov) < 0.12;
      if (small && !g.fresh && (this.frameNo + s) % 2 === 1) { g.age += dt0; g.idle += dt0; return; }
      const dt = small ? dt0 * 2 : dt0;
      g.age += dt0;
      g.idle += dt0;
      if (g.age > g.life + 2.5 && g.idle > 1.5) { g.active = false; return; }
      const fade = Math.max(0, g.age - g.life) * 1.2;
      const res = this.slots[s]!;
      this.writeUniform(g, res.uniform, dt, fade, lightDir);
      g.sources = [];
      active++;
      cells += g.n ** 3;
      const wg = g.n / 4;
      const B = res.binds;
      const go = (pipe: GPUComputePipeline, bind: GPUBindGroup, half = false): void => {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bind);
        const w = half ? Math.ceil(g.n / 8) : wg;
        pass.dispatchWorkgroups(w, w, w);
      };
      if (g.fresh) {
        // velocity, scalars (parity 0) and pressure; advect_scal overwrites the other scalar texture fully
        go(this.pipes.clear, B.clear);
        g.fresh = false;
      }
      if (dt <= 0) return;
      const p = g.parity;
      go(this.pipes.curl, B.curl);
      go(this.pipes.advV, B.advV[p]!);
      go(this.pipes.advS, B.advS[p]!);
      go(this.pipes.div, B.div[p]!);
      for (let k = 0; k < this.jacobi; k += 2) {
        go(this.pipes.jacobi, B.jacAB);
        go(this.pipes.jacobi, B.jacBA);
      }
      go(this.pipes.project, B.project);
      go(this.pipes.light, B.light[p]!, true);
      g.parity = 1 - p;
    });
    this.stats.active = active;
    this.stats.cells = cells;
  }

  private writeUniform(g: Grid, buf: GPUBuffer, dt: number, fade: number, lightDir: readonly number[]): void {
    const b = new ArrayBuffer(GU_BYTES);
    const f = new Float32Array(b), u = new Uint32Array(b);
    const k = KINDS[g.kind];
    f.set([g.origin[0], g.origin[1], g.origin[2], g.h], 0);
    u.set([g.n, this.n, KIND_ID[g.kind], Math.min(g.sources.length, MAX_SRC)], 4);
    f.set([Math.min(dt, 0.1), this.time, fade, this.floorY], 8);
    f.set([k.buoy, k.weight, k.cool, k.diss], 12);
    f.set([k.burn, k.heat, k.soot, k.vort], 16);
    f.set([...k.albedo, k.emission], 20);
    f.set([lightDir[0]!, lightDir[1]!, lightDir[2]!, k.expansion], 24);
    f.set([k.turb, 0, 0, 0], 28);
    g.sources.slice(0, MAX_SRC).forEach((s, i) => {
      const o = 32 + i * 12;
      const toCell = (q: readonly number[], a: number): number => (q[a]! - g.origin[a]!) / g.h;
      f.set([toCell(s.pos, 0), toCell(s.pos, 1), toCell(s.pos, 2), s.radius / g.h], o);
      f.set([s.density ?? 0, s.temp ?? 0, s.fuel ?? 0, (s.expand ?? 0) / g.h], o + 4);
      const v = s.vel ?? [0, 0, 0];
      f.set([v[0] / g.h, v[1] / g.h, v[2] / g.h, s.burst ? 1 : 0], o + 8);
    });
    this.device.queue.writeBuffer(buf, 0, b);
  }

  /** Half-res raymarch of every active grid (back to front) after the opaque pass; `depth` = the MSAA depth.
   * `timestamps` is asked only when the pass is encoded (G5, M5: an unused timer slot read a previous frame's pass). */
  march(enc: GPUCommandEncoder, depth: GPUTexture, eye: readonly number[], timestamps?: () => GPURenderPassTimestampWrites | undefined): void {
    this.drawn = false;
    const live = this.grids.map((g, s) => ({ g, s })).filter((x) => x.g.active && !x.g.fresh);
    if (!live.length) return;
    const w = Math.max(1, Math.ceil(depth.width / 2)), h = Math.max(1, Math.ceil(depth.height / 2));
    if (!this.half || this.half.width !== w || this.half.height !== h || this.depthRef !== depth) {
      this.half?.destroy();
      this.half = this.device.createTexture({ label: 'vol.half', size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.depthRef = depth;
      this.marchShared = this.device.createBindGroup({
        layout: this.marchPipe.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: this.frameBuf } }, { binding: 1, resource: depth.createView() }, { binding: 2, resource: { buffer: this.marchUniform } }],
      });
      this.compositeBind = this.device.createBindGroup({
        layout: this.compositePipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.half.createView() }, { binding: 1, resource: this.sampler }],
      });
    }
    this.device.queue.writeBuffer(this.marchUniform, 0, new Float32Array([1 / w, 1 / h, this.frameNo % 64, this.stepScale]));
    const centre = (g: Grid): number => {
      const e = g.n * g.h / 2;
      return Math.hypot(g.origin[0] + e - eye[0]!, g.origin[1] + e - eye[1]!, g.origin[2] + e - eye[2]!);
    };
    live.sort((a, b) => centre(b.g) - centre(a.g));
    const timestamp = timestamps?.();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.half.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      ...(timestamp ? { timestampWrites: timestamp } : {}),
    });
    pass.setPipeline(this.marchPipe);
    pass.setBindGroup(1, this.marchShared!);
    for (const { g, s } of live) {
      // after update() the freshest scalars sit at parity (1 - g.parity) ^ 1 = g.parity's partner
      pass.setBindGroup(0, this.slots[s]!.binds.march[1 - g.parity]!);
      pass.draw(36);
    }
    pass.end();
    this.drawn = true;
  }
  private depthRef: GPUTexture | null = null;

  /** Composites the half-res result into the late pass (before particles). */
  composite(pass: GPURenderPassEncoder): void {
    if (!this.drawn || !this.compositeBind) return;
    pass.setPipeline(this.compositePipe);
    pass.setBindGroup(0, this.compositeBind);
    pass.draw(3);
  }
}
