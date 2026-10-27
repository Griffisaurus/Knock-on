// SIMFIX (beta polish, M5_PLAN rule 14): rollback-safe state for every channel and behaviour module.
//
// Each test compares a straight run with runs that reach the same tick another way: a rollback within the run (after
// running further ahead, so a future that no longer happens has touched Jolt) and a fresh machine adopting the run's
// checkpoint (desync repair, MULTIPLAYER §7.4). Beyond the state hash, they compare the Jolt settings that Jolt's
// SaveState doesn't record (object layers, gravity factors, masses and inertia, collision groups, hinge and slider
// limits, friction and motor settings, constraint enables, activation) one tick after the restore, when the behaviours
// have had their stage 6: anything a module set and failed to re-derive shows up there even before it moves a body.
//
// The fixes these pin (docs/dev/BETA_NOTES_SIMFIX.md): PING's relay guard (m3.wTick / wFired), FLAP's knuckle friction,
// a BIG TOP's caught Roller, SPRINKLE CAN / SPONGE masses (ScaleToMass rounding) and the SPRINKLE CAN latch motor; and
// the checkpoint's copy of `st` (clonePlain, D118). D119 makes this file the gate for new parts and behaviour modules.

import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { JoltModule } from '@knockon/jolt';
import type { Props } from '@knockon/parts-data';
import { Machine, type Poke, type SimEvent } from '../src/index.ts';
import { clonePlain } from '../src/machine.ts';
import { Build, jolt } from './harness.ts';
import { M2_SCENES } from './fuzz_scenes_m2.ts';
import { M3_SCENES } from './fuzz_scenes_m3.ts';
import { M4_SCENES } from './fuzz_scenes_m4.ts';
import { B4_SCENES } from './fuzz_scenes_b4.ts';
import { B5_SCENES } from './fuzz_scenes_b5.ts';
import { M5_SCENES } from './fuzz_scenes_m5.ts';
import { X5_SCENES } from './fuzz_scenes_x5.ts';
import { DEMOS } from '../../parts-data/src/demos.ts';

// ---- the Jolt settings SaveState doesn't record ---------------------------------------------------------------------

/** Constraints by physics system (pointer), in the order they were added (the build order, so the same on every machine). */
const added = new Map<number, JoltModule[]>();
let patched = false;

/** Records every constraint any Machine adds (JoltJS doesn't bind PhysicsSystem::GetConstraints). Test-only. */
async function joltWithRegistry(): Promise<JoltModule> {
  const J = await jolt();
  if (!patched) {
    patched = true;
    const proto = J.PhysicsSystem.prototype;
    const orig = proto.AddConstraint;
    proto.AddConstraint = function (this: JoltModule, c: JoltModule) {
      const k = J.getPointer(this) as number;
      let list = added.get(k);
      if (!list) { list = []; added.set(k, list); }
      list.push(c);
      return orig.call(this, c);
    };
  }
  return J;
}

/** Destroys a machine and forgets its constraints (a later machine may get the same physics-system address). */
function kill(J: JoltModule, m: Machine): void {
  const k = J.getPointer((m as unknown as { system: JoltModule }).system) as number;
  m.destroy();
  added.delete(k);
}

