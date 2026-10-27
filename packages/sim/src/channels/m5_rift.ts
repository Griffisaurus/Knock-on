// RIFT GATES (stream A5, SIMULATION §5.12): paired single-sided portals. Stage 12, pairs in part order (by their first
// gate), gates in part order, bodies in part order (`eachLive`: never a
// critter, a carried item or any other ghost; B5's request).
//
// A body transits when it's moving into a gate's front, its centre is inside the aperture (r ≤ 0.155 m), it fits
// (half-extent ≤ 0.155 m) and its leading surface reaches the membrane within the next step (centre within r + |v_z|·dt of
// the membrane plane): the closed backplate sits just behind the membrane, so no Roller's centre could ever cross it.
// Position, orientation, velocity and spin are carried by B·R·A⁻¹, R = 180° about the gate's up axis (a body going into A's
// front comes out of B's front; "mirrored through the gate", keeping handedness); it appears just in front of B's
// membrane. One transit per pair every 0.25 s: during that cooldown a body arriving at either gate bounces off the
// membrane (its inward speed reversed × 0.5, `Bounce`), and since the cooldown starts when a body arrives, it can't
// re-enter within 0.25 s either.
//
// Only free bodies transit: dynamic bases of parts with no hinge arm, slider, piece or pool, not tied by an intact LINE,
// not a seated HELIO and not a HOVER PAD; live pool slots (FABRICATOR parts, toast slices); broken parts' chunks. Anything
// else bounces. Critters transit through B5's hook at the end of this file (riftCritters: capsule, ragdoll and AI move together).
//
// Power topology (SIMULATION §5.5 lists "Rift moves" as a topology change): components are union-find over cable links,
// which follow parts, not positions, so a powered part that transits keeps its supply and nothing is rebuilt.
//
// Rollback: a transit is SetPositionRotationAndVelocity (Jolt's state records it) plus the pair cooldown in `st.m2.m5.cd`;
// nothing to re-derive after a restore.

import { RIFT, RIFT_PAIRS } from '@knockon/parts-data';
import { f32 } from '@knockon/detmath';
import { qmul, qrot, vadd, vlen, vsub, type Q, type Vec } from '../vec.ts';
import { bodyAngVel, bodyPos, bodyRot, bodyVel, type HostBody } from './host.ts';
import type { Pushable } from './m3.ts';
import { eachLive } from './m5_field.ts';
import type { M5Parts } from './m5.ts';

const conj = (q: readonly number[]): Q => [-q[0]!, -q[1]!, -q[2]!, q[3]!];
const YAW_PI: Q = [0, 1, 0, 0];

/** Pairs gates of a colour in part order: 1st with 2nd, 3rd with 4th …; an odd one out stays unpaired. */
export function riftInit(m: M5Parts): void {
  const gates = m.c.list('rift_gate');
  for (let colour = 0; colour < RIFT_PAIRS.length; colour++) {
    const same = gates.filter((i) => Math.max(0, Math.min(RIFT_PAIRS.length - 1, m.h.parts[i]!.props.pair ?? 0)) === colour);
    for (let k = 0; k + 1 < same.length; k += 2) { m.partner[same[k]!] = same[k + 1]!; m.partner[same[k + 1]!] = same[k]!; }
  }
}

/** Can this body transit (see the header)? */
function free(m: M5Parts, pb: Pushable): boolean {
  const h = m.h, c = m.c, b: HostBody = h.bodies[pb.body]!;
  if (b.role === 'chunk') return true;
  if (b.role === 'piece') return c.m3.slotBody.includes(pb.body);
  if (b.role !== 'base') return false;
  const p = h.parts[pb.part]!;
  if (p.arm >= 0 || p.hinge || p.def.type === 'hover_pad' || (p.def.type === 'helio' && (c.m4.seatedOn[pb.part] ?? -1) >= 0)) return false;
  if ((c.pieceOf[pb.part] ?? -1) >= 0 || (c.m3.piece[pb.part] ?? -1) >= 0 || c.m3.slider[pb.part] || c.sliders[pb.part] || (c.m3.pools[pb.part]?.length ?? 0) > 0) return false;
  const cut = (h.st as unknown as { cut: boolean[] }).cut;
  return !h.lines.some((l, li) => !cut[li] && (l.a.part === pb.part || l.b.part === pb.part));
}

