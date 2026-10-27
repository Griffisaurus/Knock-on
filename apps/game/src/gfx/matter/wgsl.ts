// WGSL for Matter surfaces (RENDERING §3 passes 5/16, §8 "Matter surfaces"; M4 contract 3, stream R4).
//
// PREPARE (compute, once per frame, before the shadow pass): reads the backend's fixed-point buffers, makes every
// grain camera-relative with integer maths first (exact at any world size), culls it against the view and the key
// light's shadow box, picks its draw list and LOD, and compacts the lists (count → plan → scatter, workgroup-
// aggregated atomics) into 16-byte entries with indirect draw args. A hashed occupancy grid (1.5625 cm cells) gives
// solid grains their burial occlusion (contact darkening inside piles) and water its surface/foam term (speed and
// velocity divergence at the free surface).
//
// SHADE (spliced after the part shader, PART_FS_WGSL): sand and marble impostor spheres (exact ray-sphere depth up
// close, flat quads when a grain is under ~1.5 px), GLINT marbles as the real `marble` mesh at LOD0 through the
// part vertex path, and the water composite; all lit by the part shader's `shade()` (key, fill, rim, shadows, IBL,
// probe GI, GTAO, practicals), so Matter sits in the D79 look like the parts do.
//
// FLUID (screen-space fluid rendering): water particles splat sphere depth (nearest wins) and additive thickness +
// foam, then a bilateral filter smooths the linear depth; the composite reconstructs normals, refracts the resolved
// opaque scene by thickness, absorbs with the brief's 8 % Beam tint, reflects the IBL with Fresnel and lays foam on.
// X5 (M5): goo (kind 3) is drawn by the same screen-space surface (RENDERING's "metaball field to screen-space
// surface": overlapping sphere splats smoothed into one skin), with its own thickness channel, so the composite blends
// the water look into kn_slime (#7DFF7A, transmission 0.6, subsurface glow) by the goo share of each pixel.

import { FRAME_WGSL } from '../shaders.ts';

/** Draw lists (entries are compacted per list; bases and args live in the control buffer). */
export const LIST = { point: 0, sandFar: 1, near: 2, marbleMesh: 3, water: 4, shadow: 5, shadowPt: 6 } as const;
export const LISTS = 7;
/** Virtual args for the look's half-res prepass (lists are contiguous in the entry buffer): slot 7 = lists 0–1
 * (points and far quads: under a pixel at half resolution) as points, slot 8 = lists 2–3 (near grains, marbles) as quads. */
export const ARGS_PRE_POINTS = 7;
export const ARGS_SOLID = 8;
export const ARGS_SLOTS = 9;
/** Control buffer words: counts [0, 8), cursors [8, 16), bases [16, 24), args from 24 (5 words per slot). */
/** Impact samples the CPU reads back each frame (sand puffs, vfx §3.3): a count, then up to IMPACTS × (x, y, z) in units. */
export const IMPACTS = 16;
export const CTL = { counts: 0, cursors: 8, bases: 16, args: 24, impacts: 24 + ARGS_SLOTS * 5, words: 24 + ARGS_SLOTS * 5 + 1 + IMPACTS * 3 } as const;
/** Occupancy grid: 2^shift-unit cells (1/64 m), one word per cell (weighted solid count | water count << 16); water velocity
 * sums live in a second, smaller hashed grid (3 words per cell). */
export const GRID_SHIFT = 10;
export const PU_BYTES = 208;
export const MU_BYTES = 160;

const COMMON = /* wgsl */ `
const NONE: u32 = 0xffffffffu;
const L_POINT: u32 = ${LIST.point}u;
const L_SHADOW_PT: u32 = ${LIST.shadowPt}u;
const L_SAND_FAR: u32 = ${LIST.sandFar}u;
const L_NEAR: u32 = ${LIST.near}u;
const L_MARBLE_MESH: u32 = ${LIST.marbleMesh}u;
const L_WATER: u32 = ${LIST.water}u;
const L_SHADOW: u32 = ${LIST.shadow}u;
const NL: u32 = ${LISTS}u;
const C_COUNTS: u32 = ${CTL.counts}u;
const C_CURSORS: u32 = ${CTL.cursors}u;
const C_BASES: u32 = ${CTL.bases}u;
const C_ARGS: u32 = ${CTL.args}u;
const C_IMP: u32 = ${CTL.impacts}u;
const N_IMP: u32 = ${IMPACTS}u;
`;