/** A labelled list of the settings, per body and per constraint. Motor settings count only while their motor runs. */
function fingerprint(J: JoltModule, m: Machine): [string, number][] {
  const out: [string, number][] = [];
  const filters = new Map<number, number>(); // group filters by first use (addresses differ between machines)
  const mm = m as unknown as { system: JoltModule; bodies: { body: JoltModule; part: number; role: string }[] };
  mm.bodies.forEach((rec, i) => {
    const b = rec.body, tag = `body ${i} (part ${rec.part} ${rec.role})`;
    out.push([`${tag} layer`, b.GetObjectLayer()], [`${tag} active`, b.IsActive() ? 1 : 0]);
    const g = b.GetCollisionGroup();
    out.push([`${tag} group`, g.GetGroupID()], [`${tag} subgroup`, g.GetSubGroupID()], [`${tag} filter`, ordinal(filters, J.getPointer(g.GetGroupFilter()) as number)]);
    if (b.IsStatic()) return;
    const mp = b.GetMotionProperties();
    out.push([`${tag} gravity`, mp.GetGravityFactor()], [`${tag} invMass`, mp.GetInverseMass()]);
    const d = mp.GetInverseInertiaDiagonal();
    out.push([`${tag} invI.x`, d.GetX()], [`${tag} invI.y`, d.GetY()], [`${tag} invI.z`, d.GetZ()]);
  });
  const list = added.get(J.getPointer(mm.system) as number) ?? [];
  list.forEach((c, k) => {
    const tag = `constraint ${k}`;
    out.push([`${tag} enabled`, c.GetEnabled() ? 1 : 0]);
    const sub = c.GetSubType();
    if (sub === J.EConstraintSubType_Hinge) {
      const h = J.castObject(c, J.HingeConstraint);
      out.push([`${tag} limits`, h.GetLimitsMin()], [`${tag} limits max`, h.GetLimitsMax()], [`${tag} friction`, h.GetMaxFrictionTorque()]);
      const state = h.GetMotorState();
      out.push([`${tag} motor`, state]);
      if (state !== J.EMotorState_Off) {
        const s = h.GetMotorSettings();
        out.push([`${tag} torque min`, s.mMinTorqueLimit], [`${tag} torque max`, s.mMaxTorqueLimit]);
        if (state === J.EMotorState_Position) out.push([`${tag} spring`, s.mSpringSettings.mFrequency], [`${tag} damping`, s.mSpringSettings.mDamping]);
      }
    } else if (sub === J.EConstraintSubType_Slider) {
      const s = J.castObject(c, J.SliderConstraint);
      out.push([`${tag} limits`, s.GetLimitsMin()], [`${tag} limits max`, s.GetLimitsMax()], [`${tag} friction`, s.GetMaxFrictionForce()]);
      const state = s.GetMotorState();
      out.push([`${tag} motor`, state]);
      if (state !== J.EMotorState_Off) {
        const ms = s.GetMotorSettings();
        out.push([`${tag} force min`, ms.mMinForceLimit], [`${tag} force max`, ms.mMaxForceLimit]);
        if (state === J.EMotorState_Position) out.push([`${tag} spring`, ms.mSpringSettings.mFrequency], [`${tag} damping`, ms.mSpringSettings.mDamping]);
      }
    }
  });
  return out;
}

/** 0 for none, else the order in which a machine's bodies first use the object (pointer). */
function ordinal(seen: Map<number, number>, ptr: number): number {
  if (!ptr) return 0;
  let k = seen.get(ptr);
  if (k === undefined) { k = seen.size + 1; seen.set(ptr, k); }
  return k;
}

/** The first few settings that differ (empty: none). */
function diff(a: [string, number][], b: [string, number][]): string[] {
  const out: string[] = [];
  if (a.length !== b.length) out.push(`length ${a.length} vs ${b.length}`);
  for (let k = 0; k < Math.min(a.length, b.length) && out.length < 6; k++) {
    if (a[k]![0] !== b[k]![0] || !Object.is(a[k]![1], b[k]![1])) out.push(`${a[k]![0]}: ${a[k]![1]} vs ${b[k]![0]}: ${b[k]![1]}`);
  }
  return out;
}

// ---- the three ways to reach a tick ------------------------------------------------------------------------------------

interface Plan {
  /** The checkpoint the rollback and the adoption restore (a multiple of 60). */
  readonly at: number;
  /** How far the rolled-back machine runs first (its abandoned future). */
  readonly ahead: number;
  /** Where the hashes are compared at the end. */
  readonly end: number;
  readonly pokes?: readonly Poke[];
}

/**
 * Straight run vs (1) a rollback to `at` after running to `ahead`, and (2) a fresh machine importing the straight run's
 * checkpoint at `at`: state hashes at `at` and `end`, and the unrecorded Jolt settings one tick after `at`. Pokes are
 * given to every machine up front (a late poke is its own test below).
 */
async function threeWays(b: Build, plan: Plan): Promise<{ problems: string[]; events: SimEvent[] }> {
  const J = await joltWithRegistry();
  const problems: string[] = [];
  const events: SimEvent[] = [];
  const a = new Machine(J, b);
  try {
    for (const p of plan.pokes ?? []) a.addPoke(p);
    while (a.tick < plan.at) { a.step(); events.push(...a.drainEvents()); }
    const hAt = a.hash();
    a.step(); events.push(...a.drainEvents());
    const fp = fingerprint(J, a);
    while (a.tick < plan.end) { a.step(); events.push(...a.drainEvents()); }
    const hEnd = a.hash();

    const r = new Machine(J, b);
    try {
      for (const p of plan.pokes ?? []) r.addPoke(p);
      while (r.tick < plan.ahead) r.step();
      expect(r.restore(plan.at)).toBe(plan.at);
      if (r.hash() !== hAt) problems.push(`rollback: hash at ${plan.at}`);
      r.step();
      for (const d of diff(fp, fingerprint(J, r))) problems.push(`rollback: ${d}`);
      while (r.tick < plan.end) r.step();
      if (r.hash() !== hEnd) problems.push(`rollback: hash at ${plan.end}`);
    } finally { kill(J, r); }

    const blob = a.exportCheckpoint(plan.at);
    expect(blob?.tick).toBe(plan.at);
    const c = new Machine(J, b);
    try {
      for (const p of plan.pokes ?? []) c.addPoke(p);
      expect(c.importCheckpoint(blob!.blob)).toBe(plan.at);
      if (c.hash() !== hAt) problems.push(`adopted: hash at ${plan.at}`);
      c.step();
      for (const d of diff(fp, fingerprint(J, c))) problems.push(`adopted: ${d}`);
      while (c.tick < plan.end) c.step();
      if (c.hash() !== hEnd) problems.push(`adopted: hash at ${plan.end}`);
    } finally { kill(J, c); }
  } finally { kill(J, a); }
  return { problems, events };
}

