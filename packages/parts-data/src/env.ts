// THE STUDIO set (art/briefs/environments.md §1): the cyclorama cove per preset, shared by the sim
// (collision) and the renderer (the sweep mesh). Engine space: Y-up, front = +Z.

import { dcos, dsin } from '@knockon/detmath';

export interface CoveWall {
  /** Wall line on the floor (where the cove's vertical part stands). */
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  /** Inward (toward the set) unit normal. */
  readonly n: readonly [number, number, number];
}

export interface Cove {
  readonly radius: number;
  readonly height: number;
  /** Back and both sides; the front (+Z) is open. Corners are swept as quarter circles. */
  readonly walls: readonly CoveWall[];
  readonly corner: number;
}

// environments.md §1.1–1.2: neutral zone (engine x, z) and the cove's offset, radius and height.
const PRESETS: Record<string, { x: number; zBack: number; zFront: number; out: number; r: number; h: number }> = {
  desk: { x: 2, zBack: -1.5, zFront: 1.5, out: 1, r: 1.5, h: 6 },
  room: { x: 4, zBack: -3, zFront: 5, out: 4, r: 4, h: 20 },
  warehouse: { x: 8, zBack: -4, zFront: 12, out: 16, r: 12, h: 60 },
  arena: { x: 16, zBack: -8, zFront: 24, out: 48, r: 40, h: 200 },
};

export function studioCove(preset: string): Cove | null {
  const p = PRESETS[preset];
  if (!p) return null;
  const xw = p.x + p.out, zb = p.zBack - p.out, zf = p.zFront + p.out * 2;
  const c = p.out; // corner sweep radius on the floor plan
  return {
    radius: p.r, height: p.h, corner: c,
    walls: [
      { a: [-xw, 0, zf], b: [-xw, 0, zb + c], n: [1, 0, 0] },
      { a: [-xw + c, 0, zb], b: [xw - c, 0, zb], n: [0, 0, 1] },
      { a: [xw, 0, zb + c], b: [xw, 0, zf], n: [-1, 0, 0] },
    ],
  };
}

/** Cove profile offsets (inward n, up y) for arc steps 0..k: floor tangent → vertical at height r. */
export function coveProfile(r: number, steps: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    out.push([r * (1 - dsin(a)), r * (1 - dcos(a))]);
  }
  return out;
}
