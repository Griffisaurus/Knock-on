// Backlot terrain (DATA_FORMATS §2.2 TERR, environments.md §4.2): a u16 heightfield on a 0.5 m grid over the
// preset's bounds, plus the deterministic sculpt strokes that edit it (DATA_FORMATS §3 TerrainStroke) and the
// default Backlot lot generator. Shared by docstore (strokes on both clients and the host), the sim (Jolt
// HeightFieldShape, sim/terrain.ts) and the renderer (gfx/terrain.ts). Integer and IEEE + − × ÷ only: every
// machine computes the same samples bit for bit.

import { ByteReader, ByteWriter, FormatError } from './bytes.ts';

/** Grid spacing (m): environments.md §4.2. */
export const TERRAIN_SPACING = 0.5;
/** Physics chunk: 64 × 64 quads (65 × 65 samples, edges shared), environments.md §0.6. */
export const TERRAIN_CHUNK = 64;

export interface TerrainRecord {
  /** Engine x, z (m) of sample (0, 0). */
  readonly origin: readonly [number, number];
  /** Samples along x and z (row-major, z rows of nx samples). */
  readonly nx: number;
  readonly nz: number;
  /** Height of u16 65535, metres (the bounds height): sample metres = h × maxHeight / 65535. */
  readonly maxHeight: number;
  readonly heights: Uint16Array;
  /** Which preset's lot this is ('arena' | 'megastructure'): a terrain only applies to its own preset. */
  readonly preset: string;
}

/** Sample → metres. */
export function terrainMetres(t: TerrainRecord, h: number): number {
  return (h * t.maxHeight) / 65535;
}

/** Metres → nearest sample value (clamped). */
export function terrainUnits(t: TerrainRecord, m: number): number {
  return Math.max(0, Math.min(65535, Math.round((m * 65535) / t.maxHeight)));
}

/** Height (m) at engine (x, z): bilinear between samples; 0 outside the field. */
export function terrainHeightAt(t: TerrainRecord, x: number, z: number): number {
  const fx = (x - t.origin[0]) / TERRAIN_SPACING, fz = (z - t.origin[1]) / TERRAIN_SPACING;
  if (fx < 0 || fz < 0 || fx > t.nx - 1 || fz > t.nz - 1) return 0;
  const ix = Math.min(t.nx - 2, Math.floor(fx)), iz = Math.min(t.nz - 2, Math.floor(fz));
  const ux = fx - ix, uz = fz - iz;
  const h = t.heights;
  const a = h[iz * t.nx + ix]!, b = h[iz * t.nx + ix + 1]!, c = h[(iz + 1) * t.nx + ix]!, d = h[(iz + 1) * t.nx + ix + 1]!;
  return terrainMetres(t, a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz);
}

// ---- TERR section ---------------------------------------------------------------------------------------
// [u8 version=1][varint presetLen][preset ascii][i32 originX ×640][i32 originZ ×640][varint nx][varint nz]
// [u32 maxHeight mm][heights: u16 per sample, each row delta-coded from its left neighbour (wrapping), LE]
// Row deltas keep the bytes small and very repetitive, so the container's deflate packs smooth lots tightly.

export function encodeTerrain(t: TerrainRecord): Uint8Array {
  const w = new ByteWriter(64 + t.heights.length * 2);
  w.u8(1).varint(t.preset.length).ascii(t.preset);
  w.i32(Math.round(t.origin[0] * 640)).i32(Math.round(t.origin[1] * 640)).varint(t.nx).varint(t.nz).u32(Math.round(t.maxHeight * 1000));
  const out = new Uint8Array(t.heights.length * 2);
  for (let z = 0; z < t.nz; z++) {
    let prev = 0;
    for (let x = 0; x < t.nx; x++) {
      const i = z * t.nx + x;
      const v = t.heights[i]!;
      const d = (v - prev) & 0xffff;
      out[i * 2] = d & 0xff;
      out[i * 2 + 1] = d >> 8;
      prev = v;
    }
  }
  w.bytes(out);
  return w.finish();
}

export function decodeTerrain(b: Uint8Array): TerrainRecord {
  const r = new ByteReader(b);
  if (r.u8() !== 1) throw new FormatError('TERR version');
  const pl = r.varint();
  if (pl > 32) throw new FormatError('TERR preset');
  const preset = r.ascii(pl);
  const ox = r.i32() / 640, oz = r.i32() / 640;
  const nx = r.varint(), nz = r.varint();
  if (nx < 2 || nz < 2 || nx > 8193 || nz > 8193) throw new FormatError('TERR size');
  const maxHeight = r.u32() / 1000;
  if (!(maxHeight > 0) || maxHeight > 10000) throw new FormatError('TERR maxHeight');
  if (r.remaining !== nx * nz * 2) throw new FormatError('TERR length');
  const raw = r.bytes(nx * nz * 2);
  const heights = new Uint16Array(nx * nz);
  for (let z = 0; z < nz; z++) {
    let prev = 0;
    for (let x = 0; x < nx; x++) {
      const i = z * nx + x;
      prev = (prev + (raw[i * 2]! | (raw[i * 2 + 1]! << 8))) & 0xffff;
      heights[i] = prev;
    }
  }
  return { origin: [ox, oz], nx, nz, maxHeight, heights, preset };
}

