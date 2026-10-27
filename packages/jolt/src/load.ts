// Jolt WASM builds (SIMULATION §4.1). Single-threaded for Node/tests and as a fallback;
// multithreaded (WASM threads + SIMD) when the page is cross-origin isolated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JoltModule = any;

import { CTL, CTL_WORDS, contactScriptUrl } from './contacts.ts';

export interface JoltLoadOptions {
  /**
   * S3 (M3 scale): WASM heap size in MB (single-threaded build). The published builds have a fixed 128 MB heap
   * (no memory growth), which holds ~20k bodies; a Megastructure needs far more (GAME_SPEC §15.2: ~1.2 GB for
   * 1M bodies). With `heapMB` the binary's memory section is rewritten at load time to that fixed size
   * (≤ 4095 MB, wasm32). The code is the same build, so results are bit-identical (checked by the goldens).
   */
  readonly heapMB?: number;
  /**
   * J4 (M4): Jolt job-system worker threads for the multithreaded build (the calling thread works too). The
   * Machine reads it with `joltThreads()` when its options don't name a count. Ignored by the single build.
   */
  readonly threads?: number;
}

/** 128 MB: the size the published builds are linked with. */
export const DEFAULT_HEAP_MB = 128;

/** J4: worker threads when `loadJolt('multi')` isn't told (the M0 gate's middle count). */
export const DEFAULT_THREADS = 4;

/** J4: the job-system worker count a module was loaded for (`undefined`: the single-threaded build). */
export function joltThreads(J: JoltModule): number | undefined {
  return typeof J?.knThreads === 'number' ? J.knThreads as number : undefined;
}

/**
 * J5 (M5): the heap's high-water mark in bytes: one past the top-most nonzero byte of the module's memory. Our heaps
 * are fixed (no growth), start zeroed, and Emscripten's dlmalloc never hands memory back below its break, so this is
 * the most the module ever needed: static data, stack, every allocation and allocator header, freed or not, including
 * the transients inside a step or a checkpoint that a per-tick `sGetFreeMemory` sample misses. It scans the whole
 * heap (≈ 1 s per GB): benches and tests only.
 */
export function joltHeapHighWater(J: JoltModule): number {
  const u8 = J.HEAPU8 as Uint8Array;
  const words = new Uint32Array(u8.buffer, u8.byteOffset, u8.length >>> 2);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!;
    if (w !== 0) return i * 4 + (w >>> 24 ? 4 : w >>> 16 ? 3 : w >>> 8 ? 2 : 1); // little-endian: the top-most nonzero byte
  }
  return 0;
}

/** J5 (M5): the size of a module's (fixed) heap in bytes. */
export function joltHeapBytes(J: JoltModule): number {
  return (J.HEAPU8 as Uint8Array).length;
}

/**
 * J5 (M5): is `err` a Jolt module abort? Emscripten's `abort()` throws a `WebAssembly.RuntimeError` reading
 * "Aborted(…)": `Aborted(OOM)` when an allocation outgrows the fixed heap, `Aborted()` from Jolt's own asserts. A trap
 * (out-of-bounds access, unreachable) is a RuntimeError too. After any of them the module's memory is in an unknown
 * state and must never be stepped again: drop the module and load a new one.
 */
