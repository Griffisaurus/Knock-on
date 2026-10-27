// Host-side tick preparation shared by the CPU and GPU backends: proxy poses per substep, the coarse proxy grid,
// emitted particles, intakes and blasts, all packed into integer arrays. Both backends consume the same TickPack, so
// their inputs are identical by construction; the solvers that consume it are independent implementations.

import {
  KIND_COUNT, MAX_QUERIES, MAX_SURFACE_CELLS, SURFACE_CELL_MAX, SURFACE_CELL_MIN, SURFACE_EMPTY, type MatterStepIn, type MatterSurface,
} from './backend.ts';
import {
  EMIT_JITTER, EMIT_SPACING, GOO_BAND, GRAVITY_Q8, GRAVITY_Q8_MAX, MAX_INTAKES, MAX_PROXIES, MAX_ZONES, PBUCKETS, PCELL_SHIFT, PMAX_CELLS,
  PROXY_STRIDE, RADIUS, SUBSTEPS, ZONE_SIZE_MAX, ZONE_STRIDE,
} from './constants.ts';
import { clampI, fmix32, idiv, isqrt } from './imath.ts';

export interface TickPack {
  tick: number;
  nProxies: number;
  /** nProxies × SUBSTEPS × PROXY_STRIDE (record layout in wgsl.ts / P_* below). */
  proxies: Int32Array;
  /** PBUCKETS + 1 list starts, then the lists (proxy indices, ascending within a list). */
  plist: Uint32Array;
  /** Dynamic proxies in slot order: the ids and their count. */
  dynIds: number[];
  nEmit: number;
  /** nEmit × 7: x, y, z, vx, vy, vz (units per substep), mat. In emit (seq) order. */
  emit: Int32Array;
  nIntakes: number;
  intakeIds: number[];
  /** nIntakes × 8: min xyz, max xyz, kindMask, capacity. */
  intakes: Int32Array;
  nBlasts: number;
  /** nBlasts × 8: center xyz, radius, impulse (units per substep), 0, 0, 0. */
  blasts: Int32Array;
  /** Grain queries (null when the input had none): nQueries × 8: center xyz, radius, kindMask, 0, 0, 0. */
  nQueries: number;
  queryIds: number[] | null;
  queries: Int32Array;
  /** Water-surface request (null when absent): x0, z0, cell, nx, nz (validated). */
  surface: Int32Array | null;
  /** D104: the world's gravity for each substep of this tick (units per substep², gravitySteps). */
  grav: Int32Array;
  /** D104: gravity zones, nZones × ZONE_STRIDE: shape, centre xyz, size xyz, 0, gravity per substep (SUBSTEPS words). */
  nZones: number;
  zones: Int32Array;
}

/**
 * D104: whole units of gravity for each substep of Matter tick `tick` at `g8` (Q8 units/substep²): the Bresenham split
 * of g8 / 256 over the global substep index S = tick × SUBSTEPS + s, so the running sum is exactly floor(g8 × S / 256)
 * and Earth (GRAVITY_Q8 = 11 × 256) is 11 every substep, the M4 constant. Only S mod 256 matters, so it never overflows.
 */
export function gravitySteps(g8: number, tick: number): Int32Array {
  const G = clampI(g8 | 0, 0, GRAVITY_Q8_MAX);
  const out = new Int32Array(SUBSTEPS);
  const t = ((tick % 256) + 256) % 256;
  for (let s = 0; s < SUBSTEPS; s++) {
    const S = (t * SUBSTEPS + s) & 255;
    out[s] = ((((G & 255) * S) & 255) + G) >> 8;
  }
  return out;
}

/** Words per surface cell in the raw accumulator both backends fill (see surfaceResult). */
export const SURF_WORDS = 9;

