// xoshiro128** PRNG with splitmix32 seeding (SIMULATION §10.1). 32-bit integer ops only.

export interface RngState { s0: number; s1: number; s2: number; s3: number }

function splitmix32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** Seed from two 32-bit words (e.g. the halves of a 64-bit world seed mixed with a stream hash). */
  constructor(seedLo: number, seedHi = 0) {
    const sm = splitmix32((seedLo ^ Math.imul(seedHi >>> 0, 0x27d4eb2d)) >>> 0);
    this.s0 = sm(); this.s1 = sm(); this.s2 = sm(); this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  static fromState(st: RngState): Rng {
    const r = new Rng(1);
    r.s0 = st.s0 >>> 0; r.s1 = st.s1 >>> 0; r.s2 = st.s2 >>> 0; r.s3 = st.s3 >>> 0;
    return r;
  }

  state(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  /** Next uniformly distributed unsigned 32-bit integer. */
  nextU32(): number {
    const t = Math.imul(this.s1, 5);
    const result = Math.imul((t << 7) | (t >>> 25), 9) >>> 0;
    const u = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ u) >>> 0;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return result;
  }

  /** Uniform in [0, 1) with 32 bits of resolution (exact division by 2^32). */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [0, n) without modulo bias (n ≤ 2^32). */
  nextInt(n: number): number {
    if (n <= 0) throw new RangeError('n must be positive');
    const limit = 4294967296 - (4294967296 % n);
    for (;;) {
      const v = this.nextU32();
      if (v < limit) return v % n;
    }
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.nextFloat();
  }
}

/** FNV-1a 32-bit hash of a string, used to derive named stream seeds ("critter:12"). */
export function hashString32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A named, reproducible stream: same world seed + same name → same sequence everywhere. */
export function stream(worldSeedLo: number, worldSeedHi: number, name: string): Rng {
  return new Rng((worldSeedLo ^ hashString32(name)) >>> 0, worldSeedHi);
}
