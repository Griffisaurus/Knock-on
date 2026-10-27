// J4 (M4): the Backlot dressing colliders on the Megastructure lot (M3_STATUS carry-over; env_backlot.ts).

import { describe, expect, it } from 'vitest';
import { defaultTerrain, makeId, metresToPos, terrainHeightAt, type PartRecord } from '@knockon/format';
import { BACKLOT } from '@knockon/parts-data';
import { Machine } from '../src/index.ts';
import { jolt, pose } from './harness.ts';

const ball = (n: number, x: number, y: number, z: number): PartRecord => ({ id: makeId(1, n), type: 'thud', pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: { tag: 0 }, flags: 0 });

describe('Backlot dressing on the Megastructure lot', () => {
  it('is the Arena set lifted onto the Mega ground: same boxes, materials and footprints, only higher', () => {
    const a = BACKLOT.arena.boxes, m = BACKLOT.megastructure.boxes;
    expect(m.length).toBe(a.length);
    expect(m.length).toBeGreaterThan(100);
    a.forEach((b, i) => {
      const c = m[i]!;
      expect([c.name, c.phys, c.center[0], c.center[2], ...c.half]).toEqual([b.name, b.phys, b.center[0], b.center[2], ...b.half]);
      expect(c.center[1] - b.center[1]).toBeGreaterThan(2); // Mega's default ground is 16 m, the Arena's 4 m
    });
    // the water tower stands on its pad: its lowest box bottom sits on the Mega pad exactly as on the Arena pad
    const mega = defaultTerrain('megastructure')!, arena = defaultTerrain('arena')!;
    const leg = (s: typeof a): number => s.find((b) => b.name === 'water_tower_0')!.center[1] - 9;
    expect(leg(m) - terrainHeightAt(mega, 70, -82)).toBeCloseTo(leg(a) - terrainHeightAt(arena, 70, -82), 3);
  });

  it('collides in the Machine: a ball dropped on the water tower stops on its tank, one on the lot rests on the ground', async () => {
    const J = await jolt();
    const t = defaultTerrain('megastructure')!;
    const tank = BACKLOT.megastructure.boxes.find((b) => b.name === 'water_tower_4')!;
    const top = tank.center[1] + tank.half[1];
    const parts = [ball(1, 70, top + 6, -82), ball(2, 0, terrainHeightAt(t, 0, 0) + 2, 0)];
    const run = (): { tankBall: number; lotBall: number; hash: string } => {
      const m = new Machine(J, { parts }, { preset: 'megastructure', environment: 'backlot', terrain: t, checkpointEvery: 0 });
      for (let i = 0; i < 480; i++) m.step();
      const r = { tankBall: pose(m, makeId(1, 1)).p[1], lotBall: pose(m, makeId(1, 2)).p[1], hash: m.hash() };
      m.destroy();
      return r;
    };
    const r = run();
    expect(r.tankBall).toBeGreaterThan(top - 0.05); // ≈ 45.9 m on Mega (33.6 m on the Arena lot)
    expect(r.tankBall).toBeLessThan(top + 0.5);
    expect(Math.abs(r.lotBall - (terrainHeightAt(t, 0, 0) + 0.11))).toBeLessThan(0.08);
    expect(run()).toEqual(r);
  }, 120_000);
});
