// Rollback across a contact-buffer-sized world (S3's M3 finding 1, fixed by A3). Jolt drops contacts past its
// contact-constraint buffer, and which ones it drops depends on state SaveState doesn't record, so a rolled-back run
// diverged from the straight run on a 2,100-BRIK stack (the old budget, 4 per part, was ~8.4k; the stack needs
// ~17–21k). The buffers are now sized from the world's start state (capacity.ts contactEstimate, ×1.5).
// Size-limited for CI: 2,100 bricks, ~300 ticks in all (≈ 15 s).
import { describe, expect, it } from 'vitest';
import { makeId, metresToPos, type PartRecord } from '@knockon/format';
import { Machine } from '../src/index.ts';
import { contactEstimate } from '../src/capacity.ts';
import { jolt } from './harness.ts';

/** S3's repro (apps/game/bench/repro-rollback.ts): N BRIKs, 3 layers on a 30 × 30 grid, a BRIK shoved in at tick 70. */
function stack(n: number): PartRecord[] {
  const parts: PartRecord[] = [];
  for (let i = 0; i < n; i++) parts.push({ id: makeId(1, i + 1), type: 'brik', pos: [metresToPos((i % 30) * 0.2), metresToPos(0.05 + Math.floor(i / 900) * 0.1), metresToPos(Math.floor((i % 900) / 30) * 0.1)], rot: { tag: 0 }, flags: 0 });
  parts.push({ id: makeId(1, 5000), type: 'brik', pos: [metresToPos(-1), metresToPos(0.05), metresToPos(1)], rot: { tag: 0 }, flags: 0 });
  return parts;
}

describe('rollback on a world that needs a big contact buffer', () => {
  it('2,100 BRIKs: a late poke rolls back to exactly the straight run (it diverged at tick 81 with the old budget)', async () => {
    const J = await jolt();
    const parts = stack(2100);
    const poke = { tick: 70, seq: 1, partId: makeId(1, 5000), kind: 'impulse' as const, data: [40, 6, -20] };
    const a = new Machine(J, { parts }, { preset: 'warehouse' });
    a.addPoke(poke);
    for (let i = 0; i < 120; i++) a.step();
    const b = new Machine(J, { parts }, { preset: 'warehouse' });
    for (let i = 0; i < 90; i++) b.step();
    b.addPoke(poke);
    expect(b.restore(poke.tick)).toBe(60);
    while (b.tick < 120) b.step();
    expect(b.hash()).toBe(a.hash());
    // the buffer never filled
    const peak = a.contactPeak;
    expect(peak.count).toBeGreaterThan(16_000);
    expect(peak.count).toBeLessThan(peak.capacity);
    a.destroy(); b.destroy();
  }, 180_000);

  it('the estimate covers the stack and counts nothing for an empty or colliderless world', () => {
    expect(contactEstimate(stack(2100))).toBeGreaterThan(17_000);
    expect(contactEstimate([])).toBe(0);
    expect(contactEstimate([{ id: makeId(1, 1), type: 'zone', pos: [0, 0, 0], rot: { tag: 0 }, flags: 0 }])).toBe(0);
  });
});
