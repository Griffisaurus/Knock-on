// Node-only: the CPU reference split across worker threads, for multi-million-particle runs (the vendor matrix's
// CPU leg). It is the same MatterCpu code: the main thread runs the serial parts (tick prep, radix sort, cell table,
// emits, intakes, outputs) and hands each range kernel (PHASES) to W workers over shared memory. Every phase is a
// per-slot pure function of shared state (cross-kind adds are Atomics.add, impulse partials are exact 64-bit sums
// merged in a fixed order), so the thread count can't change a bit; test/parallel.test.ts checks it.
// Not imported by the package index (it needs node:worker_threads).

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { MatterBackendSync, MatterConfig, MatterStepIn, MatterStepOut } from '../backend.ts';
import { MatterCpu, PHASES, type Phase } from '../cpu.ts';
import type { TickPack } from '../prep.ts';
import { SUBSTEPS, ZONE_STRIDE } from '../constants.ts';

// control block (Int32Array over a SharedArrayBuffer)
const C_SEQ = 0, C_DONE = 1, C_PHASE = 2, C_S0 = 3, C_S1 = 4, C_SUB = 5, C_N = 6, C_PAR = 7, C_STAMP = 8, C_WS = 9, C_MS = 10,
  C_IT = 11, C_NPROX = 12, C_PLIST = 13, C_PROXLEN = 14, C_NDYN = 15, C_QUIT = 16, C_NZONES = 17, C_GS = 18, C_WORDS = 32;
const PK_WORDS = 1 << 23; // 32 MB for proxies + plist per tick
const IMP_WORDS = 4096 * 12; // per worker, hi/lo × 6 components × max dynamic proxies

interface Shared { ctl: Int32Array; pk: Int32Array; imp: Float64Array; arrays: (Int32Array | Uint32Array)[]; capacity: number; workers: number }

export class MatterCpuParallel implements MatterBackendSync {
  readonly kind = 'cpu' as const;
  readonly cpu = new MatterCpu();
  private ws: Worker[] = [];
  private sh: Shared | null = null;
  private lastPk: TickPack | null = null;
  /** Ranges shorter than this run on the main thread. */
  minRange = 8192;

  readonly threads: number;
  constructor(threads: number) { this.threads = threads; }

  async init(cfg: MatterConfig): Promise<void> { await this.start(cfg); }
  async step(input: MatterStepIn): Promise<MatterStepOut> { return this.stepSync(input); }
  async snapshot(): Promise<Uint8Array> { return this.snapshotSync(); }
  async restore(bytes: Uint8Array): Promise<void> { this.restoreSync(bytes); }
  initSync(_cfg: MatterConfig): void { throw new Error('matter: MatterCpuParallel needs `await init()` (workers start asynchronously)'); }
  stepSync(input: MatterStepIn): MatterStepOut { return this.cpu.stepSync(input); }
  snapshotSync(): Uint8Array { return this.cpu.snapshotSync(); }
  restoreSync(bytes: Uint8Array): void { this.cpu.restoreSync(bytes); }

