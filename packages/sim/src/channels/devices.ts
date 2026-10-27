// M2 devices (stream A): FLAP, SPRONG, TOGGLE, RINGER, DELAY, TORCH (signal side), T-PLUNGER, PUFFER
// pad, PUNCHLINE and GOTCHA BOX. Each runs from the Machine's stage hooks (channels/index.ts).

import { dcos, dexp, dsin, f32 } from '@knockon/detmath';
import { FLAP, GOTCHA, qAxis } from '@knockon/parts-data';
import { qmul, qrot, vadd, vdot, vscale, vsub, type Q, type Vec } from '../vec.ts';
import { bodyAngVel, bodyPos, bodyRot, type HostBody } from './host.ts';
import { queuePuff } from './air.ts';
import { DB } from './sound.ts';
import type { PartChannels } from './index.ts';

const RAD = Math.PI / 180;
const G = 9.81;

/** Part-local position of a world point, from the part's base body pose. */
export function toLocal(c: PartChannels, i: number, w: readonly number[]): Vec {
  const b = c.h.bodies[c.h.parts[i]!.base]!.body;
  const p = bodyPos(b), r = bodyRot(b);
  return qrot([-r[0], -r[1], -r[2], r[3]], vsub(w, p));
}

function hingePosition(c: PartChannels, hinge: ReturnType<PartChannels['hingeOf']>, target: number, torque: number, freq: number): void {
  const J = c.h.Jolt;
  if (!hinge) return;
  hinge.SetMotorState(J.EMotorState_Position);
  hinge.SetTargetAngle(f32(target));
  const m = hinge.GetMotorSettings();
  m.mMinTorqueLimit = f32(-torque);
  m.mMaxTorqueLimit = f32(torque);
  const s = m.mSpringSettings;
  s.mFrequency = f32(freq);
  s.mDamping = f32(1);
}

const wake = (c: PartChannels, i: number): void => {
  const p = c.h.parts[i]!;
  if (p.arm >= 0) c.h.bi.ActivateBody(c.h.bodies[p.arm]!.body.GetID());
};

/** Initial states (run start). */
export function initDevices(c: PartChannels): void {
  const h = c.h, m2 = h.st.m2;
  for (const i of c.list('toggle')) m2.on[i] = h.parts[i]!.props.on ?? 0;
  for (const i of c.list('torch')) m2.on[i] = h.parts[i]!.props.on ?? 0;
  for (const i of c.list('ringer')) { m2.on[i] = 1; m2.val[i] = Math.max(1, Math.round((h.parts[i]!.props.time ?? 5) * h.tickRate)); }
}

// ---- stage 1: timers -----------------------------------------------------------------------------------

export function deviceTimers(c: PartChannels, t: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  // RINGER: rings at zero (a pulse, a Ring event and an 80 dB sound), the hammer buzzes for 2 s
  for (const i of c.list('ringer')) {
    if (!st.alive[i] || !m2.on[i] || t < m2.val[i]!) continue;
    m2.on[i] = 0;
    const bells = h.local(i, [0, 0.09, 0]);
    const id = h.emit('Ring', i, bells, DB.ringer);
    m2.cause[i] = id;
    h.pulse(i, 'out', id);
    h.sound(bells, DB.ringer, i, id);
    st.pressed[i] = 2 * h.tickRate;
  }
  // DELAY: due pulses leave `out` (queued in arrival order)
  if (m2.delays.length) {
    const keep: number[] = [];
    for (let k = 0; k < m2.delays.length; k += 3) {
      const due = m2.delays[k]!, i = m2.delays[k + 1]!, cause = m2.delays[k + 2]!;
      if (due > t) { keep.push(due, i, cause); continue; }
      if (st.alive[i]) h.pulse(i, 'out', cause);
    }
    m2.delays = keep;
  }
  for (const i of c.list('delay')) m2.on[i] = 0;
  for (let k = 0; k < m2.delays.length; k += 3) m2.on[m2.delays[k + 1]!] = 1;
  // FLAP: the auto-close timer
  for (const i of c.list('flap')) {
    const close = h.parts[i]!.props.close ?? 0;
    if (close > 0 && m2.phase[i] === 1 && t - m2.t0[i]! >= Math.round(close * h.tickRate)) { m2.phase[i] = 2; wake(c, i); }
  }
}