export function isJoltAbort(err: unknown): boolean {
  const RE = (globalThis as unknown as { WebAssembly?: { RuntimeError?: new () => Error } }).WebAssembly?.RuntimeError;
  return (RE !== undefined && err instanceof RE) || /Aborted\(/.test(String(err instanceof Error ? err.message : err));
}

/** J5 (M5): is `err` the module running out of its fixed heap (`Aborted(OOM)`)? */
export function isJoltOom(err: unknown): boolean {
  return /Aborted\(OOM\)/.test(String(err instanceof Error ? err.message : err));
}

/** J4: true for a build whose memory is shared with Jolt's job threads (the multithreaded builds). */
export function joltIsThreaded(J: JoltModule): boolean {
  return typeof J?.configureWorkerScripts === 'function';
}

export async function loadJolt(kind: 'single' | 'multi' = 'single', opts: JoltLoadOptions = {}): Promise<JoltModule> {
  const heapMB = opts.heapMB ?? DEFAULT_HEAP_MB;
  // J4: the multithreaded build always goes through its own loader (any heap size, worker threads)
  if (kind === 'multi') return loadMulti(heapMB, opts.threads ?? DEFAULT_THREADS);
  // J4 thread-count harness (Node): KNOCKON_JOLT_THREADS=N turns every single-build load into the threaded build
  // with N workers, so soaks, benches and tests run threaded unchanged (results must not change)
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.KNOCKON_JOLT_THREADS;
  if (env !== undefined && env !== '') return loadMulti(heapMB, Number(env));
  if (heapMB > DEFAULT_HEAP_MB) return loadSingleWithHeap(heapMB);
  const mod = await import('jolt-physics/wasm-compat');
  return (mod.default as () => Promise<JoltModule>)();
}

// ---- J4: the multithreaded build -------------------------------------------------------------------------
//
// `wasm-multithread` (WASM threads + SIMD; the same code as `wasm-compat-multithread`, separate .wasm file). Its
// glue creates a fixed 128 MB shared memory (`new WebAssembly.Memory({initial: 2048, maximum: 2048, shared})`, not
// overridable through Module). For a bigger heap, `WebAssembly.Memory` is wrapped while the glue starts: its one
// 2048-page shared memory is made at the heap's size instead (the wrapper removes itself on that call), and the
// binary's memory import is rewritten to match (patchMemory). The pthread workers the glue spawns load the published
// glue as usual (the bundler handles its worker URL) and take the memory and the compiled module from this thread.
// Same code throughout: results are bit-identical to the single build (packages/sim/test/threads.test.ts).

const MT_PAGES = 2048;
const MT_HEADROOM_MB = 32;
const MT_PER_THREAD_MB = 2;
let mtBinary: Promise<Uint8Array> | null = null;
let mtQueue: Promise<unknown> = Promise.resolve();

type WasmMemoryCtor = new (d: { initial: number; maximum?: number; shared?: boolean }) => object;
interface WasmApi { Memory: WasmMemoryCtor; instantiate(b: Uint8Array, i: object): Promise<{ instance: unknown; module: unknown }> }

function loadMulti(heapMB: number, threads: number): Promise<JoltModule> {
  // one at a time: the Memory wrapper is process-wide while a glue starts
  const next = mtQueue.then(() => loadMultiNow(heapMB, threads));
  mtQueue = next.catch(() => undefined);
  return next;
}

async function loadMultiNow(heapMB: number, threads: number): Promise<JoltModule> {
  mtBinary ??= readWasm(new URL('../node_modules/jolt-physics/dist/jolt-physics.multithread.wasm.wasm', import.meta.url));
  // headroom for the job system (measured: ~0.7 MB of Jolt heap per worker thread per Machine, 2,100-BRIK stack)
  const mb = heapMB + MT_HEADROOM_MB + MT_PER_THREAD_MB * threads;
  const pages = Math.max(MT_PAGES, Math.min(65535, Math.ceil((mb * 1048576) / 65536)));
  const binary = pages === MT_PAGES ? await mtBinary : patchMemory(await mtBinary, pages);
  installWorkerErrorGuard();
  const mod = await import('jolt-physics/wasm-multithread');
  const W = (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;
  const Orig = W.Memory;
  let swapped = pages === MT_PAGES;
  if (!swapped) {
    const Sized = function (d: { initial: number; maximum?: number; shared?: boolean }): object {
      if (!swapped && d.shared && d.initial === MT_PAGES && d.maximum === MT_PAGES) {
        swapped = true;
        W.Memory = Orig;
        return new Orig({ ...d, initial: pages, maximum: pages });
      }
      return new Orig(d);
    } as unknown as WasmMemoryCtor;
    (Sized as unknown as { prototype: object }).prototype = Orig.prototype;
    W.Memory = Sized;
  }
  try {
    // the glue starts a pool of 16 pthread workers and resolves only once all have loaded: a browser that can't load
    // them (measured: the desktop pane's Chromium with Vite's HMR on) would hang here forever, so it gets a deadline
    const J = await withDeadline((mod.default as (m: object) => Promise<JoltModule>)({
      instantiateWasm(imports: object, done: (i: unknown, m: unknown) => void) {
        void W.instantiate(binary, imports).then((r) => done(r.instance, r.module));
        return {};
      },
    }), THREAD_START_TIMEOUT_MS, 'jolt: the multithreaded build: its worker threads did not load');
    if (!swapped) throw new Error('jolt: the multithread glue made no 128 MB shared memory (published build changed?)');
    J.knThreads = Math.max(0, Math.floor(threads));
    if (J.knThreads > 0) await checkThreadsStart(J, J.knThreads);
    return J;
  } finally {
    W.Memory = Orig;
  }
}

/** How long the loader waits for the worker pool and the start check for every thread (well under a second normally). */
export const THREAD_START_TIMEOUT_MS = 10_000;

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  const g = globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown; clearTimeout(t: unknown): void };
  return new Promise<T>((resolve, reject) => {
    const t = g.setTimeout(() => reject(new Error(`${what} in ${ms} ms`)), ms);
    p.then((v) => { g.clearTimeout(t); resolve(v); }, (e: unknown) => { g.clearTimeout(t); reject(e); });
  });
}
let errorGuard = false;

