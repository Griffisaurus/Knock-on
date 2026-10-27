// M3 mechanisms (stream A3): SPINDECK, LIFT, RACK (built in m3.ts), RAM, PINGER, BONKER, PADDLE, SNAPTRAP, FLINGER and
// the GLIDEPATH booster. Hinged ones drive their Machine-built hinge with velocity / position motors; sliders use the
// M3 slider from m3.ts; the LIFT deck is a kinematic piece. Phases live in `st.m2.phase` / `t0` / `cause`.

import { f32 } from '@knockon/detmath';
import { BOOSTER, FLINGER, SNAPTRAP } from '@knockon/parts-data';
import type { JoltModule } from '@knockon/jolt';
import { qrot, vadd, vdot, vscale, type Vec } from '../vec.ts';
import { bodyAngVel, bodyPos, bodyRot, bodyVel, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import type { PartChannels } from './index.ts';

const RAD = Math.PI / 180;

function hingeVel(c: PartChannels, hinge: JoltModule, w: number, torque: number): void {
  hinge.SetMotorState(c.h.Jolt.EMotorState_Velocity);
  hinge.SetTargetAngularVelocity(f32(w));
  const m = hinge.GetMotorSettings();
  m.mMinTorqueLimit = f32(-torque); m.mMaxTorqueLimit = f32(torque);
}
function hingePos(c: PartChannels, hinge: JoltModule, target: number, torque: number, freq: number): void {
  hinge.SetMotorState(c.h.Jolt.EMotorState_Position);
  hinge.SetTargetAngle(f32(target));
  const m = hinge.GetMotorSettings();
  m.mMinTorqueLimit = f32(-torque); m.mMaxTorqueLimit = f32(torque);
  m.mSpringSettings.mFrequency = f32(freq);
  m.mSpringSettings.mDamping = f32(1);
}
function sliderDrive(c: PartChannels, s: JoltModule, velocity: boolean, v: number, force: number, freq = 20): void {
  const J = c.h.Jolt, m = s.GetMotorSettings();
  m.mMinForceLimit = f32(-force); m.mMaxForceLimit = f32(force);
  m.mSpringSettings.mFrequency = f32(freq);
  if (velocity) { s.SetMotorState(J.EMotorState_Velocity); s.SetTargetVelocity(f32(v)); }
  else { s.SetMotorState(J.EMotorState_Position); s.SetTargetPosition(f32(v)); }
}
const wakeArm = (c: PartChannels, i: number): void => { const p = c.h.parts[i]!; if (p.arm >= 0) c.h.bi.ActivateBody(c.h.bodies[p.arm]!.body.GetID()); };
const secs = (c: PartChannels, i: number): number => (c.h.st.tick - c.h.st.m2.t0[i]!) / c.h.tickRate;

/** Starts phase 1 of a triggered mechanism (RAM: an `Extend` event, the others `Trigger`; mag 1). False if busy. */
function trigger(c: PartChannels, i: number, cause: number, at: readonly number[]): boolean {
  const st = c.h.st, m2 = st.m2;
  if (m2.phase[i] !== 0 || !st.alive[i]) return false;
  m2.phase[i] = 1;
  m2.t0[i] = st.tick;
  m2.cause[i] = c.h.emit(c.h.parts[i]!.def.type === 'ram' ? 'Extend' : 'Trigger', i, c.h.local(i, at), 1, cause);
  st.lastEv[i] = m2.cause[i]!;
  wakeArm(c, i);
  return true;
}

// ---- stage 2: signals --------------------------------------------------------------------------------------------

export function motionSignal(c: PartChannels, i: number, port: string, cause: number): boolean {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'lift': {
      if (port !== 'call') return true;
      const ph = m2.phase[i]!;
      m2.phase[i] = ph === 0 ? 1 : ph === 2 ? 3 : ph === 1 ? 3 : 1;
      m2.cause[i] = cause;
      return true;
    }
    case 'ram':
      if (port !== 'fire') return true;
      // unpowered: a 0.5 s fault blink (the `fault` flag, from motionFlags) instead of a stroke
      if (st.supply[i]! <= 0) { m2.val2[i] = st.tick + Math.round(0.5 * h.tickRate); return true; }
      trigger(c, i, cause, [0, 0.05, 0.25]);
      return true;
    case 'pinger': if (port === 'fire') trigger(c, i, cause, [0, 0.055, 0.16]); return true;
    case 'bonker': if (port === 'swing') trigger(c, i, cause, [0, 0.31, 0.05]); return true;
    case 'flinger': if (port === 'release') trigger(c, i, cause, [0, 0.07, 0.138]); return true;
    case 'paddle': {
      if (port !== 'flip') return true;
      st.m2.m3.n[i] = st.tick + Math.round(0.3 * h.tickRate); // hold-until
      if (m2.phase[i] === 0) trigger(c, i, cause, [0.12, 0, 0]);
      else if (m2.phase[i] === 3) { m2.phase[i] = 1; m2.t0[i] = st.tick; wakeArm(c, i); }
      return true;
    }
    default: return false;
  }
}

