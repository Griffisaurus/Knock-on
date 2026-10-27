// M5 fields (stream A5): GRAV WELL, TRACTOR BEAM, COILGUN RING, STASIS FIELD and the SINGULARITY's pull (SIMULATION §5.12).
// They run at the end of stage 6, after the M3 fields (MAGLOCK, ZONE), in part order by type, and act on rigid bodies
// only (D102) through `eachLive` (A3's `eachPushable` minus run-time ghosts): never a dormant, hidden, carried, ghost or
// kinematic body (rule 8). STASIS runs last so
// a frozen body cancels whatever the other fields put on it this tick.

import { COILGUN, GRAV_WELL, SINGULARITY, STASIS, TRACTOR, type PartDef } from '@knockon/parts-data';
import { qrot, vadd, vdot, vlen, vscale, vsub, type Vec } from '../vec.ts';
import { L_MOVING, bodyVel } from './host.ts';
import { toLocal } from './devices.ts';
import { eachPushable, type Pushable } from './m3.ts';
import type { PartChannels } from './index.ts';
import type { M5Parts } from './m5.ts';

export function fields(m: M5Parts): void {
  const c = m.c;
  for (const i of c.list('grav_well')) gravWell(m, i);
  for (const i of c.list('singularity')) singularityPull(m, i);
  for (const i of c.list('tractor_beam')) tractor(m, i);
  for (const i of c.list('coilgun_ring')) coilgun(m, i);
  for (const i of c.list('stasis_field')) stasis(m, i);
}

/**
 * A3's `eachPushable`, minus bodies on the ghost layer right now: a BUZZ's or BANDIT's carried item (ghosted by the
 * critter system at run time, so the body record's static `ghost` flag doesn't show it). Every M5 field, transit, grip
 * and pad check goes through this, so a hidden body is never pushed or moved (rule 8; B5's request).
 */
export function eachLive(c: PartChannels, fn: (p: Pushable) => void): void {
  eachPushable(c, (pb) => { if (c.h.bodies[pb.body]!.body.GetObjectLayer() === L_MOVING) fn(pb); });
}

export const steel = (def: PartDef | null): boolean => !!def && (def.body.magnetic === true || def.body.material === 'steel');

const com = (b: { GetCenterOfMassPosition(): { GetX(): number; GetY(): number; GetZ(): number } }): Vec => {
  const p = b.GetCenterOfMassPosition();
  return [p.GetX(), p.GetY(), p.GetZ()];
};

/** Sorted insert-free set helpers on ascending number arrays (body indices). */
const has = (list: readonly number[], x: number): boolean => list.includes(x);

/**
 * A radial pull (s > 0) or push (s < 0) from `core`: a = |s| / max(r, minR)², at most `maxA`, on every pushable body
 * within R. `swirl` damps the velocity across the radius (the SINGULARITY's bodies spiral in instead of orbiting).
 * A sleeping body is woken only if the field gives it at least 5 % of g. Returns nothing; bodies take `cause`.
 */
function radial(m: M5Parts, i: number, core: Vec, s: number, R: number, minR: number, maxA: number, swirl: number, cause: number, causeAt: number): void {
  const h = m.h, st = h.st, J = h.Jolt, g = m.c.m3.gravity;
  eachLive(m.c, (pb) => {
    if (pb.part === i) return;
    const b = h.bodies[pb.body]!.body;
    const at = com(b);
    const d = vsub(core, at), r = vlen(d);
    if (r > R || r < 1e-6) return;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0) return;
    const a = Math.min(Math.abs(s) / (Math.max(r, minR) * Math.max(r, minR)), maxA);
    if (!b.IsActive() && a < 0.05 * g) return;
    const mass = 1 / inv, dir = vscale(d, (s >= 0 ? 1 : -1) / r);
    let F = vscale(dir, mass * a);
    if (swirl > 0) {
      const v = bodyVel(b), u = vscale(d, 1 / r);
      const across = vsub(v, vscale(u, vdot(v, u)));
      F = vsub(F, vscale(across, swirl * mass));
    }
    h.bi.AddForce(b.GetID(), h.v3(F[0], F[1], F[2]), J.EActivation_Activate);
    if (a >= causeAt) st.lastEv[pb.part] = cause;
  });
}

// ---- GRAV WELL ----------------------------------------------------------------------------------------------------

/** GRAV WELL, powered: F = s·f·m / max(r, 0.2)² toward the orb (Attract) or away (Repel), within 5 m, ≤ 40 m/s². */
function gravWell(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, p = h.parts[i]!;
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  m.st.on[i] = f > 0 ? 1 : 0;
  if (f <= 0) return;
  const sign = (p.props.mode ?? 0) === 1 ? -1 : 1;
  radial(m, i, h.local(i, GRAV_WELL.core), sign * GRAV_WELL.s * f, GRAV_WELL.radius, GRAV_WELL.minR, GRAV_WELL.maxAccel, 0, st.lastEv[i] ?? -1, 0.5);
}

