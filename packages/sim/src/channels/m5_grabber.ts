// GRABBER (stream A5, drive.md, PART_SYSTEM §4.3 `ik_playback`): a desktop robot arm whose links are kinematic bodies
// (upper arm, forearm, gripper) posed every tick from four joint angles (yaw, shoulder, elbow, wrist pitch). A cycle plays
// a fixed list of segments in joint space; each segment's end pose comes from an analytic two-link IK solve for a zone
// (props), and its duration from the largest joint move at 3 rad/s. Progress advances by the supply factor, so a weak
// supply slows the arm (f = 0 freezes it). Everything is plain state in `st.m2.m5.arm`, so a restore just carries on.
//
// The held body stays a normal dynamic body (no layer or motion-type switch, M5 rule 14): every tick its velocity is set
// to reach the jaw centre in one step and its gravity is cancelled, like MAGLOCK's hold.
//
// PARTSIM (beta, D120): the two fingers are their own kinematic bodies (role `piece`, chunks 3 and 4), slid along the
// gripper's ±X every tick from the plain finger opening in the state. Once a body is gripped they close to its width along
// that axis (+1 mm), so they visibly and physically flank it; they open again at the set-down. Zone A is tolerant: when
// its height lies within a grippable body's height at the zone (the "point zone A at the ball" case), the descent goes to
// that body's bottom instead, so the palm meets its top and grips.
//
//   0 idle (parked)   1 to above A   2 descend at A (grips early when a body's top meets the palm)   3 grip dwell
//   4 lift            5 to above B   6 descend at B (the held body's bottom 3 mm over B)              7 release dwell
//   8 shrug (nothing at A: `Jam`, `fault` 1.5 s)   9 lift   10 back to park

import { datan2, dcos, dsin, f32 } from '@knockon/detmath';
import { GRABBER, GRABBER_FINGER, grabberLinks, grabberZone, type PartDef, type ShapeDef } from '@knockon/parts-data';
import { qmul, qrot, vadd, vsub, type Q, type Vec } from '../vec.ts';
import { L_MOVING } from './host.ts';
import { halfOf } from './m3.ts';
import { eachLive } from './m5_field.ts';
import { ARM_STRIDE, type M5Parts } from './m5.ts';

const PH = { idle: 0, toA: 1, downA: 2, grip: 3, liftA: 4, toB: 5, downB: 6, release: 7, shrug: 8, liftB: 9, park: 10 } as const;
/**
 * Offsets into a GRABBER's state. PARTSIM (D120): `fing` the finger opening per side now (m), `fingT` its target while
 * holding (the payload's half-width across the fingers + 1 mm), `za` zone A's surface height for this cycle's descent
 * (part-local m; NO_ZA = the `aHeight` prop).
 */
const K = { ph: 0, u: 1, j: 2, from: 6, body: 10, part: 11, fing: 12, fingT: 13, za: 14 } as const;
const NO_ZA = -9;
/** Zone A tolerance (m): a height this far below a body's bottom or above its top still counts as pointing at it. */
const ZA_TOL = 0.01;
type Joints = [number, number, number, number];
const PARK: Joints = [0, 0, 0, 0];
const SHRUG_S = 1.5;

const qy = (a: number): Q => [0, dsin(a / 2), 0, dcos(a / 2)];
const qx = (a: number): Q => [dsin(a / 2), 0, 0, dcos(a / 2)];
const clamp = (x: number, r: readonly number[]): number => Math.max(r[0]!, Math.min(r[1]!, x));

/** Part-local link frames (origin, rotation) for joints: upper arm (at the shoulder), forearm (elbow), gripper (wrist). */
function frames(j: readonly number[]): { at: Vec; rot: Q }[] {
  const yaw = qy(j[0]!);
  const r1 = qmul(yaw, qx(j[1]!)), r2 = qmul(yaw, qx(j[1]! + j[2]!)), r3 = qmul(yaw, qx(j[1]! + j[2]! + j[3]!));
  const S: Vec = [...GRABBER.shoulder];
  const E = vadd(S, qrot(r1, [0, GRABBER.L1, 0]));
  const W = vadd(E, qrot(r2, [0, GRABBER.L2, 0]));
  return [{ at: S, rot: r1 }, { at: E, rot: r2 }, { at: W, rot: r3 }];
}

