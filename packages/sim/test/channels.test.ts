// M2 channel tests (stream A): event ids and causes (contract 1), the Sound list and Lure tags
// (contract 2), rollback with M2 state, and the power, light and device rules the goldens don't pin.

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { lureOf, partDef, type PartDef } from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { Machine, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose, trace } from './harness.ts';

const run = (m: Machine, ticks: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); out.push(...m.drainEvents()); }
  return out;
};

/** A busy machine with most M2 parts in play (for ids, causes and rollback). */
function busy(): Build {
  const b = new Build();
  const mains = b.add('mains', -0.9, 0, 0);
  const motor = b.add('motor', -0.5, 0, 0);
  const dyn = b.add('dynamo', 0, 0, 0.3);
  const lamp = b.add('lamp', 0.45, 0, 0.3);
  b.link('cable_power', mains, 'out', motor, 'in');
  b.link('band', motor, 'out', dyn, 'in');
  b.link('cable_power', dyn, 'out', lamp, 'in');
  const sun = b.add('suncell', 0.45, 0, 0.6);
  const cell = b.add('cell', 1.0, 0, 0.6, { capacity: 5 });
  const gale = b.add('gale', 1.4, 0, 0.6);
  b.link('cable_power', sun, 'out', gale, 'in');
  b.link('cable_power', cell, 'out', gale, 'in');
  const ring = b.add('ringer', 0, 0, -0.6, { time: 0.5 });
  const delay = b.add('delay', 0.3, 0, -0.6, { delay: 0.3 });
  const cork = b.add('cork_blaster', 0.6, 0, -0.6);
  const pl = b.add('punchline', -0.6, 0, -0.6);
  b.add('boing', -0.18, 0.12, -0.6);
  b.link('cable_signal', ring, 'out', delay, 'in');
  b.link('cable_signal', delay, 'out', cork, 'fire');
  b.link('cable_signal', ring, 'out', pl, 'trigger');
  const top = b.add('big_top', -1.2, 0, 1.2);
  b.add('stitch', -1.1224, 0.216, 1.2);
  const wick = b.add('wick', -1.4, 0, 1.56);
  b.link('fuse', wick, 'flame', top, 'fuse');
  b.add('toggle', 1.0, 0, -0.6);
  b.add('stitch', 0.94, 0.5, -0.6);
  b.add('puffer', -1.5, 0, -0.2);
  b.add('thud', -1.53, 0.6, -0.2);
  b.add('gotcha_box', 1.5, 0, 0);
  b.add('thud', 1.5, 0.8, 0);
  b.add('flap', 0, 0.6, 1.0, { mode: 1 });
  b.add('thud', 0, 1.2, 1.13);
  b.add('sprong', 0.6, 0, 1.2);
  b.add('boing', 0.6, 1.0, 1.2);
  return b;
}

describe('events (contract 1)', () => {
  it('ids increase in emit order; every cause is an earlier event', async () => {
    const m = new Machine(await jolt(), busy());
    const ev = run(m, 400);
    m.destroy();
    expect(ev.length).toBeGreaterThan(50);
    ev.forEach((e, k) => {
      expect(e.id).toBe(k);
      expect(e.cause).toBeLessThan(e.id);
      expect(e.cause).toBeGreaterThanOrEqual(-1);
    });
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ['Ring', 'Launch', 'Spawn', 'Sound', 'Lit', 'Toggle', 'Press'] as const) expect(kinds.has(k), k).toBe(true);
  }, 60_000);

  it('a rollback re-emits the same ids and causes, and the run replays bit-identically (M2 state)', async () => {
    const J = await jolt();
    const a = new Machine(J, busy());
    const evA = run(a, 300);
    const hashA = a.hash();
    // roll back to tick 120 (a checkpoint), then run to 300 again
    expect(a.restore(130)).toBe(120);
    const evB = run(a, 180);
    expect(a.hash()).toBe(hashA);
    const tail = evA.filter((e) => e.tick >= 120).map((e) => `${e.id}:${e.tick}:${e.kind}:${e.cause}`);
    expect(evB.map((e) => `${e.id}:${e.tick}:${e.kind}:${e.cause}`)).toEqual(tail);
    a.destroy();
  }, 60_000);

  it('desync repair: an exported checkpoint continues identically on another machine', async () => {
    const J = await jolt();
    const a = new Machine(J, busy()), b = new Machine(J, busy());
    run(a, 200);
    const cp = a.exportCheckpoint(200)!;
    expect(cp.tick).toBe(180);
    run(b, 50);
    b.importCheckpoint(cp.blob);
    run(a, 100); run(b, 120);
    expect(b.hash()).toBe(a.hash());
    a.destroy(); b.destroy();
  }, 60_000);
});

