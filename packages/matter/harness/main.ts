// MX Matter harness: CPU = GPU proof, GPU perf, and the Sandstorm run the vendor matrix drives over CDP.
// Results are on window.__mx ({ done, ok, rows, result }).

import { MatterCpu, checksumHex, type MatterStepOut } from '../src/index.ts';
import { ballisticScene, gooBox, gooScene, lowGravityScene, mixScene, poolScene, sandBox, sandstorm, type MatterScene } from '../src/scenes.ts';
import { prepareTick } from '../src/prep.ts';
import { decodeMatr } from '../src/payload.ts';
import { MatterGpu } from '../gpu/index.ts';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'proof';
const num = (k: string, d: number): number => (q.get(k) === null ? d : Number(q.get(k)));

const rowsEl = document.getElementById('rows')!;
const progress = document.getElementById('progress')!;
const summary = document.getElementById('summary')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

interface Row { label: string; ok: boolean | null; detail: string }
const rows: Row[] = [];
const report: { done: boolean; ok: boolean; mode: string; rows: Row[]; adapter?: unknown; result?: unknown; error?: string } = { done: false, ok: false, mode, rows };
(window as unknown as { __mx: unknown }).__mx = report;

function row(label: string, ok: boolean | null, detail: string): void {
  rows.push({ label, ok, detail });
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<div class="${ok === null ? 'meh' : ok ? 'ok' : 'bad'}">${ok === null ? '○' : ok ? '●' : '✕'}</div><div><b></b></div><div class="detail"></div>`;
  d.querySelector('b')!.textContent = label;
  d.querySelector('.detail')!.textContent = detail;
  rowsEl.appendChild(d);
}

const channel = new MessageChannel();
const yieldTask = (): Promise<void> => new Promise((r) => { channel.port1.onmessage = (): void => r(); channel.port2.postMessage(0); });
const fmt = (n: number): string => n.toLocaleString('en-US');

function sig(o: MatterStepOut): string {
  const imp = o.impulses.map((i) => `${i.id}:${[...i.lin].join(',')}/${[...i.ang].join(',')}`).join(' ');
  const abs = o.absorbed.map((a) => `${a.id}:${[...a.counts].join(',')}`).join(' ');
  const near = (o.near ?? []).map((q) => `${q.id}:${q.count}@${[...q.centroid].join(',')}`).join(' ');
  const sf = o.surface;
  const surf = sf ? `${sf.x0},${sf.z0},${sf.cell},${sf.nx},${sf.nz}:${[...sf.count].join(',')}|${[...sf.top].join(',')}|${[...sf.bottom].join(',')}|${[...sf.vel].join(',')}` : '';
  return `${checksumHex(o.checksum)} c=${[...o.counts].join(',')} b=${[...(o.bounds ?? [])].join(',')} a=[${abs}] i=[${imp}] q=[${near}] s=[${surf}]`;
}

/** Side view (x–y) density of a MATR payload. */
function draw(bytes: Uint8Array, caption: string, xr: [number, number], yr: [number, number]): void {
  const s = decodeMatr(bytes);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const img = ctx.createImageData(w, h);
  const dens = new Uint32Array(w * h);
  for (let i = 0; i < s.count; i++) {
    const px = Math.floor(((s.pos[i * 3]! - xr[0]) / (xr[1] - xr[0])) * w);
    const py = h - 1 - Math.floor(((s.pos[i * 3 + 1]! - yr[0]) / (yr[1] - yr[0])) * h);
    if (px >= 0 && px < w && py >= 0 && py < h) dens[py * w + px]!++;
  }
  let max = 1;
  for (const v of dens) if (v > max) max = v;
  const lmax = Math.log1p(max);
  for (let p = 0; p < w * h; p++) {
    const v = dens[p]!;
    if (!v) continue;
    const t = Math.log1p(v) / lmax;
    img.data[p * 4] = 255 * Math.min(1, 0.4 + t); img.data[p * 4 + 1] = 176 * t + 40; img.data[p * 4 + 2] = 40; img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#8A93A6';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(caption, 8, 16);
}

async function getDevice(): Promise<{ device: GPUDevice; info: Record<string, unknown> }> {
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const ai = adapter.info;
  const wantTs = q.get('profile') === '1' && adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: wantTs ? ['timestamp-query'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const info = {
    vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description,
    fallback: (ai as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? false,
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    ua: navigator.userAgent,
  };
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error(msg);
    row('WebGPU error', false, msg.slice(0, 400));
  });
  void device.lost.then((l) => row('Device lost', false, `${l.reason}: ${l.message}`));
  report.adapter = info;
  row('Adapter', null, `${ai.vendor} · ${ai.architecture} · ${ai.description}${info.fallback ? ' (fallback)' : ''}`);
  return { device, info };
}

/** Run a scene on GPU and CPU side by side for `ticks`, comparing every output each tick. */
async function compareScene(device: GPUDevice, sc: MatterScene, ticks: number, snapAt = 0): Promise<boolean> {
  const cpu = new MatterCpu();
  const gpu = new MatterGpu(device);
  cpu.initSync({ capacity: sc.capacity, seed: sc.seed });
  await gpu.init({ capacity: sc.capacity, seed: sc.seed });
  if (sc.init) { cpu.restoreSync(sc.init); await gpu.restore(sc.init); }
  let first = -1;
  let detail = '';
  let snapOk = true;
  let snapBytes: Uint8Array | null = null;
  const tc0 = performance.now();
  let gpuMs = 0, cpuMs = 0;
  for (let t = 1; t <= ticks; t++) {
    const input = sc.input(t);
    const g0 = performance.now();
    const go = await gpu.step(input);
    gpuMs += performance.now() - g0;
    const c0 = performance.now();
    const co = cpu.stepSync(input);
    cpuMs += performance.now() - c0;
    const a = sig(go), b = sig(co);
    if (a !== b && first < 0) { first = t; detail = `GPU ${a.slice(0, 300)} | CPU ${b.slice(0, 300)}`; }
    if (snapAt && t === snapAt) {
      const [gs, cs] = [await gpu.snapshot(), cpu.snapshotSync()];
      snapOk = gs.length === cs.length && gs.every((v, i) => v === cs[i]);
      snapBytes = gs;
    }
    if (t % 10 === 0) { progress.textContent = `${sc.name}: tick ${t}/${ticks} · ${checksumHex(co.checksum)} · n=${[...co.counts].join('/')}`; await yieldTask(); }
    if (first > 0 && t > first + 2) break;
  }
  const ok = first < 0;
  const final = await gpu.snapshot();
  const finalCpu = cpu.snapshotSync();
  const bytesOk = final.length === finalCpu.length && final.every((v, i) => v === finalCpu[i]);
  row(`GPU = CPU · ${sc.name} × ${ticks}`, ok && bytesOk && snapOk,
    ok ? `every tick: checksum, counts, bounds, absorbed, impulses, queries, surface map equal · final MATR ${bytesOk ? 'byte-identical' : 'DIFFERS'} (${fmt(final.length)} B)${snapAt ? ` · snapshot@${snapAt} ${snapOk ? 'identical' : 'DIFFERS'}` : ''} · GPU ${(gpuMs / ticks).toFixed(2)} ms/tick (with readback), CPU ${(cpuMs / ticks).toFixed(1)} ms/tick`
      : `first mismatch at tick ${first}: ${detail}`);
  // restore round trip: snapshot (taken from the GPU) → fresh CPU and GPU, continue 30 ticks, compare
  if (snapBytes && ok) {
    const c2 = new MatterCpu(); c2.restoreSync(snapBytes);
    const g2 = new MatterGpu(device); await g2.restore(snapBytes);
    let rOk = true;
    for (let t = snapAt + 1; t <= snapAt + 30; t++) {
      const inp = sc.input(t);
      const [x, y] = [sig(await g2.step(inp)), sig(c2.stepSync(inp))];
      if (x !== y) { rOk = false; break; }
    }
    g2.destroy();
    row(`Restore round trip · ${sc.name}`, rOk, `GPU snapshot@${snapAt} restored into a fresh CPU and GPU backend: 30 ticks equal = ${rOk}`);
  }
  void tc0;
  gpu.destroy();
  return ok && bytesOk && snapOk;
}

async function proof(device: GPUDevice): Promise<boolean> {
  let all = true;
  all = (await compareScene(device, ballisticScene(), 40)) && all;
  all = (await compareScene(device, mixScene(1), num('ticks', 300), 150)) && all;
  all = (await compareScene(device, poolScene(), num('poolTicks', 240), 120)) && all;
  // M5 (X5): goo (kind 3) and D104 gravity + zones
  all = (await compareScene(device, gooScene(), num('gooTicks', 260), 130)) && all;
  all = (await compareScene(device, lowGravityScene(), num('lowgTicks', 300), 150)) && all;
  all = (await compareScene(device, sandBox(num('boxN', 20000)), num('boxTicks', 120))) && all;
  all = (await compareScene(device, sandstorm({ grains: num('stormN', 60000) }), num('stormTicks', 120), 60)) && all;
  return all;
}

/** GPU-only throughput: keep `depth` ticks in flight, report ms per Matter tick. */
async function perf(device: GPUDevice): Promise<boolean> {
  const n = num('n', 1_000_000);
  const ticks = num('ticks', 200);
  const warm = num('warm', 20);
  const sc = q.get('scene') === 'storm' ? sandstorm({ grains: n }) : q.get('scene') === 'goo' ? gooBox(n) : sandBox(n);
  const gpu = new MatterGpu(device);
  await gpu.init({ capacity: sc.capacity, seed: sc.seed });
  if (sc.init) await gpu.restore(sc.init);
  const packs = Array.from({ length: warm + ticks }, (_, i) => prepareTick(sc.input(i + 1)));
  const depth = 3;
  const inflight: Promise<MatterStepOut>[] = [];
  let t0 = 0;
  let last: MatterStepOut | null = null;
  for (let t = 0; t < warm + ticks; t++) {
    if (t === warm) { await Promise.all(inflight); inflight.length = 0; await device.queue.onSubmittedWorkDone(); t0 = performance.now(); }
    inflight.push(gpu.stepPacked(packs[t]!));
    if (inflight.length >= depth) last = await inflight.shift()!;
    if (t % 10 === 0) { progress.textContent = `perf ${sc.name}: tick ${t}`; }
  }
  for (const p of inflight) last = await p;
  const ms = (performance.now() - t0) / ticks;
  if (q.get('profile') === '1') {
    gpu.profiling = true;
    const pt = num('profTicks', 10);
    for (let t = 0; t < pt; t++) { await gpu.step(sc.input(warm + ticks + 1 + t)); await gpu.profileDone; }
    const tot = [...gpu.profile.values()].reduce((a, b) => a + b, 0);
    const lines = [...gpu.profile.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / pt / 1e6).toFixed(2)}`);
    row('GPU profile (ms per tick, timed one pass per dispatch)', null, `total ${(tot / pt / 1e6).toFixed(2)} · ${lines.join(' · ')}`);
    (report as { profile?: unknown }).profile = Object.fromEntries([...gpu.profile.entries()].map(([k, v]) => [k, v / pt / 1e6]));
  }
  row(`GPU perf · ${sc.name}`, null, `${ms.toFixed(2)} ms per Matter tick over ${ticks} ticks (after ${warm} warm-up), ${gpu.dispatchesPerTick} dispatches/tick · final ${last ? checksumHex(last.checksum) : '?'} n=${last ? [...last.counts].join('/') : '?'}`);
  report.result = { n, ticks, msPerTick: ms, scene: sc.name, dispatches: gpu.dispatchesPerTick };
  const snap = await gpu.snapshot();
  draw(snap, `${sc.name} after ${warm + ticks} ticks (side view)`, [-(1 << 17), 1 << 17], [0, 1 << 16]);
  gpu.destroy();
  return true;
}

