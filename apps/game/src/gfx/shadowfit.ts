// RENDER (beta polish, D125): fitting the key light's two shadow cascades to what's in view.
//
// Before the polish pass there was one ortho map around the camera focus, up to 300 m across, so a zoomed-out Arena or
// Megastructure drew every part into it (14–24 ms on the whole-world camera, M5_NOTES_T5 finding 3). Now:
// - the **near** map keeps the focus-centred box (half extent 0.9 × the focus distance, capped at NEAR_MAX_EXT), shrunk
//   to the scene's bounds in light space;
// - the **far** map covers the camera frustum up to the shadow distance, intersected with the scene's bounds, at half
//   the near map's resolution, and part shadows fade out over its last 20 %. It's skipped when the near map already
//   covers everything in view;
// - both extents step along a 2^(1/8) ladder and both centres snap to whole texels in light space, so edges don't crawl
//   or shimmer while the camera moves or zooms;
// - casters are culled per cascade on the GPU (renderer.ts `writeCull`): one LOD coarser than the camera draws, a box
//   proxy below SHADOW_PROXY_PX on screen or a few texels in that map, nothing below SHADOW_SKIP_PX or a third of a texel.
//
// Everything here is plain maths on camera-relative matrices (world = rel + eye), so it's unit-tested.

import { lookAt, mul, type Mat4, type V3 } from '../math.ts';

/** Largest near-map half extent (m): 160 m across, 3.9 cm texels at 4,096². */
export const NEAR_MAX_EXT = 80;
/** Shadow casters drawn as a box below this projected radius (px of the internal height). */
export const SHADOW_PROXY_PX = 5;
/** Shadow casters skipped below this projected radius (px): their shadows are sub-pixel too. */
export const SHADOW_SKIP_PX = 0.5;
/** …or below this radius in the map's own texels: the near map keeps real meshes down to 1.5 texels, the far map to 3. */
export const NEAR_PROXY_TEXELS = 1.5;
export const FAR_PROXY_TEXELS = 3;

export interface Aabb { readonly min: V3; readonly max: V3 }

export interface CascadeFit {
  /** Camera-relative → clip. */
  readonly mat: Mat4;
  /** World size of one texel (m). */
  readonly texel: number;
  /** Half extent (m), on the ladder. */
  readonly ext: number;
  /** Light-space centre (snapped) and depth range (view-space z, toward the light is +). */
  readonly cx: number; readonly cy: number;
  readonly zNear: number; readonly zFar: number;
}

/** The smallest step of the 2^(1/8) ladder that holds `e` (≥ 0.25 m). */
export function quantExt(e: number): number {
  const k = Math.ceil(Math.log2(Math.max(e, 0.25)) * 8 - 1e-9);
  return 2 ** (k / 8);
}

/** The light's view matrix (looking from `key` toward the origin), as the renderer has always built it. */
export function lightView(key: V3): Mat4 {
  return lookAt([key[0], key[1], key[2]], [0, 0, 0], Math.abs(key[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
}

const toLight = (v: Mat4, p: readonly number[]): V3 => [
  v[0]! * p[0]! + v[4]! * p[1]! + v[8]! * p[2]!,
  v[1]! * p[0]! + v[5]! * p[1]! + v[9]! * p[2]!,
  v[2]! * p[0]! + v[6]! * p[1]! + v[10]! * p[2]!,
];

const corners = (b: Aabb): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i < 8; i++) out.push([(i & 1 ? b.max : b.min)[0], (i & 2 ? b.max : b.min)[1], (i & 4 ? b.max : b.min)[2]]);
  return out;
};

/** Light-space bounds (x, y, z ranges) of a world box. */
export function lightBounds(v: Mat4, b: Aabb): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const c of corners(b)) {
    const l = toLight(v, c);
    r.x0 = Math.min(r.x0, l[0]); r.x1 = Math.max(r.x1, l[0]);
    r.y0 = Math.min(r.y0, l[1]); r.y1 = Math.max(r.y1, l[1]);
    r.z0 = Math.min(r.z0, l[2]); r.z1 = Math.max(r.z1, l[2]);
  }
  return r;
}

export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1;
  return m;
}

/** A square cascade around light-space (x, y) with half extent `e` (laddered), centre snapped to texels. */
function cascade(v: Mat4, eye: V3, x: number, y: number, e: number, size: number, zNear: number, zFar: number): CascadeFit {
  const ext = quantExt(e);
  const texel = (2 * ext) / size;
  const cx = Math.round(x / texel) * texel, cy = Math.round(y / texel) * texel;
  // view space looks down −z: ortho near/far are distances along −z, so a light-space z range [z0, z1] is [−z1, −z0]
  const proj = ortho(cx - ext, cx + ext, cy - ext, cy + ext, -zFar, -zNear);
  const toWorld = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1]);
  return { mat: mul(mul(proj, v), toWorld), texel, ext, cx, cy, zNear, zFar };
}

/**
 * The near cascade: the focus-centred box the renderer always used (half extent 0.9 × the focus distance + 0.5,
 * 1.5…NEAR_MAX_EXT m) and its depth range (focus ± 4 × extent + 20 m, so the depth bias means what it did), shrunk to
 * the scene's light-space bounds when those are smaller.
 */
