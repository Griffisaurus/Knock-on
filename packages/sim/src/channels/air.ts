// Air channel, M2 additions (SIMULATION §5.8): TURBINE rotors and PUFFER puffs.

import { qAxis, TURBINE } from '@knockon/parts-data';
import { qmul, qrot, vadd, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import type { PartChannels } from './index.ts';
import { bodyAngVel, bodyPos, bodyRot } from './host.ts';

const PUFF = { R: 1.5, cosHalf: 0.9397 /* cos 20° */, k: 12, maxJ: 10, maxDv: 8 } as const;
const BLADE_AREA = TURBINE.bladeLen * TURBINE.chord;
const BLADE_R = TURBINE.tip - TURBINE.bladeLen / 2;
/** sin 25° · cos 25°: the tangential share of a 25°-pitched blade's axial wind force. */
const PITCH_SHARE = 0.38;

/**
 * PARTSIM (D120): the rotor's speed governor. Past ≈ 35 rad/s the pitched blades' inner ends catch the hub block's
 * speculative contacts and the rotor stops dead (a hiccup measured under any steady drive, the GALE's too). The wind
 * drive fades out between 28 and 32 rad/s (≈ 300 rpm), so a strong wind holds it just under that. Below 28 rad/s it does
 * nothing, so a slower rotor turns exactly as before.
 */
const governor = (w: number): number => Math.max(0, Math.min(1, (32 - w) / 4));

/** Blade centres (world) and radial directions of a turbine's rotor, from its arm body's pose. */
function blades(c: PartChannels, i: number): { at: Vec; radial: Vec; axis: Vec; hub: Vec; w: number }[] {
  const h = c.h, p = h.parts[i]!;
  const arm = h.bodies[p.arm]!.body;
  const ap = bodyPos(arm), aq = bodyRot(arm);
  const hub = vadd(ap, qrot(aq, TURBINE.hub));
  const axis = vnorm(qrot(p.rot, [0, 0, 1]));
  const w = vdot(bodyAngVel(arm), axis);
  return TURBINE.angles.map((deg) => {
    const radial = qrot(qmul(aq, qAxis([0, 0, 1], deg)), [1, 0, 0]);
    return { at: vadd(hub, vscale(radial, BLADE_R)), radial, axis, hub, w };
  });
}

/**
 * Wind from an emitter on a TURBINE: per blade, the axial force F = ρ·C·s·A·(1 − d/R)² (the GALE's
 * formula) turns into a tangential force 0.38·F at the blade centre. A toy rotor can't outrun the wind:
 * the drive fades to zero as the blade speed reaches twice the local wind speed (6·s·(1 − d/R) m/s).
 */
export function turbineWind(c: PartChannels, k: number, nozzle: Vec, wind: Vec, R: number, cosHalf: number, f: number): void {
  const h = c.h, p = h.parts[k]!;
  if (p.arm < 0) return;
  let torque = 0;
  const bl = blades(c, k);
  for (const b of bl) {
    const d = vsub(b.at, nozzle), dist = vlen(d);
    if (dist > R || dist < 1e-6 || vdot(d, wind) / dist < cosHalf) continue;
    const fall = (1 - dist / R) * (1 - dist / R);
    const along = -vdot(wind, b.axis); // > 0: wind on the rotor's face
    const F = 1.225 * h.air * 9 * f * BLADE_AREA * fall * Math.abs(along);
    const vWind = 6 * f * (1 - dist / R);
    const s = along >= 0 ? 1 : -1;
    const drive = Math.max(0, 1 - (b.w * s * BLADE_R) / Math.max(2 * vWind, 1e-6)) * governor(b.w * s);
    torque += s * BLADE_R * PITCH_SHARE * F * drive;
  }
  if (torque === 0) return;
  const ax = bl[0]!.axis;
  h.bi.AddTorque(h.bodies[p.arm]!.body.GetID(), h.v3(ax[0] * torque, ax[1] * torque, ax[2] * torque), h.Jolt.EActivation_Activate);
}

/**
 * PARTSIM (beta, D120): D26's global wind on a TURBINE rotor (SIMULATION §5.8). The wind is uniform (`flow`, unit, at
 * speed `w` m/s, seeded gusts already in `w`), so every blade sees the same axial component w·a (a = how squarely the
 * wind meets the rotor face, cos of the angle to its axis). Per blade the axial force is F = q·A·a² (q = 1.225 · air · w²,
 * the global term's dynamic pressure; A = the blade's area), turned into a tangential force 0.38·F at the blade centre by
 * the 25° pitch, as for a GALE. The drive fades to zero as the blade speed reaches twice the axial wind speed. Wind from
 * behind turns it backwards; wind across the face (a = 0) doesn't turn it. Returns the torque about the rotor axis (N·m)
 * it applied (0: none). A sleeping rotor is only woken on `wake` ticks (once a second, like the global term's bodies).
 */
export function turbineGlobalWind(c: PartChannels, k: number, flow: readonly number[], w: number, wake: boolean): number {
  const h = c.h, p = h.parts[k]!;
  if (p.arm < 0) return 0;
  const bl = blades(c, k);
  const ax = bl[0]!.axis;
  const along = -(flow[0]! * ax[0] + flow[1]! * ax[1] + flow[2]! * ax[2]); // > 0: wind on the rotor's face
  if (Math.abs(along) < 1e-6) return 0;
  const F = 1.225 * h.air * w * w * BLADE_AREA * along * along;
  const s = along >= 0 ? 1 : -1;
  const vAx = w * Math.abs(along);
  const drive = Math.max(0, 1 - (bl[0]!.w * s * BLADE_R) / Math.max(2 * vAx, 1e-6)) * governor(bl[0]!.w * s);
  const torque = s * bl.length * BLADE_R * PITCH_SHARE * F * drive;
  if (torque === 0) return 0;
  const arm = h.bodies[p.arm]!.body;
  if (!arm.IsActive()) {
    if (!wake || Math.abs(torque) < TURBINE_WAKE) return 0;
    h.bi.ActivateBody(arm.GetID());
  }
  h.bi.AddTorque(arm.GetID(), h.v3(ax[0] * torque, ax[1] * torque, ax[2] * torque), h.Jolt.EActivation_DontActivate);
  return torque;
}
/** Least wind torque (N·m) that wakes a sleeping rotor: about a 0.5 m/s breeze square on its face. */
const TURBINE_WAKE = 1e-4;

/** PUFFER pad hit: queue a puff for the next stage 6 (impulse ∝ the hit, capped). */
export function queuePuff(c: PartChannels, i: number, J: number, cause: number): void {
  c.h.st.m2.puffs.push(i, Math.min(J, PUFF.maxJ), cause);
}

/**
 * Stage 6: resolve queued puffs. Each one is an impulse along the nozzle axis on every dynamic body in
 * its 1.5 m / 20° cone, I = 12·J·A·(1 − d/R)², capped at Δv 8 m/s; it douses a flame (wind 6·min(1,
 * J/2)·(1 − d/R) > 4 m/s) and kicks turbine rotors through their blade pitch.
 */
export function resolvePuffs(c: PartChannels): void {
  const h = c.h, st = h.st, m2 = st.m2;
  if (!m2.puffs.length) return;
  const q = m2.puffs;
  m2.puffs = [];
  for (let n = 0; n < q.length; n += 3) {
    const i = q[n]!, J = q[n + 1]!, cause = q[n + 2]!;
    if (!st.alive[i]) continue;
    const p = h.parts[i]!;
    const nozzle = h.local(i, [0.15, 0.055, 0]);
    const axis = vnorm(qrot(bodyRot(h.bodies[p.base]!.body), [1, 0, 0]));
    for (let k = 0; k < h.parts.length; k++) {
      if (k === i || !st.alive[k]) continue;
      const o = h.parts[k]!;
      if (o.def.type === 'turbine' && o.arm >= 0) {
        // angular impulse through the blade pitch
        let ang = 0;
        for (const b of blades(c, k)) {
          const d = vsub(b.at, nozzle), dist = vlen(d);
          if (dist > PUFF.R || dist < 1e-6 || vdot(d, axis) / dist < PUFF.cosHalf) continue;
          const fall = (1 - dist / PUFF.R) * (1 - dist / PUFF.R);
          const along = -vdot(axis, b.axis);
          ang += (along >= 0 ? 1 : -1) * BLADE_R * PITCH_SHARE * PUFF.k * J * BLADE_AREA * fall * Math.abs(along) * h.air;
        }
        if (ang !== 0) {
          const ax = vnorm(qrot(o.rot, [0, 0, 1]));
          h.bi.AddAngularImpulse(h.bodies[o.arm]!.body.GetID(), h.v3(ax[0] * ang, ax[1] * ang, ax[2] * ang));
          h.bi.ActivateBody(h.bodies[o.arm]!.body.GetID());
        }
        continue;
      }
      const target = o.def.type === 'wick' ? h.local(k, [0, 0.19, 0]) : h.com(k);
      const d = vsub(target, nozzle), dist = vlen(d);
      if (dist > PUFF.R || dist < 1e-6 || vdot(d, axis) / dist < PUFF.cosHalf) continue;
      const fall = (1 - dist / PUFF.R) * (1 - dist / PUFF.R);
      if (o.def.type === 'wick' && st.lit[k] && 6 * Math.min(1, J / 2) * (1 - dist / PUFF.R) > 4) {
        st.lit[k] = false;
        h.emit('Extinguish', k, target, 0, cause);
      }
      const b = h.bodies[o.base]!;
      if (!b.dynamic || b.ghost) continue;
      const inv = b.body.GetMotionProperties().GetInverseMass();
      if (inv <= 0) continue;
      const ext = vsub(o.def.bounds.max, o.def.bounds.min);
      const area = (ext[0]! * ext[1]! + ext[1]! * ext[2]! + ext[0]! * ext[2]!) / 3;
      const I = Math.min(PUFF.k * J * area * fall * h.air, PUFF.maxDv / inv);
      h.bi.AddImpulse(b.body.GetID(), h.v3(axis[0] * I, axis[1] * I, axis[2] * I));
      h.bi.ActivateBody(b.body.GetID());
      if (cause >= 0) st.lastEv[k] = cause;
    }
  }
}
