// M3 parts (stream A3): behaviour checks beyond the goldens. Rollback across pools, rails and fields; dormant bodies
// never pushed (rule 8); real bait for Bandit; cook-off, shock, wireless, douse, zones, power draw, racks, breakables.

import { describe, expect, it } from 'vitest';
import { snappedEuler, type PartId } from '@knockon/format';
import { CRITTER_FSM, fracOf } from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { Machine, type SimEvent } from '../src/index.ts';
import { path } from './fuzz_scenes_m3.ts';
import { Build, jolt, pose, trace } from './harness.ts';

const T = 60_000;
const of = (ev: readonly SimEvent[], kind: string, part?: PartId): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const run = (m: Machine, ticks: number): SimEvent[] => { const ev: SimEvent[] = []; for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); } return ev; };

/** A busy M3 machine: a FABRICATOR feeding a RECYCLER, a lit SKYSHOW, a marble on a GLIDEPATH, a MAGLOCK and a LIFT. */
function busyWorld(): Build {
  const b = new Build();
  const fab = b.add('fabricator', -0.8, 0, 0, { part: 1, count: 6, interval: 0.25, speed: 1.5 });
  b.add('recycler', -0.8, 0, 0.75);
  void fab;
  const wick = b.add('wick', 0.6, 0, 0.22);
  const cake = b.add('skyshow', 0.6, 0, 0, { altitude: 2 });
  b.link('fuse', wick, 'flame', cake, 'fuse');
  path(b, 'glidepath', [[-0.6, 0.6, -0.8], [-0.2, 0.35, -0.8], [0.2, 0.25, -0.6], [0.5, 0.3, -0.5]]);
  b.add('bearing', -0.6, 0.615, -0.8);
  const mains = b.add('mains', 1.2, 0, -0.6);
  const mag = b.add('maglock', 1.2, 0, -0.3);
  b.add('pig_iron', 1.2, 0.06, -0.05);
  b.add('stitch', -0.79, 0.5, 0.75); // two drop into the RECYCLER
  b.add('stitch', -0.81, 0.8, 0.77);
  const lift = b.add('lift', 1.6, 0, 0.6, { travel: 0.5, speed: 0.5 });
  b.add('boing', 1.6, 0.171, 0.6);
  const button = b.add('the_button', 2.0, 0, 0.6);
  b.add('thud', 2.0, 0.3, 0.6);
  b.link('cable_power', mains, 'out', mag, 'in');
  b.link('cable_power', mains, 'out', lift, 'in');
  b.link('cable_signal', button, 'out', lift, 'call');
  return b;
}

describe('M3 determinism and rollback', () => {
  it('replays bit-identically, and a rollback across spawns, shells, riders and holds rejoins the straight run', async () => {
    const J = await jolt();
    const b = busyWorld();
    const a = new Machine(J, b);
    const ev = run(a, 480);
    // the machine really did all of it
    expect(of(ev, 'Spawn').length).toBeGreaterThanOrEqual(4);
    expect(of(ev, 'Despawn').length).toBeGreaterThanOrEqual(1);
    expect(of(ev, 'Burst').length).toBeGreaterThanOrEqual(1);
    expect(of(ev, 'RailOn').length).toBe(1);
    expect(of(ev, 'Attach').length).toBeGreaterThanOrEqual(1);
    expect(of(ev, 'Arrive').length).toBe(1);
    const straight = a.hash();
    const c = new Machine(J, b);
    run(c, 300);
    expect(c.restore(250)).toBe(240);
    while (c.tick < 480) { c.step(); c.drainEvents(); }
    expect(c.hash()).toBe(straight);
    // and a late poke (on the cake) rolls back cleanly too
    const cake = b.parts.find((p) => p.type === 'skyshow')!.id;
    const poke = { tick: 200, seq: 1, partId: cake, kind: 'impulse' as const, data: [0.4, 0.6, 0] };
    const d = new Machine(J, b);
    d.addPoke(poke);
    run(d, 480);
    const e = new Machine(J, b);
    run(e, 230);
    e.addPoke(poke);
    expect(e.restore(200)).toBe(180);
    while (e.tick < 480) { e.step(); e.drainEvents(); }
    expect(e.hash()).toBe(d.hash());
    for (const m of [a, c, d, e]) m.destroy();
  }, T);

  it('dormant pool bodies are never pushed: a blast beside a FABRICATOR leaves its pool parked', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('fabricator', 0, 0, 0, { part: 0, count: 4, interval: 0, speed: 1 });
    const stick = b.add('bangstick', 0.4, 0.039, 0.3, { fuse: 0.5 });
    const wick = b.add('wick', 0.7, 0, 0.3);
    b.link('fuse', wick, 'flame', stick, 'fuse');
    const m = new Machine(J, b);
    const info = m.bodyInfo();
    const pool = info.map((x, i) => (x.type === 'fabricator' && x.role === 'piece' ? i : -1)).filter((i) => i >= 0);
    expect(pool).toHaveLength(4);
    expect(pool.map((i) => info[i]!.chunk)).toEqual([0, 1, 2, 3]);
    const at0 = m.transforms(new Float32Array(info.length * 7));
    const ev = run(m, 240);
    expect(of(ev, 'Detonate')).toHaveLength(1);
    const at1 = m.transforms(new Float32Array(info.length * 7));
    for (const i of pool) for (let k = 0; k < 7; k++) expect(at1[i * 7 + k]).toBe(at0[i * 7 + k]);
    m.destroy();
  }, T);
});

