// RENDER (beta polish, D125–D126): the pure parts of the shadow cascades, the runtime-lit Earth and the far set-piece
// LOD (docs/dev/BETA_NOTES_RENDER.md).

import { describe, expect, it } from 'vitest';
import type { V3 } from '../src/math.ts';
import { clipPlanes, fitFar, fitLegacy, fitNear, frustumBox, lightView, NEAR_MAX_EXT, quantExt, shadowDistance, type Aabb } from '../src/gfx/shadowfit.ts';
import { dropColour, earthFrame, FAR_GAP_PX, farLod } from '../src/gfx/setpieces.ts';

const KEY: V3 = (() => { const k = [-1.6, 1.9, 1.5], l = Math.hypot(...k); return k.map((v) => v / l) as V3; })();
const ARENA: Aabb = { min: [-121, -1, -121], max: [121, 2, 121] };
const clip = (m: Float32Array, p: readonly number[]): number[] => [0, 1, 2, 3].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!);
const inside = (m: Float32Array, eye: V3, w: readonly number[]): boolean => {
  const c = clip(m, [w[0]! - eye[0], w[1]! - eye[1], w[2]! - eye[2]]);
  return Math.abs(c[0]!) <= 1 + 1e-5 && Math.abs(c[1]!) <= 1 + 1e-5 && c[2]! >= -1e-5 && c[2]! <= 1 + 1e-5;
};

describe('shadow cascades (D125)', () => {
  it('extents step along a 2^(1/8) ladder and hold the request', () => {
    for (const e of [0.3, 1.5, 7.2, 70.7, 80, 151]) {
      const q = quantExt(e);
      expect(q).toBeGreaterThanOrEqual(e - 1e-9);
      expect(q / e).toBeLessThan(2 ** (1 / 8) + 1e-9);
      expect(Math.log2(q) * 8).toBeCloseTo(Math.round(Math.log2(q) * 8), 9);
    }
  });

  it('the near map is texel-stable: a small camera move keeps its extent and moves its centre by whole texels', () => {
    const a = fitNear(KEY, [0, 41, 75.5], [0, 2, 8], 4096, ARENA);
    const b = fitNear(KEY, [0.013, 41.007, 75.5], [0.013, 2.007, 8], 4096, ARENA);
    expect(b.ext).toBe(a.ext);
    expect(Math.abs(b.cx / b.texel - Math.round(b.cx / b.texel))).toBeLessThan(1e-6);
    expect(Math.abs(b.cy / b.texel - Math.round(b.cy / b.texel))).toBeLessThan(1e-6);
    expect(a.ext).toBeLessThanOrEqual(quantExt(NEAR_MAX_EXT));
  });

  it('the near map shrinks to a small scene (crisper texels) and still holds every part of it', () => {
    const small: Aabb = { min: [-2, -1, -2], max: [2, 3, 2] };
    const eye: V3 = [0, 60, 100], focus: V3 = [0, 0, 0];
    const plain = fitNear(KEY, eye, focus, 4096, null), fitted = fitNear(KEY, eye, focus, 4096, small);
    expect(fitted.texel).toBeLessThan(plain.texel / 4);
    for (let i = 0; i < 8; i++) expect(inside(fitted.mat, eye, [(i & 1 ? small.max : small.min)[0], (i & 2 ? small.max : small.min)[1], (i & 4 ? small.max : small.min)[2]])).toBe(true);
  });

  it('the legacy map is the M5 one: 300 m across at most', () => {
    expect(fitLegacy(KEY, [0, 115, 154], [0, 0, 0], 4096).ext).toBe(150);
  });

  it('the far map covers the view up to the shadow distance, and is skipped when the near map holds it all', () => {
    const eye: V3 = [0, 115, 154], target: V3 = [0, 0, 0];
    const near = fitNear(KEY, eye, target, 4096, ARENA);
    const far = fitFar(KEY, eye, target, 40, 16 / 9, 2048, ARENA, near)!;
    expect(far).not.toBeNull();
    expect(far.ext).toBeGreaterThan(near.ext);
    for (const c of [[-120, 0, -120], [120, 0, -120], [-120, 0, 120], [120, 1, 120], [0, 0, 0]]) expect(inside(far.mat, eye, c)).toBe(true);
    // a close-up of a small scene: the near map holds it, no far pass
    const tiny: Aabb = { min: [-0.5, -1, -0.5], max: [0.5, 1, 0.5] };
    const n2 = fitNear(KEY, [1.6, 1.2, 1.9], [0, 0.1, 0], 4096, tiny);
    expect(fitFar(KEY, [1.6, 1.2, 1.9], [0, 0.1, 0], 40, 16 / 9, 2048, tiny, n2)).toBeNull();
    expect(fitFar(KEY, eye, target, 40, 16 / 9, 2048, null, near)).toBeNull();
  });

  it('shadow distance: 3 × the focus distance + 30, 60…1,500 m', () => {
    expect(shadowDistance(2)).toBe(60);
    expect(shadowDistance(78)).toBe(264);
    expect(shadowDistance(750)).toBe(1500);
  });

  it('the frustum box and clip planes agree with the camera', () => {
    const b = frustumBox([0, 2, 10], [0, 2, 0], 40, 16 / 9, 0.05, 50);
    expect(b.min[2]).toBeLessThan(-39);
    expect(b.max[2]).toBeGreaterThan(9.9);
    const v = lightView(KEY);
    const pl = clipPlanes(v);
    expect(pl).toHaveLength(6);
    for (const p of pl) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 6);
  });
});