export function fitNear(key: V3, eye: V3, focus: V3, size: number, scene: Aabb | null): CascadeFit {
  const v = lightView(key);
  const dist = Math.hypot(focus[0] - eye[0], focus[1] - eye[1], focus[2] - eye[2]);
  let e = Math.min(NEAR_MAX_EXT, Math.max(1.5, dist * 0.9 + 0.5));
  const f = toLight(v, focus);
  let x0 = f[0] - e, x1 = f[0] + e, y0 = f[1] - e, y1 = f[1] + e;
  let zNear = f[2] - (e * 4 + 20), zFar = f[2] + (e * 4 + 20);
  if (scene) {
    const lb = lightBounds(v, scene);
    x0 = Math.max(x0, lb.x0); x1 = Math.min(x1, lb.x1); y0 = Math.max(y0, lb.y0); y1 = Math.min(y1, lb.y1);
    if (x1 > x0 && y1 > y0) {
      e = Math.max(1.5, (x1 - x0) / 2, (y1 - y0) / 2);
      // casters anywhere toward the light inside the scene must fit in depth
      zNear = Math.min(zNear, lb.z0 - 1); zFar = Math.max(zFar, lb.z1 + 1);
    } else {
      x0 = f[0] - e; x1 = f[0] + e; y0 = f[1] - e; y1 = f[1] + e; // the focus is outside the scene: keep the plain box
    }
  }
  return cascade(v, eye, (x0 + x1) / 2, (y0 + y1) / 2, e, size, zNear, zFar);
}

/** The M5 single map (before D125), for before/after timings: the focus box up to 150 m half extent, unfitted. */
export function fitLegacy(key: V3, eye: V3, focus: V3, size: number): CascadeFit {
  const v = lightView(key);
  const dist = Math.hypot(focus[0] - eye[0], focus[1] - eye[1], focus[2] - eye[2]);
  const ext = Math.min(150, Math.max(1.5, dist * 0.9 + 0.5));
  const f = toLight(v, focus);
  const texel = (2 * ext) / size;
  const cx = Math.round(f[0] / texel) * texel, cy = Math.round(f[1] / texel) * texel;
  const depth = ext * 4 + 20;
  const proj = ortho(cx - ext, cx + ext, cy - ext, cy + ext, -f[2] - depth, -f[2] + depth);
  const toWorld = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1]);
  return { mat: mul(mul(proj, v), toWorld), texel, ext, cx, cy, zNear: f[2] - depth, zFar: f[2] + depth };
}

/** How far part shadows reach (m from the eye): 3 × the focus distance + 30, 60…1,500 m. They fade over the last 20 %. */
export function shadowDistance(focusDist: number): number {
  return Math.min(1500, Math.max(60, focusDist * 3 + 30));
}

/** World AABB of the camera frustum between `near` and `far` (m along the view direction). */
export function frustumBox(eye: V3, target: V3, fovDeg: number, aspect: number, near: number, far: number): Aabb {
  const fw = norm3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const up0: V3 = Math.abs(fw[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const rt = norm3(cross(fw, up0));
  const up = cross(rt, fw);
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const d of [near, far]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = [0, 1, 2].map((k) => eye[k]! + fw[k]! * d + rt[k]! * sx * t * aspect * d + up[k]! * sy * t * d);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
    }
  }
  return { min, max };
}

/**
 * The far cascade: the frustum's box up to the shadow distance, intersected with the scene's bounds, projected to light
 * space; null when there's no scene or when the near cascade already holds all of it (then the far pass is skipped).
 */
export function fitFar(key: V3, eye: V3, target: V3, fovDeg: number, aspect: number, size: number, scene: Aabb | null, near: CascadeFit): CascadeFit | null {
  if (!scene) return null;
  const focusDist = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
  const fb = frustumBox(eye, target, fovDeg, aspect, 0.05, shadowDistance(focusDist));
  const box: Aabb = {
    min: [0, 1, 2].map((k) => Math.max(fb.min[k]!, scene.min[k]!)) as unknown as V3,
    max: [0, 1, 2].map((k) => Math.min(fb.max[k]!, scene.max[k]!)) as unknown as V3,
  };
  if (box.min.some((v, k) => v > box.max[k]!)) return null;
  const v = lightView(key);
  const lb = lightBounds(v, box);
  // the near map's rect (minus its blend band) already covers it
  const inner = near.ext * 0.88;
  if (lb.x0 >= near.cx - inner && lb.x1 <= near.cx + inner && lb.y0 >= near.cy - inner && lb.y1 <= near.cy + inner) return null;
  const sl = lightBounds(v, scene);
  const e = Math.max((lb.x1 - lb.x0) / 2, (lb.y1 - lb.y0) / 2, near.ext);
  return cascade(v, eye, (lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2, e, size, sl.z0 - 1, sl.z1 + 1);
}

/** Planes (inward, camera-relative: n·rel + d ≥ 0 inside) of a clip matrix (z in [0, 1]), like renderer.ts `planes`. */
export function clipPlanes(m: Mat4): [number, number, number, number][] {
  const row = (r: number): number[] => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a: number[], b: number[], s: number): number[] => a.map((x, i) => x + s * b[i]!);
  return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), r2, add(r3, r2, -1)].map((p) => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    return [p[0]! / l, p[1]! / l, p[2]! / l, p[3]! / l];
  });
}

function cross(a: readonly number[], b: readonly number[]): V3 {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function norm3(a: readonly number[]): V3 {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
}
