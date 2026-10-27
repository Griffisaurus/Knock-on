// M4 parts (stream A4): rules the per-part goldens don't pin down: rollback across every kind of M4 state, dormant pool
// bodies never pushed (rule 8), thresholds (ARC TOWER and TOAST CANNON need 75 % supply), HOURGLASS flips, ZIPPY's bump
// modes, VAC release, SPONGE mass, INFLATOR seating.

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { Machine, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

function run(m: Machine, ticks: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); }
  return ev;
}
const of = (ev: SimEvent[], kind: string, part?: number): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));

/** A THUD dropped from `h` on a BUTTON wired to `to`'s `port`. */
function press(b: Build, to: number, port: string, x: number, z: number, h = 0.2): void {
  const button = b.add('the_button', x, 0, z);
  b.add('thud', x, h, z);
  b.link('cable_signal', button, 'out', to, port);
}

/** Every M4 behaviour with state at once: toast cycle and pool, ZIPPY driving, INFLATOR filling, SPONGE squeezed, HOURGLASS, ARC TOWER strikes, VAC hold, GRIT HOPPER draining. */
function busyWorld(): Build {
  const b = new Build();
  const mains = b.add('mains', -1.2, 0, -1.0), mains2 = b.add('mains', 1.4, 0, -1.2);
  const toaster = b.add('toast_cannon', -0.8, 0, -0.6, { toast: 1 });
  const tower = b.add('arc_tower', 0.8, 0, -0.8);
  b.add('pig_iron', 1.2, 0.06, -0.8);
  const vac = b.add('vac', -0.8, 0, 0.6);
  b.add('fuzz', -0.8, 0.0325, 0.95);
  for (const p of [toaster, vac]) b.link('cable_power', mains, 'out', p, 'in');
  b.link('cable_power', mains2, 'out', tower, 'in');
  const car = b.add('zippy', 0, 0.036, 1.2, { speed: 0.8, start: 1 });
  void car;
  const inf = b.add('inflator', 0.6, 0, 0.4);
  b.add('helio', 0.68, 0.457, 0.414);
  press(b, inf, 'in', 1.2, 0.4);
  b.add('sponge', 0, 0.05, 0, { start: 100 });
  b.add('thud', 0, 0.5, 0);
  b.add('hourglass', -0.4, 0, -0.1, { duration: 2 });
  const hop = b.add('grit_hopper', 0.3, 0, -0.4, { capacity: 50000, rate: 10000, start: 10 });
  press(b, hop, 'open', 0.3, 0.2, 0.6);
  return b;
}

describe('M4 parts: determinism', () => {
  it('a rollback mid-run rejoins the straight run bit for bit (toast pool, vehicle, seat, masses, timers, strikes, holds)', async () => {
    const J = await jolt();
    const b = busyWorld();
    const straight = new Machine(J, b);
    const hs: string[] = [];
    const evA = run(straight, 1);
    for (let t = 1; t < 480; t++) { evA.push(...run(straight, 1)); if (t >= 240) hs.push(straight.hash()); }
    // the run did everything it should
    for (const k of ['Launch', 'Valve', 'Squeeze', 'Empty', 'Arc', 'Attach']) expect(of(evA, k).length, k).toBeGreaterThan(0);
    straight.destroy();
    const m = new Machine(J, b);
    run(m, 300);
    expect(m.restore(240)).toBe(240);
    const hs2: string[] = [];
    for (let t = 240; t < 480; t++) { m.step(); m.drainEvents(); hs2.push(m.hash()); }
    // both lists hold the hashes after ticks 241 … 480
    expect(hs2).toEqual(hs);
    m.destroy();
  }, 60_000);
});