/** Joints putting the finger tips at part-local (radial ρ along yaw, height y) with the gripper pointing straight down. */
function ik(yaw: number, rho: number, y: number): Joints {
  const L1 = GRABBER.L1, L2 = GRABBER.L2;
  const dx = rho, dy = y + GRABBER.L3 - GRABBER.shoulder[1];
  const d = Math.max(Math.abs(L1 - L2) + 1e-4, Math.min(L1 + L2 - 1e-4, Math.sqrt(dx * dx + dy * dy)));
  const ce = Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
  const el = datan2(Math.sqrt(1 - ce * ce), ce);
  const sh = datan2(dx, dy) - datan2(L2 * dsin(el), L1 + L2 * dcos(el));
  const s = clamp(sh, GRABBER.limits.sh), e = clamp(el, GRABBER.limits.el);
  return [yaw, s, e, clamp(Math.PI - s - e, GRABBER.limits.wp)];
}

/** The pose over (or at) a zone: tips `up` m above its surface (`surface`: a height overriding the prop's, PARTSIM). */
function zonePose(m: M5Parts, i: number, zone: 'a' | 'b', up: number, surface?: number): Joints {
  const z = grabberZone(m.h.parts[i]!.props, zone);
  return ik(datan2(z[0], z[2]), Math.sqrt(z[0] * z[0] + z[2] * z[2]), (surface ?? z[1]) + up);
}

/** World pose of link frame f, given part-local frames. */
function world(m: M5Parts, i: number, f: { at: Vec; rot: Q }): { at: Vec; rot: Q } {
  const p = m.h.parts[i]!;
  return { at: vadd(p.pos, qrot(p.rot, f.at)), rot: qmul(p.rot, f.rot) };
}

// ---- build / init -------------------------------------------------------------------------------------------------

/** Part-local frames of the two fingers (chunks 3, 4) for a gripper frame and an opening per side. */
function fingerFrames(g: { at: Vec; rot: Q }, open: number): { at: Vec; rot: Q }[] {
  const o = open + GRABBER_FINGER.inset;
  return [-1, 1].map((side) => ({ at: vadd(g.at, qrot(g.rot, [side * o, 0, 0])), rot: g.rot }));
}

/** The three link bodies (kinematic, role 'piece', chunk 0–2) and the two fingers (chunks 3, 4) at the park pose, open. */
export function buildGrabber(m: M5Parts, i: number): void {
  const h = m.h, p = h.parts[i]!;
  const shapes = grabberLinks(p.props), fr = frames(PARK);
  const keys = ['upper', 'fore', 'palm'];
  m.links[i] = fr.map((f, k) => {
    const w = world(m, i, f);
    return m.c.m3.body(i, `grabber:${keys[k]}`, shapes[k]!, w.at, w.rot, 'kinematic', 0.4, 0.6, 0.2, false, k);
  });
  fingerFrames(fr[2]!, (p.props.grip ?? 0.06) / 2).forEach((f, k) => {
    const w = world(m, i, f);
    m.links[i]!.push(m.c.m3.body(i, 'grabber:finger', GRABBER_FINGER.shapes, w.at, w.rot, 'kinematic', 0.05, 0.8, 0.1, false, 3 + k));
  });
}

export function grabberInit(m: M5Parts): void {
  const list = m.c.list('grabber');
  list.forEach((i, s) => {
    m.armSlot[i] = s;
    const open = (m.h.parts[i]!.props.grip ?? 0.06) / 2;
    m.st.arm.push(PH.idle, 0, ...PARK, ...PARK, -1, -1, open, open, NO_ZA);
  });
}

const base = (m: M5Parts, i: number): number => m.armSlot[i]! * ARM_STRIDE;

// ---- stage 2 ------------------------------------------------------------------------------------------------------

/** `go`: one more cycle queued (at most 8). */
export function grabberSignal(m: M5Parts, i: number, port: string, cause: number): boolean {
  if (m.h.parts[i]!.def.type !== 'grabber') return false;
  if (port === 'go') { m.st.n[i] = Math.min(8, m.st.n[i]! + 1); m.st.cause[i] = cause; }
  return true;
}

// ---- stage 6 ------------------------------------------------------------------------------------------------------

