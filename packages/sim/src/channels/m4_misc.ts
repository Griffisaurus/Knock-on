// M4 misc parts (stream A4): ARC TOWER (SIMULATION §5.7 strikes), TOAST CANNON (pooled slices, D66), YOLK (splat; also
// HENNY lays YOLKs from B4's own pool) and QUACK (a cosmetic squeak: no Sound event, so critters never hear it).

import { ARC_TOWER, QUACK, TOAST, YOLK } from '@knockon/parts-data';
import { qrot, vadd, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { bodyRot, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import { eachPushable } from './m3.ts';
import type { M4Parts } from './m4.ts';

const steel = (def: { body: { magnetic?: boolean; material?: string } } | null): boolean => !!def && (def.body.magnetic === true || def.body.material === 'steel');

// ---- stage 5: ARC TOWER heat ------------------------------------------------------------------------------------------

/** Strike heat spots still burning (r 0.03 m for 0.1 s each). */
export function arcHeat(m: M4Parts, out: number[]): void {
  const s = m.st, t = m.c.h.st.tick;
  for (let k = s.heat.length - 5; k >= 0; k -= 5) if (s.heat[k + 3]! < t) s.heat.splice(k, 5);
  for (let k = 0; k < s.heat.length; k += 5) out.push(s.heat[k]!, s.heat[k + 1]!, s.heat[k + 2]!, ARC_TOWER.heatR, s.heat[k + 4]!);
}

// ---- stage 6 ------------------------------------------------------------------------------------------------------------

export function miscBehave(m: M4Parts, i: number): boolean {
  switch (m.c.h.parts[i]!.def.type) {
    case 'arc_tower': arcTower(m, i); return true;
    case 'toast_cannon': toaster(m, i); return true;
    case 'yolk': case 'quack': return true;
    default: return false;
  }
}

/**
 * ARC TOWER: at supply ≥ 0.75 it charges for 0.5 s (`armed`), then strikes every 0.25 s while the supply holds: the
 * nearest steel body (material steel, or magnetic) whose centre is within 2 m of the toroid, ties by part order. A
 * strike is an `Arc` event (other = the target, mag = distance, pos = the hit point on the target's near side), an
 * 85 dB Sound, and a heat spot (r 0.03 m, 0.1 s) at the hit point. No impulse. Below 0.75 it drops back to off.
 */
function arcTower(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, t = h.st.tick;
  const f = h.st.supply[i]!;
  if (f < ARC_TOWER.needF - 1e-9) { s.ph[i] = 0; s.hold[i] = -1; return; }
  if (s.ph[i] === 0) { s.ph[i] = 1; s.t0[i] = t; s.cause[i] = h.st.lastEv[i] ?? -1; }
  const charge = Math.round(ARC_TOWER.chargeS * h.tickRate), every = Math.round(ARC_TOWER.everyS * h.tickRate);
  const since = t - s.t0[i]!;
  if (since < charge) return;
  s.ph[i] = 2;
  if ((since - charge) % every !== 0) return;
  const top = h.local(i, ARC_TOWER.toroid);
  let best = -1, bestD = ARC_TOWER.range + 1e-9, bestAt: Vec = [0, 0, 0], bestR = 0;
  eachPushable(m.c, (pb) => {
    if (pb.part === i || !steel(pb.def)) return;
    const c = h.bodies[pb.body]!.body.GetCenterOfMassPosition();
    const at: Vec = [c.GetX(), c.GetY(), c.GetZ()];
    const d = vlen(vsub(at, top));
    if (d < bestD) { best = pb.part; bestD = d; bestAt = at; bestR = pb.def ? minHalf(pb.def) : 0.01; }
  });
  s.hold[i] = best;
  if (best < 0) return; // brush discharges only (cosmetic: `lit` with no target)
  const hit = vadd(bestAt, vscale(vnorm(vsub(top, bestAt)), bestR));
  const id = h.emit('Arc', i, hit, bestD, s.cause[i]!, best);
  h.sound(hit, ARC_TOWER.dB, i, id);
  s.heat.push(hit[0], hit[1], hit[2], t + Math.round(ARC_TOWER.heatS * h.tickRate) - 1, id);
  h.st.lastEv[best] = id;
}

/** Half the smallest bounds extent: how far a part's surface sits from its centre, at least. */
function minHalf(def: { bounds: { min: readonly number[]; max: readonly number[] } }): number {
  const b = def.bounds;
  return Math.min(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!) / 2;
}

/**
 * TOAST CANNON: each rising edge of its supply through 0.75 starts a toast (`Trigger`, lever down); toasting advances
 * only while the supply holds; after `toast` seconds (3 by default) the stage 12 pops two slices (`Launch`, mag = 3 m/s). `n` counts toast ticks,
 * `open` remembers last tick's power, `ph` 0 idle, 1 toasting, 2 launch due, 3 cooling (1 s).
 */
function toaster(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, t = h.st.tick;
  const on = h.st.supply[i]! >= TOAST.needF - 1e-9 ? 1 : 0;
  if (on && !s.open[i] && (s.ph[i] === 0 || s.ph[i] === 3)) {
    s.ph[i] = 1;
    s.n[i] = 0;
    s.cause[i] = h.emit('Trigger', i, h.local(i, [0.075, 0.13, 0.052]), 1, h.st.lastEv[i] ?? -1);
    h.st.lastEv[i] = s.cause[i]!;
  }
  s.open[i] = on;
  if (s.ph[i] === 1 && on) {
    s.n[i] = s.n[i]! + 1;
    if (s.n[i]! >= Math.round((h.parts[i]!.props.toast ?? TOAST.toastS) * h.tickRate)) s.ph[i] = 2;
  }
  if (s.ph[i] === 3 && t - s.t0[i]! >= h.tickRate) s.ph[i] = 0;
}

// ---- stage 12 -----------------------------------------------------------------------------------------------------------

/** TOAST CANNON launches: two slices from the pool's next two slots (a slot still in play is despawned first). */
export function miscSpawn(m: M4Parts, t: number): void {
  const h = m.c.h, s = m.st, m3 = m.c.m3, mst = h.st.m2.m3;
  for (const i of m.c.list('toast_cannon')) {
    if (!h.st.alive[i] || s.ph[i] !== 2) continue;
    const p = h.parts[i]!, pool = m3.pools[i]!;
    const rot = bodyRot(h.bodies[p.base]!.body);
    const up = qrot(rot, [0, 1, 0]);
    const at0 = h.local(i, TOAST.slots[0]!);
    const id = h.emit('Launch', i, at0, TOAST.speed, s.cause[i]!);
    for (const slot of TOAST.slots) {
      const sIdx = pool[s.aux[i]! % pool.length]!;
      s.aux[i] = (s.aux[i]! + 1) % pool.length;
      if (mst.live[sIdx]) { m3.despawn(sIdx); h.emit('Despawn', i, h.local(i, slot), 1, id); }
      m3.spawn(sIdx, h.local(i, slot), rot, vscale(up, TOAST.speed));
      mst.why[sIdx] = id;
    }
    h.st.lastEv[i] = id;
    s.ph[i] = 3;
    s.t0[i] = t;
  }
}

// ---- stage 9 ------------------------------------------------------------------------------------------------------------

/**
 * YOLK: any single contact of ≥ 0.3 N·s splats it (`Splat`, mag = J, at the contact, other = what hit it) and it leaves
 * play (HENNY's laid YOLKs are B4's pool and splat in critters/m4.ts by the same rule). QUACK: an impact of
 * ≥ 0.06 N·s squeaks (`Squeak`, mag = 0–1 intensity, 0.15 s cooldown); bodies resting on it add to its load (it squeaks
 * on the 0.3 kg rising edge, after contacts).
 */
export function miscContact(m: M4Parts, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, pos: Vec, added: boolean, cause: number): boolean {
  const h = m.c.h;
  const p = h.parts[pi]!;
  switch (p.def.type) {
    case 'yolk':
      if (mb.role === 'base' && added && J >= YOLK.breakJ - 1e-9 && h.st.alive[pi]) {
        const id = h.emit('Splat', pi, pos, J, cause, ob ? ob.part : -1);
        h.st.lastEv[pi] = id;
        h.kill(pi);
      }
      return true;
    case 'quack': {
      if (mb.role !== 'base') return true;
      if (added && J >= QUACK.squeakJ - 1e-9) squeak(m, pi, pos, Math.min(1, J / 0.5), cause);
      if (ob?.dynamic && toLocal(m.c, pi, pos)[1] > 0) {
        const inv = ob.body.GetMotionProperties().GetInverseMass();
        if (inv > 0) m.load.set(pi, (m.load.get(pi) ?? 0) + 1 / inv);
        m.loadCause.set(pi, Math.max(m.loadCause.get(pi) ?? -1, cause));
      }
      return true;
    }
    default: return false;
  }
}

function squeak(m: M4Parts, i: number, pos: Vec, mag: number, cause: number): void {
  const h = m.c.h;
  if (h.st.cooldown[i]! > 0) return;
  h.st.cooldown[i] = Math.round(QUACK.coolS * h.tickRate);
  h.st.pressed[i] = Math.round(0.12 * h.tickRate); // sk_squash
  h.emit('Squeak', i, pos, mag, cause);
}

/** End of stage 9: QUACK squeaks when the load on it crosses 0.3 kg (n = last tick over). */
export function miscAfterContacts(m: M4Parts): void {
  const h = m.c.h, s = m.st;
  for (const i of m.c.list('quack')) {
    if (!h.st.alive[i]) continue;
    const over = (m.load.get(i) ?? 0) >= QUACK.squeakKg - 1e-9 ? 1 : 0;
    if (over && !s.n[i]) squeak(m, i, h.com(i), 0.5, m.loadCause.get(i) ?? -1);
    if (over) h.st.pressed[i] = Math.max(h.st.pressed[i]!, 2);
    s.n[i] = over;
  }
}

// ---- outputs ----------------------------------------------------------------------------------------------------------

/** Flags: ARC TOWER `armed` while charging, `lit` while arcing; TOAST CANNON `lit` while toasting or cooling, `armed` while toasting. */
export function miscFlags(m: M4Parts, i: number): number {
  const s = m.st;
  switch (m.c.h.parts[i]!.def.type) {
    case 'arc_tower': return s.ph[i] === 1 ? 16 : s.ph[i] === 2 ? 1 : 0;
    case 'toast_cannon': return s.ph[i] === 1 || s.ph[i] === 2 ? 1 | 16 : s.ph[i] === 3 ? 1 : 0;
    default: return 0;
  }
}