/**
 * J4: proves Jolt's worker threads really start before anything relies on them. A throwaway JoltInterface with
 * `threads` workers is made; each pthread runs the worker script, which counts itself in a control word. If they don't
 * all report in time (a browser that can't load the pthread workers: measured in the desktop pane's Chromium with
 * Vite's HMR on, "worker sent an error!"), this throws and the caller falls back to the single-threaded build. The
 * failed probe is left alone: destroying it would join threads that never started and hang.
 */
/**
 * J4: a pthread worker that fails to load must not surface as an uncaught error in this worker or page (the start
 * check reports it). Installed before the glue makes any worker.
 */
function installWorkerErrorGuard(): void {
  // the glue rethrows a pthread worker's load error (an Event) from its onerror; keep that from surfacing as an
  // uncaught error of this worker or page: the check below reports it
  type Listener = (e: { error?: unknown; preventDefault(): void }) => void;
  type WorkerCtor = new (u: unknown, o?: { name?: string }) => { addEventListener(t: string, f: Listener): void };
  const g0 = globalThis as unknown as { addEventListener?(t: string, f: Listener): void; Event?: new () => object; Worker?: WorkerCtor; process?: unknown };
  if (!errorGuard && g0.addEventListener && g0.Event && g0.Worker && !(g0.process as { versions?: { node?: string } } | undefined)?.versions?.node) {
    errorGuard = true;
    const Ev = g0.Event;
    // the rethrown Event, reported in this realm
    g0.addEventListener('error', (e) => { if (e.error instanceof Ev) e.preventDefault(); });
    // and the pthread worker's own error event, which would otherwise propagate to this worker's parent
    const Base = g0.Worker;
    g0.Worker = class extends Base {
      constructor(u: unknown, o?: { name?: string }) {
        super(u, o);
        if (o?.name === 'em-pthread') this.addEventListener('error', (e) => e.preventDefault());
      }
    };
  }
}

async function checkThreadsStart(J: JoltModule, threads: number, timeoutMs = THREAD_START_TIMEOUT_MS): Promise<void> {
  const ctl = J._webidl_malloc(CTL_WORDS * 4) as number;
  J.HEAP32.fill(0, ctl >> 2, (ctl >> 2) + CTL_WORDS);
  J.configureWorkerScripts(contactScriptUrl(), { listener: 0, ctl });
  const s = new J.JoltSettings();
  s.mMaxBodies = 16; s.mMaxBodyPairs = 64; s.mMaxContactConstraints = 64; s.mMaxWorkerThreads = threads;
  const pairs = new J.ObjectLayerPairFilterTable(1);
  const bpi = new J.BroadPhaseLayerInterfaceTable(1, 1);
  bpi.MapObjectToBroadPhaseLayer(0, new J.BroadPhaseLayer(0));
  s.mObjectLayerPairFilter = pairs;
  s.mBroadPhaseLayerInterface = bpi;
  s.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 1, pairs, 1);
  const probe = new J.JoltInterface(s);
  J.destroy(s);
  const started = (): number => (J.HEAP32 as Int32Array)[(ctl >> 2) + CTL.started]!;
  const g = globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown; performance: { now(): number } };
  const t0 = g.performance.now();
  while (started() < threads && g.performance.now() - t0 < timeoutMs) await new Promise<void>((r) => g.setTimeout(r, 10));
  const n = started();
  if (n < threads) throw new Error(`jolt: only ${n} of ${threads} worker threads started in ${timeoutMs} ms`);
  J.destroy(probe);
  J._webidl_free(ctl);
}