/** Power demand (stage 3): the LIFT draws only while moving. */
export function motionDemand(c: PartChannels, i: number, w: number): number {
  const p = c.h.parts[i]!;
  if (p.def.type === 'lift') { const ph = c.h.st.m2.phase[i]!; return ph === 1 || ph === 3 ? w : 0; }
  return w;
}

// ---- stage 6: behaviours ----------------------------------------------------------------------------------------

export function motionBehave(c: PartChannels, i: number): boolean {
  const h = c.h, p = h.parts[i]!;
  switch (p.def.type) {
    case 'spindeck':
      // the brake is hinge friction, set every tick (a rollback can't leave a stale value)
      p.hinge?.SetMaxFrictionTorque(f32((p.props.brake ?? 0) ? 50 : 0.01));
      return true;
    case 'lift': lift(c, i); return true;
    case 'ram': ram(c, i); return true;
    case 'pinger': pinger(c, i); return true;
    case 'bonker': bonker(c, i); return true;
    case 'paddle': paddle(c, i); return true;
    case 'snaptrap': snaptrap(c, i); return true;
    case 'flinger': flinger(c, i); return true;
    case 'glidepath_booster': booster(c, i); return true;
    case 'rack': return true;
    default: return false;
  }
}

/** LIFT: the kinematic deck moves toward its end at `speed` × supply; it stalls without power or over 15 kg. */
function lift(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  const deck = h.parts[i]!.arm;
  if (deck < 0) return;
  const travel = p.props.travel ?? 1, speed = p.props.speed ?? 0.25;
  const ph = m2.phase[i]!;
  let y = m2.val[i]!;
  const overload = m2.val2[i]! > 15 + 1e-9;
  if (ph === 1 || ph === 3) {
    const f = Math.min(1, st.supply[i]!);
    if (f > 0 && !overload && st.alive[i]) {
      st.m2.m3.n[i] = 0;
      y += (ph === 1 ? 1 : -1) * speed * f * h.dt;
      if (ph === 1 && y >= travel - 1e-9) arrive(c, i, travel, 2);
      else if (ph === 3 && y <= 1e-9) arrive(c, i, 0, 0);
      else m2.val[i] = y;
    } else if (!st.m2.m3.n[i]) {
      // stalled (no power, or over 15 kg): the `fault` flag while it lasts (m3.n), a Jam when it's the load
      st.m2.m3.n[i] = 1;
      if (overload) h.emit('Jam', i, h.local(i, [0, 0.05, 0]), m2.val2[i]!, st.lastEv[i] ?? -1);
    }
  }
  const at = vadd(p.pos, qrot(p.rot, [0, m2.val[i]!, 0]));
  c.rv.Set(f32(at[0]), f32(at[1]), f32(at[2]));
  c.qq.Set(f32(p.rot[0]), f32(p.rot[1]), f32(p.rot[2]), f32(p.rot[3]));
  h.bi.MoveKinematic(h.bodies[deck]!.body.GetID(), c.rv, c.qq, f32(h.dt));
}

function arrive(c: PartChannels, i: number, y: number, phase: number): void {
  const h = c.h, m2 = h.st.m2;
  m2.val[i] = y;
  m2.phase[i] = phase;
  const id = h.emit('Arrive', i, h.local(i, [0, y + 0.05, 0]), phase === 2 ? 1 : 0, m2.cause[i]!);
  h.st.lastEv[i] = id;
  h.pulse(i, 'arrive', id);
}