// Proxy record fields (i32 offsets inside one PROXY_STRIDE record).
export const P_SHAPE = 0;
export const P_SLOT = 1; // dynamic slot, or −1 for static
export const P_RAD = 2; // sphere / capsule radius
export const P_C = 4; // centre at the end of the substep
export const P_R = 7; // rotation matrix, row-major, Q14 (world = c + R · local)
export const P_E = 16; // half extents (obb), (0, halfLength, 0) for capsules
export const P_V = 19; // linear velocity, units per substep
export const P_W = 22; // angular velocity, rad per substep × 65,536
export const P_MIN = 25; // AABB min (padded by the largest particle radius)
export const P_MAX = 28; // AABB max

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
/** Proxy AABB padding: the largest particle radius plus goo's adhesion band (goo sticks within GOO_BAND of a surface). */
const RMAX = Math.max(...RADIUS) + GOO_BAND;

/**
 * D104: the gravity (units this substep) of a particle at substep-start position (x, y, z), sub = substep: the first
 * zone that holds it, else the world's. Zones: cylinder (shape 0: |dy| ≤ halfHeight, |dx|, |dz| ≤ r and
 * (dx >> 8)² + (dz >> 8)² ≤ (r >> 8)²) or box (shape 1: |d| ≤ half extents per axis). The WGSL `gravityAt` twin.
 */
export function gravityAt(pk: TickPack, sub: number, x: number, y: number, z: number): number {
  const zs = pk.zones;
  for (let k = 0; k < pk.nZones; k++) {
    const o = k * ZONE_STRIDE;
    const dx = (x - zs[o + 1]!) | 0, dy = (y - zs[o + 2]!) | 0, dz = (z - zs[o + 3]!) | 0;
    const sx = zs[o + 4]!, sy = zs[o + 5]!, sz = zs[o + 6]!;
    if (dy > sy || dy < -sy) continue;
    if (zs[o] === 1) {
      if (dx > sx || dx < -sx || dz > sz || dz < -sz) continue;
    } else {
      if (dx > sx || dx < -sx || dz > sx || dz < -sx) continue;
      const ax = dx >> 8, az = dz >> 8, r = sx >> 8;
      if (ax * ax + az * az > r * r) continue;
    }
    return zs[o + 8 + sub]!;
  }
  return pk.grav[sub]!;
}

/** Coarse proxy-grid bucket of a position (the WGSL `pbucket`). */
export function pbucket(x: number, y: number, z: number): number {
  const cx = x >> PCELL_SHIFT, cy = y >> PCELL_SHIFT, cz = z >> PCELL_SHIFT;
  return fmix32((Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca77) ^ Math.imul(cz, 0xc2b2ae3d)) >>> 0) & (PBUCKETS - 1);
}

/** Normalise a Q14 quaternion in place (integer). */
export function normQ(q: Int32Array): void {
  const n = isqrt(q[0]! * q[0]! + q[1]! * q[1]! + q[2]! * q[2]! + q[3]! * q[3]!);
  if (n === 0) { q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 16384; return; }
  for (let k = 0; k < 4; k++) q[k] = idiv(q[k]! * 16384, n);
}

/** q ← dq ⊗ q with dq = (h, 16384), h = half the rotation vector in Q14; then normalised. */
export function integrateQ(q: Int32Array, hx: number, hy: number, hz: number): void {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const W = 16384;
  q[3] = (W * w - hx * x - hy * y - hz * z) >> 14;
  q[0] = (W * x + hx * w + hy * z - hz * y) >> 14;
  q[1] = (W * y - hx * z + hy * w + hz * x) >> 14;
  q[2] = (W * z + hx * y - hy * x + hz * w) >> 14;
  normQ(q);
}

