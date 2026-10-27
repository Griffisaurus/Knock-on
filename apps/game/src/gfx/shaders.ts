// WGSL for the main view: shared frame uniform, GPU culling, the part shader (uber-material v1 +
// M2: transmission, section box with capped cut faces, cutaway, x-ray, selection mask, GPU skinning),
// the Studio floor and sky. Positions on the GPU are camera-relative (RENDERING §4.3).
// M3 (L3): the D79 look's bind group 2 (texture sets, detail layer, set IBL, AO, contact, set shadow) is
// spliced into SHADE_WGSL from look/wgsl.ts.

import { LOOK_BINDINGS_WGSL, LOOK_FN_WGSL, LOOK_SURFACE_WGSL, LOOK_TANGENT_WGSL } from './look/wgsl.ts';

/** Clustered forward+ (RENDERING §6.2): 16 × 9 screen tiles × 24 log depth slices, ≤ 64 lights per cluster. */
export const MAX_LIGHTS = 1024;
export const CLUSTER = { x: 16, y: 9, z: 24, per: 64, near: 0.05, far: 300 } as const;
export const CLUSTERS = CLUSTER.x * CLUSTER.y * CLUSTER.z;

/** Byte layout of `Frame` (keep in sync with renderer.ts writeFrame). */
export const FRAME_BYTES = 1136; // R5 (M5): + m5, stasis volumes, singularities, the wetness rect (was 528); RENDER (beta polish): + far cascade, Earth (was 1008)
/** RENDER (beta polish): float offsets of the fields appended after `wet` (renderer.ts writeFrame). */
export const FRAME_FAR = 252; // shadowFar (16 floats), then shadowFarP (4), nearP (4), earthSpin (4), earthSun (4)
/** R5 (M5): stasis volumes and singularities the part shader knows about (renderer.m5Frame). */
export const FRAME_STASIS = 8;
export const FRAME_SING = 4;

export const FRAME_WGSL = /* wgsl */ `
struct Light { pos: vec4f, color: vec4f };
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  shadowMat: mat4x4f,
  eye: vec4f,        // world eye, w = time (s)
  key: vec4f,        // direction to the key light, w = intensity
  fill: vec4f,
  rim: vec4f,
  keyColor: vec4f,
  rimColor: vec4f,
  skyTop: vec4f,
  horizon: vec4f,
  ground: vec4f,     // floor albedo, w = grid etch strength (signed)
  params: vec4f,     // x exposure, y run mode, z shadow texel size, w build-grid alpha
  cursor: vec4f,     // build cursor (world), w = 1 when active
  hover: vec4u,      // x (unused since M2 outlines), y unused, z light count
  view: mat4x4f,     // camera-relative view (clusters)
  cluster: vec4f,    // x tan(fovY/2), y aspect, z near, w far
  secMin: vec4f,     // section box min (world), w = 1 when the box is on
  secMax: vec4f,     // section box max (world)
  cut: vec4f,        // cutaway focus (world), w = radius at the focus (0 = off)
  misc: vec4f,       // x x-ray mode (0 off, 1 links, 2 all), y refraction strength, z floor on, w unused
  // R5 (M5, vfx §7.1 / §7.3): x stasis volumes, y singularities, z body-stretch scale (0 under Reduced motion), w time
  m5: vec4f,
  stasis: array<vec4f, 24>, // 8 × (centre, half, rotation quat): bodies inside get the "time-stopped" look
  sing: array<vec4f, 4>,    // xyz core (world), w strength 0–1: bodies within 1 m stretch along the radius (render only)
  wet: vec4f,               // R5 (M5): the wetness grid (gfx/wetness.ts): x0, z0 (world), cell (m), n cells per side (0 = off)
  // RENDER (beta polish, D125): the far key-light cascade (camera-relative → its clip) and its parameters: x on, y fade
  // start (m from the eye), z fade end (= the shadow distance), w texel (m); the near map (shadowMat) covers the focus
  shadowFar: mat4x4f,
  shadowFarP: vec4f,
  nearP: vec4f,             // x near-map depth bias, y far-map depth bias (both clip-depth units), zw unused
  // RENDER (beta polish, D126): the backdrop Earth's runtime lighting (gfx/earth.ts): spin axis (world) + angle (rad);
  // the direction to its sun (world, the set's art-directed phase applied) + mode (0 baked texture, 1 rebuilt from the
  // baked texture, 2 runtime data maps)
  earthSpin: vec4f,
  earthSun: vec4f,
};
const CL_X: u32 = ${CLUSTER.x}u;
const CL_Y: u32 = ${CLUSTER.y}u;
const CL_Z: u32 = ${CLUSTER.z}u;
const CL_PER: u32 = ${CLUSTER.per}u;
`;

export const INST_WGSL = /* wgsl */ `
struct Inst {
  pos: vec3f, mesh: u32,
  rot: vec4f,
  size: vec3f, color: u32,
  mat: u32,      // roughness u8 | metallic u8 << 8 | emissive u8 << 16 | flags u8 << 24
  outline: u32,  // rgba8 (a = 0: none); drawn by the selection mask since M2
  body: i32,     // index into the run transforms, -1 = static (skinned instances: first bone)
  radius: f32,   // bounding sphere radius (m)
};
const FLAG_HIDDEN: u32 = 1u;
const FLAG_BEVEL: u32 = 2u;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
fn unpackColor(c: u32) -> vec4f {
  let v = unpack4x8unorm(c);
  return vec4f(pow(v.rgb, vec3f(2.2)), v.a);
}
`;

// ---- culling -----------------------------------------------------------------------------------------

