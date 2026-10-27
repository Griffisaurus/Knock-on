// Launchers (stream A, PART_SYSTEM `launcher`): SKYROCKET, BIG TOP and CORK BLASTER.

import { f32 } from '@knockon/detmath';
import { BIG_TOP, bigTopAxis, bigTopEnergy, bigTopTouchHole } from '@knockon/parts-data';
import { qrot, vadd, vdot, vlen, vscale, vsub, type Vec } from '../vec.ts';
import { L_GHOST, L_MOVING, bodyPos, bodyRot, bodyVel } from './host.ts';
import { DB } from './sound.ts';
import type { PartChannels } from './index.ts';

const ROCKET = { thrust: 6, burn: 2.0, drag: 0.015 } as const;
const CORK = { speed: 12, pull: 4 } as const;

// ---- heat in ------------------------------------------------------------------------------------------

/** Where heat lights a launcher (part-local point and exposure time), or null when it can't be lit now. */
export function launchHeatProbe(c: PartChannels, i: number): { at: Vec; time: number } | null {
  const h = c.h, m2 = h.st.m2, p = h.parts[i]!;
  if (m2.phase[i] !== 0) return null;
  if (p.def.type === 'skyrocket') return { at: [0, -0.08, 0.05], time: 0.05 };
  if (p.def.type === 'big_top') return { at: [...bigTopTouchHole(p.props.elevation ?? 30)], time: 0.05 };
  return null;
}

/** Lights a SKYROCKET's stub or a BIG TOP's touch-hole. Returns false for other parts. */
export function launchIgnite(c: PartChannels, i: number, cause: number): boolean {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  if (p.def.type !== 'skyrocket' && p.def.type !== 'big_top') return false;
  if (m2.phase[i] !== 0 || !st.alive[i]) return true;
  m2.phase[i] = 1;
  m2.t0[i] = st.tick;
  if (p.def.type === 'big_top') st.lit[i] = true; // touch-hole sparks (a rocket is `lit` only while it thrusts)
  const at = p.def.type === 'skyrocket' ? h.local(i, [0, -0.08, 0.05]) : h.local(i, bigTopTouchHole(p.props.elevation ?? 30));
  m2.cause[i] = h.emit('Ignite', i, at, 0, cause);
  st.lastEv[i] = m2.cause[i]!;
  return true;
}

// ---- stage 1: timers ---------------------------------------------------------------------------------------

export function launchTimers(c: PartChannels, t: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  for (const i of c.list('skyrocket')) {
    if (!st.alive[i]) continue;
    const p = h.parts[i]!;
    if (m2.phase[i] === 1 && t - m2.t0[i]! >= Math.round((p.props.fuse ?? 0.5) * h.tickRate)) {
      m2.phase[i] = 2;
      m2.t0[i] = t;
      st.lit[i] = true;
      const at = h.com(i);
      const id = h.emit('Launch', i, at, ROCKET.thrust, m2.cause[i]!);
      m2.cause[i] = id;
      st.lastEv[i] = id;
      h.sound(at, DB.rocket, i, id);
    } else if (m2.phase[i] === 2 && t - m2.t0[i]! >= Math.round(ROCKET.burn * h.tickRate)) {
      m2.phase[i] = 3;
      st.lit[i] = false;
      h.emit('Extinguish', i, h.local(i, [0, -0.11, 0]), 0, m2.cause[i]!);
    }
  }
  for (const i of c.list('big_top')) {
    if (st.alive[i] && m2.phase[i] === 1 && t - m2.t0[i]! >= Math.round(0.5 * h.tickRate)) fireBigTop(c, i);
  }
}

// ---- stage 5: heat out ---------------------------------------------------------------------------------------

/** Heat sources the launchers add this tick: a thrusting SKYROCKET's 0.25 m exhaust plume. Stride 5 (x, y, z, r, cause). */
export function launchHeat(c: PartChannels, out: number[]): void {
  const h = c.h, st = h.st, m2 = st.m2;
  for (const i of c.list('skyrocket')) {
    if (!st.alive[i] || m2.phase[i] !== 2) continue;
    for (const y of [-0.15, -0.23, -0.31]) out.push(...h.local(i, [0, y, 0]), 0.045, m2.cause[i]!);
  }
}

