// GLIDEPATH (frame.md, SIMULATION §4.4; stream A3): a twin chrome rail swept along a link's path. The rails collide
// (static: two ⌀8 mm rails at 14 mm centres on a T-spine, friction 0.10), so a marble dropped mid-track rolls on them.
// A marble (GLINT, BEARING) that arrives at either end rides the rail through loops and banks and leaves at the far
// end (or the near one, if it rolls back): a rail follower holds its centre on the riders' line, 6 mm over the rail
// tops on the rail's inside. Frames are parallel-transported along the path, so the rail's "up" turns with it.
//
// The follower is ours, not a Jolt PathConstraint (the JS bindings can't construct a Hermite path, and a JS path
// would be called from Jolt's solver threads): each tick in stage 6 a rider's velocity is turned onto the path tangent
// at its current speed along the path, plus a small correction back onto the line, and the step's gravity across the
// path is cancelled (the rail carries it). Gravity along the path, boosters and collisions act on it in Jolt as usual;
// the follower keeps their along-path part (u = v · the tangent it was given last tick). While it rides, a marble
// doesn't collide with rails (a collision group): speculative contacts with the rail segments' ends would brake it.
// Its state (rail, arc length, tangent) lives in `st.m2.m3`, so rollback covers it and nothing is created mid-run;
// the collision groups (not in Jolt's saved state) are re-applied from it after a restore.