export const CULL_WGSL = /* wgsl */ `
${INST_WGSL}
struct CullView {
  planes: array<vec4f, 6>,
  eye: vec4f,
  // x projScale (screen fraction per radius/distance), y impostor size (camera view), RENDER (beta polish, D125):
  // z shadow-caster box-proxy size, w shadow-caster skip size (both projected radius / half-height; 0 = off)
  params: vec4f,
  counts: vec4u,   // x instance count, y run mode, z fixed LOD + 1 (0 = by distance), w bucket count
  box0: vec4f,     // section box min (world), w = 1 when on
  box1: vec4f,     // section box max
  // RENDER (beta polish, D125): shadow views: x box-proxy radius, y skip radius (m: in that map's texels), z 1 = always
  // the coarsest LOD (the far map); every view: w 1 = M5's sizing by inst.radius (debug, before/after)
  shadowR: vec4f,
  // the camera's frustum (shadow distance as its far plane) and the shadow direction (xyz, −key) with the longest shadow
  // (w, m; 0 = no test): a caster counts only if its sphere, swept along its shadow, reaches the view
  camPlanes: array<vec4f, 6>,
  sweep: vec4f,
  // a perspective map (the shadowed lamp): xyz its position (world), w its texel per metre of distance (0 = ortho)
  lamp: vec4f,
};
// RENDER (beta polish, D125): + the mesh's own LOD0 bounding sphere (centre, radius, mesh space): inst.radius is
// 0.5 × |size|, which assumes a unit mesh, while art meshes are in metres (0.87 m for every art part at size 1)
struct MeshEntry { firstBucket: u32, lodCount: u32, switch0: f32, switch1: f32, radius: f32, cx: f32, cy: f32, cz: f32 };
@group(0) @binding(0) var<uniform> view: CullView;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(0) @binding(2) var<storage, read> xf: array<f32>;
@group(0) @binding(3) var<storage, read> meshes: array<MeshEntry>;
@group(0) @binding(4) var<storage, read> bucketBase: array<u32>;
@group(0) @binding(5) var<storage, read_write> args: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> visible: array<u32>;

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let i = gid.x + gid.y * nwg.x * 64u;
  if (i >= view.counts.x) { return; }
  let inst = insts[i];
  if (((inst.mat >> 24u) & FLAG_HIDDEN) != 0u) { return; }
  var c = inst.pos;
  if (view.counts.y != 0u && inst.body >= 0) {
    // run mode: the instance's pos is a local offset in its body's frame
    let b = u32(inst.body) * 7u;
    c = vec3f(xf[b], xf[b + 1u], xf[b + 2u]) + qrot(vec4f(xf[b + 3u], xf[b + 4u], xf[b + 5u], xf[b + 6u]), inst.pos);
  }
  // RENDER (beta polish, D125): the instance's real bounding sphere (about its origin) from its mesh; frustum and section
  // tests keep inst.radius too when that is bigger (shape keys can grow a part past its LOD0 bounds)
  let m = meshes[inst.mesh];
  let smax = max(inst.size.x, max(inst.size.y, inst.size.z));
  let rMesh = m.radius * smax;
  let rReal = length(vec3f(m.cx, m.cy, m.cz) * inst.size) + rMesh;
  let legacy = view.shadowR.w > 0.5; // debug: the M5 sizing (inst.radius for everything)
  let r = select(max(inst.radius, rReal), inst.radius, legacy);
  if (view.box0.w > 0.5) {
    // section box: whole instances outside it are skipped (the fragment clip cuts the rest)
    let q = clamp(c, view.box0.xyz, view.box1.xyz) - c;
    if (dot(q, q) > r * r) { return; }
  }
  let rel = c - view.eye.xyz;
  for (var k = 0u; k < 6u; k++) {
    let p = view.planes[k];
    if (dot(p.xyz, rel) + p.w < -r) { return; }
  }
  if (view.sweep.w > 0.0) {
    for (var k = 0u; k < 6u; k++) {
      let p = view.camPlanes[k];
      if (dot(p.xyz, rel) + p.w + max(0.0, dot(p.xyz, view.sweep.xyz)) * view.sweep.w < -r) { return; }
    }
  }
  // S3 (M3): lodCount bit 8 = the mesh has an impostor bucket right after its LODs (gfx/impostor.ts)
  // RENDER (beta polish, D125): bit 9 = a shadow box-proxy bucket after those
  let lodCount = m.lodCount & 0xffu;
  var lod = 0u;
  if (view.counts.z > 0u) {
    lod = min(view.counts.z - 1u, lodCount - 1u);
  } else {
    // projected size from the camera (shadow views keep the camera's eye: a caster's shadow is about its own size on screen)
    // RENDER (beta polish, D125): projected size from the mesh's own radius (the thresholds were designed for real sizes)
    let s = select(rMesh, inst.radius, legacy) / max(length(rel), 1e-3) * view.params.x;
    if (lodCount > 1u && s < m.switch0) { lod = 1u; }
    if (lodCount > 2u && s < m.switch1) { lod = 2u; }
    // params.y: impostor size (projected radius / half-height, 0 = off): Arena and Megastructure only
    if ((m.lodCount & 0x100u) != 0u && s < view.params.y) { lod = lodCount; }
    if (view.params.z > 0.0) {
      // shadow casters: one LOD coarser than the camera would draw; a box proxy under params.z; skipped under params.w
      // (sub-pixel casters cast sub-pixel shadows)
      let sr = rMesh / max(length(rel), 1e-3) * view.params.x;
      let rm = rMesh;
      // a perspective map's texel grows with the distance from the lamp
      let tk = select(1.0, view.lamp.w * distance(c, view.lamp.xyz), view.lamp.w > 0.0);
      if (sr < view.params.w || rm < view.shadowR.y * tk) { return; }
      lod = select(min(lod + 1u, lodCount - 1u), lodCount - 1u, view.shadowR.z > 0.5); // z: coarsest LOD (the far map)
      if ((m.lodCount & 0x200u) != 0u && (sr < view.params.z || rm < view.shadowR.x * tk)) { lod = lodCount + select(0u, 1u, (m.lodCount & 0x100u) != 0u); }
    }
  }
  let b = m.firstBucket + lod;
  let slot = atomicAdd(&args[b * 5u + 1u], 1u);
  visible[bucketBase[b] + slot] = i;
}
`;

// ---- parts ------------------------------------------------------------------------------------------

