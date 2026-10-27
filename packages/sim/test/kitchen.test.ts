// Mega Kitchen environment (contract 5 of docs/dev/M2_PLAN.md): its generated colliders are solid in the sim.
import { describe, expect, it } from 'vitest';
import { makeId, metresToPos, snappedEuler } from '@knockon/format';
import { loadJolt } from '@knockon/jolt';
import { KITCHEN } from '@knockon/parts-data';
import { Machine } from '../src/index.ts';

describe('Mega Kitchen', () => {
  it('a THUD dropped on the counter top comes to rest on it, in both presets', async () => {
    const J = await loadJolt('single');
    for (const preset of ['room', 'warehouse'] as const) {
      const top = KITCHEN.presets[preset].boxes.find((b) => b.name === 'counter_back_top')!;
      const surface = top.center[1] + top.half[1];
      const id = makeId(1, 1);
      const part = { id, type: 'thud', pos: [metresToPos(top.center[0]), metresToPos(surface + 0.5), metresToPos(top.center[2])] as [number, number, number], rot: snappedEuler(0, 0, 0), flags: 0 };
      const m = new Machine(J, { parts: [part] }, { preset, environment: 'kitchen' });
      for (let t = 0; t < 360; t++) m.step();
      const xf = m.transforms(new Float32Array(m.bodies.length * 7));
      const b = m.bodyInfo().findIndex((x) => x.part === id && x.role === 'base');
      expect(xf[b * 7 + 1]!).toBeCloseTo(surface + 0.11, 1); // THUD radius 0.11
      m.destroy();
      // and in the Studio the same drop falls through to the floor (no counter there)
      const s = new Machine(J, { parts: [part] }, { preset });
      for (let t = 0; t < 360; t++) s.step();
      const xs = s.transforms(new Float32Array(s.bodies.length * 7));
      expect(xs[b * 7 + 1]!).toBeLessThan(surface - 0.2);
      s.destroy();
    }
  }, 60_000);
});

import { TINKER } from '@knockon/parts-data';

describe('THE TINKER LAB', () => {
  it('a THUD dropped on the Room cutting mat rests on it; the ambient MOCHI collides only without a MOCHI part', async () => {
    const J = await loadJolt('single');
    const set = TINKER.presets.room;
    const mat = set.boxes.find((b) => b.name === 'cutting_mat')!;
    const top = mat.center[1] + mat.half[1];
    const drop = (x: number, z: number, y: number): PartRecordLike => ({ id: makeId(1, 1), type: 'thud', pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: snappedEuler(0, 0, 0), flags: 0 });
    // where the dropped ball first stops falling (its first low point), and where it ends up
    const fall = (parts: PartRecordLike[]): { first: number; end: number } => {
      const m = new Machine(J, { parts }, { preset: 'room', environment: 'tinker' });
      const b = m.bodyInfo().findIndex((x) => x.part === parts[0]!.id && x.role === 'base');
      const xf = new Float32Array(m.bodies.length * 7);
      let prev = Infinity, first = NaN;
      for (let t = 0; t < 360; t++) {
        m.step();
        m.transforms(xf);
        const y = xf[b * 7 + 1]!;
        if (Number.isNaN(first) && y > prev + 1e-5) first = prev;
        prev = y;
      }
      m.destroy();
      return { first: Number.isNaN(first) ? prev : first, end: prev };
    };
    const yAfter = (parts: PartRecordLike[]): number => fall(parts).end;
    expect(yAfter([drop(mat.center[0], mat.center[2], top + 0.5)])).toBeCloseTo(top + 0.11, 1);
    // on top of the sleeping display MOCHI: it holds the ball, unless a real MOCHI part exists (then it's hidden)
    const c = set.mochi.capsule.center;
    const r = set.mochi.capsule.radius;
    const onMochi = fall([drop(c[0], c[2], c[1] + 0.6)]).first;
    expect(onMochi).toBeGreaterThan(c[1] + r + 0.05); // first stops on the capsule's top (then rolls off)
    const mochi = { id: makeId(1, 2), type: 'mochi', pos: [metresToPos(0), metresToPos(0), metresToPos(3)] as [number, number, number], rot: snappedEuler(0, 0, 0), flags: 0 };
    expect(fall([drop(c[0], c[2], c[1] + 0.6), mochi]).first).toBeLessThan(onMochi - 0.1); // capsule gone: straight to the bench
  }, 60_000);
});
type PartRecordLike = { id: number; type: string; pos: [number, number, number]; rot: ReturnType<typeof snappedEuler>; flags: number };