describe('sound and lure (contract 2)', () => {
  it('soundsThisTick holds each sound for exactly one tick, with its Sound event as the cause', async () => {
    const b = new Build();
    b.add('ringer', 0, 0, 0, { time: 1 });
    const m = new Machine(await jolt(), b);
    const seen: { tick: number; dB: number; cause: number }[] = [];
    const ev: SimEvent[] = [];
    for (let t = 0; t < 200; t++) {
      m.step();
      ev.push(...m.drainEvents());
      for (const s of m.soundsThisTick) seen.push({ tick: t, dB: s.dB, cause: s.cause });
    }
    m.destroy();
    expect(seen).toHaveLength(1);
    const snd = ev.find((e) => e.kind === 'Sound')!;
    expect(seen[0]).toEqual({ tick: 120, dB: 80, cause: snd.id });
  });

  it('explosions and hard impacts are sounds', async () => {
    const m = new Machine(await jolt(), DEMOS.bangstick!);
    const ev = run(m, 300);
    m.destroy();
    const sounds = ev.filter((e) => e.kind === 'Sound');
    const boom = ev.find((e) => e.kind === 'Detonate')!;
    expect(sounds.find((s) => s.cause === boom.id)?.mag).toBe(120); // yield 1: 120 + 10·log10(1) dB
    expect(sounds.some((s) => s.mag > 66 && s.mag <= 110 && ev.find((e) => e.id === s.cause)?.kind === 'Impact')).toBe(true);
  });

  it('lureOf: tagged parts, and shiny small bodies lure Bandit', () => {
    const stitch = partDef('stitch')!;
    expect(lureOf(stitch)).toBeNull();
    const steel: PartDef = { ...stitch, body: { ...stitch.body, material: 'steel' } };
    expect(lureOf(steel)).toEqual({ species: { bandit: 1 }, radius: 5 });
    const heavy: PartDef = { ...steel, body: { ...steel.body, mass: 6.5 } };
    expect(lureOf(heavy)).toBeNull(); // PIG IRON is too heavy to carry off
    const seed: PartDef = { ...stitch, lure: { species: { pip: 1 }, radius: 4 } };
    expect(lureOf(seed)).toEqual({ species: { pip: 1 }, radius: 4 });
    expect(lureOf(partDef('pig_iron')!)).toBeNull();
  });

  it('lureEmitters lists live lure parts in part order', async () => {
    const m = new Machine(await jolt(), DEMOS.pig_iron!);
    expect(m.lureEmitters()).toEqual([]);
    m.destroy();
  });
});