export const PREPARE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${COMMON}
struct PU {
  eyeFix: vec4i,      // camera position in matter units, w = slot count
  eyeFrac: vec4f,     // camera − eyeFix / 65,536 (m), w = velocity scale (m/s per unit)
  strides: vec4u,     // x pos words per grain, y vel words, z grid mask (cells − 1), w flags (1 water on, 2 shadows on)
  px: vec4f,          // x pixels per unit (radius / distance), y near threshold (px radius), z marble mesh threshold (px), w time
  radii: vec4f,       // x sand, y water, z marble, w goo (m)
  mesh: vec4u,        // marble LOD0: x index count, y first index, z base vertex, w impostor quad vertex count (6)
  planes: array<vec4f, 6>, // camera-relative frustum planes (inward), un-jittered
  grid: vec4u,        // x occupancy mask (cells − 1), y velocity-grid mask, z full cell (weighted grains), w flags (1 cull buried)
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> u: PU;
@group(0) @binding(2) var<storage, read> pos: array<i32>;
@group(0) @binding(3) var<storage, read> vel: array<i32>;
@group(0) @binding(4) var<storage, read> mat: array<u32>;
@group(0) @binding(5) var<storage, read_write> ctl: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> entries: array<vec4u>;
@group(0) @binding(7) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> vgrid: array<atomic<u32>>;
/// Per slot: the count pass's lists (cam | sh << 8, 0xff = none), so the scatter pass doesn't classify again.
@group(0) @binding(9) var<storage, read_write> cls: array<u32>;

var<workgroup> wc: array<atomic<u32>, 8>;
var<workgroup> wb: array<u32, 8>;

fn slot(gid: vec3u, nwg: vec3u) -> u32 { return gid.x + gid.y * nwg.x * 256u; }
fn fixOf(i: u32) -> vec3i { let o = i * u.strides.x; return vec3i(pos[o], pos[o + 1u], pos[o + 2u]); }
fn relOf(p: vec3i) -> vec3f { return vec3f(p - u.eyeFix.xyz) * (1.0 / 65536.0) - u.eyeFrac.xyz; }
fn velOf(i: u32) -> vec3f { let o = i * u.strides.y; return vec3f(f32(vel[o]), f32(vel[o + 1u]), f32(vel[o + 2u])) * u.eyeFrac.w; }
fn radiusOf(kind: u32) -> f32 { return select(select(select(u.radii.x, u.radii.y, kind == 1u), u.radii.z, kind == 2u), u.radii.w, kind == 3u); }
fn cellOf(p: vec3i) -> vec3i { return p >> vec3u(${GRID_SHIFT}u); }
fn hash3(c: vec3i) -> u32 { return (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u); }
fn cellHash(c: vec3i) -> u32 { return hash3(c) & u.grid.x; }
fn velHash(c: vec3i) -> u32 { return (hash3(c) & u.grid.y) * 3u; }
fn solidAt(c: vec3i) -> f32 { return f32(atomicLoad(&grid[cellHash(c)]) & 0xffffu); }
fn waterAt(c: vec3i) -> f32 { return f32(atomicLoad(&grid[cellHash(c)]) >> 16u); }
fn waterVel(c: vec3i) -> vec3f {
  let n = waterAt(c);
  if (n < 0.5) { return vec3f(0.0); }
  let h = velHash(c);
  let s = vec3f(f32(bitcast<i32>(atomicLoad(&vgrid[h]))), f32(bitcast<i32>(atomicLoad(&vgrid[h + 1u]))), f32(bitcast<i32>(atomicLoad(&vgrid[h + 2u]))));
  return s / (256.0 * n);
}
fn live(i: u32) -> bool { return i < u32(u.eyeFix.w) && (mat[i] & 255u) <= 3u; } // X5 (M5): + goo (kind 3)

struct Cls { cam: u32, sh: u32 };
/// A sand grain or marble buried under full cells above and on all four sides can't be seen (or cast a shadow past the
/// surface layer): it's skipped. With an 8M-cell table at most ~6 % of lookups alias, and all six must read full.
fn buried(cell: vec3i) -> bool {
  if ((u.grid.w & 1u) == 0u) { return false; }
  let f = f32(u.grid.z);
  return solidAt(cell + vec3i(0, 1, 0)) >= f && solidAt(cell + vec3i(0, 2, 0)) >= f
    && solidAt(cell + vec3i(1, 0, 0)) >= f && solidAt(cell - vec3i(1, 0, 0)) >= f
    && solidAt(cell + vec3i(0, 0, 1)) >= f && solidAt(cell - vec3i(0, 0, 1)) >= f;
}

fn classify(rel: vec3f, kind: u32, variant: u32, cell: vec3i, seed: u32) -> Cls {
  var c = Cls(NONE, NONE);
  let r = radiusOf(kind);
  var inView = true;
  for (var k = 0u; k < 6u; k++) {
    let p = u.planes[k];
    if (dot(p.xyz, rel) + p.w < -r) { inView = false; }
  }
  if (inView) {
    let rpx = r / max(length(rel), 1e-3) * u.px.x;
    if (kind == 1u || kind == 3u) {
      // water, and goo (X5): both drawn by the screen-space fluid surface
      if ((u.strides.w & 1u) != 0u) { c.cam = L_WATER; }
    } else if (kind == 2u) {
      c.cam = select(L_NEAR, L_MARBLE_MESH, variant == 0u && rpx >= u.px.z && u.mesh.x > 0u);
    } else {
      // under 0.5 px a grain is one point (1 vertex: grains overlap at that size); under the near threshold one flat
      // triangle; above, an exact sphere
      c.cam = select(select(L_POINT, L_SAND_FAR, rpx >= 0.5), L_NEAR, rpx >= u.px.y);
    }
  }
  // R5 (M5, contract 6): water casts too: only its top layers (cells with water two above are inside the body) and half of
  // the grains by a fixed per-grain hash, so the PCF taps see a partial, lighter shadow under clear water
  let waterCasts = kind == 1u && ((seed * 2654435761u) >> 31u) == 0u && !(waterAt(cell + vec3i(0, 1, 0)) >= 2.0 && waterAt(cell + vec3i(0, 2, 0)) >= 2.0);
  if ((kind != 1u || waterCasts) && (u.strides.w & 2u) != 0u) {
    let s = frame.shadowMat * vec4f(rel, 1.0);
    let m = 1.0 + 0.02;
    // a grain smaller than ~1.5 shadow texels casts as a point
    if (abs(s.x) <= m && abs(s.y) <= m && s.z >= -0.02 && s.z <= 1.02) { c.sh = select(L_SHADOW_PT, L_SHADOW, radiusOf(kind) > frame.params.z * 1.5); }
  }
  // the burial lookups only for grains that would draw (frustum and shadow box first)
  if (kind != 1u && kind != 3u && (c.cam != NONE || c.sh != NONE) && buried(cell)) { return Cls(NONE, NONE); }
  return c;
}

@compute @workgroup_size(1) fn reset() {
  for (var k = 0u; k < 8u; k++) { atomicStore(&ctl[C_COUNTS + k], 0u); }
  atomicStore(&ctl[C_IMP], 0u);
}

@compute @workgroup_size(256) fn clearGrid(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = slot(gid, nwg);
  if (i <= u.grid.x) { atomicStore(&grid[i], 0u); }
  if (i <= u.grid.y) { atomicStore(&vgrid[i * 3u], 0u); atomicStore(&vgrid[i * 3u + 1u], 0u); atomicStore(&vgrid[i * 3u + 2u], 0u); }
}

/// The occupancy grid: solid grains weighted by volume (a marble ≈ 40 packed sand grains), water by count + velocity.
@compute @workgroup_size(256) fn splat(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = slot(gid, nwg);
  if (!live(i)) { return; }
  let kind = mat[i] & 255u;
  let cell = cellOf(fixOf(i));
  if (kind == 1u) {
    atomicAdd(&grid[cellHash(cell)], 1u << 16u);
    let h = velHash(cell);
    let v = vec3i(velOf(i) * 256.0);
    atomicAdd(&vgrid[h], bitcast<u32>(v.x));
    atomicAdd(&vgrid[h + 1u], bitcast<u32>(v.y));
    atomicAdd(&vgrid[h + 2u], bitcast<u32>(v.z));
  } else {
    atomicAdd(&grid[cellHash(cell)], select(1u, 40u, kind >= 2u)); // X5: a goo particle fills a cell like a marble
  }
}

@compute @workgroup_size(256) fn count(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li < 8u) { atomicStore(&wc[li], 0u); }
  workgroupBarrier();
  let i = slot(gid, nwg);
  var c = Cls(NONE, NONE);
  if (live(i)) {
    let m = mat[i];
    let p = fixOf(i);
    c = classify(relOf(p), m & 255u, (m >> 8u) & 255u, cellOf(p), i); // R5 (M5): + the grain's slot (water shadow dither)
    cls[i] = (c.cam & 255u) | ((c.sh & 255u) << 8u);
  }
  if (c.cam != NONE) { atomicAdd(&wc[c.cam], 1u); }
  if (c.sh != NONE) { atomicAdd(&wc[c.sh], 1u); }
  workgroupBarrier();
  if (li < NL) {
    let n = atomicLoad(&wc[li]);
    if (n > 0u) { atomicAdd(&ctl[C_COUNTS + li], n); }
  }
}

