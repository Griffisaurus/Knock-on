// WGSL for the D79 look inside the part, glass and environment shaders (bind group 2, shaders.ts includes
// it in SHADE_WGSL): per-part texture-set arrays, the tiling detail layer and procedural wood, the set
// IBL (prefiltered specular cube + cosine irradiance cube), screen-space AO and contact shadows from the
// AO pass (ao.ts), and the static set shadow map (the far cascade, shared with the froxel shafts).
//
// Vertex material encoding (meshes.ts MAT_KIND, glbmesh.ts): the kind byte keeps 0 instance, 64 decal,
// 128 screen; 224–255 is a master material with detail id 255 − kind (255 = none); 192–223 is a master
// with a texture set (detail id 223 − kind), whose red/green bytes hold the set's array layer.

/** Bytes of the `LookU` uniform (keep in sync with look/index.ts writeUniform). */
export const LOOK_U_BYTES = 768;

/** Detail layer ids (array layers of the detail texture; 0 = none). */
export const DETAIL = {
  none: 0, woodX: 1, woodY: 2, woodZ: 3, peel: 4, pitting: 5, brushed: 6, paper: 7, rubber: 8, twist: 9, plaster: 10, brick: 11,
} as const;
export const DETAIL_LAYERS = 12;

export const LOOK_BINDINGS_WGSL = /* wgsl */ `
struct LookU {
  setShadowMat: mat4x4f, // camera-relative → set shadow clip (the far, static cascade)
  p0: vec4f,   // x AO on, y contact on, z IBL on, w IBL diffuse intensity
  p1: vec4f,   // x spec mip count, y detail on, z detail fade start (m), w detail fade end (m)
  p2: vec4f,   // x IBL specular intensity, y set shadow on, z wood albedo strength, w AO strength
  screen: vec4f, // xy full-res size, zw AO texture size
  viewFwd: vec4f, // camera forward (world), w = unused
  p3: vec4f,   // x hemisphere (old ambient) weight, y spec occlusion, z time, w texture sets on
  gi: vec4f,   // G3's GI: x probe-diffuse weight, y SDF AO weight, z SDF contact-shadow weight, w its length (m)
  pad1: vec4f, // x practical spot count
  spotVP: mat4x4f, // camera-relative -> the shadowed practical's clip
  spots: array<Spot, 8>,
};
/// A practical lamp (practicals.ts): pos.w range (m), dir.w cos(outer), color.w cos(inner), extra x shadowed, y bulb radius.
struct Spot { pos: vec4f, dir: vec4f, color: vec4f, extra: vec4f };
@group(2) @binding(16) var spotShadow: texture_depth_2d;
@group(2) @binding(0) var setAlbedo: texture_2d_array<f32>;
@group(2) @binding(1) var setNrmOrm: texture_2d_array<f32>; // normal at layer 2i, ORM at 2i + 1
@group(2) @binding(3) var lookSampler: sampler;
@group(2) @binding(4) var detailTex: texture_2d_array<f32>;
@group(2) @binding(5) var iblSpec: texture_cube<f32>;
@group(2) @binding(6) var iblDiffuse: texture_cube<f32>;
@group(2) @binding(7) var<uniform> look: LookU;
@group(2) @binding(8) var aoTex: texture_2d<f32>;
@group(2) @binding(9) var setShadowMap: texture_depth_2d;
@group(2) @binding(10) var clampSampler: sampler;
@group(2) @binding(11) var setAlbedo2k: texture_2d_array<f32>;
@group(2) @binding(12) var setNrmOrm2k: texture_2d_array<f32>;
@group(2) @binding(14) var giHalf: texture_2d<f32>; // probe GI irradiance at half res (ao.ts), -1 = none
// @@GI@@
`;

