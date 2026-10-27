// M3 fire and boom (stream A3): POWDER KEG (cook-off, stub, detonator), JITTERJUICE (shock), SKYSHOW (quick-match and
// shells), FLAMER (heat cone, gas / powered, douse) and POPPER (string pull → air puff; never an explosive).

import { dcos } from '@knockon/detmath';
import { FLAMER, JITTER, KEG, POPPER, SKYSHOW } from '@knockon/parts-data';
import { qrot, vadd, vdot, vlen, vnorm, vscale, vsub, type Vec } from '../vec.ts';
import { bodyPos, bodyRot, bodyVel, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import { areaOf, eachPushable } from './m3.ts';
import type { PartChannels } from './index.ts';

const RAD = Math.PI / 180;
/** Loudness at 1 m (SIMULATION §5.10; stream A3 tuning). */
export const DB3 = { popper: 82, ding: 77, tonebar: 55, shatter: 85 } as const;

// ---- stage 5: heat ------------------------------------------------------------------------------------------------

/**
 * Exposure probes for the Machine's stage 5 (null = no exposure ignition now). The POWDER KEG's cook-off is measured
 * here too: any heat source within 0.05 m of the keg's surface counts, continuously, and 1.5 s of it detonates the keg
 * (a tick without heat resets the count, boom.md). Its stub (lit by a flame at the tip) is the returned probe.
 */
export function boomHeatProbe(c: PartChannels, i: number): { at: Vec; time: number } | null {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'powder_keg': {
      cookOff(c, i);
      return st.armedAt[i]! < 0 && st.alive[i] ? { at: [...KEG.stub], time: 0.05 } : null;
    }
    case 'skyshow': return m2.phase[i] === 0 ? { at: [...SKYSHOW.stub], time: 0.05 } : null;
    default: return null;
  }
}

function cookOff(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m3 = st.m2.m3, src = c.m3.heatRef;
  if (!src || !st.alive[i]) return;
  let hot = -2;
  for (let k = 0; k < src.length && hot === -2; k += 5) {
    const l = toLocal(c, i, [src[k]!, src[k + 1]!, src[k + 2]!]);
    const r = src[k + 3]!;
    if (Math.sqrt(l[0] * l[0] + l[2] * l[2]) <= KEG.R + r + KEG.pad && Math.abs(l[1]) <= KEG.H + r + KEG.pad) hot = src[k + 4]!;
  }
  if (hot === -2) return;
  if (m3.heatAt[i] === st.tick - 1 && m3.cook[i]! > 0) m3.cook[i] = m3.cook[i]! + h.dt;
  else { m3.cook[i] = h.dt; h.emit('Cook', i, h.com(i), 0, hot); }
  m3.heatAt[i] = st.tick;
  if (m3.cook[i]! >= KEG.cook - 1e-9) h.queueBoom(i, st.tick, st.tick, hot);
}

/** Heat reached a heat port or an exposure probe ignited part `i`. Returns true for M3 flammables. */
export function boomIgnite(c: PartChannels, i: number, cause: number): boolean {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'powder_keg':
      // the stub burns down on the Machine's bangstick countdown (`fuse` seconds), then the keg goes
      if (st.armedAt[i]! >= 0 || !st.alive[i]) return true;
      st.armedAt[i] = st.tick;
      st.lit[i] = true;
      st.litCause[i] = h.emit('Ignite', i, h.local(i, KEG.stub), 0, cause);
      st.lastEv[i] = st.litCause[i]!;
      return true;
    case 'skyshow':
      if (m2.phase[i] !== 0 || !st.alive[i]) return true;
      m2.phase[i] = 1;
      m2.t0[i] = st.tick;
      m2.val[i] = 0;
      st.lit[i] = true;
      m2.cause[i] = h.emit('Ignite', i, h.local(i, SKYSHOW.stub), 0, cause);
      st.lastEv[i] = m2.cause[i]!;
      return true;
    default: return false;
  }
}