// ---- sculpt strokes (deterministic) ---------------------------------------------------------------------

export const TerrainBrush = { Raise: 0, Lower: 1, Flatten: 2, Smooth: 3 } as const;
export type TerrainBrush = (typeof TerrainBrush)[keyof typeof TerrainBrush];

/** One stroke: stamps at each point (engine pos units, 1/640 m; y is the flatten target), radius in pos units. */
export interface TerrainStroke {
  readonly brush: TerrainBrush;
  readonly radius: number;
  /** 1–1000 (‰ of the brush's full step per stamp). */
  readonly strength: number;
  readonly points: readonly (readonly [number, number, number])[];
}

/** A rectangle of samples (an undo record, or a stroke's footprint). */
export interface TerrainPatch {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly heights: Uint16Array;
}

/** Bedrock skin and the raise ceiling (environments.md §4.1): 0.5 m above the floor, 8 m under the bounds top. */
function limits(t: TerrainRecord): [number, number] {
  return [terrainUnits(t, 0.5), terrainUnits(t, t.maxHeight - 8)];
}

/** Sample rectangle a stroke can touch (clamped to the field), or null when it misses the field. */
export function strokeRect(t: TerrainRecord, s: TerrainStroke): { x0: number; z0: number; x1: number; z1: number } | null {
  const rs = s.radius / 640 / TERRAIN_SPACING;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of s.points) {
    const cx = (p[0] / 640 - t.origin[0]) / TERRAIN_SPACING, cz = (p[2] / 640 - t.origin[1]) / TERRAIN_SPACING;
    x0 = Math.min(x0, Math.floor(cx - rs) - 1); x1 = Math.max(x1, Math.ceil(cx + rs) + 1);
    z0 = Math.min(z0, Math.floor(cz - rs) - 1); z1 = Math.max(z1, Math.ceil(cz + rs) + 1);
  }
  x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(t.nx - 1, x1); z1 = Math.min(t.nz - 1, z1);
  return x0 > x1 || z0 > z1 ? null : { x0, z0, x1, z1 };
}

export function readPatch(t: TerrainRecord, x0: number, z0: number, w: number, h: number): TerrainPatch {
  const out = new Uint16Array(w * h);
  for (let z = 0; z < h; z++) out.set(t.heights.subarray((z0 + z) * t.nx + x0, (z0 + z) * t.nx + x0 + w), z * w);
  return { x0, z0, w, h, heights: out };
}

/** Writes a patch into `heights` (in place). Throws if it doesn't fit. */
export function writePatch(t: TerrainRecord, p: TerrainPatch): void {
  if (p.x0 < 0 || p.z0 < 0 || p.x0 + p.w > t.nx || p.z0 + p.h > t.nz || p.heights.length !== p.w * p.h) throw new FormatError('terrain patch out of range');
  for (let z = 0; z < p.h; z++) t.heights.set(p.heights.subarray(z * p.w, (z + 1) * p.w), (p.z0 + z) * t.nx + p.x0);
}

/**
 * Applies a stroke in place. Each stamp's falloff is (1 − d²/r²)² (polynomial, exact in IEEE doubles); raise
 * and lower move up to 0.25 m per stamp at full strength, flatten pulls toward the first point's height, smooth
 * pulls toward the 3 × 3 mean (read from the samples before this stamp). Returns the touched rectangle's old
 * samples (the undo patch), or null when the stroke misses the field.
 */
