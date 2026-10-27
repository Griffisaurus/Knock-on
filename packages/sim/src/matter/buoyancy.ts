// D101: water buoyancy from the backend's water-surface map plus Jolt's ApplyBuoyancyImpulse.
//
// The particle fluid can't carry hydrostatic pressure with depth (M4_NOTES_MX: a resting body feels ≈ 4 % of ρ·g·V
// through the particle contacts), so floating comes from here instead: each Matter command asks the backend for a
// coarse x–z height map of the water around the dynamic bodies (MatterStepIn.surface), the host keeps the newest map in
// st.matter.surf (plain state: rollback-safe, hashed), and every rigid tick each body near water gets Jolt's exact
// buoyancy for its current pose against the local water level, at ρ = 1,000 kg/m³. The particle impulses still do
// splashes, flow and impacts (a WATERWHEEL still turns from them); they add only their few-percent residual support.
//
// st.matter.surf: [] (no map) or [x0, z0, cell, nx, nz (units), then per non-empty cell: index, count, top, bottom
// (units), vx, vy, vz (units per Matter tick)] …, the map of the last applied result.

import type { MatterStepOut, MatterSurfaceReq } from './contract.ts';
import { MATTER_HZ, UNITS_PER_METRE } from './units.ts';

/** Map cell: 2 cm (1,311 units); coarser only when the bodies near water spread wider than MAX_CELLS allows. */
export const SURF_CELL = 1311;
/** Cells per map the host asks for (fits the browser link's 256 KB result slot with 4,096 proxies). */
export const MAX_CELLS = 4096;
/** Margin around the bodies' footprints, metres: the ring sample plus the fixed latency's travel (≈ 1 m/s × 67 ms). */
export const SURF_MARGIN = 0.1;
/** True water density (kg/m³). */
export const WATER_RHO = 1000;
/** Jolt drag coefficients: quadratic linear drag, and angular drag (Jolt's eq. 2.5.15 form). */
export const LINEAR_DRAG = 0.5;
export const ANGULAR_DRAG = 0.5;
/**
 * Linear water damping (1/s, times the submerged share of the body's height), relative to the water: what wave-making
 * and viscosity take out of a bob. Jolt's drag is quadratic, so on its own a floating body keeps bobbing for seconds.
 * 4/s settles a 40 g QUACK in ≈ 0.5 s and a 6 kg PLANK in ≈ 1 s (damping ratios ≈ 0.05 and 0.15).
 */
export const WATER_DAMP = 4;
/** Water particles per column cell volume: 1 mL each, and 1 L of particles fills ≈ 1.05 L (M4_NOTES_MX). */
const PARTICLE_M3 = 1.05e-6;
/** The free surface sits about half a lattice spacing (10 mm) above the top particle centres. */
const HALF_SPACING = 0.005;

const U = 1 / UNITS_PER_METRE;

/**
 * The map to ask for: the x–z footprints of the bodies near the active region (`box`: min x, min z, max x, max z,
 * metres), padded by SURF_MARGIN, aligned to whole cells. Null when there's nothing to cover.
 */
export function surfaceRequest(box: readonly number[]): MatterSurfaceReq | null {
  if (!(box[0]! <= box[2]!) || !(box[1]! <= box[3]!)) return null;
  const lo = [Math.floor((box[0]! - SURF_MARGIN) * UNITS_PER_METRE), Math.floor((box[1]! - SURF_MARGIN) * UNITS_PER_METRE)];
  const hi = [Math.ceil((box[2]! + SURF_MARGIN) * UNITS_PER_METRE), Math.ceil((box[3]! + SURF_MARGIN) * UNITS_PER_METRE)];
  let cell = SURF_CELL;
  for (;;) {
    const x0 = Math.floor(lo[0]! / cell) * cell, z0 = Math.floor(lo[1]! / cell) * cell;
    const nx = Math.floor((hi[0]! - x0) / cell) + 1, nz = Math.floor((hi[1]! - z0) / cell) + 1;
    if (nx * nz <= MAX_CELLS) return { x0, z0, cell, nx, nz };
    if (cell >= 1 << 20) return { x0, z0, cell, nx: Math.min(nx, 64), nz: Math.min(nz, 64) };
    cell = Math.min(1 << 20, cell * 2);
  }
}

