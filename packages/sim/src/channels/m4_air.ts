// M4 air parts (stream A4, SIMULATION §5.8): BLOWOUT (a 2 m / 10° wind cone that is also a heat cone once warm), VAC (a
// 1.5 m / 20° inverted cone that holds light things on its mouth) and INFLATOR (a valve that fills the HELIO seated on
// its nozzle; over-filling pops it).

import { dcos, dsin, f32 } from '@knockon/detmath';
import { BLOWOUT, INFLATOR, VAC } from '@knockon/parts-data';
import { qrot, vadd, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { bodyRot } from './host.ts';
import { areaOf, eachPushable } from './m3.ts';
import type { M4Parts } from './m4.ts';

const RAD = Math.PI / 180;
/** Accelerations a cone may give a body (m/s²), as the M3 fields cap them, so a 5 g marble isn't fired across the room. */
const MAX_AIR_ACCEL = 40;

// ---- build: INFLATOR seats -----------------------------------------------------------------------------------------

/**
 * Pairs each INFLATOR with the HELIO on its `fill` port (PART_SYSTEM §3): a `fill` link when the format has the kind,
 * else the HELIO whose knot sits within 0.06 m of the filler nozzle at the start (part order; one each). The knot is held
 * on the nozzle by a pre-built distance constraint (built with the world, in part order), and the HELIO starts empty.
 */
export function buildSeats(m: M4Parts): void {
  const h = m.c.h, J = h.Jolt;
  const helios = m.c.h.parts.map((p, k) => (p.def.type === 'helio' ? k : -1)).filter((k) => k >= 0);
  const knot = (k: number): Vec => h.local(k, h.parts[k]!.def.ports[0]!.at);
  for (const i of m.c.list('inflator')) {
    let seat = -1;
    for (const l of h.links) {
      if ((l.kind as string) !== 'fill' || !l.from || !l.to) continue;
      const a = h.byId.get(l.from.part), b2 = h.byId.get(l.to.part);
      if (a === i && b2 !== undefined && h.parts[b2]!.def.type === 'helio') seat = b2;
      if (b2 === i && a !== undefined && h.parts[a]!.def.type === 'helio') seat = a;
      if (seat >= 0) break;
    }
    if (seat < 0) {
      const nz = h.local(i, INFLATOR.nozzle);
      for (const k of helios) if (m.seatedOn[k]! < 0 && vlen(vsub(knot(k), nz)) <= INFLATOR.seat) { seat = k; break; }
    }
    if (seat < 0 || m.seatedOn[seat]! >= 0) continue;
    m.seatOf[i] = seat;
    m.seatedOn[seat] = i;
    const s = new J.DistanceConstraintSettings();
    const a = h.local(i, INFLATOR.nozzle), b2 = knot(seat);
    s.mPoint1 = new J.RVec3(f32(a[0]), f32(a[1]), f32(a[2]));
    s.mPoint2 = new J.RVec3(f32(b2[0]), f32(b2[1]), f32(b2[2]));
    s.mMinDistance = f32(0);
    s.mMaxDistance = f32(0.01);
    const c = s.Create(h.bodies[h.parts[i]!.base]!.body, h.bodies[h.parts[seat]!.base]!.body);
    J.destroy(s);
    h.system.AddConstraint(c);
    m.seatC[i] = c;
    m.st.aux[i] = 1; // seated
  }
}

/** A seated HELIO's inflation (0–1.1), for `sk_inflate`; 0 for any other part. */
export function inflatorSeated(m: M4Parts, k: number): number {
  const i = m.seatedOn[k] ?? -1;
  return i >= 0 ? (m.st.n[i]! * INFLATOR.rate) / m.c.h.tickRate : 0;
}

/** After a restore: seat constraints on while seated (Jolt's state doesn't record enable flags). */
export function inflatorRestore(m: M4Parts): void {
  for (const i of m.c.list('inflator')) m.seatC[i]?.SetEnabled(m.st.aux[i] === 1);
}

function unseat(m: M4Parts, i: number): void {
  if (!m.st.aux[i]) return;
  m.st.aux[i] = 0;
  m.seatC[i]?.SetEnabled(false);
}

// ---- stage 2 --------------------------------------------------------------------------------------------------------

/** INFLATOR `in`: each pulse opens the valve for 2 s from now (`Valve` mag 1 when it opens). */
export function airSignal(m: M4Parts, i: number, port: string, cause: number): boolean {
  const h = m.c.h, s = m.st;
  if (h.parts[i]!.def.type !== 'inflator') return false;
  if (port !== 'in') return true;
  const was = s.open[i]! > h.st.tick;
  s.open[i] = h.st.tick + Math.round(INFLATOR.valveS * h.tickRate);
  s.cause[i] = cause;
  if (!was) s.cause[i] = h.emit('Valve', i, h.local(i, [0, 0.26, 0.022]), 1, cause);
  h.st.lastEv[i] = s.cause[i]!;
  return true;
}

// ---- stage 5 --------------------------------------------------------------------------------------------------------

/** BLOWOUT heat: once warm (0.5 s powered), its 2 m / 10° cone as overlapping spheres (r = s·tan 10°, ≥ 0.012 m). */
export function blowoutHeat(m: M4Parts, out: number[]): void {
  const h = m.c.h, s = m.st;
  const tan = dsin(BLOWOUT.halfDeg * RAD) / dcos(BLOWOUT.halfDeg * RAD);
  for (const i of m.c.list('blowout')) {
    if (!h.st.alive[i] || s.ph[i] !== 2) continue;
    const n = h.local(i, BLOWOUT.nozzle), ax = qrot(bodyRot(h.bodies[h.parts[i]!.base]!.body), [1, 0, 0]);
    for (let d = 0.05; d <= BLOWOUT.R + 1e-9; d += 0.05) out.push(...vadd(n, vscale(ax, d)), Math.max(0.012, tan * d), s.cause[i]!);
  }
}

// ---- stage 6 --------------------------------------------------------------------------------------------------------

export function airBehave(m: M4Parts, i: number): boolean {
  switch (m.c.h.parts[i]!.def.type) {
    case 'blowout': blowout(m, i); return true;
    case 'vac': vac(m, i); return true;
    case 'inflator': inflator(m, i); return true;
    default: return false;
  }
}

/**
 * Cone force on one body, F = ρ·air·C·s·f·A·(1 − d/R)² (SIMULATION §5.8, the GALE's rule; C·s = 9 as the GALE's), along
 * `dir`, capped at 40 m/s². Returns false if the body's centre is outside the cone.
 */
function coneForce(m: M4Parts, body: number, area: number, nozzle: Vec, axis: Vec, R: number, cosHalf: number, f: number, inward: boolean): boolean {
  const h = m.c.h, b = h.bodies[body]!.body;
  const com = b.GetCenterOfMassPosition();
  const at: Vec = [com.GetX(), com.GetY(), com.GetZ()];
  const d = vsub(at, nozzle), dist = vlen(d);
  if (dist > R || dist < 1e-6 || vdot(d, axis) / dist < cosHalf) return false;
  const inv = b.GetMotionProperties().GetInverseMass();
  if (inv <= 0) return true;
  const fall = (1 - dist / R) * (1 - dist / R);
  const F = Math.min(1.225 * h.air * BLOWOUT.strength * f * area * fall, MAX_AIR_ACCEL / inv);
  const dir = inward ? vscale(d, -1 / dist) : axis;
  h.bi.AddForce(b.GetID(), h.v3(dir[0] * F, dir[1] * F, dir[2] * F), h.Jolt.EActivation_Activate);
  return true;
}

/**
 * BLOWOUT: powered, its 2 m / 10° jet pushes bodies along +X (and turns TURBINEs, like a GALE). After 0.5 s at power the
 * heater is warm and the same cone is a heat source (stage 5); it cools when the power goes. Hot air doesn't blow
 * flames out (unlike a GALE: see M4_NOTES_A4 deviations).
 */
function blowout(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!, t = h.st.tick;
  const f = Math.min(1, h.st.supply[i]!);
  if (f <= 0) {
    if (s.ph[i] !== 0) { s.ph[i] = 0; s.t0[i] = t; } // cooling (the coil fades over 2 s: `lit` until t0 + 2 s)
    return;
  }
  if (s.ph[i] === 0) { s.ph[i] = 1; s.t0[i] = t; s.cause[i] = h.st.lastEv[i] ?? -1; }
  if (s.ph[i] === 1 && t - s.t0[i]! >= Math.round(BLOWOUT.warmS * h.tickRate)) s.ph[i] = 2;
  const nozzle = h.local(i, BLOWOUT.nozzle), axis = vnorm(qrot(bodyRot(h.bodies[p.base]!.body), [1, 0, 0]));
  const cosHalf = dcos(BLOWOUT.halfDeg * RAD);
  for (const k of m.c.list('turbine')) if (h.st.alive[k]) m.c.wind(k, nozzle, axis, BLOWOUT.R, cosHalf, f);
  eachPushable(m.c, (pb) => {
    if (pb.part === i || h.parts[pb.part]!.def.type === 'turbine') return;
    if (coneForce(m, pb.body, areaOf(pb.def), nozzle, axis, BLOWOUT.R, cosHalf, f, false)) h.st.lastEv[pb.part] = s.cause[i]!;
  });
}

/**
 * VAC: powered, a 1.5 m / 20° inverted cone from its mouth pulls bodies toward the mouth; a body of ≤ 0.5 kg whose
 * surface reaches the mouth (2 cm) is held there (moved with the mouth, its weight on the VAC) until the power stops.
 * `Attach` / `Release` (other = the first held part, part order).
 */
function vac(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!;
  const f = Math.min(1, h.st.supply[i]!);
  const was = s.hold[i]!;
  let held = -1;
  if (f > 0) {
    const mouth = h.local(i, VAC.mouth), axis = vnorm(qrot(bodyRot(h.bodies[p.base]!.body), [0, 0, 1]));
    const cosHalf = dcos(VAC.halfDeg * RAD);
    eachPushable(m.c, (pb) => {
      if (pb.part === i) return;
      const b = h.bodies[pb.body]!.body;
      const com = b.GetCenterOfMassPosition();
      const at: Vec = [com.GetX(), com.GetY(), com.GetZ()];
      const rel = vsub(at, mouth), axial = vdot(rel, axis);
      const inv = b.GetMotionProperties().GetInverseMass();
      if (inv <= 0) return;
      const r = pb.half;
      // held: at the mouth, light enough
      if (1 / inv <= VAC.holdKg + 1e-9 && axial > -r && axial <= r + VAC.reach && vlen(vsub(rel, vscale(axis, axial))) <= 0.047 + r * 0.5) {
        const target = vadd(mouth, vscale(axis, r));
        const v = vscale(vsub(target, at), 10);
        h.bi.SetLinearVelocity(b.GetID(), h.v3(v[0], v[1], v[2]));
        h.bi.ActivateBody(b.GetID());
        if (held < 0) held = pb.part;
        h.st.lastEv[pb.part] = s.cause[i]! >= 0 ? s.cause[i]! : h.st.lastEv[i] ?? -1;
        return;
      }
      if (coneForce(m, pb.body, areaOf(pb.def), mouth, axis, VAC.R, cosHalf, f, true)) h.st.lastEv[pb.part] = h.st.lastEv[i] ?? -1;
    });
  }
  if (held !== was) {
    if (was >= 0) h.emit('Release', i, h.local(i, VAC.mouth), 0, h.st.lastEv[i] ?? -1, was);
    if (held >= 0) s.cause[i] = h.emit('Attach', i, h.local(i, VAC.mouth), 1, h.st.lastEv[i] ?? -1, held);
    s.hold[i] = held;
  }
}

/**
 * INFLATOR: while the valve is open (2 s per pulse) the seated HELIO gains 50 %/s (n counts open ticks); its toy-helium
 * lift follows the fill (a downward force cancels the unfilled share of the Machine's 4.9 N lift). Past 100 % the gauge
 * is in the amber (`Overfill`, the `pressed` blink); past 110 % the HELIO pops and the seat lets go.
 */
function inflator(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, t = h.st.tick;
  const k = m.seatOf[i]!;
  const open = s.open[i]! > t;
  if (!open && s.ph[i] === 1) { s.ph[i] = 0; h.emit('Valve', i, h.local(i, [0, 0.26, 0.022]), 0, s.cause[i]!); }
  if (open) s.ph[i] = 1;
  if (k < 0 || !s.aux[i]) return;
  if (!h.st.alive[k]) { unseat(m, i); return; }
  if (open) s.n[i] = s.n[i]! + 1;
  const fill = (s.n[i]! * INFLATOR.rate) / h.tickRate;
  if (fill > INFLATOR.overAt + 1e-9 && s.hold[i]! < 0) { s.hold[i] = k; h.emit('Overfill', i, h.local(i, INFLATOR.nozzle), fill, s.cause[i]!, k); }
  if (fill > INFLATOR.popAt + 1e-9) {
    m.h.pop(k, s.cause[i]!);
    unseat(m, i);
    return;
  }
  const missing = 1 - Math.min(1, fill);
  if (missing > 0) {
    const b = h.bodies[h.parts[k]!.base]!.body;
    h.bi.AddForce(b.GetID(), h.v3(0, -4.9 * h.air * missing, 0), h.Jolt.EActivation_Activate);
  }
}

// ---- outputs --------------------------------------------------------------------------------------------------------

/**
 * Flags: BLOWOUT `lit` while its heater glows (warm, or cooling for 2 s), `armed` while warming; VAC `pressed` while
 * holding something (clogged); INFLATOR `lit` while the valve is open, `pressed` while over-filled (the amber blink).
 */
export function airFlags(m: M4Parts, i: number): number {
  const h = m.c.h, s = m.st, t = h.st.tick;
  switch (h.parts[i]!.def.type) {
    case 'blowout': {
      if (s.ph[i] === 2) return 1;
      if (s.ph[i] === 1) return 16;
      return s.t0[i]! >= 0 && t - s.t0[i]! < 2 * h.tickRate ? 1 : 0; // cooling
    }
    case 'vac': return s.hold[i]! >= 0 ? 4 : 0;
    case 'inflator': return (s.open[i]! > t ? 1 : 0) | (s.hold[i]! >= 0 && s.aux[i] ? 4 : 0);
    default: return 0;
  }
}