// ---- SINGULARITY (pull; its clock and despawns are in m5_misc.ts) -------------------------------------------------

/**
 * SINGULARITY, while active (6 s from its arm Signal): a Grav Well with s = 40 (ramping up over the first 0.5 s), radius
 * 20 m, ≤ 60 m/s², with swirl damping. It pulls live critters' capsules too (they're spat out at the core, m5_misc.ts);
 * never a ragdolling critter (its capsule is a ghost then). Its own part is static: immune to its pull.
 */
function singularityPull(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st;
  if (!st.alive[i] || s5.on[i] !== 1) return;
  const ramp = Math.min(1, (st.tick - s5.t0[i]!) / Math.max(1, Math.round(SINGULARITY.spinS * h.tickRate)));
  const core = h.local(i, SINGULARITY.core), S = SINGULARITY.s * ramp;
  radial(m, i, core, S, SINGULARITY.radius, 0.2, SINGULARITY.maxAccel, SINGULARITY.swirl, s5.cause[i]!, 0);
  for (let k = 0; k < h.parts.length; k++) {
    const q = h.parts[k]!;
    if (!q.def.critter || !st.alive[k] || q.base < 0) continue;
    const rb = h.bodies[q.base]!;
    if (!rb.dynamic || rb.body.GetObjectLayer() !== L_MOVING) continue;
    const b = rb.body, at = com(b);
    const d = vsub(core, at), r = vlen(d);
    if (r > SINGULARITY.radius || r < 1e-6) continue;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0) continue;
    const a = Math.min(S / (Math.max(r, 0.2) * Math.max(r, 0.2)), SINGULARITY.maxAccel);
    const F = vscale(d, a / inv / r);
    h.bi.AddForce(b.GetID(), h.v3(F[0], F[1], F[2]), h.Jolt.EActivation_Activate);
  }
}

// ---- TRACTOR BEAM -------------------------------------------------------------------------------------------------

/**
 * TRACTOR BEAM, powered: bodies whose centre is inside the beam (a cone from the lens along +Z: radius 0.06 m at the lens,
 * 0.09 m at 3 m, plus up to 0.05 m of the body's own size), up to `range` m out, are captured in part order until the
 * load reaches 2 kg × f (the rest feel nothing: strain). Each captured body is servoed to its target (a spring-damper:
 * acceleration = 10·(v_target − v), v_target = 4/s × the offset, capped at 0.5 m/s along the beam in Pull and 1 m/s in
 * Hold, 1 m/s across it; ≤ 30 m/s²) with its gravity cancelled. Pull's target is the lens (the body stops 3 cm short);
 * Hold's is `hold` m along the beam.
 */
function tractor(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st, p = h.parts[i]!, J = h.Jolt, g = m.c.m3.gravity;
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  const now: number[] = [];
  let load = 0, strain = false;
  if (f > 0) {
    const lens = h.local(i, TRACTOR.lens), axis = qrot(p.rot, [0, 0, 1]);
    const range = p.props.range ?? 1.5, hold = (p.props.mode ?? 0) === 1;
    const holdAt = Math.min(p.props.hold ?? 0.5, range), maxLoad = TRACTOR.maxLoad * f;
    eachLive(m.c, (pb) => {
      if (pb.part === i) return;
      const b = h.bodies[pb.body]!.body;
      const at = com(b), rel = vsub(at, lens), d = vdot(rel, axis);
      if (d < 0 || d > range) return;
      const perp = vsub(rel, vscale(axis, d));
      if (vlen(perp) > TRACTOR.r0 + ((TRACTOR.r3 - TRACTOR.r0) * d) / 3 + Math.min(pb.half, 0.05)) return;
      if (shadowed(m, i, lens, at, pb.part)) return; // PARTSIM (D121): behind something in the cone, the beam can't reach it
      const inv = b.GetMotionProperties().GetInverseMass();
      if (inv <= 0) return;
      const mass = 1 / inv;
      if (load + mass > maxLoad + 1e-9) { strain = true; return; }
      load += mass;
      now.push(pb.body);
      const near = pb.half + TRACTOR.dock;
      const goal = hold ? Math.max(holdAt, near) : near, cap = hold ? TRACTOR.holdSpeed : TRACTOR.pull;
      const vAx = Math.max(-cap, Math.min(cap, TRACTOR.kPos * (goal - d)));
      let vPerp = vscale(perp, -TRACTOR.kPos);
      const lp = vlen(vPerp);
      if (lp > 1) vPerp = vscale(vPerp, 1 / lp);
      const target = vadd(vscale(axis, vAx), vPerp);
      let a = vscale(vsub(target, bodyVel(b)), TRACTOR.kVel);
      const la = vlen(a);
      if (la > TRACTOR.maxAccel) a = vscale(a, TRACTOR.maxAccel / la);
      const gf = b.GetMotionProperties().GetGravityFactor();
      h.bi.AddForce(b.GetID(), h.v3(mass * a[0], mass * (a[1] + g * gf), mass * a[2]), J.EActivation_Activate);
      st.lastEv[pb.part] = st.lastEv[i] ?? -1;
    });
  }
  track(m, i, now, 'Attach', 'Release', h.local(i, TRACTOR.lens));
  s5.val2[i] = load;
  s5.aux[i] = strain ? 1 : 0;
}