// ---- the fixes, one machine each ---------------------------------------------------------------------------------------

describe('rule 14: the SIMFIX fixes', () => {
  it('PING: a late poke that rolls back across a fired PING relays it again (hash = straight run)', async () => {
    // RINGER (2 s) → PING Tx ⇢ PING Rx → BANGSTICK: the relay fires at tick 240. A poke for tick 230, delivered at tick
    // 400, rolls back to the tick-180 checkpoint, so the re-run passes through the PING's tick again.
    const b = new Build();
    const ringer = b.add('ringer', 0, 0, 0, { time: 2 });
    const tx = b.add('ping', 0.5, 0, 0, { pair: 2, mode: 0 });
    const rx = b.add('ping', 1.5, 0, 0, { pair: 2, mode: 1 });
    const bang = b.add('bangstick', 2.5, 0, 0);
    const ball = b.add('thud', -0.8, 0, 0.5);
    b.link('cable_signal', ringer, 'out', tx, 'in');
    b.link('cable_signal', rx, 'out', bang, 'detonator');
    const poke: Poke = { tick: 230, seq: 1, partId: ball, kind: 'impulse', data: [0.4, 1.2, 0] };
    const J = await joltWithRegistry();
    const straight = new Machine(J, b);
    straight.addPoke(poke);
    const seen = (m: Machine, to: number): SimEvent[] => { const out: SimEvent[] = []; while (m.tick < to) { m.step(); out.push(...m.drainEvents()); } return out; };
    const e1 = seen(straight, 480);
    expect(e1.filter((e) => e.kind === 'PingRx' || e.kind === 'Detonate').map((e) => `${e.kind}@${e.tick}`)).toEqual(['PingRx@240', 'Detonate@240']);
    const late = new Machine(J, b);
    seen(late, 400);
    late.addPoke(poke);
    expect(late.restore(poke.tick)).toBe(180);
    const e2 = seen(late, 480);
    expect(e2.filter((e) => e.kind === 'PingRx' || e.kind === 'Detonate').map((e) => `${e.kind}@${e.tick}`)).toEqual(['PingRx@240', 'Detonate@240']);
    expect(late.hash()).toBe(straight.hash());
    kill(J, straight); kill(J, late);
  }, 60_000);

  it('PING: rollback and adoption across the relay tick match the straight run', async () => {
    const b = new Build();
    const ringer = b.add('ringer', 0, 0, 0, { time: 2 });
    const tx = b.add('ping', 0.5, 0, 0, { pair: 1, mode: 0 });
    const rx = b.add('ping', 1.5, 0, 0, { pair: 1, mode: 1 });
    const rx2 = b.add('ping', 1.5, 0, 0.5, { pair: 1, mode: 1 });
    const flap = b.add('flap', 2.5, 0.5, 0);
    const bang = b.add('bangstick', 2.5, 0, 0.8);
    b.link('cable_signal', ringer, 'out', tx, 'in');
    b.link('cable_signal', rx, 'out', flap, 'in');
    b.link('cable_signal', rx2, 'out', bang, 'detonator');
    const { problems } = await threeWays(b, { at: 180, ahead: 420, end: 480 });
    expect(problems.join('\n')).toBe('');
  }, 60_000);

  it('FLAP: the knuckle friction of an opened flap is re-derived (rollback to before it opened, and adoption after)', async () => {
    // a signal opens the flap at ≈ 0.2 s and it auto-closes after 1 s; rolling back to tick 0 from tick 400 used to keep
    // the friction the abandoned opening set, and a fresh machine adopting tick 180 lacked it
    const b = new Build();
    const flap = b.add('flap', 0, 0.5, 0, { close: 1 });
    const button = b.add('the_button', -0.8, 0, 0.6);
    b.add('thud', -0.8, 0.2, 0.6);
    b.link('cable_signal', button, 'out', flap, 'in');
    b.add('boing', 0.05, 0.9, 0);
    const before = await threeWays(b, { at: 0, ahead: 400, end: 360 });
    expect(before.events.some((e) => e.part === flap && e.kind === 'Signal')).toBe(true);
    expect(before.problems.join('\n')).toBe('');
    const after = await threeWays(b, { at: 180, ahead: 400, end: 420 });
    expect(after.problems.join('\n')).toBe('');
  }, 60_000);

  it('BIG TOP: a Roller caught after the checkpoint is handed back to the world on rollback', async () => {
    // rolling back to tick 60 from after the catch used to leave the ball a gravity-free ghost, floating
    const b = new Build();
    b.add('big_top', 0, 0, 0, { elevation: 30 });
    b.add('boing', 0.25, 2.4, 0); // drops into the bell: caught at tick 77, held from then on
    const res = await threeWays(b, { at: 60, ahead: 360, end: 360 });
    expect(res.problems.join('\n')).toBe('');
  }, 60_000);

  it('SPRINKLE CAN: the can\'s mass, inertia and latch motor survive rollback and adoption exactly', async () => {
    // a ball knocks the can past its detent at ≈ 0.4 s: it latches and pours (its mass falls every tick, ScaleToMass)
    const b = new Build();
    b.add('sprinkle_can', 0, 0, 0);
    b.add('thud', -0.05, 0.6, 0);
    b.add('sponge', 0.4, 0, 0);
    for (const plan of [{ at: 60, ahead: 420, end: 420 }, { at: 120, ahead: 300, end: 420 }, { at: 240, ahead: 300, end: 420 }]) {
      const res = await threeWays(b, plan);
      expect(res.problems.join('\n')).toBe('');
    }
  }, 60_000);
});

