// RENDER (beta polish, D126): the pure parts of the environment's set pieces: the runtime-lit backdrop Earth's frame
// (spin and art-directed phase) and the distance LOD of fine set geometry (the Moon's solar arrays). gfx/environment.ts
// drives them; the renderer draws the Earth with fs_earth (shaders.ts) and the LOD through SceneItem.lod.

import type { Geometry } from './meshes.ts';

type V3 = [number, number, number];

/** This frame's backdrop Earth: spin axis (world) and angle (rad), and the direction to its sun (world, phase applied). */
export interface EarthFrame { readonly axis: V3; readonly angle: number; readonly sun: V3 }

/**
 * RENDER (beta polish, D126): this frame's Earth for the renderer: the spin angle from the wall clock (the same for every
 * player; 1°/min, so imperceptible frame to frame), and the set's sun turned toward the viewer until the phase angle at
 * the planet is `phaseDeg` (the Hangar's art-directed 105°, D112: a sunlit crescent instead of the true 130°), about the
 * axis sun × view, as E5c's bake did.
 */
export function earthFrame(e: { axis: readonly number[]; degPerMinute: number; phaseDeg?: number }, centerWorld: readonly number[], eye: readonly number[], sun: readonly number[], nowMs: number): EarthFrame {
  const al = Math.hypot(e.axis[0]!, e.axis[1]!, e.axis[2]!) || 1;
  const axis: V3 = al > 1e-6 ? [e.axis[0]! / al, e.axis[1]! / al, e.axis[2]! / al] : [0, 1, 0];
  const angle = ((((nowMs / 60000) * e.degPerMinute) % 360) * Math.PI) / 180;
  const sl = Math.hypot(sun[0]!, sun[1]!, sun[2]!) || 1;
  let L: V3 = [sun[0]! / sl, sun[1]! / sl, sun[2]! / sl];
  if (e.phaseDeg !== undefined) {
    const v = [eye[0]! - centerWorld[0]!, eye[1]! - centerWorld[1]!, eye[2]! - centerWorld[2]!];
    const vl = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    const V: V3 = [v[0]! / vl, v[1]! / vl, v[2]! / vl];
    const cur = Math.acos(Math.max(-1, Math.min(1, L[0] * V[0] + L[1] * V[1] + L[2] * V[2])));
    const target = (e.phaseDeg * Math.PI) / 180;
    const ax = [L[1] * V[2] - L[2] * V[1], L[2] * V[0] - L[0] * V[2], L[0] * V[1] - L[1] * V[0]];
    const axl = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
    if (axl > 1e-6 && cur > target) {
      const k = [ax[0]! / axl, ax[1]! / axl, ax[2]! / axl], t = cur - target, c = Math.cos(t), s = Math.sin(t);
      const kd = k[0]! * L[0] + k[1]! * L[1] + k[2]! * L[2];
      const kx = [k[1]! * L[2] - k[2]! * L[1], k[2]! * L[0] - k[0]! * L[2], k[0]! * L[1] - k[1]! * L[0]];
      L = [0, 1, 2].map((i) => L[i]! * c + kx[i]! * s + k[i]! * kd * (1 - c)) as unknown as V3;
    }
  }
  return { axis, angle, sun: L };
}

/**
 * RENDER (beta polish, D126): set pieces whose fine geometry aliases at a distance (the Moon's solar panels: 1 m cell
 * modules with 8 cm gaps over a darker backplate, ART D128) are their own meshes per 32 m chunk with the glb's LOD chain,
 * and drop to the gap-less LOD2 slabs once a gap is under FAR_GAP_PX (¾) of a pixel: past that the gaps can only shimmer
 * (at 1080p that's ≈ 135 m; the hero views at 50–90 m keep the grid). LOD2 is
 * tinted to the module's area-weighted mean (85 % cell, 15 % backplate), so the switch keeps the panel's average tone.
 */
export const FAR_LOD = /__solar_(arrays|cells)__/;
export const FAR_GAP_M = 0.08;
export const FAR_GAP_PX = 0.75;
export const FAR_TINT = 0.9;
/** The far LOD's backplate material (dropped there: see `load`). */
export const FAR_HIDDEN = /^kn_env_solar_grid/;

/** A copy of `g` without the triangles whose three vertices carry exactly the colour `c` (one material's base colour). */
export function dropColour(g: Geometry, c: readonly number[]): Geometry {
  const col = g.colors;
  if (!col) return g;
  const same = (v: number): boolean => Math.abs(col[v * 4]! - c[0]!) < 1e-6 && Math.abs(col[v * 4 + 1]! - c[1]!) < 1e-6 && Math.abs(col[v * 4 + 2]! - c[2]!) < 1e-6;
  const idx: number[] = [];
  for (let t = 0; t < g.indices.length; t += 3) {
    const a = g.indices[t]!, b = g.indices[t + 1]!, d = g.indices[t + 2]!;
    if (!(same(a) && same(b) && same(d))) idx.push(a, b, d);
  }
  return idx.length === g.indices.length ? g : { ...g, indices: new Uint32Array(idx) };
}

/** The distance LOD for a far-LOD chunk: 0 while its finest gap spans ≥ FAR_GAP_PX px (10 % hysteresis), else its last LOD. */
export function farLod(dist: number, fovDeg: number, heightPx: number, lods: number, prev: number): number {
  const px = (FAR_GAP_M * heightPx) / (Math.max(dist, 1e-3) * 2 * Math.tan((fovDeg * Math.PI) / 360));
  const far = prev > 0 ? px < FAR_GAP_PX * 1.1 : px < FAR_GAP_PX / 1.1;
  return far ? lods - 1 : 0;
}
