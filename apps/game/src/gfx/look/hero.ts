// D79 proof harness: the in-engine Tinker Lab hero shot from the key art's camera
// (`tools/blender/render_tinker_lab.py` view 'hero': camera (−0.45, −2.45, 1.78) → (0.08, 0.22, 1.08), 30 mm on
// a 36 mm sensor, focus 2.75 m at f/2.4), with the key art's machine placed and settled the same way.
// Dev only: open /src/gfx/look/hero.html?tier=32&w=1920&h=1080 on a local Vite server.
// `window.__hero` exposes measure() (per-pass GPU timings with features toggled) and snap() (PNG upload to
// the dev server's /__save endpoint, scratch config only).

import * as partsData from '@knockon/parts-data';
import { parseGlb, type ParsedGlb } from '@knockon/assets';
import { probe } from '../../caps.ts';
import type { V3 } from '../../math.ts';
import { CritterView } from '../critters.ts';
import { EnvView } from '../environment.ts';
import { loadPartMesh } from '../glbmesh.ts';
import { InstanceData, Renderer, type SceneItem } from '../renderer.ts';
import type { LookForce } from './index.ts';
import { fromBlender, MAT_Z } from './sets.ts';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
if (q.has('clean')) document.body.classList.add('clean');

type Q = [number, number, number, number];
const BENCH_Z = 0.9;
const Z = MAT_Z;

interface Put { key: string; type: string; loc: V3; rot?: V3; on?: string[] }

/** build_machine() of the key art script, in order (settle uses the earlier ones as supports). */
function layout(): Put[] {
  const P: Put[] = [
    { key: 'brik1', type: 'brik', loc: [-0.98, -0.02, Z + 0.1], on: ['mat'] },
    { key: 'brik2', type: 'brik', loc: [-0.98, -0.02, Z + 0.25], rot: [0, 0, 90], on: ['brik1'] },
    { key: 'brik3', type: 'brik', loc: [-0.98, -0.02, Z + 0.4], on: ['brik2'] },
    { key: 'slope', type: 'slope', loc: [-0.72, -0.02, Z + 0.3], rot: [0, 31, 0], on: ['mat', 'brik3'] },
    { key: 'thud', type: 'thud', loc: [-0.9, -0.02, Z + 0.7], rot: [0, 0, 30], on: ['slope', 'brik3'] },
    { key: 'treadway', type: 'treadway', loc: [-0.05, -0.04, Z + 0.1], on: ['mat'] },
  ];
  const xs = [0.34, 0.405, 0.465, ...[1, 2, 3, 4, 5, 6].map((k) => 0.465 + 0.05 * k)];
  const leans = [16, 7, 0, 0, 0, 0, 0, 0, 0];
  xs.forEach((x, i) => {
    const t = (x - xs[0]!) / (xs[xs.length - 1]! - xs[0]!);
    const y = -0.04 - 0.2 * t * t;
    const yaw = i ? (Math.atan2(-0.4 * t, 1) * 180) / Math.PI : 0;
    P.push({ key: `tile${i}`, type: 'topple_tile', loc: [x, y, Z + 0.2], rot: [0, leans[i]!, yaw], on: ['mat'] });
  });
  P.push(
    { key: 'button', type: 'the_button', loc: [0.86, -0.3, Z + 0.1], rot: [0, 0, 20], on: ['mat'] },
    { key: 'mains', type: 'mains', loc: [0.95, 0.24, Z + 0.1], rot: [0, 0, -25], on: ['mat'] },
    { key: 'motor', type: 'motor', loc: [0.42, 0.26, Z + 0.1], rot: [0, 0, 180], on: ['mat'] },
    { key: 'plate', type: 'ledge', loc: [-0.08, 0.36, Z + 0.4], rot: [90, 0, 0], on: ['mat'] },
    { key: 'cog_l', type: 'cog_l', loc: [-0.16, 0.274, Z + 0.24] },
    { key: 'cog_m', type: 'cog_m', loc: [0.08, 0.274, Z + 0.33] },
    { key: 'cog_s', type: 'cog_s', loc: [0.12, 0.274, Z + 0.15] },
    { key: 'gale', type: 'gale', loc: [0.62, 0.05, Z + 0.1], rot: [0, 0, -60], on: ['mat'] },
    { key: 'helio', type: 'helio', loc: [0.98, -0.02, Z + 0.62], rot: [0, 8, 0] },
    { key: 'bang', type: 'bangstick', loc: [1.04, -0.13, Z + 0.2], rot: [0, 0, 160], on: ['mat'] },
    { key: 'fulcrum', type: 'fulcrum', loc: [-0.55, -0.34, Z + 0.2], rot: [0, 0, 8], on: ['mat'] },
    { key: 'boing', type: 'boing', loc: [-0.36, -0.35, Z + 0.5], on: ['fulcrum', 'mat'] },
  );
  return P;
}