fn setArgs(slotK: u32, a0: u32, a1: u32, a2: u32, a3: u32, a4: u32) {
  let o = C_ARGS + slotK * 5u;
  atomicStore(&ctl[o], a0); atomicStore(&ctl[o + 1u], a1); atomicStore(&ctl[o + 2u], a2);
  atomicStore(&ctl[o + 3u], a3); atomicStore(&ctl[o + 4u], a4);
}

@compute @workgroup_size(1) fn plan() {
  var base = 0u;
  for (var l = 0u; l < NL; l++) {
    let n = atomicLoad(&ctl[C_COUNTS + l]);
    atomicStore(&ctl[C_BASES + l], base);
    atomicStore(&ctl[C_CURSORS + l], 0u);
    base += n;
    if (l == L_MARBLE_MESH) { setArgs(l, u.mesh.x, n, u.mesh.y, u.mesh.z, 0u); }
    else if (l == L_POINT || l == L_SHADOW_PT) { setArgs(l, 1u, n, 0u, 0u, 0u); }
    else if (l == L_SAND_FAR) { setArgs(l, 3u, n, 0u, 0u, 0u); }
    else { setArgs(l, u.mesh.w, n, 0u, 0u, 0u); }
  }
  setArgs(${ARGS_PRE_POINTS}u, 1u, atomicLoad(&ctl[C_COUNTS + L_POINT]) + atomicLoad(&ctl[C_COUNTS + L_SAND_FAR]), 0u, 0u, 0u);
  setArgs(${ARGS_SOLID}u, u.mesh.w, atomicLoad(&ctl[C_COUNTS + L_NEAR]) + atomicLoad(&ctl[C_COUNTS + L_MARBLE_MESH]), 0u, 0u, 0u);
}



/// Packed entry word: kind 2 b | variant 2 b | occlusion or foam 8 b (bits 4–11) | speed 8 b (bits 12–19) | seed 12 b.
fn pack(kind: u32, variant: u32, a: f32, s: f32, seed: u32) -> u32 {
  return kind | (min(variant, 3u) << 2u) | (u32(clamp(a, 0.0, 1.0) * 255.0) << 4u) | (u32(clamp(s, 0.0, 1.0) * 255.0) << 12u) | ((seed & 0xfffu) << 20u);
}