/** RAM: out 0.25 m in 0.08 s (force × supply), hold 0.3 s, back in 0.4 s. */
function ram(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, s = c.m3.slider[i];
  if (!s) return;
  if (m2.val2[i]! > 0 && st.tick >= m2.val2[i]!) m2.val2[i] = 0;
  const pos = s.GetCurrentPosition(), el = secs(c, i), f = Math.max(0.2, Math.min(1, st.supply[i]!));
  switch (m2.phase[i]) {
    case 1:
      if (pos >= 0.245 || el >= 0.15) { m2.phase[i] = 2; m2.t0[i] = st.tick; sliderDrive(c, s, false, 0.25, 400 * f); }
      else sliderDrive(c, s, true, 3.125, 400 * f);
      break;
    case 2:
      sliderDrive(c, s, false, 0.25, 400 * f);
      if (el >= 0.3) { m2.phase[i] = 3; m2.t0[i] = st.tick; h.emit('Retract', i, h.local(i, [0, 0.05, 0.25]), 0, m2.cause[i]!); }
      break;
    case 3:
      sliderDrive(c, s, true, -0.625, 200);
      if (pos <= 0.005 || el >= 1) { m2.phase[i] = 0; sliderDrive(c, s, false, 0, 200); }
      break;
    default: sliderDrive(c, s, false, 0, 200);
  }
  if (m2.phase[i] !== 0) wakeArm(c, i);
}

/** PINGER: cock back 0.06 m over 0.18 s, fire forward at 4 m/s, settle back to rest over 0.3 s. */
function pinger(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, s = c.m3.slider[i];
  if (!s) return;
  const pos = s.GetCurrentPosition(), el = secs(c, i);
  switch (m2.phase[i]) {
    case 1:
      sliderDrive(c, s, true, -0.333, 200);
      if (pos <= -0.058 || el >= 0.25) { m2.phase[i] = 2; m2.t0[i] = st.tick; m2.cause[i] = h.emit('Fire', i, h.local(i, [0, 0.055, 0.16]), 4, m2.cause[i]!); st.lastEv[i] = m2.cause[i]!; }
      break;
    case 2:
      sliderDrive(c, s, true, 4, 800);
      if (pos >= 0.035 || el >= 0.06) { m2.phase[i] = 3; m2.t0[i] = st.tick; }
      break;
    case 3:
      sliderDrive(c, s, false, 0, 100, 10);
      if (el >= 0.3) m2.phase[i] = 0;
      break;
    default: sliderDrive(c, s, false, 0, 100, 10);
  }
  if (m2.phase[i] !== 0) wakeArm(c, i);
}

/** BONKER: swing to 95° at 16 rad/s (≈ 5 m/s at the head), hold 0.2 s, return at 4 rad/s; stands upright at rest. */
function bonker(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, hinge = h.parts[i]!.hinge;
  if (!hinge) return;
  const a = hinge.GetCurrentAngle(), el = secs(c, i);
  switch (m2.phase[i]) {
    case 1:
      hingeVel(c, hinge, 16, 40);
      if (a >= 95 * RAD || el >= 0.2) { m2.phase[i] = 2; m2.t0[i] = st.tick; m2.val[i] = a; }
      break;
    case 2:
      hingePos(c, hinge, m2.val[i]!, 40, 8);
      if (el >= 0.2) { m2.phase[i] = 3; m2.t0[i] = st.tick; h.emit('Retract', i, h.local(i, [0, 0.05, 0]), 0, m2.cause[i]!); }
      break;
    case 3:
      hingeVel(c, hinge, -4, 10);
      if (a <= 0.02 || el >= 1) m2.phase[i] = 0;
      break;
    default: hingePos(c, hinge, 0, 3, 4);
  }
  if (m2.phase[i] !== 0) wakeArm(c, i);
}

/** PADDLE: flip to +45° (from its −15° rest) at 20 rad/s, hold while signalled + 0.3 s, return at 8 rad/s. */
function paddle(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, hinge = h.parts[i]!.hinge;
  if (!hinge) return;
  const a = hinge.GetCurrentAngle();
  switch (m2.phase[i]) {
    case 1:
      hingeVel(c, hinge, 20, 30);
      if (a >= 44 * RAD || secs(c, i) >= 0.15) m2.phase[i] = 2;
      break;
    case 2:
      hingePos(c, hinge, 45 * RAD, 30, 10);
      if (st.tick >= st.m2.m3.n[i]!) { m2.phase[i] = 3; m2.t0[i] = st.tick; h.emit('Retract', i, h.local(i, [0.12, 0, 0]), 0, m2.cause[i]!); }
      break;
    case 3:
      hingeVel(c, hinge, -8, 10);
      if (a <= 0.01 || secs(c, i) >= 0.6) m2.phase[i] = 0;
      break;
    default: hingePos(c, hinge, 0, 6, 8);
  }
  if (m2.phase[i] !== 0) wakeArm(c, i);
}

