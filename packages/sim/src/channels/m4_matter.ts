// M4 Matter parts (stream A4): GRIT HOPPER, TANK, MARBLE HOPPER, SPRINKLE CAN, SPONGE and HOURGLASS.
//
// Stored contents are a quantity in plain state (`st.m2.m4.q`: water particles = mL, sand grains, marbles). They become
// Matter particles only at the spout, through MI's `machine.matter` (M4_PLAN contract 2), and intakes add what they
// absorb back. Nothing here touches the Matter backend; buoyancy, drag and grains pushing parts come out of the particle
// contacts (WATERWHEEL, QUACK). HOURGLASS is a fill-pass display, not grains (D93).
//
// Without `machine.matter` (Matter gameplay off, or MI's host not in yet) the containers still run their valves and
// drain their quantity at the same rate, so events, signals and the fill pass behave the same; nothing is emitted and
// intakes absorb nothing.

import { f32 } from '@knockon/detmath';
import type { JoltModule } from '@knockon/jolt';
import { GOO_PER_LITRE, GOO_VAT, GRIT_HOPPER, HOURGLASS, MARBLE_HOPPER, SPONGE, SPRINKLE, TANK, type LocalBox, type V3 } from '@knockon/parts-data';
import { qrot, type Vec } from '../vec.ts';
import { bodyRot, type HostBody } from './host.ts';
import { toLocal } from './devices.ts';
import type { M4Parts } from './m4.ts';

/**
 * MI's Matter host as A4 uses it (M4_PLAN contract 2). `part` is the part index; positions are part-local metres (the
 * part's base body frame), velocities part-local m/s. A4 calls `intake` in stage 6 of every rigid tick while a sensor
 * should be live, with the container's remaining room as `capacity` (0 = closed this tick); `absorbed` returns the counts
 * per kind that arrive this rigid tick (with the contract's fixed latency).
 */
export interface MatterHost {
  emit(part: number, kind: number, count: number, localPos: readonly number[], localVel: readonly number[], spread: number): void;
  intake(part: number, localBox: LocalBox, kindMask: number, capacity: number): void;
  absorbed(part: number): ArrayLike<number> | null | undefined;
}

/** `machine.matter` when MI's host is present and Matter gameplay is on, else null. */
export function matterOf(m: M4Parts): MatterHost | null {
  const x = m.h.matter as Partial<MatterHost> | null | undefined;
  return x && typeof x.emit === 'function' && typeof x.intake === 'function' && typeof x.absorbed === 'function' ? x as MatterHost : null;
}

interface Container { cap: number; rate: number; spout: V3; dir: V3; speed: number; spread: number; intake: LocalBox; kind: number }

/** A dispensing container's numbers from its props (whole particles; rates per second). */
function spec(m: M4Parts, i: number): Container | null {
  const p = m.c.h.parts[i]!.props;
  switch (m.c.h.parts[i]!.def.type) {
    case 'grit_hopper': return { cap: Math.round(p.capacity ?? 200000), rate: Math.round(p.rate ?? 20000), ...GRIT_HOPPER };
    case 'tank': {
      const flow = Math.round((p.flow ?? 0.5) * 1000); // mL/s = particles/s
      return { cap: TANK.capacity, rate: flow, spout: TANK.spout, dir: TANK.dir, speed: Math.max(TANK.minSpeed, flow / 1e6 / TANK.pipeArea), spread: TANK.spread, intake: TANK.intake, kind: TANK.kind };
    }
    case 'marble_hopper': return { cap: Math.round(p.capacity ?? 2000), rate: Math.round(p.rate ?? 400), ...MARBLE_HOPPER };
    case 'goo_vat': {
      // X5 (M5): a TANK for goo (defs_m5_matter.ts): flow in L/s → goo particles/s; speed out of the duckbill lip
      const flow = Math.round((p.flow ?? 0.3) * GOO_PER_LITRE);
      const speed = Math.max(GOO_VAT.minSpeed, flow / GOO_PER_LITRE / 1000 / GOO_VAT.lipArea);
      return { cap: GOO_VAT.capacity, rate: flow, spout: GOO_VAT.spout, dir: GOO_VAT.dir, speed, spread: GOO_VAT.spread, intake: GOO_VAT.intake, kind: GOO_VAT.kind };
    }
    default: return null;
  }
}

