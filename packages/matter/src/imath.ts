// Integer helpers for the CPU reference and the host-side tick preparation. Each mirrors a WGSL function in wgsl.ts
// bit for bit: i32 values are kept as JS int32 (| 0), u32 as unsigned (>>> 0), wrapping products use Math.imul.
// Where the GPU needs 64-bit products (split into 16-bit halves, SIMULATION §8.3), the CPU uses exact doubles
// (every such product is bounded below 2^53), which makes those paths genuinely independent implementations.

import { DAMP_NUM, DAMP_SHIFT } from './constants.ts';

/** Truncating division with b = 0 → 0 (SIMULATION §8.3). INT_MIN / −1 wraps to INT_MIN, like the WGSL idiv. */
export function idiv(a: number, b: number): number {
  if (b === 0) return 0;
  return (a / b) | 0;
}

/**
 * Floor square root of a u32. Exact: sqrt of an integer below 2^32 is correctly rounded in a double and never rounds
 * up across an integer (k² − 1 sits 1/2k below k, far above double precision). The GPU uses a bit-by-bit integer
 * method; any exact floor sqrt gives the same bits.
 */
export function isqrt(n: number): number {
  return Math.floor(Math.sqrt(n >>> 0));
}

/** v × DAMP_NUM >> DAMP_SHIFT, truncated toward zero (sign-symmetric, so ±1 decay to 0). */
export function damp(v: number): number {
  const a = Math.imul(v < 0 ? -v : v, DAMP_NUM) >> DAMP_SHIFT;
  return (v < 0 ? -a : a) | 0;
}

/** a >> s with truncation toward zero (sign-symmetric, so rounding never biases a direction). |a| < 2^31. */
export function shrS(a: number, s: number): number {
  return a < 0 ? -((-a) >> s) : a >> s;
}

export function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One murmur3 block round. */
export function mixK(h: number, v: number): number {
  let k = Math.imul(v, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  let r = h ^ k;
  r = (r << 13) | (r >>> 19);
  return (Math.imul(r, 5) + 0xe6546b64) >>> 0;
}

/** Offset-binary cell coordinate: floor((x + 2³¹) / cell) as a u32. */
export function ucell(x: number, cell: number): number {
  return (((x ^ -2147483648) >>> 0) / cell) >>> 0;
}

/** Row hash of a cell row segment (kind, ux >> XB, uy, uz); the low bits pick the key's row. */
export function rowHash(kind: number, hx: number, uy: number, uz: number): number {
  return fmix32((Math.imul(hx, 0x9e3779b1) ^ Math.imul(uy, 0x85ebca77) ^ Math.imul(uz, 0xc2b2ae3d) ^ Math.imul(kind + 1, 0x27d4eb2f)) >>> 0);
}

/** Tag of a row segment: an independent 32-bit hash of the same coordinates, to reject aliased rows. */
export function cellTag(kind: number, hx: number, uy: number, uz: number): number {
  return fmix32((Math.imul(hx, 0x7feb352d) ^ Math.imul(uy, 0x846ca68b) ^ Math.imul(uz, 0x2c1b3c6d) ^ Math.imul(kind + 1, 0x297a2d39)) >>> 0);
}

/** Per-particle state hash for the checksum (index, position, velocity, material). */
export function grainHash(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, m: number): number {
  return fmix32(mixK(mixK(mixK(mixK(mixK(mixK(mixK(i, x), y), z), vx), vy), vz), m));
}

/** Second, independent per-particle hash (different seed and order). */
export function grainHash2(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): number {
  return fmix32(mixK(mixK(mixK(mixK(mixK(mixK(0x2545f491, z), vx), x), vy), y ^ i), vz));
}

/** floor(a × b / 2^s) for |a × b| < 2^53 (the GPU computes the same with a 64-bit split multiply). */
export function mulShr(a: number, b: number, s: number): number {
  return Math.floor((a * b) / 2 ** s) | 0;
}

/**
 * Normalised direction and length of an integer vector, with a normalising shift so every square fits a u32.
 * Writes (nx, ny, nz) in Q12 and the length in units into out[0..3]. Zero vector → (0, 4096, 0), length 0.
 */
export function normDist(out: Int32Array, qx: number, qy: number, qz: number): void {
  const ax = qx < 0 ? -qx : qx, ay = qy < 0 ? -qy : qy, az = qz < 0 ? -qz : qz;
  const m = ax > ay ? (ax > az ? ax : az) : (ay > az ? ay : az);
  if (m === 0) { out[0] = 0; out[1] = 4096; out[2] = 0; out[3] = 0; return; }
  const bits = 32 - Math.clz32(m);
  const s = bits > 14 ? bits - 14 : 0;
  const sx = qx >> s, sy = qy >> s, sz = qz >> s;
  const ds = isqrt(sx * sx + sy * sy + sz * sz);
  out[0] = idiv(sx << 12, ds);
  out[1] = idiv(sy << 12, ds);
  out[2] = idiv(sz << 12, ds);
  out[3] = ds << s;
}

/** Exact 64-bit accumulator held as (hi i32, lo u32) for the CPU impulse sums (SIMULATION §8.4). */
export function add64(acc: Float64Array, k: number, v: number): void {
  // v is an exact integer below 2^53 in magnitude.
  const vhi = Math.floor(v / 4294967296);
  const vlo = v - vhi * 4294967296;
  let lo = acc[k * 2]! + vlo;
  let hi = acc[k * 2 + 1]! + vhi;
  if (lo >= 4294967296) { lo -= 4294967296; hi += 1; }
  acc[k * 2] = lo;
  acc[k * 2 + 1] = hi | 0;
}

/** (hi, lo) arithmetic-shifted right by s (1..31), truncated to i32. */
export function sar64(acc: Float64Array, k: number, s: number): number {
  const lo = acc[k * 2]! >>> 0;
  const hi = acc[k * 2 + 1]! | 0;
  return ((hi << (32 - s)) | (lo >>> s)) | 0;
}