export const PART_WGSL = /* wgsl */ `
${FRAME_WGSL}
${INST_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(0) @binding(2) var<storage, read> xf: array<f32>;
@group(0) @binding(3) var<storage, read> visible: array<u32>;
// part shape keys (M2): delta rows (f32) and per-instance data: [0] = weights base, [1 + instance] = morph
// slot (0xffffffff: none), weights at base + slot * 8
@group(0) @binding(10) var<storage, read> morphTable: array<f32>;
@group(0) @binding(11) var<storage, read> morphInst: array<u32>;
@group(1) @binding(0) var<uniform> bucket: vec4u;
${LOOK_TANGENT_WGSL}

struct Pose { pos: vec3f, rot: vec4f };
fn pose(inst: Inst) -> Pose {
  var p = Pose(inst.pos, inst.rot);
  if (frame.params.y > 0.5 && inst.body >= 0) {
    // run mode: compose the instance's local transform with its body's pose
    let b = u32(inst.body) * 7u;
    let br = vec4f(xf[b + 3u], xf[b + 4u], xf[b + 5u], xf[b + 6u]);
    p.pos = vec3f(xf[b], xf[b + 1u], xf[b + 2u]) + qrot(br, inst.pos);
    p.rot = qmul(br, inst.rot);
  }
  return p;
}

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) size: vec3f,
  @location(4) @interpolate(flat) rot: vec4f,
  @location(5) @interpolate(flat) color: vec4f,
  @location(6) @interpolate(flat) mat: vec4f,
  @location(7) @interpolate(flat) outline: vec4f, // selection-mask colour (vs_mask only)
  @location(8) uv: vec2f,
  @location(9) @interpolate(flat) kind: u32, // KIND_*: what the vertex material is
  @location(10) @interpolate(flat) look: u32, // L3 (M3): detail id | (texture-set layer + 1) << 8 (look/wgsl.ts)
  @location(11) tan: vec4f, // L3 (M3): glTF tangent (world), w = handedness; w = 0 without one
  @location(12) @interpolate(flat) stasis: u32, // R5 (M5): 1 + the stasis volume holding this instance's origin, 0 none
};

/// R5 (M5): which engaged STASIS FIELD holds a body (by its origin: the whole body takes the look, vfx §7.3); the
/// field's own hardware has its origin on the volume's floor, so a 5 mm inset at the bottom leaves it out.
fn stasisOf(wp: vec3f) -> u32 {
  for (var k = 0u; k < u32(frame.m5.x); k++) {
    let q = frame.stasis[k * 3u + 2u];
    let h = frame.stasis[k * 3u + 1u].xyz;
    let l = qrot(vec4f(-q.xyz, q.w), wp - frame.stasis[k * 3u].xyz);
    if (all(abs(l) <= h) && l.y > -h.y + 0.005) { return k + 1u; }
  }
  return 0u;
}
const KIND_INSTANCE: u32 = 0u;
const KIND_DECAL: u32 = 1u;
const KIND_SCREEN: u32 = 2u;
const KIND_MASTER: u32 = 3u;

fn vertexWith(inst: Inst, p: Pose, pos: vec3f, nrm: vec3f, vcol: vec4f, vmat: vec4f, uv: vec2f) -> VOut {
  // vmat.w (unorm8): 0 instance material, 64 decal, 128 screen, 255 master (MAT_KIND in meshes.ts)
  let kb = u32(round(vmat.w * 255.0));
  var kind = KIND_MASTER;
  if (kb == 0u) { kind = KIND_INSTANCE; } else if (kb < 96u) { kind = KIND_DECAL; } else if (kb < 192u) { kind = KIND_SCREEN; }
  var rel = p.pos - frame.eye.xyz + qrot(p.rot, pos * inst.size);
  // R5 (M5, vfx §7.1): bodies within 1 m of a running Singularity stretch up to 1.5 × along the radius (render only)
  for (var s = 0u; s < u32(frame.m5.y); s++) {
    let S = frame.sing[s];
    let dv = S.xyz - p.pos;
    let dist = length(dv);
    if (dist < 1.0 && dist > 0.15) { // (the device itself: its origin sits 0.115 m under the core)
      let dir = dv / dist;
      let lo = rel + frame.eye.xyz - p.pos;
      rel += dir * dot(lo, dir) * 0.5 * (1.0 - dist) * S.w * frame.m5.z;
    }
  }
  // decals and screen quads sit 0.2 mm off the face behind them; pulling them along the view ray (no
  // screen-space shift) wins the depth test against that face at any distance
  if (kind == KIND_DECAL || kind == KIND_SCREEN) { rel *= 0.9997; }
  var o: VOut;
  o.clip = frame.viewProj * vec4f(rel, 1.0);
  o.rel = rel;
  o.n = qrot(p.rot, nrm);
  o.local = pos;
  o.size = inst.size;
  o.rot = p.rot;
  o.color = unpackColor(inst.color) * vec4f(pow(vcol.rgb, vec3f(2.2)), vcol.a);
  let m = unpack4x8unorm(inst.mat);
  // art meshes carry their master material per vertex; blockout meshes use the instance's
  var mm = select(m.xyz, vmat.xyz, kind != KIND_INSTANCE);
  // L3 (M3): master kinds 224–255 carry a detail id (255 − kind); 192–223 a texture set too, whose
  // layer is in the red/green bytes (the set supplies albedo, roughness and metal)
  o.look = 0u;
  let tl = decodeTangent(nrm, vtxTanCode);
  o.tan = vec4f(qrot(p.rot, tl.xyz), tl.w);
  if (kb >= 192u) {
    if (kb >= 224u) {
      o.look = 255u - kb;
    } else {
      let layer = u32(round(vmat.x * 255.0)) + u32(round(vmat.y * 255.0)) * 256u;
      o.look = (223u - kb) | ((layer + 1u) << 8u);
      mm = vec3f(0.5, 0.0, vmat.z);
      o.color = unpackColor(inst.color);
    }
  }
  o.mat = vec4f(mm, f32(inst.mat >> 24u));
  // R5 (M5): icon screens read their LED icon from the instance's metal byte (SceneItem.icon; gfx/screens.ts)
  if (kind == KIND_SCREEN) { o.look = (inst.mat >> 8u) & 255u; }
  // R5 (M5): skinned LED vertices (emissive byte 251 + group, gfx/leds.ts) read their levels from the instance's rough byte
  let ez = u32(round(vmat.z * 255.0));
  o.stasis = stasisOf(p.pos);
  o.outline = vec4f(0.0);
  if (kind == KIND_MASTER && ez >= 251u && ez <= 254u) { o.outline = vec4f(f32(inst.mat & 255u), f32(ez - 251u), 0.0, 0.0); }
  o.uv = uv;
  o.kind = kind;
  return o;
}

fn vertex(idx: u32, pos: vec3f, nrm4: vec4f, vcol: vec4f, vmat: vec4f, uv: vec2f) -> VOut {
  let inst = insts[idx];
  vtxTanCode = nrm4.w; // L3 (M3): the packed glTF tangent (look/tangents.ts)
  return vertexWith(inst, pose(inst), pos, nrm4.xyz, vcol, vmat, uv);
}

/// Part shape keys: 'row' packs (delta offset << 3) | key count, 0xffffffff for vertices that never move.
struct PN { p: vec3f, n: vec3f };
fn partMorph(idx: u32, row: u32, p0: vec3f, n0: vec3f) -> PN {
  var r = PN(p0, n0);
  if (row == 0xffffffffu) { return r; }
  let slot = morphInst[1u + idx];
  if (slot == 0xffffffffu) { return r; }
  let off = row >> 3u;
  let wb = morphInst[0] + slot * 8u;
  for (var k = 0u; k < (row & 7u); k++) {
    let w = bitcast<f32>(morphInst[wb + k]);
    if (w != 0.0) {
      let o = off + k * 6u;
      r.p += w * vec3f(morphTable[o], morphTable[o + 1u], morphTable[o + 2u]);
      r.n += w * vec3f(morphTable[o + 3u], morphTable[o + 4u], morphTable[o + 5u]);
    }
  }
  return r;
}
fn vertexMorph(idx: u32, row: u32, pos: vec3f, nrm4: vec4f, vcol: vec4f, vmat: vec4f, uv: vec2f) -> VOut {
  let inst = insts[idx];
  let m = partMorph(idx, row, pos, nrm4.xyz);
  vtxTanCode = nrm4.w; // L3 (M3): the packed glTF tangent (look/tangents.ts)
  return vertexWith(inst, pose(inst), m.p, m.n, vcol, vmat, uv);
}

@vertex fn vs_scene(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f, @location(7) mrow: u32, @builtin(instance_index) ii: u32) -> VOut {
  return vertexMorph(visible[bucket.x + ii], mrow, pos, nrm, vcol, vmat, uv);
}

/// Overlay instances (ghosts, drones): drawn directly, no culling.
@vertex fn vs_overlay(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f, @builtin(instance_index) ii: u32) -> VOut {
  return vertex(ii, pos, nrm, vcol, vmat, uv);
}

/// CPU-listed instances (sorted glass): instance_index (= firstInstance) indexes the list in \`visible\`.
@vertex fn vs_list(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f, @builtin(instance_index) ii: u32) -> VOut {
  return vertex(visible[ii], pos, nrm, vcol, vmat, uv);
}

/// Selection mask: \`visible\` holds (instance, rgba8 colour) pairs.
@vertex fn vs_mask(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f, @location(7) mrow: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o = vertexMorph(visible[ii * 2u], mrow, pos, nrm, vcol, vmat, uv);
  o.outline = unpack4x8unorm(visible[ii * 2u + 1u]);
  return o;
}

// ---- GPU skinning (critters): bones are 3×4 row-major matrices in \`xf\` (12 floats each); the
// instance's \`body\` is its first bone. Bone matrices are in the instance's model space.
fn boneAt(b: u32) -> mat4x4f {
  let o = b * 12u;
  let r0 = vec4f(xf[o], xf[o + 1u], xf[o + 2u], xf[o + 3u]);
  let r1 = vec4f(xf[o + 4u], xf[o + 5u], xf[o + 6u], xf[o + 7u]);
  let r2 = vec4f(xf[o + 8u], xf[o + 9u], xf[o + 10u], xf[o + 11u]);
  return mat4x4f(vec4f(r0.x, r1.x, r2.x, 0.0), vec4f(r0.y, r1.y, r2.y, 0.0), vec4f(r0.z, r1.z, r2.z, 0.0), vec4f(r0.w, r1.w, r2.w, 1.0));
}
fn skinMat(base: u32, j: vec4u, w: vec4f) -> mat4x4f {
  return boneAt(base + j.x) * w.x + boneAt(base + j.y) * w.y + boneAt(base + j.z) * w.z + boneAt(base + j.w) * w.w;
}

/// Skinned critters. Shape keys first (bind space): the instance's 'mesh' word holds the shape-key count
/// and 'outline' the float offset of its weights in xf; 'morph' is the vertex's float offset into the
/// delta table (bound as 'visible'), T x (dpos, dnormal), or 0xffffffff for vertices without deltas.
@vertex fn vs_skin(@location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) vcol: vec4f, @location(3) vmat: vec4f, @location(4) uv: vec2f,
    @location(5) joints: vec4u, @location(6) weights: vec4f, @location(7) morph: u32, @builtin(instance_index) ii: u32) -> VOut {
  let inst = insts[ii];
  var mp = pos;
  var mn = nrm.xyz;
  if (morph != 0xffffffffu) {
    for (var k = 0u; k < inst.mesh; k++) {
      let w = xf[inst.outline + k];
      if (w != 0.0) {
        let o = morph + k * 6u;
        mp += w * vec3f(bitcast<f32>(visible[o]), bitcast<f32>(visible[o + 1u]), bitcast<f32>(visible[o + 2u]));
        mn += w * vec3f(bitcast<f32>(visible[o + 3u]), bitcast<f32>(visible[o + 4u]), bitcast<f32>(visible[o + 5u]));
      }
    }
  }
  let m = skinMat(u32(max(inst.body, 0)), joints, weights);
  let lp = (m * vec4f(mp, 1.0)).xyz;
  let ln = (m * vec4f(mn, 0.0)).xyz;
  return vertexWith(inst, Pose(inst.pos, inst.rot), lp, ln, vcol, vmat, uv);
}

@vertex fn vs_skin_shadow(@location(0) pos: vec3f, @location(5) joints: vec4u, @location(6) weights: vec4f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let inst = insts[ii];
  let m = skinMat(u32(max(inst.body, 0)), joints, weights);
  let rel = inst.pos - frame.eye.xyz + qrot(inst.rot, (m * vec4f(pos, 1.0)).xyz * inst.size);
  return frame.shadowMat * vec4f(rel, 1.0);
}

@vertex fn vs_shadow(@location(0) pos: vec3f, @location(7) mrow: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let idx = visible[bucket.x + ii];
  let inst = insts[idx];
  let p = pose(inst);
  let rel = p.pos - frame.eye.xyz + qrot(p.rot, partMorph(idx, mrow, pos, vec3f(0.0)).p * inst.size);
  return frame.shadowMat * vec4f(rel, 1.0);
}

/// RENDER (beta polish, D125): far shadow casters as their mesh's LOD0 box (the library's ±0.5 'box' mesh, scaled to the
/// mesh's half extents around its centre: two vec4f per mesh), for casters a few pixels across on screen.
@group(0) @binding(14) var<storage, read> shadowBoxes: array<vec4f>;
@vertex fn vs_shadow_box(@location(0) pos: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let idx = visible[bucket.x + ii];
  let inst = insts[idx];
  let p = pose(inst);
  let local = shadowBoxes[inst.mesh * 2u].xyz + shadowBoxes[inst.mesh * 2u + 1u].xyz * pos * 2.0;
  let rel = p.pos - frame.eye.xyz + qrot(p.rot, local * inst.size);
  return frame.shadowMat * vec4f(rel, 1.0);
}

/// Shadow casters while the section box is on: clipped like the view, so the inside is lit.
struct ShadowOut { @builtin(position) clip: vec4f, @location(0) world: vec3f };
@vertex fn vs_shadow_clip(@location(0) pos: vec3f, @location(7) mrow: u32, @builtin(instance_index) ii: u32) -> ShadowOut {
  let idx = visible[bucket.x + ii];
  let inst = insts[idx];
  let p = pose(inst);
  let rel = p.pos - frame.eye.xyz + qrot(p.rot, partMorph(idx, mrow, pos, vec3f(0.0)).p * inst.size);
  return ShadowOut(frame.shadowMat * vec4f(rel, 1.0), rel + frame.eye.xyz);
}
@fragment fn fs_shadow_clip(i: ShadowOut) {
  if (any(i.world < frame.secMin.xyz) || any(i.world > frame.secMax.xyz)) { discard; }
}
`;

