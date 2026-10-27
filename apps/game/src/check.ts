// /check (LOCAL_DEVELOPMENT, UI_UX §4.1): diagnose browser, GPU and local connection before playing.

import './styles.css';
import { PROTO, decodeServer, encode } from '@knockon/net';
import { probe } from './caps.ts';

type State = 'ok' | 'bad' | 'meh';
const rows = document.getElementById('rows')!;
const summary = document.getElementById('summary')!;
let blockers = 0;

function row(state: State, label: string, detail: string, fix = ''): void {
  if (state === 'bad') blockers++;
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<div class="${state}">${state === 'ok' ? '●' : state === 'bad' ? '✕' : '▲'}</div><div><b></b></div><div><div class="detail"></div>${fix ? '<div class="fix"></div>' : ''}</div>`;
  d.querySelector('b')!.textContent = label;
  d.querySelector('.detail')!.textContent = detail;
  if (fix) d.querySelector('.fix')!.textContent = state === 'ok' ? `Note: ${fix}` : `How to fix: ${fix}`;
  rows.appendChild(d);
}

const HTTPS_FIX = 'Open the local game at http://localhost:8787. Browsers treat localhost as a secure context for development.';

async function main(): Promise<void> {
  const c = await probe();
  row(c.secureContext ? 'ok' : 'bad', 'Secure context (HTTPS)', c.secureContext ? location.origin : `${location.origin} is not secure`, c.secureContext ? '' : HTTPS_FIX);
  if (c.webgpu && c.adapter) {
    row(c.adapter.fallback ? 'meh' : 'ok', 'WebGPU', `${c.adapter.vendor} ${c.adapter.architecture} ${c.adapter.description}`.trim(),
      c.adapter.fallback ? 'A software fallback adapter is in use. Enable hardware acceleration in your browser settings.' : '');
  } else {
    row('bad', 'WebGPU', 'Not available', c.secureContext ? 'Update to Chrome/Edge 113+, Safari 26+ or Firefox 141+ (Windows). In Chrome, check chrome://gpu for "WebGPU: Hardware accelerated".' : HTTPS_FIX);
  }
  row(c.crossOriginIsolated ? 'ok' : 'bad', 'Cross-origin isolation', c.crossOriginIsolated ? 'COOP/COEP headers present' : 'Not isolated: threads and shared memory are disabled',
    c.crossOriginIsolated ? '' : 'Disable privacy extensions for this site and make sure you are loading the game from the Host Server (it sends Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy).');
  row(c.wasmThreads ? 'ok' : 'bad', 'WASM threads', c.wasmThreads ? 'Shared WebAssembly memory works' : 'Unavailable', c.wasmThreads ? '' : 'Requires cross-origin isolation (row above).');
  row(c.cores >= 8 ? 'ok' : c.cores >= 4 ? 'meh' : 'bad', 'CPU threads', `${c.cores} logical cores`, c.cores >= 8 ? '' : '8+ cores recommended for big machines (the sim slows down gracefully on fewer).');
  if (c.limits) {
    const gb = (n: number): string => `${(n / 2 ** 30).toFixed(2)} GiB`;
    row('ok', 'GPU tier (estimate)', `${c.tier} GB tier · max buffer ${gb(c.limits.maxBufferSize)} · max storage binding ${gb(c.limits.maxStorageBufferBindingSize)} · ${c.features.length} features`,
      'Browsers do not report VRAM; this is a starting estimate. You can override the GPU memory budget in Settings.');
  }
  await connection();
  summary.textContent = blockers ? `${blockers} blocking issue${blockers > 1 ? 's' : ''} found.` : 'All good. Have fun!';
}

function connection(): Promise<void> {
  return new Promise((resolve) => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { row('bad', 'Host connection', 'Could not open a WebSocket'); return finish(); }
    ws.binaryType = 'arraybuffer';
    const t0 = performance.now();
    const timer = setTimeout(() => { row('bad', 'Host connection', `No answer from ${url}`, 'Is `pnpm host` running locally?'); ws.close(); finish(); }, 5000);
    ws.onopen = () => {
      // Probe with a deliberately empty build so the host answers without taking a player slot.
      ws.send(encode(['hello', { proto: PROTO, build: '__check__', tier: 4 }]));
    };
    ws.onmessage = (ev) => {
      const [type, p] = decodeServer(new Uint8Array(ev.data as ArrayBuffer));
      const rtt = Math.round(performance.now() - t0);
      if (type === 'error') {
        const code = (p as { code: string }).code;
        row(code === 'BUILD_MISMATCH' ? 'ok' : 'meh', 'Host connection', `Reached the Host Server (${rtt} ms round trip incl. handshake)`,
          code === 'NOT_ALLOWED' ? 'This connection is not allowed by the server configuration.' : '');
      }
      clearTimeout(timer);
      ws.close();
      finish();
    };
    ws.onerror = () => { clearTimeout(timer); row('bad', 'Host connection', `Could not connect to ${url}`, 'Is `pnpm host` running locally?'); finish(); };
  });
}

void main();
