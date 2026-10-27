// M0 Matter determinism spike (PRODUCTION §2 M0, SIMULATION §8). With one GPU vendor on hand, the
// stand-in proof is GPU == independent CPU reference bit for bit, plus run-to-run identity at 1M grains.

import './styles.css';
import { MatterCpu, SCENE, checksumHex, initialState, type MatterState } from '@knockon/matter/spike'; // M0 spike, kept as is (M4: MX)
import { MatterGpu, matterLimits } from '@knockon/matter/spike/gpu';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = q.get(k);
  return v === null ? d : Number(v);
};
const SMALL_N = num('n', 16384);
const SMALL_TICKS = num('ticks', 600);
const SMALL_EVERY = 10;
const SCALE_N = num('scaleN', 1_000_000);
const SCALE_TICKS = num('scaleTicks', 30);
const BIG_N = num('bigN', 1_000_000);
const BIG_TICKS = num('bigTicks', 10_000);
const BIG_EVERY = 100;
const RUN_BIG = q.get('big') !== '0';

const rows = document.getElementById('rows')!;
const progress = document.getElementById('progress')!;
const summary = document.getElementById('summary')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

interface Check { label: string; ok: boolean; detail: string }
const checks: Check[] = [];
const report: Record<string, unknown> = { done: false, ua: navigator.userAgent, checks };
(window as unknown as { __matter: unknown }).__matter = report;