export const SHADE_WGSL = /* wgsl */ `
@group(0) @binding(4) var shadowMap: texture_depth_2d;
@group(0) @binding(5) var shadowSampler: sampler_comparison;
@group(0) @binding(13) var shadowFarMap: texture_depth_2d; // RENDER (beta polish, D125): the far key-light cascade
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var<storage, read> clusters: array<u32>;
@group(0) @binding(12) var<storage, read> wetGrid: array<vec2f>; // R5 (M5): per cell (wetness 0–1, wet-line height m)
${LOOK_BINDINGS_WGSL}

/// R5 (M5, contract 6): surfaces where Matter water is or was darken and gloss up (environments.md §2.4: roughness −0.3,
/// albedo −15 % at full wetness), up to just above the water's top in that column; the grid dries over ~40 s.
fn wetness(wp: vec3f) -> f32 {
  let n = u32(frame.wet.w);
  if (n == 0u) { return 0.0; }
  let g = (wp.xz - frame.wet.xy) / frame.wet.z - 0.5;
  if (any(g < vec2f(0.0)) || any(g > vec2f(f32(n) - 1.0))) { return 0.0; }
  let i = vec2u(g);
  let f = fract(g);
  let a = wetGrid[i.y * n + i.x];
  let b = wetGrid[i.y * n + min(i.x + 1u, n - 1u)];
  let c = wetGrid[min(i.y + 1u, n - 1u) * n + i.x];
  let d = wetGrid[min(i.y + 1u, n - 1u) * n + min(i.x + 1u, n - 1u)];
  let w = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return w.x * (1.0 - smoothstep(w.y + 0.005, w.y + 0.03, wp.y));
}
${LOOK_FN_WGSL}

fn clusterOf(rel: vec3f) -> u32 {
  let clip = frame.viewProj * vec4f(rel, 1.0);
  let ndc = clip.xy / max(clip.w, 1e-6);
  let tx = min(u32(clamp(ndc.x * 0.5 + 0.5, 0.0, 0.9999) * f32(CL_X)), CL_X - 1u);
  let ty = min(u32(clamp(0.5 - ndc.y * 0.5, 0.0, 0.9999) * f32(CL_Y)), CL_Y - 1u);
  let z = max(-(frame.view * vec4f(rel, 1.0)).z, frame.cluster.z);
  let tz = min(u32(log(z / frame.cluster.z) / log(frame.cluster.w / frame.cluster.z) * f32(CL_Z)), CL_Z - 1u);
  return (tz * CL_Y + ty) * CL_X + tx;
}

const PI = 3.14159265;

fn shadowPcf(map: texture_depth_2d, uv: vec2f, z: f32) -> f32 {
  let ts = 1.0 / f32(textureDimensions(map).x);
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(map, shadowSampler, uv + vec2f(f32(x), f32(y)) * ts * 1.5, z);
    }
  }
  return s / 9.0;
}

/// RENDER (beta polish, D125): the key light's two cascades. The near map (frame.shadowMat) covers the camera focus at
/// full resolution; past its edge (a 6 % blend band) the far map (frame.shadowFar) covers what's in view up to the
/// shadow distance, where part shadows fade out. × the static set shadow (walls, window frames: its own cached map).
fn keyShadow(rel: vec3f, nrm: vec3f) -> f32 {
  let texel = frame.params.z;
  let p = frame.shadowMat * vec4f(rel + nrm * texel * 2.0, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  var vis = 1.0;
  var w = 0.0;
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && p.z <= 1.0) {
    let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    w = smoothstep(0.0, 0.06, e);
    vis = shadowPcf(shadowMap, uv, p.z - frame.nearP.x);
  }
  if (w < 1.0) {
    var far = 1.0;
    if (frame.shadowFarP.x > 0.5) {
      let q = frame.shadowFar * vec4f(rel + nrm * frame.shadowFarP.w * 1.5, 1.0);
      let fuv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
      if (all(fuv >= vec2f(0.0)) && all(fuv <= vec2f(1.0)) && q.z <= 1.0) {
        far = shadowPcf(shadowFarMap, fuv, q.z - frame.nearP.y);
        far = mix(far, 1.0, smoothstep(frame.shadowFarP.y, frame.shadowFarP.z, length(rel)));
      }
    }
    vis = mix(far, vis, w);
  }
  return vis;
}

fn shadowAt(rel: vec3f, nrm: vec3f) -> f32 {
  return keyShadow(rel, nrm) * setShadowAt(rel, nrm);
}

fn dGgx(ndh: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
fn vSmith(ndv: f32, ndl: f32, a: f32) -> f32 {
  let k = a * 0.5;
  return 0.25 / ((ndv * (1.0 - k) + k) * (ndl * (1.0 - k) + k));
}
fn fresnel(f0: vec3f, vdh: f32) -> vec3f {
  return f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
}

/// Direct light from one direction (unit vector toward the light).
fn brdf(n: vec3f, v: vec3f, l: vec3f, albedo: vec3f, rough: f32, metal: f32) -> vec3f {
  let ndl = dot(n, l);
  if (ndl <= 0.0) { return vec3f(0.0); }
  let h = normalize(v + l);
  let ndv = max(dot(n, v), 1e-3);
  let a = max(rough * rough, 0.002);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let f = fresnel(f0, max(dot(v, h), 0.0));
  let spec = dGgx(max(dot(n, h), 0.0), a) * vSmith(ndv, ndl, a) * f;
  let diff = (1.0 - f) * (1.0 - metal) * albedo / PI;
  return (diff + spec) * ndl * PI;
}

/// Specular-only lobe (dielectric, F0 0.04): glass highlights.
fn specOnly(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let ndl = dot(n, l);
  if (ndl <= 0.0) { return 0.0; }
  let h = normalize(v + l);
  let a = max(rough * rough, 0.002);
  let f = 0.04 + 0.96 * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  return dGgx(max(dot(n, h), 0.0), a) * vSmith(max(dot(n, v), 1e-3), ndl, a) * f * ndl * PI;
}

fn skyColor(d: vec3f) -> vec3f {
  return mix(frame.horizon.rgb, frame.skyTop.rgb, smoothstep(-0.02, 0.7, d.y));
}

fn shade(rel: vec3f, n: vec3f, albedo: vec3f, rough: f32, metal: f32, shadowN: vec3f) -> vec3f {
  let v = normalize(-rel);
  // L3 (M3): screen-space AO (x) and key-light contact shadow (y), look/wgsl.ts
  var lk = lookAo(rel);
  // + G3's SDF: contact shadow toward the key and SDF AO (world space, gi.ts via look/wgsl.ts)
  let wp = rel + frame.eye.xyz;
  lk.x *= lookSdfAo(wp, n) * lookCavity; // + the texture set's cavity occlusion (ORM R, indirect only)
  let shadow = shadowAt(rel, shadowN) * lk.y * lookSdfShadow(wp, shadowN);
  let giD = lookGiDiffuse(rel); // probe GI irradiance, half-res from the AO pass
  var c = brdf(n, v, frame.key.xyz, albedo, rough, metal) * frame.keyColor.rgb * frame.key.w * shadow;
  c += brdf(n, v, frame.fill.xyz, albedo, rough, metal) * frame.keyColor.rgb * frame.fill.w * mix(1.0, lk.x, 0.5);
  c += brdf(n, v, frame.rim.xyz, albedo, rough, metal) * frame.rimColor.rgb * frame.rim.w * mix(1.0, lk.x, 0.5) * lookRimVis(wp, shadowN);
  let ndv = max(dot(n, v), 0.0);
  let f0 = mix(vec3f(0.04), albedo, metal);
  if (look.p0.z > 0.5) {
    // L3 (M3): the set IBL (in-engine bake, look/setbake.ts): cosine irradiance + split-sum specular
    // probe GI (G3) blends over the set's baked irradiance where the probes cover the point
    var irr = iblDiffuseAt(n);
    if (giD.x >= 0.0) { irr = mix(irr, giD, look.gi.x); }
    c += irr * albedo * (1.0 - metal) * lk.x;
    let ab = envBrdf(ndv, rough);
    let so = clamp(pow(ndv + lk.x, exp2(-16.0 * rough - 1.0)) - 1.0 + lk.x, 0.0, 1.0);
    let rv = reflect(-v, n);
    c += iblSpecAt(rv, rough) * (f0 * ab.x + ab.y) * so * lookSpecVis(wp, shadowN, rv, rough);
  } else {
    // ambient: hemisphere from the cyc (a stand-in for the Studio IBL + SDF AO, RENDERING §6–7)
    let up = n.y * 0.5 + 0.5;
    let amb = mix(frame.ground.rgb * frame.horizon.rgb * 0.9, frame.skyTop.rgb, up);
    let fr = f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - ndv, 5.0);
    var hemi = amb * 0.55 * (0.6 + 0.4 * shadow);
    if (giD.x >= 0.0) { hemi = mix(hemi, giD, look.gi.x); } // probe GI (G3) in the Studio
    c += hemi * albedo * (1.0 - metal) * lk.x;
    c += skyColor(reflect(-v, n)) * fr * (1.0 - rough * 0.7) * 0.6 * mix(1.0, lk.x, 0.6);
  }
  // point lights (flames, fuses, explosion flashes): unshadowed, from this pixel's cluster only
  let cl = clusterOf(rel) * (CL_PER + 1u);
  let n_l = min(clusters[cl], CL_PER);
  for (var j = 0u; j < n_l; j++) {
    let lp = lights[clusters[cl + 1u + j]];
    let d = lp.pos.xyz - frame.eye.xyz - rel;
    let dist = length(d);
    if (dist < lp.pos.w) {
      let att = pow(1.0 - dist / lp.pos.w, 2.0);
      c += brdf(n, v, d / max(dist, 1e-4), albedo, rough, metal) * lp.color.rgb * att;
    }
  }
  // L3 (M3): the set's practical lamps (spot cones, the centre bench pendant shadowed from 12 GB)
  c += lookPracticals(rel, n, v, albedo, rough, metal, shadowN);
  return c;
}

// ---- seeing inside (GAME_SPEC §7.5, RENDERING §10) ----

/// 0 = cut away (discard), 1 = kept; in between is the soft cutaway edge (alpha-to-coverage dithers it
/// across the MSAA samples). Section box: hard clip. Cutaway: a cone from the eye to the focus.
fn cutCoverage(rel: vec3f) -> f32 {
  if (frame.secMin.w > 0.5) {
    let w = rel + frame.eye.xyz;
    if (any(w < frame.secMin.xyz) || any(w > frame.secMax.xyz)) { return 0.0; }
  }
  if (frame.cut.w > 0.0) {
    let f = frame.cut.xyz - frame.eye.xyz;
    let d = max(length(f), 1e-3);
    let fd = f / d;
    let t = dot(rel, fd);
    let r = frame.cut.w * clamp(t / d, 0.12, 1.0);
    let perp = length(rel - fd * t);
    let side = smoothstep(r * 0.75, r, perp);
    let behind = smoothstep(d - frame.cut.w * 0.9, d - frame.cut.w * 0.45, t);
    return max(side, behind);
  }
  return 1.0;
}

/// Where the eye ray to this fragment enters the section box: xyz = outward cap normal, w = 1 if the
/// ray crosses a box face first (the fragment is a back face seen through a cut).
fn capOf(rel: vec3f) -> vec4f {
  if (frame.secMin.w < 0.5) { return vec4f(0.0); }
  let d = normalize(rel);
  let e = frame.eye.xyz;
  let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let t0 = (frame.secMin.xyz - e) * inv;
  let t1 = (frame.secMax.xyz - e) * inv;
  let tn = min(t0, t1);
  let te = max(max(tn.x, tn.y), tn.z);
  if (te <= 0.0 || te >= length(rel)) { return vec4f(0.0); }
  var n = vec3f(0.0);
  if (te == tn.x) { n.x = -sign(d.x); } else if (te == tn.y) { n.y = -sign(d.y); } else { n.z = -sign(d.z); }
  return vec4f(n, 1.0);
}

/// Cross-hatch on the cap plane (diagonal 45° lines every 3 cm), anti-aliased.
fn hatch(rel: vec3f, n: vec3f) -> f32 {
  let d = normalize(rel);
  let e = frame.eye.xyz;
  // the cap plane point along the ray
  let pl = select(frame.secMin.xyz, frame.secMax.xyz, n > vec3f(0.0));
  let a = abs(n);
  let plane = dot(pl, a);
  let t = (plane - dot(e, a)) / max(abs(dot(d, a)), 1e-5) * sign(dot(d, a));
  let p = e + d * t;
  var uv = p.xy;
  if (a.x > 0.5) { uv = p.yz; } else if (a.y > 0.5) { uv = p.xz; }
  let s = (uv.x + uv.y) / 0.03;
  let g = abs(fract(s) - 0.5);
  let fw = max(fwidth(s), 1e-4);
  return 1.0 - smoothstep(0.12, 0.12 + fw * 1.5, g);
}

fn xrayDim(c: vec3f) -> vec3f {
  if (frame.misc.x < 0.5) { return c; }
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return mix(vec3f(l), c, 0.25) * 0.3;
}
`;

