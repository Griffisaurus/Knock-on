// R5 (M5): WGSL for the Future Tech effects (art/briefs/vfx.md §7). Two pipelines share one instance format:
//   FIELD  (late pass, after glass): emissive field surfaces, premultiplied (mostly additive): stasis lattice box, force
//          wall, tractor cone, hover glow disc and ground ripples, expanding rings, halos, the accretion disk.
//   WARP   (late pass, before glass: RenderHook.drawMatter): screen-space refraction that samples the resolved opaque
//          scene: Singularity lensing (Einstein ring, black core), Grav Well shimmer, Hover Pad heat column, Coilgun
//          ripple, Rift Gate membranes (swirl, or a screen-space glimpse out of the partner gate on 12 GB+).
// Both depth-test against the opaque depth (no write), so foreground parts are never bent or covered.

import { FRAME_WGSL } from '../shaders.ts';

/** Instance kinds (FieldInst.o.w). Field: 1–19, warp: 20+. */
export const K = {
  stasis: 1, wall: 2, tractor: 3, disc: 4, ripples: 5, ring: 6, halo: 7, adisk: 8,
  lens: 20, shimmer: 21, column: 22, ripple: 23, rift: 24,
} as const;
/** Vertices per instance by primitive: quad, box, cone (48 segments). */
export const PRIM_VERTS = { quad: 6, box: 36, cone: 48 * 6 } as const;
export const INST_FLOATS = 28;

const COMMON = /* wgsl */ `
${FRAME_WGSL}
struct FI { o: vec4f, ax: vec4f, ay: vec4f, az: vec4f, p: vec4f, q: vec4f, col: vec4f };
struct FU { right: vec4f, up: vec4f, size: vec4f, misc: vec4f }; // misc: x time, y motion scale, z tier index, w glimpse on
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> fu: FU;
@group(0) @binding(2) var<storage, read> fis: array<FI>;
@group(0) @binding(3) var<storage, read> rip: array<vec4f>;

struct VO {
  @builtin(position) clip: vec4f,
  @location(0) l: vec3f,                        // primitive-local coordinates
  @location(1) rel: vec3f,                      // camera-relative world position
  @location(2) n: vec3f,                        // surface normal (world)
  @location(3) @interpolate(flat) id: u32,
};

const PLASMA = vec3f(1.0, 0.047, 0.42);

fn quadCorner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(1., 1.), vec2f(-1., -1.), vec2f(1., 1.), vec2f(-1., 1.));
  return c[vi % 6u];
}
fn boxCorner(vi: u32) -> vec3f {
  // 6 faces × 2 triangles; face f: axis f / 2, sign ±
  let f = vi / 6u;
  let c = quadCorner(vi);
  let s = select(-1.0, 1.0, (f & 1u) == 1u);
  switch (f / 2u) {
    case 0u: { return vec3f(s, c.x, c.y); }
    case 1u: { return vec3f(c.x, s, c.y); }
    default: { return vec3f(c.x, c.y, s); }
  }
}
fn billboard(k: u32) -> bool { return k == ${K.halo}u || k == ${K.lens}u || k == ${K.shimmer}u || k == ${K.ripple}u; }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let f = fis[ii];
  let k = u32(f.o.w);
  var o: VO;
  o.id = ii;
  var w: vec3f;
  if (k == ${K.stasis}u) {
    let l = boxCorner(vi);
    o.l = l;
    w = f.o.xyz + f.ax.xyz * l.x + f.ay.xyz * l.y + f.az.xyz * l.z;
    o.n = normalize(select(select(f.az.xyz * l.z, f.ay.xyz * l.y, abs(l.y) > 0.999), f.ax.xyz * l.x, abs(l.x) > 0.999));
  } else if (k == ${K.tractor}u) {
    // cone along az (full length), radius p.x at the lens → p.y at the end; 48 segments, side only
    let seg = vi / 6u;
    let c = quadCorner(vi);
    let a = (f32(seg) + c.x * 0.5 + 0.5) / 48.0 * 6.2831853;
    let z = c.y * 0.5 + 0.5;
    let r = mix(f.p.x, f.p.y, z);
    let rad = normalize(f.ax.xyz) * cos(a) + normalize(f.ay.xyz) * sin(a);
    o.l = vec3f(a, z, r);
    w = f.o.xyz + f.az.xyz * z + rad * r;
    o.n = rad;
  } else if (k == ${K.column}u) {
    // a vertical quad turned to face the camera about +Y (hover heat column): ax.w = half width, ay = half height (up)
    let c = quadCorner(vi);
    let toEye = frame.eye.xyz - f.o.xyz;
    let side = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye + vec3f(1e-4, 0.0, 0.0)));
    o.l = vec3f(c, 0.0);
    w = f.o.xyz + side * c.x * f.ax.w + f.ay.xyz * c.y;
    o.n = normalize(toEye);
  } else {
    let c = quadCorner(vi);
    o.l = vec3f(c, 0.0);
    if (billboard(k)) {
      w = f.o.xyz + (fu.right.xyz * c.x + fu.up.xyz * c.y) * f.ax.w;
      o.n = normalize(frame.eye.xyz - f.o.xyz);
    } else {
      w = f.o.xyz + f.ax.xyz * c.x + f.ay.xyz * c.y;
      o.n = normalize(cross(f.ax.xyz, f.ay.xyz));
    }
  }
  o.rel = w - frame.eye.xyz;
  o.clip = frame.viewProj * vec4f(o.rel, 1.0);
  return o;
}

// ---- shared patterns ----

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn wrapv(x: vec2f, r: vec2f) -> vec2f { return x - r * floor(x / r); }
/// Hex lattice (cell size 1 across flats): x = distance to the cell edge (0 on the lines), yz = cell id.
fn hex(p: vec2f) -> vec3f {
  let r = vec2f(1.0, 1.7320508);
  let h = r * 0.5;
  let a = wrapv(p, r) - h;
  let b = wrapv(p - h, r) - h;
  let g = select(b, a, dot(a, a) < dot(b, b));
  let d = max(dot(abs(g), normalize(r)), abs(g.x));
  return vec3f(0.5 - d, p - g);
}
fn lineMask(d: f32, w: f32) -> f32 {
  let fw = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(w - fw, w + fw, d);
}
`;

