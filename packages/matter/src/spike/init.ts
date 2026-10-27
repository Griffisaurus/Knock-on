// Deterministic initial state: lattice positions + integer hash jitter (SIMULATION §8.2 Emit).

import { LATTICE_JITTER, LATTICE_SPACING, LATTICE_Y0 } from './constants.ts';
import { fmix32 } from './imath.ts';

export interface MatterState {
  readonly n: number;
  /** x, y, z per grain (i32 units), packed with stride 3. */
  readonly pos: Int32Array;
  /** vx, vy, vz per grain (units/tick), packed with stride 3. */
  readonly vel: Int32Array;
}

/** Grains per lattice row/column; capped so the block fits inside the container walls. */
export function latticeSide(n: number): number {
  let s = 1;
  while (s * s * s < n) s++;
  return Math.min(s, 100);
}

export function initialState(n: number, seed = 0x5eed): MatterState {
  const pos = new Int32Array(n * 3);
  const vel = new Int32Array(n * 3);
  const side = latticeSide(n);
  const half = ((side - 1) * LATTICE_SPACING) >> 1;
  const span = LATTICE_JITTER * 2 - 1;
  for (let i = 0; i < n; i++) {
    const ix = i % side;
    const iz = ((i / side) | 0) % side;
    const iy = (i / (side * side)) | 0;
    const h = Math.imul(i, 3) + seed;
    pos[i * 3] = ix * LATTICE_SPACING - half + (fmix32(h) & span) - LATTICE_JITTER;
    pos[i * 3 + 1] = LATTICE_Y0 + iy * LATTICE_SPACING + (fmix32(h + 1) & span) - LATTICE_JITTER;
    pos[i * 3 + 2] = iz * LATTICE_SPACING - half + (fmix32(h + 2) & span) - LATTICE_JITTER;
  }
  return { n, pos, vel };
}
