// Contact budget from the world (stream A3; S3's M3 finding 1, the late-poke rollback mismatch on big brick stacks).
//
// Jolt keeps a fixed buffer of contact constraints (PhysicsSettings mMaxContactConstraints). When a step needs more,
// it silently drops the rest, and *which* ones it drops depends on the order it finds body pairs in: broadphase
// tree layout, active-body list order and cache layout, none of which SaveState records. A rolled-back run then
// drops different contacts from the straight run and the two diverge. (Measured on S3's repro: 2,100 BRIKs in
// 3 layers need 17–21k contact constraints at once, because every brick of a face-to-face grid is within Jolt's
// 2 cm speculative distance of up to 26 neighbours; the old budget of 4 per part was 8,404.) So the budget must
// cover the demand. This estimates it from the start state, where everything is awake at once: pairs of parts
// whose bounds, grown by the speculative distance, overlap (with at least one of them dynamic), each weighted by
// how many collider pairs they can touch with (≤ 4), plus one ground contact per dynamic part.

import { boundsOf, partDef, propValues, type PartDef } from '@knockon/parts-data';
import { posToMetres, type PartRecord } from '@knockon/format';
import { rotationToQuat } from './rotation.ts';

/** Jolt's default speculative contact distance (PhysicsSettings), m. */
const SPECULATIVE = 0.02;
const CELL = 0.25;
/** Bounds spanning more cells than this (a long LEDGE, a big ZONE) are checked against every part instead. */
const MAX_CELLS = 512;
/** Cell coordinates are offset by 2^16 (±16 km at 0.25 m) and packed 17 bits each, exact in a double. */
const OFF = 1 << 16, B17 = 1 << 17;
const cellKey = (x: number, y: number, z: number): number => ((x + OFF) * B17 + (y + OFF)) * B17 + (z + OFF);
const cellOf = (k: number): [number, number, number] => {
  const z = k % B17, xy = (k - z) / B17, y = xy % B17;
  return [(xy - y) / B17 - OFF, y - OFF, z - OFF];
};

interface Bounds { readonly min: readonly number[]; readonly max: readonly number[] }

/**
 * Estimated contact constraints for a world's start state (Machine sizes Jolt's buffers ≥ 1.5× this). The sim worker
 * computes it once per start, for the heap size, and passes it on (MachineOptions.contactEstimate).
 *
 * SIMFIX (beta): typed arrays instead of an object per part, and a numeric open-addressing table of cells instead of
 * M5's 16 Maps of arrays (a Map caps at 2^24 entries, and its double keys were most of the time): a 1M-part world in
 * ≈ 1 s instead of ≈ 9.4 s (docs/dev/BETA_NOTES_SIMFIX.md). The pairs counted, and so the total, are unchanged: each
 * pair is still counted once, in the cell holding the larger of its two lower corners, and the total is a sum of small
 * integers, so the order the cells are visited in can't change it (packages/sim/test/capacity_big.test.ts pins it).
 */