/** Held body radius (its def's half-extent), or 0. */
function heldR(m: M5Parts, i: number): number {
  const a = m.st.arm, o = base(m, i), part = a[o + K.part]!, body = a[o + K.body]!;
  if (body < 0) return 0;
  const s = m.c.m3.slotBody.indexOf(body);
  const def = s >= 0 ? m.c.m3.slotDef[s] : m.h.parts[part]!.def;
  return def ? halfOf(def) : 0.02;
}

/** The end pose of the current segment (null for dwells). */
function target(m: M5Parts, i: number, ph: number): Joints | null {
  switch (ph) {
    case PH.toA: case PH.liftA: return zonePose(m, i, 'a', GRABBER.lift);
    case PH.downA: { const za = m.st.arm[base(m, i) + K.za]!; return zonePose(m, i, 'a', 0.01, za > NO_ZA ? za : undefined); }
    case PH.toB: case PH.liftB: return zonePose(m, i, 'b', GRABBER.lift);
    case PH.downB: { const r = heldR(m, i); return zonePose(m, i, 'b', r > 0 ? 2 * r + 0.005 + GRABBER.palm - GRABBER.L3 : 0.01); }
    case PH.park: return [...PARK];
    default: return null;
  }
}

export function grabberBehave(m: M5Parts, i: number): boolean {
  const h = m.h, st = h.st, s5 = m.st, p = h.parts[i]!;
  if (p.def.type !== 'grabber') return false;
  const a = s5.arm, o = base(m, i);
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  let ph = a[o + K.ph]!;
  const next = (to: number): void => {
    a[o + K.ph] = to;
    a[o + K.u] = 0;
    for (let k = 0; k < 4; k++) a[o + K.from + k] = a[o + K.j + k]!;
    ph = to;
  };
  if (ph === PH.idle && f > 0 && (s5.n[i]! > 0 || (p.props.loop ?? 0) === 1)) {
    const queued = s5.n[i]! > 0;
    if (queued) s5.n[i] = s5.n[i]! - 1;
    next(PH.toA);
    h.emit('Trigger', i, h.local(i, [0, 0.09, 0]), 1, queued ? s5.cause[i]! : st.lastEv[i] ?? -1);
  }
  if (ph !== PH.idle && f > 0) {
    const tgt = target(m, i, ph);
    if (tgt) {
      // a joint-space segment, eased (smoothstep), timed by its largest joint move
      let move = 0;
      for (let k = 0; k < 4; k++) move = Math.max(move, Math.abs(tgt[k]! - a[o + K.from + k]!));
      const T = Math.max(0.1, move / GRABBER.speed);
      const u = Math.min(1, a[o + K.u]! + (f * h.dt) / T);
      a[o + K.u] = u;
      const s = u * u * (3 - 2 * u);
      for (let k = 0; k < 4; k++) a[o + K.j + k] = a[o + K.from + k]! + (tgt[k]! - a[o + K.from + k]!) * s;
      if (ph === PH.downA) { if (tryGrip(m, i, u >= 1)) next(PH.grip); else if (u >= 1) shrug(m, i, next); }
      else if (u >= 1) {
        switch (ph) {
          case PH.toA: a[o + K.za] = zoneSurface(m, i); next(PH.downA); break;
          case PH.liftA: next(PH.toB); break;
          case PH.toB: next(PH.downB); break;
          case PH.downB: release(m, i); next(PH.release); break;
          case PH.liftB: next(PH.park); break;
          case PH.park: next(PH.idle); break;
          default:
        }
      }
    } else {
      const dwell = ph === PH.shrug ? SHRUG_S : GRABBER.dwellS;
      a[o + K.u] = Math.min(1, a[o + K.u]! + (f * h.dt) / dwell);
      if (a[o + K.u]! >= 1) {
        if (ph === PH.grip) next(PH.liftA);
        else if (ph === PH.release) next(PH.liftB);
        else next(PH.park);
      }
    }
  }
  fingers(m, i, f);
  pose(m, i);
  carry(m, i);
  return true;
}

/** PARTSIM (D120): the fingers slide toward their goal (the payload's width while holding, else the `grip` opening), × f. */
function fingers(m: M5Parts, i: number, f: number): void {
  const a = m.st.arm, o = base(m, i);
  const goal = a[o + K.body]! >= 0 ? a[o + K.fingT]! : (m.h.parts[i]!.props.grip ?? 0.06) / 2;
  const now = a[o + K.fing]!, step = GRABBER_FINGER.speed * f * m.h.dt;
  if (now !== goal && step > 0) a[o + K.fing] = now < goal ? Math.min(goal, now + step) : Math.max(goal, now - step);
}