/** Capacity in particles of any container (HOURGLASS: its duration in ticks). */
function capacityOf(m: M4Parts, i: number): number {
  const p = m.c.h.parts[i]!;
  switch (p.def.type) {
    case 'sprinkle_can': return SPRINKLE.capacity;
    case 'sponge': return SPONGE.capacity;
    case 'hourglass': return Math.max(1, Math.round((p.props.duration ?? 10) * m.c.h.tickRate));
    default: return spec(m, i)?.cap ?? 1;
  }
}

/** Whole particles to release this tick at `rate` per second (the remainder carries in `acc`). */
function take(m: M4Parts, i: number, rate: number): number {
  const s = m.st, tr = m.c.h.tickRate;
  s.acc[i] = s.acc[i]! + rate;
  const n = Math.floor(s.acc[i]! / tr);
  s.acc[i] = s.acc[i]! - n * tr;
  return Math.min(n, s.q[i]!);
}

/** Adds what the part's intake absorbed this tick (up to its room). */
function absorb(m: M4Parts, i: number, kind: number, cap: number): void {
  const mt = matterOf(m);
  if (!mt) return;
  const got = mt.absorbed(i);
  const n = got ? got[kind] ?? 0 : 0;
  if (n > 0) m.st.q[i] = Math.min(cap, m.st.q[i]! + n);
}

/** World → part-local direction (the part's base body frame). */
function localDir(m: M4Parts, i: number, w: Vec): Vec {
  const r = bodyRot(m.c.h.bodies[m.c.h.parts[i]!.base]!.body);
  return qrot([-r[0], -r[1], -r[2], r[3]], w);
}

// ---- init / restore ---------------------------------------------------------------------------------------------------

export function matterInit(m: M4Parts): void {
  const h = m.c.h, s = m.st;
  for (const t of ['grit_hopper', 'tank', 'marble_hopper', 'sprinkle_can', 'sponge', 'goo_vat']) {
    for (const i of m.c.list(t)) s.q[i] = Math.round((capacityOf(m, i) * (h.parts[i]!.props.start ?? (t === 'sponge' ? 0 : 100))) / 100);
  }
  for (const t of ['grit_hopper', 'tank', 'marble_hopper', 'goo_vat']) for (const i of m.c.list(t)) s.open[i] = (h.parts[i]!.props.open ?? 0) === 1 ? 1 : 0;
  for (const i of m.c.list('hourglass')) {
    // the local-top bulb starts full; the running direction starts as placed (upside down: its sand is already at the bottom)
    s.q[i] = capacityOf(m, i);
    s.open[i] = qrot(bodyRot(h.bodies[h.parts[i]!.base]!.body), [0, 1, 0])[1] <= -HOURGLASS.pauseCos ? -1 : 1;
  }
  matterRestore(m);
}

/** Body masses from stored water (Jolt's saved state doesn't hold mass): SPONGE body, SPRINKLE CAN can. */
export function matterRestore(m: M4Parts): void {
  const h = m.c.h, s = m.st;
  for (const i of m.c.list('sponge')) m.setMass(h.parts[i]!.base, SPONGE.dry + s.q[i]! / 1000);
  for (const i of m.c.list('sprinkle_can')) if (h.parts[i]!.arm >= 0) m.setMass(h.parts[i]!.arm, SPRINKLE.canMass + s.q[i]! / 1000);
}

// ---- stage 2 --------------------------------------------------------------------------------------------------------

/** GRIT HOPPER / TANK / MARBLE HOPPER `open`: each pulse toggles the gate, valve or feed (`Valve`, mag = new state). */
export function matterSignal(m: M4Parts, i: number, port: string, cause: number): boolean {
  const h = m.c.h, s = m.st;
  const c = spec(m, i);
  if (!c) return false;
  if (port !== 'open') return true;
  s.open[i] = s.open[i] ? 0 : 1;
  s.cause[i] = h.emit('Valve', i, h.local(i, c.spout), s.open[i]!, cause);
  h.st.lastEv[i] = s.cause[i]!;
  return true;
}

// ---- stage 6 --------------------------------------------------------------------------------------------------------

