// M2 exit (PRODUCTION §2): every Appendix A goal type can be built (GAME_SPEC Appendix A goal taxonomy).
// Each machine is a small chain of real parts with a goal predicate on its events and end state, the way a
// challenge level would check it. Negative variants show the goal isn't met by accident.

import { describe, expect, it } from 'vitest';
import { makeId, metresToPos } from '@knockon/format';
import { Machine, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

type Opts = ConstructorParameters<typeof Machine>[2];

function path(b: Build, kind: 'gutter' | 'tube', pts: readonly (readonly [number, number, number])[]): void {
  b.links.push({ id: makeId(1, 900 + b.links.length), kind, from: null, to: null, via: [], points: pts.map((p) => [metresToPos(p[0]), metresToPos(p[1]), metresToPos(p[2])] as const), length: 0 });
}

async function run(b: Build, ticks: number, opts: Opts = {}): Promise<{ m: Machine; ev: SimEvent[] }> {
  const m = new Machine(await jolt(), b, { preset: 'room', ...opts });
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); }
  return { m, ev };
}

describe('Appendix A goal types can be built (M2 exit)', () => {
  it('deliver to a place: a STITCH runs down a GUTTER and lands in the SCOOP', async () => {
    const b = new Build();
    const ball = b.add('stitch', -0.6, 0.6, 0);
    path(b, 'gutter', [[-0.7, 0.5, 0], [0.4, 0.25, 0], [0.8, 0.2, 0.3]]);
    const scoop = b.add('scoop', 0.86, 0, 0.38);
    const { m } = await run(b, 600);
    const p = pose(m, ball).p, s = pose(m, scoop).p;
    expect(Math.hypot(p[0] - s[0], p[2] - s[2])).toBeLessThan(0.08); // inside the bucket's mouth
    expect(p[1]).toBeLessThan(0.2); // below its rim
    m.destroy();
  }, 60_000);

  it('pop: THE BUTTON fires the CORK BLASTER and the cork pops the HELIO', async () => {
    const b = new Build();
    b.add('ledge', 0, 0.25, 0);
    const cb = b.add('cork_blaster', 0, 0.3, 0);
    const button = b.add('the_button', -0.5, 0, 0);
    b.add('thud', -0.5, 0.4, 0);
    const a = b.add('anchor', 0.8, 0, 0);
    const h = b.add('helio', 0.8, 0.36, 0);
    b.link('cable_signal', button, 'out', cb, 'fire');
    b.link('line', h, 'knot', a, 'hook');
    const { m, ev } = await run(b, 240);
    const pop = ev.find((e) => e.kind === 'Pop' && e.part === h);
    expect(pop).toBeDefined();
    expect(pop!.cause).toBeGreaterThanOrEqual(0); // traceable back through the cause chain
    m.destroy();
  }, 60_000);

  it('ignite / launch: a WICK lights the FUSE and the SKYROCKET launches above 10 m', async () => {
    const b = new Build();
    const wick = b.add('wick', 0.12, 0, 0.03);
    const rocket = b.add('skyrocket', 0, 0.12, 0, { fuse: 0.2 });
    b.link('fuse', wick, 'flame', rocket, 'fuse');
    const { m, ev } = await run(b, 360, { preset: 'warehouse' });
    expect(ev.some((e) => e.kind === 'Ignite')).toBe(true);
    expect(ev.some((e) => e.kind === 'Launch' && e.part === rocket)).toBe(true);
    expect(pose(m, rocket).p[1]).toBeGreaterThan(10);
    m.destroy();
  }, 60_000);

  it('switch on: a falling STITCH flips the TOGGLE and the MAINS power lights the LAMP', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, 0);
    const tog = b.add('toggle', 0, 0, 0);
    const lamp = b.add('lamp', 0.4, 0, 0);
    b.add('stitch', -0.06, 0.5, 0);
    b.link('cable_power', mains, 'out', tog, 'in');
    b.link('cable_power', tog, 'out_power', lamp, 'in');
    const { m, ev } = await run(b, 300);
    expect(ev.some((e) => e.kind === 'Toggle' && e.part === tog && e.mag === 1)).toBe(true);
    expect(ev.some((e) => e.kind === 'Lit' && e.part === lamp)).toBe(true);
    m.destroy();
    // without the ball the lamp stays dark
    b.parts.splice(b.parts.findIndex((p) => p.type === 'stitch'), 1);
    const off = await run(b, 300);
    expect(off.ev.some((e) => e.kind === 'Lit' && e.part === lamp)).toBe(false);
    off.m.destroy();
  }, 60_000);

  it('break: a RINGER and a DELAY set off a BANGSTICK that cracks a mortared BRIK wall apart', async () => {
    const b = new Build();
    for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) b.add('brik', 0.1 * (r % 2) + i * 0.2, 0.05 + r * 0.1, 0);
    const ringer = b.add('ringer', -1.2, 0, 0.6, { time: 1 });
    const delay = b.add('delay', -0.8, 0, 0.6, { delay: 0.5 });
    const stick = b.add('bangstick', 0.2, 0.039, 0.35);
    b.link('cable_signal', ringer, 'out', delay, 'in');
    b.link('cable_signal', delay, 'out', stick, 'detonator');
    const { m, ev } = await run(b, 360);
    const det = ev.find((e) => e.kind === 'Detonate')!;
    expect(det.tick).toBeGreaterThanOrEqual(179); // 1 s ring + 0.5 s delay
    expect(ev.filter((e) => e.kind === 'Break').length).toBeGreaterThan(5);
    m.destroy();
  }, 60_000);

  it('protect (negative goal): snipping its LINE lets the HELIO escape a timed blast; without the snip it pops', async () => {
    const build = (snip: boolean): { b: Build; h: number } => {
      const b = new Build();
      const sn = b.add('snipper', 0.3, 0, 0);
      const hook = b.add('anchor', 0.4, 0.036, 0);
      const h = b.add('helio', 0.4, 0.7, 0);
      const button = b.add('the_button', -0.3, 0, 0);
      if (snip) b.add('thud', -0.3, 0.4, 0);
      b.link('line', h, 'knot', hook, 'hook');
      b.link('cable_signal', button, 'out', sn, 'close');
      const ringer = b.add('ringer', -0.6, 0, 0.6, { time: 3 });
      const stick = b.add('bangstick', 0.4, 0.039, 0.5);
      b.link('cable_signal', ringer, 'out', stick, 'detonator');
      return { b, h };
    };
    const saved = build(true);
    const a = await run(saved.b, 600, { preset: 'warehouse' });
    expect(a.ev.some((e) => e.kind === 'Detonate')).toBe(true);
    expect(a.ev.some((e) => e.kind === 'Pop' && e.part === saved.h)).toBe(false); // protected
    a.m.destroy();
    const lost = build(false);
    const c = await run(lost.b, 600, { preset: 'warehouse' });
    expect(c.ev.some((e) => e.kind === 'Pop' && e.part === lost.h)).toBe(true); // the threat is real
    c.m.destroy();
  }, 60_000);

  it('creature: a dropped BOING wakes Pip in the HAMSTER DRIVE, whose sprint spins a DYNAMO that lights the LAMP', async () => {
    const build = (wake: boolean): { b: Build; lamp: number } => {
      const b = new Build();
      const drive = b.add('hamster_drive', 0, 0, 0);
      b.add('pip', 0, 0.042, -0.005);
      if (wake) b.add('boing', -0.08, 0.8, -0.05);
      const dyn = b.add('dynamo', 0.5, 0, 0);
      const lamp = b.add('lamp', 0.9, 0, 0.3);
      b.link('band', drive, 'out', dyn, 'in');
      b.link('cable_power', dyn, 'out', lamp, 'in');
      return { b, lamp };
    };
    const woken = build(true);
    const a = await run(woken.b, 1080);
    expect(a.ev.some((e) => e.kind === 'CritterState')).toBe(true);
    expect(a.ev.some((e) => e.kind === 'Lit' && e.part === woken.lamp)).toBe(true);
    a.m.destroy();
    const asleep = build(false); // Pip sleeps: an idle wheel never spins (SIMULATION §7.3)
    const c = await run(asleep.b, 1080);
    expect(c.ev.some((e) => e.kind === 'Lit' && e.part === asleep.lamp)).toBe(false);
    c.m.destroy();
  }, 120_000);

  it('creature: the SNIPPER drops the TRAP BOX over Mochi and traps her', async () => {
    const b = new Build();
    const box = b.add('trap_box', 0, 0.6, 0);
    const hook = b.add('anchor', 0, 1.4, 0);
    b.link('line', box, 'hook', hook, 'hook');
    b.add('ledge', -0.12, 1.2, 0);
    const snip = b.add('snipper', -0.08, 1.25, 0);
    const button = b.add('the_button', 0.9, 0, 0.6);
    b.add('thud', 0.9, 0.4, 0.6);
    b.link('cable_signal', button, 'out', snip, 'close');
    const mochi = b.add('mochi', 0, 0, 0);
    const { m, ev } = await run(b, 360);
    const trapped = ev.find((e) => e.kind === 'Trapped' && e.part === mochi);
    expect(trapped).toBeDefined();
    expect(trapped!.other).toBe(box);
    m.destroy();
  }, 60_000);

  it('low gravity: on the moon the BIG TOP lobs a THUD onto a raised STOMP PAD that fires a BANGSTICK; on Earth it rolls under', async () => {
    const build = (): Build => {
      const b = new Build();
      const top = b.add('big_top', 0, 0, 0);
      b.add('thud', 0.1224, 0.216, 0);
      const wick = b.add('wick', -0.2, 0, 0.36);
      b.link('fuse', wick, 'flame', top, 'fuse');
      b.add('ledge', 3.15, 0.3, 0);
      const pad = b.add('stomp_pad', 3.15, 0.35, 0);
      const stick = b.add('bangstick', 3.15, 0.039, 1.5);
      b.link('cable_signal', pad, 'out', stick, 'detonator');
      return b;
    };
    const moon = await run(build(), 2400, { preset: 'warehouse', gravityPercent: 17 });
    expect(moon.ev.some((e) => e.kind === 'Detonate')).toBe(true);
    moon.m.destroy();
    const earth = await run(build(), 2400, { preset: 'warehouse', gravityPercent: 100 });
    expect(earth.ev.some((e) => e.kind === 'Detonate')).toBe(false);
    earth.m.destroy();
  }, 120_000);
});