@compute @workgroup_size(256) fn scatter(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li < 8u) { atomicStore(&wc[li], 0u); }
  workgroupBarrier();
  let i = slot(gid, nwg);
  var c = Cls(NONE, NONE);
  var e = vec4u(0u);
  var oc = 0u;
  var os = 0u;
  if (live(i)) {
    let m = mat[i];
    let kind = m & 255u;
    let variant = (m >> 8u) & 255u;
    let p = fixOf(i);
    let rel = relOf(p);
    let cell = cellOf(p);
    let k = cls[i];
    c = Cls(select(k & 255u, NONE, (k & 255u) == 255u), select((k >> 8u) & 255u, NONE, ((k >> 8u) & 255u) == 255u));
    if (c.cam != NONE || c.sh != NONE) {
      var a = 0.0;
      var s = 0.0;
      if (kind == 1u) {
        // foam (vfx §3.2): fast or spreading water at the free surface
        let v = velOf(i);
        let speed = length(v);
        let nb = waterAt(cell) + waterAt(cell + vec3i(1, 0, 0)) + waterAt(cell - vec3i(1, 0, 0)) + waterAt(cell + vec3i(0, 1, 0))
          + waterAt(cell - vec3i(0, 1, 0)) + waterAt(cell + vec3i(0, 0, 1)) + waterAt(cell - vec3i(0, 0, 1));
        let surface = 1.0 - clamp(nb / (7.0 * 3.0), 0.0, 1.0);
        let inv = 64.0 * 0.5; // 1 / (2 cells) in 1/m
        let div = (waterVel(cell + vec3i(1, 0, 0)).x - waterVel(cell - vec3i(1, 0, 0)).x + waterVel(cell + vec3i(0, 1, 0)).y
          - waterVel(cell - vec3i(0, 1, 0)).y + waterVel(cell + vec3i(0, 0, 1)).z - waterVel(cell - vec3i(0, 0, 1)).z) * inv;
        a = clamp((clamp((speed - 0.9) * 0.6, 0.0, 1.0) + clamp(div * 0.02, 0.0, 1.0)) * (0.25 + 0.75 * surface), 0.0, 1.0);
        s = speed / 6.0;
      } else if (kind == 3u) {
        // goo (X5): no foam
        s = length(velOf(i)) / 6.0;
      } else {
        // burial occlusion: how full the cells above and beside this grain are (a packed cell holds ≈ 73 grains)
        let up = solidAt(cell + vec3i(0, 1, 0)) + 0.5 * solidAt(cell + vec3i(0, 2, 0));
        let side = solidAt(cell + vec3i(1, 0, 0)) + solidAt(cell - vec3i(1, 0, 0)) + solidAt(cell + vec3i(0, 0, 1)) + solidAt(cell - vec3i(0, 0, 1));
        let occ = clamp((up * 1.5 + side * 0.25 + solidAt(cell) * 0.25) / (73.0 * 2.75), 0.0, 1.0);
        a = 1.0 - occ;
        let v = velOf(i);
        s = length(v) / 6.0;
        // a sand grain landing fast (> 1.5 m/s, falling) on a resting pile (two full cells under it) or the floor: an impact
        // sample for the puffs
        if (kind == 0u && c.cam != NONE && v.y < -1.0 && length(v) > 1.5 && ((solidAt(cell - vec3i(0, 1, 0)) >= f32(u.grid.z) && solidAt(cell - vec3i(0, 2, 0)) >= f32(u.grid.z)) || p.y < 2048)) {
          let k = atomicAdd(&ctl[C_IMP], 1u);
          if (k < N_IMP) {
            atomicStore(&ctl[C_IMP + 1u + k * 3u], bitcast<u32>(p.x));
            atomicStore(&ctl[C_IMP + 2u + k * 3u], bitcast<u32>(p.y));
            atomicStore(&ctl[C_IMP + 3u + k * 3u], bitcast<u32>(p.z));
          }
        }
      }
      e = vec4u(bitcast<vec3u>(rel), pack(kind, variant, a, s, (i * 2654435761u) >> 20u));
    }
    if (c.cam != NONE) { oc = atomicAdd(&wc[c.cam], 1u); }
    if (c.sh != NONE) { os = atomicAdd(&wc[c.sh], 1u); }
  }
  workgroupBarrier();
  if (li < NL) {
    let n = atomicLoad(&wc[li]);
    wb[li] = select(0u, atomicAdd(&ctl[C_CURSORS + li], n) + atomicLoad(&ctl[C_BASES + li]), n > 0u);
  }
  workgroupBarrier();
  if (c.cam != NONE) { entries[wb[c.cam] + oc] = e; }
  if (c.sh != NONE) { entries[wb[c.sh] + os] = e; }
}
`;

/** Matter uniform shared by every draw (layout in index.ts writeMu). */
const MU_STRUCT = /* wgsl */ `
struct MU {
  px: vec4f,     // x pixels per unit (radius / distance), y internal width, z internal height, w time
  sand: vec4f,   // sand albedo (linear), w roughness
  sandVar: vec4f, // x brightness variation, y warm/cool variation, z odd-grain share, w occlusion strength
  glint: vec4f,  // GLINT albedo, w roughness
  bearing: vec4f, // BEARING albedo, w roughness
  radii: vec4f,  // x sand, y water, z marble, w water splat scale
  water: vec4f,  // xyz absorption per metre (Beam tint), w refraction strength
  water2: vec4f, // x thickness per particle, y foam strength, z full-res (1) or half (0.5), w depth filter radius (particle radii)
  goo: vec4f,    // X5: x goo radius (m), y thickness per particle, z subsurface strength, w transmission (kn_slime 0.6)
  gooCol: vec4f, // X5: rgb kn_slime albedo (linear), w absorption per metre
};
`;

/** Group 1 declarations + entry points spliced after PART_FS_WGSL (the part module: shade(), vertexWith(), fs_part). */
export const MATTER_SHADE_WGSL = /* wgsl */ `
${COMMON}
${MU_STRUCT}
@group(1) @binding(1) var<storage, read> mEntries: array<vec4u>;
@group(1) @binding(2) var<storage, read> mCtl: array<u32>;
@group(1) @binding(3) var<uniform> mu: MU;
/// Which control-buffer base the draw reads (a list id; the solid prepass draws from list 0's base).
override M_BASE: u32 = 0u;

fn mRadius(kind: u32) -> f32 { return select(select(select(mu.radii.x, mu.radii.y, kind == 1u), mu.radii.z, kind == 2u), mu.goo.x, kind == 3u); }
fn mCamRight() -> vec3f { return vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]); }
fn mCamUp() -> vec3f { return vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]); }
fn mCamFwd() -> vec3f { return -vec3f(frame.view[0][2], frame.view[1][2], frame.view[2][2]); }
fn mHash(x: u32) -> f32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32(((h >> 22u) ^ h) & 0xffffffu) / 16777216.0;
}

struct GrainMat { albedo: vec3f, rough: f32, metal: f32 };
fn mGrainMat(kind: u32, variant: u32, seed: u32) -> GrainMat {
  if (kind == 2u) {
    if (variant == 1u) { return GrainMat(mu.bearing.rgb, mu.bearing.w, 1.0); }
    return GrainMat(mu.glint.rgb, mu.glint.w, 0.0);
  }
  // sand (vfx palette #D6BE8E): per-grain brightness and warmth, a few odd dark or pale grains
  let h0 = mHash(seed);
  let h1 = mHash(seed ^ 0x9e37u);
  let h2 = mHash(seed ^ 0x51edu);
  var c = mu.sand.rgb * (1.0 + (h0 - 0.5) * 2.0 * mu.sandVar.x);
  c *= vec3f(1.0 + (h1 - 0.5) * mu.sandVar.y, 1.0, 1.0 - (h1 - 0.5) * mu.sandVar.y);
  if (h2 < mu.sandVar.z) { c = select(c * 0.45, mix(c, vec3f(0.85, 0.82, 0.78), 0.6), h2 < mu.sandVar.z * 0.4); }
  return GrainMat(c, mu.sand.w, 0.0);
}

struct GOut {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) @interpolate(flat) center: vec4f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) packed: u32,
};

const M_CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

