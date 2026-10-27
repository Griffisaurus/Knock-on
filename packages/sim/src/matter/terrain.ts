// The Moon's regolith for Matter (X5, D104 follow-up): W5 builds the authored heightfield as Jolt HeightFieldShape chunks,
// which the Matter backend can't collide with (it takes spheres, capsules, boxes and planes). So each 0.5 m sample cell
// under the Matter-active region becomes one static oriented box: its top is the plane fitted to the cell's four corner
// heights (centre = their mean, slope = the mean of the two edge slopes per axis), 0.2 m thick, a little wider than the
// cell so neighbours overlap instead of leaving cracks. Cells under the concrete apron (Jolt's holes) are skipped: the
// apron's own boxes are already static proxies. Everything is computed from the u16 samples with + − × ÷ and sqrt only
// (all correctly rounded in IEEE doubles), then rounded to Matter units, so every client builds the same integers.
//
// Accuracy: a cell's corners need not be coplanar; the fitted plane is off by at most a quarter of the cell's twist
// (|h00 + h11 − h10 − h01| / 4), millimetres on the brief's undulation, more on crater rims. Grains settle on the tiles
// within that of the heightfield bodies settle on.

import { TERRAIN_SPACING } from '@knockon/format';
import type { SpaceTerrain } from '@knockon/parts-data';
import type { MatterProxy } from './contract.ts';
import { mToU, qToQ14 } from './units.ts';

/** Half thickness of a tile (m), and the overlap past the cell's edges (m). */
export const TILE_HALF = 0.1;
export const TILE_OVERLAP = 0.02;
/** Most tiles one command takes (the rest of the region's cells, in cell order, are left out). */
export const MAX_TILES = 2048;

export interface TerrainTiles {
  /** The heightfield the tiles come from. */
  readonly field: SpaceTerrain;
  /**
   * Tiles for the cells under `region` (metres: min xyz, max xyz) whose tops are within its height range (padded 0.5 m),
   * in cell order (row by row along +x, rows along +z), at most min(max, MAX_TILES); ids = idBase + cell index.
   */
  cover(region: ArrayLike<number>, max: number, idBase: number): MatterProxy[];
  /** The tile top's height (m) at (x, z) on cell (ix, iz)'s fitted plane (tests). */
  heightAt(x: number, z: number): number;
}

interface Tile { proxy: MatterProxy; top: number; bottom: number }

/** The Matter terrain of a Moon field. `holes`: the apron slabs' footprints (x0, z0, x1, z1), as envsets.ts builds them. */
export function moonTiles(field: SpaceTerrain, holes: readonly (readonly [number, number, number, number])[]): TerrainTiles {
  const s = TERRAIN_SPACING, scale = field.maxHeight / 65535;
  const { nx, nz, heights } = field;
  const ox = field.origin[0], oz = field.origin[1];
  const h = (ix: number, iz: number): number => heights[iz * nx + ix]! * scale;
  // Jolt's hole rule (envsets.ts buildSpaceTerrain): a sample is a hole when the four quads around it are under the apron
  const under = (x: number, z: number): boolean => holes.some((b) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
  const hole = (ix: number, iz: number): boolean => {
    const x = ox + ix * s, z = oz + iz * s;
    return under(x - s, z - s) && under(x + s, z - s) && under(x - s, z + s) && under(x + s, z + s);
  };
  const cache = new Map<number, Tile | null>();

  const plane = (ix: number, iz: number): [number, number, number] => {
    const h00 = h(ix, iz), h10 = h(ix + 1, iz), h01 = h(ix, iz + 1), h11 = h(ix + 1, iz + 1);
    return [(h00 + h10 + h01 + h11) / 4, (h10 + h11 - h00 - h01) / (2 * s), (h01 + h11 - h00 - h10) / (2 * s)];
  };

  const tile = (ix: number, iz: number, idBase: number): Tile | null => {
    const c = iz * (nx - 1) + ix;
    const hit = cache.get(c);
    if (hit !== undefined) return hit;
    let out: Tile | null = null;
    if (!(hole(ix, iz) && hole(ix + 1, iz) && hole(ix, iz + 1) && hole(ix + 1, iz + 1))) {
      const [hc, gx, gz] = plane(ix, iz);
      const L = Math.sqrt(gx * gx + 1 + gz * gz);
      const n = [-gx / L, 1 / L, -gz / L] as const;
      // the rotation taking +Y to n: (Y × n, 1 + Y·n), normalised
      const qn = Math.sqrt(n[2] * n[2] + n[0] * n[0] + (1 + n[1]) * (1 + n[1]));
      const q = [n[2] / qn, 0, -n[0] / qn, (1 + n[1]) / qn];
      const hx = (s / 2) * Math.sqrt(1 + gx * gx) + TILE_OVERLAP, hz = (s / 2) * Math.sqrt(1 + gz * gz) + TILE_OVERLAP;
      const cx = ox + (ix + 0.5) * s, cz = oz + (iz + 0.5) * s;
      const center = [cx - n[0] * TILE_HALF, hc - n[1] * TILE_HALF, cz - n[2] * TILE_HALF];
      const rise = (Math.abs(gx) + Math.abs(gz)) * (s / 2 + TILE_OVERLAP);
      out = {
        top: hc + rise, bottom: hc - rise - 2 * TILE_HALF,
        proxy: {
          id: idBase + c, shape: 2, dynamic: false,
          pos: Int32Array.of(mToU(center[0]!), mToU(center[1]!), mToU(center[2]!)),
          rot: Int32Array.of(qToQ14(q[0]!), qToQ14(q[1]!), qToQ14(q[2]!), qToQ14(q[3]!)),
          size: Int32Array.of(mToU(hx), mToU(TILE_HALF), mToU(hz)),
          vel: new Int32Array(3), ang: new Int32Array(3),
        },
      };
    }
    cache.set(c, out);
    return out;
  };

  return {
    field,
    cover(region, max, idBase) {
      const out: MatterProxy[] = [];
      const lim = Math.min(max, MAX_TILES);
      const ix0 = Math.max(0, Math.floor((region[0]! - ox) / s)), ix1 = Math.min(nx - 2, Math.floor((region[3]! - ox) / s));
      const iz0 = Math.max(0, Math.floor((region[2]! - oz) / s)), iz1 = Math.min(nz - 2, Math.floor((region[5]! - oz) / s));
      const y0 = region[1]! - 0.5, y1 = region[4]! + 0.5;
      for (let iz = iz0; iz <= iz1 && out.length < lim; iz++) {
        for (let ix = ix0; ix <= ix1 && out.length < lim; ix++) {
          const t = tile(ix, iz, idBase);
          if (t && t.top >= y0 && t.bottom <= y1) out.push(t.proxy);
        }
      }
      return out;
    },
    heightAt(x, z) {
      const ix = Math.max(0, Math.min(nx - 2, Math.floor((x - ox) / s))), iz = Math.max(0, Math.min(nz - 2, Math.floor((z - oz) / s)));
      const [hc, gx, gz] = plane(ix, iz);
      return hc + gx * (x - (ox + (ix + 0.5) * s)) + gz * (z - (oz + (iz + 0.5) * s));
    },
  };
}
