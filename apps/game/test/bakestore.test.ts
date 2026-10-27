// S3: the sparse bake-ahead keyframe store (apps/game/src/bakestore.ts) reconstructs exactly what full keyframes would.

import { describe, expect, it } from 'vitest';
import { BakeStore, type StateArrays } from '../src/bakestore.ts';

const KF = 4;
const N = 50;

/** A deterministic toy run: each keyframe a few bodies move (a band that sweeps through the bodies). */
function frameAt(k: number): Float32Array {
  const t = new Float32Array(N * 7);
  for (let b = 0; b < N; b++) {
    const moves = Math.min(k, Math.max(0, k - b * 2)); // body b starts moving at keyframe 2b
    const q = [0, Math.sin(moves * 0.05), 0, Math.cos(moves * 0.05)];
    t.set([b, moves * 0.01, -moves * 0.02, q[0]!, q[1]!, q[2]!, q[3]!], b * 7);
  }
  return t;
}
const state = (k: number): StateArrays => {
  const f = new Uint8Array(N); f[k % N] = 1;
  return { f, m: new Uint8Array(N), l: new Float32Array(0), c: new Uint8Array(N * 4), k: new Int32Array(0), b: new Float32Array(0), mf: new Float32Array(0), mc: new Int32Array(0) } as StateArrays; // MI (M4): mf
};
function moved(prev: Float32Array, next: Float32Array): { idx: Int32Array; xf: Float32Array } {
  const idx: number[] = [];
  for (let b = 0; b < N; b++) for (let j = 0; j < 7; j++) if (prev[b * 7 + j] !== next[b * 7 + j]) { idx.push(b); break; }
  const xf = new Float32Array(idx.length * 7);
  idx.forEach((b, i) => xf.set(next.subarray(b * 7, b * 7 + 7), i * 7));
  return { idx: Int32Array.from(idx), xf };
}

function fill(store: BakeStore, from: number, to: number): void {
  for (let k = from; k <= to; k++) store.put(k * KF, moved(frameAt(k - 1), frameAt(k)), state(k));
}

const close = (a: Float32Array, b: Float32Array, tol = 2e-4): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(tol);
};

describe('BakeStore', () => {
  it('reconstructs every keyframe (positions exact, rotations to snorm16) going forward and scrubbing back', () => {
    const s = new BakeStore(KF, { t: frameAt(0), ...state(0) });
    fill(s, 1, 120);
    for (const k of [120, 3, 77, 0, 119, 40, 41, 2]) {
      const fr = s.frame(k * KF);
      close(fr.t, frameAt(k));
      expect(fr.f).toEqual(state(k).f);
    }
    // between keyframes: positions are the lerp of their neighbours
    const mid = s.frame(10 * KF + 2).t, a = frameAt(10), b = frameAt(11);
    for (let i = 0; i < N; i++) expect(mid[i * 7 + 1]).toBeCloseTo((a[i * 7 + 1]! + b[i * 7 + 1]!) / 2, 5);
  });

  it('a rollback truncates the future and re-bakes it; over the span cap the oldest keyframes fold into the base', () => {
    const s = new BakeStore(KF, { t: frameAt(0), ...state(0) }, 768 * 1048576, 60 * KF);
    fill(s, 1, 50);
    s.truncate(30 * KF);
    expect(s.headTick).toBe(30 * KF);
    fill(s, 31, 100);
    expect(s.headTick - s.baseTick).toBeLessThanOrEqual(60 * KF);
    expect(s.baseTick).toBe(40 * KF);
    for (const k of [40, 70, 100, 55]) close(s.frame(k * KF).t, frameAt(k));
    close(s.frame(0).t, frameAt(40)); // clamped to the oldest held keyframe
  });

  it('stores only what moved (a still scene costs nothing per keyframe)', () => {
    const still = frameAt(0);
    const s = new BakeStore(KF, { t: still, ...state(0) });
    const before = s.bytes;
    const st = state(0);
    for (let k = 1; k <= 100; k++) s.put(k * KF, { idx: new Int32Array(0), xf: new Float32Array(0) }, st);
    expect(s.bytes - before).toBeLessThan((100 * N * 28) / 5); // M1 kept a full frame per keyframe
    expect(s.moving(50 * KF)).toBe(false);
  });
});