/// Camera-facing quad around a grain; 'front' pushes it to the sphere's front (flat-depth far grains).
fn mQuad(vi: u32, ii: u32, scale: f32, front: bool) -> GOut {
  let e = mEntries[mCtl[C_BASES + M_BASE] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let kind = e.w & 3u;
  let r = mRadius(kind);
  let corner = M_CORNERS[vi];
  let d = max(length(c), 1e-4);
  // a sphere's perspective silhouette is a little wider than r: r / sqrt(1 − (r/d)²)
  let s = r * scale / sqrt(max(1.0 - (r / d) * (r / d), 0.05));
  var p = c + (mCamRight() * corner.x + mCamUp() * corner.y) * s;
  if (front) { p -= (c / d) * r; }
  var o: GOut;
  o.clip = frame.viewProj * vec4f(p, 1.0);
  o.rel = p;
  o.center = vec4f(c, r);
  o.uv = corner;
  o.packed = e.w;
  return o;
}

@vertex fn vs_grain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut { return mQuad(vi, ii, 1.15, false); }
@vertex fn vs_grain_far(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  // one triangle around the disc (half the vertices of a quad; these grains are 1–1.5 px)
  let tri = array<vec2f, 3>(vec2f(0.0, 2.0), vec2f(-1.7320508, -1.0), vec2f(1.7320508, -1.0));
  let e = mEntries[mCtl[C_BASES + M_BASE] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let r = mRadius(e.w & 3u);
  let k = tri[vi];
  let d = max(length(c), 1e-4);
  // drawn 35 % larger: a packed surface layer must cover (the layers under it are culled as buried)
  let p = c + (mCamRight() * k.x + mCamUp() * k.y) * r * 1.35 - (c / d) * r;
  var o: GOut;
  o.clip = frame.viewProj * vec4f(p, 1.0);
  o.rel = p;
  o.center = vec4f(c, r);
  o.uv = k;
  o.packed = e.w;
  return o;
}
/// The look's half-res depth prepass: flat quads at the grain's front (AO, fog and DOF see the piles).
@vertex fn vs_grain_pre(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut { return mQuad(vi, ii, 1.0, true); }
@fragment fn fs_grain_pre(i: GOut) { if (dot(i.uv, i.uv) > 1.0) { discard; } }

/// A distant grain as one point (1 px): the vertex is the grain's front; normal faces the camera, tilted up.
struct POut { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) @interpolate(flat) packed: u32 };
fn mPoint(ii: u32) -> POut {
  let e = mEntries[mCtl[C_BASES + M_BASE] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let r = mRadius(e.w & 3u);
  let p = c - normalize(c) * r;
  return POut(frame.viewProj * vec4f(p, 1.0), p, e.w);
}
@vertex fn vs_grain_point(@builtin(instance_index) ii: u32) -> POut { return mPoint(ii); }
@vertex fn vs_grain_point_pre(@builtin(instance_index) ii: u32) -> @builtin(position) vec4f { return mPoint(ii).clip; }
@fragment fn fs_grain_point(i: POut) -> @location(0) vec4f {
  let n = normalize(normalize(-i.rel) + vec3f(0.0, 0.6, 0.0));
  return vec4f(xrayDim(mShadeLite(i.rel, n, i.packed)), cutCoverage(i.rel));
}

/// Distant grains (points and flat quads, <= 1.5 px): key light with the shadow map (one PCF tap), set shadow, the set
/// IBL or Studio hemisphere with GTAO, and the grain's burial occlusion. Skips the SDF marches, practical lamps and
/// clustered lights of the full shade(): a pixel is a grain or less, so those terms don't read, and they cost
/// most of the time at a million grains.
fn mShadeLite(rel: vec3f, n: vec3f, packed: u32) -> vec3f {
  let gm = mGrainMat(packed & 3u, (packed >> 2u) & 3u, packed >> 20u);
  let occ = mix(1.0, f32((packed >> 4u) & 255u) / 255.0, mu.sandVar.w);
  let v = normalize(-rel);
  let sp = frame.shadowMat * vec4f(rel + n * frame.params.z * 2.0, 1.0);
  let suv = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
  let inside = all(suv > vec2f(0.0)) && all(suv < vec2f(1.0)) && sp.z <= 1.0;
  let tap = textureSampleCompareLevel(shadowMap, shadowSampler, clamp(suv, vec2f(0.0), vec2f(1.0)), sp.z - 0.0002);
  let sh = select(1.0, tap, inside) * setShadowAt(rel, n);
  let ao = lookAo(rel);
  var c = brdf(n, v, frame.key.xyz, gm.albedo, gm.rough, gm.metal) * frame.keyColor.rgb * frame.key.w * sh * ao.y * mix(1.0, occ, 0.6);
  c += brdf(n, v, frame.fill.xyz, gm.albedo, gm.rough, gm.metal) * frame.keyColor.rgb * frame.fill.w * ao.x;
  var amb: vec3f;
  if (look.p0.z > 0.5) { amb = iblDiffuseAt(n); } else {
    let up = n.y * 0.5 + 0.5;
    amb = mix(frame.ground.rgb * frame.horizon.rgb * 0.9, frame.skyTop.rgb, up) * 0.55 * (0.6 + 0.4 * sh);
  }
  let gd = lookGiDiffuse(rel);
  if (gd.x >= 0.0) { amb = mix(amb, gd, look.gi.x); }
  c += amb * gm.albedo * (1.0 - gm.metal) * ao.x * occ;
  return c;
}

fn mShadeGrain(rel: vec3f, n: vec3f, packed: u32) -> vec3f {
  let kind = packed & 3u;
  let gm = mGrainMat(kind, (packed >> 2u) & 3u, packed >> 20u);
  let occ = f32((packed >> 4u) & 255u) / 255.0;
  let ao = mix(1.0, occ, mu.sandVar.w);
  var c = shade(rel, n, gm.albedo * mix(1.0, ao, 0.5), gm.rough, gm.metal, n);
  return c * mix(1.0, ao, 0.6);
}

struct GFrag { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };

/// Near grains and marble impostors: exact ray-sphere hit (depth and normal), anti-aliased silhouette through
/// alpha-to-coverage like the parts' decal edges.
@fragment fn fs_grain(i: GOut) -> GFrag {
  let d = normalize(i.rel);
  let c = i.center.xyz;
  let r = i.center.w;
  let b = dot(d, c);
  let perp = length(c - d * b);
  let pxSize = max(b, 1e-3) / mu.px.x; // one pixel at this distance (m)
  let alpha = clamp(0.5 - (perp - r) / pxSize, 0.0, 1.0);
  if (alpha <= 0.0) { discard; }
  let h = max(b * b - dot(c, c) + r * r, 0.0);
  let t = b - sqrt(h);
  let p = d * t;
  let n = normalize(p - c);
  let clip = frame.viewProj * vec4f(p, 1.0);
  var col = mShadeGrain(p, n, i.packed);
  col = xrayDim(col);
  return GFrag(vec4f(col, alpha * cutCoverage(p)), clip.z / clip.w);
}

/// Far grains (under ~1.5 px): flat quads, no depth write from the shader (early depth test stays on).
@fragment fn fs_grain_far(i: GOut) -> @location(0) vec4f {
  let q = dot(i.uv, i.uv);
  let n = normalize(mCamRight() * i.uv.x + mCamUp() * i.uv.y - normalize(i.center.xyz) * sqrt(max(1.0 - q, 0.0)));
  let col = xrayDim(mShadeLite(i.rel, n, i.packed));
  return vec4f(col, clamp((1.0 - q) * 3.0, 0.0, 1.0) * cutCoverage(i.rel));
}

/// GLINT marbles near the camera: the real 'marble' mesh (texture set, swirl) through the part vertex path; the
/// fragment stage is the part shader's fs_part. Each grain gets a fixed random orientation from its seed.
@vertex fn vs_marble_mesh(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f, @builtin(instance_index) ii: u32) -> VOut {
  let e = mEntries[mCtl[C_BASES + M_BASE] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let seed = e.w >> 20u;
  let ax = normalize(vec3f(mHash(seed) - 0.5, mHash(seed ^ 77u) - 0.5, mHash(seed ^ 991u) - 0.5) + vec3f(1e-3));
  let ang = mHash(seed ^ 4242u) * 6.2831853;
  var inst: Inst;
  inst.pos = c + frame.eye.xyz;
  inst.mesh = 0u;
  inst.rot = vec4f(ax * sin(ang * 0.5), cos(ang * 0.5));
  inst.size = vec3f(1.0);
  inst.color = 0xffffffffu;
  inst.mat = 0u;
  inst.outline = 0u;
  inst.body = -1;
  inst.radius = mu.radii.z;
  vtxTanCode = nrm.w;
  return vertexWith(inst, Pose(inst.pos, inst.rot), pos, nrm.xyz, vcol, vmat, uv);
}
`;

/** Shadow-map casters (own layout, group 0): grains as light-facing quads, depth only. */
export const SHADOW_WGSL = /* wgsl */ `
${FRAME_WGSL}
${COMMON}
${MU_STRUCT}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> mEntries: array<vec4u>;
@group(0) @binding(2) var<storage, read> mCtl: array<u32>;
@group(0) @binding(3) var<uniform> mu: MU;
const M_CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
/// A caster's radius by kind: sand, water (R5, M5), marble, goo (X5, M5).
fn sRadius(kind: u32) -> f32 { return select(select(select(mu.radii.x, mu.radii.y, kind == 1u), mu.radii.z, kind == 2u), mu.goo.x, kind == 3u); }

struct SOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs_shadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  let e = mEntries[mCtl[C_BASES + L_SHADOW] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let r = sRadius(e.w & 3u); // R5 (M5): + water; X5: + goo
  let l = frame.key.xyz;
  let a = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9);
  let t1 = normalize(cross(l, a));
  let t2 = cross(l, t1);
  let k = M_CORNERS[vi];
  return SOut(frame.shadowMat * vec4f(c + (t1 * k.x + t2 * k.y) * r, 1.0), k);
}
@fragment fn fs_shadow(i: SOut) { if (dot(i.uv, i.uv) > 1.0) { discard; } }
@vertex fn vs_shadow_point(@builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let e = mEntries[mCtl[C_BASES + L_SHADOW_PT] + ii];
  // a grain's far side (away from the light) stands in for the depth bias points can't have; R5 (M5): + the water radius
  return frame.shadowMat * vec4f(bitcast<vec3f>(e.xyz) - frame.key.xyz * (sRadius(e.w & 3u) + frame.params.z * 2.0), 1.0);
}
`;

/** Water splats (own layout, group 0): sphere depth (nearest wins) and additive thickness + foam. */
export const FLUID_SPLAT_WGSL = /* wgsl */ `
${FRAME_WGSL}
${COMMON}
${MU_STRUCT}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> mEntries: array<vec4u>;
@group(0) @binding(2) var<storage, read> mCtl: array<u32>;
@group(0) @binding(3) var<uniform> mu: MU;
@group(0) @binding(4) var sceneDepth: texture_depth_multisampled_2d;
const M_CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn mCamRight() -> vec3f { return vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]); }
fn mCamUp() -> vec3f { return vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]); }