export function riftSpawn(m: M5Parts, t: number): void {
  const h = m.h, st = h.st;
  for (const a of m.c.list('rift_gate')) {
    const b = m.partner[a]!;
    if (b < a || !st.alive[a] || !st.alive[b]) continue; // each pair once, from its first gate
    gate(m, a, b, a, t);
    gate(m, b, a, a, t);
  }
}

/** Bodies arriving at gate `g` (partner `o`; the pair's cooldown lives on both gates, read from `key`). */
function gate(m: M5Parts, g: number, o: number, key: number, t: number): void {
  const h = m.h, st = h.st, s5 = m.st;
  const G = h.parts[g]!, O = h.parts[o]!, qi = conj(G.rot);
  const arrivals: { pb: Pushable; l: Vec; vl: Vec }[] = [];
  eachLive(m.c, (pb) => {
    if (pb.half > RIFT.radius) return;
    const body = h.bodies[pb.body]!.body;
    const c = body.GetCenterOfMassPosition();
    const l = qrot(qi, vsub([c.GetX(), c.GetY(), c.GetZ()], G.pos));
    const dx = l[0] - RIFT.centre[0], dy = l[1] - RIFT.centre[1];
    if (dx * dx + dy * dy > RIFT.radius * RIFT.radius) return;
    const vl = qrot(qi, bodyVel(body));
    if (vl[2] >= 0 || l[2] <= RIFT.back) return; // not moving in, or behind the backplate's face
    if (l[2] - pb.half > RIFT.membrane - vl[2] * h.dt + 1e-4) return; // its front doesn't reach the membrane this step
    arrivals.push({ pb, l, vl });
  });
  for (const { pb, l, vl } of arrivals) {
    const body = h.bodies[pb.body]!.body, id = body.GetID();
    const part = pb.part;
    const at = h.local(g, RIFT.centre);
    if (t < s5.cd[key]! || !free(m, pb)) {
      // overflow (or a body that can't travel): it bounces off the membrane
      const nv = qrot(G.rot, [vl[0], vl[1], -vl[2] * RIFT.bounce]);
      h.bi.SetLinearVelocity(id, h.v3(nv[0], nv[1], nv[2]));
      const e = h.emit('Bounce', g, at, vlen(vl), st.lastEv[part] ?? -1, part);
      st.lastEv[part] = e;
      continue;
    }
    // B·R·A⁻¹: the centre appears just in front of the partner's membrane, mirrored across (x → −x), same height
    const R = qmul(qmul(O.rot, YAW_PI), qi);
    const c0 = vadd(G.pos, qrot(G.rot, l));
    const c1 = vadd(O.pos, qrot(O.rot, [-l[0], l[1], RIFT.membrane + pb.half + RIFT.exitGap]));
    const p0 = bodyPos(body), q0 = bodyRot(body);
    const p1 = vadd(c1, qrot(R, vsub(p0, c0)));
    const q1 = qmul(R, q0);
    const v1 = qrot(R, bodyVel(body)), w1 = qrot(R, bodyAngVel(body));
    m.c.rv.Set(f32(p1[0]), f32(p1[1]), f32(p1[2]));
    m.c.qq.Set(f32(q1[0]), f32(q1[1]), f32(q1[2]), f32(q1[3]));
    m.va.Set(f32(v1[0]), f32(v1[1]), f32(v1[2]));
    m.vb.Set(f32(w1[0]), f32(w1[1]), f32(w1[2]));
    h.bi.SetPositionRotationAndVelocity(id, m.c.rv, m.c.qq, m.va, m.vb);
    h.bi.ActivateBody(id);
    const cool = t + Math.max(1, Math.round(RIFT.coolS * h.tickRate));
    s5.cd[g] = s5.cd[o] = cool;
    st.pressed[g] = st.pressed[o] = Math.round(0.2 * h.tickRate);
    const speed = vlen(v1);
    const tp = h.emit('Teleport', g, at, speed, st.lastEv[part] ?? -1, part);
    st.lastEv[part] = h.emit('Emerge', o, h.local(o, RIFT.centre), speed, tp, part);
    st.lastEv[g] = tp;
  }
  riftCritters(m, g, o, key, t); // B5 (M5): then the critters arriving at this gate
}

