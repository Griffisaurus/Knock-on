// R5 dev page (M5): the vfx.md §7 Future Tech effects and the M4 render polish, in the real renderer with the full
// D79 look. Dev only: open /src/gfx/future/dev.html on R5's local Vite server (:5304).
//   ?scene=scale|m5|dusty|gutter|toast   ?tier=16   ?w=1600&h=900   ?env=tinker   ?cam=yaw,pitch,dist,tx,ty,tz   ?still
// window.__r5: run(n), measure(n, warm), measureAB(...), snap(name) (PNG to art/style-samples/<name>.png through the
// scratch server's /__save), and the live objects.

import { probe } from '../../caps.ts';
import type { V3 } from '../../math.ts';
import { EnvView } from '../environment.ts';
import { Fx } from '../fx.ts';
import { loadPartMesh } from '../glbmesh.ts';
import { InstanceData, Renderer, type SceneItem } from '../renderer.ts';
import { CritterView } from '../critters.ts';
import { FutureFx, type FuturePart } from './index.ts';
import { WetnessMask } from '../wetness.ts';
import { MatterRenderer } from '../matter/index.ts';
import { SyntheticMatter, type SyntheticScene } from '../matter/synthetic.ts';
import { setMatterSource } from '../matter/types.ts';
import { metresToPos, type LinkRecord, type PartRecord } from '@knockon/format';
import { GutterView } from '../gutter.ts';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
if (q.has('clean')) document.body.classList.add('clean');

type Q4 = readonly [number, number, number, number];