// ---- stage 2: signals ---------------------------------------------------------------------------------

/** Returns true if the receiver was one of these devices. */
export function deviceSignal(c: PartChannels, i: number, port: string, cause: number): boolean {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'delay':
      if (port === 'in') m2.delays.push(st.tick + Math.max(1, Math.round((p.props.delay ?? 1) * h.tickRate)), i, cause);
      return true;
    case 'torch': {
      const mode = p.props.mode ?? 0;
      const next = mode === 1 ? 1 : mode === 2 ? 0 : 1 - m2.on[i]!;
      if (next !== m2.on[i]) {
        m2.on[i] = next;
        m2.cause[i] = h.emit(next ? 'Lit' : 'Unlit', i, h.local(i, [0.1, 0.055, 0]), next, cause);
      }
      return true;
    }
    case 'flap':
      if ((p.props.mode ?? 0) !== 0) return true; // passive flaps ignore signals
      m2.cause[i] = cause;
      if (m2.phase[i] === 0) { m2.phase[i] = 1; m2.t0[i] = st.tick; } else m2.phase[i] = m2.phase[i] === 1 ? 2 : 1;
      if (m2.phase[i] === 1) m2.t0[i] = st.tick;
      wake(c, i);
      return true;
    case 'punchline':
      if (port !== 'trigger' || m2.phase[i] !== 0) return true;
      m2.phase[i] = 1;
      m2.t0[i] = st.tick;
      m2.cause[i] = h.emit('Launch', i, h.local(i, [0.115, 0.09, 0], 'arm'), 6, cause);
      st.lastEv[i] = m2.cause[i]!;
      wake(c, i);
      return true;
    default:
      return false;
  }
}

// ---- stage 6: behaviours -----------------------------------------------------------------------------

export function deviceBehave(c: PartChannels, i: number): boolean {
  const h = c.h, m2 = h.st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'flap': flap(c, i); return true;
    case 'toggle': {
      const startOn = (p.props.on ?? 0) === 1;
      const target = m2.on[i] ? (startOn ? 0 : -50 * RAD) : (startOn ? 50 * RAD : 0);
      hingePosition(c, p.hinge, target, 0.4, 12);
      return true;
    }
    case 'punchline': punchline(c, i); return true;
    case 'gotcha_box': gotcha(c, i); return true;
    default: return false;
  }
}

/** FLAP: latched (hard limits at 0°), open (free, gravity), closing (motor to 0°); passive: a weak spring. */
function flap(c: PartChannels, i: number): void {
  const h = c.h, m2 = h.st.m2, p = h.parts[i]!, hinge = p.hinge;
  if (!hinge) return;
  const J = h.Jolt;
  if ((p.props.mode ?? 0) === 1) {
    // passive one-way gate: the spring carries the panel's own weight plus 0.15 N·m of load
    hinge.SetLimits(0, f32(Math.PI / 2));
    hingePosition(c, hinge, 0, FLAP.mass * G * (FLAP.panel / 2) + 0.15, 25);
    m2.on[i] = hinge.GetCurrentAngle() > 0.05 ? 1 : 0;
    return;
  }
  const ph = m2.phase[i]!;
  // SIMFIX (rule 14): Jolt's saved state doesn't hold a hinge's friction torque. Phase 1 sets the knuckle friction and
  // nothing ever cleared it, so it is on from the first opening (t0 ≥ 0) and off before; set it from that every tick
  // so a rollback, or a partner's checkpoint, can't leave the other value behind (the straight run is unchanged)
  if (ph !== 1) hinge.SetMaxFrictionTorque(f32(m2.t0[i]! >= 0 ? 0.05 : 0));
  if (ph === 0) {
    hinge.SetLimits(0, f32(0.0005));
    hinge.SetMotorState(J.EMotorState_Off);
  } else if (ph === 1) {
    hinge.SetLimits(0, f32(Math.PI / 2));
    hinge.SetMotorState(J.EMotorState_Off);
    hinge.SetMaxFrictionTorque(f32(0.05)); // knuckle friction: it swings down and settles, hanging open
  } else {
    hinge.SetLimits(0, f32(Math.PI / 2));
    hingePosition(c, hinge, 0, 3, 4);
    if (hinge.GetCurrentAngle() < 0.02) m2.phase[i] = 0;
  }
  m2.on[i] = m2.phase[i]! >= 1 ? 1 : 0;
}