export function matterBehave(m: M4Parts, i: number): boolean {
  switch (m.c.h.parts[i]!.def.type) {
    case 'grit_hopper': case 'tank': case 'marble_hopper': case 'goo_vat': dispenser(m, i); return true;
    case 'hourglass': hourglass(m, i); return true;
    case 'sprinkle_can': sprinkle(m, i); return true;
    case 'sponge': sponge(m, i); return true;
    case 'waterwheel': return true; // Matter water pushes the bucket plates
    default: return false;
  }
}

/** A dispenser: absorb from the intake, then pour `rate` per second from the spout while open; `Empty` when it runs out. */
function dispenser(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, c = spec(m, i)!, mt = matterOf(m);
  absorb(m, i, c.kind, c.cap);
  if (mt) mt.intake(i, c.intake, 1 << c.kind, c.cap - s.q[i]!);
  if (!s.open[i]) { s.acc[i] = 0; return; }
  if (s.q[i]! <= 0) return;
  const n = take(m, i, c.rate);
  if (n <= 0) return;
  s.q[i] = s.q[i]! - n;
  if (mt) mt.emit(i, c.kind, n, c.spout, [c.dir[0] * c.speed, c.dir[1] * c.speed, c.dir[2] * c.speed], c.spread);
  if (s.q[i] === 0) h.emit('Empty', i, h.local(i, c.spout), 0, s.cause[i]!);
}

/**
 * HOURGLASS: q = ticks of sand left in the local-top bulb (full = duration). Upright (tilt < 70°) the top drains one tick
 * per tick; tipped past 110° the bulbs swap roles (it fills back: the other bulb drains); in between it pauses. Each time
 * the running bulb empties it pulses `out` (`Empty`); a change of running direction is a `Flip`.
 */
function hourglass(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!;
  const N = capacityOf(m, i);
  const up = qrot(bodyRot(h.bodies[p.base]!.body), [0, 1, 0])[1];
  const dir = up >= HOURGLASS.pauseCos ? 1 : up <= -HOURGLASS.pauseCos ? -1 : 0;
  s.ph[i] = 0;
  if (dir === 0) return;
  if (dir !== s.open[i]) {
    s.open[i] = dir;
    s.aux[i] = 0;
    h.emit('Flip', i, h.local(i, HOURGLASS.neck), dir, h.st.lastEv[i] ?? -1);
  }
  if (s.aux[i]) return; // done until flipped
  const was = s.q[i]!;
  s.q[i] = Math.max(0, Math.min(N, was - dir));
  if (s.q[i] === was) { s.aux[i] = 1; return; } // nothing left to run (placed upside down): done without a signal
  s.ph[i] = 1; // flowing
  if ((dir === 1 && s.q[i] === 0) || (dir === -1 && s.q[i] === N)) {
    s.aux[i] = 1;
    h.st.pressed[i] = Math.round(0.2 * h.tickRate);
    const id = h.emit('Empty', i, h.local(i, HOURGLASS.neck), 0, h.st.lastEv[i] ?? -1);
    h.pulse(i, 'out', id);
  }
}

/**
 * SPRINKLE CAN: it rests upright on its hinge's 0° limit. A knock of ≥ 0.3 N·s on the can, or a push past the 20°
 * detent, latches it: a position motor drives it to the 45° pour stop and holds it there for the rest of the run
 * (`Trigger`). While the level reaches the spout (tilt ≥ 6° + 32° × (1 − fill)) it sprinkles 0.25 L/s from the rose.
 */
function sprinkle(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!, J = h.Jolt;
  const hinge = p.hinge;
  if (!hinge || p.arm < 0) return;
  const deg = (hinge.GetCurrentAngle() * 180) / Math.PI;
  if (!s.open[i] && deg >= SPRINKLE.detent) latch(m, i, h.st.lastEv[i] ?? -1);
  const mt = matterOf(m);
  // refill through the fill hole while it stands upright (the intake box is on the can, which matches the base when upright)
  if (deg < 5) {
    absorb(m, i, SPRINKLE.kind, SPRINKLE.capacity);
    if (mt) mt.intake(i, SPRINKLE.intake, 1 << SPRINKLE.kind, SPRINKLE.capacity - s.q[i]!);
  }
  const fill = s.q[i]! / SPRINKLE.capacity;
  s.ph[i] = 0;
  if (s.q[i]! > 0 && deg >= 6 + 32 * (1 - fill)) {
    const n = take(m, i, SPRINKLE.rate);
    if (n > 0) {
      s.ph[i] = 1;
      s.q[i] = s.q[i]! - n;
      if (mt) {
        const arm = h.bodies[p.arm]!.body;
        const at = toLocal(m.c, i, h.local(i, SPRINKLE.rose, 'arm'));
        const d = localDir(m, i, qrot(bodyRot(arm), SPRINKLE.roseDir));
        mt.emit(i, SPRINKLE.kind, n, at, [d[0] * SPRINKLE.speed, d[1] * SPRINKLE.speed, d[2] * SPRINKLE.speed], SPRINKLE.spread);
      }
      m.setMass(p.arm, SPRINKLE.canMass + s.q[i]! / 1000);
      if (s.q[i] === 0) h.emit('Empty', i, h.local(i, SPRINKLE.rose, 'arm'), 0, s.cause[i]!);
    }
  } else if (s.q[i]! > 0) m.setMass(p.arm, SPRINKLE.canMass + s.q[i]! / 1000);
  if (s.open[i]) h.bi.ActivateBody(h.bodies[p.arm]!.body.GetID());
  void J;
}