// ---- stage 6: behaviours ---------------------------------------------------------------------------------

export function launchBehave(c: PartChannels, i: number): boolean {
  switch (c.h.parts[i]!.def.type) {
    case 'skyrocket': rocket(c, i); return true;
    case 'big_top': bigTop(c, i); return true;
    case 'cork_blaster': corkPull(c, i); return true;
    default: return false;
  }
}

/** SKYROCKET: 6 N along its axis for 2.0 s, plus quadratic drag (≈ 14 m/s terminal climb). */
function rocket(c: PartChannels, i: number): void {
  const h = c.h, m2 = h.st.m2;
  if (m2.phase[i] !== 2) return;
  const b = h.bodies[h.parts[i]!.base]!.body;
  const up = qrot(bodyRot(b), [0, 1, 0]);
  const v = bodyVel(b), sp = vlen(v);
  const F = vadd(vscale(up, ROCKET.thrust), vscale(v, -ROCKET.drag * sp));
  h.bi.AddForce(b.GetID(), h.v3(F[0], F[1], F[2]), h.Jolt.EActivation_Activate);
}

/** Barrel frame of a BIG TOP in the world: trunnion point, bore axis. */
function barrel(c: PartChannels, i: number): { T: Vec; dir: Vec } {
  const p = c.h.parts[i]!;
  const { dir } = bigTopAxis(p.props.elevation ?? 30);
  return { T: vadd(p.pos, qrot(p.rot, BIG_TOP.trunnion)), dir: qrot(p.rot, dir) };
}
const radiusOf = (c: PartChannels, k: number): number => {
  const b = c.h.parts[k]!.def.bounds;
  return Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2;
};

/** BIG TOP: catches a Roller that enters the bell and holds it on the bore axis, against the ram plate. */
function bigTop(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  if (!st.alive[i]) return;
  const { T, dir } = barrel(c, i);
  // a Roller just fired is still in the mouth: don't swallow it again for 0.25 s
  const justFired = m2.phase[i] === 0 && m2.t0[i]! >= 0 && st.tick - m2.t0[i]! < Math.round(0.25 * h.tickRate);
  if (m2.held[i]! < 0 && !justFired) {
    for (let k = 0; k < h.parts.length; k++) {
      const o = h.parts[k]!;
      if (k === i || !st.alive[k] || o.def.family !== 'rollers' || c.isHeld(k)) continue;
      const b = h.bodies[o.base]!;
      if (!b.dynamic) continue;
      const rel = vsub(h.com(k), T);
      const along = vdot(rel, dir);
      const r = radiusOf(c, k);
      if (along < BIG_TOP.back || along > BIG_TOP.muzzle + r + 0.03) continue;
      if (vlen(vsub(rel, vscale(dir, along))) > BIG_TOP.barrelR) continue;
      m2.held[i] = k;
      holdLayer(c, k, true);
      break;
    }
  }
  const k = m2.held[i]!;
  if (k < 0) return;
  // held on the axis with its back against the ram plate; it collides with nothing while loaded
  const at = vadd(T, vscale(dir, BIG_TOP.back + radiusOf(c, k) + 0.002));
  const b = h.bodies[h.parts[k]!.base]!.body;
  const q = bodyRot(b);
  c.rv.Set(f32(at[0]), f32(at[1]), f32(at[2]));
  c.qq.Set(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3]));
  h.bi.SetPositionRotationAndVelocity(b.GetID(), c.rv, c.qq, h.v3(0, 0, 0), c.zero);
}

/** A held Roller is a ghost with no gravity (re-applied after a rollback: layers aren't in Jolt's state). */
export function holdLayer(c: PartChannels, k: number, held: boolean): void {
  const h = c.h, p = h.parts[k]!;
  const id = h.bodies[p.base]!.body.GetID();
  if (held) c.everHeld.add(k); // SIMFIX: afterRestore un-ghosts those not held at the restored tick
  h.bi.SetObjectLayer(id, held ? L_GHOST : L_MOVING);
  h.bi.SetGravityFactor(id, f32(held ? 0 : (p.def.body.gravityFactor ?? 1)));
}