describe('M3 lures', () => {
  it('a GLINT is real bait: Bandit steals it with no test-only lures', async () => {
    const J = await jolt();
    const b = new Build();
    const bandit = b.add('bandit', 0, 0, 0);
    const glint = b.add('glint', 0.2, 0.008, 1.0);
    const m = new Machine(J, b);
    const lure = m.lureEmitters().find((l) => l.part === glint);
    expect(lure?.species).toEqual({ bandit: 1.5 });
    const ev = run(m, 1200);
    const carry = CRITTER_FSM.indexOf('steal_carry');
    expect(of(ev, 'CritterState', bandit).some((e) => e.mag === carry)).toBe(true);
    m.destroy();
  }, T);
});

describe('M3 fire and boom', () => {
  it('POWDER KEG: its cook-off count resets when the heat stops (a FLAMER switched off at 1 s, on again at 1.5 s)', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('ledge', 0, 0.09, 0);
    const torch = b.add('flamer', 0, 0.14, 0, { on: 1 });
    b.add('powder_keg', 0.45, 0.15, 0);
    const off = b.add('ringer', -0.5, 0, 0.4, { time: 1 });
    const on = b.add('ringer', -0.5, 0, -0.4, { time: 1.5 });
    b.link('cable_signal', off, 'out', torch, 'on');
    b.link('cable_signal', on, 'out', torch, 'on');
    const m = new Machine(J, b);
    const ev = run(m, 480);
    const boom = of(ev, 'Detonate')[0];
    const lit = of(ev, 'Ignite', torch);
    expect(lit).toHaveLength(2); // on at the start, on again after the second ringer
    expect(of(ev, 'Cook')).toHaveLength(2); // the count started over
    expect(boom).toBeDefined();
    expect((boom!.tick - lit[1]!.tick) / 120).toBeCloseTo(1.5, 1); // 1.5 s from the second ignition, not the first
    m.destroy();
  }, T);

  it('JITTERJUICE: a soft knock (≥ 0.08 N·s) only jostles it; a 0.15 N·s knock sets it off', async () => {
    const J = await jolt();
    const soft = new Build();
    soft.add('jitterjuice', 0, 0.05, 0);
    soft.add('fuzz', 0, 0.38, 0);
    const m1 = new Machine(J, soft);
    const ev1 = run(m1, 120);
    expect(of(ev1, 'Jostle').length).toBeGreaterThanOrEqual(1);
    expect(of(ev1, 'Detonate')).toHaveLength(0);
    const hard = new Build();
    hard.add('jitterjuice', 0, 0.05, 0);
    hard.add('stitch', 0, 0.6, 0);
    const m2 = new Machine(J, hard);
    expect(of(run(m2, 120), 'Detonate')).toHaveLength(1);
    m1.destroy(); m2.destroy();
  }, T);

  it('FLAMER: a GALE on its nozzle blows it out, and it stays out', async () => {
    const J = await jolt();
    const b = new Build();
    const torch = b.add('flamer', 0, 0, 0, { on: 1 });
    const mains = b.add('mains', -0.6, 0, 0.5, { on: 0 });
    const fan = b.add('gale', 0.6, 0, 0, {}, snappedEuler(-90, 0, 0)); // blowing back along −X onto the nozzle
    const ring = b.add('ringer', -0.6, 0, -0.5, { time: 1 });
    b.link('cable_power', mains, 'out', fan, 'in');
    b.link('cable_signal', ring, 'out', mains, 'in');
    const m = new Machine(J, b);
    const ev = run(m, 360);
    expect(of(ev, 'Ignite', torch)).toHaveLength(1);
    const out = of(ev, 'Extinguish', torch)[0];
    expect(out!.tick).toBeGreaterThanOrEqual(120);
    expect(m.st.lit[m.parts.findIndex((p) => p.id === torch)]).toBe(false);
    m.destroy();
  }, T);
});