// ---- Blender → engine transforms ------------------------------------------------------------------------

/** Blender XYZ Euler (degrees, Z-up) → engine quaternion: R_e = C⁻¹ · R_b · C, C(x, y, z) = (x, −z, y). */
function quatFromBlender(rot: V3): Q {
  const h = rot.map((a) => (a * Math.PI) / 360);
  // the same rotations about the engine axes: Blender X = engine X, Blender Y = engine −Z, Blender Z = engine Y
  const qx: Q = [Math.sin(h[0]!), 0, 0, Math.cos(h[0]!)];
  const qy: Q = [0, 0, -Math.sin(h[1]!), Math.cos(h[1]!)];
  const qz: Q = [0, Math.sin(h[2]!), 0, Math.cos(h[2]!)];
  return qmul(qz, qmul(qy, qx));
}
function qmul(a: Q, b: Q): Q {
  return [a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2], a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function qrot(q: Q, v: readonly number[]): V3 {
  const tx = 2 * (q[1] * v[2]! - q[2] * v[1]!), ty = 2 * (q[2] * v[0]! - q[0] * v[2]!), tz = 2 * (q[0] * v[1]! - q[1] * v[0]!);
  return [v[0]! + q[3] * tx + (q[1] * tz - q[2] * ty), v[1]! + q[3] * ty + (q[2] * tx - q[0] * tz), v[2]! + q[3] * tz + (q[0] * ty - q[1] * tx)];
}

// ---- settle: drop each part straight down onto its supports (as the key art script does) -----------------

/** Top-surface height field (max y per 4 mm cell) of a triangle soup. */
class HeightField {
  readonly cell = 0.004;
  private readonly h = new Map<number, number>();
  addTris(pos: Float32Array, idx: ArrayLike<number>): void {
    const c = this.cell;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, d = idx[t + 2]! * 3;
      const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!, bx = pos[b]!, by = pos[b + 1]!, bz = pos[b + 2]!, dx = pos[d]!, dy = pos[d + 1]!, dz = pos[d + 2]!;
      const x0 = Math.floor(Math.min(ax, bx, dx) / c), x1 = Math.floor(Math.max(ax, bx, dx) / c);
      const z0 = Math.floor(Math.min(az, bz, dz) / c), z1 = Math.floor(Math.max(az, bz, dz) / c);
      const den = (bz - dz) * (ax - dx) + (dx - bx) * (az - dz);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const px = (ix + 0.5) * c, pz = (iz + 0.5) * c;
        let y: number;
        if (Math.abs(den) < 1e-12) y = Math.max(ay, by, dy);
        else {
          const w0 = ((bz - dz) * (px - dx) + (dx - bx) * (pz - dz)) / den, w1 = ((dz - az) * (px - dx) + (ax - dx) * (pz - dz)) / den, w2 = 1 - w0 - w1;
          if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
          y = w0 * ay + w1 * by + w2 * dy;
        }
        const k = ix * 100003 + iz;
        const o = this.h.get(k);
        if (o === undefined || y > o) this.h.set(k, y);
      }
    }
  }
  at(x: number, z: number): number | undefined { return this.h.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)); }
}

interface Placed { pos: V3; rot: Q; world: Float32Array; idx: Uint32Array }

function lod0(glb: ParsedGlb): { pos: Float32Array; idx: Uint32Array } {
  const P: number[] = [], I: number[] = [];
  for (const m of glb.meshes) {
    if (m.lod > 0) continue;
    for (const p of m.primitives) {
      const base = P.length / 3;
      for (const v of p.positions) P.push(v);
      for (const i of p.indices) I.push(base + i);
    }
  }
  return { pos: new Float32Array(P), idx: new Uint32Array(I) };
}

function transformAll(pos: Float32Array, at: V3, rot: Q): Float32Array {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const w = qrot(rot, [pos[i]!, pos[i + 1]!, pos[i + 2]!]);
    out[i] = w[0] + at[0]; out[i + 1] = w[1] + at[1]; out[i + 2] = w[2] + at[2];
  }
  return out;
}

