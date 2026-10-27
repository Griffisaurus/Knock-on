// Browser half of the M0 Jolt determinism spike: compare against the Node golden.

import './styles.css';
import { DEFAULT_SCENARIO, loadJolt, runScenario } from '@knockon/jolt';

const NODE_GOLDEN = 'd36267ef85945df9'; // packages/jolt/test/determinism.test.ts
const rows = document.getElementById('rows')!;
const summary = document.getElementById('summary')!;
const results: { label: string; final: string; ok: boolean; ms: number; rollback: boolean | null }[] = [];

function row(label: string, final: string, ok: boolean, detail: string): void {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<div class="${ok ? 'ok' : 'bad'}">${ok ? '●' : '✕'}</div><div><b></b></div><div class="detail"></div>`;
  d.querySelector('b')!.textContent = label;
  d.querySelector('.detail')!.textContent = `${final} · ${detail}`;
  rows.appendChild(d);
}

async function run(label: string, kind: 'single' | 'multi', threads?: number): Promise<void> {
  try {
    const Jolt = await loadJolt(kind);
    const r = runScenario(Jolt, { ...DEFAULT_SCENARIO, rollbackAt: 300, ...(threads !== undefined ? { workerThreads: threads } : {}) });
    const ok = r.final === NODE_GOLDEN && r.rollbackMatches === true;
    results.push({ label, final: r.final, ok, ms: r.ms, rollback: r.rollbackMatches });
    row(label, r.final, ok, `${r.ms.toFixed(0)} ms (incl. rollback re-sim) · rollback ${r.rollbackMatches ? 'matches' : 'DIFFERS'}`);
  } catch (err) {
    results.push({ label, final: 'error', ok: false, ms: 0, rollback: null });
    row(label, 'error', false, String(err));
  }
}

async function main(): Promise<void> {
  await run('Single-threaded WASM', 'single');
  if (window.crossOriginIsolated) {
    for (const t of [1, 4, 12]) {
      await run(`Multithreaded WASM+SIMD, ${t} worker${t > 1 ? 's' : ''}`, 'multi', t);
    }
  } else {
    row('Multithreaded WASM', 'skipped', false, 'page is not cross-origin isolated');
  }
  const allOk = results.every((r) => r.ok);
  summary.textContent = allOk
    ? `PASS: all ${results.length} runs match the Node golden ${NODE_GOLDEN} bit for bit.`
    : `FAIL: some runs differ from the Node golden ${NODE_GOLDEN}.`;
  (window as unknown as { __spike: unknown }).__spike = { allOk, results, golden: NODE_GOLDEN, ua: navigator.userAgent };
}

void main();