/**
 * PARTSIM (D120): zone A's surface for this cycle's descent. If the `aHeight` prop lies within a grippable body's height
 * (± 1 cm) at the zone (centre within the jaw's footprint there, small and light enough: tryGrip's rules), the descent
 * goes to that body's bottom, so the palm meets its top and grips; otherwise the prop (NO_ZA). First match, part order.
 */
function zoneSurface(m: M5Parts, i: number): number {
  const h = m.h, p = h.parts[i]!;
  const z = grabberZone(p.props, 'a'), grip = p.props.grip ?? 0.06;
  const yaw = datan2(z[0], z[2]);
  const ax: Vec = [dcos(yaw), 0, -dsin(yaw)], fw: Vec = [dsin(yaw), 0, dcos(yaw)]; // across the fingers; out along the reach
  const pq: Q = [-p.rot[0]!, -p.rot[1]!, -p.rot[2]!, p.rot[3]!];
  let out = NO_ZA, found = false;
  eachLive(m.c, (pb) => {
    if (found || pb.part === i || pb.half > grip / 2 + 0.002) return;
    const b = h.bodies[pb.body]!.body;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0 || 1 / inv > GRABBER.maxKg) return;
    const c = b.GetCenterOfMassPosition();
    const l = qrot(pq, vsub([c.GetX(), c.GetY(), c.GetZ()], p.pos));
    const dx = l[0] - z[0], dz = l[2] - z[2];
    if (Math.abs(dx * ax[0] + dz * ax[2]) > grip / 2 || Math.abs(dx * fw[0] + dz * fw[2]) > 0.03) return;
    const bb = b.GetWorldSpaceBounds();
    const half = (bb.mMax.GetY() - bb.mMin.GetY()) / 2, bot = l[1] - half, top = l[1] + half;
    if (z[1] < bot - ZA_TOL || z[1] > top + ZA_TOL) return;
    found = true;
    out = z[1] > bot + 0.005 ? bot : NO_ZA; // already at (or under) its bottom: the prop's descent reaches it as it is
  });
  return out;
}

/** Moves the link bodies and fingers to the current joints and opening (MoveKinematic: they push what they touch). */
function pose(m: M5Parts, i: number): void {
  const h = m.h, a = m.st.arm, o = base(m, i);
  const fr = frames([a[o + K.j]!, a[o + K.j + 1]!, a[o + K.j + 2]!, a[o + K.j + 3]!]);
  fr.push(...fingerFrames(fr[2]!, a[o + K.fing]!));
  fr.forEach((f, k) => {
    const w = world(m, i, f);
    m.c.rv.Set(f32(w.at[0]), f32(w.at[1]), f32(w.at[2]));
    m.c.qq.Set(f32(w.rot[0]), f32(w.rot[1]), f32(w.rot[2]), f32(w.rot[3]));
    h.bi.MoveKinematic(h.bodies[m.links[i]![k]!]!.body.GetID(), m.c.rv, m.c.qq, f32(h.dt));
  });
}

/** The gripper's world frame now (from the joints). */
function gripper(m: M5Parts, i: number): { at: Vec; rot: Q } {
  const a = m.st.arm, o = base(m, i);
  return world(m, i, frames([a[o + K.j]!, a[o + K.j + 1]!, a[o + K.j + 2]!, a[o + K.j + 3]!])[2]!);
}

/**
 * Looks for a body between the fingers: centre within the jaw (|x| ≤ grip/2, |z| ≤ 0.03 in the gripper frame, from the
 * palm to 2 cm past the finger tips), small enough for the grip, ≤ 1 kg. It grips once the body's top is within 5 mm of
 * the palm, or at the bottom of the descent (`last`). First match in part order. Returns true if it gripped.
 */