/** PUNCHLINE: out at 6 m/s (≤ 0.15 s), hold 0.25 s, ratchet back at 0.83 m/s; flags a fault if blocked. */
function punchline(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  const s = c.sliders[i];
  if (!s) return;
  const J = h.Jolt;
  const pos = s.GetCurrentPosition();
  const el = (st.tick - m2.t0[i]!) / h.tickRate;
  const m = s.GetMotorSettings();
  const motor = (velocity: boolean, v: number, force: number): void => {
    m.mMinForceLimit = f32(-force); m.mMaxForceLimit = f32(force);
    if (velocity) { s.SetMotorState(J.EMotorState_Velocity); s.SetTargetVelocity(f32(v)); }
    else { s.SetMotorState(J.EMotorState_Position); s.SetTargetPosition(f32(v)); }
  };
  switch (m2.phase[i]) {
    case 1:
      if (pos >= 0.49 || el >= 0.15) {
        if (pos < 0.1) st.fault[i] = true;
        m2.phase[i] = 2; m2.t0[i] = st.tick;
        motor(false, 0.5, 600);
      } else motor(true, 6, 600);
      break;
    case 2:
      motor(false, 0.5, 600);
      if (el >= 0.25) { m2.phase[i] = 3; m2.t0[i] = st.tick; }
      break;
    case 3:
      motor(true, -0.83, 300);
      if (pos <= 0.01 || el >= 1) { m2.phase[i] = 0; st.fault[i] = false; motor(false, 0, 300); }
      break;
    default:
      motor(false, 0, 300);
  }
  if (m2.phase[i] !== 0) wake(c, i);
}

/** GOTCHA BOX: counts crank turns; once popped, moves the kinematic head along its pop path. */
function gotcha(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  if (!m2.on[i]) {
    if (p.arm >= 0) {
      const axis = qrot(p.rot, p.def.hinge!.axis);
      m2.val2[i] = Math.abs(vdot(bodyAngVel(h.bodies[p.arm]!.body), axis)); // crank speed (the `powered` flag)
      m2.val[i] = m2.val[i]! + m2.val2[i]! * h.dt;
      if (m2.val[i]! >= 3 * 2 * Math.PI) pop(c, i, st.lastEv[i] ?? -1);
    }
    if (!m2.on[i]) return;
  }
  const piece = c.pieceOf[i]!;
  if (piece < 0) return;
  // pose at the end of this step
  const s = (st.tick + 1 - m2.t0[i]!) / h.tickRate;
  const g = GOTCHA;
  let local: Vec, lean = 0;
  if (s <= g.riseS) {
    const u = Math.max(0, s / g.riseS), e = 1 - (1 - u) * (1 - u);
    local = [g.rest[0], g.rest[1] + g.rise * e, g.rest[2]];
  } else {
    const u = Math.min(1, (s - g.riseS) / g.leanS);
    lean = g.lean * (1 - (1 - u) * (1 - u));
    const after = s - g.riseS - g.leanS;
    if (after > 0) lean += 6 * dexp(-6 * after) * dsin(2 * Math.PI * 4 * after);
    const L = g.rest[1] + g.rise - g.pivot[1];
    local = [g.pivot[0], g.pivot[1] + L * dcos(lean * RAD), g.pivot[2] + L * dsin(lean * RAD)];
  }
  // the head body's origin is the part origin (its shape sits at `rest`): place the origin so the
  // sphere lands on `local`, tilted by the lean about the lean pivot
  const lq = qAxis([1, 0, 0], lean) as unknown as Q;
  const originLocal = vsub(local, qrot(lq, g.rest));
  const w = vadd(p.pos, qrot(p.rot, originLocal));
  const q = qmul(p.rot, lq);
  c.rv.Set(f32(w[0]), f32(w[1]), f32(w[2]));
  c.qq.Set(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3]));
  h.bi.MoveKinematic(h.bodies[piece]!.body.GetID(), c.rv, c.qq, f32(h.dt));
}