export function contactEstimate(parts: readonly PartRecord[]): number {
  const N = parts.length;
  const lo = new Float64Array(3 * N), hi = new Float64Array(3 * N);
  const dyn = new Uint8Array(N), nn = new Uint8Array(N);
  // parts with default props share their def's collider count and bounds
  const plain = new Map<PartDef, { readonly shapes: number; readonly b: Bounds }>();
  let M = 0;
  for (const p of parts) {
    const def = partDef(p.type);
    if (!def) continue;
    let shapes: number, b: Bounds;
    const cached = p.props?.length ? undefined : plain.get(def);
    if (cached) ({ shapes, b } = cached);
    else {
      const props = propValues(def, p.props);
      shapes = def.critter ? 1 : def.shapes(props).length;
      b = boundsOf(def, props);
      if (!p.props?.length) plain.set(def, { shapes, b });
    }
    if (!shapes) continue; // no colliders (ZONE)
    const q = rotationToQuat(p.rot);
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const c0 = posToMetres(p.pos[0]), c1 = posToMetres(p.pos[1]), c2 = posToMetres(p.pos[2]);
    let l0 = Infinity, l1 = Infinity, l2 = Infinity, h0 = -Infinity, h1 = -Infinity, h2 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const vx = k & 1 ? b.max[0]! : b.min[0]!, vy = k & 2 ? b.max[1]! : b.min[1]!, vz = k & 4 ? b.max[2]! : b.min[2]!;
      // vec.ts qrot, operation for operation, so the bounds are bit-identical: t = 2 (u × v), then (v + t·w) + u × t
      const tx = (qy * vz - qz * vy) * 2, ty = (qz * vx - qx * vz) * 2, tz = (qx * vy - qy * vx) * 2;
      const wx = (vx + tx * qw) + (qy * tz - qz * ty), wy = (vy + ty * qw) + (qz * tx - qx * tz), wz = (vz + tz * qw) + (qx * ty - qy * tx);
      l0 = Math.min(l0, c0 + wx - SPECULATIVE); h0 = Math.max(h0, c0 + wx + SPECULATIVE);
      l1 = Math.min(l1, c1 + wy - SPECULATIVE); h1 = Math.max(h1, c1 + wy + SPECULATIVE);
      l2 = Math.min(l2, c2 + wz - SPECULATIVE); h2 = Math.max(h2, c2 + wz + SPECULATIVE);
    }
    lo[3 * M] = l0; lo[3 * M + 1] = l1; lo[3 * M + 2] = l2;
    hi[3 * M] = h0; hi[3 * M + 1] = h1; hi[3 * M + 2] = h2;
    dyn[M] = def.critter !== undefined || (def.body.kind === 'dynamic' && (p.flags & 32) === 0) ? 1 : 0;
    nn[M] = Math.min(4, shapes);
    M++;
  }
  let total = 0;
  for (let i = 0; i < M; i++) if (dyn[i]) total += nn[i]!; // the ground (floor, set or terrain)
  const overlap = (a: number, b: number): boolean =>
    lo[3 * a]! <= hi[3 * b]! && lo[3 * b]! <= hi[3 * a]! && lo[3 * a + 1]! <= hi[3 * b + 1]! && lo[3 * b + 1]! <= hi[3 * a + 1]!
    && lo[3 * a + 2]! <= hi[3 * b + 2]! && lo[3 * b + 2]! <= hi[3 * a + 2]!;
  const weight = (a: number, b: number): number => Math.min(4, nn[a]! * nn[b]!);
  const cell = (x: number): number => Math.floor(x / CELL);
  // a uniform grid: count the cell entries, then its cells in a numeric table
  const isBig = new Uint8Array(M);
  const big: number[] = [];
  let E = 0;
  for (let i = 0; i < M; i++) {
    const n = (cell(hi[3 * i]!) - cell(lo[3 * i]!) + 1) * (cell(hi[3 * i + 1]!) - cell(lo[3 * i + 1]!) + 1) * (cell(hi[3 * i + 2]!) - cell(lo[3 * i + 2]!) + 1);
    if (n > MAX_CELLS) { isBig[i] = 1; big.push(i); } else E += n;
  }
  // the table: cell key → slot (open addressing, Fibonacci hashing on the top bits), at most half full
  let bits = 4;
  while ((1 << bits) < 2 * E && bits < 30) bits++;
  const cap = 1 << bits, mask = cap - 1, shift = 32 - bits;
  const slotKey = new Float64Array(cap).fill(-1), slotN = new Int32Array(cap); // keys are ≥ 0: −1 = an empty slot
  const slotOf = (key: number): number => {
    const a = key % 4294967296, b2 = (key - a) / 4294967296;
    let h = Math.imul((a | 0) ^ Math.imul(b2 | 0, 0x85ebca6b), 0x9e3779b1) >>> shift;
    while (slotKey[h] !== key && slotKey[h] !== -1) h = (h + 1) & mask;
    return h;
  };
  // pass 1: each entry's slot and the count per slot; pass 2: entries grouped by slot (a counting sort, each cell's
  // entries in part order, as the Map version listed them)
  const entSlot = new Int32Array(E);
  let e = 0;
  for (let i = 0; i < M; i++) {
    if (isBig[i]) continue;
    const x0 = cell(lo[3 * i]!), x1 = cell(hi[3 * i]!), y0 = cell(lo[3 * i + 1]!), y1 = cell(hi[3 * i + 1]!), z0 = cell(lo[3 * i + 2]!), z1 = cell(hi[3 * i + 2]!);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const key = cellKey(x, y, z), s = slotOf(key);
      slotKey[s] = key;
      slotN[s]!++;
      entSlot[e++] = s;
    }
  }
  const start = new Int32Array(cap + 1);
  for (let s = 0; s < cap; s++) start[s + 1] = start[s]! + slotN[s]!;
  const fill = start.slice(0, cap), grouped = new Int32Array(E);
  e = 0;
  for (let i = 0; i < M; i++) {
    if (isBig[i]) continue;
    const n = (cell(hi[3 * i]!) - cell(lo[3 * i]!) + 1) * (cell(hi[3 * i + 1]!) - cell(lo[3 * i + 1]!) + 1) * (cell(hi[3 * i + 2]!) - cell(lo[3 * i + 2]!) + 1);
    for (let k = 0; k < n; k++) grouped[fill[entSlot[e++]!]!++] = i;
  }
  for (let s = 0; s < cap; s++) {
    const s0 = start[s]!, s1 = start[s + 1]!;
    if (s1 - s0 < 2) continue;
    const [cx, cy, cz] = cellOf(slotKey[s]!);
    for (let a = s0; a < s1; a++) {
      const A = grouped[a]!;
      for (let k = a + 1; k < s1; k++) {
        const B = grouped[k]!;
        if (!dyn[A] && !dyn[B]) continue;
        if (cell(Math.max(lo[3 * A]!, lo[3 * B]!)) !== cx || cell(Math.max(lo[3 * A + 1]!, lo[3 * B + 1]!)) !== cy || cell(Math.max(lo[3 * A + 2]!, lo[3 * B + 2]!)) !== cz) continue;
        if (overlap(A, B)) total += weight(A, B);
      }
    }
  }
  for (const i of big) {
    for (let j = 0; j < M; j++) if (j !== i && (dyn[i] || dyn[j]) && (!isBig[j] || j > i) && overlap(i, j)) total += weight(i, j);
  }
  return total;
}