export function applyStroke(t: TerrainRecord, s: TerrainStroke): TerrainPatch | null {
  const rect = strokeRect(t, s);
  if (!rect) return null;
  const before = readPatch(t, rect.x0, rect.z0, rect.x1 - rect.x0 + 1, rect.z1 - rect.z0 + 1);
  const [lo, hi] = limits(t);
  const r = s.radius / 640;
  const r2 = r * r;
  const k = s.strength / 1000;
  const step = terrainUnits(t, 0.25);
  const target = s.points.length ? terrainUnits(t, s.points[0]![1] / 640) : 0;
  const H = t.heights, nx = t.nx;
  for (const p of s.points) {
    const px = p[0] / 640, pz = p[2] / 640;
    const sx0 = Math.max(rect.x0, Math.floor((px - r - t.origin[0]) / TERRAIN_SPACING));
    const sx1 = Math.min(rect.x1, Math.ceil((px + r - t.origin[0]) / TERRAIN_SPACING));
    const sz0 = Math.max(rect.z0, Math.floor((pz - r - t.origin[1]) / TERRAIN_SPACING));
    const sz1 = Math.min(rect.z1, Math.ceil((pz + r - t.origin[1]) / TERRAIN_SPACING));
    if (sx0 > sx1 || sz0 > sz1) continue;
    const src = s.brush === TerrainBrush.Smooth ? readPatch(t, sx0, sz0, sx1 - sx0 + 1, sz1 - sz0 + 1) : null;
    for (let z = sz0; z <= sz1; z++) {
      const dz = t.origin[1] + z * TERRAIN_SPACING - pz;
      for (let x = sx0; x <= sx1; x++) {
        const dx = t.origin[0] + x * TERRAIN_SPACING - px;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        const q = 1 - d2 / r2;
        const f = q * q * k;
        const i = z * nx + x;
        const cur = H[i]!;
        let next = cur;
        switch (s.brush) {
          case TerrainBrush.Raise: next = cur + Math.round(step * f); break;
          case TerrainBrush.Lower: next = cur - Math.round(step * f); break;
          case TerrainBrush.Flatten: next = cur + Math.round((target - cur) * f); break;
          case TerrainBrush.Smooth: {
            let sum = 0, n = 0;
            for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
              const xx = x + ox - sx0, zz = z + oz - sz0;
              if (xx < 0 || zz < 0 || xx >= src!.w || zz >= src!.h) continue;
              sum += src!.heights[zz * src!.w + xx]!; n++;
            }
            next = cur + Math.round((sum / n - cur) * f);
            break;
          }
        }
        H[i] = Math.max(lo, Math.min(hi, next));
      }
    }
  }
  return before;
}

// ---- the default Backlot lot (environments.md §4.1) ----------------------------------------------------------

/** Integer lattice hash → [0, 1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [−1, 1] at (x, z) / cell. */
function vnoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell, fz = z / cell;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ux = fx - ix, uz = fz - iz;
  const sx = ux * ux * (3 - 2 * ux), sz = uz * uz * (3 - 2 * uz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from (x, z) to segment a–b (sqrt is exact in IEEE). */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  const ex = ax + dx * t - x, ez = az + dz * t - z;
  return Math.sqrt(ex * ex + ez * ez);
}

const LOTS: Readonly<Record<string, { half: number; height: number; ground: number }>> = {
  arena: { half: 128, height: 64, ground: 4 },
  megastructure: { half: 512, height: 256, ground: 16 },
};

/** Does this preset have a Backlot lot? */
export function hasBacklot(preset: string): boolean { return preset in LOTS; }

const cache = new Map<string, TerrainRecord>();

/**
 * The default Backlot terrain for a preset (cached; treat as read-only, copy before sculpting): a flat
 * 64 × 64 m plateau at default ground around the neutral zones, ±3 m swells, the ridge behind the lot, and on
 * Megastructure the dry creek bed and the quarry pit. Engine coordinates (Blender y → engine −z).
 */
export function defaultTerrain(preset: string): TerrainRecord | null {
  const lot = LOTS[preset];
  if (!lot) return null;
  const hit = cache.get(preset);
  if (hit) return hit;
  const n = (lot.half * 2) / TERRAIN_SPACING + 1;
  const t: TerrainRecord = { origin: [-lot.half, -lot.half], nx: n, nz: n, maxHeight: lot.height, heights: new Uint16Array(n * n), preset };
  const [lo, hi] = limits(t);
  const mega = preset === 'megastructure';
  for (let iz = 0; iz < n; iz++) {
    const z = -lot.half + iz * TERRAIN_SPACING;
    for (let ix = 0; ix < n; ix++) {
      const x = -lot.half + ix * TERRAIN_SPACING;
      // plateau mask: 0 inside the central 64 m square, ramping to 1 over the next 24 m
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const out = smoothstep(32, 56, edge);
      let h = lot.ground;
      h += out * (3 * vnoise(x, z, 48, 11) + 1.2 * vnoise(x, z, 17, 23));
      // the 20 m ridge along the back (Blender y +110…+128 → engine z −110…−128), Arena and Mega alike
      h += 20 * smoothstep(-96, -122, z) * smoothstep(lot.half, lot.half - 8, Math.abs(x)) * (mega ? smoothstep(140, 120, Math.abs(x)) : 1);
      if (mega) {
        h += out * 6 * vnoise(x, z, 160, 37);
        // dry creek bed: (−512, +300) → (+512, −280) in set coords, 6 m deep, ~24 m wide
        const dc = Math.min(segDist(x, z, -512, -300, 0, -40), segDist(x, z, 0, -40, 512, 280));
        h -= 6 * smoothstep(14, 4, dc) * out;
        // quarry pit: centre (+260, +330) set → engine (260, −330), 120 m across, floor at 4 m
        const dq = Math.sqrt((x - 260) * (x - 260) + (z + 330) * (z + 330));
        h += (4 - h) * smoothstep(64, 52, dq);
      }
      t.heights[iz * n + ix] = Math.max(lo, Math.min(hi, terrainUnits(t, h)));
    }
  }
  flattenPads(t, mega);
  cache.set(preset, t);
  return t;
}

