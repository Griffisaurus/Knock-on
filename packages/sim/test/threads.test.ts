// J4 (M4, D89): multithreaded Jolt is hash-identical to the single-threaded build at 1, 4 and 12 worker threads.
// Every Library demo machine (the part goldens' worlds), a contact-heavy slice of "Kiloton", rollback with a late
// poke, and a checkpoint moved between the two builds. The whole sim suite can also run threaded:
//   KNOCKON_JOLT_THREADS=12 npx vitest run packages/sim      (harness.ts)

import { describe, expect, it } from 'vitest';
import { snappedEuler, type LinkRecord, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { joltHeapMB } from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { kiloton } from '../../../apps/game/bench/scenes.ts';
import { Machine, type MachineOptions } from '../src/index.ts';
import { Build } from './harness.ts';

const COUNTS = [1, 4, 12] as const;
type World = { readonly parts: readonly PartRecord[]; readonly links?: readonly LinkRecord[] };

let st: Promise<JoltModule> | null = null, mt: Promise<JoltModule> | null = null;
const single = (): Promise<JoltModule> => (st ??= loadJolt('single'));
const multi = (): Promise<JoltModule> => (mt ??= loadJolt('multi', { threads: 12 }));

/** Hash every 30 ticks and the event stream (id, kind, cause, part). */
function run(J: JoltModule, w: World, ticks: number, opts: MachineOptions = {}): { hashes: string[]; events: string[]; contacts: number } {
  const m = new Machine(J, w, opts);
  const hashes: string[] = [], events: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    m.step();
    for (const e of m.drainEvents()) events.push(`${e.id}:${e.kind}:${e.cause}:${e.part}`);
    if (t % 30 === 0 || t === ticks) hashes.push(m.hash());
  }
  const contacts = m.contactPeak.count;
  m.destroy();
  return { hashes, events, contacts };
}

describe('multithreaded Jolt = single-threaded, at 1, 4 and 12 threads (D89)', () => {
  it.each(Object.keys(DEMOS))('demo %s', async (key) => {
    const demo = DEMOS[key]!;
    const ref = run(await single(), demo, demo.ticks);
    for (const n of COUNTS) {
      const r = run(await multi(), demo, demo.ticks, { workerThreads: n });
      expect(r.hashes, `${key} at ${n} threads`).toEqual(ref.hashes);
      expect(r.events, `${key} events at ${n} threads`).toEqual(ref.events);
    }
  }, 120_000);

  it('Kiloton (3,917 parts): the fortress settling and the first charges, 1.5 s', async () => {
    const w = kiloton();
    const heapMB = joltHeapMB(w.parts.length);
    const opts: MachineOptions = { preset: w.env.preset, environment: w.env.environment, seed: [...w.seed] as [number, number] };
    const ref = run(await loadJolt('single', { heapMB }), w, 180, opts);
    expect(ref.contacts).toBeGreaterThan(5000); // thousands of contacts a step: the order really is shuffled
    const J = await loadJolt('multi', { heapMB, threads: 12 });
    for (const n of COUNTS) expect(run(J, w, 180, { ...opts, workerThreads: n }).hashes, `Kiloton at ${n} threads`).toEqual(ref.hashes);
  }, 600_000);

  it('rollback: a late poke on a breaking machine rolls back to the straight run at 12 threads', async () => {
    const b = new Build();
    b.add('ledge', -0.45, 0.4, 0);
    b.add('ledge', 0.45, 0.4, 0);
    const plank = b.add('plank', 0, 0.5, 0);
    b.parts[b.parts.length - 1] = { ...b.parts.at(-1)!, rot: snappedEuler(90, 0, 0) };
    const thud = b.add('thud', 0, 2.5, 0);
    for (let i = 0; i < 6; i++) b.add('brik', -0.3 + i * 0.12, 0.05, 0.6);
    const early = { tick: 200, seq: 1, partId: plank, kind: 'impulse' as const, data: [2, 3, 0] };
    const late = { tick: 250, seq: 2, partId: thud, kind: 'impulse' as const, data: [5, 2, 0] };
    const S = await single(), M = await multi();
    const straight = new Machine(S, b);
    straight.addPoke(early); straight.addPoke(late);
    for (let t = 0; t < 360; t++) straight.step();
    const c = new Machine(M, b, { workerThreads: 12 });
    c.addPoke(early);
    for (let t = 0; t < 290; t++) c.step();
    c.addPoke(late);
    expect(c.restore(250)).toBe(240);
    while (c.tick < 360) c.step();
    expect(c.hash()).toBe(straight.hash());
    straight.destroy(); c.destroy();
  }, 60_000);

  it('a checkpoint exported by the single build continues identically in the threaded one (and back)', async () => {
    const demo = DEMOS[Object.keys(DEMOS).find((k) => DEMOS[k]!.ticks >= 360) ?? Object.keys(DEMOS)[0]!]!;
    const S = await single(), M = await multi();
    const a = new Machine(S, demo);
    for (let t = 0; t < 360; t++) a.step();
    const b = new Machine(S, demo), c = new Machine(M, demo, { workerThreads: 4 });
    for (let t = 0; t < 240; t++) b.step();
    const cp = b.exportCheckpoint(240)!;
    expect(cp).not.toBeNull();
    c.importCheckpoint(cp.blob);
    while (c.tick < 300) c.step();
    const back = c.exportCheckpoint(300)!;
    const d = new Machine(S, demo);
    d.importCheckpoint(back.blob);
    while (d.tick < 360) d.step();
    expect(d.hash()).toBe(a.hash());
    for (const m of [a, b, c, d]) m.destroy();
  }, 60_000);
});
