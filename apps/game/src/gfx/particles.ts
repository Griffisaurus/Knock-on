// Spectacle particles v1 (RENDERING §8): one pooled ring of particles, compacted alive lists,
// indirect simulate + draw. Cosmetic only: nothing here ever feeds back into gameplay.
//
// Per frame: begin (reset the destination list, size the indirect dispatch) → emit (this frame's
// bursts into ring slots) → simulate the source list, appending survivors → finalize (draw args).
// The two alive lists ping-pong between frames.

import { FRAME_WGSL } from './shaders.ts';

// R4 (M4, vfx §1.3 / §3.1–3.3 / §4.1): arc sparks, water droplets, foam, egg splat decal + yolk blob, crackle sprites,
// wet stains. Append-only: kinds are bytes in the particle words.
// R5 (M5, vfx §7): field motes, stasis glints, accretion-disk particles, infall streaks and field sparkles. The M5 kinds feel
// the attractors (Singularity, Grav Well: `Particles.attractors`); every non-flat kind freezes inside a stasis volume.
export const Kind = { spark: 0, ember: 1, smoke: 2, fire: 3, dust: 4, ring: 5, glow: 6, decal: 7, arc: 8, droplet: 9, foam: 10, splat: 11, blob: 12, crackle: 13, stain: 14, mote: 15, glint: 16, disk: 17, infall: 18, sparkle: 19 } as const;

/** R5 (M5): a render-only point attractor for the M5 particle kinds: accel = s / max(r, rMin)² toward `pos` (s < 0 repels),
 * particles within `kill` die (the Singularity's core). */
export interface Attractor { readonly pos: readonly [number, number, number]; readonly s: number; readonly rMin: number; readonly kill: number }
/** R5 (M5): a stasis volume (oriented box): particles inside hang mid-air, not ageing. */
export interface StasisBox { readonly center: readonly [number, number, number]; readonly half: readonly [number, number, number]; readonly rot: readonly [number, number, number, number] }
export const MAX_ATTRACTORS = 4;
export const MAX_STASIS = 8;
export type ParticleKind = (typeof Kind)[keyof typeof Kind];

export interface Burst {
  readonly pos: readonly [number, number, number];
  readonly count: number;
  readonly kind: ParticleKind;
  /** Emission axis and cone: spread 0 = along dir, 1 = full sphere. */
  readonly dir?: readonly [number, number, number];
  readonly spread?: number;
  readonly speed: readonly [number, number];
  readonly life: readonly [number, number];
  readonly size: readonly [number, number];
  /** Linear RGB × intensity (HDR, up to 16). Each particle picks a mix of color and color2. */
  readonly color: readonly [number, number, number, number];
  readonly color2?: readonly [number, number, number, number];
  readonly gravity?: number; // × g, signed (−4…4)
  readonly drag?: number; // 1/s
  readonly jitter?: number; // spawn radius (m)
}

const P_BYTES = 32;
const BURST_BYTES = 96;
const MAX_BURSTS = 256;
/** R5 (M5): the uniform grew: + counts, attractors (2 vec4 each), stasis boxes (3 vec4 each). */
const PU_BYTES = 64 + 16 + MAX_ATTRACTORS * 32 + MAX_STASIS * 48;

const PU_WGSL = /* wgsl */ `
struct PU {
  capacity: u32, head: u32, emitCount: u32, burstCount: u32,
  src: u32, frameSeed: u32, dt: f32, time: f32,
  camRight: vec4f, camUp: vec4f,
  m5: vec4u,                              // R5 (M5): x attractors, y stasis boxes
  attr: array<vec4f, ${MAX_ATTRACTORS * 2}>, // (pos, s), (rMin, kill, 0, 0)
  box: array<vec4f, ${MAX_STASIS * 3}>,      // (centre, 0), (half, 0), rotation quat
};
`;