/** SNAPTRAP: once tripped, the bar snaps over at 70 rad/s (tip ≈ 5 m/s) and stays sprung. */
function snaptrap(c: PartChannels, i: number): void {
  const h = c.h, m2 = h.st.m2, hinge = h.parts[i]!.hinge;
  if (!hinge) return;
  if (m2.phase[i] === 1) {
    hingeVel(c, hinge, 70, 1.5);
    if (hinge.GetCurrentAngle() >= (SNAPTRAP.limit - 3) * RAD || secs(c, i) >= 0.15) m2.phase[i] = 2;
    wakeArm(c, i);
  } else hinge.SetMotorState(h.Jolt.EMotorState_Off);
}

/** Trips a SNAPTRAP (pedal hit or weight). */
export function snap(c: PartChannels, i: number, cause: number, other: number): void {
  const st = c.h.st;
  if (st.m2.phase[i] !== 0 || !st.alive[i]) return;
  st.m2.phase[i] = 1;
  st.m2.t0[i] = st.tick;
  st.m2.cause[i] = c.h.emit('Snap', i, c.h.local(i, [0.04, 0.02, 0]), 1, cause, other);
  st.lastEv[i] = st.m2.cause[i]!;
  wakeArm(c, i);
}

/** FLINGER: the stop bar is the hinge's upper limit (set from `angle` every tick); fired, the arm whips to it. */
function flinger(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!, hinge = p.hinge;
  if (!hinge) return;
  const stop = (FLINGER.cocked - (p.props.angle ?? 45)) * RAD;
  hinge.SetLimits(0, f32(stop));
  if (m2.phase[i] === 0 && st.alive[i]) {
    // the trigger hook: ≥ 4 N on a LINE tied to it releases the arm
    const port = p.portIndex.get('trigger');
    for (const l of h.lines) {
      if (l.sheave >= 0) continue;
      const mine = l.a.part === i && p.def.ports[port!] === l.a.port ? l.b : l.b.part === i && p.def.ports[port!] === l.b.port ? l.a : null;
      if (!mine) continue;
      const tension = Math.abs(h.Jolt.castObject(l.constraint, h.Jolt.DistanceConstraint).GetTotalLambdaPosition()) / h.dt;
      if (tension >= 4) { trigger(c, i, st.lastEv[mine.part] ?? -1, [-0.04, 0.07, 0.138]); break; }
    }
  }
  switch (m2.phase[i]) {
    case 1:
      hingeVel(c, hinge, 25 * Math.min(1, secs(c, i) / 0.12), 80); // ramped: the payload rides the whole swing
      if (hinge.GetCurrentAngle() >= stop - 2 * RAD || secs(c, i) >= 0.4) {
        m2.phase[i] = 2;
        m2.cause[i] = h.emit('Fire', i, h.local(i, [FLINGER.axle[0], FLINGER.axle[1] + FLINGER.cupR, 0], 'arm'), 25 * FLINGER.cupR, m2.cause[i]!);
        st.lastEv[i] = m2.cause[i]!;
      }
      wakeArm(c, i);
      break;
    case 2: hingePos(c, hinge, stop, 20, 6); break;
    default: hinge.SetMotorState(h.Jolt.EMotorState_Off);
  }
}

/**
 * GLIDEPATH booster: while its drive turns (|ω| > 0.3 rad/s) every marble over its 0.30 m (centre inside the sensor
 * box) is brought up to tyre speed |ω| × 10 (internal gearing) × 0.015 m along ±X (the spin's sign picks the way).
 */