function row(label: string, ok: boolean, detail: string): void {
  checks.push({ label, ok, detail });
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<div class="${ok ? 'ok' : 'bad'}">${ok ? '●' : '✕'}</div><div><b></b></div><div class="detail"></div>`;
  d.querySelector('b')!.textContent = label;
  d.querySelector('.detail')!.textContent = detail;
  rows.appendChild(d);
}

function info(label: string, detail: string): void {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = '<div class="meh">○</div><div><b></b></div><div class="detail"></div>';
  d.querySelector('b')!.textContent = label;
  d.querySelector('.detail')!.textContent = detail;
  rows.appendChild(d);
}

// MessageChannel yields aren't throttled like timers in a hidden tab.
const channel = new MessageChannel();
const yieldTask = (): Promise<void> => new Promise((resolve) => {
  channel.port1.onmessage = (): void => resolve();
  channel.port2.postMessage(0);
});

const fmt = (n: number): string => n.toLocaleString('en-US');

function sampleHex(raw: Uint32Array): string[] {
  const out: string[] = [];
  for (let k = 0; k + 4 <= raw.length; k += 4) out.push(checksumHex(raw.subarray(k, k + 4)));
  return out;
}

function sameState(a: MatterState, b: MatterState): number {
  // Returns the first differing grain, or -1.
  for (let i = 0; i < a.n * 3; i++) {
    if (a.pos[i] !== b.pos[i] || a.vel[i] !== b.vel[i]) return (i / 3) | 0;
  }
  return -1;
}

/** Side view (x–y) on the left, top view (x–z) on the right, log density. */
function draw(st: MatterState, caption: string): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, half = w >> 1;
  const img = ctx.createImageData(w, h);
  const dens = new Uint32Array(w * h);
  const span = SCENE.halfX * 2;
  const yMax = span * (h / half);
  for (let i = 0; i < st.n; i++) {
    const x = st.pos[i * 3]!, y = st.pos[i * 3 + 1]!, z = st.pos[i * 3 + 2]!;
    const px = Math.floor(((x + SCENE.halfX) / span) * (half - 4));
    const py = h - 1 - Math.floor((y / yMax) * h);
    if (px >= 0 && px < half && py >= 0 && py < h) dens[py * w + px]!++;
    const tz = Math.floor(((z + SCENE.halfZ) / span) * (h - 1));
    if (tz >= 0 && tz < h) dens[tz * w + half + px]!++;
  }
  let max = 1;
  for (const v of dens) if (v > max) max = v;
  const lmax = Math.log1p(max);
  for (let p = 0; p < w * h; p++) {
    const v = dens[p]!;
    if (!v) continue;
    const t = Math.log1p(v) / lmax;
    img.data[p * 4] = 255 * Math.min(1, 0.4 + t);
    img.data[p * 4 + 1] = 176 * t + 40;
    img.data[p * 4 + 2] = 32;
    img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#8A93A6';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(`${caption} · side (x–y) | top (x–z)`, 8, 16);
}

async function gpuRun(device: GPUDevice, init: MatterState, ticks: number, every: number, label: string):
Promise<{ sums: string[]; state: MatterState; ms: number }> {
  const gpu = await MatterGpu.create(device, init, Math.floor(ticks / every) + 1);
  const t0 = performance.now();
  const chunk = init.n > 200_000 ? 50 : 200;
  let done = 0;
  let inFlight: Promise<undefined> | null = null;
  // Keep one chunk queued behind the one we wait on so the GPU never idles.
  while (done < ticks) {
    const k = Math.min(chunk, ticks - done);
    gpu.step(k, every);
    done += k;
    const marker = device.queue.onSubmittedWorkDone();
    if (inFlight) await inFlight;
    inFlight = marker;
    const ms = performance.now() - t0;
    progress.textContent = `${label}: tick ${fmt(Math.max(0, done - k))} / ${fmt(ticks)} · ${(ms / Math.max(1, done - k)).toFixed(2)} ms/tick`;
  }
  if (inFlight) await inFlight;
  const ms = performance.now() - t0;
  const sums = sampleHex(await gpu.readSamples());
  const state = await gpu.readState();
  gpu.destroy();
  return { sums, state, ms };
}

async function cpuRun(init: MatterState, ticks: number, every: number, label: string): Promise<{ sums: string[]; state: MatterState; ms: number }> {
  const sim = new MatterCpu(init);
  const sums: string[] = [];
  const t0 = performance.now();
  for (let t = 1; t <= ticks; t++) {
    sim.step();
    if (t % every === 0) sums.push(checksumHex(sim.checksum()));
    if (t % 4 === 0 || init.n > 200_000) {
      progress.textContent = `${label}: tick ${fmt(t)} / ${fmt(ticks)} · ${((performance.now() - t0) / t).toFixed(1)} ms/tick`;
      await yieldTask();
    }
  }
  return { sums, state: sim.state(), ms: performance.now() - t0 };
}

function compare(label: string, a: { sums: string[]; state: MatterState }, b: { sums: string[]; state: MatterState }, every: number): boolean {
  const n = Math.min(a.sums.length, b.sums.length);
  let first = -1;
  for (let k = 0; k < n; k++) if (a.sums[k] !== b.sums[k]) { first = k; break; }
  const grain = sameState(a.state, b.state);
  const ok = first === -1 && grain === -1 && a.sums.length === b.sums.length && n > 0;
  const detail = ok
    ? `${n}/${n} checksums equal (every ${every} ticks), final pos+vel byte-identical · last ${a.sums[n - 1]}`
    : `first checksum mismatch at tick ${first === -1 ? '—' : (first + 1) * every}; first differing grain ${grain}`
      + ` · ${a.sums[Math.max(0, first)] ?? '?'} vs ${b.sums[Math.max(0, first)] ?? '?'}`;
  row(label, ok, detail);
  return ok;
}

async function main(): Promise<void> {
  if (!navigator.gpu) throw new Error('WebGPU unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice({ requiredLimits: matterLimits(adapter) });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    if (errors.length < 8) errors.push(msg);
    console.error(msg);
  });
  void device.lost.then((l) => row('Device lost', false, `${l.reason}: ${l.message}`));
  const ai = adapter.info;
  report.adapter = { vendor: ai.vendor, architecture: ai.architecture, description: ai.description };
  info('Adapter', `${ai.vendor} ${ai.architecture} ${ai.description}`.trim());

  // (a) Small run: GPU vs CPU reference, and GPU vs itself.
  const small = initialState(SMALL_N);
  const g1 = await gpuRun(device, small, SMALL_TICKS, SMALL_EVERY, `GPU ${fmt(SMALL_N)}`);
  draw(g1.state, `GPU ${fmt(SMALL_N)} grains after ${SMALL_TICKS} ticks`);
  const c1 = await cpuRun(small, SMALL_TICKS, SMALL_EVERY, `CPU ${fmt(SMALL_N)}`);
  const smallOk = compare(`GPU = CPU, ${fmt(SMALL_N)} × ${SMALL_TICKS}`, g1, c1, SMALL_EVERY);
  info('Small run timing', `GPU ${(g1.ms / SMALL_TICKS).toFixed(2)} ms/tick · CPU ${(c1.ms / SMALL_TICKS).toFixed(1)} ms/tick`);
  const g2 = await gpuRun(device, small, SMALL_TICKS, SMALL_EVERY, `GPU ${fmt(SMALL_N)} rerun`);
  const smallRepeat = compare(`GPU rerun, ${fmt(SMALL_N)} × ${SMALL_TICKS}`, g1, g2, SMALL_EVERY);
  report.small = { n: SMALL_N, ticks: SMALL_TICKS, gpu: g1.sums, cpu: c1.sums, ok: smallOk && smallRepeat, gpuMsPerTick: g1.ms / SMALL_TICKS };

  // (a') Scale check: the full 1M-grain buffers (multi-level scan, 3,907 sort blocks) vs the CPU.
  let scaleOk = true;
  if (SCALE_TICKS > 0) {
    const init = initialState(SCALE_N);
    const g = await gpuRun(device, init, SCALE_TICKS, 1, `GPU ${fmt(SCALE_N)}`);
    const c = await cpuRun(init, SCALE_TICKS, 1, `CPU ${fmt(SCALE_N)}`);
    scaleOk = compare(`GPU = CPU, ${fmt(SCALE_N)} × ${SCALE_TICKS}`, g, c, 1);
    report.scale = { n: SCALE_N, ticks: SCALE_TICKS, gpu: g.sums, cpu: c.sums, ok: scaleOk };
  }

  // (b) Big run twice: 1M × 10k, run-to-run identity.
  let bigOk = true;
  if (RUN_BIG) {
    const init = initialState(BIG_N);
    const a = await gpuRun(device, init, BIG_TICKS, BIG_EVERY, `Big run A (${fmt(BIG_N)})`);
    draw(a.state, `GPU ${fmt(BIG_N)} grains after ${fmt(BIG_TICKS)} ticks`);
    info('Big run A', `${(a.ms / BIG_TICKS).toFixed(2)} ms/tick · ${(a.ms / 1000).toFixed(1)} s · final ${a.sums[a.sums.length - 1]}`);
    const b = await gpuRun(device, init, BIG_TICKS, BIG_EVERY, `Big run B (${fmt(BIG_N)})`);
    info('Big run B', `${(b.ms / BIG_TICKS).toFixed(2)} ms/tick · ${(b.ms / 1000).toFixed(1)} s · final ${b.sums[b.sums.length - 1]}`);
    bigOk = compare(`Run A = run B, ${fmt(BIG_N)} × ${fmt(BIG_TICKS)}`, a, b, BIG_EVERY);
    report.big = {
      n: BIG_N, ticks: BIG_TICKS, every: BIG_EVERY, sumsA: a.sums, sumsB: b.sums, ok: bigOk,
      msPerTickA: a.ms / BIG_TICKS, msPerTickB: b.ms / BIG_TICKS, totalMsA: a.ms, totalMsB: b.ms,
    };
  }

  if (errors.length) row('WebGPU validation', false, errors.join(' | '));
  const allOk = smallOk && smallRepeat && scaleOk && bigOk && errors.length === 0;
  progress.textContent = '';
  summary.textContent = allOk
    ? `PASS: GPU matches the CPU reference bit for bit${RUN_BIG ? `, and ${fmt(BIG_N)} grains × ${fmt(BIG_TICKS)} ticks repeat exactly` : ''}.`
    : 'FAIL: see the rows above.';
  report.allOk = allOk;
  report.done = true;
}

main().catch((err: unknown) => {
  row('Error', false, String(err));
  summary.textContent = 'FAIL: the spike did not complete.';
  report.allOk = false;
  report.error = String(err);
  report.done = true;
});