/** Heat sources (stride 5): a burning FLAMER's 0.6 m cone as overlapping spheres (r = 0.1·s, ≥ 0.012 m). */
export function boomHeat(c: PartChannels, out: number[]): void {
  const h = c.h, st = h.st, m2 = st.m2;
  for (const i of c.list('flamer')) {
    if (!st.alive[i] || m2.phase[i] !== 2) continue;
    const p = h.parts[i]!;
    const n = h.local(i, FLAMER.nozzle), ax = qrot(p.rot, [1, 0, 0]);
    for (let s = 0.03; s <= FLAMER.length + 1e-9; s += 0.03) out.push(...vadd(n, vscale(ax, s)), Math.max(0.012, (FLAMER.endR / FLAMER.length) * s), m2.cause[i]!);
  }
}

// ---- stage 1 / 12: SKYSHOW ------------------------------------------------------------------------------------------

/** The quick-match: tube k (1…6) fires 0.6·k s after the stub caught. */
export function boomTimers(c: PartChannels, t: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  for (const i of c.list('skyshow')) {
    if (!st.alive[i] || m2.phase[i] !== 1) continue;
    const k = m2.val[i]!;
    if (t - m2.t0[i]! < Math.round(SKYSHOW.hop * (k + 1) * h.tickRate)) continue;
    fireTube(c, i, k);
    m2.val[i] = k + 1;
    if (k + 1 >= SKYSHOW.tubes.length) { m2.phase[i] = 2; st.lit[i] = false; }
  }
}

function fireTube(c: PartChannels, i: number, k: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  const s = c.m3.pools[i]![k];
  if (s === undefined) return;
  const tube = SKYSHOW.tubes[k]!;
  const b = h.bodies[p.base]!.body;
  const rot = bodyRot(b);
  const axis = vnorm(qrot(rot, tube.axis));
  const muzzle = h.local(i, vadd(tube.top, vscale(tube.axis, 0.03)));
  const alt = Math.min(12, Math.max(2, p.props.altitude ?? 6));
  const v = Math.min(20, Math.sqrt(2 * c.m3.gravity * alt) / Math.max(0.5, axis[1]));
  const vel = vadd(vscale(axis, v), bodyVel(b));
  c.m3.spawn(s, muzzle, [0, 0, 0, 1], vel);
  const id = h.emit('Launch', i, muzzle, v, m2.cause[i]!);
  st.m2.m3.why[s] = id;
  st.lastEv[i] = id;
  // recoil: the shell's momentum pushes the cake back down its tube
  const J = vscale(axis, -0.05 * v);
  h.bi.AddImpulse(b.GetID(), h.v3(J[0], J[1], J[2]));
  h.bi.ActivateBody(b.GetID());
}

/** Stage 12: a shell bursts at the top of its climb (or `altitude` above its tube, or after 4 s): a yield-0.2 blast. */
export function boomSpawn(c: PartChannels, t: number): void {
  const h = c.h, st = h.st, m3 = st.m2.m3;
  for (const i of c.list('skyshow')) {
    const alt = Math.min(12, Math.max(2, h.parts[i]!.props.altitude ?? 6));
    for (const s of c.m3.pools[i]!) {
      if (!m3.live[s]) continue;
      const b = h.bodies[c.m3.slotBody[s]!]!.body;
      const pos = bodyPos(b), v = bodyVel(b);
      if (v[1] > 0 && pos[1] - m3.y0[s]! < alt && t - m3.born[s]! < 4 * h.tickRate) continue;
      c.m3.despawn(s);
      if (!st.alive[i]) continue;
      const boom = h.blast(pos, SKYSHOW.shellY, i, t, m3.why[s]!, false);
      h.emit('Burst', i, pos, h.parts[i]!.props.pattern ?? 0, boom); // the Spectacle pattern (SKYSHOW_PATTERNS)
    }
  }
}

// ---- stage 2: signals -----------------------------------------------------------------------------------------------

export function boomSignal(c: PartChannels, i: number, port: string, cause: number): boolean {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  switch (p.def.type) {
    case 'powder_keg': if (port === 'detonator') h.queueBoom(i, st.tick, st.tick, cause); return true;
    case 'flamer':
      if (port !== 'on' || (p.props.mode ?? 0) !== 0) return true;
      m2.on[i] = 1 - m2.on[i]!;
      m2.cause[i] = cause;
      return true;
    default: return false;
  }
}

