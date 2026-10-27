// M3 fields and wireless (stream A3): MAGLOCK (SIMULATION §5.12), ZONE (gravity / antigrav / wind / stasis), BUMPER
// (an active kick, like SPRONG: Jolt can't do restitution above 1) and PING (a wireless pair acts as a wire, §5.2).

import { BUMPER, MAGLOCK, ZONE_MODES } from '@knockon/parts-data';
import { qrot, vadd, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { bodyPos, bodyRot, bodyVel, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import { douseFlamer } from './m3_boom.ts';
import { areaOf, eachPushable } from './m3.ts';
import type { PartChannels } from './index.ts';

/** Accelerations a field may give a body, so a 5 g marble isn't fired across the room (m/s²). */
const MAX_FIELD_ACCEL = 40;

// ---- stage 6 (end): fields ------------------------------------------------------------------------------------------

export function fields(c: PartChannels): void {
  for (const i of c.list('maglock')) maglock(c, i);
  for (const i of c.list('zone')) zone(c, i);
}

const steel = (def: { body: { magnetic?: boolean; material?: string } } | null): boolean => !!def && (def.body.magnetic === true || def.body.material === 'steel');

/**
 * MAGLOCK, powered: steel within its 0.6 m reach (a cylinder r 0.12 + the body's radius in front of the pole face) is
 * pulled toward the face with F = k·f / max(d, 0.05)², d = the gap to the face (at most 40 m/s² of acceleration);
 * the magnet feels the reaction. At f ≥ 0.75 steel at the face is held there (snapped to the magnet's motion).
 */
function maglock(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m3 = st.m2.m3, p = h.parts[i]!;
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  const was = m3.hold[i]!;
  let held = -1;
  if (f > 0) {
    const base = h.bodies[p.base]!.body;
    const rot = bodyRot(base);
    const face = h.local(i, MAGLOCK.face), axis = vnorm(qrot(rot, [0, 0, 1]));
    const magV = bodyVel(base);
    const magDyn = h.bodies[p.base]!.dynamic;
    let reaction: Vec = [0, 0, 0];
    eachPushable(c, (pb) => {
      if (pb.part === i || !steel(pb.def)) return;
      const b = h.bodies[pb.body]!.body;
      const com = b.GetCenterOfMassPosition();
      const at: Vec = [com.GetX(), com.GetY(), com.GetZ()];
      const rel = vsub(at, face), axial = vdot(rel, axis);
      const r = pb.half;
      if (axial < -r || axial > MAGLOCK.reach + r) return;
      if (vlen(vsub(rel, vscale(axis, axial))) > MAGLOCK.radius + r) return;
      const inv = b.GetMotionProperties().GetInverseMass();
      if (inv <= 0) return;
      const m = 1 / inv, gap = Math.max(0, axial - r);
      if (gap <= 0.01 && f >= MAGLOCK.hold) {
        // held: the steel moves with the magnet, its weight on the magnet
        const target = vadd(face, vscale(axis, r));
        const v = vadd(magV, vscale(vsub(target, at), 10));
        h.bi.SetLinearVelocity(b.GetID(), h.v3(v[0], v[1], v[2]));
        reaction = vadd(reaction, [0, -m * c.m3.gravity, 0]);
        if (held < 0) held = pb.part;
        return;
      }
      const F = Math.min((MAGLOCK.k * f) / (Math.max(gap, 0.05) * Math.max(gap, 0.05)), MAX_FIELD_ACCEL * m);
      const dir = vnorm(vsub(vadd(face, vscale(axis, r)), at));
      h.bi.AddForce(b.GetID(), h.v3(dir[0] * F, dir[1] * F, dir[2] * F), h.Jolt.EActivation_Activate);
      reaction = vsub(reaction, vscale(dir, F));
      st.lastEv[pb.part] = st.lastEv[i]!;
    });
    if (magDyn && (reaction[0] !== 0 || reaction[1] !== 0 || reaction[2] !== 0)) h.bi.AddForce(base.GetID(), h.v3(reaction[0], reaction[1], reaction[2]), h.Jolt.EActivation_Activate);
  }
  if (held !== was) {
    if (was >= 0) h.emit('Release', i, h.local(i, MAGLOCK.face), 0, st.lastEv[i] ?? -1, was);
    if (held >= 0) h.emit('Attach', i, h.local(i, MAGLOCK.face), 1, st.lastEv[i] ?? -1, held);
    m3.hold[i] = held;
  }
}

/**
 * ZONE: bodies whose centre is inside the box get, by mode: Gravity, an extra m·g·(s − 1) down (s × gravity);
 * Antigrav, m·g·(1 + s) up (a net s·g upward); Wind, 1.225·air·A·s² along the zone's +X (and it blows out flames when
 * s > 4 m/s); Stasis, their velocity zeroed and gravity cancelled every tick (frozen; sleeping bodies stay asleep).
 */
function zone(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, p = h.parts[i]!;
  if (!st.alive[i]) return;
  const mode = ZONE_MODES[Math.max(0, Math.min(3, p.props.mode ?? 0))]!;
  const s = p.props.strength ?? 1;
  const hw = (p.props.width ?? 1) / 2, hh = p.props.height ?? 1, hd = (p.props.depth ?? 1) / 2;
  const inside = (w: readonly number[]): boolean => { const l = toLocal(c, i, w); return Math.abs(l[0]) <= hw && l[1] >= 0 && l[1] <= hh && Math.abs(l[2]) <= hd; };
  const g = c.m3.gravity, J = h.Jolt;
  const wind = qrot(p.rot, [1, 0, 0]);
  eachPushable(c, (pb) => {
    const b = h.bodies[pb.body]!.body;
    const com = b.GetCenterOfMassPosition();
    if (!inside([com.GetX(), com.GetY(), com.GetZ()])) return;
    const inv = b.GetMotionProperties().GetInverseMass();
    if (inv <= 0) return;
    const m = 1 / inv, gf = pb.def?.body.gravityFactor ?? 1;
    switch (mode) {
      case 'Gravity': h.bi.AddForce(b.GetID(), h.v3(0, -m * g * gf * (s - 1), 0), J.EActivation_Activate); break;
      case 'Antigrav': h.bi.AddForce(b.GetID(), h.v3(0, m * g * gf * (1 + s), 0), J.EActivation_Activate); break;
      case 'Wind': {
        const F = Math.min(1.225 * h.air * areaOf(pb.def) * s * s, MAX_FIELD_ACCEL * m);
        h.bi.AddForce(b.GetID(), h.v3(wind[0] * F, wind[1] * F, wind[2] * F), J.EActivation_Activate);
        break;
      }
      default:
        if (!b.IsActive()) return;
        h.bi.SetLinearVelocity(b.GetID(), h.v3(0, 0, 0));
        h.bi.SetAngularVelocity(b.GetID(), h.v3(0, 0, 0));
        h.bi.AddForce(b.GetID(), h.v3(0, m * g * gf, 0), J.EActivation_DontActivate);
    }
  });
  if (mode === 'Wind' && s > 4) {
    for (let k = 0; k < h.parts.length; k++) {
      if (!st.alive[k]) continue;
      const t = h.parts[k]!.def.type;
      if (t === 'wick' && st.lit[k] && inside(h.local(k, [0, 0.19, 0]))) { st.lit[k] = false; h.emit('Extinguish', k, h.local(k, [0, 0.19, 0]), 0, st.lastEv[i] ?? -1); }
      if (t === 'flamer' && inside(h.local(k, [0.15, 0.05, 0]))) douseFlamer(c, k, s, st.lastEv[i] ?? -1);
    }
  }
}

// ---- stage 9: BUMPER -----------------------------------------------------------------------------------------------

/** BUMPER: a hit (≥ 0.05 N·s, 0.1 s cooldown) sends the body straight out from the centre at 1.2 × its arrival speed (1.5–8 m/s). */
export function bumperContact(c: PartChannels, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, vrel: number, pos: Vec, added: boolean, cause: number): boolean {
  const h = c.h, st = h.st, p = h.parts[pi]!;
  if (p.def.type !== 'bumper') return false;
  if (!added || !ob?.dynamic || mb.role !== 'base' || J < 0.05 || st.cooldown[pi]! > 0 || c.m3.kicked.has(ob.part)) return true;
  const l = toLocal(c, pi, pos);
  if (l[1] < 0.02) return true; // the skirt's top, not the floor under it
  st.cooldown[pi] = Math.round(0.1 * h.tickRate);
  kick(c, pi, ob, Math.min(BUMPER.maxKick, Math.max(BUMPER.minKick, BUMPER.e * vrel)), cause);
  return true;
}

function kick(c: PartChannels, i: number, ob: HostBody, speed: number, cause: number): void {
  const h = c.h, st = h.st, p = h.parts[i]!;
  const up = qrot(p.rot, [0, 1, 0]);
  const at = bodyPos(ob.body), centre = h.local(i, [0, 0.05, 0]);
  let radial = vsub(at, centre);
  radial = vnorm(vsub(radial, vscale(up, vdot(radial, up))));
  if (vlen(radial) < 0.5) radial = qrot(p.rot, [1, 0, 0]);
  const v = bodyVel(ob.body);
  const keep = vsub(v, vscale(radial, vdot(v, radial))); // keep the sideways part
  const nv = vadd(keep, vscale(radial, speed));
  h.bi.SetLinearVelocity(ob.body.GetID(), h.v3(nv[0], nv[1], nv[2]));
  h.bi.ActivateBody(ob.body.GetID());
  c.m3.kicked.add(ob.part);
  st.pressed[i] = Math.round(0.1 * h.tickRate);
  const id = h.emit('Trigger', i, at, speed, cause, ob.part);
  st.lastEv[ob.part] = id;
  st.lastEv[i] = id;
}

/** BUMPER `kick` Signal: whatever sits against its band (centre within 0.13 m of the axis, below 0.15 m) is kicked out. */
function bumperSignal(c: PartChannels, i: number, cause: number): void {
  const h = c.h;
  eachPushable(c, (pb) => {
    if (pb.part === i) return;
    const ob = h.bodies[pb.body]!;
    const l = toLocal(c, i, bodyPos(ob.body));
    if (l[1] < 0 || l[1] > 0.15 || Math.sqrt(l[0] * l[0] + l[2] * l[2]) > BUMPER.ringR + pb.half) return;
    kick(c, i, ob as HostBody, BUMPER.signalKick, cause);
  });
}

// ---- stage 2: PING ---------------------------------------------------------------------------------------------------

/**
 * Signals into PING and BUMPER. A PING in Tx mode passes a pulse on its `in` to every Rx of its pair colour, in part
 * order, within the same tick: each Rx relays it through its `out` cables at once (a `PingRx` event: part = Rx, other =
 * Tx, mag = pair index). An Rx relays at most once per tick, so a loop of pairs can't run away.
 */
export function fieldSignal(c: PartChannels, i: number, port: string, cause: number): boolean {
  const h = c.h, st = h.st, p = h.parts[i]!;
  switch (p.def.type) {
    case 'bumper': if (port === 'kick') bumperSignal(c, i, cause); return true;
    case 'ping': {
      if (port !== 'in' || (p.props.mode ?? 0) !== 0) return true;
      if (c.m3.wTick !== st.tick) { c.m3.wTick = st.tick; c.m3.wFired.clear(); }
      st.pressed[i] = Math.round(0.15 * h.tickRate);
      const pair = p.props.pair ?? 0;
      for (const rx of c.list('ping')) {
        const q = h.parts[rx]!;
        if (rx === i || !st.alive[rx] || (q.props.mode ?? 0) !== 1 || (q.props.pair ?? 0) !== pair || c.m3.wFired.has(rx)) continue;
        c.m3.wFired.add(rx);
        st.pressed[rx] = Math.round(0.15 * h.tickRate);
        const id = h.emit('PingRx', rx, h.local(rx, [0, 0.1, 0]), pair, cause, i);
        st.lastEv[rx] = id;
        for (const dst of h.signalOut.get(`${rx}:out`) ?? []) h.receive(dst.part, dst.port.name, id);
      }
      return true;
    }
    default: return false;
  }
}

/** Flags: MAGLOCK lit while it holds steel. */
export function fieldFlags(c: PartChannels, i: number): number {
  return c.h.parts[i]!.def.type === 'maglock' && c.h.st.m2.m3.hold[i]! >= 0 ? 1 : 0;
}