async function main(): Promise<void> {
  const caps = await probe();
  const tier = (Number(q.get('tier')) || caps.tier) as 4 | 8 | 12 | 16 | 32;
  const W = Number(q.get('w') ?? 1600), H = Number(q.get('h') ?? 900);
  const canvas = document.querySelector('canvas')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${W / dpr}px`;
  canvas.style.height = `${H / dpr}px`;
  const scene = q.get('scene') ?? 'scale';
  const r = new Renderer(canvas, { tier });
  await r.init();
  const fx = new Fx(r, tier === 32 ? 32 : tier);
  const env = new EnvView(r);
  const envId = q.get('env') ?? 'studio';
  await r.loadDecalAtlas('/kit/decals_atlas.png');

  const parts: SceneItem[] = [];
  const overlayBase: SceneItem[] = [];
  const hooks: ((dt: number, now: number, overlay: SceneItem[]) => void)[] = [];
  const put = async (type: string, pos: V3, scale = 1, rot: Q4 = [0, 0, 0, 1]): Promise<void> => {
    if (!r.lib.has(type)) await loadPartMesh(r, type); // one at a time (look/textures.ts race, M4_NOTES_R4)
    for (const suffix of ['', ':glass', ':arm', ':arm:glass']) if (r.lib.has(type + suffix)) parts.push({ pos, rot, size: [scale, scale, scale], mesh: r.lib.id(type + suffix), color: [1, 1, 1] });
  };

  if (scene === 'scale') {
    // M4 known limit: instances at a non-1 scale showed dark patches (E4c's report: spheres, with and without sets)
    const row = (q.get('parts') ?? 'thud,boing,pig_iron').split(',');
    const s = Number(q.get('s') ?? 2.5);
    for (let i = 0; i < row.length; i++) {
      await put(row[i]!, [(i - (row.length - 1) / 2) * 0.9, 0.12, -0.3], 1);
      await put(row[i]!, [(i - (row.length - 1) / 2) * 0.9, 0.12 * s, 0.4], s);
    }
  }

  // DUSTY's LED face (contract 6): 12 DUSTYs in a 4 × 3 grid, one icon each (?face=track plays the idle track instead)
  const crit = new CritterView(r);
  let forceIcon: number | null = null;
  let setT: (x: number) => void = () => {};
  let holdT: number | null = null;
  const critParts: PartRecord[] = [];
  if (scene === 'dusty') {
    const types = (q.get('types') ?? 'dusty').split(',');
    await crit.load(types);
    const n = Number(q.get('n') ?? (types[0] === 'dusty' ? 12 : 4));
    for (let k = 0; k < n; k++) {
      const x = ((k % 4) - 1.5) * 0.48, z = (Math.floor(k / 4) - 1) * 0.5;
      critParts.push({ id: k + 1, type: types[k % types.length]!, pos: [metresToPos(x), 0, metresToPos(z)], rot: { tag: 0 }, flags: 0 } as PartRecord);
    }
    // the anim seed is a hash of `p<id>`: map it back to the part's grid slot
    const slot = new Map<number, number>();
    for (const p of critParts) { let s = 0; for (const ch of `p${p.id}`) s = (s * 31 + ch.charCodeAt(0)) & 0xffff; slot.set(s, p.id); }
    if (q.get('face') !== 'track') crit.faceOverride = (seed) => (forceIcon ?? slot.get(seed) ?? 1);
    if (q.has('flags')) crit.debugFlags = Number(q.get('flags'));
    hooks.push((dt, _now, overlay) => {
      crit.frame(dt, critParts, { phase: 'build', bodies: [], transforms: new Float32Array(0), partIds: [], paused: false, speed: 1 }, overlay);
    });
  }

  // M5 VFX (vfx §7): every Future Tech part on a scripted timeline (flags, meters and events as the sim would send them)
  const future = new FutureFx(r, fx, tier === 32 ? 32 : tier);
  const fparts: { id: number; type: string; pos: V3; rot: Q4; props: Record<string, number> }[] = [];
  if (scene === 'm5') {
    const yaw = (deg: number): Q4 => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
    const only = q.get('only')?.split(',') ?? null;
    const add = async (type: string, pos: V3, rot: Q4 = [0, 0, 0, 1], props: Record<string, number> = {}): Promise<void> => {
      if (only && !only.includes(type)) return;
      fparts.push({ id: fparts.length + 1, type, pos, rot, props });
      if (type === 'hover_pad') return; // moves: drawn per frame below
      await put(type, pos, 1, rot);
    };
    await add('singularity', [0, 0, -0.9]);
    const side = q.get('rift') === 'side'; // both gates facing +Z side by side (the glimpse sees the floor in front of them)
    await add('rift_gate', side ? [-0.4, 0, 1.6] : [-1.05, 0, 0.25], yaw(side ? 0 : 35), { pair: 0 });
    await add('rift_gate', side ? [0.4, 0, 1.6] : [1.05, 0, 0.25], yaw(side ? 0 : -35), { pair: 0 });
    if (side) { await put('pig_iron', [0.55, 0.06, 2.0], 1); await put('marble', [0.3, 0.008, 2.1], 3); }
    await add('grav_well', [-0.45, 0, 0.75]);
    await add('tractor_beam', [0.35, 0, 1.0], yaw(180), { mode: 0, range: 1.2 });
    await add('tractor_beam', [0.85, 0, 0.9], yaw(200), { mode: 1, range: 1.5, hold: 0.7 });
    await add('hover_pad', [0.55, 0.5, -0.25]);
    await add('force_wall', [-0.45, 0, -0.25], yaw(0), { width: 0.6, height: 0.4, start: 1 });
    await add('coilgun_ring', [0.95, 0, -0.75], yaw(90));
    await add('stasis_field', [-1.0, 0, -0.75], yaw(0), { width: 0.5, height: 0.5, depth: 0.5 });
    if (!r.lib.has('hover_pad')) await loadPartMesh(r, 'hover_pad');
    // props for context: balls in the stasis volume and in front of the right gate (the glimpse sees them), a held ball
    await put('thud', [-1.0, 0.25, -0.75], 1);
    await put('boing', [1.35, 0.12, 0.75], 1);
    await put('motor', [0.75, 0, 0.75], 1);
    await put('pig_iron', [-0.35, 0.06, 0.25], 1);
    let T0 = performance.now();
    setT = (x: number): void => { T0 = performance.now() - x * 1000; nextFire = 0; nextWall = 0; nextRift = 0; };
    let nextFire = 0, nextWall = 0, nextRift = 0;
    hooks.push((dt, now, overlay) => {
      const t = holdT ?? (now - T0) / 1000;
      const flags = (on: boolean, pressed = false, armed = false): number => (on ? 1 : 0) | (pressed ? 4 : 0) | (armed ? 16 : 0) | 2;
      const cyc = t % 9;
      const fire = t > nextFire; if (fire) nextFire = t + 1.3;
      const rift = t > nextRift; if (rift) nextRift = t + 1.7;
      const stasisOn = (t % 5.5) < 4;
      const hp: V3 = [0.55, 0.5 + 0.01 * Math.sin(t * 2), -0.25];
      for (const s of ['', ':glass']) if (r.lib.has('hover_pad' + s)) overlay.push({ pos: hp, size: [1, 1, 1], mesh: r.lib.id('hover_pad' + s), color: [1, 1, 1], ...(s ? { glass: true } : {}) });
      if (t > nextWall) {
        nextWall = t + 0.8;
        future.event('Impact', 99, 'thud', [-0.45 + (Math.random() - 0.5) * 0.4, 0.1 + Math.random() * 0.25, -0.25], 2 + Math.random() * 4, null, 'force_wall');
      }
      // sparks into the stasis volume: they hang there while it's engaged
      if (Math.random() < dt * 3) fx.fountain([-1.0, 0.05, -0.75], 60, dt);
      const list: FuturePart[] = fparts.map((p) => {
        let f = 0, meter = 0;
        switch (p.type) {
          case 'singularity': f = (cyc < 6.05 ? 16 : 0) | (cyc > 0.5 && cyc < 6.05 ? 1 : 0); meter = cyc < 6 ? 1 + Math.ceil(6 - cyc) : 1; break; // A5: armed 6 s, lit once spun up, countdown
          case 'rift_gate': f = flags(true, rift); break;
          case 'coilgun_ring': f = flags(true, fire); break;
          case 'stasis_field': f = flags(stasisOn); break;
          case 'tractor_beam': f = flags(true); meter = p.props.mode === 1 ? 12 : 0; break;
          case 'hover_pad': f = flags(true); meter = 1 + Math.round(10 + 10 * Math.sin(t * 0.5)); break;
          default: f = flags(true);
        }
        return { id: p.id, type: p.type, pos: p.type === 'hover_pad' ? hp : p.pos, rot: p.rot, placed: { pos: p.type === 'hover_pad' ? [hp[0], 0, hp[2]] : p.pos, rot: p.rot }, props: p.props, flags: f, meter };
      });
      future.frame(list, { running: true, tick: Math.floor(cyc * 120), tickRate: 120, reducedMotion: q.has('rm'), reduceFlashing: true }, dt);
      fx.shock.shellsOn = !future.lensActive;
    });
  }

  // GUTTER (contract 6): the swept channel and kit with the texture set (tiling trim), raised on saddles, with a bend
  if (scene === 'gutter') {
    const gv = new GutterView(r);
    const mk = (pts: V3[]): LinkRecord => ({ id: 1, kind: 'gutter', from: null, to: null, via: [], points: pts.map((p) => p.map(metresToPos) as [number, number, number]), length: 0 } as unknown as LinkRecord);
    const link = mk([[-1.2, 0.35, 0.3], [0.2, 0.3, 0.3], [0.6, 0.25, -0.4], [1.3, 0.2, -0.4]]);
    hooks.push((_dt, _now, overlay) => { gv.items(link, overlay); });
  }

  // Matter water (contract 6): water shadows and the wetness mask, on R4's synthetic water (dev only)
  const wet = new WetnessMask(r);
  if (scene === 'water' || scene === 'demo') {
    const matter = new MatterRenderer(r, tier);
    const synth = new SyntheticMatter(r.device, { scene: scene as SyntheticScene, grains: Number(q.get('grains') ?? 200000) });
    matter.source = synth;
    setMatterSource(synth);
    hooks.push(() => { synth.step(); });
    (window as unknown as { __matter: unknown }).__matter = { matter, synth, wet };
  }

  const opaque = parts.filter((it) => !r.lib.meshes[it.mesh]!.glass);
  const sceneData = new InstanceData(opaque.length);
  sceneData.reset(opaque.length);
  opaque.forEach((it, i) => sceneData.set(i, it));
  r.setScene(sceneData);
  overlayBase.push(...parts.filter((it) => r.lib.meshes[it.mesh]!.glass).map((it) => ({ ...it, glass: true })));

  const cam0 = (q.get('cam') ?? '20,28,2.2,0,0.15,0').split(',').map(Number);
  const cam = { yaw: cam0[0]!, pitch: cam0[1]!, dist: cam0[2]!, t: [cam0[3]!, cam0[4]!, cam0[5]!] as V3 };
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.3; cam.pitch = Math.max(-5, Math.min(85, cam.pitch + (e.clientY - drag.y) * 0.3));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('wheel', (e) => { cam.dist *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false });
  const eyeOf = (): V3 => {
    const y = (cam.yaw * Math.PI) / 180, p = (cam.pitch * Math.PI) / 180;
    return [cam.t[0] + Math.sin(y) * Math.cos(p) * cam.dist, cam.t[1] + Math.sin(p) * cam.dist, cam.t[2] + Math.cos(y) * Math.cos(p) * cam.dist];
  };

  let frames = 0;
  let measuring = false;
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const overlay: SceneItem[] = [...overlayBase];
    env.players = q.has('mp') ? 2 : 1;
    const envOn = envId !== 'studio' && env.items({ environment: envId, preset: q.get('preset') ?? 'desk' }, overlay);
    r.drawFloor = !envOn;
    fx.frame(dt);
    for (const h of hooks) h(dt, now, overlay);
    r.setOverlay(overlay);
    r.setCamera(eyeOf(), cam.t, 40);
    r.draw();
    frames++;
  };

  const timed = async (n: number, warm: number): Promise<Record<string, number>> => {
    const acc = new Map<string, number>();
    for (let i = 0; i < warm + n; i++) {
      frame();
      await r.device.queue.onSubmittedWorkDone();
      await new Promise((res) => setTimeout(res, 0));
      if (i >= warm) for (const [k, v] of r.timer.ms) acc.set(k, (acc.get(k) ?? 0) + v / n);
    }
    const ran = new Set((r.timer as unknown as { names: string[] }).names);
    const o: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of acc) if (ran.has(k)) { o[k] = +v.toFixed(3); total += v; }
    o.total = +total.toFixed(3);
    return o;
  };

  const api = {
    renderer: r, fx, cam, hooks, frames: () => frames, future,
    async run(n = 30): Promise<number> { for (let i = 0; i < n; i++) { frame(); await r.device.queue.onSubmittedWorkDone(); } return frames; },
    async measure(n = 120, warm = 40): Promise<Record<string, number>> {
      measuring = true;
      r.lookPass.governor.enabled = false;
      fx.governor.enabled = false;
      const o = await timed(n, warm);
      measuring = false;
      return o;
    },
    /** Interleaved A/B (rule 7): `blocks` × (on, off) via `set(on)`; medians of the block means per pass. */
    async measureAB(set: (on: boolean) => void, blocks = 3, warm = 25, n = 15): Promise<{ on: Record<string, number>; off: Record<string, number>; delta: number }> {
      measuring = true;
      r.lookPass.governor.enabled = false;
      fx.governor.enabled = false;
      const runs: Record<'on' | 'off', Record<string, number>[]> = { on: [], off: [] };
      for (let b = 0; b < blocks; b++) for (const st of ['on', 'off'] as const) { set(st === 'on'); runs[st].push(await timed(n, warm)); }
      set(true);
      measuring = false;
      const med = (xs: number[]): number => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] ?? 0; };
      const fold = (rs: Record<string, number>[]): Record<string, number> => {
        const keys = new Set(rs.flatMap((x) => Object.keys(x)));
        const o: Record<string, number> = {};
        for (const k of keys) o[k] = +med(rs.map((x) => x[k] ?? 0)).toFixed(3);
        return o;
      };
      const on = fold(runs.on), off = fold(runs.off);
      return { on, off, delta: +((on.total ?? 0) - (off.total ?? 0)).toFixed(3) };
    },
    crit,
    setT(x: number): void { setT(x); },
    /** Holds the scripted timeline at x s (null: runs on): stable states for timings. */
    holdT(x: number | null): void { holdT = x; },
    setIcon(i: number | null): void { forceIcon = i; },
    /** A contact sheet: for each of `n` steps, `setup(i)` then 6 frames, the centre crop (cw × ch) tiled cols wide. */
    async sheet(name: string, n: number, setup: (i: number) => void, cols = 4, cw = 480, ch = 270, label?: (i: number) => string): Promise<string> {
      const rows = Math.ceil(n / cols);
      const out = document.createElement('canvas');
      out.width = cols * cw; out.height = rows * ch;
      const g = out.getContext('2d')!;
      for (let i = 0; i < n; i++) {
        setup(i);
        for (let k = 0; k < 6; k++) { frame(); await r.device.queue.onSubmittedWorkDone(); }
        g.drawImage(canvas, (canvas.width - cw) / 2, (canvas.height - ch) / 2, cw, ch, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
        if (label) { g.fillStyle = '#0b0d12cc'; g.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, 22); g.fillStyle = '#e8ebf2'; g.font = '14px ui-monospace, Consolas'; g.fillText(label(i), (i % cols) * cw + 6, Math.floor(i / cols) * ch + 16); }
      }
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
      if (!blob) return 'no blob';
      const resp = await fetch(`/__save?name=${encodeURIComponent(name)}.png`, { method: 'POST', body: blob });
      return `${resp.status} ${blob.size}`;
    },
    async snap(name: string): Promise<string> {
      frame();
      await r.device.queue.onSubmittedWorkDone();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return 'no blob';
      const resp = await fetch(`/__save?name=${encodeURIComponent(name)}.png`, { method: 'POST', body: blob });
      return `${resp.status} ${blob.size}`;
    },
    frame,
  };
  (window as unknown as { __r5: typeof api }).__r5 = api;
  const loop = (): void => {
    if (!q.has('still') && !measuring) frame();
    hud.textContent = `scene ${scene} · tier ${tier} · ${canvas.width}×${canvas.height}\n` + [...r.timer.ms].map(([k, v]) => `${k.padEnd(20)} ${v.toFixed(3)} ms`).join('\n');
    requestAnimationFrame(loop);
  };
  frame();
  loop();
}

main().catch((e) => { hud.textContent = `error: ${e instanceof Error ? e.stack : String(e)}`; console.error(e); });