let binary: Promise<Uint8Array> | null = null;

/** The plain `wasm` build (same code as `wasm-compat`, separate .wasm file) instantiated from a patched binary. */
async function loadSingleWithHeap(heapMB: number): Promise<JoltModule> {
  binary ??= readWasm(new URL('../node_modules/jolt-physics/dist/jolt-physics.wasm.wasm', import.meta.url));
  const patched = patchMemory(await binary, Math.min(65535, Math.ceil((heapMB * 1048576) / 65536)));
  const mod = await import('jolt-physics/wasm');
  // (typed loosely: this package builds against ES2022 without the DOM / WebAssembly lib)
  const WA = (globalThis as unknown as { WebAssembly: { instantiate(b: Uint8Array, i: object): Promise<{ instance: unknown }> } }).WebAssembly;
  return (mod.default as (m: object) => Promise<JoltModule>)({
    instantiateWasm(imports: object, done: (i: unknown) => void) {
      void WA.instantiate(patched, imports).then((r) => done(r.instance));
      return {};
    },
  });
}

async function readWasm(url: URL): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    const fs = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as typeof import('node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jolt wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---- wasm binary: rewrite the memory limits (memory section, or a memory import) ---------------------------

function leb(v: number): number[] {
  const out: number[] = [];
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}

function readLeb(b: Uint8Array, at: number): [number, number] {
  let v = 0, shift = 0, i = at;
  for (;;) { const x = b[i++]!; v += (x & 0x7f) * 2 ** shift; shift += 7; if (x < 0x80) break; }
  return [v, i];
}

/** Memory type with `pages` as both minimum and maximum (keeps the shared flag). */
function limits(flags: number, pages: number): number[] {
  return [(flags & 2) | 1, ...leb(pages), ...leb(pages)];
}

function skipLimits(b: Uint8Array, at: number): [number, number] {
  const flags = b[at]!;
  let i = readLeb(b, at + 1)[1];
  if (flags & 1) i = readLeb(b, i)[1];
  return [flags, i];
}

export function patchMemory(bin: Uint8Array, pages: number): Uint8Array {
  const out: number[] = Array.from(bin.subarray(0, 8));
  let at = 8;
  while (at < bin.length) {
    const id = bin[at]!;
    const [size, start] = readLeb(bin, at + 1);
    const end = start + size;
    let payload: number[] | null = null;
    if (id === 5) {
      const [count, p0] = readLeb(bin, start);
      payload = leb(count);
      let p = p0;
      for (let k = 0; k < count; k++) { const [flags, next] = skipLimits(bin, p); payload.push(...limits(flags, pages)); p = next; }
    } else if (id === 2) {
      const [count, p0] = readLeb(bin, start);
      payload = leb(count);
      let p = p0;
      for (let k = 0; k < count; k++) {
        const s0 = p;
        const [ml, a] = readLeb(bin, p); p = a + ml;
        const [fl, c] = readLeb(bin, p); p = c + fl;
        const kind = bin[p]!;
        payload.push(...bin.subarray(s0, p + 1));
        p++;
        if (kind === 0) { const [, n] = readLeb(bin, p); payload.push(...bin.subarray(p, n)); p = n; }
        else if (kind === 1) { const t = p; p++; const [, n] = skipLimits(bin, p); payload.push(...bin.subarray(t, n)); p = n; }
        else if (kind === 2) { const [flags, n] = skipLimits(bin, p); payload.push(...limits(flags, pages)); p = n; }
        else if (kind === 3) { payload.push(bin[p]!, bin[p + 1]!); p += 2; }
        else throw new Error(`jolt wasm: import kind ${kind}`);
      }
    }
    if (payload) out.push(id, ...leb(payload.length), ...payload);
    else for (let i = at; i < end; i++) out.push(bin[i]!);
    at = end;
  }
  return new Uint8Array(out);
}