/** Sandstorm on this adapter: per-tick checksums for the vendor matrix. */
/** Impulse digest of a tick where every dynamic proxy got zero impulse (9 proxies × 6 zeros). */
const IMP0 = ((): string => { let h = 0; for (let k = 0; k < 54; k++) h = (Math.imul(h ^ 0, 0x9e3779b1) + 0x7f4a7c15) >>> 0; return h.toString(16).padStart(8, '0'); })();

async function storm(device: GPUDevice): Promise<boolean> {
  const grains = num('grains', 4_000_000);
  const ticks = num('ticks', 300);
  const sc = sandstorm({ grains, slope: num('slope', 36) });
  const gpu = new MatterGpu(device);
  await gpu.init({ capacity: sc.capacity, seed: sc.seed });
  await gpu.restore(sc.init!);
  const sums: string[] = [];
  const counts: number[][] = [];
  const impulse: string[] = [];
  const inflight: Promise<MatterStepOut>[] = [];
  const t0 = performance.now();
  const take = (o: MatterStepOut): void => {
    sums[o.tick - 1] = checksumHex(o.checksum);
    counts[o.tick - 1] = [...o.counts];
    let h = 0;
    for (const i of o.impulses) for (const v of [...i.lin, ...i.ang]) h = (Math.imul(h ^ v, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
    impulse[o.tick - 1] = h.toString(16).padStart(8, '0');
  };
  for (let t = 1; t <= ticks; t++) {
    inflight.push(gpu.step(sc.input(t)));
    if (inflight.length >= 3) take(await inflight.shift()!);
    if (t % 5 === 0) {
      progress.textContent = `sandstorm ${fmt(grains)}: tick ${t}/${ticks} · ${((performance.now() - t0) / t).toFixed(1)} ms/tick`;
      (report as { progress?: number }).progress = t;
      await yieldTask();
    }
  }
  for (const p of inflight) take(await p);
  const ms = (performance.now() - t0) / ticks;
  report.result = { grains, ticks, sums, impulse, counts: counts[ticks - 1], msPerTick: ms };
  row(`Sandstorm ${fmt(grains)} × ${ticks}`, null, `${ms.toFixed(1)} ms/tick · tick 1 ${sums[0]} · last ${sums[ticks - 1]}`);
  {
    const snap = await gpu.snapshot();
    const st = decodeMatr(snap), init = decodeMatr(sc.init!);
    let dx = 0, flat = 0, past = 0;
    for (let i = 0; i < st.count; i++) { dx += st.pos[i * 3]!; if (st.pos[i * 3]! > 39322) flat++; if (st.pos[i * 3]! > 0) past++; }
    let x0 = 0;
    for (let i = 0; i < init.count; i++) x0 += init.pos[i * 3]!;
    const flow = { meanDxMm: ((dx / st.count - x0 / init.count) / 65.536), onFlat: flat / st.count, pastWheelAxle: past / st.count, impulseTicks: impulse.filter((h) => h !== IMP0).length };
    (report.result as Record<string, unknown>).flow = flow;
    const hx = new Map<number, number>();
    let behind = 0, below = 0;
    for (let i = 0; i < st.count; i++) {
      const b = Math.floor(st.pos[i * 3]! / 32768) / 2; hx.set(b, (hx.get(b) ?? 0) + 1);
      if (st.pos[i * 3]! < -169083) behind++;
      if (st.pos[i * 3 + 1]! < 0) below++;
    }
    row('x histogram (0.5 m bins)', null, `${[...hx.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')} · behind back wall ${behind} · below floor ${below}`);
    row('Run-out', null, `mean Δx ${flow.meanDxMm.toFixed(0)} mm · ${(100 * flow.onFlat).toFixed(1)} % past the slope foot (x > 0.6 m) · ${(100 * flow.pastWheelAxle).toFixed(1)} % past the wheel axle (x > 0) · wheel impulses non-zero on ${flow.impulseTicks}/${ticks} ticks`);
  }
  if (q.get('draw') !== '0') {
    const snap = await gpu.snapshot();
    draw(snap, `Sandstorm after ${ticks} ticks (side view x −2.6…2.3 m, y 0…2.2 m)`, [-170394, 150733], [0, 144179]);
  }
  gpu.destroy();
  return true;
}

/** A/B timing of kernel variants on one device, interleaved, min of `reps`. Variants are source rewrites of 'sand'. */
async function variants(device: GPUDevice): Promise<boolean> {
  const { MATTER_WGSL } = await import('../src/wgsl.ts');
  const n = num('n', 1_000_000), ticks = num('ticks', 20), reps = num('reps', 3);
  const base = MATTER_WGSL.sand;
  const V: Record<string, string> = {
    base,
    nocontact: base.replace(/own \+= contact\(s, t, 0u, 0u, q, d2, dS, disp\(t\)\);/, 'own += q;'),
    nofric: base.replace('if (mus > 0) {', 'if (mus > 100000) {'),
    wg128: base.replace(/@workgroup_size\(256\)/, '@workgroup_size(128)'),
    wg64: base.replace(/@workgroup_size\(256\)/, '@workgroup_size(64)'),
  };
  const names = (q.get('v') ?? Object.keys(V).join(',')).split(',');
  const sc = sandBox(n);
  const best: Record<string, number> = {};
  for (let r = 0; r < reps; r++) {
    for (const name of names) {
      const src = V[name]!;
      const wg = /@workgroup_size\((\d+)\)/.exec(src.slice(src.indexOf('@compute')))![1];
      const gpu = new MatterGpu(device, { wgsl: { sand: src } });
      await gpu.init({ capacity: sc.capacity, seed: sc.seed });
      await gpu.restore(sc.init!);
      if (wg !== '256') throw new Error('variant workgroup sizes need host support');
      gpu.profiling = true;
      for (let t = 1; t <= ticks; t++) { await gpu.step(sc.input(t)); await gpu.profileDone; }
      const ms = (gpu.profile.get('sand') ?? 0) / ticks / 1e6;
      best[name] = Math.min(best[name] ?? Infinity, ms);
      gpu.destroy();
      progress.textContent = `variants rep ${r}: ${name} ${ms.toFixed(2)} ms`;
      await yieldTask();
    }
  }
  row(`sand kernel variants (${fmt(n)} box, ms per tick = 12 dispatches, min of ${reps})`, null, names.map((k) => `${k} ${best[k]!.toFixed(2)}`).join(' · '));
  report.result = best;
  return true;
}

/** Compile every kernel separately and report failures (D3D11's FXC rejects some WGSL patterns). */
async function compileAll(device: GPUDevice): Promise<boolean> {
  const { MATTER_WGSL } = await import('../src/wgsl.ts');
  let ok = true;
  for (const [name, code] of Object.entries(MATTER_WGSL)) {
    try {
      const module = device.createShaderModule({ code });
      await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    } catch (e) { ok = false; row(`compile ${name}`, false, String((e as Error).message ?? e).slice(0, 300)); }
  }
  row('compile all kernels', ok, `${Object.keys(MATTER_WGSL).length} kernels`);
  return ok;
}

async function main(): Promise<void> {
  const { device } = await getDevice();
  let ok = false;
  if (mode === 'proof') ok = await proof(device);
  else if (mode === 'perf') ok = await perf(device);
  else if (mode === 'sandstorm') ok = await storm(device);
  else if (mode === 'variants') ok = await variants(device);
  else if (mode === 'compile') ok = await compileAll(device);
  else if (mode === 'm5') {
    ok = (await compareScene(device, gooScene(), num('gooTicks', 260), 130)) && (await compareScene(device, lowGravityScene(), num('lowgTicks', 300), 150));
  }
  else throw new Error(`unknown mode ${mode}`);
  report.ok = ok && !rows.some((r) => r.ok === false);
  summary.textContent = report.ok ? `PASS (${mode})` : `FAIL (${mode})`;
  progress.textContent = '';
  report.done = true;
}

main().catch((e: unknown) => {
  row('Error', false, String((e as Error)?.stack ?? e));
  report.error = String(e);
  report.done = true;
  summary.textContent = 'FAIL';
});