const FS_COMMON = /* wgsl */ `
${PART_WGSL}
${SHADE_WGSL}

/// Rounded-box normal from the unit-mesh position: the "bevel" every powder-coated part gets
/// (ART_BIBLE bevel rule) without needing per-size geometry.
fn bevelNormal(local: vec3f, size: vec3f, faceN: vec3f) -> vec3f {
  let q = local * size;
  let h = size * 0.5;
  let b = clamp(min(min(size.x, size.y), size.z) * 0.12, 0.002, 0.012);
  let d = max(abs(q) - (h - b), vec3f(0.0)) * sign(q);
  if (dot(d, d) < 1e-12) { return faceN; }
  return normalize(d);
}

@group(0) @binding(8) var decalAtlas: texture_2d<f32>;
@group(0) @binding(9) var decalSampler: sampler;
`;

export const PART_FS_WGSL = /* wgsl */ `
${FS_COMMON}
${LOOK_SURFACE_WGSL}

/// Premultiplied-alpha pipelines (ghosts) scale colour by coverage too; opaque ones (alpha-to-coverage) don't.
override PREMUL: bool = false;
/// X-ray "all": hidden parts glow through (drawn with depth compare greater).
override XRAY_HIDDEN: bool = false;

/// Engine-drawn screen (shared_kit §5): a bar of \`cells\` lit up to \`level\` (flags bits 3–7: 0 off,
/// 1–21 level (n − 1) / 20, 31 overload: full and blinking amber). Unlit cells glow at 6 %.
fn screenGlow(uv: vec2f, cells: f32, code: u32, col: vec3f) -> vec3f {
  let c = floor(uv.x * cells);
  let f = fract(uv.x * cells);
  let inCell = step(0.09, f) * step(f, 0.91) * step(0.14, uv.y) * step(uv.y, 0.86);
  var lit = 0.0;
  var tint = col;
  if (code == 31u) {
    lit = select(0.25, 1.0, fract(frame.eye.w * 2.0) < 0.5);
    tint = vec3f(1.0, 0.43, 0.012); // Amber #FFB020, linear
  } else if (code > 0u) {
    lit = select(0.0, 1.0, c < f32(code - 1u) / 20.0 * cells);
  }
  return tint * inCell * max(lit, 0.06);
}

/// R5 (M5, vfx §7.3): the "time-stopped" look on a body held by an engaged STASIS FIELD (VOut.stasis): 50 % desaturation,
/// a cool tint and a crisp Field-colour rim drawn as a dash pattern (never a solid outline: solid Plasma means Player 2).
fn stasisLook(c: vec3f, rel: vec3f, n: vec3f, held: u32) -> vec3f {
  if (held == 0u) { return c; }
  let wp = rel + frame.eye.xyz;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  var o = mix(c, vec3f(lum), 0.5) * vec3f(0.82, 0.94, 1.12);
  let ndv = abs(dot(normalize(n), normalize(-rel)));
  let dash = step(0.45, fract(dot(wp, vec3f(31.0, 37.0, 29.0)) + frame.m5.w * 0.05));
  o += vec3f(1.0, 0.047, 0.42) * pow(1.0 - ndv, 4.0) * (0.35 + 0.65 * dash) * 1.6;
  return o;
}

// ---- R5 (M5): LED icon faces (DUSTY's eyes, BUZZ's visor; critters.md: the 12 shared icons, gfx/screens.ts) ----

fn sdPill(p: vec2f, h: vec2f, r: f32) -> f32 {
  let q = abs(p) - h + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
/// Signed distance (eye units: y −0.5…0.5 up, x across) of the icon (1-based FACE_ICONS); xin < 0 is the
/// inner side (toward the other eye), t the clock.
fn iconSd(p: vec2f, icon: u32, xin: f32, t: f32) -> f32 {
  let pill = sdPill(p, vec2f(0.36, 0.3), 0.28);
  switch (icon) {
    case 1u: { return pill; }                                                            // neutral pill
    case 2u: { return sdPill(p - vec2f(0.0, -0.04), vec2f(0.38, 0.06), 0.06); }          // blink: a line
    case 3u: {                                                                           // happy ^ ^
      let q = p - vec2f(0.0, -0.32);
      return select(1.0, abs(length(q) - 0.42) - 0.075, q.y > 0.06);
    }
    case 4u: { return max(pill, p.y - 0.02 - 0.12 * xin); }                              // smug: half-lid
    case 5u: {                                                                           // scared: small wobbly o
      let a = atan2(p.y, p.x);
      return abs(length(p) - (0.17 + 0.025 * sin(t * 18.0 + a * 3.0))) - 0.05;
    }
    case 6u: { return max(pill, p.y - (0.12 + 0.55 * xin)); }                            // angry: inner side cut low
    case 7u: {                                                                           // dizzy spiral
      let r = length(p);
      let a = atan2(p.y, p.x) + t * 5.0;
      let s = abs(fract(r / 0.13 - a / 6.2831853) - 0.5) * 0.13 - 0.032;
      return max(s, r - 0.42);
    }
    case 8u: { return sdPill(p - vec2f(0.0, -0.16), vec2f(0.36, 0.06), 0.06); }         // sleepy –
    case 9u: { return abs(length(p) - 0.33) - 0.07; }                                    // surprised O
    case 10u: { return max(pill, p.y - 0.06); }                                          // determined: flat top
    case 11u: { return length(p - vec2f(0.32 * sin(t * 3.0), 0.0)) - 0.14; }             // scan: sweeping dot
    case 12u: { return length(p) - (0.43 + 0.02 * sin(t * 25.0)); }                     // strain: bulged
    default: { return 1.0; }
  }
}
/// Dot-matrix LED glow for an icon screen: aspect = width / height, side 0 / 1 = left / right eye, 0.5 = a visor
/// with both eyes. Unlit dots glow at 5 % (like unlit bar cells); code 0 = dark.
fn screenIcon(uv: vec2f, duv: f32, aspect: f32, side: f32, icon: u32, col: vec3f) -> vec3f {
  let rows = 7.0;
  let cell = 1.0 / rows;
  let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  let ci = floor((p + vec2f(aspect * 0.5, 0.5)) / cell);
  let cc = (ci + 0.5) * cell - vec2f(aspect * 0.5, 0.5);
  let f = (p - cc) / cell;
  let aa = max(duv * rows, 1e-3); // fwidth(uv) taken by the caller in uniform control flow
  let dotm = 1.0 - smoothstep(0.36 - aa, 0.36 + aa, length(f));
  var lit = 0.0;
  if (icon > 0u) {
    var e = cc;
    var xin = 0.0;
    if (side > 0.25 && side < 0.75) {
      // a visor: two eyes at ±aspect / 4; the eye at +x is the critter's left (inner side toward −x)
      let ex = sign(cc.x) * aspect * 0.25;
      e = vec2f(cc.x - ex, cc.y);
      xin = sign(cc.x) * e.x;
    } else {
      xin = select(-e.x, e.x, side < 0.5);
    }
    lit = 1.0 - smoothstep(-0.02, 0.04, iconSd(e, icon, xin, frame.eye.w));
  }
  return col * dotm * max(lit, 0.05);
}

@fragment fn fs_part(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  // sampled in uniform control flow for every part; only decal texels use it
  let tex = textureSample(decalAtlas, decalSampler, i.uv);
  let aw = max(fwidth(tex.a), 1e-4);
  // L3 (M3): screen derivatives for the texture set's tangent frame and the detail layer (uniform flow)
  let lookD = lookDerivs(i.rel, i.uv, i.local * i.size);
  let iconDuv = max(fwidth(i.uv.x), fwidth(i.uv.y)); // R5 (M5): LED icon dots (uniform control flow)
  // the section cap and its hatch need derivatives: evaluate them in uniform control flow too
  let cap = capOf(i.rel);
  var capHatch = 0.0;
  if (frame.secMin.w > 0.5) { capHatch = hatch(i.rel, cap.xyz); }
  let cover = cutCoverage(i.rel);
  if (cover <= 0.004) { discard; }
  let flags = u32(i.mat.w);
  var n = normalize(i.n);
  if ((flags & FLAG_BEVEL) != 0u) {
    let faceLocal = qrot(vec4f(-i.rot.xyz, i.rot.w), n);
    n = normalize(qrot(i.rot, bevelNormal(i.local, i.size, faceLocal)));
  }
  var albedo = i.color.rgb;
  var shadowN = normalize(i.n);
  var capLines = 0.0;
  if (!ff) {
    // only reachable with the clip pipelines (cull none): looking into a cut solid or a cut-away shell
    if (i.kind == KIND_DECAL || i.kind == KIND_SCREEN) { discard; }
    if (cap.w > 0.5) {
      n = cap.xyz;
      shadowN = cap.xyz;
      capLines = capHatch;
      albedo = mix(albedo * 0.7, albedo * 0.12, capLines);
    } else {
      n = -n;
      shadowN = -shadowN;
      albedo *= 0.55;
    }
  }
  if (i.kind == KIND_SCREEN) {
    // glossy black glass with engine-drawn content; the vertex colour is the content colour
    var c = shade(i.rel, n, vec3f(0.006), 0.2, 0.0, shadowN);
    if (i.mat.y > 0.5) { c += screenIcon(i.uv, iconDuv, i.mat.x * 8.0, i.mat.z, i.look, i.color.rgb) * 6.0; } // R5 (M5)
    else { c += screenGlow(i.uv, max(round(i.mat.x * 255.0), 1.0), (flags >> 3u) & 31u, i.color.rgb) * 6.0; }
    return vec4f(xrayDim(c), cover);
  }
  var alpha = i.color.a;
  if (i.kind == KIND_DECAL) {
    // alpha-tested at 0.5; with alpha-to-coverage the edge resolves across the MSAA samples
    alpha = clamp((tex.a - 0.5) / aw + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) { discard; }
    albedo *= tex.rgb;
  }
  var surf = Surface(n, albedo, max(i.mat.x, 0.04), i.mat.y);
  // L3 (M3): per-part texture set and the tiling detail layer (look/wgsl.ts lookSurface)
  if (ff && i.kind == KIND_MASTER && i.look != 0u) { surf = lookSurface(surf, i.look, i.uv, i.rel, i.local * i.size, i.rot, i.color.rgb, lookD, i.tan); }
  let wt = wetness(i.rel + frame.eye.xyz); // R5 (M5): the Matter wetness mask
  surf.albedo *= 1.0 - 0.15 * wt;
  surf.rough = max(0.04, surf.rough - 0.3 * wt);
  var c = shade(i.rel, surf.n, surf.albedo, surf.rough, surf.metal, shadowN);
  let ez = u32(round(i.mat.z * 255.0));
  if (i.kind == KIND_MASTER && ez >= 251u && ez <= 254u) {
    // R5 (M5): an LED group (gfx/leds.ts): 2 bits per group in the instance's rough byte → off / 8 % / 45 % / 100 %
    let lv = array<f32, 4>(0.0, 0.08, 0.45, 1.0)[(u32(i.outline.x) >> (u32(i.outline.y) * 2u)) & 3u];
    c = shade(i.rel, surf.n, i.color.rgb * 0.15, 0.3, 0.0, shadowN) + i.color.rgb * lv * 8.0 * f32(ff);
  } else {
    c += surf.albedo * i.mat.z * 12.0 * f32(ff);
  }
  c = stasisLook(c, i.rel, surf.n, i.stasis); // R5 (M5)
  c = xrayDim(c);
  let a = select(i.color.a, alpha * i.color.a, i.kind == KIND_DECAL);
  if (PREMUL) { return vec4f(c * i.color.a * cover, a * cover); }
  return vec4f(c * i.color.a, a * cover);
}

/// X-ray glow: links/ports (additive, any depth) or, with XRAY_HIDDEN, the hidden parts' rims.
@fragment fn fs_xray(i: VOut) -> @location(0) vec4f {
  if (cutCoverage(i.rel) <= 0.004) { discard; }
  let n = normalize(i.n);
  let v = normalize(-i.rel);
  let rim = pow(1.0 - abs(dot(n, v)), 2.0);
  if (XRAY_HIDDEN) {
    return vec4f(vec3f(0.03, 0.55, 0.9) * (0.03 + 0.3 * rim), 0.0);
  }
  // links and ports glow in their full-saturation channel colour (dark cable jackets included)
  let hue = i.color.rgb / max(max(i.color.r, i.color.g), max(i.color.b, 0.02));
  return vec4f(hue * (0.5 + 1.6 * rim), 0.0);
}

/// DRAG (D117): the transform gizmo (ui/gizmo.ts), drawn last with no depth test: the handle colour under a soft key
/// light plus a thin rim, unaffected by the section box, cutaway or X-ray dimming. Premultiplied by the instance alpha;
/// the emissive byte brightens the hovered handle.
@fragment fn fs_top(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let v = normalize(-i.rel);
  let key = 0.55 + 0.45 * max(dot(n, normalize(vec3f(0.3, 0.85, 0.4))), 0.0);
  let rim = pow(1.0 - abs(dot(n, v)), 3.0) * 0.35;
  let c = (i.color.rgb * key + vec3f(rim)) * (1.6 + 2.4 * i.mat.z);
  return vec4f(c * i.color.a, i.color.a);
}

/// RENDER (beta polish, D126): the backdrop Earth, lit at runtime so it can spin (lifts D112's no-spin). Its texture set
/// holds inputs only (ART, D128): albedo = unlit reflectance, ORM = data (R cloud cover, G night lights, B water). The
/// planet turns frame.earthSpin.w about earthSpin.xyz (the texture is sampled at the direction turned back); the
/// terminator, sunset band, cloud shadows, night side, city lights, ocean glint and limb glow come from frame.earthSun
/// (the set's sun, with the Hangar's art-directed phase applied), with the same terms and constants as E5c's bake
/// (tools/blender/env_hangar.py earth_bake), so the look matches the baked planet. The mesh is centred on the planet,
/// so 'local' is the surface direction × radius. Emission only (the bake was shown as texture × 0.15 × 12).
fn earthTurn(v: vec3f, ax: vec3f, a: f32) -> vec3f {
  return v * cos(a) + cross(ax, v) * sin(a) + ax * dot(ax, v) * (1.0 - cos(a));
}
/// Equirect (u, v) of a planet direction (engine Y-up; the bake's Z-up axes: x, −z, y), as the glb's own UVs.
fn earthUv(d: vec3f) -> vec2f {
  return vec2f(atan2(d.x, d.z) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
}
fn earthSample(arr: u32, layer: i32, uv: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
  if (arr == 0u) { return textureSampleGrad(setAlbedo, lookSampler, uv, layer, gx, gy); }
  if (arr == 1u) { return textureSampleGrad(setNrmOrm, lookSampler, uv, layer * 2 + 1, gx, gy); }
  if (arr == 2u) { return textureSampleGrad(setAlbedo2k, lookSampler, uv, layer, gx, gy); }
  return textureSampleGrad(setNrmOrm2k, lookSampler, uv, layer * 2 + 1, gx, gy);
}
@fragment fn fs_earth(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.local);
  let ax = frame.earthSpin.xyz;
  let d = earthTurn(n, ax, -frame.earthSpin.w);
  let uv = earthUv(d);
  // derivatives in uniform flow; across the u seam take the wrapped coordinate's (whichever changes less)
  let ub = fract(uv.x + 0.5);
  var gx = vec2f(dpdx(uv.x), dpdx(uv.y));
  var gy = vec2f(dpdy(uv.x), dpdy(uv.y));
  let gxb = dpdx(ub);
  let gyb = dpdy(ub);
  if (abs(gxb) + abs(gyb) < abs(gx.x) + abs(gy.x)) { gx.x = gxb; gy.x = gyb; }
  // cloud shadows: the cloud cover offset 0.012 along the sun direction, as the bake offsets its cloud field
  let Ls = earthTurn(frame.earthSun.xyz, ax, -frame.earthSpin.w);
  let uvs = earthUv(normalize(d - Ls * 0.012));
  let lm = decodeLook(i.look);
  let code = max(lm.layer, 1u) - 1u;
  let L2 = i32(code & 0x7fffu);
  let big = (code & 0x8000u) != 0u;
  let col = earthSample(select(0u, 2u, big), L2, uv, gx, gy).rgb;
  let data = earthSample(select(1u, 3u, big), L2, uv, gx, gy).rgb;
  let shade = earthSample(select(1u, 3u, big), L2, uvs, gx, gy).r;
  let clouds = data.r;
  let L = frame.earthSun.xyz;
  let V = normalize(-i.rel);
  let ndl = dot(n, L);
  var surf = col * (1.0 - 0.35 * clamp(shade / 0.88, 0.0, 1.0));
  let day = smoothstep(-0.08, 0.16, ndl);
  let band = smoothstep(-0.06, 0.04, ndl) * (1.0 - smoothstep(0.04, 0.2, ndl));
  let lit = 0.10 + 0.90 * pow(max(ndl, 0.0), 0.75);
  surf = surf * lit * day;
  surf = surf * (1.0 - 0.6 * band) + surf * vec3f(1.0, 0.62, 0.38) * 0.96 * band;
  let cloudCol = vec3f(0.93, 0.94, 0.96) * (0.07 + 0.93 * pow(clamp(ndl + 0.05, 0.0, 1.0), 0.6) * day);
  surf = surf * (1.0 - clouds) + cloudCol * clouds;
  let night = 1.0 - day;
  surf += (col * 0.02 + vec3f(0.004, 0.006, 0.016)) * night;
  let nightc = 1.0 - smoothstep(-0.14, 0.02, ndl);
  surf += vec3f(1.0, 0.70, 0.36) * data.g * nightc;
  let H = normalize(V + L);
  let ndh = max(dot(n, H), 0.0);
  surf += vec3f(1.0, 0.95, 0.85) * data.b * (1.0 - clouds) * day * (0.9 * pow(ndh, 220.0) + 0.07 * pow(ndh, 24.0));
  let ndv = max(dot(n, V), 0.0);
  let fres = pow(1.0 - ndv, 3.0);
  let back = pow(max(-dot(V, L), 0.0), 3.0);
  surf += vec3f(0.42, 0.68, 1.0) * fres * (0.25 * smoothstep(-0.35, 0.3, ndl) + 0.9 * back * smoothstep(-0.5, 0.1, ndl));
  // the bake's display mapping: texture = clip(surf / 1.8 × 1.55), shown × 1.8
  return vec4f(min(surf * 1.55, vec3f(1.8)), 1.0);
}

/// RENDER (beta polish, D125): the gizmo's coverage at output resolution (post keeps fog and DOF off under it).
@fragment fn fs_top_mask(i: VOut) -> @location(0) vec4f {
  return vec4f(i.color.a);
}

@fragment fn fs_mask(i: VOut) -> @location(0) vec4f {
  if (cutCoverage(i.rel) <= 0.004) { discard; }
  return i.outline;
}
`;

