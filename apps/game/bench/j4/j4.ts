// J4 (M4, D89): the in-browser half of the thread-count matrix. Each (scene, thread count) runs in a fresh dedicated
// worker (the sim worker's situation: a worker that spawns Jolt's pthreads), so memory is returned between runs.
// Reports per-tick timings and the state hash every second; every run of a scene must give the same hashes.
//   cd apps/game && KN_BENCH_PORT=5209 npx vite --config bench/vite.config.ts → http://localhost:5209/bench/j4/
import type { J4Result } from './j4.worker.ts';

const q = new URLSearchParams(location.search);
const scenes = (q.get('scene') ?? 'kiloton,domino').split(',');
const seconds = Number(q.get('seconds') ?? 20);
const threads = (q.get('threads') ?? '0,1,4,12').split(',').map(Number);
const log = document.getElementById('log')!;
const say = (s: string): void => { log.append(`\n${s}`); };

async function one(scene: string, n: number): Promise<J4Result> {
  const w = new Worker(new URL('./j4.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<J4Result>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<J4Result | { error: string }>) => ('error' in e.data ? reject(new Error(e.data.error)) : resolve(e.data));
      w.onerror = (e) => reject(new Error(e.message));
      w.postMessage({ scene, seconds, threads: n });
    });
  } finally { w.terminate(); }
}

async function main(): Promise<void> {
  say(`crossOriginIsolated ${crossOriginIsolated}, hardwareConcurrency ${navigator.hardwareConcurrency}, ${navigator.userAgent}`);
  const results: J4Result[] = [];
  for (const scene of scenes) {
    for (const n of threads) {
      say(`${scene} ${n ? `${n} threads` : 'single build'} …`);
      try {
        const r = await one(scene, n);
        results.push(r);
        say(`  build ${r.buildMs} ms · tick mean ${r.tickMeanMs} ms · p95 ${r.tickP95Ms} · worst 1 s window ${r.worstMs} ms (from ${r.worstFromS} s) · Step share ${r.stepShare}% · final ${r.hashes.at(-1)}`);
      } catch (e) { say(`  FAILED: ${String(e)}`); }
    }
    const ref = results.find((r) => r.scene === scene);
    const same = results.filter((r) => r.scene === scene).every((r) => ref && r.hashes.join() === ref.hashes.join());
    say(`${scene}: hashes ${same ? 'IDENTICAL' : 'DIFFER'} across ${results.filter((r) => r.scene === scene).length} runs`);
  }
  (window as unknown as { __j4: unknown }).__j4 = { done: true, results, ua: navigator.userAgent, hc: navigator.hardwareConcurrency };
  void fetch(`/bench-out/j4-${scenes.join('-')}-${seconds}s.json`, { method: 'POST', body: JSON.stringify(results) }).catch(() => {});
  say('done');
}

void main();
