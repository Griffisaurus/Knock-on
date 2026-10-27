// The D91 vendor matrix (M4_PLAN contract 6): the Sandstorm Matter scene (4M sand grains, the WATERWHEEL valley, fixed
// seed) on every WebGPU implementation the test system has, plus the CPU reference in Node, compared tick by tick.
//
//   1. Start MX's harness server:  apps/game/node_modules/.bin/vite --config packages/matter/harness/vite.config.mjs
//   2. node tools/vendor-matrix/run.mjs [--ticks=600] [--cpuTicks=120] [--swiftTicks=30] [--grains=4000000]
//                                       [--only=d3d12,d3d11,swiftshader,cpu] [--reuse] [--report=docs/dev/M4_SANDSTORM_MATRIX.md]
//
// Each browser leg is headless Chrome with a throwaway profile (cdp.mjs) on http://localhost:5201/?mode=sandstorm.
// Results land in tools/vendor-matrix/results/<impl>.json; --reuse skips legs whose results already cover the range.
// Adding a vendor (borrowed AMD / Intel / Apple hardware) is another entry in LEGS.

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPage } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const has = (k) => process.argv.includes(`--${k}`);
const grains = Number(arg('grains', '4000000'));
const gpuTicks = Number(arg('ticks', '600'));
const cpuTicks = Number(arg('cpuTicks', '120'));
const swiftTicks = Number(arg('swiftTicks', '30'));
const only = arg('only', 'd3d12,d3d11,swiftshader,cpu').split(',');
const reportPath = resolve(root, arg('report', 'docs/dev/M4_SANDSTORM_MATRIX.md'));
const resDir = join(here, 'results');
mkdirSync(resDir, { recursive: true });
const HARNESS = arg('url', 'http://localhost:5201/');

const LEGS = [
  { impl: 'd3d12', label: 'NVIDIA D3D12 (Chrome default adapter)', flags: [], ticks: gpuTicks },
  { impl: 'd3d11', label: 'NVIDIA D3D11 (Dawn D3D11 backend)', flags: ['--use-webgpu-adapter=d3d11'], ticks: gpuTicks },
  { impl: 'swiftshader', label: 'Google SwiftShader (CPU WebGPU)', flags: ['--use-webgpu-adapter=swiftshader'], ticks: swiftTicks },
];

const log = (s) => process.stderr.write(`[matrix] ${s}\n`);
const smi = () => { try { return execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader', { encoding: 'utf8' }).trim(); } catch { return 'nvidia-smi unavailable'; } };
const load = (impl) => (existsSync(join(resDir, `${impl}.json`)) ? JSON.parse(readFileSync(join(resDir, `${impl}.json`), 'utf8')) : null);
const smiStart = smi();

async function browserLeg(leg) {
  const prev = load(leg.impl);
  if (has('reuse') && prev && prev.ticks >= leg.ticks && prev.grains === grains) { log(`${leg.impl}: reusing ${prev.ticks} ticks`); return prev; }
  log(`${leg.impl}: ${leg.ticks} ticks of ${grains} grains …`);
  const url = `${HARNESS}?mode=sandstorm&grains=${grains}&ticks=${leg.ticks}&draw=0`;
  const t0 = Date.now();
  const legSmi = smi();
  let last = 0;
  const { value } = await runPage({
    url, flags: leg.flags, timeoutMs: 24 * 3600_000, pollMs: 5000,
    onPoll: (v) => { if (v?.progress && v.progress - last >= Math.max(5, leg.ticks / 20)) { last = v.progress; log(`${leg.impl}: tick ${v.progress}/${leg.ticks}`); } },
  });
  if (!value?.ok || !value.result?.sums) throw new Error(`${leg.impl}: harness failed: ${value?.error ?? JSON.stringify(value?.rows)}`);
  const out = {
    impl: leg.impl, label: leg.label, flags: leg.flags, grains, ticks: value.result.ticks, sums: value.result.sums, impulse: value.result.impulse,
    counts: value.result.counts, msPerTick: value.result.msPerTick, flow: value.result.flow, adapter: value.adapter, wallSec: (Date.now() - t0) / 1000,
    smiStart: legSmi, smiEnd: smi(), finished: new Date().toISOString(),
  };
  writeFileSync(join(resDir, `${leg.impl}.json`), JSON.stringify(out));
  log(`${leg.impl}: done, ${out.msPerTick.toFixed(1)} ms/tick`);
  return out;
}

function cpuLeg() {
  const prev = load('cpu');
  const tag = (r) => ({ ...r, label: 'CPU reference (Node, worker threads)', adapter: { vendor: 'node', description: `${process.version}, ${r.threads} worker threads` } });
  if (has('reuse') && prev && prev.ticks >= cpuTicks && prev.grains === grains) { log(`cpu: reusing ${prev.ticks} ticks`); return Promise.resolve(tag(prev)); }
  log(`cpu: ${cpuTicks} ticks of ${grains} grains on worker threads …`);
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'cpu.ts'), `--ticks=${cpuTicks}`, `--grains=${grains}`, `--out=${join(resDir, 'cpu.json')}`], { stdio: ['ignore', 'inherit', 'pipe'] });
    let tail = '';
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-2000); const m = /tick (\d+)\/(\d+)/.exec(String(d)); if (m && Number(m[1]) % 10 === 0) log(`cpu: tick ${m[1]}/${m[2]}`); });
    p.on('exit', (code) => {
      if (code !== 0) return fail(new Error(`cpu leg exited ${code}: ${tail}`));
      ok(tag(load('cpu')));
    });
  });
}

