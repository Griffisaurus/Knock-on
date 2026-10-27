// R4 dev page (M4): Matter surfaces on synthetic buffers, the container fill pass and the M4 VFX, in the real
// renderer with the full D79 look. Dev only: open /src/gfx/matter/dev.html on R4's local Vite server (:5205).
//   ?scene=demo|water|marbles|sandstorm|fill|vfx|none   ?grains=1000000   ?tier=16   ?w=1920&h=1080
//   ?env=tinker (the Tinker Lab desk instead of the Studio)   ?cam=yaw,pitch,dist,tx,ty,tz   ?still
// window.__matter: measure(n, warm) (per-pass GPU ms, Matter on vs off interleaved), snap(name) (PNG to
// art/style-samples/m4_matter_<name>.png through the scratch server's /__save), and the live objects.

import { probe } from '../../caps.ts';
import type { V3 } from '../../math.ts';
import { EnvView } from '../environment.ts';
import { Fx } from '../fx.ts';
import { loadPartMesh } from '../glbmesh.ts';
import { InstanceData, Renderer, type SceneItem } from '../renderer.ts';
import { MatterRenderer, MATTER_LOOK, type FillItem } from './index.ts';
import { SyntheticMatter, type SyntheticScene } from './synthetic.ts';
import { MatterGpu } from '@knockon/matter/gpu';
import { gooScene, lowGravityScene, mixScene, sandstorm as sandstormScene, type MatterScene } from '../../../../../packages/matter/src/scenes.ts';
import type { MatterView, MatterViewSource } from './types.ts';

/** MX's real GPU backend (D92: on the renderer's device) running a Matter test scene: ?scene=real (Sandstorm) | realmix | realgoo | reallowg (X5). */
class RealMatter implements MatterViewSource {
  readonly be: MatterGpu;
  private tick = 0;
  private inflight = 0;
  ready = false;
  paused = false;
  constructor(device: GPUDevice, readonly scene: MatterScene) { this.be = new MatterGpu(device); }
  async start(): Promise<void> {
    await this.be.init({ capacity: this.scene.capacity, seed: this.scene.seed });
    if (this.scene.init) await this.be.restore(this.scene.init);
    this.tick = this.be.tick;
    this.ready = true;
  }
  step(): void {
    if (!this.ready || this.paused || this.inflight >= 2) return;
    this.inflight++;
    void this.be.step(this.scene.input(this.tick++)).then(() => { this.inflight--; }, () => { this.inflight--; });
  }
  view(): MatterView | null { return this.ready ? this.be.view() : null; }
  /** Runs n Matter ticks without rendering (to reach the avalanche). */
  async advance(n: number): Promise<number> {
    for (let i = 0; i < n; i++) await this.be.step(this.scene.input(this.tick++));
    return this.tick;
  }
}

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
if (q.has('clean')) document.body.classList.add('clean');

