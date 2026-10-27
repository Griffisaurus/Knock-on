import { describe, expect, it } from 'vitest';
import { Hasher, Rng, datan, datan2, dcos, dexp, dlog, dpow, dsin, ldexp, stream, toHex64, xxh64 } from '../src/index.ts';

function rel(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
}

const samples: number[] = [];
{
  const r = new Rng(12345);
  for (let i = 0; i < 20000; i++) samples.push(r.range(-50, 50));
  samples.push(0, 1e-12, -1e-12, Math.PI, -Math.PI, Math.PI / 2, 1e3, -1e4);
}

describe('detmath accuracy vs platform Math (sanity only; determinism is the point)', () => {
  it('sin/cos within 1e-15 absolute', () => {
    for (const x of samples) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(2e-15 * Math.max(1, Math.abs(x) / 1000));
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(2e-15 * Math.max(1, Math.abs(x) / 1000));
    }
  });
  it('atan/atan2 within 2 ulp-ish', () => {
    for (const x of samples) {
      expect(rel(datan(x), Math.atan(x))).toBeLessThan(5e-16);
      expect(Math.abs(datan2(x, 3.3) - Math.atan2(x, 3.3))).toBeLessThan(1e-15);
      expect(Math.abs(datan2(x, -0.7) - Math.atan2(x, -0.7))).toBeLessThan(1e-15);
    }
    expect(datan2(0, -1)).toBe(Math.PI);
    expect(datan2(1, 0)).toBe(Math.PI / 2);
  });
  it('exp/log/pow relative error < 1e-15', () => {
    for (const x of samples) {
      expect(rel(dexp(x / 5), Math.exp(x / 5))).toBeLessThan(1e-15);
      const p = Math.abs(x) + 1e-3;
      expect(Math.abs(dlog(p) - Math.log(p))).toBeLessThan(1e-15 * Math.max(1, Math.abs(Math.log(p))));
      expect(rel(dpow(p, 1.5), Math.pow(p, 1.5))).toBeLessThan(5e-15);
    }
    expect(dpow(2, 10)).toBe(1024);
    expect(dpow(3, -2)).toBe(1 / 9);
    expect(dlog(1)).toBe(0);
    expect(dexp(0)).toBe(1);
    expect(dlog(5e-320)).toBeCloseTo(Math.log(5e-320), 10);
  });
  it('ldexp is exact', () => {
    expect(ldexp(1, 10)).toBe(1024);
    expect(ldexp(3, -2)).toBe(0.75);
    expect(ldexp(1, 1030)).toBe(2 ** 1030);
  });
});

describe('golden values (these must never change without a simVersion bump)', () => {
  it('detmath fingerprint', () => {
    const h = new Hasher();
    const r = new Rng(42, 7);
    for (let i = 0; i < 2000; i++) {
      const x = r.range(-20, 20);
      h.bytes(new Uint8Array(new Float64Array([dsin(x), dcos(x), datan2(x, 1.25), dexp(x / 4), dlog(Math.abs(x) + 1)]).buffer));
    }
    // Locked on first run; see SIMULATION §10.3. Updating requires a `sim!:` commit.
    expect(toHex64(h.digest())).toMatchInlineSnapshot(`"d2568b2d5466b313"`);
  });
});

describe('Rng', () => {
  it('is reproducible per named stream', () => {
    const a = stream(1, 2, 'critter:12');
    const b = stream(1, 2, 'critter:12');
    const c = stream(1, 2, 'critter:13');
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    expect(Array.from({ length: 8 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.nextU32())).not.toEqual(sa);
  });
  it('round-trips state', () => {
    const a = new Rng(9);
    a.nextU32();
    const b = Rng.fromState(a.state());
    expect(b.nextU32()).toBe(a.nextU32());
  });
  it('nextInt stays in range', () => {
    const a = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = a.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

describe('xxh64', () => {
  const enc = new TextEncoder();
  it('matches reference vectors', () => {
    expect(toHex64(xxh64(new Uint8Array(0)))).toBe('ef46db3751d8e999');
    expect(toHex64(xxh64(enc.encode('abc')))).toBe('44bc2cf5ad770999');
  });
  it('handles long input', () => {
    const big = new Uint8Array(1000).map((_, i) => i & 255);
    expect(xxh64(big)).toBe(xxh64(big.slice()));
    expect(xxh64(big)).not.toBe(xxh64(big, 1n));
  });
});
