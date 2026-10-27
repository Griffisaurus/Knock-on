// machine.matter on MX's CPU backend (the Node path of D92): the FISHBOWL water path with the real kernels (water
// contacts, proxies). The CPU reference costs ≈ 47 µs per water particle per Matter tick (measured 2026-10-24: 11,700
// particles = 552 ms per tick), so this run stops shortly after the bowl breaks (≈ tick 55); determinism and rollback
// with the real kernels are proven on Sandstorm (matter_sandstorm.test.ts, sand is cheaper), long runs on the toy.

import { describe, expect, it } from 'vitest';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine } from '../src/index.ts';
import { Build, jolt } from './harness.ts';

async function machine(b: Build, every = 60): Promise<Machine> {
  const J = await jolt();
  return new Machine(J, { parts: b.parts, links: b.links }, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 16384, checkpointEvery: every } });
}

function bowlWorld(): { b: Build; bowl: number; fuzz: number } {
  const b = new Build();
  const bowl = b.add('fishbowl', 0, 0, 0);
  b.add('thud', 0.02, 1.1, 0);
  const fuzz = b.add('fuzz', 0.3, 0.0325, 0.05);
  return { b, bowl, fuzz };
}

describe('machine.matter on the CPU backend', () => {
  it('FISHBOWL: the break bursts 11.7 L of water particles that spread over the floor and push the FUZZ', async () => {
    const { b, bowl, fuzz } = bowlWorld();
    const m = await machine(b);
    const bi = b.parts.findIndex((p) => p.id === bowl);
    const fi = m.bodyInfo().findIndex((x) => x.part === fuzz && x.role === 'base');
    const at = (): number[] => Array.from(m.transforms(new Float32Array(m.bodies.length * 7)).subarray(fi * 7, fi * 7 + 3));
    const f0 = at();
    let broke = -1;
    for (let t = 0; t < 150; t++) { m.step(); for (const e of m.drainEvents()) if (e.kind === 'Break' && e.part === bowl) broke = e.tick; }
    expect(broke).toBeGreaterThan(0);
    expect(m.matter.stored(bi)).toBe(0);
    expect(m.matter.count(1)).toBeGreaterThan(11000); // (a few may leave the kill box)
    const f1 = at();
    expect(Math.hypot(f1[0]! - f0[0]!, f1[2]! - f0[2]!)).toBeGreaterThan(0.002); // the water shoved it
    m.destroy();
  }, 120000);

});