/**
 * Flat pads under the Backlot's big dressing (E3b, assets/build/env/backlot/backlot.json): the water tower, the four
 * light towers and the three trailers stand on level ground. Engine x/z rect (half extents) and, on the Arena lot,
 * the height E3b placed the piece at; Megastructure's lot is taller, so there the pad takes the mean ground under it.
 * A 2 m smoothstep blends each pad into the lot.
 */
const PADS: readonly { x: number; z: number; hx: number; hz: number; y: number }[] = [
  { x: 70, z: -82, hx: 8.5, hz: 8.5, y: 3.5004 }, // water tower
  { x: -96, z: 96, hx: 2.5, hz: 2.5, y: 6.5501 }, { x: -96, z: -96, hx: 2.5, hz: 2.5, y: 2.8568 }, // light towers
  { x: 96, z: 96, hx: 2.5, hz: 2.5, y: 6.0999 }, { x: 96, z: -96, hx: 2.5, hz: 2.5, y: 5.5246 },
  { x: -92, z: 60, hx: 1.8, hz: 5.5, y: 4.5676 }, { x: -92, z: 40, hx: 1.8, hz: 5.5, y: 3.6801 }, { x: -92, z: 20, hx: 1.8, hz: 5.5, y: 3.3626 }, // trailers
];
const PAD_BLEND = 2;

function flattenPads(t: TerrainRecord, mega: boolean): void {
  const [lo, hi] = limits(t);
  for (const p of PADS) {
    const x0 = Math.max(0, Math.floor((p.x - p.hx - PAD_BLEND - t.origin[0]) / TERRAIN_SPACING));
    const x1 = Math.min(t.nx - 1, Math.ceil((p.x + p.hx + PAD_BLEND - t.origin[0]) / TERRAIN_SPACING));
    const z0 = Math.max(0, Math.floor((p.z - p.hz - PAD_BLEND - t.origin[1]) / TERRAIN_SPACING));
    const z1 = Math.min(t.nz - 1, Math.ceil((p.z + p.hz + PAD_BLEND - t.origin[1]) / TERRAIN_SPACING));
    if (x0 > x1 || z0 > z1) continue;
    let target = p.y;
    if (mega) {
      let sum = 0, n = 0;
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const x = t.origin[0] + ix * TERRAIN_SPACING, z = t.origin[1] + iz * TERRAIN_SPACING;
        if (Math.abs(x - p.x) <= p.hx && Math.abs(z - p.z) <= p.hz) { sum += terrainMetres(t, t.heights[iz * t.nx + ix]!); n++; }
      }
      target = n ? sum / n : p.y;
    }
    const pu = terrainUnits(t, target);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = t.origin[0] + ix * TERRAIN_SPACING, z = t.origin[1] + iz * TERRAIN_SPACING;
      const dx = Math.max(0, Math.abs(x - p.x) - p.hx), dz = Math.max(0, Math.abs(z - p.z) - p.hz);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= PAD_BLEND) continue;
      const w = 1 - smoothstep(0, PAD_BLEND, d);
      const i = iz * t.nx + ix;
      t.heights[i] = Math.max(lo, Math.min(hi, Math.round(t.heights[i]! + (pu - t.heights[i]!) * w)));
    }
  }
}

/** A writable copy (strokes edit in place). */
export function cloneTerrain(t: TerrainRecord): TerrainRecord {
  return { ...t, origin: [t.origin[0], t.origin[1]], heights: t.heights.slice() };
}

/** Wire form of a patch: [x0, z0, w, h, bytes LE]. */
export function patchToWire(p: TerrainPatch): unknown[] {
  return [p.x0, p.z0, p.w, p.h, new Uint8Array(p.heights.buffer.slice(p.heights.byteOffset, p.heights.byteOffset + p.heights.byteLength))];
}

export function patchFromWire(a: unknown[]): TerrainPatch {
  const [x0, z0, w, h, b] = a;
  const ok = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
  if (!ok(x0, 8192) || !ok(z0, 8192) || !ok(w, 8193) || !ok(h, 8193) || !(b instanceof Uint8Array) || b.length !== w * h * 2) throw new FormatError('terrain patch');
  const heights = new Uint16Array(w * h);
  for (let i = 0; i < heights.length; i++) heights[i] = b[i * 2]! | (b[i * 2 + 1]! << 8);
  return { x0, z0, w, h, heights };
}
