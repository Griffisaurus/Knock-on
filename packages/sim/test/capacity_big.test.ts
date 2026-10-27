// M5 (J5 finding 2): contactEstimate on the 16 GB tier's 1M-part cap. Its cell grid used one string-keyed Map, which
// holds at most 2^24 entries, so a 1M-part world threw "Map maximum size exceeded" and no run could start. The grid
// is now numeric and sharded; the pairs counted, and so the total, are unchanged.
// SIMFIX (beta): the grid is now typed arrays and a numeric table (≈ 9.4 s → ≈ 1.6–2 s at 1M parts), and the sim worker
// computes it once per start and hands it to the Machine (MachineOptions.contactEstimate). Totals still unchanged.

import { describe, expect, it } from 'vitest';
import { awakePile, bigWorld, dominoDay, kiloton } from '../../../apps/game/bench/scenes.ts';
import { contactEstimate } from '../src/capacity.ts';
import { Machine } from '../src/index.ts';
import { jolt } from './harness.ts';

describe('contactEstimate at the part caps (M5)', () => {
  it('matches the values pinned before the sharded grid (same pairs, same total)', () => {
    // pinned with the string-keyed Map version on 2026-10-25, before the change
    expect([contactEstimate(kiloton().parts), contactEstimate(dominoDay(20_000, 64).parts), contactEstimate(awakePile(5_000, 8).parts)]).toEqual(PINNED);
  });

  it('matches the M5 grid on 154k- and 200k-part worlds (SIMFIX)', () => {
    // M5's sharded-Map version on 2026-10-25, before the SIMFIX rewrite
    expect([contactEstimate(dominoDay(153_600, 256, 1.5, 1e9).parts), contactEstimate(bigWorld(200_000).parts)]).toEqual([154_112, 133_337]);
  }, 60_000);

  it('a 1M-part Megastructure world no longer throws', () => {
    const n = contactEstimate(bigWorld(1_000_000).parts);
    expect(n).toBe(666_209); // the M5 grid's total (SIMFIX: it took ≈ 9.4 s there)
  }, 300_000);

  it('a Machine given the estimate (MachineOptions.contactEstimate) is the Machine that computes it (SIMFIX)', async () => {
    const J = await jolt();
    const w = awakePile(1_500, 6);
    const run = (opts: { contactEstimate?: number }): { hash: string; capacity: number } => {
      const m = new Machine(J, { parts: w.parts, links: w.links }, { preset: w.env.preset, seed: [...w.seed] as [number, number], ...opts });
      for (let t = 0; t < 120; t++) m.step();
      const out = { hash: m.hash(), capacity: m.contactPeak.capacity };
      m.destroy();
      return out;
    };
    expect(run({ contactEstimate: contactEstimate(w.parts) })).toEqual(run({}));
  }, 60_000);
});

const PINNED = [15875, 21024, 24622]; // also 133,337 for bigWorld(200k), identical old vs new