struct WOut {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) @interpolate(flat) center: vec4f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) foam: f32,
  @location(4) @interpolate(flat) goo: f32,
};

fn wQuad(vi: u32, ii: u32, scale: f32) -> WOut {
  let e = mEntries[mCtl[C_BASES + L_WATER] + ii];
  let c = bitcast<vec3f>(e.xyz);
  let goo = (e.w & 3u) == 3u; // X5: goo shares the fluid list
  let r = select(mu.radii.y, mu.goo.x, goo) * scale;
  let k = M_CORNERS[vi];
  let d = max(length(c), 1e-4);
  let s = r / sqrt(max(1.0 - (r / d) * (r / d), 0.05));
  let p = c + (mCamRight() * k.x + mCamUp() * k.y) * s;
  var o: WOut;
  o.clip = frame.viewProj * vec4f(p, 1.0);
  o.rel = p;
  o.center = vec4f(c, r);
  o.uv = k;
  o.foam = f32((e.w >> 4u) & 255u) / 255.0;
  o.goo = select(0.0, 1.0, goo);
  return o;
}

/// Opaque scene depth at this pixel (the MSAA depth's sample 0; the splat targets may be half resolution).
fn sceneZ(frag: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(sceneDepth));
  let q = vec2i(clamp(frag / mu.water2.z, vec2f(0.0), dims - 1.0));
  return textureLoad(sceneDepth, q, 0);
}