const WGSL = /* wgsl */ `
${FRAME_WGSL}
struct Particle { pos: vec3f, velxy: u32, velzAge: u32, lifeSize: u32, color: u32, misc: u32 };
struct Burst {
  pos: vec3f, count: u32,
  dir: vec3f, spread: f32,
  speed: vec2f, life: vec2f,
  size: vec2f, kind: u32, first: u32,
  color: u32, color2: u32, gravity: f32, drag: f32,
  jitter: f32, seed: u32, _a: u32, _b: u32,
};
${PU_WGSL}
fn qrotP(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
/// R5 (M5): inside a stasis volume?
fn inStasis(p: vec3f) -> bool {
  for (var k = 0u; k < u.m5.y; k++) {
    let q = u.box[k * 3u + 2u];
    let l = qrotP(vec4f(-q.xyz, q.w), p - u.box[k * 3u].xyz);
    if (all(abs(l) <= u.box[k * 3u + 1u].xyz)) { return true; }
  }
  return false;
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> u: PU;
@group(0) @binding(2) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(3) var<storage, read_write> alive: array<u32>;
@group(0) @binding(4) var<storage, read_write> counts: array<atomic<u32>, 4>;
@group(0) @binding(5) var<storage, read_write> dispatch: array<u32, 3>;
@group(0) @binding(6) var<storage, read_write> drawArgs: array<u32, 4>;
@group(0) @binding(7) var<storage, read> bursts: array<Burst>;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(h: ptr<function, u32>) -> f32 {
  *h = pcg(*h);
  return f32(*h >> 8u) / 16777216.0;
}
fn hdr(c: u32) -> vec3f {
  let v = unpack4x8unorm(c);
  return v.rgb * v.a * 16.0;
}
fn packHdr(c: vec3f) -> u32 {
  let m = max(max(c.r, c.g), max(c.b, 1e-4));
  let s = clamp(m, 1.0 / 16.0, 16.0);
  return pack4x8unorm(vec4f(c / s, s / 16.0));
}
fn idx(gid: vec3u, nwg: vec3u, size: u32) -> u32 { return gid.x + gid.y * nwg.x * size; }

@compute @workgroup_size(1) fn begin() {
  let n = min(atomicLoad(&counts[u.src]), u.capacity);
  atomicStore(&counts[2], n);
  atomicStore(&counts[1u - u.src], 0u);
  let groups = (n + 255u) / 256u;
  dispatch[0] = min(groups, 32768u);
  dispatch[1] = (groups + 32767u) / 32768u;
  dispatch[2] = 1u;
}

@compute @workgroup_size(256) fn emit(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = idx(gid, nwg, 256u);
  if (i >= u.emitCount) { return; }
  var b = 0u;
  for (var k = 1u; k < u.burstCount; k++) { if (bursts[k].first <= i) { b = k; } }
  let B = bursts[b];
  let slot = (u.head + i) % u.capacity;
  var h = pcg(i ^ (u.frameSeed * 2654435761u) ^ B.seed);
  // direction in a cone around B.dir
  let cz = 1.0 - B.spread * 2.0 * rnd(&h);
  let sz = sqrt(max(0.0, 1.0 - cz * cz));
  let ph = 6.2831853 * rnd(&h);
  let w = normalize(B.dir);
  let a = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(w.x) > 0.9);
  let t1 = normalize(cross(w, a));
  let t2 = cross(w, t1);
  let d = w * cz + (t1 * cos(ph) + t2 * sin(ph)) * sz;
  let speed = mix(B.speed.x, B.speed.y, rnd(&h));
  var v = d * speed;
  let jr = B.jitter * pow(rnd(&h), 0.333);
  let jd = normalize(vec3f(rnd(&h) - 0.5, rnd(&h) - 0.5, rnd(&h) - 0.5) + vec3f(1e-4));
  var p: Particle;
  p.pos = B.pos + jd * jr;
  if (B.kind == ${Kind.disk}u) {
    // R5 (M5): accretion disk: a ring between spread (inner r) and jitter (outer r) in the plane normal to dir, on a
    // circular orbit around pos for an attractor of strength speed.x (v = sqrt(s / r)); speed.y scatters it off the plane
    let rr = mix(B.spread, B.jitter, sqrt(rnd(&h)));
    let rp = t1 * cos(ph) + t2 * sin(ph);
    p.pos = B.pos + rp * rr + w * (rnd(&h) - 0.5) * B.speed.y * rr;
    v = cross(w, rp) * sqrt(max(B.speed.x, 0.0) / rr);
  } else if (B.kind == ${Kind.infall}u) {
    // R5 (M5): infall streams: from the shell of radius jitter, in the cone (dir, spread), inward at speed with a swirl
    p.pos = B.pos + d * B.jitter * (0.85 + 0.3 * rnd(&h));
    let ax = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(w.y) > 0.9);
    v = -d * speed + normalize(cross(ax, d) + vec3f(1e-4)) * speed * 0.5;
  }
  p.velxy = pack2x16float(v.xy);
  p.velzAge = pack2x16float(vec2f(v.z, 0.0));
  p.lifeSize = pack2x16float(vec2f(mix(B.life.x, B.life.y, rnd(&h)), mix(B.size.x, B.size.y, rnd(&h))));
  p.color = packHdr(mix(hdr(B.color), hdr(B.color2), rnd(&h)));
  let g = u32(clamp(B.gravity * 32.0 + 128.0, 0.0, 255.0));
  let dr = u32(clamp(B.drag * 16.0, 0.0, 255.0));
  p.misc = B.kind | (g << 8u) | (dr << 16u) | ((h & 255u) << 24u);
  parts[slot] = p;
  let k = atomicAdd(&counts[1u - u.src], 1u);
  if (k < u.capacity) { alive[(1u - u.src) * u.capacity + k] = slot; }
}

@compute @workgroup_size(256) fn simulate(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = idx(gid, nwg, 256u);
  if (i >= atomicLoad(&counts[2])) { return; }
  let slot = alive[u.src * u.capacity + i];
  var p = parts[slot];
  let vz = unpack2x16float(p.velzAge);
  var v = vec3f(unpack2x16float(p.velxy), vz.x);
  var age = vz.y;
  let ls = unpack2x16float(p.lifeSize);
  let kind = p.misc & 255u;
  let gscale = (f32((p.misc >> 8u) & 255u) - 128.0) / 32.0;
  let drag = f32((p.misc >> 16u) & 255u) / 16.0;
  let dt = u.dt;
  let t = age / ls.x;
  let flat0 = kind == ${Kind.ring}u || kind == ${Kind.decal}u || kind == ${Kind.splat}u || kind == ${Kind.blob}u || kind == ${Kind.stain}u;
  if (u.m5.y > 0u && !flat0 && kind != ${Kind.glint}u && inStasis(p.pos)) {
    // R5 (M5, vfx §7.3): spectacle particles inside a stasis volume hang mid-air and don't age
    let k0 = atomicAdd(&counts[1u - u.src], 1u);
    if (k0 < u.capacity) { alive[(1u - u.src) * u.capacity + k0] = slot; }
    return;
  }
  if (u.m5.x > 0u && kind == ${Kind.disk}u) {
    // R5 (M5): accretion disk: an exact rotation about the nearest attractor (ω = sqrt(s / r³)) instead of a force
    // step, so the inner orbits stay stable at any frame rate; drag spirals it in
    var ai = 0u;
    var best = 1e9;
    for (var a = 0u; a < u.m5.x; a++) { let dd = length(p.pos - u.attr[a * 2u].xyz); if (dd < best) { best = dd; ai = a; } }
    let A = u.attr[ai * 2u];
    var rv = p.pos - A.xyz;
    let r = max(length(rv), 1e-4);
    if (r < u.attr[ai * 2u + 1u].y) { return; }
    let n = normalize(cross(rv, v) + vec3f(0.0, 1e-6, 0.0));
    let ang = sqrt(abs(A.w) / (r * r * r)) * dt;
    rv = rv * cos(ang) + cross(n, rv) * sin(ang) + n * dot(n, rv) * (1.0 - cos(ang));
    // attr (rMin, kill, disk, implode): implode > 0 pulls the whole disk into the core (the Singularity's collapse)
    let r2 = max(r * (1.0 - drag * dt * 0.3) * max(0.0, 1.0 - u.attr[ai * 2u + 1u].w * dt), 1e-4);
    rv = normalize(rv) * r2;
    p.pos = A.xyz + rv;
    let vv = cross(n, normalize(rv)) * sqrt(abs(A.w) / r2);
    age += dt;
    if (age >= ls.x) { return; }
    p.velxy = pack2x16float(vv.xy);
    p.velzAge = pack2x16float(vec2f(vv.z, age));
    parts[slot] = p;
    let k1 = atomicAdd(&counts[1u - u.src], 1u);
    if (k1 < u.capacity) { alive[(1u - u.src) * u.capacity + k1] = slot; }
    return;
  }
  if (u.m5.x > 0u && (kind == ${Kind.mote}u || kind == ${Kind.infall}u)) {
    // R5 (M5): the Singularity / Grav Well attractors (render-only strengths)
    for (var a = 0u; a < u.m5.x; a++) {
      let A = u.attr[a * 2u];
      let B2 = u.attr[a * 2u + 1u];
      let d = A.xyz - p.pos;
      let r = length(d);
      if (r < B2.y) { return; }
      let acc = min(abs(A.w) / max(r * r, B2.x * B2.x), 200.0) * sign(A.w);
      v += d / max(r, 1e-4) * acc * dt;
    }
  }
  v.y -= 9.81 * gscale * dt;
  if (kind == ${Kind.fire}u) { v.y += 3.0 * dt * (1.0 - t); }
  if (kind == ${Kind.smoke}u || kind == ${Kind.dust}u) {
    v.y += 0.8 * dt * (1.0 - t);
    let s = f32(p.misc >> 24u);
    v += vec3f(sin(u.time * 1.3 + s), 0.0, cos(u.time * 1.1 + s * 1.7)) * 0.15 * dt;
  }
  v *= 1.0 / (1.0 + drag * dt);
  p.pos += v * dt;
  if (kind == ${Kind.foam}u) {
    let s = f32(p.misc >> 24u);
    v += vec3f(sin(u.time * 2.1 + s), 0.6, cos(u.time * 1.7 + s * 1.3)) * 0.08 * dt;
  }
  let flat = kind == ${Kind.ring}u || kind == ${Kind.decal}u || kind == ${Kind.splat}u || kind == ${Kind.blob}u || kind == ${Kind.stain}u;
  if (p.pos.y < 0.0 && !flat) {
    p.pos.y = 0.0;
    if (v.y < 0.0) { v = vec3f(v.x * 0.6, -v.y * 0.3, v.z * 0.6); }
  }
  age += dt;
  if (age >= ls.x) { return; }
  p.velxy = pack2x16float(v.xy);
  p.velzAge = pack2x16float(vec2f(v.z, age));
  parts[slot] = p;
  let k = atomicAdd(&counts[1u - u.src], 1u);
  if (k < u.capacity) { alive[(1u - u.src) * u.capacity + k] = slot; }
}

@compute @workgroup_size(1) fn finalize() {
  drawArgs[0] = 6u;
  drawArgs[1] = min(atomicLoad(&counts[1u - u.src]), u.capacity);
  drawArgs[2] = 0u;
  drawArgs[3] = 0u;
}
`;

