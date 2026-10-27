// M5 parts with their own mechanisms (stream A5): FORCE WALL (static ↔ ghost layer switch, D103), HOVER PAD (a rotation-
// locked spring-damper), BUZZ BEACON (calls and dock pose for B5's BUZZ, contract 3) and the SINGULARITY's lifecycle and
// despawns (its pull is in m5_field.ts).

import { f32 } from '@knockon/detmath';
import { BEACON, FORCE_WALL, HOVER, SINGULARITY, forceWallField } from '@knockon/parts-data';
import { qrot, vadd, vlen, vscale, vsub, type Q, type Vec } from '../vec.ts';
import { L_GHOST, L_STATIC, bodyPos, bodyVel } from './host.ts';
import { toLocal } from './devices.ts';
import { eachLive } from './m5_field.ts';
import type { M5Parts } from './m5.ts';

// ---- FORCE WALL -------------------------------------------------------------------------------------------------

/** The FORCE WALL's field: a static box body of its own (role 'piece', chunk 0), so the part's base and pylons stay put. */
export function buildWall(m: M5Parts, i: number): number {
  const h = m.h, p = h.parts[i]!;
  const s = forceWallField(p.props);
  return h.addBody(h.shapeFor(`force_wall:field:${s.size.join(',')}:${s.at!.join(',')}`, [s]), p.pos, p.rot, false, false, FORCE_WALL.friction, FORCE_WALL.restitution,
    0, false, 1, i, 'piece', false, 0);
}

/**
 * The field's object layer from plain state (`on` and alive): static while on, ghost (collides with nothing) while off.
 * Jolt's saved state doesn't record layers, so afterRestore calls this too (M5 rule 14).
 */
export function wallLayer(m: M5Parts, i: number): void {
  const h = m.h, b = m.wall[i]!;
  if (b < 0) return;
  const on = m.st.on[i] === 1 && h.st.alive[i]!;
  h.bi.SetObjectLayer(h.bodies[b]!.body.GetID(), on ? L_STATIC : L_GHOST);
}

/** Wakes the bodies at the field (resting on or against it, or inside it), so a switch takes effect at once. */
function wakeAtWall(m: M5Parts, i: number): void {
  const h = m.h, p = h.parts[i]!, s = forceWallField(p.props);
  const hx = s.size[0] / 2, hy = s.size[1] / 2, hz = s.size[2] / 2, at = s.at!;
  eachLive(m.c, (pb) => {
    const l = vsub(toLocal(m.c, i, bodyPos(h.bodies[pb.body]!.body)), at), r = pb.half + 0.05;
    if (Math.abs(l[0]) <= hx + r && Math.abs(l[1]) <= hy + r && Math.abs(l[2]) <= hz + r) h.bi.ActivateBody(h.bodies[pb.body]!.body.GetID());
  });
}

// ---- stage 2 ------------------------------------------------------------------------------------------------------

/** Signals into FORCE WALL (`toggle`), BUZZ BEACON (`call`) and SINGULARITY (`arm`). Returns true if handled. */
export function miscSignal(m: M5Parts, i: number, port: string, cause: number): boolean {
  const h = m.h, st = h.st, s5 = m.st;
  switch (h.parts[i]!.def.type) {
    case 'force_wall': {
      if (port !== 'toggle') return true;
      s5.on[i] = s5.on[i] ? 0 : 1;
      wallLayer(m, i);
      wakeAtWall(m, i);
      const f = forceWallField(h.parts[i]!.props);
      s5.cause[i] = h.emit('Barrier', i, h.local(i, f.at!), s5.on[i]!, cause);
      return true;
    }
    case 'buzz_beacon': {
      if (port !== 'call') return true;
      s5.n[i] = s5.n[i]! + 1;
      s5.cd[i] = st.tick;
      st.pressed[i] = Math.round(0.3 * h.tickRate);
      s5.cause[i] = h.emit('Call', i, h.local(i, BEACON.dock), s5.n[i]!, cause);
      return true;
    }
    case 'singularity': {
      if (port !== 'arm' || s5.on[i] !== 0) return true; // it works once
      s5.on[i] = 1;
      s5.t0[i] = st.tick;
      s5.cause[i] = h.emit('Engage', i, h.local(i, SINGULARITY.core), 1, cause);
      return true;
    }
    default: return false;
  }
}

// ---- stage 6 ------------------------------------------------------------------------------------------------------

