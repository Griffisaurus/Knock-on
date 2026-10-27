// S3 (M3 scale): Backlot terrain as Jolt HeightFieldShapes, the Backlot dressing set, and the big-world paths.

import { describe, expect, it } from 'vitest';
import { cloneTerrain, defaultTerrain, makeId, metresToPos, terrainHeightAt, applyStroke, TerrainBrush, type PartRecord } from '@knockon/format';
import { Machine } from '../src/index.ts';
import { loadJolt } from '@knockon/jolt';
import { jolt, pose } from './harness.ts';

const ball = (n: number, x: number, y: number, z: number): PartRecord => ({ id: makeId(1, n), type: 'thud', pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: { tag: 0 }, flags: 0 });

describe('Backlot terrain', () => {
  it('a THUD dropped on the lot comes to rest on the heightfield (plateau, a swell, a pad), the same every run', async () => {
    const J = await jolt();
    const t = defaultTerrain('arena')!;
    const spots: [number, number][] = [[0, 0], [60, 50], [-96, 96]];
    const parts = spots.map(([x, z], i) => ball(i + 1, x, terrainHeightAt(t, x, z) + 2, z));
    const run = (): number[] => {
      const m = new Machine(J, { parts }, { preset: 'arena', environment: 'backlot', terrain: t, checkpointEvery: 0 });
      for (let i = 0; i < 480; i++) m.step();
      const ps = parts.flatMap((p) => [...pose(m, p.id).p]);
      const h = m.hash();
      m.destroy();
      return [...ps, Number.parseInt(h.slice(0, 8), 16)];
    };
    const a = run(), b = run();
    expect(a).toEqual(b);
    // resting on the ground under wherever it ended up (the swell ball rolls downhill a little)
    spots.forEach((_, i) => expect(Math.abs(a[i * 3 + 1]! - (terrainHeightAt(t, a[i * 3]!, a[i * 3 + 2]!) + 0.11))).toBeLessThan(0.08));
  });

  it('a sculpted terrain is what collides (raise a mound under the ball)', async () => {
    const J = await jolt();
    const t = cloneTerrain(defaultTerrain('arena')!);
    applyStroke(t, { brush: TerrainBrush.Raise, radius: 640 * 6, strength: 1000, points: Array.from({ length: 12 }, () => [0, 0, 0] as const) });
    const top = terrainHeightAt(t, 0, 0);
    expect(top).toBeGreaterThan(6);
    const m = new Machine(J, { parts: [ball(1, 0, top + 1, 0)] }, { preset: 'arena', environment: 'backlot', terrain: t, checkpointEvery: 0 });
    for (let i = 0; i < 360; i++) m.step();
    expect(pose(m, makeId(1, 1)).p[1]).toBeGreaterThan(top - 0.2);
    m.destroy();
  });

  it('the dressing collides: a ball dropped on the water tower stops on its tank', async () => {
    const J = await jolt();
    const t = defaultTerrain('arena')!;
    const m = new Machine(J, { parts: [ball(1, 70, 40, -82)] }, { preset: 'arena', environment: 'backlot', terrain: t, checkpointEvery: 0 });
    for (let i = 0; i < 480; i++) m.step();
    expect(pose(m, makeId(1, 1)).p[1]).toBeGreaterThan(30); // tank top ≈ 33.6 m
    m.destroy();
  });
});

describe('big worlds (S3)', () => {
  it('capacities scale with parts: a big field of bricks stays on the floor and a dropped ball stops on top', async () => {
    const J = await jolt();
    const parts: PartRecord[] = [];
    for (let i = 0; i < 2100; i++) parts.push({ id: makeId(1, i + 1), type: 'brik', pos: [metresToPos((i % 50) * 0.3), metresToPos(0.05), metresToPos(Math.floor(i / 50) * 0.3)], rot: { tag: 0 }, flags: 0 });
    parts.push(ball(5000, 0, 1.5, 0)); // above brick 0
    const m = new Machine(J, { parts }, { preset: 'warehouse', checkpointEvery: 0 });
    for (let i = 0; i < 120; i++) m.step();
    const y = pose(m, makeId(1, 5000)).p[1]!;
    expect(y).toBeLessThan(0.4); // it fell…
    expect(y).toBeGreaterThan(0.1); // …onto the brick, not through it
    for (const id of [1, 1050, 2100]) expect(pose(m, makeId(1, id)).p[1]).toBeGreaterThan(0.02); // nothing sank
    m.destroy();
  });

  it('in-heap checkpoints: a late poke rolls back to the straight run, and desync repair moves bytes out and in', async () => {
    // A3: three 2,100-BRIK machines at once with contact buffers sized for the stack (~30k: capacity.ts) don't fit the
    // stock 128 MB heap the other tests share; a run gets a sized heap (joltHeapMB), so this test does too
    const J = await loadJolt('single', { heapMB: 768 });
    const parts: PartRecord[] = [];
    for (let i = 0; i < 2100; i++) parts.push({ id: makeId(1, i + 1), type: 'brik', pos: [metresToPos((i % 30) * 0.2), metresToPos(0.05 + Math.floor(i / 900) * 0.1), metresToPos(Math.floor((i % 900) / 30) * 0.1)], rot: { tag: 0 }, flags: 0 });
    parts.push(ball(5000, -1, 0.11, 1)); // shoved into the stack
    const poke = { tick: 70, seq: 1, partId: makeId(1, 5000), kind: 'impulse' as const, data: [40, 6, -20] };
    const straight = new Machine(J, { parts }, { preset: 'warehouse' });
    straight.addPoke(poke);
    for (let i = 0; i < 300; i++) straight.step();
    const late = new Machine(J, { parts }, { preset: 'warehouse' });
    for (let i = 0; i < 260; i++) late.step();
    late.addPoke(poke);
    expect(late.restore(poke.tick)).toBeLessThanOrEqual(poke.tick);
    while (late.tick < 300) late.step();
    expect(late.hash()).toBe(straight.hash());
    // desync repair: the partner's checkpoint, as bytes, makes a third machine continue identically
    const cp = straight.exportCheckpoint(240)!;
    for (let i = 0; i < 60; i++) { straight.step(); late.step(); }
    const third = new Machine(J, { parts }, { preset: 'warehouse' });
    third.addPoke(poke);
    third.importCheckpoint(cp.blob);
    while (third.tick < straight.tick) third.step();
    expect(third.hash()).toBe(straight.hash());
    for (const m of [straight, late, third]) m.destroy();
  }, 60_000);
});