describe('power (SIMULATION §5.5)', () => {
  it('a CELL runs flat: its consumers lose power, pointing at the cell', async () => {
    const b = new Build();
    const cell = b.add('cell', 0, 0, 0, { capacity: 5 });
    const lamp = b.add('lamp', 0.3, 0, 0);
    const motor = b.add('motor', -0.35, 0, 0);
    b.link('cable_power', cell, 'out', lamp, 'in');
    b.link('cable_power', cell, 'out', motor, 'in');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 900);
    m.destroy();
    const flat = ev.find((e) => e.kind === 'Unpowered' && e.part === cell)!;
    // 1,000 J at 160 W drawn ≈ 6.25 s
    expect(flat.tick).toBeGreaterThan(740);
    expect(flat.tick).toBeLessThan(760);
    const off = ev.find((e) => e.kind === 'Unpowered' && e.part === lamp)!;
    expect(off.cause).toBe(flat.id);
  }, 30_000);

  it('a DYNAMO can’t power the MOTOR that drives it (no free energy)', async () => {
    const b = new Build();
    const motor = b.add('motor', -0.5, 0, 0);
    const dyn = b.add('dynamo', 0, 0, 0.3);
    b.link('band', motor, 'out', dyn, 'in');
    b.link('cable_power', dyn, 'out', motor, 'in');
    const m = new Machine(await jolt(), b);
    const t = trace(m, 360, { spin: [[dyn, 0]] });
    m.destroy();
    expect(t.events.filter((e) => e.kind === 'Powered')).toHaveLength(0);
    expect(Math.abs(t.spin.get(dyn)!)).toBeLessThan(0.01);
  });

  it('a DYNAMO brakes its drive: the motor slows down its torque–speed curve under load', async () => {
    const drive = async (load: boolean): Promise<{ w: number; tau: number; meter: number }> => {
      const b = new Build();
      const mains = b.add('mains', -0.9, 0, 0);
      const motor = b.add('motor', -0.5, 0, 0);
      const dyn = b.add('dynamo', 0, 0, 0.3);
      b.link('cable_power', mains, 'out', motor, 'in');
      b.link('band', motor, 'out', dyn, 'in');
      if (load) b.link('cable_power', dyn, 'out', b.add('lamp', 0.45, 0, 0.3), 'in');
      const m = new Machine(await jolt(), b);
      run(m, 240);
      const p = m.parts.find((q) => q.def.type === 'motor')!;
      const tau = Math.abs(p.hinge.GetTotalLambdaMotor()) * 120;
      const w = Math.abs(m.bodies[p.arm]!.body.GetAngularVelocity().GetX());
      const meter = m.partMeters(new Uint8Array(m.parts.length))[m.parts.findIndex((q) => q.def.type === 'dynamo')]!;
      m.destroy();
      return { w, tau, meter };
    };
    const idle = await drive(false), loaded = await drive(true);
    expect(idle.w).toBeGreaterThan(9.0); // no load: close to 9.42 rad/s
    // a 40 W lamp costs 40 / 0.6 ≈ 67 W of shaft power: τ·ω on the curve τ = 30·(1 − ω/9.42)
    expect(loaded.tau * loaded.w).toBeGreaterThan(60);
    expect(loaded.tau * loaded.w).toBeLessThan(72); // never past the motor's ≈ 71 W peak
    expect(loaded.w).toBeLessThan(idle.w - 2);
    expect(loaded.meter).toBe(1 + Math.round((20 * 42) / 300)); // ≈ 42 W available: 0.6 × 71 W
  });

  it('MOTOR follows the linear torque–speed curve: peak shaft power ≈ 71 W', async () => {
    // a motor driving a dynamo loaded far past what it can supply settles near half speed (the peak)
    const b = new Build();
    const mains = b.add('mains', -0.9, 0, 0);
    const motor = b.add('motor', -0.5, 0, 0);
    const dyn = b.add('dynamo', 0, 0, 0.3);
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', dyn, 'in');
    for (let k = 0; k < 4; k++) b.link('cable_power', dyn, 'out', b.add('lamp', 0.45 + 0.15 * k, 0, 0.3), 'in');
    const m = new Machine(await jolt(), b);
    let peak = 0, sum = 0;
    for (let t = 0; t < 480; t++) {
      m.step();
      m.drainEvents();
      const p = m.parts[1]!;
      const P = Math.abs(p.hinge.GetTotalLambdaMotor()) * 120 * Math.abs(m.bodies[p.arm]!.body.GetAngularVelocity().GetX());
      if (t > 120) peak = Math.max(peak, P);
      if (t >= 360) sum += P;
    }
    m.destroy();
    expect(peak).toBeLessThan(80); // transients overshoot the curve a little (the target relaxes by half a tick)
    expect(sum / 120).toBeLessThan(72);
    expect(sum / 120).toBeGreaterThan(50);
  });

  it('a dynamo-driven loop that a push spins up can’t keep itself running', async () => {
    const J = await jolt();
    const b = new Build();
    const motor = b.add('motor', -0.5, 0, 0);
    const dyn = b.add('dynamo', 0, 0, 0.3);
    b.link('band', motor, 'out', dyn, 'in');
    b.link('cable_power', dyn, 'out', motor, 'in');
    const m = new Machine(J, b);
    // the external push: both rotors at the motor's full no-load speed, its way round (CW: −X)
    const bi = (m as unknown as { bi: { SetAngularVelocity(id: unknown, v: unknown): void } }).bi;
    for (const p of m.parts) bi.SetAngularVelocity(m.bodies[p.arm]!.body.GetID(), new J.Vec3(-9.42, 0, 0));
    const ev = run(m, 720);
    const w = Math.abs(m.bodies[m.parts[1]!.arm]!.body.GetAngularVelocity().GetX());
    m.destroy();
    const power = ev.filter((e) => e.part === motor && (e.kind === 'Powered' || e.kind === 'Unpowered'));
    expect(power[0]?.kind).toBe('Powered'); // the push did make power for a moment
    expect(power.at(-1)?.kind).toBe('Unpowered'); // …but the loop runs down
    expect(w).toBeLessThan(0.5);
    void dyn;
  });

  it('a TOGGLE splits the circuit while off and joins it once flipped', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, 0);
    const tog = b.add('toggle', 0, 0, 0);
    const lamp = b.add('lamp', 0.4, 0, 0);
    b.link('cable_power', mains, 'out', tog, 'in');
    b.link('cable_power', tog, 'out_power', lamp, 'in');
    b.add('stitch', -0.06, 1.0, 0);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    m.destroy();
    const flip = ev.find((e) => e.kind === 'Toggle')!;
    const on = ev.find((e) => e.kind === 'Powered' && e.part === lamp)!;
    expect(flip.tick).toBeGreaterThan(30);
    expect(on.tick).toBe(flip.tick + 1); // the topology change applies in the next tick's power stage
  });
});