/** Power demand (stage 3): the FLAMER draws 80 W only in Powered mode. */
export function boomDemand(c: PartChannels, i: number, w: number): number {
  const p = c.h.parts[i]!;
  return p.def.type === 'flamer' && (p.props.mode ?? 0) === 0 ? 0 : w;
}

// ---- stage 6: behaviours ---------------------------------------------------------------------------------------------

export function boomBehave(c: PartChannels, i: number): boolean {
  switch (c.h.parts[i]!.def.type) {
    case 'flamer': flamer(c, i); return true;
    case 'popper': popperPull(c, i); return true;
    case 'powder_keg': case 'jitterjuice': case 'skyshow': return true;
    default: return false;
  }
}

/**
 * FLAMER: off → igniting (0.15 s) → burning, while wanted: the valve open (Gas mode, a Signal toggles it) or supplied
 * (Powered mode, f ≥ 0.5). Doused (phase 3), it stays out until it's switched off and on again.
 */
function flamer(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  const want = st.alive[i]! && ((p.props.mode ?? 0) === 1 ? st.supply[i]! >= 0.5 : m2.on[i] === 1);
  const ph = m2.phase[i]!;
  if (!want) {
    if (ph === 2) h.emit('Extinguish', i, h.local(i, FLAMER.nozzle), 0, m2.cause[i]!);
    m2.phase[i] = 0;
  } else if (ph === 0) { m2.phase[i] = 1; m2.t0[i] = st.tick; }
  else if (ph === 1 && st.tick - m2.t0[i]! >= Math.round(FLAMER.igniteS * h.tickRate)) {
    m2.phase[i] = 2;
    m2.cause[i] = h.emit('Ignite', i, h.local(i, FLAMER.nozzle), 0, m2.cause[i]! >= 0 ? m2.cause[i]! : st.lastEv[i] ?? -1);
    st.lastEv[i] = m2.cause[i]!;
  }
  st.lit[i] = m2.phase[i] === 2;
}

/** Wind at a FLAMER's nozzle over 4 m/s blows it out until it's switched off and on again (SIMULATION §5.7). */
export function douseFlamer(c: PartChannels, i: number, speed: number, cause: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  if (m2.phase[i] !== 2 || speed <= 4) return;
  m2.phase[i] = 3;
  st.lit[i] = false;
  h.emit('Extinguish', i, h.local(i, FLAMER.nozzle), 0, cause);
}

/** GALE wind on a FLAMER (Machine.blow → x.wind): douses it when its nozzle is in the cone at > 4 m/s. */
export function flamerWind(c: PartChannels, k: number, nozzle: Vec, axis: Vec, R: number, cosHalf: number, f: number, cause: number): void {
  const at = c.h.local(k, FLAMER.nozzle);
  const d = vsub(at, nozzle), dist = vlen(d);
  if (dist > R || dist < 1e-6 || vdot(d, axis) / dist < cosHalf) return;
  douseFlamer(c, k, 6 * f * (1 - dist / R), cause);
}

/** POPPER: a tug on the string of ≥ 4 N (or 2.5× its own weight: it's light enough to be dragged first) pops it. */
function popperPull(c: PartChannels, i: number): void {
  const h = c.h, st = h.st, m2 = st.m2, p = h.parts[i]!;
  if (m2.on[i] || !st.alive[i]) return;
  const port = p.portIndex.get('string');
  const need = Math.min(POPPER.pull, 2.5 * p.def.body.mass * c.m3.gravity);
  for (const l of h.lines) {
    if (l.sheave >= 0) continue;
    const mine = l.a.part === i && p.def.ports[port!] === l.a.port ? l.b : l.b.part === i && p.def.ports[port!] === l.b.port ? l.a : null;
    if (!mine) continue;
    const tension = Math.abs(h.Jolt.castObject(l.constraint, h.Jolt.DistanceConstraint).GetTotalLambdaPosition()) / h.dt;
    if (tension >= need - 1e-9) { pop(c, i, st.lastEv[mine.part] ?? -1); return; }
  }
}