/**
 * PARTSIM (D121): TRACTOR BEAM occlusion. One closest-hit ray through Jolt's narrow phase from the lens to the body's
 * centre of mass (the beam's own body skipped; ghosts never block): the body is shadowed when the first thing the ray
 * meets belongs to another part, a critter or the set. Bodies are tested in `eachLive` order (part order), so the ray
 * casts run in canonical order on every peer. A ray that meets nothing (the lens inside the body) counts as clear.
 */
function shadowed(m: M5Parts, i: number, lens: Vec, at: Vec, part: number): boolean {
  const h = m.h, d = vsub(at, lens), len = vlen(d);
  if (len < 1e-4) return false;
  const hit = m.c.rays().cast(lens, vscale(d, 1 / len), len, [h.parts[i]!.base]);
  if (!hit) return false;
  const hb = hit.body >= 0 ? h.bodies[hit.body] : undefined;
  return !hb || hb.part !== part;
}

/** Updates part `i`'s inside list to `now` (ascending), emitting `enter` / `leave` for the changes (other = the body's part). */
function track(m: M5Parts, i: number, now: number[], enter: 'Attach' | 'Freeze' | null, leave: 'Release' | null, pos: Vec): void {
  const h = m.h, st = h.st, s5 = m.st;
  now.sort((a, b) => a - b);
  const was = s5.inside[i]!;
  if (leave) for (const k of was) if (!has(now, k)) h.emit(leave, i, pos, 0, st.lastEv[i] ?? -1, h.bodies[k]!.part);
  if (enter) for (const k of now) if (!has(was, k)) { const id = h.emit(enter, i, com(h.bodies[k]!.body), 1, st.lastEv[i] ?? -1, h.bodies[k]!.part); st.lastEv[h.bodies[k]!.part] = id; }
  s5.inside[i] = now;
}

// ---- COILGUN RING -------------------------------------------------------------------------------------------------

/**
 * COILGUN RING: its charge fills over 0.5 s at full supply (× f; `Charged` when full). A body whose centre is in the
 * bore (a cylinder r 0.075 × 0.10 along the ring's axis), or crossed its mid-plane inside that radius during the last
 * step, is on a pass; at the start of a pass a steel body (magnetic or steel material) gets Δv = +3 m/s along the boost
 * direction if the ring is charged and powered (`Boost`, mag 3, other = it), and the charge empties. Any other pass is
 * a dud (`Boost`, mag 0): non-steel bodies, or steel while it recharges.
 */
function coilgun(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st, p = h.parts[i]!;
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  if (f > 0 && s5.val[i]! < 1) {
    s5.val[i] = Math.min(1, s5.val[i]! + f / (COILGUN.rechargeS * h.tickRate));
    if (s5.val[i] === 1) h.emit('Charged', i, h.local(i, COILGUN.centre), 1, st.lastEv[i] ?? -1);
  }
  const C = COILGUN.centre, R2 = COILGUN.bore * COILGUN.bore;
  const axis = qrot(p.rot, [0, 0, (p.props.direction ?? 0) === 1 ? -1 : 1]);
  const was = s5.inside[i]!, now: number[] = [];
  const inBore = (l: Vec): boolean => Math.abs(l[2]) <= COILGUN.half && l[0] * l[0] + l[1] * l[1] <= R2;
  eachLive(m.c, (pb: Pushable) => {
    if (pb.part === i || !st.alive[i]) return;
    const b = h.bodies[pb.body]!.body;
    const at = com(b), v = bodyVel(b);
    const l = vsub(toLocal(m.c, i, at), C), l0 = vsub(toLocal(m.c, i, vsub(at, vscale(v, h.dt))), C);
    let on = inBore(l);
    if (!on && l[2] * l0[2] < 0) { // crossed the mid-plane within the step: where?
      const t = l0[2] / (l0[2] - l[2]);
      const x = l0[0] + (l[0] - l0[0]) * t, y = l0[1] + (l[1] - l0[1]) * t;
      on = x * x + y * y <= R2;
    }
    if (!on) return;
    now.push(pb.body);
    if (has(was, pb.body)) return; // still on the same pass
    const inv = b.GetMotionProperties().GetInverseMass();
    if (steel(pb.def) && f > 0 && s5.val[i]! >= 1 && inv > 0) {
      const J = COILGUN.dv / inv;
      h.bi.AddImpulse(b.GetID(), h.v3(axis[0] * J, axis[1] * J, axis[2] * J));
      h.bi.ActivateBody(b.GetID());
      s5.val[i] = 0;
      st.pressed[i] = Math.round(0.12 * h.tickRate);
      const id = h.emit('Boost', i, at, COILGUN.dv, st.lastEv[pb.part] ?? -1, pb.part);
      st.lastEv[pb.part] = id;
    } else h.emit('Boost', i, at, 0, st.lastEv[pb.part] ?? -1, pb.part);
  });
  now.sort((a, b) => a - b);
  s5.inside[i] = now;
}

