// M4 ZIPPY (stream A4, SIMULATION §4.4): a Jolt VehicleConstraint with a WheeledVehicleController on the part's body
// (four ray-cast wheels, rear-wheel drive through one differential, no steering). It is built with the world and stepped
// by Jolt (a VehicleConstraintStepListener); its wheel and controller state is part of Jolt's SaveState, so rollback
// restores it. Each stage 6 sets the driver input from `st` (a speed hold toward the `speed` prop), so the inputs are
// plain state too.

import { f32 } from '@knockon/detmath';
import { ZIPPY } from '@knockon/parts-data';
import { qrot, vdot, type Vec } from '../vec.ts';
import { L_MOVING, bodyRot, bodyVel, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import type { M4Parts } from './m4.ts';

/** Builds part `i`'s vehicle (an anchored ZIPPY, a static body, gets none). */
export function buildVehicle(m: M4Parts, i: number): void {
  const h = m.c.h, J = h.Jolt, p = h.parts[i]!;
  const base = h.bodies[p.base]!;
  if (!base.dynamic) return;
  const v3 = (x: number, y: number, z: number): unknown => new J.Vec3(f32(x), f32(y), f32(z));
  const vs = new J.VehicleConstraintSettings();
  vs.mUp = v3(0, 1, 0);
  vs.mForward = v3(1, 0, 0);
  vs.mMaxPitchRollAngle = f32(Math.PI);
  for (const w of ZIPPY.wheels) {
    const ws = new J.WheelSettingsWV();
    // the suspension's top sits suspMax above the wheel centre at rest (wheel bottoms on the ground at y −0.035)
    ws.mPosition = v3(w[0], w[1] + (ZIPPY.suspMin + ZIPPY.suspMax) / 2, w[2]);
    ws.mSuspensionDirection = v3(0, -1, 0);
    ws.mSteeringAxis = v3(0, 1, 0);
    ws.mWheelUp = v3(0, 1, 0);
    ws.mWheelForward = v3(1, 0, 0);
    ws.mSuspensionMinLength = f32(ZIPPY.suspMin);
    ws.mSuspensionMaxLength = f32(ZIPPY.suspMax);
    ws.mSuspensionSpring.mFrequency = f32(ZIPPY.springHz);
    ws.mSuspensionSpring.mDamping = f32(ZIPPY.damping);
    ws.mRadius = f32(ZIPPY.wheelR);
    ws.mWidth = f32(ZIPPY.wheelW);
    ws.mInertia = f32(2e-4);
    ws.mMaxSteerAngle = f32(0);
    ws.mMaxBrakeTorque = f32(ZIPPY.brake);
    ws.mMaxHandBrakeTorque = f32(0);
    vs.mWheels.push_back(ws);
  }
  const cs = new J.WheeledVehicleControllerSettings();
  cs.mEngine.mMaxTorque = f32(ZIPPY.maxTorque);
  cs.mEngine.mMinRPM = f32(0);
  cs.mEngine.mMaxRPM = f32(4000);
  cs.mEngine.mInertia = f32(2e-4);
  cs.mTransmission.mMode = J.ETransmissionMode_Auto;
  cs.mTransmission.mGearRatios.clear();
  cs.mTransmission.mGearRatios.push_back(f32(1));
  cs.mTransmission.mReverseGearRatios.clear();
  cs.mTransmission.mReverseGearRatios.push_back(f32(-1));
  cs.mDifferentials.clear();
  const diff = new J.VehicleDifferentialSettings();
  diff.mLeftWheel = 2;
  diff.mRightWheel = 3;
  diff.mDifferentialRatio = f32(1);
  cs.mDifferentials.push_back(diff);
  vs.mController = cs;
  const c = new J.VehicleConstraint(base.body, vs); // (the constraint keeps references into its settings: not destroyed)
  c.SetVehicleCollisionTester(new J.VehicleCollisionTesterRay(L_MOVING, v3(0, 1, 0), f32(Math.PI / 2.2)));
  h.system.AddConstraint(c);
  h.system.AddStepListener(new J.VehicleConstraintStepListener(c));
  m.vehicle[i] = { constraint: c, controller: J.castObject(c.GetController(), J.WheeledVehicleController) };
}

/** ZIPPY `go`: parked → drive forward; driving (either way) → stop. `Drive` (mag = new direction: 1, −1 or 0). */
export function vehicleSignal(m: M4Parts, i: number, port: string, cause: number): boolean {
  const h = m.c.h, s = m.st;
  if (h.parts[i]!.def.type !== 'zippy') return false;
  if (port !== 'go') return true;
  h.st.pressed[i] = Math.round(0.2 * h.tickRate);
  setDrive(m, i, s.open[i] ? 0 : 1, cause);
  return true;
}

function setDrive(m: M4Parts, i: number, dir: number, cause: number): void {
  const h = m.c.h, s = m.st;
  if (s.open[i] === dir) return;
  s.open[i] = dir;
  s.n[i] = 0;
  s.cause[i] = h.emit('Drive', i, h.com(i), dir, cause);
  h.st.lastEv[i] = s.cause[i]!;
}

/**
 * Stage 6: driver input. Driving, the throttle holds the `speed` prop: (target − forward speed) / (0.3 × target),
 * clamped to 0–1 in the driving direction, with a light brake when it runs 20 % over; stopped, the brakes are on.
 * Driving at under 10 % of the target speed for 0.5 s shows `fault` (blocked: the wheels spin in place).
 */
export function vehicleBehave(m: M4Parts, i: number): boolean {
  const h = m.c.h, s = m.st, p = h.parts[i]!;
  if (p.def.type !== 'zippy') return false;
  const v = m.vehicle[i];
  if (!v) return true;
  const body = h.bodies[p.base]!.body;
  const fwd = qrot(bodyRot(body), [1, 0, 0]);
  const vf = vdot(bodyVel(body), fwd);
  const dir = s.open[i]!;
  const target = (p.props.speed ?? 1) * dir;
  let throttle = 0, brake = 0;
  if (dir !== 0) {
    const err = (target - vf) / (0.3 * Math.abs(target));
    throttle = Math.max(0, Math.min(1, err * dir)) * dir;
    if (vf * dir > Math.abs(target) * 1.2) brake = 0.3;
    h.bi.ActivateBody(body.GetID());
    const slow = Math.abs(vf) < 0.1 * Math.abs(target);
    s.n[i] = slow ? s.n[i]! + 1 : 0;
  } else { brake = 1; s.n[i] = 0; }
  v.controller.SetDriverInput(f32(throttle), f32(0), f32(brake), f32(0));
  return true;
}

/** Stage 9: a hit of ≥ 0.1 N·s on the nose (local x ≥ 0.06, above the wheels) stops, reverses or is ignored (`bump`). */
export function vehicleContact(m: M4Parts, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, pos: Vec, added: boolean, cause: number): boolean {
  const h = m.c.h, s = m.st, p = h.parts[pi]!;
  if (p.def.type !== 'zippy') return false;
  if (mb.role !== 'base' || !added || J < ZIPPY.bumpJ - 1e-9 || s.open[pi] !== 1 || !ob) return true;
  const l = toLocal(m.c, pi, pos);
  if (l[0] < ZIPPY.bumperX || l[1] < -0.03) return true; // the nose, not the ground under the wheels
  const mode = Math.round(p.props.bump ?? 0);
  if (mode === 0) setDrive(m, pi, 0, cause);
  else if (mode === 1) setDrive(m, pi, -1, cause);
  return true;
}

/** Flags: `lit` (headlights) while driving, `fault` while blocked, `pressed` (status blink) for 0.2 s after a signal. */
export function vehicleFlags(m: M4Parts, i: number): number {
  const h = m.c.h, s = m.st;
  if (h.parts[i]!.def.type !== 'zippy') return 0;
  return (s.open[i] ? 1 : 0) | (s.open[i] && s.n[i]! >= Math.round(ZIPPY.stallS * h.tickRate) ? 64 : 0);
}