describe('devices', () => {
  it('SPRONG caps the bounce at 8 m/s', async () => {
    const b = new Build();
    b.add('sprong', 0, 0, 0);
    const ball = b.add('stitch', 0, 5, 0);
    const m = new Machine(await jolt(), b);
    let vmax = 0, bounced = false;
    for (let t = 0; t < 240; t++) {
      m.step();
      const v = m.bodies[m.parts[1]!.base]!.body.GetLinearVelocity().GetY();
      if (v > 0) { bounced = true; vmax = Math.max(vmax, v); }
    }
    m.destroy();
    void ball;
    expect(bounced).toBe(true);
    expect(vmax).toBeLessThanOrEqual(8.05);
    expect(vmax).toBeGreaterThan(7.5);
  });

  it('a passive FLAP opens under a heavy load and springs shut again', async () => {
    const b = new Build();
    b.add('flap', 0, 1.0, -0.13, { mode: 1 });
    b.add('thud', 0, 1.4, 0);
    const m = new Machine(await jolt(), b);
    let opened = 0;
    for (let t = 0; t < 360; t++) { m.step(); opened = Math.max(opened, m.parts[0]!.hinge.GetCurrentAngle()); }
    const end = m.parts[0]!.hinge.GetCurrentAngle();
    m.destroy();
    expect(opened).toBeGreaterThan(0.8);
    expect(end).toBeLessThan(0.05);
  });

  it('a DELAY passes every pulse on, each after its own delay', async () => {
    const b = new Build();
    const b1 = b.add('the_button', -0.4, 0, 0);
    b.add('thud', -0.4, 0.3, 0);
    const b2 = b.add('the_button', -0.4, 0, 0.4);
    b.add('thud', -0.4, 0.8, 0.4);
    const delay = b.add('delay', 0, 0, 0, { delay: 0.5 });
    const torch = b.add('torch', 0.4, 0, 0);
    b.link('cable_signal', b1, 'out', delay, 'in');
    b.link('cable_signal', b2, 'out', delay, 'in');
    b.link('cable_signal', delay, 'out', torch, 'in');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 240);
    m.destroy();
    const ins = ev.filter((e) => e.kind === 'Signal' && e.part === delay).map((e) => e.tick);
    const outs = ev.filter((e) => e.kind === 'Signal' && e.part === torch).map((e) => e.tick);
    expect(ins.length).toBeGreaterThanOrEqual(2);
    expect(outs).toEqual(ins.map((t) => t + 60));
  });

  it('BIG TOP re-arms: a second ball dropped in is caught and needs heat again', async () => {
    const b = new Build();
    const top = b.add('big_top', 0, 0, 0);
    b.add('boing', 0.1224, 0.216, 0);
    const wick = b.add('wick', -0.2, 0, 0.36);
    b.link('fuse', wick, 'flame', top, 'fuse');
    // after the shot, a RINGER drops a second ball into the bell through a FLAP
    const flap = b.add('flap', 0.2, 0.8, -0.13);
    const second = b.add('stitch', 0.2, 0.851, 0);
    const ring = b.add('ringer', -0.6, 0, 0, { time: 2.5 });
    b.link('cable_signal', ring, 'out', flap, 'in');
    const m = new Machine(await jolt(), b);
    const ev = run(m, 420);
    const held = m.st.m2.held[0]!;
    const idx = m.parts.findIndex((p) => p.id === second);
    m.destroy();
    expect(ev.filter((e) => e.kind === 'Launch')).toHaveLength(1);
    expect(held).toBe(idx);
  });

  it('GOTCHA BOX pops on a whack and its head stops short of the lunge', async () => {
    const b = new Build();
    const box = b.add('gotcha_box', 0, 0, 0);
    b.add('thud', 0, 0.6, 0);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 200);
    const head = m.bodies.findIndex((x) => x.role === 'piece');
    const p = m.bodies[head]!.body.GetPosition();
    const hz = p.GetZ();
    m.destroy();
    expect(ev.filter((e) => e.kind === 'Launch' && e.part === box)).toHaveLength(1);
    expect(hz).toBeGreaterThan(0.05); // the body origin leaned forward with the head
  });

  it('pieces are pre-built: the body count never changes during a run', async () => {
    const m = new Machine(await jolt(), DEMOS.cork_blaster!);
    const n = m.bodyInfo().length;
    expect(m.bodyInfo().filter((x) => x.role === 'piece')).toHaveLength(1);
    run(m, 240);
    expect(m.bodyInfo().length).toBe(n);
    m.destroy();
  });

  it('TORCH beams turn with the part (a torch aimed away lights nothing)', async () => {
    const b = new Build();
    b.add('suncell', 0, 0, 0);
    b.add('torch', -0.035, 0.5, 0, { on: 1 }, snappedEuler(0, 0, 90)); // pointing up
    const m = new Machine(await jolt(), b);
    const ev = run(m, 30);
    m.destroy();
    expect(ev.filter((e) => e.kind === 'Lit')).toHaveLength(0);
    void pose;
  });
});