// ---- B5 (M5): animal critters transit too (future.md RIFT GATES: the Ø 0.31 aperture passes MOCHI, PIP, GOBY, BANDIT,
// HENNY and BISCUIT; DUSTY and BUZZ are too big and bounce off the frame). The critter system (critters/system.ts) lists the
// candidates (a free critter's locomotion capsule, a ragdoll's root capsule; never a robot, a trapped, bound or rescued
// critter) and moves the whole critter: its body, or every ragdoll capsule plus its ghost base. Same rules as bodies:
// moving into the front, the capsule inside the aperture (centre within r − capsule radius), its leading surface reaching
// the membrane this step, the pair's cooldown (a bounce while it's on), B·R·A⁻¹, Teleport / Emerge events. Critters go
// after the gate's bodies, in part order. Rollback: poses are Jolt state, the cooldown and the critter's goal plain state.

interface CritterRift {
  riftCandidates(): readonly { readonly k: number; readonly part: number; readonly at: Vec; readonly v: Vec; readonly axis: Vec; readonly halfLen: number; readonly radius: number }[];
  riftBounce(k: number, n: readonly number[], e: number): void;
  riftMove(k: number, c0: readonly number[], c1: readonly number[], R: readonly number[]): number;
}

function riftCritters(m: M5Parts, g: number, o: number, key: number, t: number): void {
  const h = m.h, st = h.st, s5 = m.st;
  const cs = (h as unknown as { critters?: CritterRift }).critters;
  if (!cs?.riftCandidates) return;
  const G = h.parts[g]!, O = h.parts[o]!, qi = conj(G.rot);
  for (const cr of cs.riftCandidates()) {
    const l = qrot(qi, vsub(cr.at, G.pos));
    const lim = RIFT.radius - cr.radius;
    const dx = l[0] - RIFT.centre[0], dy = l[1] - RIFT.centre[1];
    if (lim <= 0 || dx * dx + dy * dy > lim * lim) continue;
    const vl = qrot(qi, cr.v);
    if (vl[2] >= 0 || l[2] <= RIFT.back) continue;
    const half = Math.abs(qrot(qi, cr.axis)[2]) * cr.halfLen + cr.radius; // its extent along the gate's normal
    if (l[2] - half > RIFT.membrane - vl[2] * h.dt + 1e-4) continue;
    const at = h.local(g, RIFT.centre);
    if (t < s5.cd[key]!) {
      cs.riftBounce(cr.k, qrot(G.rot, [0, 0, 1]), RIFT.bounce);
      st.lastEv[cr.part] = h.emit('Bounce', g, at, vlen(vl), st.lastEv[cr.part] ?? -1, cr.part);
      continue;
    }
    const R = qmul(qmul(O.rot, YAW_PI), qi);
    const c1 = vadd(O.pos, qrot(O.rot, [-l[0], l[1], RIFT.membrane + half + RIFT.exitGap]));
    const speed = cs.riftMove(cr.k, cr.at, c1, R);
    s5.cd[g] = s5.cd[o] = t + Math.max(1, Math.round(RIFT.coolS * h.tickRate));
    st.pressed[g] = st.pressed[o] = Math.round(0.2 * h.tickRate);
    const tp = h.emit('Teleport', g, at, speed, st.lastEv[cr.part] ?? -1, cr.part);
    st.lastEv[cr.part] = h.emit('Emerge', o, h.local(o, RIFT.centre), speed, tp, cr.part);
    st.lastEv[g] = tp;
  }
}

/** Flags: lit while paired, armed during the pair's cooldown (LEDs at 30 %); `pressed` 0.2 s after a transit (the Machine's). */
export function riftFlags(m: M5Parts, i: number): number {
  if (m.h.parts[i]!.def.type !== 'rift_gate') return 0;
  const o = m.partner[i]!;
  if (o < 0) return 0;
  const key = Math.min(i, o);
  return 1 | (m.h.st.tick < m.st.cd[key]! ? 16 : 0);
}