/** Stage 6: HOVER PAD control, the SINGULARITY's clock. Returns true if handled. */
export function miscBehave(m: M5Parts, i: number): boolean {
  switch (m.h.parts[i]!.def.type) {
    case 'hover_pad': hover(m, i); return true;
    case 'singularity': singularityClock(m, i); return true;
    case 'force_wall': case 'buzz_beacon': return true;
    default: return false;
  }
}

/**
 * HOVER PAD's rotation lock: a SixDOF constraint (translation free, rotation fixed) to an invisible static anchor at its
 * placed pose (role 'piece', chunk 0), built disabled. Enabled while powered: a real lock, so an off-centre load can't
 * tilt the deck.
 */
export function buildHover(m: M5Parts, i: number): void {
  const h = m.h, J = h.Jolt, p = h.parts[i]!;
  const anchor = h.addBody(h.shapeFor('pin', [{ kind: 'sphere', size: [0.002, 0.002, 0.002] }]), p.pos, p.rot, false, true, 0.5, 0, 0, false, 1, i, 'piece', false, 0);
  const s = new J.SixDOFConstraintSettings();
  s.mPosition1 = s.mPosition2 = new J.RVec3(f32(p.pos[0]), f32(p.pos[1]), f32(p.pos[2]));
  s.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_RotationX);
  s.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_RotationY);
  s.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_RotationZ);
  const c = s.Create(h.bodies[anchor]!.body, h.bodies[p.base]!.body);
  J.destroy(s);
  h.system.AddConstraint(c);
  c.SetEnabled(false);
  m.hoverC[i] = c;
}

/** The lock's enable from plain state (`on`): Jolt's saved state doesn't record constraint enables (afterRestore too). */
export function hoverLock(m: M5Parts, i: number, wake = true): void {
  const c = m.hoverC[i];
  if (!c) return;
  c.SetEnabled(m.st.on[i] === 1 && m.h.st.alive[i]!);
  // PARTSIM (SIMFIX rule-14 audit): wake only on a live switch; a restore keeps the sleep state Jolt saved (waking a pad
  // that slept at the checkpoint tick would make the rolled-back run differ from the straight one)
  if (wake && m.st.on[i] === 1) m.h.bi.ActivateBody(m.h.bodies[m.h.parts[i]!.base]!.body.GetID());
}

/**
 * HOVER PAD. Powered: the setpoint rises at 0.5 m/s (easing in over the last 10 cm) to 0.5 m above the placed position; a
 * vertical spring-damper (k 10,000 N/m, damping critical for the empty pad but at most 0.9·m/dt so it's stable at 60 Hz
 * too) plus its own weight fed forward holds it there, × the supply factor; a soft horizontal spring (40 /s², critically
 * damped) keeps it over its base point; its rotation is locked (buildHover). The spring's stretch is clamped to ±5 cm, so a heavy
 * drop can't launch it. Unpowered, nothing acts (it falls; the rotation is free) and the setpoint follows its height, so
 * power coming back lifts it from where it is. Load estimate = k·sag / g (its screen; overload past 10 kg: `fault`).
 */
function hover(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st, p = h.parts[i]!, J = h.Jolt, g = m.c.m3.gravity;
  const rb = h.bodies[p.base]!;
  if (!rb.dynamic) return; // anchored
  const b = rb.body;
  const pos = bodyPos(b);
  const f = st.alive[i] ? Math.min(1, st.supply[i]!) : 0;
  const above = pos[1] - p.pos[1];
  if (f <= 0) {
    s5.val[i] = Math.max(0, Math.min(HOVER.height, above));
    if (s5.on[i]) { s5.on[i] = 0; hoverLock(m, i); }
    s5.val2[i] = 0;
    s5.aux[i] = 0;
    return;
  }
  if (!s5.on[i]) { s5.on[i] = 1; hoverLock(m, i); }
  // the setpoint rises at 0.5 m/s and eases into the hover height over its last 10 cm (a load isn't tossed at the top)
  const sp0 = s5.val[i]!;
  const sp = sp0 + Math.min(HOVER.rise, ((HOVER.height - sp0) * HOVER.rise) / HOVER.ease) * h.dt;
  s5.val[i] = HOVER.height - sp < 1e-4 ? HOVER.height : sp;
  const vsp = (s5.val[i]! - sp0) / h.dt, rising = s5.val[i]! < HOVER.height;
  const mp = b.GetMotionProperties(), inv = mp.GetInverseMass();
  if (inv <= 0) return;
  const mass = 1 / inv, gf = mp.GetGravityFactor();
  const err = Math.max(-0.05, Math.min(0.05, s5.val[i]! - above));
  const v = bodyVel(b);
  const damp = Math.min(2 * Math.sqrt(HOVER.k * mass), (0.9 * mass) / h.dt);
  const Fy = f * (HOVER.k * err + damp * (vsp - v[1]) + mass * g * gf);
  // held over its base point by a soft, critically damped horizontal spring
  const dx = pos[0] - p.pos[0], dz = pos[2] - p.pos[2], cH = 2 * Math.sqrt(HOVER.hK);
  const Fx = -f * mass * (HOVER.hK * dx + cH * v[0]), Fz = -f * mass * (HOVER.hK * dz + cH * v[2]);
  h.bi.AddForce(b.GetID(), h.v3(Fx, Fy, Fz), J.EActivation_Activate);
  s5.val2[i] = Math.max(0, (HOVER.k * (s5.val[i]! - above)) / g);
  s5.aux[i] = !rising && s5.val[i]! - above > 0.01 ? 1 : 0; // overloaded (its own flag: the Machine's `fault` is the brownout's)
}