/** Needs FRAME (frame), shadowSampler (group 0) and the bindings above. */
export const LOOK_FN_WGSL = /* wgsl */ `
/// ORM R of the texture set (cavity occlusion): set by lookSurface, multiplies the indirect term only (E3c).
var<private> lookCavity: f32 = 1.0;
/// Material look decoded from the vertex kind byte: detail id, texture-set layer (+1, 0 = none).
struct LookMat { detail: u32, layer: u32 };
fn decodeLook(code: u32) -> LookMat { return LookMat(code & 255u, code >> 8u); }

/// AO (x) and key-light contact visibility (y) for this fragment, depth-aware upsampled from the AO pass.
fn lookAo(rel: vec3f) -> vec2f {
  if (look.p0.x < 0.5 && look.p0.y < 0.5) { return vec2f(1.0); }
  let clip = frame.viewProj * vec4f(rel, 1.0);
  let uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
  let sz = look.screen.zw;
  let p = uv * sz - 0.5;
  let b = vec2i(floor(p));
  let f = fract(p);
  let z = dot(rel, look.viewFwd.xyz);
  var acc = vec2f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(b + o, vec2i(0), vec2i(sz) - 1);
    let s = textureLoad(aoTex, q, 0);
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let dw = 1.0 / (1e-3 + abs(s.z - z) / max(z, 0.05) * 40.0);
    let w = bw * dw + 1e-5;
    acc += s.xy * w;
    wsum += w;
  }
  var r = acc / wsum;
  r.x = mix(1.0, r.x, look.p2.w);
  if (look.p0.x < 0.5) { r.x = 1.0; }
  if (look.p0.y < 0.5) { r.y = 1.0; }
  return r;
}

/// The static set shadow (walls, window frames, bench): 1 lit, 0 shadowed; 1 outside the map.
fn setShadowAt(rel: vec3f, nrm: vec3f) -> f32 {
  if (look.p2.y < 0.5) { return 1.0; }
  let ts = 1.0 / f32(textureDimensions(setShadowMap).x);
  let p = look.setShadowMat * vec4f(rel + nrm * 0.01, 1.0);
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || p.z > 1.0) { return 1.0; }
  var s = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1) - 0.5, f32(k >> 1) - 0.5) * ts * 1.5;
    s += textureSampleCompareLevel(setShadowMap, shadowSampler, uv + o, p.z - 0.0008);
  }
  return s * 0.25;
}

/// G3's global SDF + probe GI (gi.ts, spliced in at the marker above by the renderer): world positions.
fn lookSdfShadow(wp: vec3f, nrm: vec3f) -> f32 {
  if (look.gi.z <= 0.0) { return 1.0; }
  return mix(1.0, giSoftShadow(wp + nrm * 0.02, frame.key.xyz, look.gi.w), look.gi.z);
}
/// Large-scale occlusion inside a set (M3 close-out, D79 side-by-side): a short SDF march toward l, 0 when it
/// hits within maxT. 16 steps with a minimum step of 8 % of the distance (under the 7 cm bench top out to
/// ~0.85 m), soft at the edges. Cheaper than giSoftShadow, which is tuned for contact shadows.
fn lookOcc(p: vec3f, l: vec3f, maxT: f32) -> f32 {
  let h = max(gi.level[0].w, 0.01);
  var t = h * 2.0;
  var res = 1.0;
  for (var i = 0; i < 16; i++) {
    let s = giSdfLod(p + l * t, t * 0.08);
    if (s.x < h * 0.2) { return 0.0; }
    res = min(res, 4.0 * s.x / t);
    t += max(s.x, t * 0.08);
    if (t > maxT) { break; }
  }
  return clamp(res, 0.0, 1.0);
}
/// True inside a set with the SDF on: the large-scale occlusion terms below apply (the Studio is unchanged).
fn lookSetOcc() -> bool { return look.gi.z > 0.0 && look.p0.z > 0.5 && (gi.dims.w & 2u) != 0u; }
/// The window-sky rim inside a set, occluded over 1.5 m: it is a directional stand-in for light through the
/// windows, and unoccluded it lit the shelf under the bench top blue. Needs the set's boxes in the SDF
/// (Gi.setStatic). Only traced where the surface faces the rim.
fn lookRimVis(wp: vec3f, nrm: vec3f) -> f32 {
  if (!lookSetOcc() || dot(nrm, frame.rim.xyz) <= 0.0) { return 1.0; }
  return lookOcc(wp + nrm * 0.03, frame.rim.xyz, 1.5);
}
/// Specular occlusion of the set IBL along the reflection: the IBL is one probe at room centre, so a glossy
/// surface under an overhang (the bench's lower shelf) reflected the bright room instead of the underside
/// above it. Rough surfaces skip the trace (their lobe is wide; the AO term covers them).
fn lookSpecVis(wp: vec3f, nrm: vec3f, r: vec3f, rough: f32) -> f32 {
  if (!lookSetOcc() || rough >= 0.7) { return 1.0; }
  let vis = lookOcc(wp + nrm * 0.03, r, 1.5);
  return mix(1.0, mix(0.15, 1.0, vis), 1.0 - smoothstep(0.45, 0.7, rough));
}
fn lookSdfAo(wp: vec3f, n: vec3f) -> f32 {
  if (look.gi.y <= 0.0) { return 1.0; }
  return mix(1.0, giAo(wp, n), look.gi.y);
}
/// Probe GI irradiance / pi (x albedo), or -1 when the probes are off or don't cover the point. Evaluated at
/// half resolution in the AO pass (D81 win-back 5, amortised GI) and upsampled here with depth weights.
fn lookGiDiffuse(rel: vec3f) -> vec3f {
  if (look.gi.x <= 0.0) { return vec3f(-1.0); }
  let clip = frame.viewProj * vec4f(rel, 1.0);
  let uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
  let sz = look.screen.zw;
  let p = uv * sz - 0.5;
  let b = vec2i(floor(p));
  let f = fract(p);
  let z = dot(rel, look.viewFwd.xyz);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(b + o, vec2i(0), vec2i(sz) - 1);
    let g = textureLoad(giHalf, q, 0);
    if (g.x < 0.0) { continue; }
    let gz = textureLoad(aoTex, q, 0).z;
    let bw = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = bw / (1e-3 + abs(gz - z) / max(z, 0.05) * 40.0) + 1e-5;
    acc += g.rgb * w;
    wsum += w;
  }
  return select(vec3f(-1.0), acc / max(wsum, 1e-6), wsum > 1e-4);
}

/// The shadowed practical's depth map (4-tap PCF); 1 outside its frustum.
fn spotShadowAt(rel: vec3f, nrm: vec3f) -> f32 {
  let p = look.spotVP * vec4f(rel + nrm * 0.01, 1.0);
  if (p.w <= 1e-4) { return 1.0; }
  let ndc = p.xyz / p.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) { return 1.0; }
  let ts = 1.0 / f32(textureDimensions(spotShadow).x);
  var s = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1) - 0.5, f32(k >> 1) - 0.5) * ts * 1.5;
    s += textureSampleCompareLevel(spotShadow, shadowSampler, uv + o, ndc.z - 0.0004);
  }
  return s * 0.25;
}

/// Practical lamps: spot cones with a smooth inner/outer falloff, inverse square from the bulb radius, a
/// windowed range; the shadowed one samples its map. Uses brdf() from SHADE_WGSL.
fn lookPracticals(rel: vec3f, n: vec3f, v: vec3f, albedo: vec3f, rough: f32, metal: f32, shadowN: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let count = min(u32(look.pad1.x), 8u);
  for (var i = 0u; i < count; i++) {
    let s = look.spots[i];
    let d = s.pos.xyz - frame.eye.xyz - rel;
    let dist = length(d);
    if (dist >= s.pos.w) { continue; }
    let l = d / max(dist, 1e-4);
    let cone = smoothstep(s.dir.w, s.color.w, dot(-l, s.dir.xyz));
    if (cone <= 0.0) { continue; }
    let r = max(dist, s.extra.y);
    let win = clamp(1.0 - pow(dist / s.pos.w, 4.0), 0.0, 1.0);
    var a = cone * win * win / (r * r);
    if (s.extra.x > 0.5) { a *= spotShadowAt(rel, shadowN); }
    // M3 close-out: the lamps without a shadow map are shadowed by the SDF (the set's boxes are in it), so a
    // pendant over the bench no longer lights the lower shelf through the bench top
    else if (lookSetOcc() && dot(n, l) > 0.0) { a *= lookOcc(rel + frame.eye.xyz + shadowN * 0.03, l, max(dist - s.extra.y * 2.0, 0.05)); }
    c += brdf(n, v, l, albedo, rough, metal) * s.color.rgb * a;
  }
  return c;
}

/// Karis' analytic environment BRDF (split-sum DFG): returns (scale, bias) for F0.
fn envBrdf(ndv: f32, rough: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * ndv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}

/// Set IBL: diffuse irradiance and prefiltered specular (camera-relative world directions).
fn iblDiffuseAt(n: vec3f) -> vec3f { return textureSampleLevel(iblDiffuse, clampSampler, n, 0.0).rgb * look.p0.w; }
fn iblSpecAt(r: vec3f, rough: f32) -> vec3f {
  return textureSampleLevel(iblSpec, clampSampler, r, rough * look.p1.x).rgb * look.p2.x;
}

/// Detail layer weight: full within p1.z metres of the camera, gone beyond p1.w.
fn detailFade(rel: vec3f) -> f32 {
  if (look.p1.y < 0.5) { return 0.0; }
  return 1.0 - smoothstep(look.p1.z, look.p1.w, length(rel));
}

/// Triplanar detail sample in object space (metres). Returns (normal xy perturbation in the
/// dominant plane's axes, roughness offset, albedo multiplier − 1) blended over the three planes.
struct Detail { n: vec3f, rough: f32, albedo: f32 };
fn detailAt(id: u32, p: vec3f, nl: vec3f, scale: f32, dpx: vec3f, dpy: vec3f) -> Detail {
  var w = pow(abs(nl), vec3f(4.0));
  w /= max(w.x + w.y + w.z, 1e-4);
  let layer = i32(id);
  var d = Detail(vec3f(0.0), 0.0, 0.0);
  // wood grain runs along the part's long axis (woodX/Y/Z); the other details tile isotropically
  let s = scale;
  if (w.x > 0.01) {
    var uv = p.zy;
    var gx = dpx.zy; var gy = dpy.zy;
    if (id == 2u) { uv = p.yz; gx = dpx.yz; gy = dpy.yz; }
    let t = textureSampleGrad(detailTex, lookSampler, uv * s, layer, gx * s, gy * s);
    let tn = t.xy * 2.0 - 1.0;
    let tv = select(vec3f(0.0, tn.y, tn.x), vec3f(0.0, tn.x, tn.y), id == 2u);
    d.n += vec3f(0.0, tv.y, tv.z) * w.x;
    d.rough += (t.z - 0.5) * w.x;
    d.albedo += (t.w * 2.0 - 1.0) * w.x;
  }
  if (w.y > 0.01) {
    var uv = p.xz;
    var gx = dpx.xz; var gy = dpy.xz;
    if (id == 3u) { uv = p.zx; gx = dpx.zx; gy = dpy.zx; }
    let t = textureSampleGrad(detailTex, lookSampler, uv * s, layer, gx * s, gy * s);
    let tn = t.xy * 2.0 - 1.0;
    let tv = select(vec3f(tn.x, 0.0, tn.y), vec3f(tn.y, 0.0, tn.x), id == 3u);
    d.n += tv * w.y;
    d.rough += (t.z - 0.5) * w.y;
    d.albedo += (t.w * 2.0 - 1.0) * w.y;
  }
  if (w.z > 0.01) {
    var uv = p.xy;
    var gx = dpx.xy; var gy = dpy.xy;
    if (id == 2u) { uv = p.yx; gx = dpx.yx; gy = dpy.yx; }
    let t = textureSampleGrad(detailTex, lookSampler, uv * s, layer, gx * s, gy * s);
    let tn = t.xy * 2.0 - 1.0;
    let tv = select(vec3f(tn.x, tn.y, 0.0), vec3f(tn.y, tn.x, 0.0), id == 2u);
    d.n += tv * w.z;
    d.rough += (t.z - 0.5) * w.z;
    d.albedo += (t.w * 2.0 - 1.0) * w.z;
  }
  return d;
}

/// Normal strength per detail id: a fine tactile layer over the master or the set, never a relief.
fn detailStrength(id: u32) -> f32 {
  switch (id) {
    case 1u, 2u, 3u: { return 0.22; }  // wood grain
    case 4u: { return 0.05; }          // orange peel
    case 5u: { return 0.2; }           // cast-iron pitting
    case 6u: { return 0.08; }          // brushed
    case 7u: { return 0.08; }          // paper tooth
    case 8u: { return 0.1; }           // rubber
    case 9u: { return 0.25; }          // twist
    case 10u: { return 0.1; }          // plaster
    default: { return 0.15; }
  }
}

/// Tiles per metre for each detail id.
fn detailScale(id: u32) -> f32 {
  switch (id) {
    case 1u, 2u, 3u: { return 2.0; }   // wood: one 0.5 m tile of grain
    case 4u: { return 9.0; }           // orange peel
    case 5u: { return 6.0; }           // cast-iron pitting
    case 6u: { return 5.0; }           // brushed
    case 7u: { return 7.0; }           // paper tooth
    case 8u: { return 10.0; }          // rubber
    case 9u: { return 30.0; }          // twist
    case 10u: { return 1.5; }          // plaster
    default: { return 4.0; }
  }
}
`;