function booster(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  if (p.arm < 0 || !st.alive[i]) return;
  const axis = qrot(p.rot, p.def.hinge!.axis);
  const w = vdot(bodyAngVel(h.bodies[p.arm]!.body), axis);
  m2.val[i] = w;
  if (Math.abs(w) <= 0.3) return;
  const target = Math.abs(w) * BOOSTER.gear * BOOSTER.tyreR;
  const dir: Vec = vscale(qrot(bodyRot(h.bodies[p.base]!.body), [1, 0, 0]), w > 0 ? 1 : -1);
  for (const k of [...c.list('glint'), ...c.list('bearing')]) {
    if (!st.alive[k]) continue;
    const b = h.bodies[h.parts[k]!.base]!;
    const l = toLocal(c, i, bodyPos(b.body));
    if (Math.abs(l[0]) > BOOSTER.half[0] || Math.abs(l[1] - BOOSTER.sensorY) > BOOSTER.half[1] || Math.abs(l[2]) > BOOSTER.half[2]) continue;
    const v = bodyVel(b.body), along = vdot(v, dir);
    if (along >= target) continue;
    const inv = b.body.GetMotionProperties().GetInverseMass();
    if (inv <= 0) continue;
    const imp = vscale(dir, (target - along) / inv);
    h.bi.AddImpulse(b.body.GetID(), h.v3(imp[0], imp[1], imp[2]));
    h.bi.ActivateBody(b.body.GetID());
    // one Boost event per pass (a marble boosted last tick is still the same pass)
    if (m2.val2[k]! !== st.tick - 1) h.emit('Boost', i, bodyPos(b.body), target, st.lastEv[i] ?? -1, k);
    m2.val2[k] = st.tick;
  }
}

// ---- stage 9: contacts -------------------------------------------------------------------------------------------

export function motionContact(c: PartChannels, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, pos: Vec, added: boolean, cause: number): boolean {
  const h = c.h, p = h.parts[pi]!;
  switch (p.def.type) {
    case 'lift': {
      // weight on the deck (persisted contacts), for the 15 kg limit
      if (mb.role !== 'arm' || !ob?.dynamic) return true;
      const inv = ob.body.GetMotionProperties().GetInverseMass();
      c.m3.deckMass.set(pi, (c.m3.deckMass.get(pi) ?? 0) + (inv > 0 ? 1 / inv : 0));
      return true;
    }
    case 'snaptrap': {
      if (mb.role !== 'base' || !ob?.dynamic || h.st.m2.phase[pi] !== 0) return true;
      const l = toLocal(c, pi, pos);
      if (l[0] < SNAPTRAP.pedalX[0] || l[0] > SNAPTRAP.pedalX[1] || l[1] < SNAPTRAP.pedalY) return true;
      if (added && J >= SNAPTRAP.J) { snap(c, pi, cause, ob.part); return true; }
      const inv = ob.body.GetMotionProperties().GetInverseMass();
      c.m3.pedalMass.set(pi, (c.m3.pedalMass.get(pi) ?? 0) + (inv > 0 ? 1 / inv : 0));
      c.m3.pedalCause.set(pi, cause);
      return true;
    }
    default: return false;
  }
}

/** After all contacts: LIFT deck weight, SNAPTRAP pedal weight. */
export function motionAfterContacts(c: PartChannels): void {
  const m2 = c.h.st.m2;
  for (const i of c.list('lift')) m2.val2[i] = c.m3.deckMass.get(i) ?? 0;
  for (const [i, kg] of c.m3.pedalMass) if (kg >= SNAPTRAP.kg - 1e-9) snap(c, i, c.m3.pedalCause.get(i) ?? -1, -1);
  c.m3.deckMass.clear();
  c.m3.pedalMass.clear();
  c.m3.pedalCause.clear();
}

/** Flags: ready LEDs (lit) on BONKER, PINGER and a cocked FLINGER; pressed while a mechanism is out; LIFT lit while moving. */
export function motionFlags(c: PartChannels, i: number): number {
  const m2 = c.h.st.m2, ph = m2.phase[i]!;
  switch (c.h.parts[i]!.def.type) {
    case 'bonker': case 'pinger': case 'flinger': return ph === 0 ? 1 : 4;
    case 'ram': return (ph === 0 ? 0 : 4) | (m2.val2[i]! > 0 ? 64 : 0);
    case 'paddle': return ph === 0 ? 0 : 4;
    case 'snaptrap': return ph === 0 ? 0 : 4;
    case 'lift': return (ph === 1 || ph === 3 ? 1 : 0) | (m2.m3.n[i] ? 64 : 0);
    case 'glidepath_booster': return Math.abs(m2.val[i]!) > 0.3 ? 2 : 0;
    default: return 0;
  }
}