/** Transmission (RENDERING §6.1 TRANSMISSION): tint, Fresnel and a cheap screen-space refraction offset.
 * With dual-source blending the output is `dst × T + C` (coloured tint); without it, a scalar T. */
export function glassWgsl(dual: boolean): string {
  const out = dual
    ? 'struct GlassOut { @location(0) @blend_src(0) c: vec4f, @location(0) @blend_src(1) t: vec4f };'
    : 'struct GlassOut { @location(0) c: vec4f };';
  const ret = dual
    ? 'return GlassOut(vec4f(c, 1.0), vec4f(t, 1.0));'
    : 'return GlassOut(vec4f(c, dot(t, vec3f(0.3333))));';
  return /* wgsl */ `
${dual ? 'enable dual_source_blending;' : ''}
${FS_COMMON}
@group(2) @binding(15) var sceneColor: texture_2d<f32>; // L3 (M3): group 2 is the look's (+ this binding for glass)
${out}

@fragment fn fs_glass(i: VOut, @builtin(front_facing) ff: bool) -> GlassOut {
  let cover = cutCoverage(i.rel);
  if (cover <= 0.004) { discard; }
  // light the side we see (robust to art with flipped winding); ff still says near wall vs far wall
  let v = normalize(-i.rel);
  var n = normalize(i.n);
  if (dot(n, v) < 0.0) { n = -n; }
  let ndv = max(dot(n, v), 0.0);
  // Schlick (IOR 1.5) plus an art-directed rim so thin shells read as glass against the bright cyc
  let F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0) + 0.3 * pow(1.0 - ndv, 3.0);
  let rough = max(i.mat.x, 0.03);
  let albedo = i.color.rgb;
  // reflections: Studio sky + key/fill/rim highlights (shadowed key), plus any emissive (lit bulbs)
  var c = skyColor(reflect(-v, n)) * F * (1.0 - rough * 0.7) * 0.9;
  c += specOnly(n, v, frame.key.xyz, rough) * frame.keyColor.rgb * frame.key.w * shadowAt(i.rel, n);
  c += specOnly(n, v, frame.fill.xyz, rough) * frame.keyColor.rgb * frame.fill.w;
  c += specOnly(n, v, frame.rim.xyz, rough) * frame.rimColor.rgb * frame.rim.w;
  c += albedo * i.mat.z * 12.0;
  // transmittance: the tint deepens at grazing angles (longer path through the wall)
  // (thin walls: face-on they barely tint; the far wall of a shell tints less than the near one)
  let dens = clamp(0.2 + 0.7 * pow(1.0 - ndv, 2.0), 0.0, 1.0) * select(0.6, 1.0, ff);
  var t = mix(vec3f(1.0), albedo, dens) * (1.0 - min(F, 1.0));
  if (ff) {
    // refraction: shift what's behind along the view-space normal (front faces only; MSAA-resolved copy)
    let dims = vec2f(textureDimensions(sceneColor));
    let uv = i.clip.xy / dims;
    let nv = (frame.view * vec4f(n, 0.0)).xy;
    let off = vec2f(nv.x, -nv.y) * frame.misc.y * (1.0 - 0.5 * ndv);
    let behind = max(textureSampleLevel(sceneColor, decalSampler, uv, 0.0).rgb, vec3f(0.0));
    let bent = max(textureSampleLevel(sceneColor, decalSampler, clamp(uv + off, vec2f(0.0), vec2f(1.0)), 0.0).rgb, vec3f(0.0));
    // R5 (M5): the target already holds more than the opaque copy wherever another transmission layer drew first
    // (a shell's own far wall, a second shell: GOO VAT has kn_glass and kn_poly_clear), so a signed delta
    // dst x T + T x (bent - behind) went negative per channel where the bent sample was darker (hard Moon / Hangar
    // shadows): the tonemap clipped green and the vats' shadow sides turned magenta. Brightening stays additive,
    // darkening becomes a transmittance factor <= 1: both equal T x bent when dst == behind and never go below zero.
    let eps = vec3f(0.02);
    c += t * max(bent - behind, vec3f(0.0));
    t *= (min(bent, behind) + eps) / (behind + eps);
  }
  c = xrayDim(c);
  c *= cover;
  t = mix(vec3f(1.0), t, cover);
  ${ret}
}
`;
}

