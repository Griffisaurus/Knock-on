// Minimal headless-Chrome driver over the DevTools protocol (Node's built-in WebSocket + fetch, no npm deps).
// Launches Chrome with a throwaway profile in the OS temp dir, opens a page, polls a window global until it reports
// done, and returns it. Used by tools/vendor-matrix/run.mjs and page.mjs.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.KN_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `url` in headless Chrome with extra `flags`; poll `expr` (a JS expression returning a JSON-able value or
 * undefined) every `pollMs` until `isDone(value)`; returns { value, console }.
 */
export async function runPage({ url, flags = [], expr = 'window.__mx', isDone = (v) => v && v.done, timeoutMs = 3600_000, pollMs = 2000, onPoll, screenshot } = {}) {
  const prof = mkdtempSync(join(tmpdir(), 'kn-vm-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = [
    '--headless=new', `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-gpu-watchdog', '--disable-hang-monitor', ...flags, 'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let ws;
  let id = 0;
  const pend = new Map();
  const logs = [];
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    let ver;
    for (let i = 0; i < 100 && !ver; i++) {
      try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
    }
    if (!ver) throw new Error('Chrome did not start');
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); if (d.error) p.rej(new Error(d.error.message)); else p.res(d.result); }
      else if (d.method === 'Runtime.consoleAPICalled') logs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
      else if (d.method === 'Runtime.exceptionThrown') logs.push(`exception: ${d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text}`.slice(0, 800));
    };
    const t = await send('Target.createTarget', { url: 'about:blank' });
    const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.enable', {}, sid);
    await send('Page.navigate', { url }, sid);
    const t0 = Date.now();
    let value;
    for (;;) {
      await sleep(pollMs);
      const r = await send('Runtime.evaluate', { expression: `JSON.stringify(${expr} ?? null)`, returnByValue: true }, sid);
      value = r.result?.value ? JSON.parse(r.result.value) : undefined;
      if (onPoll) onPoll(value);
      if (isDone(value)) break;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout after ${timeoutMs} ms (last: ${JSON.stringify(value)?.slice(0, 300)})`);
    }
    if (screenshot) {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    }
    return { value, console: logs };
  } finally {
    try { ws?.close(); } catch { /* closing */ }
    proc.kill();
    await sleep(800);
    try { rmSync(prof, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
  }
}
