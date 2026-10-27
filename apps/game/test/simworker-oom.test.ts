// J5 (M5): a Jolt abort in the sim worker ends the run with a report, never a crash or a silent hang.
//
// The worker runs here in Node with a stand-in `self`. Its Jolt heap is forced to the stock 128 MB, which an 8,000-part
// awake pile outgrows within a second or two of run (its in-heap rollback checkpoints: M5_NOTES_J5.md), so the
// worker meets a real `Aborted(OOM)` inside its bake loop. It must post one fatal 'oom' error for that run, stop baking,
// and start the next run on a freshly loaded module.

import { afterAll, describe, expect, it, vi } from 'vitest';
import type { FromWorker, ToWorker } from '../src/sim.worker.ts';
import { awakePile } from '../bench/scenes.ts';

const loads: { kind: string; heapMB: number | undefined }[] = [];
let forceHeapMB: number | undefined;

vi.mock('@knockon/jolt', async (importOriginal) => {
  const o = await importOriginal<typeof import('@knockon/jolt')>();
  return {
    ...o,
    loadJolt: (kind: 'single' | 'multi', opts: { heapMB?: number; threads?: number } = {}) => {
      loads.push({ kind, heapMB: forceHeapMB ?? opts.heapMB });
      return o.loadJolt(kind, { ...opts, heapMB: forceHeapMB ?? opts.heapMB });
    },
  };
});

const posted: FromWorker[] = [];
const g = globalThis as unknown as { self?: unknown };
const self0 = g.self;
const fakeSelf: { postMessage(m: FromWorker): void; onmessage: ((ev: { data: ToWorker }) => Promise<void>) | null; crossOriginIsolated: boolean } = {
  postMessage: (m) => { posted.push(m); },
  onmessage: null,
  crossOriginIsolated: false, // the single-threaded build
};

afterAll(() => {
  void fakeSelf.onmessage?.({ data: { type: 'stop' } });
  g.self = self0;
});

const until = async (what: () => boolean, ms: number): Promise<void> => {
  const t0 = Date.now();
  while (!what() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
};

function startMsg(runId: string, w: ReturnType<typeof awakePile>): ToWorker {
  return {
    type: 'start', runId, parts: w.parts, links: w.links, gravity: w.env.gravity, air: w.env.air, preset: w.env.preset, environment: w.env.environment,
    seed: [...w.seed] as [number, number], tickRate: 120, play: { tick: 0, speed: 1, paused: false, at: performance.timeOrigin + performance.now() },
  };
}

describe('sim worker: a Jolt OOM stops the run with a report (J5)', () => {
  it('posts one fatal oom error, stops baking, and the next run loads a fresh Jolt module', async () => {
    g.self = fakeSelf;
    await import('../src/sim.worker.ts');
    expect(fakeSelf.onmessage).toBeTypeOf('function');
    forceHeapMB = 128; // the stock heap, far below what joltHeapMB gives this world
    await fakeSelf.onmessage!({ data: startMsg('oom-run', awakePile(8000, 8, 'arena')) });
    expect(posted.find((m) => m.type === 'ready')).toBeDefined();
    await until(() => posted.some((m) => m.type === 'error'), 120_000);
    const errs = posted.filter((m): m is Extract<FromWorker, { type: 'error' }> => m.type === 'error');
    expect(errs).toHaveLength(1);
    const f = errs[0]!.fatal!;
    expect(f).toBeDefined();
    expect(f.kind).toBe('oom');
    expect(f.runId).toBe('oom-run');
    expect(f.tick).toBeGreaterThan(0);
    expect(f.awake).toBeGreaterThan(5000);
    expect(errs[0]!.message).toMatch(/Aborted\(OOM\)/);
    // the loop is stopped: nothing more for that run
    const n = posted.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(posted.length).toBe(n);
    // the next start loads a new module (the dead one is never stepped again) and runs
    forceHeapMB = undefined;
    const before = loads.length;
    await fakeSelf.onmessage!({ data: startMsg('next-run', awakePile(200, 2, 'arena')) });
    expect(loads.length).toBe(before + 1);
    expect(posted.find((m) => m.type === 'ready' && m.runId === 'next-run')).toBeDefined();
    await until(() => posted.some((m) => m.type === 'frame' && m.runId === 'next-run' && m.baked > 60), 30_000);
    expect(posted.some((m) => m.type === 'frame' && m.runId === 'next-run' && m.baked > 60)).toBe(true);
    expect(posted.filter((m) => m.type === 'error')).toHaveLength(1);
  }, 180_000);
});