describe('runtime-lit Earth (D126)', () => {
  const center = [0, -511.33, -1409.54], eye = [-40, 7, 36];
  const sun = [0, 0.5, -0.8660254];
  const angle = (a: readonly number[], b: readonly number[]): number => Math.acos(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) * 180 / Math.PI;
  const view = (() => { const v = eye.map((x, i) => x - center[i]!); const l = Math.hypot(...v); return v.map((x) => x / l); })();

  it('turns the Hangar sun to the art-directed 105° phase (D112), and leaves the Moon’s true sun alone', () => {
    expect(angle(sun, view)).toBeGreaterThan(125); // the true phase, ≈ 130°
    const h = earthFrame({ axis: [0, 1, 0], degPerMinute: 1, phaseDeg: 105 }, center, eye, sun, 0);
    expect(angle(h.sun, view)).toBeCloseTo(105, 4);
    expect(Math.hypot(...h.sun)).toBeCloseTo(1, 9);
    const m = earthFrame({ axis: [0, 1, 0], degPerMinute: 1 }, center, eye, sun, 0);
    expect(m.sun.map((v) => Math.round(v * 1e6))).toEqual(sun.map((v) => Math.round(v * 1e6)));
  });

  it('spins 1° per minute about its axis, from the wall clock', () => {
    const a = earthFrame({ axis: [0, 2, 0], degPerMinute: 1 }, center, eye, sun, 0);
    const b = earthFrame({ axis: [0, 2, 0], degPerMinute: 1 }, center, eye, sun, 90 * 60_000);
    expect(a.axis).toEqual([0, 1, 0]);
    expect(b.angle - a.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(earthFrame({ axis: [0, 1, 0], degPerMinute: 1 }, center, eye, sun, 361 * 60_000).angle).toBeCloseTo(Math.PI / 180, 9);
  });
});

describe('far set-piece LOD (D126)', () => {
  it('keeps the panel grid while a gap spans ¾ px, with hysteresis', () => {
    // 1080p, 45.75° vertical: an 8 cm gap is ¾ px at ≈ 135 m
    expect(farLod(60, 45.75, 1080, 3, 0)).toBe(0);
    expect(farLod(250, 45.75, 1080, 3, 0)).toBe(2);
    const edge = (0.08 * 1080) / (FAR_GAP_PX * 2 * Math.tan((45.75 * Math.PI) / 360));
    expect(farLod(edge * 1.02, 45.75, 1080, 3, 0)).toBe(0); // not yet (hysteresis)
    expect(farLod(edge * 1.02, 45.75, 1080, 3, 2)).toBe(2); // and stays far
    expect(farLod(edge * 0.85, 45.75, 1080, 3, 2)).toBe(0);
  });

  it('drops one material’s triangles by its base colour', () => {
    const g = {
      positions: new Float32Array(18), normals: new Float32Array(18), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0.2, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1]),
    };
    expect([...dropColour(g, [0.2, 0.2, 0.2, 1]).indices]).toEqual([0, 1, 2]);
    expect(dropColour(g, [0, 1, 0, 1])).toBe(g);
  });
});