function tryGrip(m: M5Parts, i: number, last: boolean): boolean {
  const h = m.h, st = h.st, p = h.parts[i]!, a = m.st.arm, o = base(m, i);
  const g = gripper(m, i), qi: Q = [-g.rot[0], -g.rot[1], -g.rot[2], g.rot[3]];
  const grip = p.props.grip ?? 0.06;
  let got = -1, gotPart = -1;
  eachLive(m.c, (pb) => {
    if (got >= 0 || pb.part === i || pb.half > grip / 2 + 0.002) return;
    const b = h.bodies[pb.body]!.body;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0 || 1 / inv > GRABBER.maxKg) return;
    const c = b.GetCenterOfMassPosition();
    const l = qrot(qi, vsub([c.GetX(), c.GetY(), c.GetZ()], g.at));
    if (Math.abs(l[0]) > grip / 2 || Math.abs(l[2]) > 0.03 || l[1] < GRABBER.palm || l[1] > GRABBER.L3 + 0.02) return;
    if (!last && l[1] - pb.half > GRABBER.palm + 0.005) return;
    got = pb.body;
    gotPart = pb.part;
  });
  if (got < 0) return false;
  a[o + K.body] = got;
  a[o + K.part] = gotPart;
  a[o + K.fingT] = Math.max(0.002, Math.min(grip / 2, acrossHalf(m, got, gotPart, g) + 0.001));
  const id = h.emit('Attach', i, g.at, 1, st.lastEv[i] ?? -1, gotPart);
  st.lastEv[gotPart] = id;
  return true;
}

/** Support distance of a part's colliders (part-local ShapeDefs, as Machine.shapeFor builds them) along local unit `d`. */
function support(shapes: readonly ShapeDef[], d: Vec): number {
  const h = Math.SQRT1_2;
  let best = -Infinity;
  for (const sh of shapes) {
    let q: Q = [0, 0, 0, 1];
    if (sh.axis === 'x') q = [0, 0, -h, h];
    if (sh.axis === 'z') q = [h, 0, 0, h];
    if (sh.tiltZ) q = qmul([0, 0, dsin((sh.tiltZ * Math.PI) / 360), dcos((sh.tiltZ * Math.PI) / 360)], q);
    if (sh.rot) q = qmul(sh.rot, q);
    const l = qrot([-q[0], -q[1], -q[2], q[3]], d), c = sh.at ?? [0, 0, 0];
    const z = sh.size;
    let r: number;
    if (sh.kind === 'sphere') r = z[0] / 2;
    else if (sh.kind === 'box') r = (Math.abs(l[0]) * z[0] + Math.abs(l[1]) * z[1] + Math.abs(l[2]) * z[2]) / 2;
    else if (sh.kind === 'cylinder') r = (Math.abs(l[1]) * z[1] + Math.sqrt(l[0] * l[0] + l[2] * l[2]) * z[0]) / 2;
    else r = Math.abs(l[1]) * Math.max(0, (z[1] - z[0]) / 2) + z[0] / 2; // capsule
    best = Math.max(best, c[0]! * d[0] + c[1]! * d[1] + c[2]! * d[2] + r);
  }
  return best;
}

/**
 * PARTSIM (D120): a body's half-width across the fingers (the gripper's X), measured from its centre of mass (the jaw
 * holds the COM on the gripper axis): the support of its colliders both ways along that axis (a part's base, or a pool
 * piece's def), so a ball is its radius however it has rolled. Other bodies (a broken part's chunk): its def's bounds box.
 */
function acrossHalf(m: M5Parts, body: number, part: number, g: { at: Vec; rot: Q }): number {
  const h = m.h, rb = h.bodies[body]!, b = rb.body;
  const s = m.c.m3.slotBody.indexOf(body);
  const def: PartDef | null | undefined = s >= 0 ? m.c.m3.slotDef[s] : h.parts[part]!.def;
  if (!def) return 0.02;
  const r = b.GetRotation(), q: Q = [r.GetX(), r.GetY(), r.GetZ(), r.GetW()], qi: Q = [-q[0], -q[1], -q[2], q[3]];
  const x = qrot(qi, qrot(g.rot, [1, 0, 0])); // the finger axis in the body's frame
  const pos = b.GetPosition(), com = b.GetCenterOfMassPosition();
  const cl = qrot(qi, [com.GetX() - pos.GetX(), com.GetY() - pos.GetY(), com.GetZ() - pos.GetZ()]);
  const cx = cl[0] * x[0] + cl[1] * x[1] + cl[2] * x[2];
  let shapes: readonly ShapeDef[];
  if (s >= 0 || rb.role === 'base') shapes = def.shapes(s >= 0 ? {} : h.parts[part]!.props).filter((sh) => !sh.on || sh.on === 'base');
  else {
    const lo = def.bounds.min, hi = def.bounds.max;
    shapes = [{ kind: 'box', size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] }];
  }
  if (!shapes.length) return 0.02;
  return Math.max(support(shapes, x) - cx, support(shapes, [-x[0], -x[1], -x[2]]) + cx);
}