/** Q14 rotation matrix (row-major) of a Q14 quaternion, written at rec[o..o+9]. */
export function writeMatrix(rec: Int32Array, o: number, q: Int32Array): void {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, xw = x * w, yw = y * w, zw = z * w;
  rec[o] = 16384 - ((yy + zz) >> 13); rec[o + 1] = (xy - zw) >> 13; rec[o + 2] = (xz + yw) >> 13;
  rec[o + 3] = (xy + zw) >> 13; rec[o + 4] = 16384 - ((xx + zz) >> 13); rec[o + 5] = (yz - xw) >> 13;
  rec[o + 6] = (xz - yw) >> 13; rec[o + 7] = (yz + xw) >> 13; rec[o + 8] = 16384 - ((xx + yy) >> 13);
}

const sat = (v: number): number => (v < I32_MIN ? I32_MIN : v > I32_MAX ? I32_MAX : v);

/** Pack one Matter tick's inputs. Throws on inputs the solver can't take (too many proxies or intakes). */
export function prepareTick(input: MatterStepIn): TickPack {
  const np = input.proxies.length;
  if (np > MAX_PROXIES) throw new Error(`matter: ${np} proxies (max ${MAX_PROXIES})`);
  if (input.intakes.length > MAX_INTAKES) throw new Error(`matter: ${input.intakes.length} intakes (max ${MAX_INTAKES})`);
  const proxies = new Int32Array(np * SUBSTEPS * PROXY_STRIDE);
  const dynIds: number[] = [];
  const q = new Int32Array(4);
  // Union AABB over the tick (for the coarse grid), per proxy: min xyz, max xyz.
  const box = new Float64Array(np * 6);
  const global = new Uint8Array(np);
  for (let p = 0; p < np; p++) {
    const px = input.proxies[p]!;
    const slot = px.dynamic ? dynIds.length : -1;
    if (px.dynamic) dynIds.push(px.id);
    q[0] = px.rot[0]! | 0; q[1] = px.rot[1]! | 0; q[2] = px.rot[2]! | 0; q[3] = px.rot[3]! | 0;
    normQ(q);
    const vs = [idiv(px.vel[0]! | 0, SUBSTEPS), idiv(px.vel[1]! | 0, SUBSTEPS), idiv(px.vel[2]! | 0, SUBSTEPS)];
    const ws = [idiv(px.ang[0]! | 0, SUBSTEPS), idiv(px.ang[1]! | 0, SUBSTEPS), idiv(px.ang[2]! | 0, SUBSTEPS)];
    const r = px.shape === 0 || px.shape === 1 ? Math.max(0, px.size[0]! | 0) : 0;
    const e = px.shape === 2 ? [Math.max(0, px.size[0]! | 0), Math.max(0, px.size[1]! | 0), Math.max(0, px.size[2]! | 0)]
      : px.shape === 1 ? [0, Math.max(0, px.size[1]! | 0), 0] : [0, 0, 0];
    for (let k = 0; k < 6; k++) box[p * 6 + k] = k < 3 ? Infinity : -Infinity;
    for (let s = 0; s < SUBSTEPS; s++) {
      integrateQ(q, idiv(ws[0]!, 8), idiv(ws[1]!, 8), idiv(ws[2]!, 8));
      const o = (p * SUBSTEPS + s) * PROXY_STRIDE;
      proxies[o + P_SHAPE] = px.shape;
      proxies[o + P_SLOT] = slot;
      proxies[o + P_RAD] = r;
      for (let a = 0; a < 3; a++) {
        proxies[o + P_C + a] = (px.pos[a]! + idiv((px.vel[a]! | 0) * (s + 1), SUBSTEPS)) | 0;
        proxies[o + P_E + a] = e[a]!;
        proxies[o + P_V + a] = vs[a]!;
        proxies[o + P_W + a] = ws[a]!;
      }
      writeMatrix(proxies, o + P_R, q);
      if (px.shape === 3) {
        for (let a = 0; a < 3; a++) { proxies[o + P_MIN + a] = I32_MIN; proxies[o + P_MAX + a] = I32_MAX; }
        global[p] = 1;
        continue;
      }
      for (let a = 0; a < 3; a++) {
        // Half-size of the rotated shape along world axis a (exact doubles, floor), plus radius and padding.
        let h = r + RMAX;
        for (let b = 0; b < 3; b++) h += Math.floor((Math.abs(proxies[o + P_R + a * 3 + b]!) * e[b]!) / 16384) + (e[b]! > 0 ? 1 : 0);
        const c = proxies[o + P_C + a]!;
        const lo = sat(c - h), hi = sat(c + h);
        proxies[o + P_MIN + a] = lo;
        proxies[o + P_MAX + a] = hi;
        if (lo < box[p * 6 + a]!) box[p * 6 + a] = lo;
        if (hi > box[p * 6 + 3 + a]!) box[p * 6 + 3 + a] = hi;
      }
    }
    if (!global[p]) {
      let cells = 1;
      for (let a = 0; a < 3; a++) cells *= ((box[p * 6 + 3 + a]! >> PCELL_SHIFT) - (box[p * 6 + a]! >> PCELL_SHIFT) + 1);
      if (cells > PMAX_CELLS) global[p] = 1;
    }
  }
  // Coarse grid: two passes (count, fill). Lists stay ascending because proxies are visited in index order, and a
  // proxy that reaches a bucket through two cells is written once (the last-entry check).
  const counts = new Uint32Array(PBUCKETS);
  const last = new Int32Array(PBUCKETS).fill(-1);
  const forCells = (p: number, fn: (b: number) => void): void => {
    if (global[p]) { for (let b = 0; b < PBUCKETS; b++) fn(b); return; }
    const x0 = box[p * 6]! >> PCELL_SHIFT, y0 = box[p * 6 + 1]! >> PCELL_SHIFT, z0 = box[p * 6 + 2]! >> PCELL_SHIFT;
    const x1 = box[p * 6 + 3]! >> PCELL_SHIFT, y1 = box[p * 6 + 4]! >> PCELL_SHIFT, z1 = box[p * 6 + 5]! >> PCELL_SHIFT;
    for (let cz = z0; cz <= z1; cz++) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      fn(pbucket(cx << PCELL_SHIFT, cy << PCELL_SHIFT, cz << PCELL_SHIFT));
    }
  };
  for (let p = 0; p < np; p++) forCells(p, (b) => { if (last[b] !== p) { last[b] = p; counts[b]!++; } });
  let total = 0;
  const plistHead = new Uint32Array(PBUCKETS + 1);
  for (let b = 0; b < PBUCKETS; b++) { plistHead[b] = PBUCKETS + 1 + total; total += counts[b]!; }
  plistHead[PBUCKETS] = PBUCKETS + 1 + total;
  const plist = new Uint32Array(PBUCKETS + 1 + total);
  plist.set(plistHead);
  const fill = new Uint32Array(PBUCKETS);
  last.fill(-1);
  for (let p = 0; p < np; p++) forCells(p, (b) => { if (last[b] !== p) { last[b] = p; plist[plistHead[b]! + fill[b]!++] = p; } });

  // Emits, in seq order (stable for equal seq).
  const order = input.emits.map((e, i) => i).sort((a, b) => (input.emits[a]!.seq - input.emits[b]!.seq) || (a - b));
  let nEmit = 0;
  for (const i of order) nEmit += Math.max(0, input.emits[i]!.count | 0);
  const emit = new Int32Array(nEmit * 7);
  let w = 0;
  for (const i of order) {
    const em = input.emits[i]!;
    const count = Math.max(0, em.count | 0);
    if (!count) continue;
    const kind = em.kind;
    if (kind < 0 || kind >= KIND_COUNT) throw new Error(`matter: emit kind ${kind}`);
    let L = 1;
    while (L * L * L < count) L++;
    const S = EMIT_SPACING[kind]!, J = EMIT_JITTER[kind]!;
    const half = ((L - 1) * S) >> 1;
    const spread = clampI(em.spread | 0, 0, 1 << 16);
    const h0 = fmix32((em.seed ^ fmix32((em.seq ^ 0x5bd1e995) >>> 0)) >>> 0);
    for (let k = 0; k < count; k++) {
      const ix = k % L, iz = ((k / L) | 0) % L, iy = (k / (L * L)) | 0;
      const hk = fmix32((h0 + Math.imul(k, 0x9e3779b1)) >>> 0);
      const jit = (a: number, amp: number): number => (amp > 0 ? (fmix32((hk + a) >>> 0) % (2 * amp + 1)) - amp : 0);
      const o = w * 7;
      emit[o] = (em.pos[0]! + ix * S - half + jit(0, J)) | 0;
      emit[o + 1] = (em.pos[1]! + iy * S - half + jit(1, J)) | 0;
      emit[o + 2] = (em.pos[2]! + iz * S - half + jit(2, J)) | 0;
      emit[o + 3] = idiv((em.vel[0]! | 0) + jit(3, spread), SUBSTEPS);
      emit[o + 4] = idiv((em.vel[1]! | 0) + jit(4, spread), SUBSTEPS);
      emit[o + 5] = idiv((em.vel[2]! | 0) + jit(5, spread), SUBSTEPS);
      emit[o + 6] = kind;
      w++;
    }
  }

  const ni = input.intakes.length;
  const intakes = new Int32Array(ni * 8);
  const intakeIds: number[] = [];
  for (let t = 0; t < ni; t++) {
    const it = input.intakes[t]!;
    intakeIds.push(it.id);
    for (let a = 0; a < 3; a++) { intakes[t * 8 + a] = it.min[a]! | 0; intakes[t * 8 + 3 + a] = it.max[a]! | 0; }
    intakes[t * 8 + 6] = it.kindMask & ((1 << KIND_COUNT) - 1);
    intakes[t * 8 + 7] = clampI(it.capacity | 0, 0, 1 << 30);
  }
  const nb = input.blasts.length;
  const blasts = new Int32Array(nb * 8);
  for (let b = 0; b < nb; b++) {
    const bl = input.blasts[b]!;
    for (let a = 0; a < 3; a++) blasts[b * 8 + a] = bl.center[a]! | 0;
    blasts[b * 8 + 3] = clampI(bl.radius | 0, 0, 1 << 19);
    blasts[b * 8 + 4] = idiv(clampI(bl.impulse | 0, -(1 << 17), 1 << 17), SUBSTEPS);
  }
  const qs = input.queries;
  if (qs && qs.length > MAX_QUERIES) throw new Error(`matter: ${qs.length} queries (max ${MAX_QUERIES})`);
  const nq = qs ? qs.length : 0;
  const queries = new Int32Array(nq * 8);
  for (let k = 0; k < nq; k++) {
    const qq = qs![k]!;
    for (let a = 0; a < 3; a++) queries[k * 8 + a] = qq.center[a]! | 0;
    queries[k * 8 + 3] = clampI(qq.radius | 0, 0, 1 << 20);
    queries[k * 8 + 4] = qq.kindMask & ((1 << KIND_COUNT) - 1);
  }
  let surface: Int32Array | null = null;
  const sr = input.surface;
  if (sr) {
    const cell = sr.cell | 0, nx = sr.nx | 0, nz = sr.nz | 0;
    if (cell < SURFACE_CELL_MIN || cell > SURFACE_CELL_MAX || nx < 1 || nz < 1 || nx * nz > MAX_SURFACE_CELLS) {
      throw new Error(`matter: surface map ${nx} × ${nz} cells of ${cell} units is out of range`);
    }
    surface = Int32Array.of(sr.x0 | 0, sr.z0 | 0, cell, nx, nz);
  }
  // D104: world gravity and gravity zones, as whole units per substep
  const grav = gravitySteps(input.gravity ?? GRAVITY_Q8, input.tick);
  const zs = input.zones ?? [];
  if (zs.length > MAX_ZONES) throw new Error(`matter: ${zs.length} gravity zones (max ${MAX_ZONES})`);
  const zones = new Int32Array(zs.length * ZONE_STRIDE);
  zs.forEach((z, k) => {
    const o = k * ZONE_STRIDE;
    if (z.shape !== 0 && z.shape !== 1) throw new Error(`matter: zone shape ${z.shape}`);
    zones[o] = z.shape;
    for (let a = 0; a < 3; a++) {
      zones[o + 1 + a] = z.center[a]! | 0;
      zones[o + 4 + a] = clampI(z.size[a]! | 0, 0, ZONE_SIZE_MAX);
    }
    zones.set(gravitySteps(z.gravity, input.tick), o + 8);
  });
  return {
    tick: input.tick, nProxies: np, proxies, plist, dynIds, nEmit, emit, nIntakes: ni, intakeIds, intakes, nBlasts: nb, blasts,
    nQueries: nq, queryIds: qs ? qs.map((q) => q.id) : null, queries, surface, grav, nZones: zs.length, zones,
  };
}

