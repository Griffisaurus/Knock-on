// Power channel, M2 additions (SIMULATION §5.5): TOGGLE topology, CELL / DYNAMO / SUNCELL supply,
// and the DYNAMO's shaft brake (no free energy).

import { f32 } from '@knockon/detmath';
import type { PartId } from '@knockon/format';
import { qrot, vdot } from '../vec.ts';
import type { PartChannels } from './index.ts';
import { bodyAngVel } from './host.ts';

/**
 * Power components by union-find over cable links, with each TOGGLE split into an `in` node and an
 * `out_power` node that are joined only while it's on. Writes `h.powerComp` in place (part → root).
 * Recomputed every tick while the machine has toggles: cheap, and it can never go stale on rollback.
 */
export function powerTopology(c: PartChannels): void {
  const h = c.h;
  const toggles = c.list('toggle');
  if (!toggles.length) return;
  const n = h.parts.length;
  const outNode = new Map<number, number>();
  toggles.forEach((i, k) => outNode.set(i, n + k));
  const uf = Array.from({ length: n + toggles.length }, (_, i) => i);
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]!]!; x = uf[x]!; } return x; };
  const node = (end: { part: PartId; port: number } | null): number => {
    if (!end) return -1;
    const i = h.byId.get(end.part);
    if (i === undefined) return -1;
    const p = h.parts[i]!;
    if (p.def.type === 'toggle' && p.def.ports[end.port]?.name === 'out_power') return outNode.get(i)!;
    return i;
  };
  for (const l of h.links) {
    if (l.kind !== 'cable_power') continue;
    const a = node(l.from), b = node(l.to);
    if (a < 0 || b < 0) continue;
    uf[find(a)] = find(b);
  }
  for (const i of toggles) if (h.st.m2.on[i] && h.st.alive[i]) uf[find(i)] = find(outNode.get(i)!);
  for (let i = 0; i < n; i++) h.powerComp[i] = find(i);
}

/** Supply (W) a non-MAINS source offers this tick. */
export function sourceWatts(c: PartChannels, i: number): number {
  const h = c.h, m2 = h.st.m2;
  switch (h.parts[i]!.def.type) {
    case 'cell': return m2.val[i]! > 0 ? 200 : 0;
    case 'dynamo': return m2.val[i]!;
    case 'suncell': return 150 * Math.min(1, m2.val[i]!);
    default: return 0;
  }
}

/** After the supply factors are solved: each source delivers its share; cells drain, dynamos note the load. */
export function afterPower(c: PartChannels, S: ReadonlyMap<number, number>, D: ReadonlyMap<number, number>): void {
  const h = c.h, st = h.st, m2 = st.m2;
  const share = (i: number): number => {
    const comp = h.powerComp[i]!;
    const s = S.get(comp) ?? 0, d = D.get(comp) ?? 0;
    return s > 0 ? Math.min(1, d / s) : 0;
  };
  for (const i of c.list('cell')) {
    if (!st.alive[i] || m2.val[i]! <= 0) continue;
    m2.val[i] = m2.val[i]! - 200 * share(i) * h.dt;
    if (m2.val[i]! <= 0) {
      m2.val[i] = 0;
      // running flat is a power-topology change: consumers that lose power next tick point here
      st.powerCause = h.emit('Unpowered', i, h.com(i), 0, st.lastEv[i] ?? -1);
    }
  }
  for (const i of c.list('dynamo')) m2.val2[i] = st.alive[i] ? m2.val[i]! * share(i) : 0;
}

/** DYNAMO, stage 6: the brake for the power drawn this tick, τ = P_drawn / (0.6 · max(|ω|, 1 rad/s)). */
export function dynamoBrake(c: PartChannels, i: number): void {
  const h = c.h, m2 = h.st.m2, p = h.parts[i]!;
  if (!p.hinge || p.arm < 0) return;
  const w = vdot(bodyAngVel(h.bodies[p.arm]!.body), qrot(p.rot, p.def.hinge!.axis));
  // the brake is the hinge's friction torque: solved with the constraints, so it slows the rotor
  // without ever reversing it (set every tick, so a rollback can't leave a stale value)
  p.hinge.SetMaxFrictionTorque(f32(m2.val2[i]! / (0.6 * Math.max(Math.abs(w), 1))));
}

/**
 * DYNAMO, right after the physics step: available output for the next tick,
 * W = min(300, 40·|ω|, 0.6 · P_shaft + 2 W), where P_shaft is the shaft power its belts delivered in
 * that step (|gear impulse| / dt · |ω|). The brake makes every drawn watt cost 1/0.6 W of shaft power,
 * so the output can only follow what the drive really delivers; the 2 W per tick lets it ramp up to
 * meet a new load (otherwise any output level would be its own fixed point).
 */
export function dynamoOutput(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  if (p.arm < 0 || !st.alive[i]) { m2.val[i] = 0; return; }
  const w = Math.abs(vdot(bodyAngVel(h.bodies[p.arm]!.body), qrot(p.rot, p.def.hinge!.axis)));
  let torque = 0;
  for (const bd of h.bands) {
    if (bd.a.part !== i && bd.b.part !== i) continue;
    torque += Math.abs(h.Jolt.castObject(bd.constraint, h.Jolt.GearConstraint).GetTotalLambda()) / h.dt;
  }
  m2.val[i] = w < 0.5 ? 0 : Math.min(300, 40 * w, 0.6 * torque * w + 2);
}