const results = {};
const want = (i) => only.includes(i);
const cpuP = want('cpu') ? cpuLeg() : Promise.resolve(load('cpu') && { ...load('cpu'), label: 'CPU reference (Node, worker threads)', adapter: { vendor: 'node', description: `${process.version}, ${load('cpu').threads} worker threads` } });
for (const leg of LEGS.filter((l) => l.impl !== 'swiftshader' && want(l.impl))) results[leg.impl] = await browserLeg(leg);
results.cpu = await cpuP; // SwiftShader runs on the CPU too: start it after the CPU leg
if (want('swiftshader')) results.swiftshader = await browserLeg(LEGS.find((l) => l.impl === 'swiftshader'));
for (const i of ['d3d12', 'd3d11', 'swiftshader']) results[i] ??= load(i);
const smiEnd = smi();

// ---- compare ----------------------------------------------------------------------------------------------------
const impls = ['cpu', 'd3d12', 'd3d11', 'swiftshader'].filter((i) => results[i]);
const R = Object.fromEntries(impls.map((i) => [i, results[i]]));
const firstDiff = (a, b) => {
  const n = Math.min(a.ticks, b.ticks);
  for (let t = 0; t < n; t++) if (a.sums[t] !== b.sums[t] || a.impulse[t] !== b.impulse[t]) return t + 1;
  return 0;
};
const shared = Math.min(...impls.map((i) => R[i].ticks));
const pairs = [];
for (let x = 0; x < impls.length; x++) for (let y = x + 1; y < impls.length; y++) {
  const a = R[impls[x]], b = R[impls[y]];
  pairs.push({ a: impls[x], b: impls[y], range: Math.min(a.ticks, b.ticks), diff: firstDiff(a, b) });
}
const allShared = impls.every((i) => firstDiff(R[i], R[impls[0]]) === 0 || firstDiff(R[i], R[impls[0]]) > shared);
const pass = pairs.every((p) => p.diff === 0) && impls.length === 4;

const sample = [...new Set([1, 2, 5, 10, 15, 19, 20, 25, shared, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600, Math.max(...impls.map((i) => R[i].ticks))])]
  .filter((t) => t >= 1 && t <= Math.max(...impls.map((i) => R[i].ticks))).sort((a, b) => a - b);
const ref = (t) => impls.map((i) => R[i]).find((r) => r.ticks >= t);
let table = `| tick | ${impls.map((i) => R[i].impl).join(' | ')} |\n|---:|${impls.map(() => '---').join('|')}|\n`;
for (const t of sample) {
  const r0 = ref(t);
  table += `| ${t} | ${impls.map((i) => { const r = R[i]; if (r.ticks < t) return '—'; const s = r.sums[t - 1]; return `\`${s}\`${s === r0.sums[t - 1] && r.impulse[t - 1] === r0.impulse[t - 1] ? '' : ' ✕'}`; }).join(' | ')} |\n`;
}
const fmtAd = (r) => r.adapter ? [r.adapter.vendor, r.adapter.architecture, r.adapter.description, r.adapter.fallback ? 'fallback adapter' : ''].filter((x) => x).join(' · ') : '';
const chrome = R.d3d12?.adapter?.ua?.match(/Chrome\/[\d.]+/)?.[0] ?? '';
const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 16);

const md = `# M4 Sandstorm matrix (D91)