describe('M3 wireless, fields and power', () => {
  it('PING: an Rx wired back to a Tx of its own pair doesn’t loop (each Rx relays once a tick)', async () => {
    const J = await jolt();
    const b = new Build();
    const button = b.add('the_button', -0.6, 0, 0);
    b.add('thud', -0.6, 0.2, 0);
    const tx = b.add('ping', -0.3, 0, 0, { pair: 1, mode: 0 });
    const rx = b.add('ping', 0.3, 0, 0, { pair: 1, mode: 1 });
    const tx2 = b.add('ping', 0.3, 0, 0.3, { pair: 1, mode: 0 });
    b.link('cable_signal', button, 'out', tx, 'in');
    b.link('cable_signal', rx, 'out', tx2, 'in');
    const m = new Machine(J, b);
    const ev = run(m, 60);
    expect(of(ev, 'PingRx').map((e) => [e.part, e.other])).toEqual([[rx, tx]]);
    m.destroy();
  }, T);

  it('MAGLOCK holds only at supply ≥ 0.75 (four on a 500 W MAINS hold; five can only pull)', async () => {
    const J = await jolt();
    const attempt = async (n: number): Promise<number> => {
      const b = new Build();
      const mains = b.add('mains', -0.6, 0, 0);
      for (let k = 0; k < n; k++) {
        const mag = b.add('maglock', k * 0.5, 0, 0);
        b.add('bearing', k * 0.5, 0.1, 0.12);
        b.link('cable_power', mains, 'out', mag, 'in');
      }
      const m = new Machine(J, b);
      const held = of(run(m, 240), 'Attach').length;
      m.destroy();
      return held;
    };
    expect(await attempt(4)).toBeGreaterThanOrEqual(4);
    expect(await attempt(5)).toBe(0);
  }, T);

  it('ZONE: stasis freezes a falling ball, wind pushes along +X and blows out a WICK, gravity ×2 drops faster', async () => {
    const J = await jolt();
    const one = async (mode: number, strength: number, extra?: (b: Build) => void, ticks = 60): Promise<{ m: Machine; ev: SimEvent[]; ball: PartId }> => {
      const b = new Build();
      b.add('zone', 0, 0, 0, { mode, width: 1, height: 2, depth: 1, strength });
      const ball = b.add('stitch', 0, 1.0, 0);
      extra?.(b);
      const m = new Machine(J, b);
      return { m, ev: run(m, ticks), ball };
    };
    const still = await one(3, 0);
    expect(pose(still.m, still.ball).p[1]).toBeGreaterThan(0.99);
    const wind = await one(2, 6, (b) => { b.add('wick', 0.2, 0, 0.3); });
    expect(pose(wind.m, wind.ball).p[0]).toBeGreaterThan(0.05);
    expect(of(wind.ev, 'Extinguish')).toHaveLength(1);
    const heavy = await one(0, 2, undefined, 30), plain = await one(0, 1, undefined, 30); // before either lands
    expect(pose(heavy.m, heavy.ball).p[1]).toBeLessThan(pose(plain.m, plain.ball).p[1] - 0.05);
    for (const r of [still, wind, heavy, plain]) r.m.destroy();
  }, T);

  it('demand: a gas-mode FLAMER draws nothing and an idle LIFT draws nothing; a moving LIFT drains its CELL', async () => {
    const J = await jolt();
    const charge = async (call: boolean): Promise<number> => {
      const b = new Build();
      const cell = b.add('cell', -0.5, 0, 0, { capacity: 30 });
      const lift = b.add('lift', 0, 0, 0, { travel: 1, speed: 0.25 });
      const torch = b.add('flamer', 0.5, 0, 0.5, { on: 1 });
      b.link('cable_power', cell, 'out', lift, 'in');
      b.link('cable_power', cell, 'out', torch, 'in');
      if (call) {
        const button = b.add('the_button', 0.5, 0, -0.5);
        b.add('thud', 0.5, 0.2, -0.5);
        b.link('cable_signal', button, 'out', lift, 'call');
      }
      const m = new Machine(J, b);
      run(m, 240);
      const left = m.st.m2.val[m.parts.findIndex((p) => p.id === cell)]!;
      m.destroy();
      return left;
    };
    expect(await charge(false)).toBe(200 * 30);
    expect(await charge(true)).toBeLessThan(200 * 30 - 100);
  }, T);

  it('LIFT: over 15 kg on the deck it stalls (a Jam, the fault flag) and doesn’t move', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.6, 0, -0.5);
    const lift = b.add('lift', 0, 0, 0, { travel: 0.5, speed: 0.5 });
    const ball = b.add('wrecker', 0, 0.146, 0);
    const button = b.add('the_button', 0.5, 0, 0.3);
    b.add('thud', 0.5, 0.2, 0.3);
    b.link('cable_power', mains, 'out', lift, 'in');
    b.link('cable_signal', button, 'out', lift, 'call');
    const m = new Machine(J, b);
    const ev = run(m, 240);
    expect(of(ev, 'Jam', lift)).toHaveLength(1);
    expect(of(ev, 'Arrive')).toHaveLength(0);
    expect(m.partFlags(new Uint8Array(m.parts.length))[m.parts.findIndex((p) => p.id === lift)]! & 64).toBe(64);
    expect(pose(m, ball).p[1]).toBeLessThan(0.16);
    m.destroy();
  }, T);

  it('RECYCLER: a critter dropped in is refused (popped out, alive); a stitch is counted', async () => {
    const J = await jolt();
    const b = new Build();
    const r = b.add('recycler', 0, 0, 0, { target: 5 });
    const pip = b.add('pip', 0, 0.35, 0);
    const stitch = b.add('stitch', 0.03, 0.8, 0.03);
    const m = new Machine(J, b);
    const ev = run(m, 240);
    const gone = of(ev, 'Despawn', r);
    expect(gone.map((e) => e.other)).toEqual([stitch]);
    expect(m.st.alive[m.parts.findIndex((p) => p.id === pip)]).toBe(true);
    m.destroy();
  }, T);
});

