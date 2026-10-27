// GUTTER (frame.md, assets/build/parts/gutter/gutter.profile.json): an open half-pipe swept along a
// link's path, like TUBE (D68). Section: inner r 0.145, wall 5 mm, Ø 12 mm lip beads at (±0.150, 0.145)
// (slim: 0.056, 4 mm, Ø 8 mm). The path points are the channel floor centre; the channel opens toward world up (the path's local up). Collision is
// 8 staves around the lower half of the bore plus a bead lip on each side. Static, friction 0.40,
// restitution 0.35. `gutter_slim` matches `tube_slim`.

import { dcos, dsin, f32 } from '@knockon/detmath';
import { posToMetres, type LinkRecord } from '@knockon/format';
import { qBasis } from '@knockon/parts-data';
import { roundPath, vadd, vcross, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { L_STATIC, type Host } from './host.ts';

export const GUTTERS = {
  gutter: { r: 0.145, wall: 0.005, lip: 0.012, bend: 0.36 },
  gutter_slim: { r: 0.056, wall: 0.004, lip: 0.008, bend: 0.15 },
} as const;

export function buildGutter(h: Host, l: LinkRecord): void {
  const g = GUTTERS[l.kind as keyof typeof GUTTERS];
  if (!g) return;
  const J = h.Jolt;
  const pts = roundPath(l.points.map((q) => q.map(posToMetres) as Vec), g.bend);
  if (pts.length < 2) return;
  const cs = new J.StaticCompoundShapeSettings();
  const n = 8;
  let count = 0;
  const add = (at: Vec, x: Vec, y: Vec, z: Vec, half: Vec): void => {
    const q = qBasis(x, y, z);
    cs.AddShape(new J.Vec3(f32(at[0]), f32(at[1]), f32(at[2])), new J.Quat(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])),
      new J.BoxShapeSettings(new J.Vec3(f32(half[0]), f32(half[1]), f32(half[2])), f32(0.001)), count++);
  };
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!, b = pts[k]!;
    const d = vsub(b, a), len = vlen(d);
    if (len < 1e-4) continue;
    const t = vscale(d, 1 / len);
    // side = t × up (any horizontal when the run is vertical), up' = side × t
    let side = vcross(t, [0, 1, 0]);
    if (vlen(side) < 1e-3) side = [1, 0, 0];
    side = vnorm(side);
    const up = vnorm(vcross(side, t));
    const axisMid = vadd(vscale(vadd(a, b), 0.5), vscale(up, g.r)); // bore axis: r above the floor line
    const w = ((Math.PI * (g.r + g.wall / 2)) / n) * 1.1;
    for (let i = 0; i <= n; i++) {
      // stave angles −90° … +90° across the bottom (0 = straight down); the ends are the lips' walls
      const th = -Math.PI / 2 + (i / n) * Math.PI;
      const ca = dcos(th), sa = dsin(th);
      const radial = vnorm(vadd(vscale(up, -ca), vscale(side, sa)));
      const at = vadd(axisMid, vscale(radial, g.r + g.wall / 2));
      const x = vcross(t, radial);
      add(at, x, t, radial, [w / 2, len / 2 + 0.01, g.wall / 2]);
    }
    // bead lips on each rim, centred at (±(r + wall), r) from the floor line (gutter.profile.json)
    for (const sgn of [-1, 1]) {
      const at = vadd(axisMid, vscale(side, sgn * (g.r + g.wall)));
      add(at, side, t, vcross(side, t), [g.lip / 2, len / 2 + 0.01, g.lip / 2]);
    }
  }
  if (!count) return;
  const shape = cs.Create().Get();
  const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, L_STATIC);
  bcs.mFriction = f32(0.4);
  bcs.mRestitution = f32(0.35);
  bcs.mUserData = 0x7fffffff;
  const body = h.bi.CreateBody(bcs);
  J.destroy(bcs);
  h.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
}
