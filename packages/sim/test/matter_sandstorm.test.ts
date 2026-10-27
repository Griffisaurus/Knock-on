// The full rigid + Matter "Sandstorm" world (matter/sandstorm.ts) on MX's CPU backend, at Node scale (one lane, 5,000
// sand grains): the WATERWHEEL turns under the sand, two runs give the same hash sequence, and a late poke rolls back to
// a Matter checkpoint and matches the straight run (M4_PLAN contract 6, last bullet).

import { describe, expect, it } from 'vitest';
import { makeId, metresToPos } from '@knockon/format';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine, matterCapacity, matterGrains, sandstorm } from '../src/index.ts';
import { jolt } from './harness.ts';

function world() {
  const w = sandstorm({ hoppers: 1, capacity: 50000, start: 10, rate: 5000 });
  // a FUZZ beside the wheel to poke (the sand reaches it)
  const fuzz = makeId(1, 900);
  const parts = [...w.parts, { id: fuzz, type: 'fuzz', pos: [metresToPos(0.3), metresToPos(0.0325), metresToPos(0.02)] as [number, number, number], rot: { tag: 0 as const }, flags: 0 }];
  return { ...w, parts, fuzz };
}

async function machine(w: ReturnType<typeof world>): Promise<Machine> {
  const J = await jolt();
  return new Machine(J, w, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: matterCapacity(matterGrains(w.parts)), checkpointEvery: 60, region: w.region } });
}

const TICKS = 420;

describe('Sandstorm (rigid + Matter) on the CPU backend', () => {
  it('turns the WATERWHEEL; two runs match; a late poke rolls back and matches', async () => {
    const poke = (fuzz: number) => ({ tick: 250, seq: 1, partId: fuzz, kind: 'impulse' as const, data: [-0.004, 0.003, 0] });
    const run = async (late: boolean): Promise<{ hashes: string[]; spin: number; grains: number }> => {
      const w = world();
      const m = await machine(w);
      expect(matterGrains(w.parts)).toBe(5000);
      if (!late) m.addPoke(poke(w.fuzz));
      const info = m.bodyInfo();
      const arm = info.findIndex((b) => b.part === w.wheels[0] && b.role === 'arm');
      const tf = new Float32Array(info.length * 7);
      let last = 0, spin = 0;
      const hashes: string[] = [];
      const step = (): void => {
        m.step();
        m.transforms(tf);
        const a = 2 * Math.atan2(tf[arm * 7 + 5]!, tf[arm * 7 + 6]!);
        let d = a - last; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); spin += d; last = a;
        if (m.tick % 60 === 0) { hashes.length = m.tick / 60 - 1; hashes.push(`${m.hash()}/${m.matter.checksumHex()}`); }
      };
      while (m.tick < (late ? 330 : TICKS)) step();
      if (late) {
        m.addPoke(poke(w.fuzz));
        expect(m.restore(250)).toBe(240);
        while (m.tick < TICKS) step();
      }
      const out = { hashes, spin, grains: m.matter.count(0) };
      m.destroy();
      return out;
    };
    const a = await run(false);
    expect(a.grains).toBe(5000);
    expect(a.spin).toBeLessThan(-0.3); // the buckets on the +X side fill and the wheel turns (clockwise seen from +Z)
    const b = await run(false);
    expect(b.hashes).toEqual(a.hashes);
    const c = await run(true);
    expect(c.hashes).toEqual(a.hashes);
  }, 600000);
});