// ---- Studio sky and floor -----------------------------------------------------------------------------

export const ENV_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
${SHADE_WGSL}

struct SkyOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vs_sky(@builtin(vertex_index) vi: u32) -> SkyOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: SkyOut;
  o.clip = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}
@fragment fn fs_sky(i: SkyOut) -> @location(0) vec4f {
  let w = frame.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let d = normalize(w.xyz / w.w);
  return vec4f(skyColor(d), 1.0);
}

struct FloorOut { @builtin(position) clip: vec4f, @location(0) rel: vec3f };
@vertex fn vs_floor(@builtin(vertex_index) vi: u32) -> FloorOut {
  var corners = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(-1., -1.), vec2f(1., 1.), vec2f(-1., 1.));
  let r = max(400.0, frame.eye.y * 60.0);
  // off (an environment brings its own floor): collapse the quad
  let c = corners[vi] * r * frame.misc.z;
  var o: FloorOut;
  o.rel = vec3f(c.x, -frame.eye.y, c.y);
  o.clip = frame.viewProj * vec4f(o.rel, 1.0);
  return o;
}

fn lineMask(p: vec2f, cell: f32, widthM: f32) -> f32 {
  let g = abs(fract(p / cell - 0.5) - 0.5) * cell;     // distance to the nearest line (m)
  let fw = fwidth(p);
  let w = max(vec2f(widthM * 0.5), fw * 0.5);
  let a = 1.0 - smoothstep(w - fw, w + fw, g);
  // fade lines that get thinner than a pixel instead of aliasing
  let fade = clamp(widthM / max(max(fw.x, fw.y), 1e-6), 0.0, 1.0);
  return max(a.x, a.y) * fade;
}