// ---- every part's fuzz scene ----------------------------------------------------------------------------------------------

const SCENES: Readonly<Record<string, (b: Build, p: Props) => void>> = {
  ...M2_SCENES, ...M3_SCENES, ...M4_SCENES, ...B4_SCENES, ...B5_SCENES, ...M5_SCENES, ...X5_SCENES,
};

describe('rule 14: every part scene rolls back and is adopted exactly', () => {
  for (const [type, scene] of Object.entries(SCENES)) {
    it(`${type}`, async () => {
      const b = new Build();
      scene(b, {});
      // tick 60: the scenes' signals (≈ 0.2 s) have fired; the abandoned future runs on to 3.5 s
      const res = await threeWays(b, { at: 60, ahead: 420, end: 300 });
      expect(res.problems.join('\n')).toBe('');
    }, 60_000);
  }
});

describe('rule 14: every Library demo rolls back and is adopted exactly', () => {
  for (const [key, demo] of Object.entries(DEMOS)) {
    it(`${key}`, async () => {
      const b = new Build();
      b.parts.push(...demo.parts);
      b.links.push(...demo.links);
      const res = await threeWays(b, { at: 60, ahead: demo.ticks + 120, end: demo.ticks });
      expect(res.problems.join('\n')).toBe('');
    }, 60_000);
  }
});

// ---- the checkpoint's copy of `st` (SIMFIX: clonePlain instead of structuredClone) -----------------------------------------

describe('checkpoints copy st exactly (clonePlain)', () => {
  it('equals structuredClone on every scene\'s run state, and shares nothing with it', async () => {
    const J = await joltWithRegistry();
    for (const [type, scene] of Object.entries(SCENES)) {
      const b = new Build();
      scene(b, {});
      const m = new Machine(J, b);
      try {
        for (let t = 0; t < 90; t++) m.step();
        const st = (m as unknown as { st: unknown }).st;
        const copy = clonePlain(st);
        expect(isDeepStrictEqual(copy, structuredClone(st)), type).toBe(true);
        // no shared arrays or objects: every container in the copy is a new one
        const seen = new Set<unknown>();
        const walk = (x: unknown): void => { if (x !== null && typeof x === 'object') { seen.add(x); for (const v of Object.values(x)) walk(v); } };
        walk(st);
        const shared: unknown[] = [];
        const check = (x: unknown): void => { if (x !== null && typeof x === 'object') { if (seen.has(x)) shared.push(x); for (const v of Object.values(x)) check(v); } };
        check(copy);
        expect(shared.length, type).toBe(0);
      } finally { kill(J, m); }
    }
  }, 120_000);
});
