// xxHash64 (SIMULATION §10.4). BigInt implementation: correct first; a 32-bit-limb fast path
// can replace it later without changing outputs (golden tests pin the values).

const M64 = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

const rotl = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & M64;

function round(acc: bigint, input: bigint): bigint {
  acc = (acc + input * P2) & M64;
  acc = rotl(acc, 31n);
  return (acc * P1) & M64;
}

function mergeRound(acc: bigint, val: bigint): bigint {
  val = round(0n, val);
  acc ^= val;
  return (acc * P1 + P4) & M64;
}

function u64(b: Uint8Array, i: number): bigint {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[i + k]!);
  return v;
}

function u32(b: Uint8Array, i: number): bigint {
  return BigInt((b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0);
}

export function xxh64(input: Uint8Array, seed: bigint = 0n): bigint {
  const len = input.length;
  let i = 0;
  let h: bigint;
  if (len >= 32) {
    let v1 = (seed + P1 + P2) & M64;
    let v2 = (seed + P2) & M64;
    let v3 = seed & M64;
    let v4 = (seed - P1) & M64;
    for (; i + 32 <= len; i += 32) {
      v1 = round(v1, u64(input, i));
      v2 = round(v2, u64(input, i + 8));
      v3 = round(v3, u64(input, i + 16));
      v4 = round(v4, u64(input, i + 24));
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M64;
    h = mergeRound(h, v1);
    h = mergeRound(h, v2);
    h = mergeRound(h, v3);
    h = mergeRound(h, v4);
  } else {
    h = (seed + P5) & M64;
  }
  h = (h + BigInt(len)) & M64;
  for (; i + 8 <= len; i += 8) {
    h ^= round(0n, u64(input, i));
    h = (rotl(h, 27n) * P1 + P4) & M64;
  }
  if (i + 4 <= len) {
    h ^= (u32(input, i) * P1) & M64;
    h = (rotl(h, 23n) * P2 + P3) & M64;
    i += 4;
  }
  for (; i < len; i++) {
    h ^= (BigInt(input[i]!) * P5) & M64;
    h = (rotl(h, 11n) * P1) & M64;
  }
  h ^= h >> 33n;
  h = (h * P2) & M64;
  h ^= h >> 29n;
  h = (h * P3) & M64;
  h ^= h >> 32n;
  return h;
}

export function toHex64(h: bigint): string {
  return h.toString(16).padStart(16, '0');
}

/**
 * Canonical state hasher: callers append quantized values in canonical order (SIMULATION §10.4),
 * then digest. Values are written little-endian into a growable buffer.
 */
export class Hasher {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private n = 0;

  private ensure(extra: number): void {
    if (this.n + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + extra));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  i32(v: number): this { this.ensure(4); this.view.setInt32(this.n, v, true); this.n += 4; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.n, v >>> 0, true); this.n += 4; return this; }
  bool(v: boolean): this { this.ensure(1); this.buf[this.n++] = v ? 1 : 0; return this; }
  /** Quantize a float to an integer grid before hashing (never hash raw float text). */
  q(v: number, step: number): this { return this.i32(Math.round(v / step)); }
  bytes(b: Uint8Array): this { this.ensure(b.length); this.buf.set(b, this.n); this.n += b.length; return this; }

  digest(seed: bigint = 0n): bigint { return xxh64(this.buf.subarray(0, this.n), seed); }
  reset(): void { this.n = 0; }
}