  /** Allocate shared state and start the workers (they report ready before this resolves). */
  async start(cfg: MatterConfig): Promise<void> {
    this.destroy();
    this.cpu.shared = true;
    this.cpu.initSync(cfg);
    const W = Math.max(1, this.threads | 0);
    const sh: Shared = {
      ctl: new Int32Array(new SharedArrayBuffer(C_WORDS * 4)),
      pk: new Int32Array(new SharedArrayBuffer(PK_WORDS * 4)),
      imp: new Float64Array(new SharedArrayBuffer(W * IMP_WORDS * 8)),
      arrays: this.cpu.arrays(), capacity: this.cpu.capacity, workers: W,
    };
    this.sh = sh;
    this.ws = await Promise.all(Array.from({ length: W }, (_, k) => new Promise<Worker>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { ...sh, index: k } });
      w.once('message', () => resolve(w));
      w.once('error', reject);
    })));
    this.cpu.exec = (ph, s0, s1, sub, pk) => this.run(ph, s0, s1, sub, pk);
  }

  private run(ph: Phase, s0: number, s1: number, sub: number, pk: TickPack): void {
    const sh = this.sh!, ctl = sh.ctl, cpu = this.cpu;
    const imp = cpu.impulseBuffer();
    if (s1 - s0 < this.minRange) { cpu.runPhase(ph, s0, s1, sub, pk, imp); return; }
    if (pk !== this.lastPk) {
      // the tick's packed inputs, once per tick, before its first threaded phase (predict reads gravity and zones,
      // apply the proxies): [proxies][plist][gravity per substep][zones]
      const need = pk.proxies.length + pk.plist.length + SUBSTEPS + pk.zones.length;
      if (need > PK_WORDS) throw new Error('matter: tick proxies exceed the parallel driver buffer');
      sh.pk.set(pk.proxies, 0);
      sh.pk.set(pk.plist, pk.proxies.length);
      sh.pk.set(pk.grav, pk.proxies.length + pk.plist.length);
      sh.pk.set(pk.zones, pk.proxies.length + pk.plist.length + SUBSTEPS);
      ctl[C_NPROX] = pk.nProxies; ctl[C_PROXLEN] = pk.proxies.length; ctl[C_PLIST] = pk.plist.length; ctl[C_NDYN] = pk.dynIds.length;
      ctl[C_NZONES] = pk.nZones;
      sh.imp.fill(0);
      this.lastPk = pk;
    }
    const [n, par, stamp, wst, mst, itFirst, gst] = cpu.scalars();
    ctl[C_PHASE] = PHASES.indexOf(ph); ctl[C_S0] = s0; ctl[C_S1] = s1; ctl[C_SUB] = sub;
    ctl[C_N] = n; ctl[C_PAR] = par; ctl[C_STAMP] = stamp; ctl[C_WS] = wst; ctl[C_MS] = mst; ctl[C_IT] = itFirst ? 1 : 0; ctl[C_GS] = gst;
    Atomics.store(ctl, C_DONE, 0);
    Atomics.add(ctl, C_SEQ, 1);
    Atomics.notify(ctl, C_SEQ);
    for (;;) {
      const d = Atomics.load(ctl, C_DONE);
      if (d >= sh.workers) break;
      Atomics.wait(ctl, C_DONE, d);
    }
    if (ph === 'apply' && s1 >= n) this.mergeImpulses(pk);
  }

  /** Fold the workers' 64-bit partials into the tick's impulse buffer (after the last apply of the tick it's final). */
  private mergeImpulses(pk: TickPack): void {
    const sh = this.sh!, imp = this.cpu.impulseBuffer();
    const comps = pk.dynIds.length * 6;
    for (let w = 0; w < sh.workers; w++) {
      const base = w * IMP_WORDS;
      for (let c = 0; c < comps; c++) {
        let lo = imp[c * 2]! + sh.imp[base + c * 2]!;
        let hi = imp[c * 2 + 1]! + sh.imp[base + c * 2 + 1]!;
        if (lo >= 4294967296) { lo -= 4294967296; hi += 1; }
        imp[c * 2] = lo; imp[c * 2 + 1] = hi | 0;
        sh.imp[base + c * 2] = 0; sh.imp[base + c * 2 + 1] = 0;
      }
    }
  }

  destroy(): void {
    if (this.sh) {
      Atomics.store(this.sh.ctl, C_QUIT, 1);
      Atomics.add(this.sh.ctl, C_SEQ, 1);
      Atomics.notify(this.sh.ctl, C_SEQ);
    }
    for (const w of this.ws) void w.terminate();
    this.ws = [];
    this.sh = null;
    this.cpu.exec = (ph, a, b, sb, pk) => this.cpu.runPhase(ph, a, b, sb, pk, this.cpu.impulseBuffer());
  }
}

// ---- worker side ---------------------------------------------------------------------------------------------
if (!isMainThread && workerData && (workerData as { arrays?: unknown }).arrays) {
  const sh = workerData as Shared & { index: number };
  const cpu = new MatterCpu();
  cpu.adopt(sh.arrays, sh.capacity);
  const ctl = sh.ctl;
  const imp = new Float64Array(sh.imp.buffer, sh.index * IMP_WORDS * 8, IMP_WORDS);
  let seen = Atomics.load(ctl, C_SEQ);
  parentPort!.postMessage('ready');
  for (;;) {
    Atomics.wait(ctl, C_SEQ, seen);
    seen = Atomics.load(ctl, C_SEQ);
    if (Atomics.load(ctl, C_QUIT)) break;
    const ph = PHASES[ctl[C_PHASE]!]!;
    const s0 = ctl[C_S0]!, s1 = ctl[C_S1]!;
    cpu.sync(ctl[C_N]!, ctl[C_PAR]!, ctl[C_STAMP]! >>> 0, ctl[C_WS]!, ctl[C_MS]!, ctl[C_IT]! === 1, ctl[C_GS]!);
    const len = s1 - s0, W = sh.workers, k = sh.index;
    const a = s0 + Math.floor((len * k) / W), b = s0 + Math.floor((len * (k + 1)) / W);
    const pl = ctl[C_PROXLEN]!, pll = ctl[C_PLIST]!, nz = ctl[C_NZONES]!;
    const pk = {
      nProxies: ctl[C_NPROX]!, proxies: sh.pk.subarray(0, pl), plist: new Uint32Array(sh.pk.buffer, pl * 4, pll),
      grav: sh.pk.subarray(pl + pll, pl + pll + SUBSTEPS), nZones: nz, zones: sh.pk.subarray(pl + pll + SUBSTEPS, pl + pll + SUBSTEPS + nz * ZONE_STRIDE),
    } as unknown as TickPack;
    if (b > a) cpu.runPhase(ph, a, b, ctl[C_SUB]!, pk, imp);
    Atomics.add(ctl, C_DONE, 1);
    Atomics.notify(ctl, C_DONE);
  }
}
