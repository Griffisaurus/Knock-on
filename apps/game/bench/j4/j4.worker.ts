// J4: one thread-matrix run (see j4.ts): build the scene's Machine on the requested Jolt build, step it, time it.
import { loadJolt } from '@knockon/jolt';
import { Machine } from '@knockon/sim';
import { joltHeapMB } from '@knockon/parts-data';
import { dominoDay, kiloton } from '../scenes.ts';

export interface J4Result {
  scene: string; threads: number; parts: number; buildMs: number; ticks: number;
  tickMeanMs: number; tickP95Ms: number; worstMs: number; worstFromS: number; stepShare: number;
  windows: number[]; hashes: string[];
}

self.onmessage = async (ev: MessageEvent<{ scene: string; seconds: number; threads: number }>) => {
  try {
    const { scene, seconds, threads } = ev.data;
    const w = scene === 'domino' ? dominoDay() : kiloton();
    const heapMB = joltHeapMB(w.parts.length);
    const J = await (threads ? loadJolt('multi', { heapMB, threads }) : loadJolt('single', { heapMB }));
    const t0 = performance.now();
    const m = new Machine(J, { parts: w.parts, links: w.links }, {
      preset: w.env.preset, environment: w.env.environment, gravityPercent: w.env.gravity, airPercent: w.env.air, seed: [...w.seed] as [number, number],
    });
    const buildMs = Math.round(performance.now() - t0);
    // time inside Jolt.Step separately (the rest is the JS tick: stages, gather, contacts)
    const jolt = (m as unknown as { jolt: { Step(dt: number, n: number): void } }).jolt;
    const step = jolt.Step.bind(jolt);
    let inStep = 0;
    jolt.Step = (dt: number, n: number) => { const a = performance.now(); step(dt, n); inStep += performance.now() - a; };
    const ticks = Math.round(seconds * m.tickRate);
    const times = new Float64Array(ticks);
    const windows: number[] = [], hashes: string[] = [];
    let win = 0;
    for (let i = 0; i < ticks; i++) {
      const a = performance.now();
      m.step();
      const dt = performance.now() - a;
      times[i] = dt; win += dt;
      m.drainEvents();
      if ((i + 1) % m.tickRate === 0) { windows.push(+(win / m.tickRate).toFixed(3)); win = 0; hashes.push(m.hash()); }
    }
    const total = times.reduce((s, x) => s + x, 0);
    const sorted = [...times].sort((x, y) => x - y);
    const worst = windows.reduce((b, x, i) => (x > windows[b]! ? i : b), 0);
    m.destroy();
    const r: J4Result = {
      scene, threads, parts: w.parts.length, buildMs, ticks, tickMeanMs: +(total / ticks).toFixed(3), tickP95Ms: +(sorted[Math.floor(ticks * 0.95)] ?? 0).toFixed(3),
      worstMs: windows[worst] ?? 0, worstFromS: worst, stepShare: Math.round((inStep / total) * 100), windows, hashes,
    };
    (self as unknown as Worker).postMessage(r);
  } catch (e) {
    (self as unknown as Worker).postMessage({ error: String((e as Error)?.stack ?? e) });
  }
};