const DRAW_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct Particle { pos: vec3f, velxy: u32, velzAge: u32, lifeSize: u32, color: u32, misc: u32 };
${PU_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> u: PU;
@group(0) @binding(2) var<storage, read> parts: array<Particle>;
@group(0) @binding(3) var<storage, read> alive: array<u32>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) t: f32,
};

fn hdr(c: u32) -> vec3f {
  let v = unpack4x8unorm(c);
  return v.rgb * v.a * 16.0;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(-1., -1.), vec2f(1., 1.), vec2f(-1., 1.));
  let c = corners[vi];
  // the draw runs after finalize, so the freshly written list is the destination one
  let slot = alive[(1u - u.src) * u.capacity + ii];
  let p = parts[slot];
  let vz = unpack2x16float(p.velzAge);
  let v = vec3f(unpack2x16float(p.velxy), vz.x);
  let ls = unpack2x16float(p.lifeSize);
  let t = clamp(vz.y / ls.x, 0.0, 1.0);
  let kind = p.misc & 255u;
  let rel = p.pos - frame.eye.xyz;
  var size = ls.y;
  var col = hdr(p.color);
  var a = 1.0;
  var off: vec3f;
  let right = u.camRight.xyz;
  let up = u.camUp.xyz;
  switch (kind) {
    case ${Kind.spark}u: {
      // velocity-stretched streak
      let speed = length(v);
      let axis = select(up, v / max(speed, 1e-4), speed > 1e-3);
      let view = normalize(rel);
      var side = cross(axis, view);
      side = select(right, normalize(side), length(side) > 1e-4);
      let len = size + speed * 0.035;
      off = axis * c.y * len * 0.5 + side * c.x * size * 0.5;
      col *= pow(1.0 - t, 0.6);
      // a little coverage keeps sparks orange against the light cyc instead of washing to white
      a = 0.35 * (1.0 - t);
    }
    case ${Kind.ember}u, ${Kind.glow}u: {
      size *= 1.0 - t * 0.6;
      col *= (1.0 - t) * (0.75 + 0.25 * sin(f32(p.misc >> 24u) + u.time * 30.0));
      a = 0.0;
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    case ${Kind.fire}u: {
      size *= 0.5 + 1.2 * sqrt(t);
      // blackbody-ish ramp: white-hot → orange → deep red, then gone
      let ramp = mix(vec3f(1.0, 0.85, 0.6), vec3f(1.0, 0.35, 0.08), smoothstep(0.0, 0.5, t));
      col = col * ramp * (1.0 - smoothstep(0.4, 1.0, t)) * 2.0;
      a = 0.55 * (1.0 - smoothstep(0.3, 1.0, t));
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    case ${Kind.smoke}u, ${Kind.dust}u: {
      size *= 0.6 + 1.2 * sqrt(t);
      // lit by the key light and the ambient sky
      let lit = frame.skyTop.rgb * 0.55 + frame.keyColor.rgb * frame.key.w * 0.35;
      col = col * lit;
      a = (1.0 - t) * (1.0 - t) * 0.42;
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    case ${Kind.ring}u: {
      // ground ring (shock ring): expands to full radius with ease-out, then fades
      let e = 1.0 - pow(1.0 - min(t / 0.6, 1.0), 3.0);
      size = ls.y * e * 2.0;
      col *= 1.0 - smoothstep(0.6, 1.0, t);
      off = vec3f(c.x, 0.0, c.y) * size * 0.5 + vec3f(0.0, 0.004, 0.0);
    }
    case ${Kind.decal}u: {
      // ground scorch (vfx §2.8): flat on the floor, persists until Stop, fades over its last 10 %
      a = (1.0 - smoothstep(0.9, 1.0, t)) * 0.75;
      let s = f32(p.misc >> 24u) * 0.0245;
      let rot = vec2f(cos(s), sin(s));
      let cc = vec2f(c.x * rot.x - c.y * rot.y, c.x * rot.y + c.y * rot.x);
      off = vec3f(cc.x, 0.0, cc.y) * size * 0.5 + vec3f(0.0, 0.003, 0.0);
    }
    case ${Kind.arc}u: {
      // R4 (vfx §1.3): very short, very fast blue-white streaks with a Beam glow
      let speed = length(v);
      let axis = select(up, v / max(speed, 1e-4), speed > 1e-3);
      var side = cross(axis, normalize(rel));
      side = select(right, normalize(side), length(side) > 1e-4);
      let len = min(size + speed * 0.004, 0.025); // vfx §1.3: 5–25 mm
      off = axis * c.y * len * 0.5 + side * c.x * size * 0.35;
      col *= pow(1.0 - t, 0.4);
      a = 0.0;
    }
    case ${Kind.droplet}u: {
      // R4 (vfx §3.2): spray droplets, slightly stretched along their velocity, lit by the key and the sky
      let speed = length(v);
      let axis = select(up, v / max(speed, 1e-4), speed > 1e-3);
      var side = cross(axis, normalize(rel));
      side = select(right, normalize(side), length(side) > 1e-4);
      let len = size * (1.0 + min(speed * 0.08, 1.5));
      off = axis * c.y * len * 0.5 + side * c.x * size * 0.5;
      let lit = frame.skyTop.rgb * 0.6 + frame.keyColor.rgb * frame.key.w * 0.25;
      col = col * lit;
      a = 0.55 * (1.0 - smoothstep(0.7, 1.0, t));
    }
    case ${Kind.foam}u: {
      size *= 0.7 + 0.6 * sqrt(t);
      let lit = frame.skyTop.rgb * 0.7 + frame.keyColor.rgb * frame.key.w * 0.3;
      col = col * lit;
      a = (1.0 - t) * 0.6;
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    case ${Kind.splat}u, ${Kind.stain}u: {
      // R4 (vfx §3.1): egg splat (glossy albumen ring + yolk smear) / wet stain, flat on the surface it hit
      a = 1.0 - smoothstep(0.92, 1.0, t);
      let s = f32(p.misc >> 24u) * 0.0245;
      let rot = vec2f(cos(s), sin(s));
      let cc = vec2f(c.x * rot.x - c.y * rot.y, c.x * rot.y + c.y * rot.x);
      off = vec3f(cc.x, 0.0, cc.y) * size * 0.5 + vec3f(0.0, 0.0025, 0.0);
      let lit = frame.skyTop.rgb * 0.55 + frame.keyColor.rgb * frame.key.w * 0.4;
      col = col * lit;
      if (kind == ${Kind.stain}u) { a *= 0.5 * (1.0 - t); }
    }
    case ${Kind.blob}u: {
      // the domed yolk (40 mm, squashed): a lit camera-facing dome
      let lit = frame.skyTop.rgb * 0.5 + frame.keyColor.rgb * frame.key.w * 0.5;
      col = col * lit;
      a = 1.0 - smoothstep(0.95, 1.0, t);
      off = (right * c.x + up * (c.y * 0.6 + 0.4)) * size * 0.5;
    }
    case ${Kind.crackle}u: {
      // electric crackle at an arc's contact (flickering emissive star)
      size *= 0.6 + 0.8 * fract(sin(f32(p.misc >> 24u) + u.time * 61.0) * 43758.5);
      col *= 1.0 - t;
      a = 0.0;
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    // ---- R5 (M5, vfx §7) ----
    case ${Kind.mote}u, ${Kind.glint}u, ${Kind.sparkle}u: {
      // field motes (steady), stasis glints (slow twinkle), sparkles (fast twinkle, star-shaped in fs)
      let s = f32(p.misc >> 24u);
      let tw = select(0.65 + 0.35 * sin(u.time * 4.0 + s), 0.6 + 0.4 * sin(u.time * 23.0 + s * 3.1), kind == ${Kind.sparkle}u);
      size *= select(1.0 - t * 0.5, tw * (1.0 - t * 0.3), kind != ${Kind.mote}u);
      col *= smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.75, 1.0, t)) * select(1.0, tw, kind != ${Kind.mote}u);
      a = 0.0;
      off = (right * c.x + up * c.y) * size * 0.5;
    }
    case ${Kind.disk}u, ${Kind.infall}u: {
      // accretion disk / infall streaks: hot white inside → Ignition → Plasma → dark outside (by distance to attractor 0),
      // stretched along the velocity; the approaching side of the disk 40 % brighter
      var rr = 1e9;
      var rd = 1.0;
      for (var a = 0u; a < u.m5.x; a++) {
        let dd = length(p.pos - u.attr[a * 2u].xyz);
        if (dd < rr) { rr = dd; rd = max(u.attr[a * 2u + 1u].z, 0.01); }
      }
      if (rr > 1e8) { rr = 1.0; }
      let x = clamp(rr / rd, 0.0, 1.2);
      var ramp = mix(vec3f(1.0, 0.905, 0.745), vec3f(1.0, 0.105, 0.027), smoothstep(0.1, 0.45, x));
      ramp = mix(ramp, vec3f(1.0, 0.047, 0.42), smoothstep(0.4, 0.75, x));
      ramp *= 1.0 - smoothstep(0.75, 1.15, x) * 0.85;
      let speed = length(v);
      let axis = select(up, v / max(speed, 1e-4), speed > 1e-3);
      var side = cross(axis, normalize(rel));
      side = select(right, normalize(side), length(side) > 1e-4);
      let len = size * (1.0 + min(speed * 0.06, 3.0));
      off = axis * c.y * len * 0.5 + side * c.x * size * 0.5;
      let toward = -dot(axis, normalize(rel));
      col = ramp * hdr(p.color) * (1.0 + 0.4 * clamp(toward, 0.0, 1.0)) * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.8, 1.0, t));
      a = 0.0;
    }
    default: { off = (right * c.x + up * c.y) * size * 0.5; }
  }
  var o: VOut;
  o.clip = frame.viewProj * vec4f(rel + off, 1.0);
  o.uv = c;
  o.color = vec4f(col, a);
  o.kind = kind;
  o.t = t;
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let r = length(i.uv);
  if (r > 1.0) { discard; }
  var f: f32;
  switch (i.kind) {
    case ${Kind.spark}u: { f = (1.0 - abs(i.uv.x)) * (1.0 - i.uv.y * i.uv.y); }
    case ${Kind.ring}u: {
      let band = abs(r - 0.92) / 0.06;
      f = max(0.0, 1.0 - band * band);
      return vec4f(mix(vec3f(1.0, 0.69, 0.13), vec3f(1.0, 0.96, 0.88), f) * i.color.rgb * f * 0.3, 0.0);
    }
    case ${Kind.smoke}u, ${Kind.dust}u, ${Kind.foam}u: { f = smoothstep(1.0, 0.2, r); }
    case ${Kind.arc}u: { f = (1.0 - abs(i.uv.x)) * (1.0 - i.uv.y * i.uv.y); }
    case ${Kind.droplet}u: {
      // a bright rim and a highlight: reads as a clear droplet against any background
      let rim = smoothstep(0.55, 0.95, r);
      let hl = smoothstep(0.35, 0.0, length(i.uv - vec2f(-0.3, 0.35)));
      return vec4f(i.color.rgb * (0.25 + rim * 0.9) + vec3f(hl * 1.5), i.color.a * (0.35 + 0.65 * rim));
    }
    case ${Kind.splat}u: {
      // albumen: a glossy clear ring with lobes; yolk smear in the middle (premultiplied, persistent until Stop)
      let ang = atan2(i.uv.y, i.uv.x);
      let edge = 0.8 + 0.12 * sin(ang * 6.0 + 0.7) + 0.06 * sin(ang * 13.0);
      let alb = smoothstep(edge, edge * 0.85, r);
      let yolk = smoothstep(0.34, 0.24, length(i.uv - vec2f(0.06, -0.04)));
      let gloss = smoothstep(0.08, 0.0, abs(r - edge * 0.78)) * 0.6;
      let c0 = mix(vec3f(0.95, 0.93, 0.86) * 0.35, vec3f(1.0, 0.45, 0.02), yolk);
      let cov = max(alb * 0.45, yolk);
      return vec4f((c0 * i.color.rgb + vec3f(gloss)) * cov * i.color.a, cov * i.color.a);
    }
    case ${Kind.stain}u: {
      let ang = atan2(i.uv.y, i.uv.x);
      let edge = 0.8 + 0.08 * sin(ang * 3.0 + 2.0) + 0.06 * sin(ang * 7.0 + 0.5);
      f = smoothstep(edge, edge * 0.55, r) * 0.6;
      return vec4f(vec3f(0.0), f * i.color.a);
    }
    case ${Kind.blob}u: {
      // dome shading from the quad uv (light from above), glossy highlight
      let h = sqrt(max(0.0, 1.0 - r * r));
      let n = normalize(vec3f(i.uv.x, i.uv.y, h));
      let d = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3f(-0.4, 0.7, 0.6))));
      let hl = pow(max(0.0, dot(n, normalize(vec3f(-0.3, 0.5, 0.8)))), 40.0) * 2.0;
      let cov = smoothstep(1.0, 0.92, r);
      return vec4f((i.color.rgb * d + vec3f(hl)) * cov * i.color.a, cov * i.color.a);
    }
    case ${Kind.decal}u: {
      // ragged soot edge: a few angular lobes so scorches don't read as perfect discs
      let ang = atan2(i.uv.y, i.uv.x);
      let edge = 0.78 + 0.1 * sin(ang * 5.0 + 1.3) + 0.06 * sin(ang * 11.0);
      f = smoothstep(edge, edge * 0.55, r);
    }
    case ${Kind.sparkle}u: {
      // R5 (M5): a 4-point star glint
      f = pow(1.0 - r, 3.0) + exp(-abs(i.uv.x) * 14.0) * (1.0 - abs(i.uv.y)) + exp(-abs(i.uv.y) * 14.0) * (1.0 - abs(i.uv.x));
    }
    case ${Kind.disk}u, ${Kind.infall}u: { f = (1.0 - abs(i.uv.x)) * (1.0 - i.uv.y * i.uv.y); }
    default: { f = pow(1.0 - r, 2.0); }
  }
  // premultiplied: additive kinds write alpha 0 (pure add), smoke/dust write coverage
  return vec4f(i.color.rgb * f * select(1.0, i.color.a, i.color.a > 0.0), i.color.a * f);
}
`;

export class Particles {
  readonly capacity: number;
  private readonly device: GPUDevice;
  private readonly parts: GPUBuffer;
  private readonly alive: GPUBuffer;
  private readonly counts: GPUBuffer;
  private readonly dispatchBuf: GPUBuffer;
  readonly drawArgs: GPUBuffer;
  private readonly burstBuf: GPUBuffer;
  private readonly uniform: GPUBuffer;
  private readonly pipes: Record<'begin' | 'emit' | 'simulate' | 'finalize', GPUComputePipeline>;
  private readonly computeBind: GPUBindGroup;
  /** Same bindings, but a dummy at the dispatch slot: a buffer can't be indirect args and writable storage in one dispatch. */
  private readonly simBind: GPUBindGroup;
  readonly drawPipe: GPURenderPipeline;
  private readonly drawBind: GPUBindGroup;
  private queue: Burst[] = [];
  private head = 0;
  private src = 0;
  private frameNo = 0;
  emittedTotal = 0;
  /** R5 (M5): this frame's attractors (`disk`: the accretion disk's outer radius, for its colour ramp) and stasis volumes. */
  attractors: readonly (Attractor & { readonly disk?: number; readonly implode?: number })[] = [];
  stasis: readonly StasisBox[] = [];
  private readonly burstData = new ArrayBuffer(MAX_BURSTS * BURST_BYTES);

  constructor(device: GPUDevice, frameBuf: GPUBuffer, capacity: number, colorFormat: GPUTextureFormat, sampleCount: number) {
    this.device = device;
    this.capacity = capacity;
    const S = GPUBufferUsage.STORAGE;
    this.parts = device.createBuffer({ size: capacity * P_BYTES, usage: S | GPUBufferUsage.COPY_DST });
    this.alive = device.createBuffer({ size: capacity * 8, usage: S | GPUBufferUsage.COPY_DST });
    // G3 (M3): touch the pool at init (behind the loading screen), not in the first blast's frame
    { const enc = device.createCommandEncoder(); enc.clearBuffer(this.parts); enc.clearBuffer(this.alive); device.queue.submit([enc.finish()]); }
    this.counts = device.createBuffer({ size: 16, usage: S | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.dispatchBuf = device.createBuffer({ label: 'particles.dispatch', size: 16, usage: S | GPUBufferUsage.INDIRECT });
    this.drawArgs = device.createBuffer({ label: 'particles.drawArgs', size: 16, usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC });
    this.burstBuf = device.createBuffer({ size: MAX_BURSTS * BURST_BYTES, usage: S | GPUBufferUsage.COPY_DST });
    this.uniform = device.createBuffer({ size: PU_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const mod = device.createShaderModule({ code: WGSL, label: 'particles' });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ...[2, 3, 4, 5, 6].map((b) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' as const } })),
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const mk = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint } });
    this.pipes = { begin: mk('begin'), emit: mk('emit'), simulate: mk('simulate'), finalize: mk('finalize') };
    const group = (dispatch: GPUBuffer): GPUBindGroup => device.createBindGroup({
      layout,
      entries: [frameBuf, this.uniform, this.parts, this.alive, this.counts, dispatch, this.drawArgs, this.burstBuf]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.computeBind = group(this.dispatchBuf);
    this.simBind = group(device.createBuffer({ size: 16, usage: S }));

    const dmod = device.createShaderModule({ code: DRAW_WGSL, label: 'particles-draw' });
    const dlayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.drawPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [dlayout] }),
      vertex: { module: dmod, entryPoint: 'vs' },
      fragment: {
        module: dmod, entryPoint: 'fs',
        targets: [{
          format: colorFormat,
          blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: sampleCount },
    });
    this.drawBind = device.createBindGroup({
      layout: dlayout,
      entries: [frameBuf, this.uniform, this.parts, this.alive].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  emit(b: Burst): void {
    if (b.count > 0) this.queue.push(b);
  }

  /** Records begin/emit/simulate/finalize into a compute pass. */
  update(pass: GPUComputePassEncoder, dt: number, time: number, camRight: readonly number[], camUp: readonly number[]): void {
    // Flatten this frame's bursts (cap per frame so a huge chain can't stall a frame).
    const bursts = this.queue.splice(0, MAX_BURSTS);
    let total = 0;
    const f = new Float32Array(this.burstData);
    const w = new Uint32Array(this.burstData);
    const maxPerFrame = Math.min(this.capacity, 4_000_000);
    let n = 0;
    for (const b of bursts) {
      const count = Math.min(b.count, maxPerFrame - total);
      if (count <= 0) break;
      const o = n * (BURST_BYTES / 4);
      const dir = b.dir ?? [0, 1, 0];
      f.set([b.pos[0], b.pos[1], b.pos[2]], o); w[o + 3] = count;
      f.set([dir[0], dir[1], dir[2], b.spread ?? 1], o + 4);
      f.set([b.speed[0], b.speed[1], b.life[0], b.life[1], b.size[0], b.size[1]], o + 8);
      w[o + 14] = b.kind; w[o + 15] = total;
      w[o + 16] = packHdr(b.color); w[o + 17] = packHdr(b.color2 ?? b.color);
      f[o + 18] = b.gravity ?? 1; f[o + 19] = b.drag ?? 0;
      f[o + 20] = b.jitter ?? 0; w[o + 21] = (n * 2654435761 + this.frameNo * 97) >>> 0;
      total += count;
      n++;
    }
    if (n) this.device.queue.writeBuffer(this.burstBuf, 0, this.burstData, 0, n * BURST_BYTES);
    const ub = new ArrayBuffer(PU_BYTES);
    const uw = new Uint32Array(ub), uf = new Float32Array(ub);
    uw[0] = this.capacity; uw[1] = this.head; uw[2] = total; uw[3] = n;
    uw[4] = this.src; uw[5] = this.frameNo; uf[6] = Math.min(dt, 1 / 20); uf[7] = time;
    uf.set([camRight[0]!, camRight[1]!, camRight[2]!, 0, camUp[0]!, camUp[1]!, camUp[2]!, 0], 8);
    // R5 (M5): attractors and stasis volumes (set per frame by gfx/future)
    const na = Math.min(MAX_ATTRACTORS, this.attractors.length), nb = Math.min(MAX_STASIS, this.stasis.length);
    uw[16] = na; uw[17] = nb;
    this.attractors.slice(0, na).forEach((a, k) => uf.set([a.pos[0], a.pos[1], a.pos[2], a.s, a.rMin, a.kill, a.disk ?? 1, a.implode ?? 0], 20 + k * 8));
    this.stasis.slice(0, nb).forEach((b, k) => uf.set([b.center[0], b.center[1], b.center[2], 0, b.half[0], b.half[1], b.half[2], 0, b.rot[0], b.rot[1], b.rot[2], b.rot[3]], 20 + MAX_ATTRACTORS * 8 + k * 12));
    this.device.queue.writeBuffer(this.uniform, 0, ub);

    pass.setBindGroup(0, this.computeBind);
    pass.setPipeline(this.pipes.begin);
    pass.dispatchWorkgroups(1);
    if (total > 0) {
      pass.setPipeline(this.pipes.emit);
      const groups = Math.ceil(total / 256);
      pass.dispatchWorkgroups(Math.min(groups, 32768), Math.ceil(groups / 32768));
    }
    pass.setBindGroup(0, this.simBind);
    pass.setPipeline(this.pipes.simulate);
    pass.dispatchWorkgroupsIndirect(this.dispatchBuf, 0);
    pass.setPipeline(this.pipes.finalize);
    pass.dispatchWorkgroups(1);

    this.head = (this.head + total) % this.capacity;
    this.emittedTotal += total;
    this.src = 1 - this.src;
    this.frameNo++;
  }

  /** Drops every live particle (Stop: scorches and smoke don't outlive the run). */
  clear(): void {
    this.device.queue.writeBuffer(this.counts, 0, new Uint32Array(4));
    this.queue = [];
    this.head = 0;
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBind);
    pass.drawIndirect(this.drawArgs, 0);
  }

  /** Reads the live count (debug/HUD; async, one frame late). */
  async liveCount(): Promise<number> {
    const rb = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.drawArgs, 0, rb, 0, 16);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const n = new Uint32Array(rb.getMappedRange())[1]!;
    rb.unmap();
    rb.destroy();
    return n;
  }
}

function packHdr(c: readonly [number, number, number, number]): number {
  const r = c[0] * c[3], g = c[1] * c[3], b = c[2] * c[3];
  const m = Math.max(r, g, b, 1e-4);
  const s = Math.min(16, Math.max(1 / 16, m));
  const q = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
  return (q(r / s) | (q(g / s) << 8) | (q(b / s) << 16) | (q(s / 16) << 24)) >>> 0;
}
