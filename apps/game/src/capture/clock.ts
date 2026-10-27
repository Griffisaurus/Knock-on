// C4 (M4): the offline render's frame-index clock (RENDERING §13). Every Spectacle system (renderer particles and
// hooks, fx, cameras, critters, the look pass's DOF focus and governor, flash limiter) reads `performance.now()`.
// While an offline render or photo mode runs, the main thread's `performance.now` is replaced by a virtual clock
// that advances exactly 1/fps per frame, so a frame renders the same whether it took 4 ms or 400 ms. The sim worker
// keeps its own real clock (its playback is driven by explicit ticks, run.ts captureSeek). Restored on uninstall.

const real = performance.now.bind(performance);

let virtual: number | null = null;
let depth = 0;

/** Starts virtual time at the real now (nested installs share one clock). */
export function installClock(): void {
  if (depth++ > 0) return;
  virtual = real();
  performance.now = () => virtual!;
}

/** Advances virtual time by `ms` (no-op when the clock isn't installed). */
export function advanceClock(ms: number): void {
  if (virtual !== null) virtual += ms;
}

/** Back to the real clock. Real time is never behind virtual time afterwards (rendering is slower than real time;
 * if it was faster, virtual time is kept monotonic by holding the real clock's reading until it catches up). */
export function uninstallClock(): void {
  if (depth === 0 || --depth > 0) return;
  const v = virtual!;
  virtual = null;
  performance.now = v > real() ? () => Math.max(v, real()) : real;
}

export const realNow = (): number => real();
export const clockInstalled = (): boolean => virtual !== null;
