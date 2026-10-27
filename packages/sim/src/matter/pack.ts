// Flat i32 encodings of Matter step inputs and outputs: the browser link (sim worker ↔ GPU host) moves them through
// transferable buffers and a SharedArrayBuffer, and checkpoints keep pending results in the MATR envelope.
// X5 (M5): per-kind counts and absorbed counts carry 4 kinds (goo), and commands carry the world's gravity and its
// gravity zones (D104); both ends are the same build, so the layout has no version word.

import {
  SURFACE_EMPTY, type MatterEmit, type MatterIntake, type MatterBlast, type MatterKind, type MatterProxy, type MatterQuery, type MatterStepIn,
  type MatterStepOut, type MatterSurface, type MatterZone,
} from './contract.ts';

const P = 19; // proxy fields on the wire (no body-local centre)
/** Kinds per counts / absorbed record (sand, water, marble, goo). */
const K = 4;
/** Zone fields on the wire: shape, centre xyz, size xyz, gravity. */
const Z = 8;

/** MatterStepOut → Int32Array. */
export function packOut(o: MatterStepOut): Int32Array {
  const nn = o.near?.length ?? 0;
  // the surface map goes sparse (non-empty cells only: index, count, top, bottom, vel xyz)
  const sf = o.surface;
  let ns = 0;
  if (sf) for (let c = 0; c < sf.count.length; c++) if (sf.count[c]! > 0) ns++;
  const n = 2 + o.impulses.length * 7 + 1 + o.absorbed.length * (1 + K) + K + 2 + 1 + 6 + 1 + nn * 5 + (sf ? 6 + ns * 7 : 0);
  const a = new Int32Array(n);
  let k = 0;
  a[k++] = o.tick;
  a[k++] = o.impulses.length;
  for (const im of o.impulses) {
    a[k++] = im.id;
    a[k++] = im.lin[0]!; a[k++] = im.lin[1]!; a[k++] = im.lin[2]!;
    a[k++] = im.ang[0]!; a[k++] = im.ang[1]!; a[k++] = im.ang[2]!;
  }
  a[k++] = o.absorbed.length;
  for (const ab of o.absorbed) { a[k++] = ab.id; for (let j = 0; j < K; j++) a[k++] = ab.counts[j] ?? 0; }
  for (let j = 0; j < K; j++) a[k++] = o.counts[j] ?? 0;
  a[k++] = o.checksum[0] | 0; a[k++] = o.checksum[1] | 0;
  a[k++] = o.bounds ? 1 : 0;
  for (let j = 0; j < 6; j++) a[k++] = o.bounds ? o.bounds[j]! : 0;
  a[k++] = nn;
  for (const q of o.near ?? []) { a[k++] = q.id; a[k++] = q.count; a[k++] = q.centroid[0]!; a[k++] = q.centroid[1]!; a[k++] = q.centroid[2]!; }
  if (sf) {
    a[k++] = sf.x0; a[k++] = sf.z0; a[k++] = sf.cell; a[k++] = sf.nx; a[k++] = sf.nz; a[k++] = ns;
    for (let c = 0; c < sf.count.length; c++) {
      if (!(sf.count[c]! > 0)) continue;
      a[k++] = c; a[k++] = sf.count[c]!; a[k++] = sf.top[c]!; a[k++] = sf.bottom[c]!;
      a[k++] = sf.vel[c * 3]!; a[k++] = sf.vel[c * 3 + 1]!; a[k++] = sf.vel[c * 3 + 2]!;
    }
  }
  return a;
}