// ---- main ----------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const caps = await probe();
  const tier = (Number(q.get('tier')) || caps.tier) as 4 | 8 | 12 | 16 | 32;
  const W = Number(q.get('w') ?? 1920), H = Number(q.get('h') ?? 1080);
  const canvas = document.querySelector('canvas')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${W / dpr}px`;
  canvas.style.height = `${H / dpr}px`;
  // ?limit16: emulate a device at WebGPU's default 16 sampled textures per stage (the look's binding budget)
  if (q.has('limit16')) {
    const req = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = function (desc?: GPUDeviceDescriptor) {
      const limits = { ...(desc?.requiredLimits ?? {}), maxSampledTexturesPerShaderStage: 16 };
      return req.call(this, { ...desc, requiredLimits: limits });
    };
  }
  const r = new Renderer(canvas, { tier });
  await r.init();
  const env = new EnvView(r);
  const critters = new CritterView(r);
  // M4 check: `?critters=biscuit,henny,dusty` lines more critters up beside MOCHI (`&clip=<name>` poses them)
  const extraCritters = (q.get('critters') ?? '').split(',').filter(Boolean);
  const puts = layout();
  const types = [...new Set(puts.map((p) => p.type))];
  hud.textContent = `loading ${types.length} part types…`;
  await Promise.all([...types.map((t) => loadPartMesh(r, t)), r.loadDecalAtlas('/kit/decals_atlas.png'), critters.load(['mochi', ...extraCritters])]);
  // the set: E3b's tinker.glb (Desk coordinates = the key art's, re-centred on the mat) or the stand-in
  env.items({ environment: 'tinker', preset: 'desk' }, []);
  for (let i = 0; i < 600 && !env.drawn('tinker'); i++) await new Promise((res) => setTimeout(res, 50));
  const built = !env.standIn('tinker');
  const shift: V3 = built ? [-0.05, 0, -0.02] : [0, 0, 0];
  const glbs = new Map<string, ParsedGlb>();
  await Promise.all(types.map(async (t) => { const res = await fetch(`/parts/${t}/${t}.glb`); if (res.ok) glbs.set(t, parseGlb(await res.arrayBuffer())); }));

  // place + settle
  const placed = new Map<string, Placed>();
  const matTop = 0; // world y of the cutting mat
  const matBox = { x0: 0.05 - 1.15 + shift[0], x1: 0.05 + 1.15 + shift[0], z0: 0.02 - 0.41 + shift[2], z1: 0.02 + 0.41 + shift[2] };
  for (const p of puts) {
    const g = glbs.get(p.type);
    if (!g) continue;
    const rot = quatFromBlender(p.rot ?? [0, 0, 0]);
    const at = fromBlender(p.loc[0], p.loc[1], p.loc[2]);
    at[0] += shift[0]; at[2] += shift[2];
    const { pos, idx } = lod0(g);
    let world = transformAll(pos, at, rot);
    if (p.on?.length) {
      const hf = new HeightField();
      for (const s of p.on) { const sp = placed.get(s); if (sp) hf.addTris(sp.world, sp.idx); }
      let drop = Infinity;
      for (let i = 0; i < world.length; i += 3) {
        const x = world[i]!, y = world[i + 1]!, z = world[i + 2]!;
        let h = hf.at(x, z);
        if (p.on.includes('mat') && x >= matBox.x0 && x <= matBox.x1 && z >= matBox.z0 && z <= matBox.z1) h = Math.max(h ?? -Infinity, matTop);
        if (h !== undefined && Number.isFinite(h)) drop = Math.min(drop, y - h);
      }
      if (Number.isFinite(drop)) { at[1] -= drop - 0.0005; world = transformAll(pos, at, rot); }
    }
    placed.set(p.key, { pos: at, rot, world, idx });
  }

  // scene instances (base + arm/piece/glass meshes at the part pose, rest state)
  const items: SceneItem[] = [];
  for (const p of puts) {
    const pl = placed.get(p.key);
    if (!pl) continue;
    for (const suffix of ['', ':arm', ':piece', ':glass', ':arm:glass', ':piece:glass']) {
      const name = p.type + suffix;
      if (!r.lib.has(name)) continue;
      items.push({ pos: pl.pos, rot: pl.rot, size: [1, 1, 1], mesh: r.lib.id(name), color: [1, 1, 1] });
    }
  }
  const glassItems = items.filter((it) => r.lib.meshes[it.mesh]!.glass);
  const opaque = items.filter((it) => !r.lib.meshes[it.mesh]!.glass);
  const scene = new InstanceData(opaque.length);
  scene.reset(opaque.length);
  opaque.forEach((it, i) => scene.set(i, it));
  r.setScene(scene);

  // the fizzing fuse (key art fuse_spark) and the balloon's string
  const extras: SceneItem[] = [...glassItems.map((it) => ({ ...it, glass: true }))];
  const bang = placed.get('bang'), bg = glbs.get('bangstick');
  let sparkAt: V3 | null = null;
  if (bang && bg) {
    let best = -1;
    for (const m of bg.meshes) for (const pr of m.primitives) {
      if (m.lod > 0 || bg.materials[pr.material]?.name !== 'kn_fuse_cord') continue;
      for (let i = 0; i < pr.positions.length; i += 3) {
        const w = qrot(bang.rot, [pr.positions[i]!, pr.positions[i + 1]!, pr.positions[i + 2]!]);
        const d = Math.hypot(w[0], w[1], w[2]);
        if (d > best) { best = d; sparkAt = [w[0] + bang.pos[0], w[1] + bang.pos[1], w[2] + bang.pos[2]]; }
      }
    }
    if (sparkAt) extras.push({ pos: sparkAt, size: [0.016, 0.016, 0.016], mesh: 1, color: [1, 0.6, 0.25], emissive: 1 });
  }
  const helio = placed.get('helio'), hg = glbs.get('helio');
  if (helio && hg) {
    let knot: V3 | null = null;
    for (const m of hg.meshes) for (const pr of m.primitives) {
      if (m.lod > 0 || !/latex/.test(hg.materials[pr.material]?.name ?? '')) continue;
      for (let i = 0; i < pr.positions.length; i += 3) {
        const w = qrot(helio.rot, [pr.positions[i]!, pr.positions[i + 1]!, pr.positions[i + 2]!]);
        const p: V3 = [w[0] + helio.pos[0], w[1] + helio.pos[1], w[2] + helio.pos[2]];
        if (!knot || p[1] < knot[1]) knot = p;
      }
    }
    const anchor = fromBlender(1.1, 0.06, MAT_Z + 0.002);
    anchor[0] += shift[0]; anchor[2] += shift[2];
    if (knot) {
      const d: V3 = [knot[0] - anchor[0], knot[1] - anchor[1], knot[2] - anchor[2]];
      const len = Math.hypot(...d);
      const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
      // rotate +Y onto u
      const ax: V3 = [u[2], 0, -u[0]];
      const s = Math.hypot(...ax), c = u[1];
      const ang = Math.atan2(s, c);
      const rq: Q = s > 1e-6 ? [ax[0] / s * Math.sin(ang / 2), 0, ax[2] / s * Math.sin(ang / 2), Math.cos(ang / 2)] : [0, 0, 0, 1];
      extras.push({ pos: [(knot[0] + anchor[0]) / 2, (knot[1] + anchor[1]) / 2, (knot[2] + anchor[2]) / 2], rot: rq, size: [0.0024, len, 0.0024], mesh: 2, color: [0.85, 0.82, 0.76], rough: 0.85 });
    }
  }

  // camera: the key art's hero view (Blender 30 mm lens, 36 mm sensor width → vertical FOV at 16:9)
  const cam = env.camera('tinker', 'desk', q.get('cam') ?? 'hero');
  const eye: V3 = cam ? [...cam.pos] : fromBlender(-0.45, -2.45, 1.78), target: V3 = cam ? [...cam.target] : fromBlender(0.08, 0.22, 1.08);
  const vfov = cam?.fovYDeg ?? (2 * Math.atan(Math.tan(Math.atan(18 / 30)) * (H / W)) * 180) / Math.PI;
  const lp = r.lookPass;
  lp.governor.enabled = q.has('governor'); // the proof frame is the full look; ?governor exercises the drop order
  // the key art's depth of field: focus 2.75 m along the view axis, f/2.4 → thin-lens CoC (photo mode)
  const fwd = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(fwd[0]!, fwd[1]!, fwd[2]!);
  lp.focusPoint = [eye[0] + (fwd[0]! / fl) * 2.75, eye[1] + (fwd[1]! / fl) * 2.75, eye[2] + (fwd[2]! / fl) * 2.75];
  // radius px at 1080p per dioptre: (F/N) · F/(f − F) · f / 2 / sensor height × 1080 = 12.5 · 30/2720 · 2.75 / 2 / 20.25 × 1080
  lp.photoCoc = q.has('tilt') ? 0 : ((12.5 * 30) / 2720) * 2750 / 2 / 20.25 * 1080 / 1000;

  const mochi = fromBlender(-1.18, -0.22, BENCH_Z);
  mochi[0] += shift[0]; mochi[2] += shift[2];
  const yaw = (70 * Math.PI) / 180;
  const all = ['mochi', ...extraCritters];
  const clipIdx = Math.max(0, ((partsData as unknown as Record<string, unknown>)['CRITTER_CLIPS'] as readonly string[] | undefined ?? []).indexOf(q.get('clip') ?? 'idle'));
  const run = {
    phase: 'running', paused: false, speed: 1, partIds: all.map((_, i) => i + 1),
    bodies: all.map((type, i) => ({ part: i + 1, type, role: 'base' })),
    transforms: new Float32Array(all.flatMap((_, i) => [mochi[0] + i * 0.42, mochi[1], mochi[2] + (i ? 0.08 : 0), 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)])),
    critters: new Uint8Array(all.flatMap((_, i) => [i ? clipIdx : 0, 0, 0, 0])),
  };

  let frames = 0;
  let measuring = false;
  const frame = (): void => {
    const overlay: SceneItem[] = [...extras];
    env.items({ environment: 'tinker', preset: 'desk' }, overlay);
    if (sparkAt) r.light(sparkAt, [3, 1.6, 0.6], 0.35);
    critters.frame(1 / 60, undefined, run, overlay);
    r.setOverlay(overlay);
    r.setCamera(eye, target, vfov);
    r.draw();
    frames++;
  };
  const api = {
    renderer: r, env, frames: () => frames,
    /** Average GPU ms per pass over `n` frames (after `warm` frames), with feature overrides. */
    async measure(force: LookForce = {}, n = 120, warm = 60): Promise<Record<string, number>> {
      measuring = true;
      lp.force = force;
      lp.governor.enabled = false;
      const acc = new Map<string, number>();
      // paced by GPU completion, not rAF (Chrome throttles rAF to ~2 Hz when the window isn't composited)
      let wall = 0;
      for (let i = 0; i < warm + n; i++) {
        const t0 = performance.now();
        frame();
        await r.device.queue.onSubmittedWorkDone();
        if (i >= warm) wall += performance.now() - t0;
        await new Promise((res) => setTimeout(res, 0));
        if (i >= warm) for (const [k2, v] of r.timer.ms) acc.set(k2, (acc.get(k2) ?? 0) + v);
      }
      const out: Record<string, number> = {};
      let total = 0;
      // only passes that ran in the last frame (the timer keeps stale names and values)
      const ran = new Set(lastNames(r));
      for (const [k2, v] of acc) if (ran.has(k2)) { out[k2] = +(v / n).toFixed(3); total += v / n; }
      out.total = +total.toFixed(3);
      out.wall = +(wall / n).toFixed(3); // CPU submit → GPU done per frame (includes untimed passes: bloom, mask)
      measuring = false;
      return out;
    },
    /** Renders one frame and uploads the canvas as PNG to the dev server (`/__save?name=`). */
    async snap(name: string): Promise<string> {
      frame();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return 'no blob';
      const resp = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      return `${resp.status} ${blob.size}`;
    },
    frame,
  };
  (window as unknown as { __hero: typeof api }).__hero = api;
  const loop = (): void => {
    if (!q.has('still') && !measuring) frame();
    hud.textContent = `${built ? 'tinker.glb' : 'stand-in'} · ibl ${lp.stats.ibl} · lut ${lp.stats.lut}
tier ${tier} · ${canvas.width}×${canvas.height} · bake ${lp.stats.bakeMs.toFixed(0)} ms · focus ${lp.stats.focus.toFixed(2)} m\n`
      + [...r.timer.ms].map(([k2, v]) => `${k2.padEnd(10)} ${v.toFixed(3)} ms`).join('\n');
    requestAnimationFrame(loop);
  };
  frame();
  loop();
}

/** Pass names the renderer timed in its most recently resolved frame (G5, M5: the passes that really ran). */
function lastNames(r: Renderer): string[] {
  return [...r.timer.live];
}

main().catch((e) => { hud.textContent = `error: ${e instanceof Error ? e.stack : String(e)}`; console.error(e); });
