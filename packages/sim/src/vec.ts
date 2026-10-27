// Plain-number vector and quaternion helpers for gameplay maths. Only + − × ÷ and sqrt (which
// IEEE-754 rounds exactly), so results are identical on every platform (SIMULATION §10.1).

export type Vec = [number, number, number];
export type Q = [number, number, number, number];

export const vadd = (a: readonly number[], b: readonly number[]): Vec => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const vsub = (a: readonly number[], b: readonly number[]): Vec => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const vscale = (a: readonly number[], s: number): Vec => [a[0]! * s, a[1]! * s, a[2]! * s];
export const vdot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const vlen = (a: readonly number[]): number => Math.sqrt(vdot(a, a));
export const vcross = (a: readonly number[], b: readonly number[]): Vec => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];
export const vnorm = (a: readonly number[]): Vec => { const l = vlen(a); return l > 1e-12 ? vscale(a, 1 / l) : [0, 0, 0]; };

export function qmul(a: readonly number[], b: readonly number[]): Q {
  const [ax, ay, az, aw] = a as Q, [bx, by, bz, bw] = b as Q;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qrot(q: readonly number[], v: readonly number[]): Vec {
  const u: Vec = [q[0]!, q[1]!, q[2]!];
  const t = vscale(vcross(u, v), 2);
  return vadd(vadd(v, vscale(t, q[3]!)), vcross(u, t));
}

/** Distance from point p to segment ab. */
export function segDist(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = vsub(b, a);
  const l2 = vdot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, vdot(vsub(p, a), ab) / l2)) : 0;
  return vlen(vsub(p, vadd(a, vscale(ab, t))));
}

/**
 * Rounds a path's corners into bends (quadratic Bézier, `steps` segments, radius ≤ `r`), the way a
 * drawn TUBE or GUTTER sweeps (frame.md). Shared by the sim colliders and the renderer.
 */
export function roundPath(pts: readonly Vec[], r = 0.25, steps = 6): Vec[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1], p[2]]);
  const out: Vec[] = [[pts[0]![0], pts[0]![1], pts[0]![2]]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[k - 1]!, p = pts[k]!, b = pts[k + 1]!;
    const la = vlen(vsub(a, p)), lb = vlen(vsub(b, p));
    const d = Math.min(r, la / 2, lb / 2);
    const p0 = vadd(p, vscale(vsub(a, p), d / la)), p2 = vadd(p, vscale(vsub(b, p), d / lb));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push(vadd(vadd(vscale(p0, u * u), vscale(p, 2 * u * t)), vscale(p2, t * t)));
    }
  }
  const last = pts[pts.length - 1]!;
  out.push([last[0], last[1], last[2]]);
  return out;
}