/** Int32Array → MatterStepOut (views into `a`). */
export function unpackOut(a: Int32Array): MatterStepOut {
  let k = 0;
  const tick = a[k++]!;
  const ni = a[k++]!;
  const impulses: MatterStepOut['impulses'] = [];
  for (let i = 0; i < ni; i++) { impulses.push({ id: a[k]!, lin: a.subarray(k + 1, k + 4), ang: a.subarray(k + 4, k + 7) }); k += 7; }
  const na = a[k++]!;
  const absorbed: MatterStepOut['absorbed'] = [];
  for (let i = 0; i < na; i++) { absorbed.push({ id: a[k]!, counts: a.subarray(k + 1, k + 1 + K) }); k += 1 + K; }
  const counts = a.subarray(k, k + K); k += K;
  const checksum: [number, number] = [a[k]! >>> 0, a[k + 1]! >>> 0]; k += 2;
  const hasB = a[k++] === 1;
  const out: MatterStepOut = { tick, impulses, absorbed, counts, checksum };
  if (hasB) out.bounds = a.subarray(k, k + 6);
  k += 6;
  const nn = k < a.length ? a[k++]! : 0;
  if (nn > 0) {
    out.near = [];
    for (let i = 0; i < nn; i++) { out.near.push({ id: a[k]!, count: a[k + 1]!, centroid: a.subarray(k + 2, k + 5) }); k += 5; }
  }
  if (k + 6 <= a.length) {
    const nx = a[k + 3]!, nz = a[k + 4]!, ns = a[k + 5]!, nc = nx * nz;
    const sf: MatterSurface = {
      x0: a[k]!, z0: a[k + 1]!, cell: a[k + 2]!, nx, nz,
      count: new Int32Array(nc), top: new Int32Array(nc).fill(SURFACE_EMPTY), bottom: new Int32Array(nc).fill(SURFACE_EMPTY), vel: new Int32Array(nc * 3),
    };
    k += 6;
    for (let i = 0; i < ns; i++, k += 7) {
      const c = a[k]!;
      sf.count[c] = a[k + 1]!; sf.top[c] = a[k + 2]!; sf.bottom[c] = a[k + 3]!;
      sf.vel[c * 3] = a[k + 4]!; sf.vel[c * 3 + 1] = a[k + 5]!; sf.vel[c * 3 + 2] = a[k + 6]!;
    }
    out.surface = sf;
  }
  return out;
}

/** MatterStepIn → Int32Array (one transferable buffer per command). */
export function packIn(s: MatterStepIn): Int32Array {
  const nq = s.queries?.length ?? 0;
  const nz = s.zones?.length ?? 0;
  const n = 1 + 1 + s.proxies.length * P + 1 + s.emits.length * 11 + 1 + s.intakes.length * 9 + 1 + s.blasts.length * 5 + 1 + nq * 6
    + 1 + (s.surface ? 5 : 0) + 2 + 1 + nz * Z;
  const a = new Int32Array(n);
  let k = 0;
  a[k++] = s.tick;
  a[k++] = s.proxies.length;
  for (const p of s.proxies) {
    a[k++] = p.id; a[k++] = p.shape; a[k++] = p.dynamic ? 1 : 0;
    for (let j = 0; j < 3; j++) a[k++] = p.pos[j]!;
    for (let j = 0; j < 4; j++) a[k++] = p.rot[j]!;
    for (let j = 0; j < 3; j++) a[k++] = p.size[j]!;
    for (let j = 0; j < 3; j++) a[k++] = p.vel[j]!;
    for (let j = 0; j < 3; j++) a[k++] = p.ang[j]!;
  }
  a[k++] = s.emits.length;
  for (const e of s.emits) {
    a[k++] = e.seq; a[k++] = e.kind; a[k++] = e.count;
    for (let j = 0; j < 3; j++) a[k++] = e.pos[j]!;
    for (let j = 0; j < 3; j++) a[k++] = e.vel[j]!;
    a[k++] = e.spread; a[k++] = e.seed | 0;
  }
  a[k++] = s.intakes.length;
  for (const it of s.intakes) {
    a[k++] = it.id;
    for (let j = 0; j < 3; j++) a[k++] = it.min[j]!;
    for (let j = 0; j < 3; j++) a[k++] = it.max[j]!;
    a[k++] = it.kindMask; a[k++] = it.capacity;
  }
  a[k++] = s.blasts.length;
  for (const b of s.blasts) { for (let j = 0; j < 3; j++) a[k++] = b.center[j]!; a[k++] = b.radius; a[k++] = b.impulse; }
  a[k++] = nq;
  for (const q of s.queries ?? []) { a[k++] = q.id; for (let j = 0; j < 3; j++) a[k++] = q.center[j]!; a[k++] = q.radius; a[k++] = q.kindMask; }
  a[k++] = s.surface ? 1 : 0;
  if (s.surface) { a[k++] = s.surface.x0; a[k++] = s.surface.z0; a[k++] = s.surface.cell; a[k++] = s.surface.nx; a[k++] = s.surface.nz; }
  // D104 (X5): the world's gravity (flag, Q8) and its zones
  a[k++] = s.gravity !== undefined ? 1 : 0; a[k++] = s.gravity ?? 0;
  a[k++] = nz;
  for (const z of s.zones ?? []) {
    a[k++] = z.shape;
    for (let j = 0; j < 3; j++) a[k++] = z.center[j]!;
    for (let j = 0; j < 3; j++) a[k++] = z.size[j]!;
    a[k++] = z.gravity;
  }
  return a;
}

