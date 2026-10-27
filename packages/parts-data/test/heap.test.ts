// J5 (M5): joltHeapMB sizes the Jolt heap for the worst case a world can reach (every part awake), from the measured
// costs (docs/dev/M5_NOTES_J5.md): the numbers below are the formula's, checked against the measured peaks.

import { describe, expect, it } from 'vitest';
import { BODY_PAIRS_MAX, CONTACTS_MAX, JOLT_BIG_WORLD, JOLT_HEAP_MAX_MB, checkpointPlan, joltCapacity, joltHeapMB, joltHeapNeedMB } from '../src/presets.ts';

describe('joltHeapMB (J5)', () => {
  it('keeps the published 128 MB build up to JOLT_BIG_WORLD parts (their checkpoints live in JS memory)', () => {
    expect(joltHeapMB(0)).toBe(128);
    expect(joltHeapMB(JOLT_BIG_WORLD, 50_000)).toBe(128);
  });

  it('is in 64 MB steps, grows with parts and with the contact estimate, and caps at 4,032 MB', () => {
    let last = 0;
    for (const n of [2001, 5000, 20_000, 50_000, 100_000, 154_000, 400_000, 1_000_000, 2_000_000]) {
      for (const c of [0, n * 2, n * 5]) {
        const mb = joltHeapMB(n, c);
        expect(mb % 64).toBe(0);
        expect(mb).toBeLessThanOrEqual(JOLT_HEAP_MAX_MB);
        expect(mb).toBeGreaterThanOrEqual(joltHeapMB(n, 0));
      }
      expect(joltHeapMB(n, n * 5)).toBeGreaterThanOrEqual(last);
      last = joltHeapMB(n, n * 5);
    }
    expect(joltHeapMB(1_000_000, 5_000_000)).toBe(JOLT_HEAP_MAX_MB);
    expect(joltHeapNeedMB(1_000_000, 5_000_000)).toBeGreaterThan(JOLT_HEAP_MAX_MB); // the worst case past 4 GB: J5's graceful stop
  });

  it('contact and pair buffers scale with the parts past the old 2^17 / 2^18 caps (M5: threaded determinism)', () => {
    // the 154k-part domino wave needed > 131,072 contacts at 21 s; overflowing them made two 8-thread runs diverge
    // (bench: sim-bench domino 24 153600 512 1.5 0 --threads=8, twice; identical with these buffers, M5_STATUS)
    const c = joltCapacity(153_600, 153_600 * 2 + 64, 154_624);
    expect(c.maxContacts).toBe(153_600 * 4);
    expect(c.maxBodyPairs).toBe(153_600 * 8);
    expect(joltCapacity(2_000_000, 4_000_064).maxContacts).toBe(CONTACTS_MAX);
    expect(joltCapacity(2_000_000, 4_000_064).maxBodyPairs).toBe(BODY_PAIRS_MAX);
  });

  it('the formula’s numbers', () => {
    // contact estimates as capacity.ts makes them for awakePile(n) (≈ 5.2 per part) and dominoDay (≈ 1 per tile)
    expect(joltHeapMB(20_000, 102_711)).toBe(704);
    expect(joltHeapMB(50_000, 258_916)).toBe(1600); // M5 orchestrator: contact/pair buffers now scale with parts (joltCapacity)
    expect(joltHeapMB(100_000, 520_809)).toBe(2560);
    expect(joltHeapMB(154_000, 800_474)).toBe(3072);
    expect(joltHeapMB(400_000, 2_083_639)).toBe(3776);
    expect(joltHeapMB(153_600, 154_624)).toBe(2624); // the domino world: 614k contact slots (was 131k, which overflowed)
    expect(joltHeapMB(1_000_000, 1_000_000)).toBe(4032); // needs ≈ 7.4 GB all awake: past the cap
    expect(joltHeapNeedMB(1_000_000, 1_000_000)).toBe(7616);
  });

  it('covers every measured all-awake peak (heap high-water, M5_NOTES_J5) with ≥ 15 % to spare', () => {
    // [parts, contact estimate, measured peak MB (8 Jolt threads; the single build peaks ≤ 9 MB lower)]
    const measured: [number, number, number][] = [
      [20_000, 102_711, 385], // dense pile, 18.7k awake
      [50_000, 258_916, 1267], // 46.8k awake
      [100_000, 520_809, 2141], // 93.8k awake
      [154_000, 800_474, 2067], // 143.6k awake
      [400_000, 2_083_639, 2079], // 374.9k awake
      [154_112, 154_624, 1244], // T5's domino world (OOM at 74k awake in 640 MB), 130k awake
    ];
    for (const [n, c, peak] of measured) expect(joltHeapMB(n, c), `${n} parts`).toBeGreaterThan(peak * 1.15);
  });

  it('a small world gets less than the pre-J5 256 MB floor gave it, a big one more (it was sized mostly asleep)', () => {
    const old = (parts: number): number => {
      const cp = checkpointPlan(parts);
      return Math.min(4032, Math.ceil((256 + (parts * 820 + cp.keep * cp.bytes) / 1048576) / 64) * 64);
    };
    expect(joltHeapMB(2001, 2001)).toBeLessThan(old(2001)); // 192 vs 320 MB: an empty Machine is 15 MB, Backlot's terrain 9 MB more
    for (const n of [20_000, 100_000, 400_000]) expect(joltHeapMB(n, n)).toBeGreaterThan(old(n));
  });
});
