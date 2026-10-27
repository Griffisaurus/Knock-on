// Cascade Report logic (M2 stream D): chains with and without sim cause ids, K.O. count, stats, score tiers.

import { describe, expect, it } from 'vitest';
import { TITLE_TIERS, buildReport, overreactionScore, peakSimultaneous, titleFor, type CascadeEvent } from '../src/cascade.ts';

const ev = (tick: number, kind: string, part: number, x: number, extra: Partial<CascadeEvent> = {}): CascadeEvent => ({
  tick, kind, part, pos: [x, 0, 0], mag: 0, ...extra,
});

describe('cascade chain (causal: sim cause ids)', () => {
  // ball 1 hits button 2 → signal to bangstick 3 → boom breaks planks 4 and 5; plank 5 knocks domino 6.
  // A side branch: ball 1 also bumps 9 (shorter). Sound events are ignored.
  const events: CascadeEvent[] = [
    ev(10, 'Impact', 1, 0, { id: 0, cause: -1 }),
    ev(12, 'Press', 2, 0.1, { id: 1, cause: 0 }),
    ev(12, 'Signal', 2, 0.1, { id: 2, cause: 1 }),
    ev(13, 'Impact', 9, 3, { id: 3, cause: 0 }),
    ev(30, 'FuseLit', 3, 1, { id: 4, cause: 2 }),
    ev(90, 'Detonate', 3, 1, { id: 5, cause: 4, mag: 8 }),
    ev(90, 'Break', 4, 1.2, { id: 6, cause: 5 }),
    ev(90, 'Break', 5, 1.3, { id: 7, cause: 5 }),
    ev(91, 'Sound', 5, 1.3, { id: 8, cause: 7 }),
    ev(120, 'Impact', 6, 1.6, { id: 9, cause: 7 }),
  ];
  const r = buildReport(events, { tickRate: 120, partsTotal: 12 });

  it('finds the longest chain, one chip per part, with channel arrows from the causing event', () => {
    expect(r.causal).toBe(true);
    expect(r.chain.map((s) => s.part)).toEqual([1, 2, 3, 5, 6]);
    expect(r.chain.map((s) => s.via)).toEqual([null, 'impact', 'signal', 'heat', 'impact']);
    expect(r.chain.map((s) => s.tick)).toEqual([10, 12, 30, 90, 120]); // each chip scrubs to when its part joined
  });

  it('counts distinct knock-ons and fills the stats grid', () => {
    // 1>2, 1>9, 2>3, 3>4, 3>5, 5>6
    expect(r.ko).toBe(6);
    expect(r.partsUsed).toBe(7);
    expect(r.partsTotal).toBe(12);
    expect(r.channels).toEqual(['impact', 'signal', 'heat']);
    expect(r.biggestBoom).toEqual({ part: 3, mag: 8, tick: 90 });
    expect(r.peak).toBe(4); // ticks 10, 12, 12, 13 fall inside one 50 ms window
    expect(r.runTicks).toBe(120);
    expect(r.events).toBe(9); // Sound left out
  });

  it('is independent of input order', () => {
    const shuffled = [...events].reverse();
    expect(buildReport(shuffled, { tickRate: 120, partsTotal: 12 }).chain).toEqual(r.chain);
  });
});

describe('cascade chain (fallback: inferred causes)', () => {
  it('links events on nearby or linked parts within the window', () => {
    const events: CascadeEvent[] = [
      ev(0, 'Impact', 1, 0),
      ev(20, 'Impact', 2, 0.3), // near 1
      ev(40, 'Press', 3, 5), // far from 2, but linked to 2
      ev(41, 'Signal', 3, 5),
      ev(60, 'Ignite', 4, 9), // far and unlinked: a new root
      ev(400, 'Impact', 5, 5.1), // near 3 but 2.9 s later: outside the window
    ];
    const linked = (a: number, b: number): boolean => (a === 2 && b === 3) || (a === 3 && b === 2);
    const r = buildReport(events, { tickRate: 120, partsTotal: 5, linked });
    expect(r.causal).toBe(false);
    expect(r.chain.map((s) => s.part)).toEqual([1, 2, 3]);
    expect(r.chain.map((s) => s.via)).toEqual([null, 'impact', 'impact']);
    expect(r.ko).toBe(2);
  });

  it('a boom reaches everything it breaks in the same tick', () => {
    const events: CascadeEvent[] = [ev(5, 'Detonate', 1, 0, { mag: 2 }), ev(5, 'Break', 2, 0.4), ev(5, 'Break', 3, -0.4)];
    const r = buildReport(events, { tickRate: 120, partsTotal: 3 });
    expect(r.ko).toBe(2);
    expect(r.chain).toHaveLength(2);
  });

  it('copes with nothing happening', () => {
    const r = buildReport([], { tickRate: 120, partsTotal: 4 });
    expect(r.chain).toEqual([]);
    expect(r.ko).toBe(0);
    expect(r.score).toBe(0);
    expect(r.title).toBe('Mild Kerfuffle');
    expect(r.biggestBoom).toBeNull();
  });

  it('ignores unknown event kinds for channels but keeps them in the graph', () => {
    const r = buildReport([ev(0, 'Impact', 1, 0), ev(3, 'Wobble', 2, 0.1)], { tickRate: 120, partsTotal: 2 });
    expect(r.channels).toEqual(['impact']);
    expect(r.chain.map((s) => s.part)).toEqual([1, 2]);
  });
});

describe('Overreaction Score', () => {
  it('grows with every ingredient', () => {
    const base = { ko: 3, chainLength: 4, channels: ['impact', 'heat'] as const, peak: 5, booms: [8] };
    const s = overreactionScore(base);
    expect(s).toBe(100 * 3 + 250 * 3 + 120 * 2 + 15 * 5 + 200 * 2);
    expect(overreactionScore({ ...base, ko: 4 })).toBeGreaterThan(s);
    expect(overreactionScore({ ...base, chainLength: 5 })).toBeGreaterThan(s);
    expect(overreactionScore({ ...base, channels: ['impact', 'heat', 'signal'] })).toBeGreaterThan(s);
    expect(overreactionScore({ ...base, peak: 6 })).toBeGreaterThan(s);
    expect(overreactionScore({ ...base, booms: [8, 1] })).toBeGreaterThan(s);
  });

  it('maps scores to title tiers, Mild Kerfuffle to Absolute Catastrophe', () => {
    expect(titleFor(0)).toBe('Mild Kerfuffle');
    expect(titleFor(499)).toBe('Mild Kerfuffle');
    expect(titleFor(500)).toBe('Minor Ruckus');
    expect(titleFor(3500)).toBe('Spectacular Overreaction');
    expect(titleFor(1e9)).toBe('Absolute Catastrophe');
    expect(TITLE_TIERS.at(-1)![1]).toBe('Absolute Catastrophe');
  });

  it('peak simultaneous events uses a sliding window', () => {
    expect(peakSimultaneous([{ tick: 0 }, { tick: 5 }, { tick: 6 }, { tick: 20 }], 6)).toBe(2);
    expect(peakSimultaneous([], 6)).toBe(0);
  });
});