@vertex fn vs_depth(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WOut { return wQuad(vi, ii, mu.radii.w); }

@fragment fn fs_depth(i: WOut) -> @builtin(frag_depth) f32 {
  let d = normalize(i.rel);
  let c = i.center.xyz;
  let r = i.center.w;
  let b = dot(d, c);
  let h = b * b - dot(c, c) + r * r;
  if (h < 0.0) { discard; }
  let p = d * (b - sqrt(h));
  let clip = frame.viewProj * vec4f(p, 1.0);
  let z = clip.z / clip.w;
  if (z >= sceneZ(i.clip.xy)) { discard; }
  return z;
}

@vertex fn vs_thick(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WOut { return wQuad(vi, ii, mu.radii.w * 1.4); }

@fragment fn fs_thick(i: WOut) -> @location(0) vec4f {
  let q = dot(i.uv, i.uv);
  if (q >= 1.0) { discard; }
  let clip = frame.viewProj * vec4f(i.center.xyz - normalize(i.center.xyz) * i.center.w, 1.0);
  if (clip.z / clip.w >= sceneZ(i.clip.xy * 2.0)) { discard; }
  let t = mix(mu.water2.x, mu.goo.y, i.goo) * sqrt(1.0 - q);
  return vec4f(t, t * i.foam, t * i.goo, 0.0); // X5: b = goo thickness
}
`;

/** Bilateral smoothing of the splatted depth (compute, own layout). */
export const FLUID_SMOOTH_WGSL = /* wgsl */ `
${FRAME_WGSL}
${MU_STRUCT}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> mu: MU;
@group(0) @binding(2) var srcDepth: texture_depth_2d;
@group(0) @binding(3) var srcLin: texture_2d<f32>;
@group(0) @binding(4) var thick: texture_2d<f32>;
@group(0) @binding(5) var dst: texture_storage_2d<rgba32float, write>;
struct Dir { d: vec4i };
@group(0) @binding(6) var<uniform> dir: Dir;

const FAR: f32 = 1e9;

/// Linear view depth (m along the camera axis) of a depth-buffer value at this pixel.
fn linearize(q: vec2i, z: f32) -> f32 {
  if (z >= 1.0) { return FAR; }
  let dims = vec2f(textureDimensions(srcDepth));
  let ndc = vec2f((f32(q.x) + 0.5) / dims.x * 2.0 - 1.0, 1.0 - (f32(q.y) + 0.5) / dims.y * 2.0);
  let w = frame.invViewProj * vec4f(ndc, z, 1.0);
  let rel = w.xyz / w.w;
  return -(frame.view * vec4f(rel, 1.0)).z;
}

@compute @workgroup_size(8, 8) fn linear(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(srcDepth);
  if (any(g.xy >= dims)) { return; }
  let q = vec2i(g.xy);
  textureStore(dst, q, vec4f(linearize(q, textureLoad(srcDepth, q, 0)), 0.0, 0.0, 0.0));
}

/// One separable bilateral pass along dir.d.xy. The radius follows the particle's projected size (a few radii
/// across), the range term keeps silhouettes and layered sheets apart. The last pass (dir.d.z = 1) also packs the
/// thickness and foam (half-res, bilinear) for the composite.
@compute @workgroup_size(8, 8) fn blur(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(srcLin);
  if (any(g.xy >= dims)) { return; }
  let q = vec2i(g.xy);
  let z0 = textureLoad(srcLin, q, 0).x;
  var outZ = z0;
  if (z0 < FAR * 0.5) {
    let r = mu.radii.y * mu.radii.w;
    let rpx = r / max(z0, 1e-3) * mu.px.x * mu.water2.z;
    let radius = clamp(rpx * mu.water2.w, 1.0, 24.0);
    let n = i32(ceil(radius));
    let step = select(1, 2, n > 12);
    let sigS = radius * 0.5;
    let sigZ = r * 1.5;
    var acc = 0.0;
    var wsum = 0.0;
    for (var k = -n; k <= n; k += step) {
      let p = clamp(q + dir.d.xy * k, vec2i(0), vec2i(dims) - 1);
      let z = textureLoad(srcLin, p, 0).x;
      if (z >= FAR * 0.5) { continue; }
      let dz = (z - z0) / sigZ;
      if (abs(dz) > 3.0) { continue; }
      let fk = f32(k) / sigS;
      let w = exp(-0.5 * fk * fk) * exp(-0.5 * dz * dz);
      acc += z * w;
      wsum += w;
    }
    outZ = acc / max(wsum, 1e-6);
  }
  var o = vec4f(outZ, 0.0, 0.0, 0.0);
  if (dir.d.z == 1) {
    let td = vec2f(textureDimensions(thick));
    let uv = (vec2f(q) + 0.5) / vec2f(dims) * td - 0.5;
    let b = vec2i(floor(uv));
    let f = fract(uv);
    var t = vec3f(0.0);
    for (var k = 0; k < 4; k++) {
      let o2 = vec2i(k & 1, k >> 1);
      let s = textureLoad(thick, clamp(b + o2, vec2i(0), vec2i(td) - 1), 0).xyz;
      t += s * select(1.0 - f.x, f.x, o2.x == 1) * select(1.0 - f.y, f.y, o2.y == 1);
    }
    // w: 0 = no fluid, else 1 + the goo share of the thickness (X5)
    o = vec4f(outZ, t.x, t.y / max(t.x, 1e-5), select(0.0, 1.0 + clamp(t.z / max(t.x, 1e-5), 0.0, 1.0), outZ < FAR * 0.5));
  }
  textureStore(dst, q, o);
}
`;

/** The water composite (spliced after the part shader; group 1 = MU + the smoothed water + the opaque scene). */
export const FLUID_COMPOSITE_WGSL = /* wgsl */ `
@group(1) @binding(4) var waterTex: texture_2d<f32>;
@group(1) @binding(5) var sceneTex: texture_2d<f32>;

struct WsOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vs_water(@builtin(vertex_index) vi: u32) -> WsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return WsOut(vec4f(p, 0.0, 1.0), p);
}

fn wRel(q: vec2i, z: f32) -> vec3f {
  let dims = vec2f(textureDimensions(waterTex));
  let ndc = vec2f((f32(q.x) + 0.5) / dims.x * 2.0 - 1.0, 1.0 - (f32(q.y) + 0.5) / dims.y * 2.0);
  let w = frame.invViewProj * vec4f(ndc, 0.5, 1.0);
  let d = w.xyz / w.w;
  return d * (z / max(dot(d, mCamFwd()), 1e-4));
}

struct WFrag { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };

/// Resolve: the water's final colour over the opaque scene, into a non-MSAA copy (glass refracts it too); pixels without
/// water copy the scene.
@fragment fn fs_water_resolve(i: WsOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(waterTex));
  let q = clamp(vec2i(i.clip.xy * mu.water2.z), vec2i(0), dims - 1);
  let w = textureLoad(waterTex, q, 0);
  if (w.w < 0.5) { return vec4f(textureLoad(sceneTex, vec2i(i.clip.xy), 0).rgb, 1.0); }
  return vec4f(waterShade(i, q, w), 1.0);
}

/// Blit into the MSAA late pass: the resolved water where there is water, at its depth (binding 5 = the resolve).
@fragment fn fs_water_blit(i: WsOut) -> WFrag {
  let dims = vec2i(textureDimensions(waterTex));
  let q = clamp(vec2i(i.clip.xy * mu.water2.z), vec2i(0), dims - 1);
  let w = textureLoad(waterTex, q, 0);
  if (w.w < 0.5) { discard; }
  let p = wRel(q, w.x);
  let clip = frame.viewProj * vec4f(p, 1.0);
  return WFrag(vec4f(textureLoad(sceneTex, vec2i(i.clip.xy), 0).rgb, 1.0), clamp(clip.z / clip.w, 0.0, 1.0));
}