describe('M4 parts: rules', () => {
  it('TOAST CANNON slices wait dormant: a blast beside the toaster before the pop leaves them where they were parked', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, -0.2);
    const toaster = b.add('toast_cannon', 0, 0, 0);
    b.link('cable_power', mains, 'out', toaster, 'in');
    const stick = b.add('bangstick', 0.3, 0.039, 0, { fuse: 0.5 });
    const wick = b.add('wick', 0.6, 0, 0.1);
    b.link('fuse', wick, 'flame', stick, 'fuse');
    const m = new Machine(J, b);
    const info = m.bodyInfo();
    const pieces = info.map((x, i) => (x.role === 'piece' ? i : -1)).filter((i) => i >= 0);
    expect(pieces).toHaveLength(6);
    const before = m.transforms(new Float32Array(info.length * 7));
    const ev = run(m, 240);
    expect(of(ev, 'Detonate').length).toBe(1);
    expect(of(ev, 'Launch')).toHaveLength(0); // 3 s toast: not yet
    const after = m.transforms(new Float32Array(info.length * 7));
    for (const i of pieces) for (let k = 0; k < 7; k++) expect(after[i * 7 + k]).toBe(before[i * 7 + k]);
    m.destroy();
  });

  it('TOAST CANNON and ARC TOWER need 75 % supply: on one MAINS with a 400 W tower (f ≈ 0.83) both work; with two towers (f ≈ 0.5) neither does', async () => {
    const J = await jolt();
    for (const towers of [1, 2]) {
      const b = new Build();
      const mains = b.add('mains', -0.6, 0, -0.4);
      const toaster = b.add('toast_cannon', 0, 0, 0, { toast: 1 });
      b.link('cable_power', mains, 'out', toaster, 'in');
      for (let k = 0; k < towers; k++) {
        const t = b.add('arc_tower', 0.6 + k * 1.5, 0, 0);
        b.add('pig_iron', 0.9 + k * 1.5, 0.06, 0);
        b.link('cable_power', mains, 'out', t, 'in');
      }
      const m = new Machine(J, b);
      const ev = run(m, 240);
      const ok = towers === 1; // 600 W demand of 500 W → f 0.83; two towers: 1000 W → f 0.5
      expect(of(ev, 'Launch').length > 0, `toast, ${towers} tower(s)`).toBe(ok);
      expect(of(ev, 'Arc').length > 0, `arcs, ${towers} tower(s)`).toBe(ok);
      m.destroy();
    }
  });

  it('HOURGLASS placed upside down has its sand at the bottom already (no signal); tilted 90° it pauses; upright it runs out on time', async () => {
    const J = await jolt();
    const b = new Build();
    const down = b.add('hourglass', 0, 0.2, 0, { duration: 1 }, snappedEuler(0, 180, 0)); // origin (bottom centre) now on top
    const side = b.add('hourglass', 0.4, 0.05, 0, { duration: 1 }, snappedEuler(0, 90, 0));
    const up = b.add('hourglass', -0.4, 0, 0, { duration: 1 });
    const m = new Machine(J, b);
    const ev = run(m, 200);
    expect(of(ev, 'Flip')).toHaveLength(0);
    expect(of(ev, 'Empty', down)).toHaveLength(0);
    expect(of(ev, 'Empty', side)).toHaveLength(0);
    expect(of(ev, 'Empty', up)[0]!.tick / 120).toBeCloseTo(1, 1);
    const fill = m.partFill(new Float32Array(3));
    expect([fill[0], fill[1], fill[2]]).toEqual([1, 1, 0]);
    m.destroy();
  });

  it('ZIPPY: bump mode Reverse backs it away from the brick; Ignore keeps pushing', async () => {
    const J = await jolt();
    for (const bump of [1, 2]) {
      const b = new Build();
      const car = b.add('zippy', 0, 0.036, 0, { speed: 1, bump, start: 1 });
      b.add('brik', 0.4, 0.05, 0, {}, snappedEuler(90, 0, 0));
      const m = new Machine(J, b);
      const ev = run(m, 240);
      const drives = of(ev, 'Drive', car).map((e) => e.mag);
      if (bump === 1) {
        expect(drives).toEqual([-1]);
        expect(pose(m, car).p[0]).toBeLessThan(0);
      } else {
        expect(drives).toEqual([]);
        expect(pose(m, car).p[0]).toBeGreaterThan(0.2);
      }
      m.destroy();
    }
  });

  it('VAC lets go of what it holds when its power is switched off', async () => {
    const J = await jolt();
    // it sucks in the FUZZ and holds it; the late press toggles the MAINS off and it lets go
    const b2 = new Build();
    const mains2 = b2.add('mains', -0.4, 0, -0.4);
    const vac2 = b2.add('vac', 0, 0, 0);
    const fz = b2.add('fuzz', 0, 0.0325, 0.3);
    b2.link('cable_power', mains2, 'out', vac2, 'in');
    press(b2, mains2, 'in', 0.6, -0.4, 6.0);
    const m2 = new Machine(J, b2);
    const ev2 = run(m2, 360);
    const at = of(ev2, 'Attach', vac2)[0]!, rel = of(ev2, 'Release', vac2)[0]!;
    expect(at.other).toBe(fz);
    expect(rel.other).toBe(fz);
    expect(rel.tick).toBeGreaterThan(at.tick);
    expect(of(ev2, 'Unpowered', vac2)[0]!.tick).toBeLessThanOrEqual(rel.tick);
    m2.destroy();
  });

  it('SPONGE mass is 0.05 kg plus 1 g per mL held: 2.05 kg soaked, 0.05 kg wrung out', async () => {
    const J = await jolt();
    const b = new Build();
    const sp = b.add('sponge', 0, 0.05, 0, { start: 100 });
    b.add('thud', 0, 0.5, 0);
    const m = new Machine(J, b);
    const mass = (): number => 1 / m.bodies[0]!.body.GetMotionProperties().GetInverseMass();
    expect(mass()).toBeCloseTo(2.05, 4);
    run(m, 360);
    expect(mass()).toBeCloseTo(0.05, 4);
    void sp;
    m.destroy();
  });

  it('INFLATOR seats only a HELIO whose knot is on its nozzle; a HELIO elsewhere keeps its full lift', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('inflator', 0, 0, 0);
    const seated = b.add('helio', 0.08, 0.457, 0.014);
    const free = b.add('helio', 0.6, 0.3, 0);
    const m = new Machine(J, b);
    run(m, 240);
    expect(pose(m, seated).p[1]).toBeCloseTo(0.457, 1); // held on the nozzle, empty: no lift
    expect(pose(m, free).p[1]).toBeGreaterThan(0.6); // floats up
    const fill = m.partFill(new Float32Array(3));
    expect(fill[1]).toBe(0);
    m.destroy();
  });
});