import { f32 } from '@knockon/detmath';
import { posToMetres, type LinkRecord } from '@knockon/format';
import { GLIDEPATH, qBasis } from '@knockon/parts-data';
import type { JoltModule } from '@knockon/jolt';
import { roundPath, vadd, vcross, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { L_STATIC, bodyPos, bodyVel } from './host.ts';
import type { PartChannels } from './index.ts';

/** Riders' line resolution: the rounded path resampled to ≤ 1 cm steps. */
const STEP = 0.01;
/** Correction back onto the line: 1/s, at most 0.5 m/s. */
const PULL = 30, PULL_MAX = 0.5;

interface Rail {
  /** Riders' line points, arc lengths, unit tangents (increasing s). */
  readonly p: readonly Vec[];
  readonly s: readonly number[];
  readonly t: readonly Vec[];
  /** Unit "up" (the rail's inside) per point. */
  readonly u: readonly Vec[];
  readonly length: number;
}

export class Glidepaths {
  readonly rails: Rail[] = [];
  /** Rails (subgroup 0) and riding marbles (subgroup 1) of group 1 don't collide. */
  private filter: JoltModule = null;
  private riderGroup: JoltModule = null;
  private freeGroup: JoltModule = null;
  /** Rider slot → marble part index (GLINT, BEARING), part order. */
  readonly riders: number[] = [];
  readonly c: PartChannels;
  constructor(c: PartChannels) { this.c = c; }

  /** Builds a GLIDEPATH link: the rail collider and its riders' line. */
  build(l: LinkRecord): void {
    const c = this.c, h = c.h, J = h.Jolt;
    const pts = roundPath(l.points.map((q) => q.map(posToMetres) as Vec), GLIDEPATH.bend, 12);
    if (pts.length < 2) return;
    c.m3.active = true;
    // resample to ≤ 1 cm, then tangents (central differences) and parallel-transported up vectors
    const fine: Vec[] = [pts[0]!];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!, b = pts[k]!, len = vlen(vsub(b, a));
      if (len < 1e-5) continue;
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let i = 1; i <= n; i++) fine.push(vadd(a, vscale(vsub(b, a), i / n)));
    }
    const n = fine.length;
    if (n < 2) return;
    const tan: Vec[] = fine.map((_, k) => vnorm(vsub(fine[Math.min(n - 1, k + 1)]!, fine[Math.max(0, k - 1)]!)));
    const ups: Vec[] = [];
    let up = vsub([0, 1, 0], vscale(tan[0]!, tan[0]![1]));
    if (vlen(up) < 1e-3) up = vsub([1, 0, 0], vscale(tan[0]!, tan[0]![0]));
    up = vnorm(up);
    for (let k = 0; k < n; k++) {
      if (k > 0) { const t = tan[k]!; up = vnorm(vsub(up, vscale(t, vdot(up, t)))); }
      ups.push(up);
    }
    // rails and spine along the rounded path's segments (the colliders), using the fine frames at their ends
    const cs = new J.StaticCompoundShapeSettings();
    let count = 0;
    const add = (at: Vec, x: Vec, y: Vec, z: Vec, settings: JoltModule): void => {
      const q = qBasis(x, y, z);
      cs.AddShape(new J.Vec3(f32(at[0]), f32(at[1]), f32(at[2])), new J.Quat(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3])), settings, count++);
    };
    const seg = Math.max(1, Math.round(0.02 / STEP)); // collider segments of ~2 cm (a chord sags ≤ 0.5 mm on the 0.1 m bends)
    for (let k = seg; k < n + seg - 1; k += seg) {
      const k1 = Math.min(n - 1, k), k0 = k - seg;
      const a = fine[k0]!, b = fine[k1]!;
      const d = vsub(b, a), len = vlen(d);
      if (len < 1e-4) continue;
      const t = vscale(d, 1 / len);
      const u0 = vnorm(vadd(ups[k0]!, ups[k1]!));
      const u = vnorm(vsub(u0, vscale(t, vdot(u0, t))));
      const side = vnorm(vcross(t, u));
      const mid = vscale(vadd(a, b), 0.5);
      for (const s of [-1, 1]) {
        const at = vadd(vadd(mid, vscale(side, s * GLIDEPATH.gauge)), vscale(u, -GLIDEPATH.rail));
        add(at, side, t, vcross(side, t), new J.CapsuleShapeSettings(f32(len / 2), f32(GLIDEPATH.rail)));
      }
      const sp = vadd(mid, vscale(u, -GLIDEPATH.rail - GLIDEPATH.spineH / 2));
      add(sp, side, u, vcross(side, u), new J.BoxShapeSettings(new J.Vec3(f32(GLIDEPATH.spineW / 2), f32(GLIDEPATH.spineH / 2), f32(len / 2)), f32(0.001)));
    }
    if (count) {
      const shape = cs.Create().Get();
      const bcs = new J.BodyCreationSettings(shape, new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, L_STATIC);
      bcs.mFriction = f32(0.1);
      bcs.mRestitution = f32(0.3);
      bcs.mUserData = 0x7fffffff;
      if (!this.filter) {
        this.filter = new J.GroupFilterTable(2);
        this.filter.DisableCollision(0, 1);
        this.riderGroup = new J.CollisionGroup(this.filter, 1, 1);
        this.freeGroup = new J.CollisionGroup();
      }
      bcs.mCollisionGroup = new J.CollisionGroup(this.filter, 1, 0);
      const body = h.bi.CreateBody(bcs);
      J.destroy(bcs);
      h.bi.AddBody(body.GetID(), J.EActivation_DontActivate);
    }
    // the riders' line
    const p = fine.map((q, k) => vadd(q, vscale(ups[k]!, GLIDEPATH.ride)));
    const s: number[] = [0];
    for (let k = 1; k < n; k++) s.push(s[k - 1]! + vlen(vsub(p[k]!, p[k - 1]!)));
    this.rails.push({ p, s, t: tan, u: ups, length: s[n - 1]! });
    // rider slots: every marble in the machine, once
    if (!this.riders.length) {
      const m3 = h.st.m2.m3;
      for (const k of [...c.list('glint'), ...c.list('bearing')].sort((x, y) => x - y)) {
        this.riders.push(k);
        m3.ride.push(0); m3.rideS.push(0); m3.rideT.push(0, 0, 0); m3.rideCd.push(0);
      }
    }
  }

  /** Is part `k` riding a rail now? (the marbles' contact spin leaves riders to the follower) */
  riding(k: number): boolean {
    const ri = this.riders.indexOf(k);
    return ri >= 0 && this.c.h.st.m2.m3.ride[ri]! > 0;
  }

  /** The riders' line at arc length s: point, unit tangent and up (linear between samples). */
  private at(r: Rail, s: number): { p: Vec; t: Vec; u: Vec } {
    const n = r.p.length;
    let lo = 0, hi = n - 1;
    const x = Math.max(0, Math.min(r.length, s));
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.s[mid]! <= x) lo = mid; else hi = mid; }
    const span = r.s[hi]! - r.s[lo]!;
    const f = span > 1e-9 ? (x - r.s[lo]!) / span : 0;
    return { p: vadd(r.p[lo]!, vscale(vsub(r.p[hi]!, r.p[lo]!), f)), t: vnorm(vadd(vscale(r.t[lo]!, 1 - f), vscale(r.t[hi]!, f))), u: vnorm(vadd(vscale(r.u[lo]!, 1 - f), vscale(r.u[hi]!, f))) };
  }

  /** Arc length of the closest point to `q` within ±0.15 m of `hint`. */
  private closest(r: Rail, q: Vec, hint: number): number {
    const n = r.p.length;
    let best = hint, bestD = Infinity;
    for (let k = 1; k < n; k++) {
      if (r.s[k]! < hint - 0.15 || r.s[k - 1]! > hint + 0.15) continue;
      const a = r.p[k - 1]!, b = r.p[k]!, ab = vsub(b, a), l2 = vdot(ab, ab);
      const f = l2 > 1e-12 ? Math.max(0, Math.min(1, vdot(vsub(q, a), ab) / l2)) : 0;
      const d = vlen(vsub(q, vadd(a, vscale(ab, f))));
      if (d < bestD) { bestD = d; best = r.s[k - 1]! + f * (r.s[k]! - r.s[k - 1]!); }
    }
    return best;
  }

  /**
   * Stage 6 (end): riders follow their rail (or leave it past an end, `RailOff`); marbles near an end of a rail, not
   * moving away from it, join it (`RailOn`, mag = rail index), snapped onto the end of the riders' line.
   */
  update(): void {
    if (!this.riders.length || !this.rails.length) return;
    const c = this.c, h = c.h, st = h.st, m3 = st.m2.m3;
    this.riders.forEach((k, ri) => {
      const b = h.bodies[h.parts[k]!.base]!.body;
      const ride = m3.ride[ri]!;
      if (ride > 0) {
        const rail = this.rails[ride - 1]!;
        const alive = st.alive[k]! && !c.isHeld(k);
        const pos = bodyPos(b), v = bodyVel(b);
        const tPrev: Vec = [m3.rideT[ri * 3]!, m3.rideT[ri * 3 + 1]!, m3.rideT[ri * 3 + 2]!];
        const u = vdot(v, tPrev);
        const s = this.closest(rail, pos, m3.rideS[ri]!);
        if (!alive || (s <= 1e-6 && u < 0) || (s >= rail.length - 1e-6 && u > 0)) {
          m3.ride[ri] = 0;
          this.group(k, false);
          m3.rideCd[ri] = st.tick + Math.round(0.3 * h.tickRate);
          if (alive) h.emit('RailOff', k, pos, ride - 1, st.lastEv[k] ?? -1);
          return;
        }
        const { p, t, u: up } = this.at(rail, s);
        let pull = vsub(p, pos);
        pull = vsub(pull, vscale(t, vdot(pull, t)));
        const pl = vlen(pull) * PULL;
        const corr = pl > PULL_MAX ? vscale(pull, PULL_MAX / vlen(pull)) : vscale(pull, PULL);
        // the step's gravity across the path is cancelled ahead (the rail carries it), so the rider stays on its line
        const g: Vec = [0, -c.m3.gravity, 0];
        const gPerp = vsub(g, vscale(t, vdot(g, t)));
        const nv = vsub(vadd(vscale(t, u), corr), vscale(gPerp, h.dt));
        h.bi.SetLinearVelocity(b.GetID(), h.v3(nv[0], nv[1], nv[2]));
        const w = vscale(vcross(up, nv), 1 / 0.008); // it rolls along the rails (visual: the spin doesn't move it)
        h.bi.SetAngularVelocity(b.GetID(), h.v3(w[0], w[1], w[2]));
        h.bi.ActivateBody(b.GetID());
        m3.rideS[ri] = s;
        m3.rideT[ri * 3] = t[0]; m3.rideT[ri * 3 + 1] = t[1]; m3.rideT[ri * 3 + 2] = t[2];
        return;
      }
      if (!st.alive[k] || st.tick < m3.rideCd[ri]! || c.isHeld(k)) return;
      const pos = bodyPos(b), v = bodyVel(b);
      for (let r = 0; r < this.rails.length; r++) {
        const rail = this.rails[r]!;
        const n = rail.p.length;
        let joined = false;
        for (const [end, s, inward] of [[rail.p[0]!, 0, rail.t[0]!], [rail.p[n - 1]!, rail.length, vscale(rail.t[n - 1]!, -1)]] as const) {
          if (vlen(vsub(pos, end)) > GLIDEPATH.capture || vdot(v, inward) < -0.05) continue;
          c.rv.Set(f32(end[0]), f32(end[1]), f32(end[2]));
          h.bi.SetPosition(b.GetID(), c.rv, h.Jolt.EActivation_Activate);
          const t = rail.t[s === 0 ? 0 : n - 1]!;
          const nv = vscale(t, vdot(v, t));
          h.bi.SetLinearVelocity(b.GetID(), h.v3(nv[0], nv[1], nv[2]));
          m3.ride[ri] = r + 1;
          this.group(k, true);
          m3.rideS[ri] = s;
          m3.rideT[ri * 3] = t[0]; m3.rideT[ri * 3 + 1] = t[1]; m3.rideT[ri * 3 + 2] = t[2];
          h.emit('RailOn', k, end, r, st.lastEv[k] ?? -1);
          joined = true;
          break;
        }
        if (joined) break;
      }
    });
  }

  /** A marble's collision group: riding (no rail contacts) or free. */
  private group(k: number, riding: boolean): void {
    const h = this.c.h;
    if (!this.filter) return;
    h.bi.SetCollisionGroup(h.bodies[h.parts[k]!.base]!.body.GetID(), riding ? this.riderGroup : this.freeGroup);
  }

  /** After a restore: collision groups follow the ride flags (Jolt's saved state doesn't hold them). */
  afterRestore(): void {
    const m3 = this.c.h.st.m2.m3;
    this.riders.forEach((k, ri) => this.group(k, m3.ride[ri]! > 0));
  }
}