/** SINGULARITY: 6 s after its arm Signal it collapses (`Collapse`, mag = bodies swallowed) and is spent. */
function singularityClock(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st;
  if (s5.on[i] !== 1 || st.tick - s5.t0[i]! < Math.round(SINGULARITY.durationS * h.tickRate)) return;
  s5.on[i] = 2;
  st.pressed[i] = Math.round(3 * h.tickRate); // the cap vents
  h.emit('Collapse', i, h.local(i, SINGULARITY.core), s5.n[i]!, s5.cause[i]!);
}

// ---- stage 12 -----------------------------------------------------------------------------------------------------

/**
 * SINGULARITY, active: any pushable body whose centre is within 0.3 m of the core leaves play (`Despawn`, mag = count,
 * other = its part): a pool slot goes back to its pool, a part's body (or a chunk of a broken part) takes the whole part
 * out (its LINEs let go), like RECYCLER. Parts that own pieces or pools stay (their pieces would be left behind).
 * Critters are never swallowed: one at the core is spat out (up 4 m/s, out 3 m/s, `Launch`).
 */
export function miscSpawn(m: M5Parts, _t: number): void {
  for (const i of m.c.list('singularity')) swallow(m, i);
}

function swallow(m: M5Parts, i: number): void {
  const h = m.h, st = h.st, s5 = m.st, c = m.c;
  if (!st.alive[i] || s5.on[i] !== 1) return;
  const core = h.local(i, SINGULARITY.core), R = SINGULARITY.coreR;
  const near = (w: readonly number[]): boolean => vlen(vsub(w, core)) <= R;
  // critters: spat back out
  for (let k = 0; k < h.parts.length; k++) {
    const q = h.parts[k]!;
    if (!q.def.critter || !st.alive[k] || q.base < 0) continue;
    const b = h.bodies[q.base]!.body;
    const at = bodyPos(b);
    if (!near(at) || bodyVel(b)[1] > 1) continue;
    let out = vsub(at, core);
    out[1] = 0;
    const l = vlen(out);
    out = l > 1e-6 ? vscale(out, 1 / l) : qrot(h.parts[i]!.rot, [0, 0, 1]);
    const v = vadd(vscale(out, SINGULARITY.spitOut), [0, SINGULARITY.spitUp, 0]);
    h.bi.SetLinearVelocity(b.GetID(), h.v3(v[0], v[1], v[2]));
    h.bi.ActivateBody(b.GetID());
    st.lastEv[k] = h.emit('Launch', i, core, vlen(v), s5.cause[i]!, k);
  }
  const take: { part: number; body: number }[] = [];
  eachLive(c, (pb) => {
    if (pb.part === i) return;
    const b = h.bodies[pb.body]!.body.GetCenterOfMassPosition();
    if (near([b.GetX(), b.GetY(), b.GetZ()])) take.push({ part: pb.part, body: pb.body });
  });
  for (const { part, body } of take) {
    const s = c.m3.slotBody.indexOf(body);
    if (s >= 0) { if (!c.m3.live(s)) continue; c.m3.despawn(s); }
    else {
      const rb = h.bodies[body]!;
      if (rb.role !== 'base' && rb.role !== 'chunk') continue;
      if (!st.alive[part]) continue;
      if (c.m3.pools[part]?.length || (c.m3.piece[part] ?? -1) >= 0) continue;
      h.kill(part);
      h.lines.forEach((l, li) => { if (l.a.part === part || l.b.part === part) h.cutLine(li, h.com(part), false); });
    }
    s5.n[i] = s5.n[i]! + 1;
    st.lastEv[part] = h.emit('Despawn', i, core, s5.n[i]!, st.lastEv[part] ?? s5.cause[i]!, part);
  }
}