function pop(c: PartChannels, i: number, cause: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  if (m2.on[i]) return;
  m2.on[i] = 1;
  m2.val2[i] = 0;
  m2.t0[i] = st.tick;
  const at = h.local(i, [0, 0.19, 0]);
  const id = h.emit('Launch', i, at, 1, cause);
  m2.cause[i] = id;
  st.lastEv[i] = id;
  h.sound(at, DB.gotcha, i, id);
}

// ---- stage 9: contacts --------------------------------------------------------------------------------

/** A sorted contact on one of these devices (`mb` is the device's body). */
export function deviceContact(c: PartChannels, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, vrel: number, pos: Vec, added: boolean, cause: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[pi]!;
  const other = ob ? ob.part : -1;
  switch (p.def.type) {
    case 'sprong': {
      // the mat sends whatever lands on it back at 1.15 × its arrival speed, capped at 8 m/s
      if (!added || !ob?.dynamic || mb.role !== 'base' || J < 0.05 || c.bounced.has(ob.part)) break;
      const l = toLocal(c, pi, pos);
      if (l[1] < 0.024 || Math.abs(l[0]) > 0.11 || Math.abs(l[2]) > 0.11) break;
      c.bounced.add(ob.part);
      const up = qrot(p.rot, [0, 1, 0]);
      const vb = ob.body.GetLinearVelocity();
      const v: Vec = [vb.GetX(), vb.GetY(), vb.GetZ()];
      const out = Math.min(8, 1.15 * vrel);
      const nv = vadd(vsub(v, vscale(up, vdot(v, up))), vscale(up, out));
      h.bi.SetLinearVelocity(ob.body.GetID(), h.v3(nv[0], nv[1], nv[2]));
      st.pressed[pi] = Math.round(0.1 * h.tickRate);
      break;
    }
    case 'toggle': {
      if (!added || !ob?.dynamic || mb.role !== 'arm' || J < 0.03 || st.cooldown[pi]! > 0) break;
      st.cooldown[pi] = Math.round(0.2 * h.tickRate);
      m2.on[pi] = 1 - m2.on[pi]!;
      const id = h.emit('Toggle', pi, pos, m2.on[pi]!, cause, other);
      st.powerCause = id;
      h.pulse(pi, 'out_signal', id);
      wake(c, pi);
      break;
    }
    case 't_plunger': {
      if (mb.role !== 'base' || !ob?.dynamic || m2.on[pi]) break;
      const l = toLocal(c, pi, pos);
      if (l[1] < 0.262) break;
      if (added && J >= 0.3) { plunge(c, pi, J, cause, other); break; }
      const inv = ob.body.GetMotionProperties().GetInverseMass();
      c.handleMass.set(pi, (c.handleMass.get(pi) ?? 0) + (inv > 0 ? 1 / inv : 0));
      c.handleCause.set(pi, cause);
      break;
    }
    case 'puffer': {
      if (!added || !ob?.dynamic || mb.role !== 'base' || J < 0.02 || st.cooldown[pi]! > 0) break;
      const l = toLocal(c, pi, pos);
      if (l[1] < 0.1) break;
      st.cooldown[pi] = Math.round(0.15 * h.tickRate);
      st.pressed[pi] = Math.round(0.35 * h.tickRate);
      const id = h.emit('Press', pi, pos, J, cause, other);
      queuePuff(c, pi, J, id);
      break;
    }
    case 'gotcha_box': {
      if (!added || !ob?.dynamic || mb.role !== 'base' || m2.on[pi]) break;
      const l = toLocal(c, pi, pos);
      if (J >= 1.0 || (l[1] >= 0.165 && J >= 0.5)) pop(c, pi, cause);
      break;
    }
    default:
  }
}

function plunge(c: PartChannels, i: number, J: number, cause: number, other: number): void {
  const h = c.h, m2 = h.st.m2;
  if (m2.on[i]) return;
  m2.on[i] = 1;
  const id = h.emit('Press', i, h.local(i, [0, 0.3, 0]), J, cause, other);
  m2.cause[i] = id;
  h.pulse(i, 'out', id);
}

/** After all contacts: T-PLUNGER fires under ≥ 1 kg resting on its handle. */
export function deviceAfterContacts(c: PartChannels): void {
  for (const [i, kg] of c.handleMass) if (kg >= 1 - 1e-9) plunge(c, i, 0, c.handleCause.get(i) ?? -1, -1);
  c.handleMass.clear();
  c.handleCause.clear();
  c.bounced.clear();
}