/** Int32Array → MatterStepIn (views into `a`). */
export function unpackIn(a: Int32Array): MatterStepIn {
  let k = 0;
  const tick = a[k++]!;
  const np = a[k++]!;
  const proxies: MatterProxy[] = [];
  for (let i = 0; i < np; i++) {
    proxies.push({
      id: a[k]!, shape: a[k + 1]! as 0 | 1 | 2 | 3, dynamic: a[k + 2] === 1, pos: a.subarray(k + 3, k + 6), rot: a.subarray(k + 6, k + 10),
      size: a.subarray(k + 10, k + 13), vel: a.subarray(k + 13, k + 16), ang: a.subarray(k + 16, k + 19),
    });
    k += P;
  }
  const ne = a[k++]!;
  const emits: MatterEmit[] = [];
  for (let i = 0; i < ne; i++) {
    emits.push({ seq: a[k]!, kind: a[k + 1]! as MatterKind, count: a[k + 2]!, pos: a.subarray(k + 3, k + 6), vel: a.subarray(k + 6, k + 9), spread: a[k + 9]!, seed: a[k + 10]! >>> 0 });
    k += 11;
  }
  const ni = a[k++]!;
  const intakes: MatterIntake[] = [];
  for (let i = 0; i < ni; i++) { intakes.push({ id: a[k]!, min: a.subarray(k + 1, k + 4), max: a.subarray(k + 4, k + 7), kindMask: a[k + 7]!, capacity: a[k + 8]! }); k += 9; }
  const nb = a[k++]!;
  const blasts: MatterBlast[] = [];
  for (let i = 0; i < nb; i++) { blasts.push({ center: a.subarray(k, k + 3), radius: a[k + 3]!, impulse: a[k + 4]! }); k += 5; }
  const nq = a[k++]!;
  const out: MatterStepIn = { tick, proxies, emits, intakes, blasts };
  if (nq) {
    const queries: MatterQuery[] = [];
    for (let i = 0; i < nq; i++) { queries.push({ id: a[k]!, center: a.subarray(k + 1, k + 4), radius: a[k + 4]!, kindMask: a[k + 5]! }); k += 6; }
    out.queries = queries;
  }
  if (a[k++] === 1) { out.surface = { x0: a[k]!, z0: a[k + 1]!, cell: a[k + 2]!, nx: a[k + 3]!, nz: a[k + 4]! }; k += 5; }
  if (a[k++] === 1) out.gravity = a[k]!;
  k++;
  const nz = a[k++]!;
  if (nz) {
    const zones: MatterZone[] = [];
    for (let i = 0; i < nz; i++, k += Z) zones.push({ shape: a[k]! as 0 | 1, center: a.subarray(k + 1, k + 4), size: a.subarray(k + 4, k + 7), gravity: a[k + 7]! });
    out.zones = zones;
  }
  return out;
}