function pop(c: PartChannels, i: number, cause: number): void {
  const h = c.h, st = h.st, m2 = st.m2;
  m2.on[i] = 1;
  m2.phase[i] = Math.max(1, Math.round(POPPER.seconds * h.tickRate)); // puff ticks left
  const mouth = h.local(i, POPPER.mouth);
  m2.cause[i] = h.emit('Confetti', i, mouth, 1, cause);
  st.lastEv[i] = m2.cause[i]!;
  h.sound(mouth, DB3.popper, i, m2.cause[i]!);
  st.pressed[i] = Math.round(0.3 * h.tickRate);
  // the base hops
  const b = h.bodies[h.parts[i]!.base]!.body;
  const up = qrot(bodyRot(b), [0, 1, 0]);
  h.bi.AddImpulse(b.GetID(), h.v3(up[0] * 0.1, up[1] * 0.1, up[2] * 0.1));
  h.bi.ActivateBody(b.GetID());
}

/**
 * End of stage 6: a popped POPPER's puff, spread over 0.15 s: each dynamic body in its 1.0 m / 15° cone gets
 * I = 60·A·(1 − d/R)² N·s in total along the cone axis, at most Δv 4 m/s (light things fly, heavy ones barely move).
 */
export function popperPuffs(c: PartChannels): void {
  const h = c.h, st = h.st, m2 = st.m2;
  const pops = c.list('popper').filter((i) => m2.phase[i]! > 0);
  if (!pops.length) return;
  const ticks = Math.max(1, Math.round(POPPER.seconds * h.tickRate));
  const cosHalf = dcos(POPPER.halfDeg * RAD);
  for (const i of pops) {
    m2.phase[i] = m2.phase[i]! - 1;
    if (!st.alive[i]) continue;
    const mouth = h.local(i, POPPER.mouth);
    const axis = vnorm(qrot(bodyRot(h.bodies[h.parts[i]!.base]!.body), [0, 1, 0]));
    eachPushable(c, (pb) => {
      if (pb.part === i) return;
      const b = h.bodies[pb.body]!.body;
      const com = b.GetCenterOfMassPosition();
      const d = vsub([com.GetX(), com.GetY(), com.GetZ()], mouth), dist = vlen(d);
      if (dist > POPPER.R || dist < 1e-6 || vdot(d, axis) / dist < cosHalf) return;
      const inv = b.GetMotionProperties().GetInverseMass();
      if (inv <= 0) return;
      const fall = (1 - dist / POPPER.R) * (1 - dist / POPPER.R);
      const I = Math.min(60 * areaOf(pb.def) * fall * h.air, 4 / inv) / ticks;
      h.bi.AddImpulse(b.GetID(), h.v3(axis[0] * I, axis[1] * I, axis[2] * I));
      h.bi.ActivateBody(b.GetID());
      st.lastEv[pb.part] = m2.cause[i]!;
    });
  }
}

// ---- stage 9: contacts ---------------------------------------------------------------------------------------------

/** JITTERJUICE: one contact ≥ 0.15 N·s detonates it; 0.08–0.15 N·s jostles it (an event and its LED flare). */
export function boomContact(c: PartChannels, pi: number, mb: HostBody, J: number, pos: Vec, added: boolean, cause: number, other: number): boolean {
  const h = c.h, st = h.st, p = h.parts[pi]!;
  if (p.def.type !== 'jitterjuice') return false;
  if (!added || mb.role !== 'base') return true;
  if (J >= JITTER.boom) h.queueBoom(pi, st.tick, st.tick, cause);
  else if (J >= JITTER.jostle && st.cooldown[pi]! === 0) {
    st.cooldown[pi] = Math.round(0.1 * h.tickRate);
    st.pressed[pi] = Math.round(0.2 * h.tickRate);
    h.emit('Jostle', pi, pos, J, cause, other);
  }
  return true;
}

/** Flags: SKYSHOW armed while its quick-match burns; FLAMER armed while igniting; POWDER KEG pressed while cooking. */
export function boomFlags(c: PartChannels, i: number): number {
  const st = c.h.st, m2 = st.m2;
  switch (c.h.parts[i]!.def.type) {
    case 'skyshow': return m2.phase[i] === 1 ? 16 : 0;
    case 'flamer': return m2.phase[i] === 1 ? 16 : 0;
    case 'powder_keg': return st.m2.m3.heatAt[i] === st.tick - 1 ? 4 : 0; // pressed = cooking
    default: return 0;
  }
}

