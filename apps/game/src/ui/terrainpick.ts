// Ray vs the Backlot heightfield (S3 TerrainRecord): the cursor's ground point for sculpting (ui/hud.ts) and for
// placing parts on the lot (main.ts pick()). Marches with a step that grows with distance, then bisects.

import { terrainHeightAt, type TerrainRecord } from '@knockon/format';

type V3 = readonly [number, number, number];

/** First point where the ray (origin `o`, direction `d`, any length) meets the terrain, or null. */
export function terrainHit(t: TerrainRecord, o: V3, d: V3, maxDist = 4000): [number, number, number] | null {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const dir: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const at = (s: number): V3 => [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s];
  const below = (s: number): boolean => { const p = at(s); return p[1] <= terrainHeightAt(t, p[0], p[2]); };
  if (below(0)) return null; // the eye is under the lot
  let prev = 0, step = 0.25;
  for (let s = step; s < maxDist; s += step) {
    if (below(s)) {
      let lo = prev, hi = s;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (below(m)) hi = m; else lo = m; }
      const p = at(hi);
      return [p[0], terrainHeightAt(t, p[0], p[2]), p[2]];
    }
    prev = s;
    step = Math.min(4, 0.25 + s * 0.01);
  }
  return null;
}