export const FIELD_WGSL = /* wgsl */ `diagnostic(off, derivative_uniformity);
${COMMON}

@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let f = fis[i.id];
  let k = u32(f.o.w);
  let t = fu.misc.x;
  let v = normalize(-i.rel);
  var c = vec3f(0.0);
  var a = 0.0;
  switch (k) {
    case ${K.stasis}u: {
      // box shell: hex lattice 12 % on the faces, 60 % on the edges, corner brackets (a pattern, never a solid outline).
      // p: half extents (m), w = sweep progress 0–1 (from the four bottom corner nodes); q.x fade (off: shatter)
      let h = f.p.xyz;
      let l = i.l;
      let al = abs(l);
      var uv: vec2f;
      var e: vec2f; // distance to the face's edges (m)
      if (al.x > 0.999) { uv = l.yz * h.yz; e = h.yz - abs(uv); }
      else if (al.y > 0.999) { uv = l.xz * h.xz; e = h.xz - abs(uv); }
      else { uv = l.xy * h.xy; e = h.xy - abs(uv); }
      let hx = hex(uv / 0.035);
      let lat = lineMask(hx.x, 0.04);
      let edge = 1.0 - smoothstep(0.0025, 0.0045, min(e.x, e.y));
      let corner = edge * (1.0 - smoothstep(0.04, 0.06, max(e.x, e.y)));
      let dash = step(0.35, fract(max(abs(uv.x), abs(uv.y)) / 0.02));
      // sweep: distance from the nearest bottom corner (box-local metres)
      let wp = l * h;
      let dc = length(vec3f(h.x - abs(wp.x), wp.y + h.y, h.z - abs(wp.z)));
      let sweep = 1.0 - smoothstep(f.p.w * length(h) * 2.2 - 0.04, f.p.w * length(h) * 2.2, dc);
      let fl = 0.12 * lat + 0.6 * edge * (0.55 + 0.45 * dash) + 0.4 * corner;
      let shimmer = 0.85 + 0.15 * sin(t * 1.3 + (hx.y + hx.z) * 0.7);
      c = PLASMA * f.col.w * fl * shimmer * sweep * f.q.x;
      if (!ff) { c *= 0.6; }
    }
    case ${K.wall}u: {
      // hex-lattice plane (cell 0.02 m), 15 % idle, brighter edges; ripples from the contact points (2 m/s, 0.6 s, cells
      // nearby lit up to 80 %). p.xy half size (m), p.z print-in progress 0–1 (from the posts), p.w fade; q.x first
      // ripple, q.y count
      let hs = f.p.xy;
      let uv = i.l.xy * hs;
      let hx = hex(uv / 0.02);
      let cellC = hx.yz * 0.02;
      let lat = lineMask(hx.x, 0.06);
      let edge = 1.0 - smoothstep(0.0, 0.02, min(hs.x - abs(uv.x), hs.y - abs(uv.y)));
      var lit = 0.15;
      for (var r = 0u; r < u32(f.q.y); r++) {
        let R = rip[u32(f.q.x) + r];
        let rad = 2.0 * R.z;
        let d = length(cellC - R.xy);
        let band = exp(-pow((d - rad) / 0.03, 2.0));
        lit = max(lit, min(0.8, 0.15 + R.w * band * (1.0 - R.z / 0.6)));
      }
      let print = step(hs.x - abs(uv.x), f.p.z * hs.x + 0.001);
      c = PLASMA * f.col.w * (lit * (0.35 + 0.65 * lat) + 0.5 * edge) * print * f.p.w;
    }
    case ${K.tractor}u: {
      // soft cone: Field-colour edges, 20 % white core, ring bands (pull: toward the lens at 1.5 m/s; hold: standing,
      // breathing, a bright ring at the hold point). p.z length (m), p.w mode (0 pull, 1 hold); q.x hold distance, q.y strain
      let z = i.l.y;
      let s = z * f.p.z;
      let ndv = abs(dot(normalize(i.n), v));
      let rim = pow(1.0 - ndv, 2.5);
      let core = 0.2 * pow(ndv, 3.0);
      var ph = (s + t * 1.5) / 0.375;
      var breathe = 1.0;
      if (f.p.w > 0.5) { ph = s / 0.375; breathe = 0.65 + 0.35 * sin(t * 5.0); }
      let band = pow(0.5 + 0.5 * cos(ph * 6.2831853), 8.0) * breathe;
      var hold = 0.0;
      if (f.p.w > 0.5) { hold = exp(-pow((s - f.q.x) / 0.03, 2.0)) * 2.0; }
      let tip = 1.0 - smoothstep(0.8, 1.0, z);
      let flick = 1.0 - f.q.y * 0.25 * step(0.5, fract(t * 2.7));
      c = (PLASMA * (rim * 0.9 + band * 0.55 + hold) + vec3f(core)) * f.col.w * tip * flick * smoothstep(0.0, 0.04, s);
    }
    case ${K.disc}u: {
      // underside glow (hover pad): soft radial disc, col.w intensity
      let r = length(i.l.xy);
      c = f.col.rgb * f.col.w * exp(-r * r * 3.5) * (1.0 - smoothstep(0.85, 1.0, r));
    }
    case ${K.ripples}u: {
      // two ground ripple rings expanding to the quad's edge at p.x Hz, brightness p.y
      let r = length(i.l.xy);
      var g = 0.0;
      for (var k2 = 0; k2 < 2; k2++) {
        let R = fract(t * f.p.x + f32(k2) * 0.5);
        g += exp(-pow((r - R) / 0.045, 2.0)) * (1.0 - R);
      }
      c = f.col.rgb * f.col.w * g * f.p.y;
    }
    case ${K.ring}u: {
      // one expanding ring in its plane: p.x radius (fraction of the quad), p.y width (fraction), p.z fade
      let r = length(i.l.xy);
      let g = exp(-pow((r - f.p.x) / max(f.p.y, 1e-3), 2.0));
      c = f.col.rgb * f.col.w * g * f.p.z;
    }
    case ${K.halo}u: {
      // billboard glow: p.x core glow, p.y ring radius (fraction), p.z ring width, p.w ring strength
      let r = length(i.l.xy);
      let glow = exp(-r * r * 9.0) * f.p.x;
      let ring = exp(-pow((r - f.p.y) / max(f.p.z, 1e-3), 2.0)) * f.p.w;
      c = f.col.rgb * f.col.w * (glow + ring) * (1.0 - smoothstep(0.9, 1.0, r));
    }
    case ${K.adisk}u: {
      // accretion disk in its plane: p.x inner radius (fraction), p.y spin, p.z fade; hot white inside → Ignition →
      // Plasma → dark outside, swirl streaks, the approaching side 40 % brighter
      let r = length(i.l.xy);
      let x = clamp((r - f.p.x) / (1.0 - f.p.x), 0.0, 1.0);
      if (r < f.p.x * 0.97 || r > 1.0) { discard; }
      // the far side of the disk is hidden by the black core (q.x = core radius, m)
      let dv = normalize(i.rel);
      let cr = f.o.xyz - frame.eye.xyz;
      let tc = dot(cr, dv);
      if (length(cr - dv * tc) < f.q.x && length(i.rel) > tc) { discard; }
      var ramp = mix(vec3f(1.0, 0.905, 0.745) * 2.5, vec3f(1.0, 0.105, 0.027) * 1.6, smoothstep(0.0, 0.3, x));
      ramp = mix(ramp, PLASMA * 1.2, smoothstep(0.25, 0.65, x));
      ramp *= 1.0 - smoothstep(0.55, 1.0, x);
      let ang = atan2(i.l.y, i.l.x);
      let streak = 0.55 + 0.45 * vnoise(vec2f(ang * 5.0 - t * f.p.y / max(r, 0.2), r * 9.0));
      let tang = normalize(cross(normalize(cross(f.ax.xyz, f.ay.xyz)), f.ax.xyz * i.l.x + f.ay.xyz * i.l.y));
      let toward = clamp(dot(tang, v), -1.0, 1.0);
      let inner = smoothstep(f.p.x * 0.97, f.p.x * 1.08, r);
      c = ramp * streak * (1.0 + 0.4 * toward) * f.col.w * f.p.z * inner;
    }
    default: { discard; }
  }
  return vec4f(c, a);
}
`;