function shrug(m: M5Parts, i: number, next: (to: number) => void): void {
  const h = m.h, st = h.st;
  h.emit('Jam', i, gripper(m, i).at, 0, st.lastEv[i] ?? -1);
  next(PH.shrug);
}

function release(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, a = m.st.arm, o = base(m, i);
  const part = a[o + K.part]!;
  if (a[o + K.body]! < 0) return;
  const b = h.bodies[a[o + K.body]!]!.body;
  h.bi.SetLinearVelocity(b.GetID(), h.v3(0, 0, 0)); // set down, not tossed
  h.bi.SetAngularVelocity(b.GetID(), h.v3(0, 0, 0));
  a[o + K.body] = -1;
  a[o + K.part] = -1;
  const id = h.emit('Release', i, gripper(m, i).at, 0, st.lastEv[i] ?? -1, part);
  st.lastEv[part] = id;
}

/** The held body rides at the jaw centre: velocity to get there this step (≤ 3 m/s), gravity cancelled, spin damped. */
function carry(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, a = m.st.arm, o = base(m, i);
  const body = a[o + K.body]!, part = a[o + K.part]!;
  if (body < 0) return;
  const rb = h.bodies[body]!;
  const s = m.c.m3.slotBody.indexOf(body);
  // gone: out of play, back in its pool, or ghosted at run time (a BUZZ or BANDIT took it): let go without an event
  const gone = !st.alive[part] || h.hiddenBody(part, rb.role) || (s >= 0 && !m.c.m3.live(s)) || rb.body.GetObjectLayer() !== L_MOVING;
  if (gone) { a[o + K.body] = -1; a[o + K.part] = -1; return; }
  const g = gripper(m, i), r = heldR(m, i);
  const jaw = vadd(g.at, qrot(g.rot, [0, GRABBER.palm + r + 0.002, 0]));
  const b = rb.body, c = b.GetCenterOfMassPosition();
  let v = vsub(jaw, [c.GetX(), c.GetY(), c.GetZ()]);
  v = [v[0] / h.dt, v[1] / h.dt, v[2] / h.dt];
  const sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (sp > 3) v = [(v[0] * 3) / sp, (v[1] * 3) / sp, (v[2] * 3) / sp];
  const mp = b.GetMotionProperties(), inv = mp.GetInverseMass();
  if (inv <= 0) return;
  h.bi.SetLinearVelocity(b.GetID(), h.v3(v[0], v[1], v[2]));
  const w = b.GetAngularVelocity();
  m.va.Set(f32(w.GetX() * 0.5), f32(w.GetY() * 0.5), f32(w.GetZ() * 0.5));
  h.bi.SetAngularVelocity(b.GetID(), m.va);
  h.bi.AddForce(b.GetID(), h.v3(0, (m.c.m3.gravity * mp.GetGravityFactor()) / inv, 0), h.Jolt.EActivation_Activate);
}

// ---- outputs ------------------------------------------------------------------------------------------------------

/** Flags: lit while holding something; fault during the shrug. */
export function grabberFlags(m: M5Parts, i: number): number {
  if (m.h.parts[i]!.def.type !== 'grabber') return 0;
  const a = m.st.arm, o = base(m, i);
  return (a[o + K.body]! >= 0 ? 1 : 0) | (a[o + K.ph] === PH.shrug ? 64 : 0);
}

/** 8 floats per GRABBER (part order): [part, yaw, shoulder, elbow, wrist pitch, wrist roll, finger opening per side, held]. */
export function grabberJoints(m: M5Parts): Float32Array {
  const out: number[] = [];
  for (const i of m.c.list('grabber')) {
    const a = m.st.arm, o = base(m, i), held = a[o + K.body]! >= 0;
    out.push(i, a[o + K.j]!, a[o + K.j + 1]!, a[o + K.j + 2]!, a[o + K.j + 3]!, 0, a[o + K.fing]!, held ? 1 : 0); // PARTSIM: the sliding opening
  }
  return Float32Array.from(out);
}
