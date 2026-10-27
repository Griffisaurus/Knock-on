// D98 "Fill the sink": the Mega Kitchen's basin starts full of Matter water (1M particles on every machine; tests use a
// smaller cap through MatterOptions.sinkFill). The fill schedule, the water staying in the basin, determinism and a
// rollback through the fill.

import { describe, expect, it } from 'vitest';
import { SINK_FILL_PARTICLES } from '@knockon/format';
import { KITCHEN } from '@knockon/parts-data';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine, matterGrains } from '../src/index.ts';
import { SINK, sinkPlan } from '../src/matter/parts.ts';
import { SyncBackendLink, type MatterLink, type MatterSnapRef } from '../src/matter/link.ts';
import type { MatterStepIn, MatterStepOut } from '../src/matter/contract.ts';
import { Build, jolt } from './harness.ts';
import { ToyMatter } from './matter_toy.ts';

const floor = KITCHEN.presets.room.boxes.find((b) => b.name === 'sink_floor')!;
const basin = { x0: floor.center[0] - floor.half[0], x1: floor.center[0] + floor.half[0], z0: floor.center[2] - floor.half[2], z1: floor.center[2] + floor.half[2], y0: floor.center[1] + floor.half[1] };

describe('Fill the sink (D98)', () => {
  it('counts 1M grains for a Kitchen world with the sink on, and nothing elsewhere', () => {
    expect(matterGrains([], { environment: 'kitchen', sinkFill: true })).toBe(SINK_FILL_PARTICLES);
    expect(matterGrains([], { environment: 'kitchen', sinkFill: false })).toBe(0);
    expect(matterGrains([], { environment: 'studio', sinkFill: true })).toBe(0);
  });

  it('plans 1M particles as lattice blocks inside the basin, under the fill line', () => {
    const plan = sinkPlan('room', SINK_FILL_PARTICLES);
    let n = 0;
    const half = (SINK.side * SINK.spacing) / 2;
    for (let o = 0; o < plan.length; o += 4) {
      n += plan[o + 3]!;
      expect(plan[o]! - half).toBeGreaterThan(basin.x0); expect(plan[o]! + half).toBeLessThan(basin.x1);
      expect(plan[o + 2]! - half).toBeGreaterThan(basin.z0); expect(plan[o + 2]! + half).toBeLessThan(basin.z1);
      expect(plan[o + 1]! - half).toBeGreaterThan(basin.y0); expect(plan[o + 1]! + half).toBeLessThanOrEqual(4.2 + 1e-9);
    }
    expect(n).toBe(SINK_FILL_PARTICLES);
    expect(plan.length / 4).toBe(579);
  });

  it('emits the full 1M over the first 10 Matter ticks, identically (toy backend, emits beyond its capacity dropped)', async () => {
    const run = async (): Promise<number[]> => {
      const toy = new ToyMatter();
      toy.initSync({ capacity: 1000, seed: 1 });
      const inner = new SyncBackendLink(toy);
      const per: number[] = [];
      const link: MatterLink = {
        kind: 'spy', submit: (i: MatterStepIn) => { per.push(i.emits.reduce((a, e) => a + e.count, 0)); inner.submit(i); },
        take: (t: number): MatterStepOut => inner.take(t), snapshot: (): MatterSnapRef => inner.snapshot(), restore: (r) => inner.restore(r),
        bytes: (r) => inner.bytes(r), release: (r) => inner.release(r), destroy: () => inner.destroy(),
      };
      const m = new Machine(await jolt(), { parts: [] }, { environment: 'kitchen', preset: 'room', simFlags: { matterGameplay: true }, matter: { link, sinkFill: SINK_FILL_PARTICLES, checkpointEvery: 60 } });
      for (let t = 0; t < 40; t++) m.step();
      m.destroy();
      return per;
    };
    const a = await run();
    expect(a.reduce((x, y) => x + y, 0)).toBe(SINK_FILL_PARTICLES);
    expect(a.slice(0, 10).every((n) => n > 0)).toBe(true);
    expect(a.slice(10).every((n) => n === 0)).toBe(true);
    expect(await run()).toEqual(a);
  });

  it('on the CPU backend: the water stays in the basin, two runs match, and a late poke rolls back through the fill', async () => {
    const N = 2000;
    const world = (): { b: Build; fuzz: number } => {
      const b = new Build();
      const fuzz = b.add('fuzz', 0.3, 4.0, -6.5); // drops into the water
      return { b, fuzz };
    };
    const machine = async (b: Build): Promise<Machine> => new Machine(await jolt(), b, { environment: 'kitchen', preset: 'room', simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 4096, sinkFill: N, checkpointEvery: 60 } });
    const poke = (id: number) => ({ tick: 30, seq: 1, partId: id, kind: 'impulse' as const, data: [0.004, 0, 0] });
    const run = async (late: boolean): Promise<{ hashes: string[]; m: Machine }> => {
      const { b, fuzz } = world();
      const m = await machine(b);
      if (!late) m.addPoke(poke(fuzz));
      const hashes: string[] = [];
      const step = (): void => { m.step(); if (m.tick % 60 === 0) { hashes.length = m.tick / 60 - 1; hashes.push(`${m.hash()}/${m.matter.checksumHex()}`); } };
      while (m.tick < (late ? 150 : 240)) step();
      if (late) { m.addPoke(poke(fuzz)); expect(m.restore(30)).toBe(0); while (m.tick < 240) step(); }
      return { hashes, m };
    };
    const a = await run(false);
    expect(a.m.matter.count(1)).toBe(N);
    const bd = a.m.st.matter!.bounds.map((u) => u / 65536);
    expect(bd[0]).toBeGreaterThan(basin.x0 - 0.01); expect(bd[3]).toBeLessThan(basin.x1 + 0.01);
    expect(bd[2]).toBeGreaterThan(basin.z0 - 0.01); expect(bd[5]).toBeLessThan(basin.z1 + 0.01);
    expect(bd[1]).toBeGreaterThan(basin.y0 - 0.01);
    a.m.destroy();
    const b = await run(false);
    expect(b.hashes).toEqual(a.hashes);
    b.m.destroy();
    const c = await run(true);
    expect(c.hashes).toEqual(a.hashes);
    c.m.destroy();
  }, 600000);
});