function fireBigTop(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  m2.phase[i] = 0;
  m2.t0[i] = st.tick;
  st.lit[i] = false;
  const { T, dir } = barrel(c, i);
  const muzzle = vadd(T, vscale(dir, BIG_TOP.muzzle));
  const k = m2.held[i]!;
  let v = 0;
  if (k >= 0 && st.alive[k]) {
    const o = h.parts[k]!;
    const r = radiusOf(c, k);
    v = Math.min(14, Math.max(2, Math.sqrt((2 * bigTopEnergy(p.props)) / o.def.body.mass)));
    m2.held[i] = -1;
    holdLayer(c, k, false);
    const at = vadd(T, vscale(dir, BIG_TOP.muzzle + r + 0.01));
    const b = h.bodies[o.base]!.body;
    const q = bodyRot(b);
    c.rv.Set(f32(at[0]), f32(at[1]), f32(at[2]));
    c.qq.Set(f32(q[0]), f32(q[1]), f32(q[2]), f32(q[3]));
    h.bi.SetPositionRotationAndVelocity(b.GetID(), c.rv, c.qq, h.v3(dir[0] * v, dir[1] * v, dir[2] * v), c.zero);
    h.bi.ActivateBody(b.GetID());
  } else m2.held[i] = -1;
  const id = h.emit('Launch', i, muzzle, v, m2.cause[i]!, k >= 0 ? k : -1);
  if (k >= 0) st.lastEv[k] = id;
  h.sound(muzzle, DB.bigTop, i, id);
}

/** CORK BLASTER: ≥ 4 N on a LINE tied to the pull hook fires it. */
function corkPull(c: PartChannels, i: number): void {
  const h = c.h, st = h.st;
  if (st.m2.on[i] || !st.alive[i]) return;
  const pull = h.parts[i]!.portIndex.get('pull');
  for (const l of h.lines) {
    if (l.sheave >= 0) continue;
    const mine = (l.a.part === i && h.parts[i]!.def.ports[pull!] === l.a.port) ? l.b : (l.b.part === i && h.parts[i]!.def.ports[pull!] === l.b.port) ? l.a : null;
    if (!mine) continue;
    const tension = Math.abs(h.Jolt.castObject(l.constraint, h.Jolt.DistanceConstraint).GetTotalLambdaPosition()) / h.dt;
    if (tension >= CORK.pull) { fireCork(c, i, st.lastEv[mine.part] ?? -1); return; }
  }
}

/** CORK BLASTER fire (signal or pull): the cork leaves the muzzle at 12 m/s along +X, on its string. */
export function fireCork(c: PartChannels, i: number, cause: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  if (m2.on[i] || !st.alive[i]) return;
  const piece = c.pieceOf[i]!;
  if (piece < 0) return;
  m2.on[i] = 1;
  corkLayer(c, i, true);
  const p = h.parts[i]!;
  const dir = qrot(p.rot, [1, 0, 0]);
  const b = h.bodies[piece]!.body;
  h.bi.SetLinearVelocity(b.GetID(), h.v3(dir[0] * CORK.speed, dir[1] * CORK.speed, dir[2] * CORK.speed));
  h.bi.ActivateBody(b.GetID());
  const muzzle = h.local(i, [0.135, 0.06, 0]);
  const id = h.emit('Launch', i, muzzle, CORK.speed, cause);
  m2.cause[i] = id;
  st.lastEv[i] = id;
  h.emit('Spawn', i, bodyPos(b), 0, id);
  h.sound(muzzle, DB.cork, i, id);
}

/** The cork is a ghost with no gravity while seated, a normal body once fired. */
export function corkLayer(c: PartChannels, i: number, live: boolean): void {
  const h = c.h, piece = c.pieceOf[i]!;
  if (piece < 0) return;
  const id = h.bodies[piece]!.body.GetID();
  h.bi.SetObjectLayer(id, live && h.st.alive[i] ? L_MOVING : L_GHOST);
  h.bi.SetGravityFactor(id, f32(live && h.st.alive[i] ? 1 : 0));
}