describe('M3 fun', () => {
  it('PINS: a blast in the middle of a rack downs all ten: one PinsAllDown with mag 10', async () => {
    const J = await jolt();
    const b = new Build();
    const pins: PartId[] = [];
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) pins.push(b.add('pin', row * 0.104, 0.055, (k - row / 2) * 0.12));
    const stick = b.add('bangstick', 0.15, 0.039, 0.45, { fuse: 0.5 });
    const wick = b.add('wick', 0.5, 0, 0.45);
    b.link('fuse', wick, 'flame', stick, 'fuse');
    const m = new Machine(J, b);
    const ev = run(m, 360);
    const strike = of(ev, 'PinsAllDown');
    expect(strike).toHaveLength(1);
    expect(strike[0]!.mag).toBe(10);
    expect(strike[0]!.part).toBe(pins[0]);
    m.destroy();
  }, T);

  it('PANE and VASE break into their pre-built pieces (fracOf), dormant until then', async () => {
    const J = await jolt();
    for (const [key, n] of [['pane', 24], ['vase', 16]] as const) {
      expect(fracOf(key)?.chunks).toHaveLength(n); // E3a's generated chunks (fun.md)
      const m = new Machine(J, DEMOS[key]!);
      const chunks = m.bodyInfo().filter((x) => x.type === key && x.role === 'chunk');
      expect(chunks).toHaveLength(n);
      const flags = new Uint8Array(m.parts.length);
      expect(m.partFlags(flags)[0]! & 32).toBe(0);
      const ev = run(m, DEMOS[key]!.ticks);
      expect(of(ev, 'Break')).toHaveLength(1);
      const i = m.parts.findIndex((p) => p.def.type === key);
      expect(m.partFlags(flags)[i]! & 32).toBe(32); // broken: the renderer draws its chunks
      m.destroy();
    }
  }, T);

  it('LANCE through a BURNING GLASS: the light beams report a cutting segment (kind 2); the lance flags armed', async () => {
    const J = await jolt();
    const m = new Machine(J, DEMOS.lance!);
    run(m, 10);
    const beams = m.lightBeams();
    expect(beams.length % 8).toBe(0);
    const kinds = new Set<number>();
    for (let k = 0; k < beams.length; k += 8) kinds.add(beams[k + 7]!);
    expect([...kinds].sort()).toEqual([1, 2]);
    const i = m.parts.findIndex((p) => p.def.type === 'lance');
    const f = m.partFlags(new Uint8Array(m.parts.length))[i]!;
    expect(f & 1).toBe(1); // beam on
    expect(f & 16).toBe(16); // cutting
    m.destroy();
  }, T);

  it('TONEBARS and DING screens show their scale degree; a Wind ZONE its strength', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('tonebars', 0, 0, 0, { degree: 6 });
    b.add('ding', 0.3, 0.035, 0, { degree: 2 });
    b.add('zone', 1, 0, 0, { mode: 2 });
    const m = new Machine(J, b);
    m.step();
    expect([...m.partMeters(new Uint8Array(3))]).toEqual([7, 3, 2]); // the Wind zone at 1 m/s: 1 + round(20/15)
    m.destroy();
  }, T);

  it('a SNAPTRAP armed with a marble stays armed until its pedal is touched', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('snaptrap', 0, 0, 0);
    const glint = b.add('glint', -0.08, 0.036, 0);
    const m = new Machine(J, b);
    const tr = trace(m, 240, { track: [glint] });
    expect(of(tr.events, 'Snap')).toHaveLength(0);
    expect(Math.max(...tr.path.get(glint)!.map((p) => p[1]))).toBeLessThan(0.05);
    m.destroy();
  }, T);
});