async function main(): Promise<void> {
  const caps = await probe();
  const tier = (Number(q.get('tier')) || caps.tier) as 4 | 8 | 12 | 16 | 32;
  const W = Number(q.get('w') ?? 1600), H = Number(q.get('h') ?? 900);
  const canvas = document.querySelector('canvas')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${W / dpr}px`;
  canvas.style.height = `${H / dpr}px`;
  const scene = (q.get('scene') ?? 'demo') as SyntheticScene | 'fill' | 'vfx' | 'real' | 'realmix' | 'realgoo' | 'reallowg';
  const r = new Renderer(canvas, { tier });
  await r.init();
  const fx = new Fx(r, tier === 32 ? 32 : tier);
  const matter = new MatterRenderer(r, tier);
  const env = new EnvView(r);
  const envId = q.get('env') ?? 'studio';
  // one at a time: parallel texture-set loads race in look/textures.ts (reported in M4_NOTES_R4)
  for (const t of ['marble', ...(scene === 'demo' ? ['scoop'] : []), ...(scene === 'fill' ? ['fishbowl', 'jitterjuice', 'grit_hopper', 'hourglass', 'tank', 'sprinkle_can', 'marble_hopper', 'goo_vat'] : [])]) await loadPartMesh(r, t);
  await r.loadDecalAtlas('/kit/decals_atlas.png');

    const real = scene === 'real' || scene === 'realmix' || scene === 'realgoo' || scene === 'reallowg'
    ? new RealMatter(r.device, scene === 'real' ? sandstormScene({ grains: Number(q.get('grains') ?? 1_000_000) })
      : scene === 'realgoo' ? gooScene() : scene === 'reallowg' ? lowGravityScene() : mixScene(Number(q.get('scale') ?? 4)))
    : null;
  if (real) await real.start();
  const synth = new SyntheticMatter(r.device, {
    scene: scene === 'fill' || scene === 'vfx' || real ? 'none' : scene as SyntheticScene,
    grains: Number(q.get('grains') ?? 1_000_000),
  });
  matter.source = real ?? synth;
  matter.onImpacts = (pts) => { for (const p of pts) fx.sandPuff(p, 0.6); };
  matter.forceWater = q.has('forcewater');

  // static set dressing for the look-dev scenes: an open glass basin round the water
  const overlayBase: SceneItem[] = [];
  if (scene === 'demo' || scene === 'water') {
    const cx = scene === 'water' ? 0 : 0.28, cz = 0.02, wx = 0.32, wz = 0.26, h = 0.13, t = 0.004;
    const pane = (p: V3, s: V3): void => { overlayBase.push({ pos: p, size: s, mesh: 0, color: [0.86, 0.94, 0.97], rough: 0.05, glass: true }); };
    pane([cx, h / 2, cz - wz / 2], [wx, h, t]); pane([cx, h / 2, cz + wz / 2], [wx, h, t]);
    pane([cx - wx / 2, h / 2, cz], [t, h, wz]); pane([cx + wx / 2, h / 2, cz], [t, h, wz]);
    overlayBase.push({ pos: [cx, 0.006, cz], size: [wx + 0.02, 0.012, wz + 0.02], mesh: 0, color: [0.08, 0.09, 0.11], rough: 0.6, bevel: true });
  }
  // a few parts for scale (build mode, static)
  const parts: SceneItem[] = [];
  const put = (type: string, pos: V3, rot: readonly [number, number, number, number] = [0, 0, 0, 1]): void => {
    for (const suffix of ['', ':glass']) if (r.lib.has(type + suffix)) parts.push({ pos, rot, size: [1, 1, 1], mesh: r.lib.id(type + suffix), color: [1, 1, 1] });
  };
  if (scene === 'demo') put('scoop', [0.05, 0, -0.25]);
  // fill scene: the M4 containers (built-in cavities until E4a's art) + FISHBOWL / JITTERJUICE (art shells)
  const FILL_ROW: { type: string; x: number; profile?: 'flat' | 'crater' | 'pile' }[] = [
    { type: 'grit_hopper', x: -0.75, profile: 'crater' }, { type: 'hourglass', x: -0.45 }, { type: 'tank', x: -0.2 },
    { type: 'sprinkle_can', x: 0.12 }, { type: 'marble_hopper', x: 0.42 }, { type: 'fishbowl', x: 0.72 }, { type: 'jitterjuice', x: 0.95 },
    { type: 'goo_vat', x: 1.25 }, // X5 (M5)
  ];
  if (scene === 'fill') for (const f of FILL_ROW) put(f.type, [f.x, f.type === 'jitterjuice' ? 0.05 : 0, 0]);
  const opaque = parts.filter((it) => !r.lib.meshes[it.mesh]!.glass);
  const sceneData = new InstanceData(opaque.length);
  sceneData.reset(opaque.length);
  opaque.forEach((it, i) => sceneData.set(i, it));
  r.setScene(sceneData);
  overlayBase.push(...parts.filter((it) => r.lib.meshes[it.mesh]!.glass).map((it) => ({ ...it, glass: true })));

  // camera: orbit
  const cam0 = (q.get('cam') ?? (scene === 'sandstorm' ? '35,32,4.2,0,0,0' : scene === 'real' ? '25,22,3.4,-0.1,0.45,0' : scene === 'realmix' || scene === 'realgoo' || scene === 'reallowg' ? '30,35,0.6,0,0.05,0' : scene === 'fill' ? '0,14,1.6,0.1,0.14,0' : scene === 'vfx' ? '15,22,1.3,0,0.12,0' : '25,26,1.25,0,0.05,0.02')).split(',').map(Number);
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

  // vfx scene: ARC TOWER-style strikes onto a steel post, splashes, egg splats and sand puffs on a loop
  let vfxNext = 0, vfxStep = 0;
  const vfxTick = (now: number): void => {
    // continuous discharge from the tower tip to the post while the step is an arc step
    if (vfxStep % 4 === 0) fx.arc([-0.3, 0.42, 0], [0.05, 0.16, 0.02], 0.05, 1);
    if (now < vfxNext) return;
    vfxNext = now + 1100;
    vfxStep++;
    if (vfxStep % 4 === 1) fx.splash([0.3, 0.0, 0.15], 3);
    if (vfxStep % 4 === 2) fx.eggSplat([-0.1, 0.02, 0.2], 0);
    if (vfxStep % 4 === 3) fx.sandPuff([0.25, 0.01, -0.15], 1.2);
  };
  if (real && scene === 'real') {
    // the Sandstorm valley's static proxies (packages/matter scenes.ts): the 22° slope, the boulder; walls as glass
    const a = (-22 * Math.PI) / 360, L = 2.3, xm = 0.6 - (L / 2) * Math.cos((22 * Math.PI) / 180);
    const ym = (0.6 - xm) * Math.tan((22 * Math.PI) / 180);
    overlayBase.push({ pos: [xm - 0.01 * Math.sin(-2 * a), ym - 0.01 * Math.cos(2 * a), 0], rot: [0, 0, Math.sin(a), Math.cos(a)], size: [L, 0.02, 0.64], mesh: 0, color: [0.55, 0.42, 0.3], rough: 0.8 });
    overlayBase.push({ pos: [0.15, (0.6 - 0.15) * Math.tan((22 * Math.PI) / 180) + 0.02, -0.14], size: [0.14, 0.14, 0.14], mesh: 1, color: [0.45, 0.45, 0.47], rough: 0.7 });
    for (const z of [0.335, -0.335]) overlayBase.push({ pos: [0.45, 0.4, z], size: [3.8, 0.8, 0.01], mesh: 0, color: [0.86, 0.94, 0.97], rough: 0.05, glass: true });
  }
  if (scene === 'vfx') {
    overlayBase.push({ pos: [-0.3, 0.2, 0], size: [0.04, 0.4, 0.04], mesh: 2, color: [0.3, 0.32, 0.36], metal: 1, rough: 0.3 });
    overlayBase.push({ pos: [-0.3, 0.42, 0], size: [0.05, 0.05, 0.05], mesh: 1, color: [0.8, 0.8, 0.85], metal: 1, rough: 0.2 });
    overlayBase.push({ pos: [0.05, 0.08, 0.02], size: [0.03, 0.16, 0.03], mesh: 2, color: [0.5, 0.52, 0.55], metal: 1, rough: 0.35 });
  }
  let fills: FillItem[] = [];
  let autoFill = true;
  let frames = 0;
  let measuring = false;
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    synth.step();
    real?.step();
    const overlay: SceneItem[] = [...overlayBase];
    const envOn = envId !== 'studio' && env.items({ environment: envId, preset: 'desk' }, overlay);
    r.drawFloor = !envOn;
    if (scene === 'fill' && autoFill) {
      const t = performance.now() / 1000;
      fills = FILL_ROW.map((f) => {
        const tilt = 0;
        const rot: [number, number, number, number] = [0, 0, Math.sin(tilt / 2), Math.cos(tilt / 2)];
        const fill = f.type === 'hourglass' ? 0.5 + 0.5 * Math.cos(t * 0.3) : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.4 + f.x * 3));
        return { type: f.type, pos: [f.x, f.type === 'jitterjuice' ? 0.05 : 0, 0] as V3, rot, fill, flowing: f.type === 'hourglass', ...(f.profile ? { profile: f.profile } : f.type === 'hourglass' ? {} : {}) };
      });
    }
    matter.setFills(fills);
    if (scene === 'vfx') vfxTick(now);
    fx.frame(dt);
    r.setOverlay(overlay);
    r.setCamera(eyeOf(), cam.t, 40);
    r.draw();
    frames++;
  };

  const api = {
    renderer: r, matter, synth, real, fx, cam, look: MATTER_LOOK, frames: () => frames,
    setFills(f: FillItem[]): void { fills = f; autoFill = false; },
    /** Mean GPU ms per timed pass over `n` frames after `warm`, paced by GPU completion. `off` disables Matter. */
    async measure(n = 120, warm = 40, off = false): Promise<Record<string, number>> {
      measuring = true;
      matter.enabled = !off;
      r.lookPass.governor.enabled = false;
      fx.governor.enabled = false;
      const acc = new Map<string, number>();
      let wall = 0;
      for (let i = 0; i < warm + n; i++) {
        const t0 = performance.now();
        frame();
        await r.device.queue.onSubmittedWorkDone();
        if (i >= warm) wall += performance.now() - t0;
        await new Promise((res) => setTimeout(res, 0));
        if (i >= warm) for (const [k, v] of r.timer.ms) acc.set(k, (acc.get(k) ?? 0) + v);
      }
      const ran = new Set((r.timer as unknown as { names: string[] }).names);
      const out: Record<string, number> = {};
      let total = 0;
      for (const [k, v] of acc) if (ran.has(k)) { out[k] = +(v / n).toFixed(3); total += v / n; }
      out.total = +total.toFixed(3);
      out.wall = +(wall / n).toFixed(3);
      matter.enabled = true;
      measuring = false;
      return out;
    },
    /**
     * Interleaved A/B (rule 7: the GPU is shared): `blocks` × (Matter on, Matter off), each state `warm` frames to let
     * the timer's EMA settle, then `n` sampled frames. Returns the per-pass medians of the block means, on and off.
     */
    async measureAB(blocks = 3, warm = 25, n = 15): Promise<{ on: Record<string, number>; off: Record<string, number>; delta: number }> {
      measuring = true;
      r.lookPass.governor.enabled = false;
      fx.governor.enabled = false;
      const runs: Record<'on' | 'off', Record<string, number>[]> = { on: [], off: [] };
      for (let b = 0; b < blocks; b++) {
        for (const st of ['on', 'off'] as const) {
          matter.enabled = st === 'on';
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
          for (const [k, v] of acc) if (ran.has(k)) { o[k] = v; total += v; }
          o.total = total;
          runs[st].push(o);
        }
      }
      matter.enabled = true;
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
    /** Renders n frames paced by GPU completion (rAF stops while the tab isn't composited). */
    async run(n = 30): Promise<number> {
      for (let i = 0; i < n; i++) { frame(); await r.device.queue.onSubmittedWorkDone(); }
      return frames;
    },
    /** Renders a frame and uploads the canvas to art/style-samples/m4_matter_<name>.png. */
    async snap(name: string): Promise<string> {
      frame();
      await r.device.queue.onSubmittedWorkDone();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return 'no blob';
      const resp = await fetch(`/__save?name=m4_matter_${encodeURIComponent(name)}.png`, { method: 'POST', body: blob });
      return `${resp.status} ${blob.size}`;
    },
    frame,
  };
  (window as unknown as { __matter: typeof api }).__matter = api;
  const loop = (): void => {
    if (!q.has('still') && !measuring) frame();
    hud.textContent = `scene ${scene} · tier ${tier} · ${canvas.width}×${canvas.height} · grains ${synth.count} (sand ${synth.counts.sand}, water ${synth.counts.water}, marble ${synth.counts.marble})
lists point ${matter.counts[0]} far ${matter.counts[1]} near ${matter.counts[2]} mesh ${matter.counts[3]} water ${matter.counts[4]} shadow ${matter.counts[5]} + ${matter.counts[6]} pt\n`
      + [...r.timer.ms].map(([k, v]) => `${k.padEnd(20)} ${v.toFixed(3)} ms`).join('\n');
    requestAnimationFrame(loop);
  };
  frame();
  loop();
}

main().catch((e) => { hud.textContent = `error: ${e instanceof Error ? e.stack : String(e)}`; console.error(e); });
