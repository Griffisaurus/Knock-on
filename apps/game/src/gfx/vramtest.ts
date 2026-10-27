// V4 dev page (M4): every textured part on a grid at a tier, with Fx (volumes, debris) and GI, to exercise the
// VRAM ledger and governor (vram.ts) and the BC7 texture path (look/textures.ts, ktx2.ts).
// Dev only: open /src/gfx/vramtest.html?tier=32 on a local Vite server. Switches: ?ktx2=0 (PNG / rgba8),
// ?types=a,b (parts), ?smoke (a volume every 1.5 s), ?orbit=0, ?governor=0, ?vramprobe=1|full.
// `window.__v4` exposes:
//   pressure(gb) / release()   a second GPUDevice holds `gb` GB and touches every chunk each frame (residency),
//                              the way the other processes did in M3's oversubscription stall
//   stats(seconds)             frame-time stats; timeline(): one sample per second since load
//   loss()                     simulated device loss (the renderer rebuilds itself)
//   decodeCheck(type, map)     GPU decode of a KTX2's level 0 vs the encoder's own decode (exact match expected)
//   gpuEncodeCheck(type, map)  the runtime GPU BC7 encoder's PSNR against the PNG
//   view(type) / snap(name)    close-up camera on a part; PNG of the canvas to the dev server (`/__save`)

import { ART_PARTS } from '../artlist.ts';
import { probe } from '../caps.ts';
import type { V3 } from '../math.ts';
import { Fx } from './fx.ts';
import { loadPartMesh } from './glbmesh.ts';
import { bcLayout, fetchKtx2 } from './ktx2.ts';
import { gpuBc7, TexSets, texSetsOf } from './look/textures.ts';
import { InstanceData, Renderer, type SceneItem } from './renderer.ts';
import { fmtBytes, vramGovernor, vramLedger } from './vram.ts';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
if (q.has('clean')) document.body.classList.add('clean');

interface Sample { t: number; avg: number; p99: number; max: number; over100: number; level: number; vram: number }

