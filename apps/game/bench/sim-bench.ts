// Node sim bench (SIMULATION §12; the perf harness's sim half): builds a scene's Machine and steps it, reporting
// build time, per-tick cost (mean / p95 / max) over windows, awake bodies, bake throughput (ticks/s) and the
// worst window's real-time factor. Same Jolt build and Machine as the sim worker.
//
//   node --disable-warning=ExperimentalWarning apps/game/bench/sim-bench.ts kiloton [seconds] [--threads=N]
//     --threads=N: the multithreaded Jolt build with N worker threads (J4; --multi = --threads=4)
//   node … sim-bench.ts domino [seconds] [count] [lanes] [gap] [segment]     (T5: segment 0 = unbroken lanes)
//   node … sim-bench.ts pile [seconds] [count] [layers] [preset]             (T5: the awake-body ceiling)
//   node … sim-bench.ts big [count]          (build only: the 1M-part load target's Machine stage)
//   J5 (M5): --heap=MB (Jolt heap; default joltHeapMB as the sim worker sizes it), --cp=N (checkpoint every N ticks,
//     so the rollback ring fills with awake state sooner), --keep=N; every run reports the Jolt heap's high-water mark
//     (heapPeakMB: the top-most byte the allocator ever touched) and an Aborted(OOM) as `oom` instead of crashing

import { joltHeapHighWater, loadJolt } from '@knockon/jolt';
import { Machine, contactEstimate } from '@knockon/sim';
import { joltHeapMB } from '@knockon/parts-data';
import { awakePile, bigWorld, dominoDay, kiloton } from './scenes.ts';
import type { WorldSnapshot } from '@knockon/format';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const threadArg = process.argv.find((a) => a.startsWith('--threads='));
const threads = threadArg ? Number(threadArg.slice(10)) : process.argv.includes('--multi') ? 4 : undefined;
const multi = threads !== undefined;
const numArg = (name: string): number | undefined => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.slice(name.length + 3)) : undefined; };
const which = args[0] ?? 'kiloton';

export interface SimBenchResult {
  scene: string;
  parts: number;
  bodies: number;
  buildMs: number;
  ticks: number;
  tickMeanMs: number;
  tickP95Ms: number;
  tickMaxMs: number;
  ticksPerSec: number;
  peakAwake: number;
  worstWindow: { fromS: number; meanMs: number; awake: number };
  windows: { s: number; meanMs: number; maxMs: number; awake: number; events: number }[];
  events: Record<string, number>;
  checkpointMs: number;
  heapMB: number;
  heapUsedMB: number;
  /** J5 (M5): the Jolt heap's high-water mark (MB from address 0: static data, stack and every allocation; jolt joltHeapHighWater). */
  heapPeakMB: number;
  /** J5: the most heap in use after any tick (JoltInterface sGetTotalMemory − sGetFreeMemory), MB. */
  heapLiveMaxMB: number;
  /** J5: the Jolt abort, if the run ran out of heap (`Aborted(OOM)`), with the tick and awake count it happened at. */
  oom?: { message: string; tick: number; awake: number };
  /** J5: the busiest step's contact count against Jolt's contact buffer (Machine.contactPeak; over it Jolt drops contacts). */
  contactPeak?: { count: number; capacity: number };
  /** J4: Jolt worker threads (undefined: the single-threaded build), and the state hash every second and at the end. */
  threads: number | undefined;
  hashes: string[];
}

