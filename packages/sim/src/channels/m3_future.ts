// M3 future tech (stream A3): FABRICATOR (spawns from a finite pre-built dormant pool, D66) and RECYCLER (despawns
// into that pool, or out of play, and signals its count). Both run in stage 12 (SIMULATION §2), in part order.

import { FABRICATOR, RECYCLER } from '@knockon/parts-data';
import { qrot, vadd, vscale, type Vec } from '../vec.ts';
import { bodyPos } from './host.ts';
import { toLocal } from './devices.ts';
import { eachPushable, halfOf } from './m3.ts';
import type { PartChannels } from './index.ts';

/** FABRICATOR `spawn` Signal: one more part queued for stage 12 (m3.n counts the pending spawns). */
export function futureSignal(c: PartChannels, i: number, port: string): boolean {
  const p = c.h.parts[i]!;
  if (p.def.type === 'fabricator') { if (port === 'spawn') c.h.st.m2.m3.n[i] = c.h.st.m2.m3.n[i]! + 1; return true; }
  return p.def.type === 'recycler';
}

export function futureSpawn(c: PartChannels, t: number): void {
  for (const i of c.list('fabricator')) fabricate(c, i, t);
  for (const i of c.list('recycler')) recycle(c, i);
}

/**
 * FABRICATOR: every `interval` s (if set) one more spawn is queued; a queued spawn takes the first dormant slot of
 * the pool and puts it in play at the mouth (or, for parts wider than the 0.10 m mouth, just in front of the face)
 * moving out at `speed`. A body resting in the way jams it (a `Jam` event after 0.5 s, `fault`); an empty pool
 * drops the queue.
 */
function fabricate(c: PartChannels, i: number, t: number): void {
  const h = c.h, st = h.st, m2 = st.m2, m3 = m2.m3, p = h.parts[i]!;
  if (!st.alive[i]) return;
  const every = Math.round((p.props.interval ?? 0) * h.tickRate);
  if (every > 0) {
    if (m2.val[i]! <= 0) m2.val[i] = every; // first spawn one interval after the start
    if (t >= m2.val[i]!) { m3.n[i] = m3.n[i]! + 1; m2.val[i] = t + every; }
  }
  if (m3.n[i]! <= 0) return;
  const pool = c.m3.pools[i]!;
  const s = pool.find((x) => !m3.live[x]);
  if (s === undefined) { m3.n[i] = 0; return; } // empty: the count ran out
  const def = c.m3.slotDef[s]!;
  const big = halfOf(def) * 2 > FABRICATOR.maxMouth;
  const half = halfOf(def);
  const local: Vec = big ? [FABRICATOR.warp[0], FABRICATOR.warp[1], FABRICATOR.warp[2] + half + 0.01] : [...FABRICATOR.mouth];
  const at = h.local(i, local);
  // jammed: a body sits where the part would appear
  let blocked = false;
  eachPushable(c, (pb) => {
    if (blocked) return;
    const q = toLocal(c, i, bodyPos(h.bodies[pb.body]!.body));
    const r = pb.half + half;
    if (Math.abs(q[0] - local[0]) < r && Math.abs(q[1] - local[1]) < r && Math.abs(q[2] - local[2]) < r) blocked = true;
  });
  if (blocked) {
    if (m2.phase[i] === 0) m2.t0[i] = t;
    m2.phase[i] = 1;
    if (t - m2.t0[i]! === Math.round(0.5 * h.tickRate)) { st.fault[i] = true; h.emit('Jam', i, at, 0, st.lastEv[i] ?? -1); }
    return;
  }
  m2.phase[i] = 0;
  st.fault[i] = false;
  const dir = qrot(p.rot, [0, 0, 1]);
  c.m3.spawn(s, at, p.rot, vscale(dir, p.props.speed ?? 1));
  m3.n[i] = m3.n[i]! - 1;
  // mag = the spawned part's mass (kg); no `other`: pool bodies are the FABRICATOR's pieces (BodyInfo chunk = slot)
  const id = h.emit('Spawn', i, at, def.body.mass, st.lastEv[i] ?? -1);
  m3.why[s] = id;
  st.pressed[i] = Math.round(0.4 * h.tickRate);
}

