// Deterministic randomness for audio. Never Math.random: the same seed always yields the same sound,
// and per-event variation is hashed from (part, tick) so replays sound identical (AUDIO.md §3).

/** FNV-1a 32-bit string hash. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer hash (lowbias32). */
export function hashInt(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Hash of several ints to a float in [0, 1). */
export function hash01(...v: number[]): number {
  let h = 0x9e3779b9;
  for (const n of v) h = hashInt((h ^ (n | 0)) >>> 0);
  return h / 4294967296;
}

/** mulberry32 PRNG: returns floats in [0, 1). */
export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 0x6d2b79f5;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** Uniform in [-1, 1). */
  bi(): number { return this.next() * 2 - 1; }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]!; }
  chance(p: number): boolean { return this.next() < p; }
}