/** A result's map as plain sparse state (see the file header); [] without one. */
export function surfaceState(out: MatterStepOut): number[] {
  const sf = out.surface;
  if (!sf) return [];
  const s = [sf.x0, sf.z0, sf.cell, sf.nx, sf.nz];
  for (let c = 0; c < sf.count.length; c++) {
    if (!(sf.count[c]! > 0)) continue;
    s.push(c, sf.count[c]!, sf.top[c]!, sf.bottom[c]!, sf.vel[c * 3]!, sf.vel[c * 3 + 1]!, sf.vel[c * 3 + 2]!);
  }
  return s;
}

/** Dense cell → offset into the state array (−1: dry), built once per map (the array is replaced on every result). */
export function surfaceIndex(s: readonly number[]): Int32Array {
  if (s.length < 5) return new Int32Array(0);
  const idx = new Int32Array(s[3]! * s[4]!).fill(-1);
  for (let k = 5; k < s.length; k += 7) idx[s[k]!] = k;
  return idx;
}

export interface WaterSample {
  /** Water level (world y, metres). */
  level: number;
  /** Mean water velocity (m/s), count-weighted. */
  vel: [number, number, number];
  /** Wet cells sampled. */
  cells: number;
}

/**
 * The water around a body whose world bounds are `bb` (min xyz, max xyz, metres): the mean level of the wet cells in a
 * one-cell ring just outside its x–z footprint. The footprint itself is never sampled: under a floating body the
 * column's top is the body's bottom, and water a body carries (WATERWHEEL buckets) isn't water it floats in. A column
 * whose water starts above the body's top (a container overhead) doesn't count; a sparse column (a falling stream,
 * spray) counts at the level its water would fill the cell to. Null when the ring is dry.
 */
export function sampleWater(s: readonly number[], idx: Int32Array, bb: readonly number[]): WaterSample | null {
  if (s.length < 5) return null;
  const x0 = s[0]!, z0 = s[1]!, cell = s[2]!, nx = s[3]!, nz = s[4]!;
  const cellM = cell * U, area = cellM * cellM;
  const fx0 = Math.floor((bb[0]! * UNITS_PER_METRE - x0) / cell), fx1 = Math.floor((bb[3]! * UNITS_PER_METRE - x0) / cell);
  const fz0 = Math.floor((bb[2]! * UNITS_PER_METRE - z0) / cell), fz1 = Math.floor((bb[5]! * UNITS_PER_METRE - z0) / cell);
  if (fx1 < -1 || fz1 < -1 || fx0 > nx || fz0 > nz) return null;
  const topY = bb[4]!;
  let sum = 0, n = 0, cnt = 0;
  const v: [number, number, number] = [0, 0, 0];
  for (let iz = Math.max(0, fz0 - 1); iz <= Math.min(nz - 1, fz1 + 1); iz++) {
    const edgeZ = iz < fz0 || iz > fz1;
    for (let ix = Math.max(0, fx0 - 1); ix <= Math.min(nx - 1, fx1 + 1); ix++) {
      if (!edgeZ && ix >= fx0 && ix <= fx1) continue; // the footprint
      const k = idx[iz * nx + ix]!;
      if (k < 0) continue;
      const count = s[k + 1]!, top = s[k + 2]! * U, bottom = s[k + 3]! * U;
      if (bottom > topY) continue; // water above the body (a container overhead)
      const fill = (count * PARTICLE_M3) / area; // depth the column's water fills the cell to
      const span = top - bottom + 2 * HALF_SPACING;
      const level = fill < 0.3 * span ? bottom - HALF_SPACING + fill : top + HALF_SPACING;
      sum += level; n++;
      cnt += count;
      v[0] += s[k + 4]! * count; v[1] += s[k + 5]! * count; v[2] += s[k + 6]! * count;
    }
  }
  if (!n) return null;
  const vs = (MATTER_HZ * U) / cnt;
  return { level: sum / n, vel: [v[0] * vs, v[1] * vs, v[2] * vs], cells: n };
}
