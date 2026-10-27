// Generated fracture chunks (ASSET_PIPELINE §7, D66): a breaking FISHBOWL hands over to its 21 pre-built chunk bodies.
import { describe, expect, it } from 'vitest';
import { FISHBOWL_FRAC } from '@knockon/parts-data';
import { Machine } from '../src/index.ts';
import { Build, jolt, rotate } from './harness.ts';

function bowlScene(): { b: Build; bowl: number; thud: number } {
  const b = new Build();
  const bowl = b.add('fishbowl', 0, 0, 0);
  b.add('goby', 0, 0.13, 0);
  const thud = b.add('thud', 0.02, 1.1, 0);
  return { b, bowl, thud };
}

describe('FISHBOWL shatter', () => {
  it('breaks into its 21 dormant chunks, which fly apart and settle on the floor', async () => {
    const { b, bowl } = bowlScene();
    const m = new Machine(await jolt(), b, { preset: 'room' });
    const info = m.bodyInfo();
    const chunks = info.map((x, i) => [x, i] as const).filter(([x]) => x.part === bowl && x.role === 'chunk');
    expect(chunks.length).toBe(FISHBOWL_FRAC.chunks.length);
    const xf = new Float32Array(info.length * 7);
    m.transforms(xf);
    const start = chunks.map(([, i]) => [xf[i * 7]!, xf[i * 7 + 1]!, xf[i * 7 + 2]!]);
    let broke = -1;
    for (let t = 0; t < 360; t++) { m.step(); for (const e of m.drainEvents()) if (e.kind === 'Break' && e.part === bowl && broke < 0) broke = t; }
    expect(broke).toBeGreaterThan(0);
    m.transforms(xf);
    const moved = chunks.filter(([, i], k) => Math.hypot(xf[i * 7]! - start[k]![0]!, xf[i * 7 + 2]! - start[k]![2]!) > 0.02).length;
    expect(moved).toBeGreaterThan(10); // the shards scatter
    chunks.forEach(([, i], k) => {
      // the body origin is the part origin; the chunk itself is at origin + rot·centre
      const q = [xf[i * 7 + 3]!, xf[i * 7 + 4]!, xf[i * 7 + 5]!, xf[i * 7 + 6]!] as const;
      const c = rotate(q, FISHBOWL_FRAC.chunks[k]!.centre);
      const y = xf[i * 7 + 1]! + c[1];
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(-0.01); // nothing falls through the floor
    });
    m.destroy();
  }, 60_000);

  it('is deterministic: replay and a late-poke rollback across the break match', async () => {
    const { b, thud } = bowlScene();
    const J = await jolt();
    const late = { tick: 250, seq: 1, partId: thud, kind: 'impulse' as const, data: [4, 3, 0] };
    const a = new Machine(J, b, { preset: 'room' });
    a.addPoke(late);
    for (let t = 0; t < 360; t++) a.step();
    const c = new Machine(J, b, { preset: 'room' });
    for (let t = 0; t < 290; t++) c.step();
    c.addPoke(late);
    expect(c.restore(250)).toBe(240);
    while (c.tick < 360) c.step();
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 60_000);
});