Generated by \`tools/vendor-matrix/run.mjs\` on ${nowIso} UTC. Plan: [M4_PLAN.md](M4_PLAN.md) contract 6; decision [D91](DECISIONS_2026-10-24.md).

**Verdict: ${pass ? `PASS — all ${impls.length} implementations produce identical per-tick results over the shared range (ticks 1–${shared}), and every pair agrees over its full common range.` : 'FAIL — see the first-mismatch table.'}**

## What ran

- **Scene:** Sandstorm Matter scene (\`packages/matter/src/scenes.ts\` \`sandstorm()\`): ${grains.toLocaleString('en-US')} sand grains in a 1.16 m wide, 0.1 m deep slab let go 0.2 m above a 36° valley slope; it lands at tick ≈ 15 and avalanches through a WATERWHEEL turning at 0.5 rev/s (8 scripted OBB paddles + a capsule hub, all dynamic proxies, so their impulses are compared too; the paddles first take impulses at tick 19), past a static boulder (sphere), onto a flat run-out; floor and slope are planes, the walls OBBs. Fixed seed \`0x5a4d\`, integer inputs, no emits.
- **Compared per tick:** the Matter checksum (two 32-bit hashes over every particle's index, position, velocity and material) and a digest of all 9 dynamic proxies' 64-bit-summed linear and angular impulses (\`impulse\` column in the result files). Final per-kind counts are recorded too.
- **Implementations** (${chrome}, headless, throwaway profiles; Node ${process.version}):

| Implementation | Adapter / runtime | Ticks run | Time per tick |
|---|---|---:|---:|
${impls.map((i) => `| ${R[i].label ?? i} | ${fmtAd(R[i])} | ${R[i].ticks} | ${R[i].msPerTick ? `${R[i].msPerTick.toFixed(0)} ms` : `${(R[i].secPerTick * 1000).toFixed(0)} ms`} |`).join('\n')}

- **Shared tick range:** 1–${shared} for all four (SwiftShader is a CPU implementation at ≈ ${R.swiftshader ? (R.swiftshader.msPerTick / 1000).toFixed(0) : '?'} s per tick; its range covers the release, the landing and the first wheel impacts). D3D12 vs D3D11 are compared over ${Math.min(R.d3d12?.ticks ?? 0, R.d3d11?.ticks ?? 0)} ticks and the CPU reference against both over ${Math.min(R.cpu?.ticks ?? 0, R.d3d12?.ticks ?? 0)}.
- **Contention:** other streams share this GPU and CPU, so the times above are provisional (results can't be affected). ${impls.filter((i) => R[i].smiStart).map((i) => `${i} leg: nvidia-smi \`${R[i].smiStart}\` → \`${R[i].smiEnd}\``).join('; ') || `nvidia-smi when this report was generated: \`${smiStart}\` (the legs were run earlier, see M4_NOTES_MX)`}. ${arg('note', '')}

## First mismatch per pair

| Pair | Common range | First differing tick |
|---|---:|---|
${pairs.map((p) => `| ${p.a} vs ${p.b} | 1–${p.range} | ${p.diff ? `**${p.diff}**` : 'none'} |`).join('\n')}

## Checksums (sampled ticks; ✕ = differs from the first implementation that has the tick)

${table}
Full per-tick sequences: \`tools/vendor-matrix/results/{${impls.join(',')}}.json\`.

## Notes

- The CPU reference is an independent implementation of the same integer algorithm (radix sort vs the GPU's atomic count sort + rank, gathers vs atomics, exact doubles vs 64-bit split multiplies, a sequential intake count vs a threshold search); the Node leg splits its range kernels across worker threads, which is bit-identical to the single-threaded reference (\`packages/matter/test\`).
- Real AMD / Intel / Apple GPUs stay open (D91): add an entry to \`LEGS\` in \`run.mjs\` and re-run on borrowed hardware.
${R.d3d12?.flow ? `- Run-out after ${R.d3d12.ticks} ticks (D3D12): mean Δx ${R.d3d12.flow.meanDxMm.toFixed(0)} mm, ${(100 * R.d3d12.flow.pastWheelAxle).toFixed(1)} % of the grains past the wheel axle, wheel impulses non-zero on ${R.d3d12.flow.impulseTicks} of ${R.d3d12.ticks} ticks.` : ''}
`;
writeFileSync(reportPath, md);
writeFileSync(join(resDir, 'summary.json'), JSON.stringify({ pass, shared, pairs, impls, smiStart, smiEnd }, null, 1));
log(`${pass ? 'PASS' : 'FAIL'}: shared range 1–${shared}; report ${reportPath}`);
process.exit(pass ? 0 : 1);
