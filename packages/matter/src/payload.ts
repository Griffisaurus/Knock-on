// MATR payload encode/decode (layout in backend.ts). Shared by both backends so their snapshots are byte-identical.

import { MATR_HEADER_BYTES, MATR_MAGIC, MATR_VERSION } from './backend.ts';

export interface MatrState {
  tick: number;
  count: number;
  capacity: number;
  seed: number;
  pos: Int32Array; // count × 3
  vel: Int32Array; // count × 3
  mat: Uint32Array; // count
}

export function encodeMatr(s: MatrState): Uint8Array {
  const n = s.count;
  const out = new Uint8Array(MATR_HEADER_BYTES + n * 28);
  const dv = new DataView(out.buffer);
  const hdr = [MATR_MAGIC, MATR_VERSION, s.tick >>> 0, n, s.capacity >>> 0, s.seed >>> 0, 0, 0];
  hdr.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
  let o = MATR_HEADER_BYTES;
  for (let i = 0; i < n * 3; i++, o += 4) dv.setInt32(o, s.pos[i]!, true);
  for (let i = 0; i < n * 3; i++, o += 4) dv.setInt32(o, s.vel[i]!, true);
  for (let i = 0; i < n; i++, o += 4) dv.setUint32(o, s.mat[i]!, true);
  return out;
}

export function decodeMatr(bytes: Uint8Array): MatrState {
  if (bytes.byteLength < MATR_HEADER_BYTES) throw new Error('matter: MATR payload too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (i: number): number => dv.getUint32(i * 4, true);
  if (u(0) !== MATR_MAGIC) throw new Error('matter: not a MATR payload');
  if (u(1) !== MATR_VERSION) throw new Error(`matter: MATR version ${u(1)} (expected ${MATR_VERSION})`);
  const n = u(3);
  if (bytes.byteLength !== MATR_HEADER_BYTES + n * 28) throw new Error('matter: MATR payload size mismatch');
  const pos = new Int32Array(n * 3), vel = new Int32Array(n * 3), mat = new Uint32Array(n);
  let o = MATR_HEADER_BYTES;
  for (let i = 0; i < n * 3; i++, o += 4) pos[i] = dv.getInt32(o, true);
  for (let i = 0; i < n * 3; i++, o += 4) vel[i] = dv.getInt32(o, true);
  for (let i = 0; i < n; i++, o += 4) mat[i] = dv.getUint32(o, true);
  return { tick: u(2), count: n, capacity: u(4), seed: u(5), pos, vel, mat };
}

/** Final checksum mix from the two wrapping per-particle hash sums (identical on both backends). */
export function finishChecksum(c0: number, c1: number, n: number): [number, number] {
  let a = (c0 ^ n) >>> 0;
  a ^= a >>> 16; a = Math.imul(a, 0x85ebca6b); a ^= a >>> 13; a = Math.imul(a, 0xc2b2ae35); a ^= a >>> 16;
  let b = (c1 + Math.imul(n, 0x9e3779b9)) >>> 0;
  b ^= b >>> 16; b = Math.imul(b, 0x85ebca6b); b ^= b >>> 13; b = Math.imul(b, 0xc2b2ae35); b ^= b >>> 16;
  return [a >>> 0, b >>> 0];
}