// ---- BUZZ BEACON (contract 3) ---------------------------------------------------------------------------------------

/** What BUZZ (B5) reads of a beacon (docs/dev/M5_NOTES_A5.md). */
export interface BeaconView {
  readonly part: number;
  /** Index into BEACON_PAIRS (BUZZ pairs with a beacon of its own colour). */
  readonly pair: number;
  /** World pose of `socket_dock` (the pad top; facing part-local +Z, the port side): BUZZ's root takes it when docked. */
  readonly dockPos: Vec;
  readonly dockRot: Q;
  /** Calls received since the run started (a call is pending while BUZZ has served fewer). */
  readonly calls: number;
  /** Tick of the latest call, −1 none. */
  readonly callTick: number;
  /** The latest `Call` event id (the cause for BUZZ's takeoff), −1 none. */
  readonly callCause: number;
  /** A pushable body resting over the pad (centre within r 0.10 m, ≤ 0.25 m above the pad top): its part, −1 if clear. */
  readonly padItem: number;
}

export function beaconView(m: M5Parts, i: number): BeaconView | null {
  const h = m.h, s5 = m.st, p = h.parts[i];
  if (!p || p.def.type !== 'buzz_beacon' || !h.st.alive[i]) return null;
  let padItem = -1;
  eachLive(m.c, (pb) => {
    if (padItem >= 0 || pb.part === i) return;
    const l = toLocal(m.c, i, bodyPos(h.bodies[pb.body]!.body));
    const up = l[1] - BEACON.dock[1];
    if (l[0] * l[0] + l[2] * l[2] <= BEACON.padR * BEACON.padR && up >= 0 && up <= BEACON.padH) padItem = pb.part;
  });
  return {
    part: i, pair: Math.max(0, Math.min(5, p.props.pair ?? 5)), dockPos: h.local(i, BEACON.dock), dockRot: [...p.rot] as Q,
    calls: s5.n[i]!, callTick: s5.cd[i]!, callCause: s5.cause[i]!, padItem,
  };
}

// ---- flags and meters ---------------------------------------------------------------------------------------------

/**
 * Flags: FORCE WALL lit while on; HOVER PAD lit while hovering, fault while overloaded (sag past 1 cm); BUZZ BEACON powered
 * while its BUZZ is docked, armed while BUZZ is away (`pressed` 0.3 s at a call); SINGULARITY armed while active and lit
 * once spun up (`pressed` 3 s after the collapse: the cap vents).
 */
export function miscFlags(m: M5Parts, i: number): number {
  const s5 = m.st, h = m.h;
  switch (h.parts[i]!.def.type) {
    case 'force_wall': return s5.on[i] ? 1 : 0;
    case 'hover_pad': return (s5.on[i] ? 1 : 0) | (s5.aux[i] ? 64 : 0);
    case 'buzz_beacon': return s5.aux[i] === 1 ? 2 : s5.aux[i] === 2 ? 16 : 0;
    case 'singularity': {
      if (s5.on[i] !== 1) return 0;
      const spun = h.st.tick - s5.t0[i]! >= Math.round(SINGULARITY.spinS * h.tickRate);
      return 16 | (spun ? 1 : 0);
    }
    default: return 0;
  }
}

/** Meters: HOVER PAD load against its 10 kg (1–21); SINGULARITY seconds left + 1 while active (its "6.0" → "0.0" screen), 1 once spent. */
export function miscMeter(m: M5Parts, i: number): number {
  const s5 = m.st, h = m.h;
  switch (h.parts[i]!.def.type) {
    case 'hover_pad': return s5.on[i] ? 1 + Math.round((20 * Math.min(HOVER.maxPayload, s5.val2[i]!)) / HOVER.maxPayload) : 0;
    case 'singularity': {
      if (s5.on[i] === 2) return 1;
      if (s5.on[i] !== 1) return 0;
      return 1 + Math.max(0, Math.ceil(SINGULARITY.durationS - (h.st.tick - s5.t0[i]!) / h.tickRate));
    }
    default: return 0;
  }
}