// ---- STASIS FIELD -------------------------------------------------------------------------------------------------

/**
 * STASIS FIELD at supply ≥ 0.75 (`Engage` mag 1; mag 0 on release): every pushable body whose centre is inside the
 * volume is frozen, ZONE's way (D103): its forces and torques this tick are dropped, its velocity zeroed and its gravity
 * cancelled, every tick. It never changes motion type, so there's nothing to re-derive after a restore. A body that
 * enters while engaged gets `Freeze` (other = it). On release every frozen body is woken, so sleepers fall.
 */
function stasis(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st, p = h.parts[i]!, J = h.Jolt, g = m.c.m3.gravity;
  const engaged = st.alive[i]! && Math.min(1, st.supply[i]!) >= STASIS.needF;
  const centre = h.local(i, [0, (p.props.height ?? 0.5) / 2, 0]);
  if (engaged !== (s5.on[i] === 1)) {
    s5.on[i] = engaged ? 1 : 0;
    s5.cause[i] = h.emit('Engage', i, centre, engaged ? 1 : 0, st.lastEv[i] ?? -1);
    if (!engaged) {
      for (const k of s5.inside[i]!) {
        const rb = h.bodies[k]!;
        if (st.alive[rb.part] && !h.hiddenBody(rb.part, rb.role)) h.bi.ActivateBody(rb.body.GetID());
      }
    }
  }
  if (!engaged) { s5.inside[i] = []; return; }
  const hw = (p.props.width ?? 0.5) / 2, H = p.props.height ?? 0.5, hd = (p.props.depth ?? 0.5) / 2;
  const now: number[] = [];
  eachLive(m.c, (pb) => {
    if (pb.part === i) return;
    const b = h.bodies[pb.body]!.body;
    const l = toLocal(m.c, i, com(b));
    if (Math.abs(l[0]) > hw || l[1] < 0 || l[1] > H || Math.abs(l[2]) > hd) return;
    now.push(pb.body);
    if (!b.IsActive()) return; // asleep, it already stays put
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0) return;
    b.ResetForce();
    b.ResetTorque();
    h.bi.SetLinearVelocity(b.GetID(), h.v3(0, 0, 0));
    h.bi.SetAngularVelocity(b.GetID(), h.v3(0, 0, 0));
    h.bi.AddForce(b.GetID(), h.v3(0, (g * b.GetMotionProperties().GetGravityFactor()) / inv, 0), J.EActivation_DontActivate);
  });
  track(m, i, now, 'Freeze', null, centre);
}

// ---- flags and meters ---------------------------------------------------------------------------------------------

/** Flags: GRAV WELL lit while its field is on; TRACTOR BEAM lit while it carries something, fault on strain; COILGUN lit while charged; STASIS lit while engaged. */
export function fieldFlags(m: M5Parts, i: number): number {
  const s5 = m.st, st = m.h.st;
  switch (m.h.parts[i]!.def.type) {
    case 'grav_well': return s5.on[i] ? 1 : 0;
    case 'tractor_beam': return (s5.inside[i]!.length ? 1 : 0) | (s5.aux[i] ? 64 : 0);
    case 'coilgun_ring': return s5.val[i]! >= 1 && st.supply[i]! > 0 ? 1 : 0;
    case 'stasis_field': return s5.on[i] ? 1 : 0;
    default: return 0;
  }
}

/** Meters (1–21, like CELL): COILGUN RING charge, TRACTOR BEAM load against its 2 kg. */
export function fieldMeter(m: M5Parts, i: number): number {
  const s5 = m.st, st = m.h.st;
  switch (m.h.parts[i]!.def.type) {
    case 'coilgun_ring': return st.supply[i]! > 0 ? 1 + Math.round(20 * s5.val[i]!) : 0;
    case 'tractor_beam': return st.supply[i]! > 0 ? 1 + Math.round((20 * Math.min(TRACTOR.maxLoad, s5.val2[i]!)) / TRACTOR.maxLoad) : 0;
    default: return 0;
  }
}