fn waterShade(i: WsOut, q: vec2i, w: vec4f) -> vec3f {
  let dims = vec2i(textureDimensions(waterTex));
  let p = wRel(q, w.x);
  // normal from the smoothed depth: the smaller difference on each axis (no smearing across silhouettes)
  let px1 = textureLoad(waterTex, min(q + vec2i(1, 0), dims - 1), 0);
  let px0 = textureLoad(waterTex, max(q - vec2i(1, 0), vec2i(0)), 0);
  let py1 = textureLoad(waterTex, min(q + vec2i(0, 1), dims - 1), 0);
  let py0 = textureLoad(waterTex, max(q - vec2i(0, 1), vec2i(0)), 0);
  var dx = wRel(q + vec2i(1, 0), px1.x) - p;
  let dx0 = p - wRel(q - vec2i(1, 0), px0.x);
  if (px1.w < 0.5 || (px0.w > 0.5 && abs(dx0.z) + abs(dx0.y) < abs(dx.z) + abs(dx.y))) { dx = dx0; }
  var dy = wRel(q + vec2i(0, 1), py1.x) - p;
  let dy0 = p - wRel(q - vec2i(0, 1), py0.x);
  if (py1.w < 0.5 || (py0.w > 0.5 && abs(dy0.z) + abs(dy0.x) < abs(dy.z) + abs(dy.x))) { dy = dy0; }
  let v = normalize(-p);
  // degenerate neighbours (a one-pixel sliver of water) give no cross product: face the camera instead of NaN
  let nc = cross(dy, dx);
  let nl = length(nc);
  var n = select(v, nc / max(nl, 1e-20), nl > 1e-14);
  if (dot(n, v) < 0.0) { n = -n; }
  let ndv = max(dot(n, v), 0.0);
  let thick = w.y;
  let foam = clamp(w.z * mu.water2.y, 0.0, 1.0);
  // refraction: bend the opaque scene behind by the view-space normal, more through thicker water
  let sdims = vec2f(textureDimensions(sceneTex));
  let uv = i.clip.xy / sdims;
  let nv = (frame.view * vec4f(n, 0.0)).xy;
  let off = vec2f(nv.x, -nv.y) * mu.water.w * clamp(thick * 6.0, 0.15, 1.0);
  let behind = textureSampleLevel(sceneTex, decalSampler, clamp(uv + off, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
  let straight = textureSampleLevel(sceneTex, decalSampler, uv, 0.0).rgb;
  // Beer–Lambert: clear water with the brief's 8 % Beam tint (deeper = bluer)
  let trans = exp(-mu.water.xyz * thick);
  var c = mix(straight, behind, clamp(thick * 40.0, 0.0, 1.0)) * trans;
  // in-scattering: what the water absorbs comes back as a soft Beam-tinted body colour lit by the room
  var amb = skyColor(n) * 0.7;
  if (look.p0.z > 0.5) { amb = iblDiffuseAt(n); }
  c += (1.0 - trans) * vec3f(0.12, 0.62, 0.72) * amb * 0.8;
  // reflection: Fresnel (water F0 0.02) × the set IBL or the Studio sky, plus the key light's highlight
  let f = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  let rv = reflect(-v, n);
  var refl = skyColor(rv);
  if (look.p0.z > 0.5) { refl = iblSpecAt(rv, 0.04); }
  let sh = shadowAt(p, n);
  c = mix(c, refl, f) + specOnly(n, v, frame.key.xyz, 0.06) * frame.keyColor.rgb * frame.key.w * sh;
  c += specOnly(n, v, frame.fill.xyz, 0.1) * frame.keyColor.rgb * frame.fill.w * 0.5;
  // readability: a free surface facing up catches a little more sky, and the outline (where the water ends on
  // screen) gets a thin meniscus highlight
  let up = smoothstep(0.6, 0.95, n.y);
  c = mix(c, refl, up * 0.12);
  let edge = select(0.0, 1.0, px1.w < 0.5 || px0.w < 0.5 || py1.w < 0.5 || py0.w < 0.5);
  c += refl * edge * 0.35;
  // foam (#F4FBFF): a lit white layer
  if (foam > 0.01) {
    let fc = shade(p, n, vec3f(0.9, 0.96, 1.0), 0.7, 0.0, n);
    c = mix(c, fc, foam);
  }
  // X5 (M5): goo (kn_slime #7DFF7A, transmission 0.6, subsurface): a glossy green body that lets a little of the scene
  // through, green-tinted, glows where the light passes through thin parts and keeps a sharp wet highlight
  let g = clamp(w.w - 1.0, 0.0, 1.0);
  if (g > 0.001) {
    let slime = mu.gooCol.rgb;
    let tg = exp(-mu.gooCol.w * thick);
    let body = shade(p, n, slime, 0.16, 0.0, n);
    let ndl = dot(n, frame.key.xyz);
    let wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
    var sss = slime * frame.keyColor.rgb * frame.key.w * wrap * (1.0 - tg * 0.5) * mu.goo.z * 0.3;
    sss += slime * amb * mu.goo.z * 0.35;
    let seen = mix(straight, behind, clamp(thick * 60.0, 0.0, 1.0)) * slime * tg;
    var cg = mix(body + sss, seen + sss * 0.5, mu.goo.w * tg);
    let fg = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    cg = mix(cg, refl, fg * 0.8) + specOnly(n, v, frame.key.xyz, 0.12) * frame.keyColor.rgb * frame.key.w * sh;
    cg += refl * edge * 0.2;
    c = mix(c, cg, g);
  }
  // thin edges fade into the scene (goo keeps a firmer edge)
  c = mix(straight, c, clamp(thick * mix(120.0, 400.0, g), 0.0, 1.0));
  // debug views (MATTER_LOOK.debug): 1 water pixels red, 2 thickness (× 5), 3 transmittance, 4 normal
  if (mu.px.w < -0.5) {
    let dm = -mu.px.w;
    c = vec3f(1.0, 0.0, 0.0);
    if (dm > 1.5) { c = vec3f(thick * 5.0); }
    if (dm > 2.5) { c = trans; }
    if (dm > 3.5) { c = n * 0.5 + 0.5; }
  }
  // never let a NaN through (it would turn black and smear through TAA)
  let bad = any((bitcast<vec3u>(c) & vec3u(0x7f800000u)) == vec3u(0x7f800000u));
  return select(xrayDim(c), straight, bad);
}
`;
