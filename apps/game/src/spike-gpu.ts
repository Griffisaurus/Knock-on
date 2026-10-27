// M0 graphics + Spectacle spike (PRODUCTION §2): GPU-driven instancing at 100k+ parts and 1M+ live
// sparks. Query params: ?n=100000&sparks=1000000&tier=16. Results on window.__gpu for automation.

import { probe } from './caps.ts';
import { Fx } from './gfx/fx.ts';
import { InstanceData, Renderer, STUDIO_DARK, STUDIO_LIGHT } from './gfx/renderer.ts';
import type { V3 } from './math.ts';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const ctl = document.getElementById('ctl')!;

const PALETTE: [number, number, number][] = [
  [1.0, 0.11, 0.024], [0.0, 0.66, 1.0], [0.95, 0.85, 0.02], [0.8, 0.77, 0.72], [0.22, 0.24, 0.29], [1.0, 0.05, 0.42], [0.27, 0.73, 0.03],
];

async function main(): Promise<void> {
  const caps = await probe();
  const tier = (Number(q.get('tier')) || caps.tier) as 4 | 8 | 12 | 16 | 32;
  const canvas = document.querySelector('canvas')!;
  const r = new Renderer(canvas, { tier });
  await r.init();
  const fx = new Fx(r, tier);
  // G3 (M3): ?taa=0.67 (upscale; 1 = native) · ?gi=sdf|gi · ?probes=0 · ?vol=0 · ?res=3840x2160 (forced output
  // size) · ?kiloton=1 (a synthetic "Kiloton" chain: 400 Bangsticks + 60 Powder Kegs over ~6 s, every 15 s)
  if (q.has('taa')) r.upscale = Number(q.get('taa')) || 0;
  if (q.get('gi') === 'sdf' || q.get('gi') === 'gi') r.gi.debug = q.get('gi') as 'sdf' | 'gi';
  if (q.get('probes') === '0') r.gi.probesOn = false;
  if (q.get('vol') === '0') fx.volumetrics = false;
  if (q.has('legacy')) fx.legacy = true; // the M2 composites only (benchmark "before")
  const res = q.get('res')?.split('x').map(Number);
  if (res && res[0] && res[1]) { canvas.style.width = `${res[0] / (window.devicePixelRatio || 1)}px`; canvas.style.height = `${res[1] / (window.devicePixelRatio || 1)}px`; }
  const kiloton = q.has('kiloton');
  const kiloEvents: { t: number; pos: V3; y: number; keg: boolean }[] = [];
  let kiloStart = -1, kiloNext = 0;
  let n = Number(q.get('n') ?? 100_000);
  let sparks = Number(q.get('sparks') ?? 1_000_000);
  let booms = q.get('booms') !== '0';
  let live = 0;

  function build(count: number): void {
    const data = new InstanceData(count);
    data.reset(count);
    const side = Math.ceil(Math.sqrt(count));
    const pitch = 0.16;
    for (let i = 0; i < count; i++) {
      const gx = i % side, gz = Math.floor(i / side);
      const x = (gx - side / 2) * pitch, z = (gz - side / 2) * pitch;
      const kind = (gx * 7 + gz * 13) % 5;
      const color = PALETTE[(gx * 3 + gz * 5) % PALETTE.length]!;
      if (kind === 0) data.set(i, { pos: [x, 0.06, z], size: [0.12, 0.12, 0.12], mesh: 1, color, rough: 0.35 });
      else if (kind === 1) data.set(i, { pos: [x, 0.05, z], size: [0.12, 0.1, 0.06], mesh: 0, color, rough: 0.55, bevel: true });
      else if (kind === 2) data.set(i, { pos: [x, 0.075, z], size: [0.03, 0.15, 0.075], mesh: 0, color: [0.8, 0.77, 0.72], rough: 0.4, bevel: true });
      else if (kind === 3) data.set(i, { pos: [x, 0.04, z], size: [0.08, 0.08, 0.08], mesh: 2, color, rough: 0.3, metal: 0.8 });
      else data.set(i, { pos: [x, 0.03, z], size: [0.1, 0.06, 0.1], mesh: 0, color, rough: 0.6, bevel: true, emissive: (gx + gz) % 11 === 0 ? 0.4 : 0 });
    }
    r.setScene(data);
    n = count;
  }
  build(n);

  const button = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    ctl.appendChild(b);
  };
  for (const c of [10_000, 100_000, 250_000, 1_000_000]) button(`${c / 1000}k parts`, () => build(c));
  for (const s of [0, 1_000_000, 4_000_000, 16_000_000]) button(`${s / 1e6}M sparks`, () => { sparks = Math.min(s, r.particles.capacity); });
  button('booms on/off', () => { booms = !booms; });
  button('Studio light/dark', () => { r.look = r.look === STUDIO_LIGHT ? STUDIO_DARK : STUDIO_LIGHT; });

  let yaw = 0.6, last = performance.now(), lastBoom = 0, frames = 0;
  const fpsWin: number[] = [];
  function frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    yaw += dt * 0.08;
    const side = Math.sqrt(n) * 0.16;
    const dist = Math.max(4, side * 0.75);
    const target: V3 = [0, 0.3, 0];
    const fixed = q.get('cam')?.split(',').map(Number); // G3: ?cam=ex,ey,ez,tx,ty,tz fixes the camera
    if (fixed && fixed.length === 6) r.setCamera([fixed[0]!, fixed[1]!, fixed[2]!], [fixed[3]!, fixed[4]!, fixed[5]!]);
    else r.setCamera([Math.sin(yaw) * dist, dist * 0.45, Math.cos(yaw) * dist], target);
    if (sparks > 0) {
      const k = 4;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + now / 3000;
        fx.fountain([Math.cos(a) * side * 0.25, 0.1, Math.sin(a) * side * 0.25], sparks / k, dt);
      }
    }
    if (kiloton) {
      // a fortress-sized ring of charges, chain-fired from one corner outward
      if (kiloStart < 0 || now - kiloStart > 15000) {
        kiloStart = now;
        kiloEvents.length = 0;
        kiloNext = 0;
        for (let i = 0; i < 460; i++) {
          const keg = i % 23 === 0 && kiloEvents.filter((e) => e.keg).length < 60;
          const a = (i / 460) * Math.PI * 2 * 3, rr = 3 + (i % 37) * 0.25;
          const pos: V3 = [Math.cos(a) * rr, keg ? 0.3 : 0.05 + (i % 5) * 0.4, Math.sin(a) * rr];
          kiloEvents.push({ t: 1000 + (i / 460) * 6000 + Math.random() * 120, pos, y: keg ? 3 : 1, keg });
        }
        kiloEvents.sort((x, y2) => x.t - y2.t);
      }
      while (kiloNext < kiloEvents.length && now - kiloStart >= kiloEvents[kiloNext]!.t) {
        const e = kiloEvents[kiloNext++]!;
        fx.boom(e.pos, e.y, e.keg ? 'powder_keg' : 'bangstick');
      }
    }
    fx.frame(dt);
    if (booms && now - lastBoom > 1500) {
      lastBoom = now;
      fx.boom([(Math.random() - 0.5) * side * 0.6, 0.15, (Math.random() - 0.5) * side * 0.6], Math.random() < 0.3 ? 3 : 1);
    }
    r.draw();
    fpsWin.push(dt * 1000);
    if (fpsWin.length > 60) fpsWin.shift();
    if (++frames % 20 === 0) void r.particles.liveCount().then((c) => { live = c; });
    const avg = fpsWin.reduce((a, b) => a + b, 0) / fpsWin.length;
    const gpu = [...r.timer.ms.entries()].map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2)} ms`).join('\n');
    hud.textContent = [
      `KNOCK-ON GPU spike · tier ${tier} GB · ${r.gpu.description}`,
      `parts        ${n.toLocaleString()} (GPU-culled, ${r.stats.buckets} buckets)`,
      `sparks live  ${live.toLocaleString()} / pool ${r.particles.capacity.toLocaleString()}`,
      `frame        ${avg.toFixed(2)} ms (${(1000 / avg).toFixed(0)} fps, rAF-bound)`,
      `GPU total    ${r.timer.total().toFixed(2)} ms ${r.timer.enabled ? '' : '(timestamp-query unavailable)'}`,
      gpu,
    ].join('\n');
    (window as unknown as { __gpu: unknown }).__gpu = {
      parts: n, sparksTarget: sparks, live, frameMs: avg, gpuMs: Object.fromEntries(r.timer.ms), gpuTotal: r.timer.total(),
      tier, capacity: r.particles.capacity, adapter: r.gpu.description, renderer: r, fx, kiloT: kiloStart < 0 ? -1 : now - kiloStart,
      setParts: build, setSparks: (s: number) => { sparks = s; }, setBooms: (b: boolean) => { booms = b; },
    };
    if (r.lostReason) { hud.textContent = `device lost: ${r.lostReason}`; return; }
    // rAF stops when the page isn't composited (background pane); a timer keeps measurements going
    let done = false;
    const go = (): void => { if (!done) { done = true; frame(); } };
    requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  frame();
}

void main().catch((e: unknown) => { hud.textContent = `error: ${String(e)}`; console.error(e); });
