// Per-frame extras for parts with a pre-built piece body (contract 3 'piece' roles). The pieces themselves
// are scene instances on their bodies (scene.ts, `<art>:piece`); this draws what connects them:
// GOTCHA BOX's spring, stretched from the box's pivot to the popped head (the art's spring stays inside
// the box at rest).

import { GOTCHA } from '@knockon/parts-data';
import type { SceneItem } from './renderer.ts';

type V3 = [number, number, number];
type Q = ArrayLike<number>;

const qrot = (q: Q, v: readonly number[]): V3 => {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
  return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
};

const STEEL: readonly [number, number, number] = [0.4, 0.42, 0.46];

export interface PieceRun {
  readonly phase: string;
  readonly bodies: readonly { readonly part: number; readonly type: string; readonly role: string }[];
  readonly transforms: Float32Array;
}

/** Appends the GOTCHA BOX springs of every popped head. */
export function pieceExtras(run: PieceRun, out: SceneItem[]): void {
  if (run.phase !== 'running' || !run.transforms.length) return;
  const base = new Map<number, number>();
  run.bodies.forEach((b, i) => { if (b.type === 'gotcha_box' && b.role === 'base') base.set(b.part, i); });
  if (!base.size) return;
  const xf = run.transforms;
  run.bodies.forEach((b, i) => {
    if (b.type !== 'gotcha_box' || b.role !== 'piece') return;
    const bi = base.get(b.part);
    if (bi === undefined) return;
    const pr = xf.subarray(bi * 7 + 3, bi * 7 + 7), hr = xf.subarray(i * 7 + 3, i * 7 + 7);
    const p0 = qrot(pr, GOTCHA.pivot), p1 = qrot(hr, [GOTCHA.rest[0], GOTCHA.rest[1] - 0.05, GOTCHA.rest[2]]);
    const a: V3 = [xf[bi * 7]! + p0[0], xf[bi * 7 + 1]! + p0[1], xf[bi * 7 + 2]! + p0[2]];
    const c: V3 = [xf[i * 7]! + p1[0], xf[i * 7 + 1]! + p1[1], xf[i * 7 + 2]! + p1[2]];
    const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.02) return; // at rest: the art's spring inside the box
    // a coil: rings along the axis (rotation taking +Y to the axis)
    const y: V3 = [d[0] / len, d[1] / len, d[2] / len];
    const s = Math.sqrt(Math.max(1e-9, (1 + y[1]) * 2));
    const rot: [number, number, number, number] = y[1] < -0.9999 ? [1, 0, 0, 0] : [y[2] / s, 0, -y[0] / s, s / 2];
    const n = Math.max(3, Math.round(len / 0.018));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push({ pos: [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], rot, size: [0.045, 0.006, 0.045], mesh: 2, color: STEEL, metal: 1, rough: 0.3 });
    }
    out.push({ pos: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], rot, size: [0.006, len, 0.006], mesh: 2, color: STEEL, metal: 1, rough: 0.3 });
  });
}