/** The latched can's tip motor: 6 N·m, 4 Hz. Jolt saves a motor's state and target, but not these settings. */
function latchMotor(hinge: JoltModule): void {
  const mo = hinge.GetMotorSettings();
  mo.mMinTorqueLimit = f32(-6);
  mo.mMaxTorqueLimit = f32(6);
  mo.mSpringSettings.mFrequency = f32(4);
  mo.mSpringSettings.mDamping = f32(1);
}

/**
 * SIMFIX (rule 14): after a restore, latched cans get their motor settings back. A rollback within one run already had
 * them (the latch is one-way), but a partner's checkpoint (desync repair) can latch a can the test system never latched.
 */
export function sprinkleRestore(m: M4Parts): void {
  for (const i of m.c.list('sprinkle_can')) { const hinge = m.c.h.parts[i]!.hinge; if (hinge && m.st.open[i]) latchMotor(hinge); }
}

function latch(m: M4Parts, i: number, cause: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!, J = h.Jolt;
  if (s.open[i]) return;
  s.open[i] = 1;
  const hinge = p.hinge!;
  hinge.SetMotorState(J.EMotorState_Position);
  hinge.SetTargetAngle(f32((SPRINKLE.stop * Math.PI) / 180));
  latchMotor(hinge);
  h.bi.ActivateBody(h.bodies[p.arm]!.body.GetID());
  s.cause[i] = h.emit('Trigger', i, h.local(i, SPRINKLE.rose, 'arm'), 1, cause);
  h.st.lastEv[i] = s.cause[i]!;
}

/**
 * SPONGE: absorbs Matter water through its skin (5 mm proud) up to 2 L; its mass is 0.05 kg + 1 g per mL. Squeezed (a
 * ≥ 2 N·s hit squeezes it for 0.25 s; ≥ 5 kg resting on it squeezes it while it stays) it releases 1 L/s from its ends,
 * and its skin stops absorbing until 0.5 s after the squeeze ends.
 */
function sponge(m: M4Parts, i: number): void {
  const h = m.c.h, s = m.st, p = h.parts[i]!, mt = matterOf(m), t = h.st.tick;
  const squeezing = s.aux[i] === 1;
  if (!squeezing && t >= s.t0[i]!) absorb(m, i, SPONGE.kind, SPONGE.capacity);
  if (mt) mt.intake(i, SPONGE.intake, 1 << SPONGE.kind, squeezing || t < s.t0[i]! ? 0 : SPONGE.capacity - s.q[i]!);
  if (squeezing && s.q[i]! > 0) {
    const n = take(m, i, SPONGE.rate);
    if (n > 0) {
      s.q[i] = s.q[i]! - n;
      if (mt) {
        // half from each end, out along ±X
        const a = Math.ceil(n / 2), b2 = n - a;
        for (const [k, cnt] of [[0, a], [1, b2]] as const) {
          if (!cnt) continue;
          const e = SPONGE.ends[k]!, sx = k === 0 ? 1 : -1;
          mt.emit(i, SPONGE.kind, cnt, e, [sx * SPONGE.speed, 0, 0], 0.01);
        }
      }
    }
  } else s.acc[i] = 0;
  m.setMass(p.base, SPONGE.dry + s.q[i]! / 1000);
}

// ---- stage 9 --------------------------------------------------------------------------------------------------------