/**
 * Query result from count and the 64-bit position sums (lo u32, hi i32 per axis): centroid = sum / count truncated
 * toward zero (BigInt, so it is exact). Shared by both backends.
 */
export function nearResult(id: number, count: number, sums: readonly number[]): { id: number; count: number; centroid: Int32Array } {
  const c = new Int32Array(3);
  if (count > 0) {
    for (let a = 0; a < 3; a++) {
      const v = (BigInt(sums[a * 2 + 1]! | 0) << 32n) + BigInt(sums[a * 2]! >>> 0);
      c[a] = Number(v / BigInt(count));
    }
  }
  return { id, count, centroid: c };
}

/**
 * Surface cell of a water particle at (x, z), or −1 outside the map (sv = TickPack.surface). The offsets are taken in
 * 32-bit wrapping arithmetic like the WGSL (positions stay within ±KILL_XZ, so they never actually wrap).
 */
export function surfaceCell(sv: Int32Array, x: number, z: number): number {
  const dx = (x - sv[0]!) | 0, dz = (z - sv[1]!) | 0;
  if (dx < 0 || dz < 0) return -1;
  const ix = (dx / sv[2]!) | 0, iz = (dz / sv[2]!) | 0;
  return ix < sv[3]! && iz < sv[4]! ? iz * sv[3]! + ix : -1;
}