export async function benchSim(name: string, world: WorldSnapshot, seconds: number, opts: { multi?: boolean; threads?: number; log?: boolean; heapMB?: number; checkpointEvery?: number; keepCheckpoints?: number } = {}): Promise<SimBenchResult> {
  // J5 (M5): sized as the sim worker sizes it (with the start-state contact estimate), unless told
  const heapMB = opts.heapMB ?? joltHeapMB(world.parts.length, contactEstimate(world.parts));
  const J = await loadJolt(opts.multi || opts.threads !== undefined ? 'multi' : 'single', { heapMB, ...(opts.threads !== undefined ? { threads: opts.threads } : {}) });
  const mem = (): number => Math.round(((J.JoltInterface.prototype.sGetTotalMemory() >>> 0) - (J.JoltInterface.prototype.sGetFreeMemory() >>> 0)) / 1048576);
  const mem0 = mem();
  const t0 = performance.now();
  const m = new Machine(J, { parts: world.parts, links: world.links }, {
    preset: world.env.preset, environment: world.env.environment, gravityPercent: world.env.gravity, airPercent: world.env.air, seed: [...world.seed] as [number, number],
    ...(opts.checkpointEvery !== undefined ? { checkpointEvery: opts.checkpointEvery } : {}), ...(opts.keepCheckpoints !== undefined ? { keepCheckpoints: opts.keepCheckpoints } : {}),
  });
  const buildMs = performance.now() - t0;
  const heapUsedMB = mem() - mem0;
  if (opts.log) console.log(`  built in ${buildMs.toFixed(0)} ms, Jolt heap ${heapMB} MB, ${heapUsedMB} MB used by the machine`);
  const ticks = Math.round(seconds * m.tickRate);
  const times = new Float64Array(ticks);
  const windows: SimBenchResult['windows'] = [];
  const events: Record<string, number> = {};
  let win: number[] = [], winEv = 0, peakAwake = 0, cpMs = 0, cpN = 0;
  const hashes: string[] = [];
  let liveMax = 0, oom: SimBenchResult['oom'];
  for (let i = 0; i < ticks; i++) {
    const cp = (m.tick + 1) % 60 === 0;
    const a = performance.now();
    try { m.step(); } catch (e) {
      // J5: a Jolt abort (the module is dead from here on: report it, don't step it again)
      oom = { message: String(e instanceof Error ? e.message : e), tick: m.tick, awake: peakAwake };
      if (opts.log) console.log(`  ABORT at tick ${m.tick}: ${oom.message}`);
      break;
    }
    const dt = performance.now() - a;
    liveMax = Math.max(liveMax, mem());
    times[i] = dt;
    if (cp) { cpMs += dt; cpN++; }
    win.push(dt);
    for (const e of m.drainEvents()) { events[e.kind] = (events[e.kind] ?? 0) + 1; winEv++; }
    if ((i + 1) % m.tickRate === 0) {
      hashes.push(m.hash());
      const awake = m.awakeBodies();
      peakAwake = Math.max(peakAwake, awake);
      if (opts.log) process.stdout.write(`  heap now ${mem()} MB, high-water ${(joltHeapHighWater(J) / 1048576).toFixed(0)} MB
`);
      const mean = win.reduce((s, x) => s + x, 0) / win.length;
      windows.push({ s: (i + 1) / m.tickRate, meanMs: +mean.toFixed(3), maxMs: +Math.max(...win).toFixed(2), awake, events: winEv });
      if (opts.log) console.log(`  t=${String((i + 1) / m.tickRate).padStart(4)} s  tick ${mean.toFixed(2)} ms (max ${Math.max(...win).toFixed(1)})  awake ${awake}  events ${winEv}`);
      win = []; winEv = 0;
    }
  }
  const done = oom ? windows.length * m.tickRate : ticks;
  const sorted = [...times.subarray(0, Math.max(1, done))].sort((x, y) => x - y);
  const total = times.reduce((s, x) => s + x, 0);
  const heapPeakMB = +(joltHeapHighWater(J) / 1048576).toFixed(1);
  const worst = windows.reduce((w, x) => (x.meanMs > w.meanMs ? x : w), windows[0] ?? { s: 0, meanMs: 0, maxMs: 0, awake: 0, events: 0 });
  const res: SimBenchResult = {
    scene: name, parts: world.parts.length, bodies: m.bodies.length, buildMs: Math.round(buildMs), ticks,
    tickMeanMs: +(total / ticks).toFixed(3), tickP95Ms: +(sorted[Math.floor(ticks * 0.95)] ?? 0).toFixed(3), tickMaxMs: +(sorted[ticks - 1] ?? 0).toFixed(2),
    ticksPerSec: Math.round((ticks / total) * 1000), peakAwake,
    worstWindow: { fromS: worst.s - 1, meanMs: worst.meanMs, awake: worst.awake }, windows, events,
    checkpointMs: cpN ? +(cpMs / cpN).toFixed(2) : 0, heapMB, heapUsedMB, heapPeakMB, heapLiveMaxMB: liveMax,
    threads: opts.threads ?? (opts.multi ? 4 : undefined), hashes, ...(oom ? { oom } : { contactPeak: m.contactPeak }),
  };
  if (!oom) m.destroy();
  return res;
}

if (import.meta.url === `file://${process.argv[1]!.replaceAll('\\', '/').replace(/^([A-Z]):/, '/$1:')}` || process.argv[1]?.endsWith('sim-bench.ts')) {
  const seconds = Number(args[1] ?? 20);
  let world: WorldSnapshot;
  if (which === 'kiloton') world = kiloton();
  // T5 (M5): domino [seconds] [count] [lanes] [gap] [segment] (segment 0 = unbroken lanes: the awake count grows with the
  // wave); pile [seconds] [count] [layers] [preset] (awakePile: every body awake at once)
  else if (which === 'domino') world = dominoDay(Number(args[2] ?? 100_000), Number(args[3] ?? 64), Number(args[4] ?? 12), Number(args[5] ?? 40) || 1e9);
  else if (which === 'pile') world = awakePile(Number(args[2] ?? 10_000), Number(args[3] ?? 8), (args[4] ?? 'arena') as 'arena' | 'megastructure');
  else world = bigWorld(Number(args[1] ?? 1_000_000));
  console.log(`${which}: ${world.parts.length} parts, ${world.links.length} links, preset ${world.env.preset}, Jolt ${multi ? `multi, ${threads} threads` : 'single'}`);
  const heapArg = numArg('heap'), cpArg = numArg('cp'), keepArg = numArg('keep');
  const r = await benchSim(which, world, which === 'big' ? 1 : seconds, {
    ...(threads !== undefined ? { threads } : {}), log: true,
    ...(heapArg !== undefined ? { heapMB: heapArg } : {}), ...(cpArg !== undefined ? { checkpointEvery: cpArg } : {}), ...(keepArg !== undefined ? { keepCheckpoints: keepArg } : {}),
  });
  const { windows: _w, hashes, ...summary } = r;
  console.log(`hashes: ${hashes.join(' ')}`);
  console.log(JSON.stringify(summary, null, 1));
  process.exit(0);
}
