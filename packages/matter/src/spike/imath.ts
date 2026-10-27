// Integer helpers shared by the CPU reference. Each mirrors a WGSL function in wgsl.ts bit for bit:
// i32 values are kept as JS int32 (| 0), u32 values as unsigned (>>> 0), wrapping products use Math.imul.

import { DAMP_NUM, GRAIN_D, GRAIN_R, SCENE, SPLIT_DY } from './constants.ts';

/** Truncating division with b = 0 → 0 (SIMULATION §8.3). INT_MIN / -1 wraps to INT_MIN, like the WGSL idiv. */
export function idiv(a: number, b: number): number {
  if (b === 0) return 0;
  return (a / b) | 0;
}

/** Bit-by-bit integer square root of a u32 (floor). Fixed 16 rounds, no data-dependent loop count. */
export function isqrt(n: number): number {
  let x = n >>> 0;
  let r = 0;
  let b = 0x40000000;
  for (let k = 0; k < 16; k++) {
    if (x >= r + b) {
      x -= r + b;
      r = (r >>> 1) + b;
    } else {
      r >>>= 1;
    }
    b >>>= 2;
  }
  return r;
}

/** v × DAMP_NUM / 256 truncated toward zero. A plain arithmetic shift would leave v = -1 drifting forever. */
export function damp(v: number): number {
  const a = (Math.imul(Math.abs(v), DAMP_NUM) >> 8);
  return (v < 0 ? -a : a) | 0;
}

export function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function cellKey(x: number, y: number, z: number): number {
  return ((x >> 8) & 127) | (((z >> 8) & 127) << 7) | (((y >> 8) & 255) << 14);
}

export function neighbourKey(k: number, dx: number, dy: number, dz: number): number {
  return (((k & 127) + dx) & 127) | (((((k >>> 7) & 127) + dz) & 127) << 7) | (((((k >>> 14) & 255) + dy) & 255) << 14);
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

/** Per-grain state hash; summing these catches permutations that plain coordinate sums miss. */
export function grainHash(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): number {
  return fmix32(mixK(mixK(mixK(mixK(mixK(mixK(i, x), y), z), vx), vy), vz));
}

/**
 * Contact correction for the first grain of a pair, given Δ = p_first − p_second and d² = |Δ|² < D².
 * Swapping the pair negates Δ and swaps the shares (w ↔ 4 − w), and truncating division is odd, so
 * the GPU can compute both grains' corrections from one pair visit while the CPU gathers per grain.
 */
export function contact(out: Int32Array, dx: number, dy: number, dz: number, d2: number, firstIsLower: boolean): void {
  const d = isqrt(d2);
  if (d === 0) {
    out[0] = 0;
    out[1] = firstIsLower ? -GRAIN_R : GRAIN_R;
    out[2] = 0;
    return;
  }
  // Share of the full separation in quarters: 3 for the upper grain, 1 for the lower, else 2.
  const w = dy > SPLIT_DY ? 3 : dy < -SPLIT_DY ? 1 : 2;
  const pen = Math.imul(GRAIN_D - d, w);
  const den = d << 2;
  out[0] = idiv(Math.imul(dx, pen), den);
  out[1] = idiv(Math.imul(dy, pen), den);
  out[2] = idiv(Math.imul(dz, pen), den);
}

/**
 * Push a grain out of the static proxies, then clamp it to the container. Floor contact halves the
 * tangential displacement since the tick start (cheap static friction so grains pile).
 * `p[pi..pi+2]` is updated in place; (ox, oz) is the substep-start position.
 */
export function collideStatic(p: Int32Array, pi: number, ox: number, oz: number): void {
  let x = p[pi]!;
  let y = p[pi + 1]!;
  let z = p[pi + 2]!;
  const b = SCENE.box;
  const bx0 = b.x0 - GRAIN_R, bx1 = b.x1 + GRAIN_R, by0 = b.y0 - GRAIN_R, by1 = b.y1 + GRAIN_R;
  const bz0 = b.z0 - GRAIN_R, bz1 = b.z1 + GRAIN_R;
  if (x > bx0 && x < bx1 && y > by0 && y < by1 && z > bz0 && z < bz1) {
    // Least-penetration axis; ties keep the earlier candidate (order: -x, +x, -y, +y, -z, +z).
    let best = x - bx0; let axis = 0;
    if (bx1 - x < best) { best = bx1 - x; axis = 1; }
    if (y - by0 < best) { best = y - by0; axis = 2; }
    if (by1 - y < best) { best = by1 - y; axis = 3; }
    if (z - bz0 < best) { best = z - bz0; axis = 4; }
    if (bz1 - z < best) { axis = 5; }
    if (axis === 0) x = bx0; else if (axis === 1) x = bx1; else if (axis === 2) y = by0;
    else if (axis === 3) y = by1; else if (axis === 4) z = bz0; else z = bz1;
  }
  const s = SCENE.sphere;
  const rr = s.r + GRAIN_R;
  const dx = x - s.x, dy = y - s.y, dz = z - s.z;
  if (dx < rr && dx > -rr && dy < rr && dy > -rr && dz < rr && dz > -rr) {
    const d2 = Math.imul(dx, dx) + Math.imul(dy, dy) + Math.imul(dz, dz);
    if (d2 < Math.imul(rr, rr)) {
      const d = isqrt(d2);
      if (d === 0) {
        y = s.y + rr;
      } else {
        const pen = rr - d;
        x = x + idiv(Math.imul(dx, pen), d);
        y = y + idiv(Math.imul(dy, pen), d);
        z = z + idiv(Math.imul(dz, pen), d);
      }
    }
  }
  x = clampI(x, -SCENE.halfX + GRAIN_R, SCENE.halfX - GRAIN_R);
  z = clampI(z, -SCENE.halfZ + GRAIN_R, SCENE.halfZ - GRAIN_R);
  if (y < GRAIN_R) {
    y = GRAIN_R;
    x = ox + idiv(x - ox, 2);
    z = oz + idiv(z - oz, 2);
  }
  p[pi] = x; p[pi + 1] = y; p[pi + 2] = z;
}