/**
 * The surface map from the raw per-cell accumulator both backends fill, SURF_WORDS u32 per cell: [0] max of
 * (y xor 2^31), [1] max of ~(y xor 2^31) (so the minimum y), [2] count, then the per-substep velocity sums x, y, z as
 * 64-bit (lo, hi) pairs. Shared by both backends, so the conversion can't differ.
 */
export function surfaceResult(sv: Int32Array, raw: Uint32Array): MatterSurface {
  const nc = sv[3]! * sv[4]!;
  const count = new Int32Array(nc), top = new Int32Array(nc).fill(SURFACE_EMPTY), bottom = new Int32Array(nc).fill(SURFACE_EMPTY);
  const vel = new Int32Array(nc * 3);
  for (let c = 0; c < nc; c++) {
    const o = c * SURF_WORDS, n = raw[o + 2]!;
    if (n === 0) continue;
    count[c] = n;
    top[c] = (raw[o]! ^ 0x80000000) | 0;
    bottom[c] = (~raw[o + 1]! ^ 0x80000000) | 0;
    for (let a = 0; a < 3; a++) {
      const v = (BigInt(raw[o + 4 + a * 2]! | 0) << 32n) + BigInt(raw[o + 3 + a * 2]! >>> 0);
      vel[c * 3 + a] = Number((v * BigInt(SUBSTEPS)) / BigInt(n));
    }
  }
  return { x0: sv[0]!, z0: sv[1]!, cell: sv[2]!, nx: sv[3]!, nz: sv[4]!, count, top, bottom, vel };
}