export const WARP_WGSL = /* wgsl */ `diagnostic(off, derivative_uniformity);
${COMMON}
@group(0) @binding(4) var scene: texture_2d<f32>;
@group(0) @binding(5) var depthR: texture_2d<f32>;   // the opaque depth, resolved to r32float (nearest sample)
@group(0) @binding(6) var samp: sampler;

fn toUv(rel: vec3f) -> vec3f {
  let c = frame.viewProj * vec4f(rel, 1.0);
  let n = c.xyz / max(c.w, 1e-5);
  return vec3f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5, n.z);
}
fn sceneAt(uv: vec2f) -> vec3f { return textureSampleLevel(scene, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb; }
fn depthAt(uv: vec2f) -> f32 {
  let d = vec2i(textureDimensions(depthR));
  return textureLoad(depthR, clamp(vec2i(uv * vec2f(d)), vec2i(0), d - 1), 0).r;
}
fn qrotW(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }

/// Polar swirl for an idle membrane (Low / Medium, and where the glimpse finds nothing): r 0–1.
fn swirl(l: vec2f, t: f32) -> f32 {
  let r = length(l);
  let a = atan2(l.y, l.x);
  let s = vnoise(vec2f(a * 2.0 + r * 6.0 - t * 1.4, r * 5.0 - t * 0.6)) * 0.6 + vnoise(vec2f(a * 5.0 - r * 9.0 + t * 2.1, r * 11.0)) * 0.4;
  return s;
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let f = fis[i.id];
  let k = u32(f.o.w);
  let t = fu.misc.x;
  let ms = fu.misc.y;                                  // Reduced motion: distortion ≤ 30 %
  let uv0 = i.clip.xy * fu.size.zw;
  let r = length(i.l.xy);
  if (r > 1.0 && k != ${K.column}u) { discard; }
  var col = sceneAt(uv0);
  switch (k) {
    case ${K.lens}u: {
      // Singularity (vfx §7.1): point-mass lensing β = θ − θE² / θ in the billboard plane (metres), an Einstein-ring
      // brightening at θE and the black core (shadow). ax.w quad radius, p.x θE, p.y core radius, p.z strength
      // The billboard is drawn near the camera (so nothing depth-rejects it); q.x = R at the core, q.yzw = the core
      // (eye-relative). Each pixel's own depth decides how much it bends: nothing in front of the core, fading in behind
      // it, so the floor running under the lens stays continuous.
      let R = f.q.x;
      let q = i.l.xy * R;
      let th = max(length(q), 1e-4);
      let coreRel = f.q.yzw;
      let dLens = length(coreRel) - f.p.y;
      let z = depthAt(uv0);
      let wp = frame.invViewProj * vec4f(uv0.x * 2.0 - 1.0, 1.0 - uv0.y * 2.0, z, 1.0);
      let dScene = select(1e6, length(wp.xyz / wp.w), z < 1.0);
      let behind = smoothstep(dLens - 0.02, dLens + 0.5 * f.p.x, dScene);
      let fade = (1.0 - smoothstep(0.55 * R, R, th)) * behind;
      let defl = f.p.x * f.p.x / th * f.p.z * ms * fade;
      let b = q - q / th * defl;
      let src = coreRel + fu.right.xyz * b.x + fu.up.xyz * b.y;
      let suv = toUv(src);
      col = sceneAt(suv.xy);
      let ring = exp(-pow((th - f.p.x) / (0.1 * f.p.x), 2.0)) * f.p.z * 1.2 * fade;
      col *= 1.0 + ring;
      col = mix(col, col * vec3f(1.0, 0.75, 0.9), ring * 0.3);
      col *= mix(1.0, smoothstep(f.p.y * 0.85, f.p.y * 1.12, th), step(dLens - 0.01, dScene));
    }
    case ${K.shimmer}u: {
      // Grav Well (future.md): a subtle shimmer within 0.3 m of the orb. p.x amplitude (uv), p.y scale
      let fade = 1.0 - smoothstep(0.45, 1.0, r);
      let n = vec2f(vnoise(i.l.xy * f.p.y + vec2f(t * 1.7, 0.0)), vnoise(i.l.xy * f.p.y + vec2f(0.0, -t * 1.3) + 17.0)) - 0.5;
      col = sceneAt(uv0 + n * f.p.x * fade * ms);
    }
    case ${K.column}u: {
      // Hover Pad heat-shimmer column (vfx §7.5): rising wavy offset, strongest in the middle. p.x amplitude (uv)
      let ex = 1.0 - smoothstep(0.4, 1.0, abs(i.l.x));
      let ey = 1.0 - smoothstep(0.7, 1.0, abs(i.l.y));
      let w = sin(i.l.y * 18.0 - t * 7.0 + vnoise(i.l.xy * vec2f(3.0, 6.0) + vec2f(0.0, -t * 2.0)) * 5.0);
      col = sceneAt(uv0 + vec2f(w, 0.3 * w) * f.p.x * ex * ey * ms);
    }
    case ${K.ripple}u: {
      // a lens-shaped refraction ring (Coilgun exit ripple, Rift transit): p.x radius (fraction), p.y width, p.z strength (uv)
      let x = (r - f.p.x) / max(f.p.y, 1e-3);
      let g = x * exp(-x * x * 1.6) * f.p.z * ms;
      let dir = select(vec2f(0.0), normalize(i.clip.xy - (toUv(f.o.xyz - frame.eye.xyz).xy / fu.size.zw)), r > 1e-3);
      col = sceneAt(uv0 - dir * g);
    }
    case ${K.rift}u: {
      // Rift Gate membrane (vfx §7.2). ax / ay = the aperture's in-plane axes (half size), az.xyz = the membrane normal.
      // p.x paired (0 grey, still), p.y glimpse on, p.z transit ripple age (s, < 0 none), p.w cooldown dim;
      // q = the partner's rotation (B · RotY(180°) · A⁻¹ is applied on the CPU: q maps directions A → B),
      // az.w / ay.w / ... carry the partner's membrane centre: (f.ax.w, f.ay.w, f.az.w) relative to the eye.
      let pair = f.col.rgb;
      let l = i.l.xy;
      var rip = 0.0;
      if (f.p.z >= 0.0) { let rr = f.p.z / 0.4; rip = sin((r - rr) * 40.0) * exp(-pow((r - rr) / 0.12, 2.0)) * (1.0 - rr); }
      let lr = l + l * rip * 0.08 * ms;
      let sw = swirl(lr, t * select(0.0, 1.0, f.p.x > 0.5));
      var c = mix(vec3f(0.06, 0.065, 0.075), mix(pair * 0.35, pair * 1.6, sw), f.p.x);
      if (f.p.y > 0.5 && f.p.x > 0.5) {
        // the glimpse: the view ray through this point, carried through the partner gate, marched against the depth
        let d0 = normalize(i.rel);
        let dB = qrotW(f.q, d0);
        let pA = i.rel + frame.eye.xyz - f.o.xyz;            // offset from A's centre (world)
        let aX = normalize(f.ax.xyz);
        let aY = normalize(f.ay.xyz);
        let lx = dot(pA, aX);
        let ly = dot(pA, aY);
        let bC = vec3f(f.ax.w, f.ay.w, f.az.w);              // partner centre, eye-relative
        let bX = qrotW(f.q, aX);
        let bY = qrotW(f.q, aY);
        let start = bC + bX * lx + bY * ly;
        var hit = vec3f(-1.0);
        var tt = 0.03;
        var last = vec3f(-1.0);
        for (var s = 0; s < 14; s++) {
          let pp = start + dB * tt;
          let u = toUv(pp);
          if (any(u.xy < vec2f(0.0)) || any(u.xy > vec2f(1.0)) || u.z <= 0.0) { break; }
          last = u;
          if (depthAt(u.xy) < u.z - 1e-5) { hit = u; break; }
          tt *= 1.45;
        }
        let g = select(last, hit, hit.x >= 0.0);
        if (g.x >= 0.0) {
          let view = sceneAt(g.xy + lr * rip * 0.02);
          let edgeFade = 1.0 - smoothstep(0.75, 0.98, r);
          c = mix(c, view * mix(vec3f(1.0), pair, 0.15) + pair * sw * 0.15, 0.85 * edgeFade);
        }
      }
      let edge = smoothstep(0.82, 0.99, r);
      c += pair * edge * (1.2 + 0.6 * sin(t * 3.0 + atan2(l.y, l.x) * 4.0)) * f.p.x;
      c += pair * abs(rip) * 2.0;
      col = c * (1.0 - 0.7 * f.p.w);
    }
    default: { discard; }
  }
  return vec4f(col, 1.0);
}
`;

/** The opaque depth resolved to r32float (nearest of the MSAA samples) for the warps that march or test it. */
export const DEPTH_WGSL = /* wgsl */ `
@group(0) @binding(0) var dms: texture_depth_multisampled_2d;
@group(0) @binding(1) var dout: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn resolveDepth(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(dms);
  if (any(g.xy >= d)) { return; }
  var z = 1.0;
  for (var s = 0; s < 4; s++) { z = min(z, textureLoad(dms, vec2i(g.xy), s)); }
  textureStore(dout, vec2i(g.xy), vec4f(z, 0.0, 0.0, 0.0));
}
`;