/** SPONGE: a hard hit squeezes it; whatever rests on its top adds to its squeeze load. */
export function matterContact(m: M4Parts, pi: number, mb: HostBody, ob: HostBody | undefined, J: number, pos: Vec, added: boolean, cause: number): boolean {
  const h = m.c.h, p = h.parts[pi]!, s = m.st;
  switch (p.def.type) {
    case 'sponge': {
      if (mb.role !== 'base') return true;
      if (added && J >= SPONGE.squeezeJ) {
        s.n[pi] = Math.max(s.n[pi]!, h.st.tick + Math.round(SPONGE.hitS * h.tickRate));
        s.cause[pi] = cause;
      }
      if (ob?.dynamic && toLocal(m.c, pi, pos)[1] > 0.03) {
        const inv = ob.body.GetMotionProperties().GetInverseMass();
        if (inv > 0) m.load.set(pi, (m.load.get(pi) ?? 0) + 1 / inv);
        m.loadCause.set(pi, Math.max(m.loadCause.get(pi) ?? -1, cause));
      }
      return true;
    }
    case 'sprinkle_can': {
      // a knock on the can (the back or the handle, not the spout) tips it past its detent
      if (mb.role !== 'arm' || !added || J < SPRINKLE.kickJ || s.open[pi]) return true;
      latch(m, pi, cause);
      return true;
    }
    default: return false;
  }
}

/** End of stage 9: SPONGE squeeze state for the next stage 6 (`Squeeze` on its rising edge while it holds water). */
export function matterAfterContacts(m: M4Parts): void {
  const h = m.c.h, s = m.st, t = h.st.tick;
  for (const i of m.c.list('sponge')) {
    if (!h.st.alive[i]) continue;
    const kg = m.load.get(i) ?? 0;
    const on = kg >= SPONGE.squeezeKg - 1e-9 || t < s.n[i]!;
    if (on && !s.aux[i]) {
      if (s.q[i]! > 0) {
        const c = Math.max(s.cause[i]!, m.loadCause.get(i) ?? -1);
        s.cause[i] = h.emit('Squeeze', i, h.com(i), s.q[i]!, c);
      }
      h.st.pressed[i] = Math.round(0.3 * h.tickRate);
    }
    if (!on && s.aux[i]) s.t0[i] = t + Math.round(SPONGE.quietS * h.tickRate);
    if (on) h.st.pressed[i] = Math.max(h.st.pressed[i]!, 2);
    s.aux[i] = on ? 1 : 0;
  }
}

// ---- outputs --------------------------------------------------------------------------------------------------------

export function matterFill(m: M4Parts, i: number): number {
  return Math.max(0, Math.min(1, m.st.q[i]! / capacityOf(m, i)));
}

/** Fill bars (GRIT HOPPER, TANK, MARBLE HOPPER) as 1–21, like CELL. */
export function matterMeter(m: M4Parts, i: number): number {
  const t = m.c.h.parts[i]!.def.type;
  return t === 'grit_hopper' || t === 'tank' || t === 'marble_hopper' || t === 'goo_vat' ? 1 + Math.round(20 * matterFill(m, i)) : 0;
}

/**
 * Flags: dispensers `lit` while pouring (gate open with contents), `fault` while low (under 10 %, the amber blink);
 * HOURGLASS `lit` while its stream runs, `pressed` for 0.2 s when it signals; SPRINKLE CAN `lit` while it sprinkles,
 * `armed` once latched; SPONGE `lit` while wet (≥ 20 %: darker), `pressed` while squeezed (the Machine's pressed timer).
 */
export function matterFlags(m: M4Parts, i: number): number {
  const s = m.st, t = m.c.h.parts[i]!.def.type;
  switch (t) {
    case 'grit_hopper': case 'tank': case 'marble_hopper': case 'goo_vat': {
      const f = matterFill(m, i);
      return (s.open[i] && s.q[i]! > 0 ? 1 : 0) | (f > 0 && f < 0.1 ? 64 : 0);
    }
    case 'hourglass': return s.ph[i] ? 1 : 0;
    case 'sprinkle_can': return (s.ph[i] ? 1 : 0) | (s.open[i] ? 16 : 0);
    case 'sponge': return matterFill(m, i) >= 0.2 ? 1 : 0;
    default: return 0;
  }
}