/**
 * RECYCLER: any body whose centre enters its intake box (the funnel plus 6 cm above the rim) leaves play: a
 * FABRICATOR part goes back to its pool, anything else is taken out of play (its ropes let go). Critters are never
 * recycled: they're popped back out. Each swallow counts (`Despawn`, mag = count); at the goal (once, or every goal)
 * it pulses `count` with a `Goal` event.
 */
function recycle(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m3 = st.m2.m3, p = h.parts[i]!;
  if (!st.alive[i]) return;
  const inBox = (w: readonly number[]): boolean => {
    const l = toLocal(c, i, w);
    return l[0] >= RECYCLER.intakeMin[0] && l[0] <= RECYCLER.intakeMax[0] && l[1] >= RECYCLER.intakeMin[1] && l[1] <= RECYCLER.intakeMax[1]
      && l[2] >= RECYCLER.intakeMin[2] && l[2] <= RECYCLER.intakeMax[2];
  };
  // critters: refused, popped back up and out over the rim
  for (let k = 0; k < h.parts.length; k++) {
    const q = h.parts[k]!;
    if (!q.def.critter || !st.alive[k] || q.base < 0) continue;
    const b = h.bodies[q.base]!.body;
    if (!inBox(bodyPos(b))) continue;
    const v = b.GetLinearVelocity();
    if (v.GetY() > 1) continue;
    const out = vadd(qrot(p.rot, [0, 2.5, 0]), qrot(p.rot, [0, 0, 1.2]));
    h.bi.SetLinearVelocity(b.GetID(), h.v3(out[0], out[1], out[2]));
    h.bi.ActivateBody(b.GetID());
  }
  const take: { part: number; body: number }[] = [];
  eachPushable(c, (pb) => {
    if (pb.part === i) return;
    const b = h.bodies[pb.body]!;
    const com = b.body.GetCenterOfMassPosition();
    if (inBox([com.GetX(), com.GetY(), com.GetZ()])) take.push({ part: pb.part, body: pb.body });
  });
  for (const { part, body } of take) {
    const s = c.m3.slotBody.indexOf(body);
    if (s >= 0) { if (!m3.live[s]) continue; c.m3.despawn(s); }
    else if (body === h.parts[part]!.base) {
      if (!st.alive[part]) continue;
      if (c.m3.pools[part]?.length || c.m3.piece[part]! >= 0) continue; // parts with M3 pieces stay (their pieces would be left behind)
      h.kill(part);
      h.lines.forEach((l, li) => { if (l.a.part === part || l.b.part === part) h.cutLine(li, h.com(part), false); });
    } else continue;
    m3.n[i] = m3.n[i]! + 1;
    const count = m3.n[i]!;
    st.pressed[i] = Math.round(0.2 * h.tickRate);
    const id = h.emit('Despawn', i, h.local(i, [0, 0.12, 0]), count, st.lastEv[part] ?? -1, part);
    const goal = Math.max(1, Math.round(p.props.target ?? 3));
    if ((p.props.mode ?? 0) === 0 ? count === goal : count % goal === 0) {
      const g = h.emit('Goal', i, h.local(i, [0.105, 0.1, 0.15]), count, id);
      st.lastEv[i] = g;
      h.pulse(i, 'count', g);
    }
  }
}

/** Screen readouts: FABRICATOR parts left + 1, RECYCLER count + 1 (both capped at 31). */
export function futureMeter(c: PartChannels, i: number): number {
  const h = c.h, m3 = h.st.m2.m3, t = h.parts[i]!.def.type;
  if (t === 'fabricator') return Math.min(31, 1 + c.m3.pools[i]!.filter((s) => !m3.live[s]).length);
  if (t === 'recycler') return Math.min(31, 1 + m3.n[i]!);
  return 0;
}

/** Flags: FABRICATOR powered (vents lit) while it has parts left. */
export function futureFlags(c: PartChannels, i: number): number {
  const m3 = c.h.st.m2.m3;
  return c.h.parts[i]!.def.type === 'fabricator' && c.m3.pools[i]!.some((s) => !m3.live[s]) ? 2 : 0;
}
