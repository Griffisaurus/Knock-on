// M4 Matter parts with Matter on (stream A4, M4_PLAN contract 4): MX's CPU backend in Node, small grain counts (≤ 20k).
// Stored contents become particles only at the spout (each emitted grain left the store), intakes add what they absorb
// back, and everything physical comes out of the particle contacts: a WATERWHEEL turns, a SPONGE gains mass, a QUACK
// floats. Each scene also runs twice and must give the same hash sequence.

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

const T = 300_000;

async function matterMachine(b: Build): Promise<Machine> {
  return new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 20000 } });
}

/** Runs `ticks`, calling `each` after every tick; returns the hashes every 30 ticks. */
function go(m: Machine, ticks: number, each?: (t: number) => void): string[] {
  const hs: string[] = [];
  for (let t = 0; t < ticks; t++) {
    m.step();
    m.drainEvents();
    each?.(t);
    if (t % 30 === 29) hs.push(m.hash());
  }
  return hs;
}

const fillOf = (m: Machine, i: number): number => m.partFill(new Float32Array(m.parts.length))[i]!;

describe('M4 Matter parts (MX CPU backend)', () => {
  it('GRIT HOPPER: every grain it pours leaves the store and becomes a live sand grain', async () => {
    const b = new Build();
    b.add('grit_hopper', 0, 0, 0, { capacity: 50000, rate: 10000, start: 5, open: 1 }); // 2,500 grains in 0.25 s
    const m = await matterMachine(b);
    const hs = go(m, 120);
    expect(fillOf(m, 0)).toBe(0);
    expect(m.matter.count(0)).toBe(2500);
    m.destroy();
    const m2 = await matterMachine(b);
    expect(go(m2, 120)).toEqual(hs);
    m2.destroy();
  }, T);

  it('TANK → TANK: water poured from one tank into the funnel of the other refills it', async () => {
    const b = new Build();
    b.add('ledge', 0, 0.6, 0);
    const top = b.add('tank', 0, 0.65, 0, { flow: 1, start: 5, open: 1 }); // 750 mL
    const low = b.add('tank', 0, 0, 0.44, { start: 0 });
    void top; void low;
    const m = await matterMachine(b);
    go(m, 300);
    expect(fillOf(m, 1)).toBe(0);
    expect(fillOf(m, 2) * 15000).toBeGreaterThan(100); // measured 189 mL of the 750 (the rest splashes past the 12 cm funnel)
    m.destroy();
  }, T);

  it('SPONGE: water poured on it soaks in: it gets heavier, and the water leaves play', async () => {
    const b = new Build();
    b.add('ledge', 0, 0.6, 0);
    b.add('tank', 0, 0.65, 0, { flow: 1, start: 5, open: 1 }); // 750 mL
    b.add('sponge', 0, 0.05, 0.5);
    const m = await matterMachine(b);
    go(m, 300);
    const spongeBody = m.bodyInfo().findIndex((x) => x.type === 'sponge');
    const kg = 1 / m.bodies[spongeBody]!.body.GetMotionProperties().GetInverseMass();
    expect(fillOf(m, 2) * 2000).toBeGreaterThan(80); // measured 119 mL of the 750 poured on it
    expect(kg).toBeCloseTo(0.05 + fillOf(m, 2) * 2, 2);
    m.destroy();
  }, T);

  it('WATERWHEEL: water poured over the top buckets turns it clockwise (its +X side down)', async () => {
    const b = new Build();
    b.add('ledge', 0.06, 0.33, -0.3);
    b.add('tank', 0.06, 0.38, -0.3, { flow: 1, start: 10, open: 1 }); // 1.5 L from just above the top bucket
    b.add('waterwheel', 0, 0.2, 0);
    const m = await matterMachine(b);
    const info = m.bodyInfo();
    const arm = info.findIndex((x) => x.type === 'waterwheel' && x.role === 'arm');
    let turned = 0, last = 0;
    go(m, 300, () => {
      const q = m.transforms(new Float32Array(info.length * 7));
      const a = 2 * Math.atan2(q[arm * 7 + 5]!, q[arm * 7 + 6]!);
      let d = a - last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turned += d;
      last = a;
    });
    expect(turned).toBeLessThan(-1); // measured −2.17 rad over 2.5 s
    m.destroy();
  }, T);

  it('QUACK: dropped into a basin of water it floats', async () => {
    const b = new Build();
    // a 0.3 × 0.3 m basin of standing LEDGEs, filled from a TANK on a shelf beside it
    for (const [x, z, yaw] of [[0, 0.175, 0], [0, -0.175, 0], [0.175, 0, 90], [-0.175, 0, 90]] as const) b.add('ledge', x, 0.2, z, {}, snappedEuler(yaw, 90, 0));
    b.add('ledge', 0, 0.6, -0.45);
    b.add('tank', 0, 0.65, -0.45, { flow: 1, start: 20, open: 1 }); // 3 L
    const duck = b.add('quack', 0.025, 0.5, 0.025);
    const m = await matterMachine(b);
    let high = 0;
    go(m, 130, (t) => { if (t >= 100) high = Math.max(high, pose(m, duck).p[1]); });
    // it rides on the water (≈ 1.5 cm deep after 1 s) above where it would rest on the floor (y 0.028); see
    // M4_NOTES_A4 for the light-body fling reported to MI / MX, which is why this stops at 1.1 s
    expect(high).toBeGreaterThan(0.028 + 0.005);
    m.destroy();
  }, T);

  it('MARBLE HOPPER, SPRINKLE CAN, SPONGE: what leaves each store arrives as live particles of its kind', async () => {
    const b = new Build();
    b.add('marble_hopper', 0, 0, 0, { capacity: 2000, rate: 1000, start: 25, open: 1 }); // 500 marbles in 0.5 s
    b.add('sprinkle_can', 0.8, 0, 0, { start: 25 }); // 500 mL
    b.add('stitch', 0.7, 0.6, 0); // the knock that tips it
    b.add('sponge', -0.8, 0.05, 0, { start: 25 }); // 500 mL
    b.add('thud', -0.8, 0.5, 0); // the squeeze
    const m = await matterMachine(b);
    go(m, 360);
    const f = m.partFill(new Float32Array(m.parts.length));
    expect(m.matter.count(2)).toBe(Math.round(500 - f[0]! * 2000));
    expect(f[0]).toBe(0);
    const water = 500 - Math.round(f[1]! * 2000) + 500 - Math.round(f[3]! * 2000);
    expect(water).toBeGreaterThan(500); // both poured
    expect(m.matter.count(1)).toBeLessThanOrEqual(water); // live water ≤ released (intakes may take some back)
    expect(m.matter.count(1)).toBeGreaterThan(water - 50);
    m.destroy();
  }, T);

  it('rollback with Matter on: a restore mid-pour rejoins the straight run (stored quantities and particles)', async () => {
    const b = new Build();
    b.add('ledge', 0, 0.6, 0);
    b.add('tank', 0, 0.65, 0, { flow: 1, start: 5, open: 1 });
    b.add('tank', 0, 0, 0.44, { start: 0 });
    b.add('grit_hopper', 0.6, 0, 0, { capacity: 50000, rate: 1000, start: 5, open: 1 });
    const a = await matterMachine(b);
    const hs: string[] = [];
    for (let t = 0; t < 400; t++) { a.step(); a.drainEvents(); if (t >= 240) hs.push(a.hash()); }
    a.destroy();
    const m = await matterMachine(b);
    go(m, 300);
    expect(m.restore(240)).toBe(240);
    const hs2: string[] = [];
    for (let t = 240; t < 400; t++) { m.step(); m.drainEvents(); hs2.push(m.hash()); }
    expect(hs2).toEqual(hs);
    m.destroy();
  }, T);
});
