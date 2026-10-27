// J5 (M5): the Jolt heap's size never changes results, and an all-awake world fits the heap joltHeapMB gives it.
//
// The heap is the binary's fixed memory, rewritten at load time (jolt load.ts patchMemory); the code is the same, so a
// run must hash the same at any size, single-threaded or threaded. And the worst case a world can reach (every part
// awake in one dense pile, the rollback ring full of awake checkpoints) must fit the heap the sim worker sizes for it:
// T5 measured `Aborted(OOM)` at ≈ 74k awake in a 154k-part world (docs/dev/M5_NOTES_T5.md, found 5; M5_NOTES_J5.md).

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { joltHeapBytes, joltHeapHighWater, loadJolt, type JoltModule } from '@knockon/jolt';
import { checkpointPlan, joltHeapMB } from '@knockon/parts-data';
import { awakePile } from '../../../apps/game/bench/scenes.ts';
import { Machine, contactEstimate, type MachineOptions } from '../src/index.ts';
import { Build } from './harness.ts';

type World = ReturnType<typeof awakePile>;
const optsOf = (w: World, extra: MachineOptions = {}): MachineOptions => ({ preset: w.env.preset, environment: w.env.environment, seed: [...w.seed] as [number, number], ...extra });

/** Hash every 30 ticks and the event stream. */
function run(J: JoltModule, w: World, ticks: number, extra: MachineOptions = {}): string[] {
  const m = new Machine(J, w, optsOf(w, extra));
  const out: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    m.step();
    for (const e of m.drainEvents()) out.push(`${e.id}:${e.kind}:${e.part}`);
    if (t % 30 === 0) out.push(m.hash());
  }
  m.destroy();
  return out;
}

describe('the Jolt heap size never changes results (J5)', () => {
  it('a 1,500-part awake pile hashes the same on the stock 128 MB heap, 512 MB, 4,032 MB and threaded at 256 / 2,048 MB', async () => {
    const w = awakePile(1500, 4, 'arena');
    const ref = run(await loadJolt('single'), w, 240);
    expect(ref.filter((x) => x.length === 16).length).toBe(8);
    for (const heapMB of [512, 4032]) expect(run(await loadJolt('single', { heapMB }), w, 240), `single, ${heapMB} MB`).toEqual(ref);
    for (const heapMB of [256, 2048]) expect(run(await loadJolt('multi', { heapMB, threads: 4 }), w, 240), `threaded, ${heapMB} MB`).toEqual(ref);
  }, 240_000);

  it('a big-world run (in-heap checkpoints) rolls back to the same state at a different heap size', async () => {
    // 2,100 parts: past JOLT_BIG_WORLD, so the checkpoints are StateRecorderImpls inside the heap. 2,000 BRIKs apart
    // (they settle and sleep) and a 100-brick stack the THUD is shoved into
    const b = new Build();
    for (let i = 0; i < 2000; i++) b.add('brik', (i % 50) * 0.4 - 10, 0.06, Math.floor(i / 50) * 0.4 + 3, {}, snappedEuler(0, (i % 7) * 15, 0));
    for (let i = 0; i < 100; i++) b.add('brik', (i % 10) * 0.2 - 1, 0.05 + Math.floor(i / 20) * 0.1, Math.floor((i % 20) / 10) * 0.1, {}, snappedEuler(0, 0, 0));
    const thud = b.add('thud', -0.1, 1.2, 0.05);
    const w = { ...awakePile(1, 1, 'arena'), parts: b.parts, links: b.links };
    const poke = { tick: 130, seq: 1, partId: thud, kind: 'impulse' as const, data: [12, 3, 0] };
    const heap = joltHeapMB(w.parts.length, contactEstimate(w.parts));
    const straight = new Machine(await loadJolt('single', { heapMB: heap }), w, optsOf(w));
    straight.addPoke(poke);
    for (let t = 0; t < 300; t++) straight.step();
    const late = new Machine(await loadJolt('single', { heapMB: 3072 }), w, optsOf(w, { checkpointEvery: 60 }));
    for (let t = 0; t < 250; t++) late.step();
    const unpoked = late.hash();
    late.addPoke(poke);
    expect(late.restore(poke.tick)).toBe(120);
    for (let t = 0; t < 120; t++) late.step(); // tick 250 again, now with the poke
    expect(late.hash()).not.toBe(unpoked); // the poke matters
    while (late.tick < 300) late.step();
    expect(late.hash()).toBe(straight.hash());
    straight.destroy(); late.destroy();
  }, 120_000);
});

describe('an all-awake world fits the heap joltHeapMB sizes (J5)', () => {
  it('20k parts, every one awake in a dense pile, the rollback ring full of awake checkpoints: no OOM, with margin', async () => {
    // the 4 GB tier's part cap, all awake: 18.7k bodies awake through the run (measured). Checkpoints every 15 ticks
    // instead of 60 fill the 16-checkpoint ring with awake state in 2 s of run instead of 8 (the same memory, sooner).
    const w = awakePile(20_000, 8, 'arena');
    const heapMB = joltHeapMB(w.parts.length, contactEstimate(w.parts));
    const J = await loadJolt('multi', { heapMB, threads: 8 });
    const plan = checkpointPlan(w.parts.length);
    const m = new Machine(J, w, optsOf(w, { checkpointEvery: 15 }));
    let awake = 0;
    for (let t = 0; t < 120 + plan.keep * 15; t++) { m.step(); if (t === 120) awake = m.awakeBodies(); }
    expect(awake).toBeGreaterThan(18_000);
    // and a desync-repair export on top (one more full checkpoint in the heap while it runs)
    expect(m.exportCheckpoint(m.tick - 15)).not.toBeNull();
    const peak = joltHeapHighWater(J);
    expect(joltHeapBytes(J)).toBeGreaterThanOrEqual(heapMB * 1048576);
    m.destroy();
    // against joltHeapMB itself, not the threaded loader's extra headroom: ≥ 10 % of it never touched
    expect(peak).toBeLessThan(heapMB * 1048576 * 0.9);
  }, 180_000);

  // ≈ 43 s on a 24-core machine (12 Jolt threads)
  it('86k parts, ≈ 80k awake (past the old OOM point, T5: 74k in 640 MB), fits its new heap', async () => {
    const w = awakePile(86_000, 8, 'arena');
    const heapMB = joltHeapMB(w.parts.length, contactEstimate(w.parts));
    const J = await loadJolt('multi', { heapMB, threads: 12 });
    const keep = checkpointPlan(w.parts.length).keep;
    const m = new Machine(J, w, optsOf(w, { checkpointEvery: 10 }));
    let awake = 0;
    for (let t = 0; t < 120 + keep * 10; t++) { m.step(); if (t === 120) awake = m.awakeBodies(); }
    expect(awake).toBeGreaterThan(78_000);
    expect(m.exportCheckpoint(m.tick - 10)).not.toBeNull();
    const peak = joltHeapHighWater(J);
    m.destroy();
    console.info(`[J5] 86k-part pile: ${awake} awake, heap ${heapMB} MB, high-water ${(peak / 1048576).toFixed(0)} MB`);
    expect(peak).toBeLessThan(heapMB * 1048576 * 0.9);
  }, 900_000);
});