@fragment fn fs_floor(i: FloorOut) -> @location(0) vec4f {
  let world = i.rel + frame.eye.xyz;
  let p = world.xz;
  let dist = length(i.rel);
  // grid etch (environments brief §1.1): 1 m minor 4 mm, 10 m major 8 mm, origin cross
  let etch = max(lineMask(p, 1.0, 0.004), lineMask(p, 10.0, 0.008));
  var albedo = frame.ground.rgb * (1.0 + frame.ground.w * etch);
  let n = vec3f(0.0, 1.0, 0.0);
  let wt = wetness(world); // R5 (M5): the Matter wetness mask
  var c = shade(i.rel, n, albedo * (1.0 - 0.15 * wt), 0.72 - 0.3 * wt, 0.0, n);
  // build grid (10 cm, Beam) near the cursor while building
  if (frame.params.w > 0.0) {
    let fine = lineMask(p, 0.1, 0.0015);
    let toCursor = length(world.xz - frame.cursor.xz);
    let near = (1.0 - smoothstep(0.4, 1.6, toCursor)) * frame.cursor.w;
    let camFade = 1.0 - smoothstep(4.0, 14.0, dist);
    c = mix(c, vec3f(0.03, 0.55, 0.9), fine * frame.params.w * (0.12 * camFade + 0.5 * near));
  }
  // fade into the cyc colour toward the horizon (never a visible edge)
  let far = max(60.0, frame.eye.y * 25.0);
  c = mix(c, skyColor(normalize(i.rel)), smoothstep(far * 0.35, far, dist));
  return vec4f(xrayDim(c), 1.0);
}
`;

// ---- light clustering ---------------------------------------------------------------------------------

export const CLUSTER_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read_write> clusters: array<u32>;

@compute @workgroup_size(64)
fn assign(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= CL_X * CL_Y * CL_Z) { return; }
  let tx = c % CL_X;
  let ty = (c / CL_X) % CL_Y;
  let tz = c / (CL_X * CL_Y);
  let near = frame.cluster.z;
  let far = frame.cluster.w;
  let z0 = near * pow(far / near, f32(tz) / f32(CL_Z));
  let z1 = near * pow(far / near, f32(tz + 1u) / f32(CL_Z));
  // the tile's sub-frustum, bounded by an AABB in view space (−z forward)
  let tanY = frame.cluster.x;
  let tanX = tanY * frame.cluster.y;
  let x0 = (f32(tx) / f32(CL_X)) * 2.0 - 1.0;
  let x1 = (f32(tx + 1u) / f32(CL_X)) * 2.0 - 1.0;
  let y1 = 1.0 - (f32(ty) / f32(CL_Y)) * 2.0;
  let y0 = 1.0 - (f32(ty + 1u) / f32(CL_Y)) * 2.0;
  let lo = vec3f(min(min(x0 * tanX * z0, x0 * tanX * z1), min(x1 * tanX * z0, x1 * tanX * z1)),
                 min(min(y0 * tanY * z0, y0 * tanY * z1), min(y1 * tanY * z0, y1 * tanY * z1)), -z1);
  let hi = vec3f(max(max(x0 * tanX * z0, x0 * tanX * z1), max(x1 * tanX * z0, x1 * tanX * z1)),
                 max(max(y0 * tanY * z0, y0 * tanY * z1), max(y1 * tanY * z0, y1 * tanY * z1)), -z0);
  let base = c * (CL_PER + 1u);
  var n = 0u;
  for (var i = 0u; i < frame.hover.z; i++) {
    let lp = lights[i];
    let v = (frame.view * vec4f(lp.pos.xyz - frame.eye.xyz, 1.0)).xyz;
    let d = v - clamp(v, lo, hi);
    if (dot(d, d) <= lp.pos.w * lp.pos.w && n < CL_PER) {
      clusters[base + 1u + n] = i;
      n++;
    }
  }
  clusters[base] = n;
}
`;