async function main(): Promise<void> {
  const caps = await probe();
  const tier = (Number(q.get('tier')) || caps.tier) as 4 | 8 | 12 | 16 | 32;
  const canvas = document.querySelector('canvas')!;
  // a fixed render size (?w=&h=, device pixels): the dev pane may be hidden or small
  const W = Number(q.get('w') ?? 1920), H = Number(q.get('h') ?? 1080), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${W / dpr}px`;
  canvas.style.height = `${H / dpr}px`;
  const r = new Renderer(canvas, { tier });
  await r.init();
  const fx = new Fx(r, tier);
  if (q.get('governor') === '0') vramGovernor.enabled = false;
  const want = q.get('types')?.split(',') ?? [...ART_PARTS];
  const tLoad = performance.now();
  const ok = (await Promise.all(want.map(async (t) => ((await loadPartMesh(r, t)) ? t : null)))).filter((t): t is string => !!t);
  await Promise.allSettled([...r.lookPass.tex.pending]);
  const loadMs = performance.now() - tLoad;
  await r.device.queue.onSubmittedWorkDone();
  const loadGpuMs = performance.now() - tLoad;

  // grid: one of each part, 0.7 m apart
  const cols = Math.ceil(Math.sqrt(ok.length));
  const at = new Map<string, V3>();
  const items: SceneItem[] = [];
  ok.forEach((t, i) => {
    const p: V3 = [((i % cols) - (cols - 1) / 2) * 0.7, 0, (Math.floor(i / cols) - (cols - 1) / 2) * 0.7];
    at.set(t, p);
    for (const suffix of ['', ':arm', ':piece']) {
      const name = t + suffix;
      if (r.lib.has(name)) items.push({ pos: p, size: [1, 1, 1], mesh: r.lib.id(name), color: [1, 1, 1] });
    }
  });
  const glass: SceneItem[] = [];
  ok.forEach((t) => {
    for (const suffix of [':glass', ':arm:glass', ':piece:glass']) {
      if (r.lib.has(t + suffix)) glass.push({ pos: at.get(t)!, size: [1, 1, 1], mesh: r.lib.id(t + suffix), color: [1, 1, 1], glass: true });
    }
  });
  const scene = new InstanceData(items.length);
  scene.reset(items.length);
  items.forEach((it, i) => scene.set(i, it));
  r.setScene(scene);

  // camera: orbit the grid (or a close-up)
  const R = cols * 0.7 * 0.75 + 1;
  let close: { eye: V3; target: V3 } | null = null;
  let orbit = q.get('orbit') !== '0';
  const t0 = performance.now();

  // frame stats
  const dts: { t: number; dt: number }[] = [];
  const timeline: Sample[] = [];
  let last = 0;
  const stats = (sec = 2): Omit<Sample, 't' | 'level' | 'vram'> & { n: number } => {
    const now = performance.now();
    const w = dts.filter((d) => now - d.t < sec * 1000).map((d) => d.dt).sort((a, b) => a - b);
    if (!w.length) return { avg: 0, p99: 0, max: 0, over100: 0, n: 0 };
    return {
      avg: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2), p99: +w[Math.min(w.length - 1, Math.floor(w.length * 0.99))]!.toFixed(1),
      max: +w[w.length - 1]!.toFixed(1), over100: w.filter((x) => x > 100).length, n: w.length,
    };
  };

  // VRAM pressure: a second device keeps `gb` GB resident by touching every chunk each frame
  let pdev: GPUDevice | null = null;
  let pbufs: GPUBuffer[] = [];
  let pcycle = false, pnext = 0;
  let smokeAt = 0, smokeN = 0;
  const frame = (): void => {
    const now = performance.now();
    if (last) dts.push({ t: now, dt: now - last });
    last = now;
    while (dts.length && now - dts[0]!.t > 60_000) dts.shift();
    const time = (now - t0) / 1000;
    if (close) r.setCamera(close.eye, close.target, 35);
    else {
      const a = orbit ? time * 0.15 : 0.6;
      r.setCamera([Math.sin(a) * R, R * 0.55, Math.cos(a) * R], [0, 0.1, 0], 40);
    }
    if (q.has('smoke') && now - smokeAt > 1500) {
      smokeAt = now;
      const t = ok[(smokeN++ * 7) % ok.length]!;
      const p = at.get(t)!;
      fx.volumes.inject('smoke', { pos: [p[0], 0.1, p[2]], radius: 0.25, temp: 1.6, fuel: 6, density: 0.6, vel: [0, 0.8, 0] }, 2.2, 6, { cells: 128, lift: 0.1 });
    }
    fx.frame(1 / 60);
    r.setOverlay(glass);
    r.draw();
    if (pdev && pbufs.length) {
      const enc = pdev.createCommandEncoder();
      for (const b of pbufs) enc.clearBuffer(b, 0, 4096);
      // 'cycle': one whole chunk a frame, round robin, so the pressure's working set over a second is all of it
      if (pcycle) enc.clearBuffer(pbufs[pnext++ % pbufs.length]!);
      pdev.queue.submit([enc.finish()]);
    }
  };

  const api = {
    renderer: r, fx, types: ok, governor: vramGovernor, ledger: vramLedger,
    load: { ms: Math.round(loadMs), gpuMs: Math.round(loadGpuMs), tex: { ...r.lookPass.tex.stats }, sets: r.lookPass.tex.layers, bc: r.lookPass.tex.bc, texBytes: vramLedger.bytes('textures') },
    stats, timeline: (): Sample[] => timeline,
    async pressure(gb: number, chunkMb = 1024, cycle = false): Promise<string> {
      pcycle = cycle;
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!ad) return 'no adapter';
      pdev = await ad.requestDevice({ requiredLimits: { maxBufferSize: ad.limits.maxBufferSize, maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize } });
      const chunk = Math.min(chunkMb * 2 ** 20, pdev.limits.maxBufferSize);
      const t = performance.now();
      for (let done = 0; done < gb * 2 ** 30; done += chunk) {
        const b = pdev.createBuffer({ label: 'v4.pressure', size: chunk, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const enc = pdev.createCommandEncoder();
        enc.clearBuffer(b);
        pdev.queue.submit([enc.finish()]);
        pbufs.push(b);
      }
      await pdev.queue.onSubmittedWorkDone();
      return `${pbufs.length} × ${chunk / 2 ** 20} MB in ${(performance.now() - t).toFixed(0)} ms`;
    },
    release(): void {
      for (const b of pbufs) b.destroy();
      pbufs = [];
      pdev?.destroy();
      pdev = null;
    },
    loss(): void { r.simulateDeviceLoss(); },
    orbit(on: boolean): void { orbit = on; close = null; },
    view(type: string, dist = 0.45, yawDeg = 30, pitchDeg = 20): boolean {
      const p = at.get(type);
      if (!p) return false;
      const y = (yawDeg * Math.PI) / 180, pi = (pitchDeg * Math.PI) / 180;
      const target: V3 = [p[0], p[1] + 0.08, p[2]];
      close = { target, eye: [target[0] + Math.sin(y) * Math.cos(pi) * dist, target[1] + Math.sin(pi) * dist, target[2] + Math.cos(y) * Math.cos(pi) * dist] };
      return true;
    },
    async snap(name: string): Promise<string> {
      for (let i = 0; i < 30; i++) { frame(); await r.device.queue.onSubmittedWorkDone(); } // TAA history settles
      frame();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return 'no blob';
      const resp = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      return `${resp.status} ${blob.size}`;
    },
    /** GPU decode of a KTX2 level (as bc7-rgba-unorm: raw bytes) vs the encoder's own decode (`/__scratch/ref_<type>_<map>_<level>.bin`, RGBA). */
    async decodeCheck(type: string, map: string, level = 0): Promise<Record<string, unknown>> {
      const { ktx } = await fetchKtx2(`/parts/${type}/${type}.tex.${map}.ktx2`);
      const s = Math.max(1, ktx.width >> level);
      const gpu = await decodeBc7(r.device, ktx.levels[level]!, s, s);
      const want = new Uint8Array(await (await fetch(`/__scratch/ref_${type}_${map}_${level}.bin`)).arrayBuffer());
      let diff = 0, maxd = 0;
      for (let i = 0; i < gpu.length; i++) { const d = Math.abs(gpu[i]! - want[i]!); if (d) { diff++; maxd = Math.max(maxd, d); } }
      return { type, map, level, size: s, bytes: gpu.length, refBytes: want.length, mismatched: diff, maxDiff: maxd };
    },
    /** The runtime GPU encoder (gpuBc7) on a PNG: PSNR of its level 0 against the PNG (RGB, 8-bit values). */
    async gpuEncodeCheck(type: string, map: string): Promise<Record<string, unknown>> {
      const res = await fetch(`/parts/${type}/${type}.tex.${map}.png`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const size = bmp.width;
      const tex = r.device.createTexture({ label: 'bc7.check', size: [size, size, 1], format: 'bc7-rgba-unorm', mipLevelCount: Math.log2(size) + 1, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const t = performance.now();
      gpuBc7(r.device, bmp, false, tex, 0);
      await r.device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t;
      const got = await readTexture(r.device, tex, size);
      tex.destroy();
      const want = await pixels(`/parts/${type}/${type}.tex.${map}.png`);
      let se = 0, n = 0;
      for (let i = 0; i < got.length; i += 4) for (let c = 0; c < 3; c++) { const d = got[i + c]! - want[i + c]!; se += d * d; n++; }
      return { type, map, size, psnr: +(10 * Math.log10((255 * 255) / Math.max(se / n, 1e-9))).toFixed(2), ms: +ms.toFixed(1) };
    },
    /** Loads every part's texture set into a fresh TexSets (KTX2 → BC7 arrays, or PNG → rgba8): wall time to
     * GPU-done, bytes fetched and array memory. art.json fetches are outside the timing. */
    async texBench(ktx: boolean): Promise<Record<string, unknown>> {
      const sets = (await Promise.all(ok.map(async (t) => {
        const res = await fetch(`/parts/${t}/${t}.art.json`);
        return res.ok ? texSetsOf(await res.json()).slice(0, 1).map((f) => [t, f] as const) : [];
      }))).flat();
      const prev = TexSets.ktx2;
      TexSets.ktx2 = ktx;
      const ts = new TexSets(r.device, 2048);
      TexSets.ktx2 = prev;
      await r.device.queue.onSubmittedWorkDone();
      const t = performance.now();
      await Promise.all(sets.map(([type, f]) => ts.load(type, f)));
      await r.device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t;
      const out = { ktx, bc: ts.bc, sets: ts.layers, ms: Math.round(ms), fetched: ts.stats.bytes, arrayBytes: ts.bytes, usedBytes: 0, stats: { ...ts.stats } };
      out.usedBytes = ts.classes.reduce((b, c) => b + c.bytes * (c.count / c.cap), 0);
      ts.dispose();
      for (const c of ts.classes) { c.albedo.destroy(); c.nrmOrm.destroy(); }
      ts.detail.destroy();
      vramGovernor.register((r.lookPass.tex as unknown as { knob: Parameters<typeof vramGovernor.register>[0] }).knob);
      return out;
    },
    frame,
  };
  (window as unknown as { __v4: typeof api }).__v4 = api;

  // paced by GPU completion at ≤ 60 fps, not rAF: the dev browser pane is often hidden (rAF stops), and a
  // frame's time then is submit → GPU done, which is what VRAM paging stretches
  const loop = async (): Promise<void> => {
    const ft = performance.now();
    if (!q.has('still')) { frame(); await r.device.queue.onSubmittedWorkDone(); }
    const now = performance.now();
    if (!timeline.length || now - timeline[timeline.length - 1]!.t > 1000) {
      const s = stats(1);
      timeline.push({ t: Math.round(now), avg: s.avg, p99: s.p99, max: s.max, over100: s.over100, level: vramGovernor.level, vram: vramLedger.total });
      const s2 = stats(2);
      const ev = vramGovernor.events.slice(-4).map((e) => `${((e.t - t0) / 1000).toFixed(1)}s ${e.reason}→L${e.level}${e.detail ? ` (${e.detail})` : ''}`).join(' · ');
      hud.textContent = `tier ${tier} · ${ok.length} parts · sets ${r.lookPass.tex.layers} ${r.lookPass.tex.bc ? 'BC7' : 'rgba8'} · load ${api.load.ms} ms (gpu done ${api.load.gpuMs} ms)\n` +
        `frame avg ${s2.avg} ms · p99 ${s2.p99} · max ${s2.max} · >100 ms ${s2.over100} (2 s) · pressure ${pbufs.length ? fmtBytes(pbufs.length * (pbufs[0]?.size ?? 0)) : 'none'}\n` +
        `${r.vramLine()}\n${ev}\n` + [...r.timer.ms].map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
    }
    setTimeout(() => void loop(), Math.max(0, 16.7 - (performance.now() - ft)));
  };
  void loop();
}

/** Decodes BC7 blocks on the GPU (textureLoad in a fragment shader into rgba8unorm) → RGBA bytes. */
async function decodeBc7(d: GPUDevice, data: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const l = bcLayout(w, h);
  const tex = d.createTexture({ label: 'bc7.decode', size: [l.physW, l.physH, 1], format: 'bc7-rgba-unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  d.queue.writeTexture({ texture: tex }, data, { bytesPerRow: l.bytesPerRow, rowsPerImage: l.rows }, [l.physW, l.physH, 1]);
  const full = await readTexture(d, tex, l.physW);
  tex.destroy();
  if (l.physW === w && l.physH === h) return full;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(full.subarray(y * l.physW * 4, y * l.physW * 4 + w * 4), y * w * 4);
  return out;
}

const BLIT = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(src, vec2i(p.xy), 0); }
`;

/** Level 0 of a (possibly compressed) 2D texture → RGBA8 bytes, row-major, top row first. */
async function readTexture(d: GPUDevice, tex: GPUTexture, size: number): Promise<Uint8Array> {
  const rt = d.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const mod = d.createShaderModule({ code: BLIT });
  const pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const bind = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) }] });
  const stride = Math.ceil((size * 4) / 256) * 256;
  const buf = d.createBuffer({ size: stride * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = d.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: rt.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bind);
  pass.draw(3);
  pass.end();
  enc.copyTextureToBuffer({ texture: rt }, { buffer: buf, bytesPerRow: stride }, [size, size]);
  d.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const m = new Uint8Array(buf.getMappedRange());
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) out.set(m.subarray(y * stride, y * stride + size * 4), y * size * 4);
  buf.unmap();
  buf.destroy();
  rt.destroy();
  return out;
}

/** An image's RGBA bytes (no colour conversion). */
async function pixels(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { colorSpace: 'srgb' })!;
  g.drawImage(bmp, 0, 0);
  return new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer);
}

void main().catch((e) => { hud.textContent = `failed: ${(e as Error).stack ?? e}`; console.error(e); });