/** Surface inputs of fs_part (PART_FS_WGSL only: needs qrot from INST_WGSL). */
export const LOOK_SURFACE_WGSL = /* wgsl */ `
struct Surface { n: vec3f, albedo: vec3f, rough: f32, metal: f32 };
struct LookD { dpx: vec3f, dpy: vec3f, duvx: vec2f, duvy: vec2f, dlx: vec3f, dly: vec3f };
fn lookDerivs(rel: vec3f, uv: vec2f, lp: vec3f) -> LookD {
  return LookD(dpdx(rel), dpdy(rel), dpdx(uv), dpdy(uv), dpdx(lp), dpdy(lp));
}
/// The texture set (albedo, ORM, normal with a derivative tangent frame) and the detail layer over the master.
fn lookSurface(s0: Surface, code: u32, uv: vec2f, rel: vec3f, lp: vec3f, rot: vec4f, tint: vec3f, d: LookD, tan: vec4f) -> Surface {
  var s = s0;
  let lm = decodeLook(code);
  if (lm.layer > 0u && look.p3.w > 0.5) {
    // bit 15 of the layer code = the 2048² class (look/textures.ts LAYER_CLASS_BIT)
    let code = lm.layer - 1u;
    let L = i32(code & 0x7fffu);
    var alb: vec4f; var orm4: vec4f; var nrm: vec4f;
    if ((code & 0x8000u) != 0u) {
      alb = textureSampleGrad(setAlbedo2k, lookSampler, uv, L, d.duvx, d.duvy);
      orm4 = textureSampleGrad(setNrmOrm2k, lookSampler, uv, L * 2 + 1, d.duvx, d.duvy);
      nrm = textureSampleGrad(setNrmOrm2k, lookSampler, uv, L * 2, d.duvx, d.duvy);
    } else {
      alb = textureSampleGrad(setAlbedo, lookSampler, uv, L, d.duvx, d.duvy);
      orm4 = textureSampleGrad(setNrmOrm, lookSampler, uv, L * 2 + 1, d.duvx, d.duvy);
      nrm = textureSampleGrad(setNrmOrm, lookSampler, uv, L * 2, d.duvx, d.duvy);
    }
    s.albedo = alb.rgb * tint;
    let orm = orm4.rgb;
    s.rough = max(orm.g, 0.04);
    s.metal = orm.b;
    let tn = nrm.xyz * 2.0 - 1.0;
    let n = s.n;
    if (tan.w != 0.0) {
      // the exported MikkTSpace frame (E3c): bitangent = cross(n, t) * w, OpenGL +Y normal maps
      let T = normalize(tan.xyz - n * dot(n, tan.xyz));
      let B = cross(n, T) * tan.w;
      s.n = normalize(T * tn.x + B * tn.y + n * max(tn.z, 0.05));
    } else {
      // no tangents: a cotangent frame from screen derivatives (glTF v runs down the image)
      let dp2perp = cross(d.dpy, n);
      let dp1perp = cross(n, d.dpx);
      let T = dp2perp * d.duvx.x + dp1perp * d.duvy.x;
      let B = dp2perp * d.duvx.y + dp1perp * d.duvy.y;
      let im = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
      s.n = normalize(T * im * tn.x - B * im * tn.y + n * max(tn.z, 0.05));
    }
    lookCavity = orm.r; // cavity occlusion: indirect light only (shade())
  }
  if (lm.detail > 0u) {
    let fade = detailFade(rel);
    let wood = lm.detail <= 3u;
    if (fade > 0.0 || (wood && look.p2.z > 0.5)) {
      let nl = qrot(vec4f(-rot.xyz, rot.w), s.n);
      let dt = detailAt(lm.detail, lp, nl, detailScale(lm.detail), d.dlx, d.dly);
      s.n = normalize(qrot(rot, normalize(nl + dt.n * fade * detailStrength(lm.detail))));
      s.rough = clamp(s.rough + dt.rough * fade * 0.3, 0.04, 1.0);
      // WOOD_PROC: wood grain in the albedo at every distance, only where there's no texture set (look-dev fallback)
      if (wood) { if (lm.layer == 0u) { s.albedo *= max(1.0 + dt.albedo * 0.32 * look.p2.z, 0.2); } } else { s.albedo *= 1.0 + dt.albedo * fade * 0.5; }
    }
  }
  return s;
}
`;

/** Vertex side (PART_WGSL): decodes the one-number tangent from the normal's w (look/tangents.ts). */
export const LOOK_TANGENT_WGSL = /* wgsl */ `
/// The packed tangent code of the vertex being processed (set by vertex()/vertexMorph(), 0 = none).
var<private> vtxTanCode: f32 = 0.0;
fn tangentBasis(n: vec3f) -> mat2x3f {
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(n.y) < 0.999);
  let b0 = normalize(cross(up, n));
  return mat2x3f(b0, cross(n, b0));
}
/// xyz tangent (mesh space), w handedness; w = 0 when the vertex has none.
fn decodeTangent(n: vec3f, code: f32) -> vec4f {
  if (abs(code) < 0.005) { return vec4f(0.0); }
  let v = (abs(code) - 0.01) / 0.98;
  let a = (v * 2.0 - 1.0) * 3.14159265;
  let b = tangentBasis(normalize(n));
  return vec4f(b[0] * cos(a) + b[1] * sin(a), sign(code));
}
`;
