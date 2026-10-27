// M4 part art (stream E4a) against its briefs (docs/art/briefs/{matter,air,power_signal,contraptions,rollers,fun}.md).
// parts.test.ts compares every ART_PARTS build with its parts-data def; this file pins the brief contract itself: class,
// family, origin, footprint, mass, LOD0 budget, ports (Blender brief coordinates converted to engine Y-up), pivots on
// their brief axes, screens, LED groups, shape keys (LOD0/1 only), cavities with their fill-pass data (volume, 64-entry
// LUT checked against the cavity mesh here in TS, closed mesh, tilt LUTs), ZIPPY's wheels on the ground, YOLK's shell
// bits, and the D78 texture set on every part. Parts whose build is missing are skipped with a message
// (node tools/assets.mjs <type> --tex).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_PARTS } from '../../../apps/game/src/artlist.ts';
import { assemblePartAssets, lodStats, type ArtCavity, type PartAssets } from '../src/index.ts';
import { poseAtZero, type RawPivot, type RawPort } from './pivot_pose.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');

type V3 = readonly [number, number, number];
type Axis = 'x' | 'y' | 'z';
interface BriefPort { name: string; channel: string; dir: 'in' | 'out' | 'both'; size: 'S' | 'M' | 'L'; at: V3; facing: V3; maxLinks?: number; kind?: string }
interface Brief {
  family: string; cls: 'S' | 'M' | 'L'; origin: string; footprint: V3; mass: number; budget: number;
  ports?: BriefPort[];
  /** pivot name -> [Blender axis, optional point on the axis (Blender)] */
  pivots?: Record<string, [Axis, V3?]>;
  screens?: Record<string, { kind: string; color: string; digits?: number; cells?: number }>;
  leds?: string[];
  /** cavity -> [matter, litres min, litres max] */
  cavities?: Record<string, [string, number, number]>;
  /** shape key -> [piece carrying it, default weight, largest morph delta in metres (± 25 %)] */
  shapeKeys?: Record<string, [string, number, number]>;
  frac?: number;
}

const NX: V3 = [-1, 0, 0], NY: V3 = [0, -1, 0], Z: V3 = [0, 0, 1];
const P = (name: string, channel: string, dir: BriefPort['dir'], size: BriefPort['size'], at: V3, facing: V3,
  extra: Partial<BriefPort> = {}): BriefPort => ({ name, channel, dir, size, at, facing, ...extra });

// Brief values (Blender metres: +X right, +Y back, +Z up). Budgets are LOD0 tris without linked port rings.
export const M4_BRIEFS: Record<string, Brief> = {
  grit_hopper: {
    family: 'matter', cls: 'M', origin: 'bottom', footprint: [3, 4, 3], mass: 4, budget: 7500,
    ports: [P('open', 'signal', 'in', 'M', [0, -0.046, 0.11], NY)], pivots: { gate: ['x'] },
    screens: { fill: { kind: 'bar', color: 'beam', cells: 10 } }, leds: ['flowing'], cavities: { sand: ['sand', 14, 18] },
  },
  hourglass: {
    family: 'matter', cls: 'S', origin: 'bottom', footprint: [1, 2, 1], mass: 0.5, budget: 2800,
    ports: [P('out', 'signal', 'out', 'S', [0, -0.032, 0.10], NY)], cavities: { top: ['sand', 0.08, 0.2], bottom: ['sand', 0.08, 0.2] },
  },
  tank: {
    family: 'matter', cls: 'M', origin: 'bottom', footprint: [3, 4, 3], mass: 5, budget: 7000,
    ports: [P('open', 'signal', 'in', 'M', [0.04, -0.122, 0.029], NY)], pivots: { handwheel: ['z', [0, -0.14, 0.10]] },
    screens: { level: { kind: 'bar', color: 'fluid', cells: 10 } }, leds: ['valve_open'], cavities: { water: ['water', 14.3, 15] },
  },
  // the cavity is 1.75 L inside the briefed 0.16 x 0.14 tub (capacity property 2 L: the fill shows the fraction)
  sprinkle_can: {
    family: 'matter', cls: 'M', origin: 'bottom', footprint: [3, 2, 2], mass: 0.8, budget: 6000, ports: [],
    pivots: { tilt: ['y', [-0.02, 0, 0.07]] }, cavities: { water: ['water', 1.6, 2.1] },
  },
  waterwheel: {
    family: 'matter', cls: 'M', origin: 'axle', footprint: [4, 4, 2], mass: 3.7, budget: 8000,
    ports: [P('axle', 'spin', 'out', 'M', [0, -0.10, 0], NY, { kind: 'axle' })], pivots: { wheel: ['y', [0, 0, 0]] },
  },
  sponge: {
    family: 'matter', cls: 'S', origin: 'com', footprint: [2, 1, 1], mass: 0.05, budget: 2500,
    shapeKeys: { sk_swell: ['foam', 0, 0.0073], sk_squash: ['foam', 0, 0.032] },
  },
  marble_hopper: {
    family: 'matter', cls: 'M', origin: 'bottom', footprint: [3, 4, 3], mass: 6, budget: 8500,
    ports: [P('open', 'signal', 'in', 'M', [0.07, -0.115, 0.075], [0, -0.95, 0.32])], pivots: { feed_wheel: ['y'], chute_flap: ['x'] },
    screens: { count: { kind: '7seg', color: 'beam', digits: 6 } }, leds: ['flowing'], cavities: { marbles: ['marble', 6.5, 9.2] },
  },
  blowout: {
    family: 'air', cls: 'M', origin: 'bottom', footprint: [2, 2, 1], mass: 0.9, budget: 7500,
    ports: [P('in', 'power', 'in', 'S', [0, -0.046, 0.027], NY)], pivots: { fan: ['x', [0, 0, 0.15]] }, leds: ['heater', 'status'],
  },
  vac: {
    family: 'air', cls: 'M', origin: 'bottom', footprint: [1, 1, 3], mass: 1.1, budget: 6000,
    ports: [P('in', 'power', 'in', 'M', [0, 0.08, 0.095], Z)], pivots: { impeller: ['y', [0, 0, 0.052]] }, leds: ['status', 'mouth_ring'],
  },
  // cradle Ø 0.19 (brief Ø 0.17 is under the 0.18 m minimum of a 2-cell footprint)
  inflator: {
    family: 'air', cls: 'M', origin: 'bottom', footprint: [2, 3, 2], mass: 2.4, budget: 6500,
    ports: [P('in', 'signal', 'in', 'S', [0, -0.086, 0.019], NY), P('fill', 'air', 'out', 'S', [0.08, -0.02, 0.285], Z)],
    pivots: { valve_knob: ['z', [0, 0, 0]], gauge_needle: ['y'] }, leds: ['filling', 'overpressure'],
  },
  arc_tower: {
    family: 'power', cls: 'L', origin: 'bottom', footprint: [2, 5, 2], mass: 6, budget: 18000,
    ports: [P('in', 'power', 'in', 'L', [0, -0.101, 0.045], NY)], leds: ['charge', 'secondary_glow', 'status'],
  },
  toast_cannon: {
    family: 'contraptions', cls: 'M', origin: 'bottom', footprint: [2, 2, 1], mass: 1.5, budget: 6000,
    ports: [P('in', 'power', 'in', 'S', [-0.06, -0.048, 0.045], NY)], pivots: { carriage: ['z'], lever: ['z', [0.075, -0.0475, 0]], dial: ['y'] },
    leds: ['progress', 'elements'],
  },
  toast_slice: { family: 'contraptions', cls: 'S', origin: 'com', footprint: [0.9, 1, 0.12], mass: 0.03, budget: 400 },
  yolk: { family: 'rollers', cls: 'S', origin: 'com', footprint: [0.45, 0.6, 0.45], mass: 0.055, budget: 900, frac: 14 },
  zippy: {
    family: 'fun', cls: 'M', origin: 'com', footprint: [2, 1, 1], mass: 0.8, budget: 8500,
    ports: [P('go', 'signal', 'in', 'S', [0.01, 0, 0.046], Z), P('tow', 'tension', 'both', 'S', [-0.1, 0, 0], NX, { kind: 'hook' })],
    pivots: {
      wheel_fl: ['y', [0.065, 0, -0.005]], wheel_fr: ['y', [0.065, 0, -0.005]], wheel_rl: ['y', [-0.065, 0, -0.005]],
      wheel_rr: ['y', [-0.065, 0, -0.005]], steer_fl: ['z', [0.065, 0.0375, 0]], steer_fr: ['z', [0.065, -0.0375, 0]],
      shell_roll: ['x'], spur: ['y'], antenna: ['x'],
    },
    leds: ['headlights', 'tail', 'status'],
  },
  quack: {
    family: 'fun', cls: 'S', origin: 'com', footprint: [1, 1, 1], mass: 0.04, budget: 2200,
    shapeKeys: { sk_squash: ['duck', 0, 0.0095] },
  },
};

/** Blender (x, y, z) -> engine Y-up (x, z, -y), as the exporter writes. */
const eng = (v: V3): V3 => [v[0], v[2], -v[1]];
const AXIS: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
const UV_EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;

interface RawShapeKey { name: string; mesh: string; lods: number[]; default: number; range: string }
interface RawArt { shapeKeys?: RawShapeKey[]; pivots: (RawPivot & { pos: V3; axis: V3; min?: number; max?: number })[]; ports: RawPort[] }

function load(type: string): { a: PartAssets; raw: RawArt } | null {
  const base = join(BUILD, type, type);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const raw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as RawArt;
  const a = assemblePartAssets(type, readFileSync(`${base}.glb`), raw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  return { a, raw };
}

/** Volume of the closed cavity mesh below the plane y = h (engine Y-up): the same exact integral as cavity.py, in TS. */
function volumeBelow(c: ArtCavity, h: number): number {
  const v = c.mesh!.vertices, ix = c.mesh!.indices;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    // engine (x, y, z) -> a right-handed frame with "up" last: (x, -z, y)
    const p = [0, 1, 2].map((k) => { const i = ix[t + k]! * 3; return [v[i]!, -v[i + 2]!, v[i + 1]!] as const; });
    const area = 0.5 * ((p[1]![0] - p[0]![0]) * (p[2]![1] - p[0]![1]) - (p[1]![1] - p[0]![1]) * (p[2]![0] - p[0]![0]));
    const d = p.map((q) => q[2] - h);
    const below = d.map((x) => x < 0);
    const nb = below.filter(Boolean).length;
    if (nb === 3) { vol += area * (d[0]! + d[1]! + d[2]!) / 3; continue; }
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, k = (i + 2) % 3;
      if (nb === 1 && below[i]) vol += area * (d[i]! / (d[i]! - d[j]!)) * (d[i]! / (d[i]! - d[k]!)) * d[i]! / 3;
      if (nb === 2 && !below[i]) {
        vol += area * ((d[0]! + d[1]! + d[2]!) / 3 - (d[i]! / (d[i]! - d[j]!)) * (d[i]! / (d[i]! - d[k]!)) * d[i]! / 3);
      }
    }
  }
  return vol;
}

const types = Object.keys(M4_BRIEFS);
const built = types.filter((t) => load(t) !== null);
const missing = types.filter((t) => !built.includes(t));
if (missing.length) console.warn(`[assets] M4 brief checks skipped for ${missing.join(', ')}: not built (node tools/assets.mjs <type> --tex)`);

describe.skipIf(!built.length)('M4 part art matches its brief (stream E4a)', () => {
  it('every M4 build is listed in ART_PARTS', () => {
    for (const t of built) expect(ART_PARTS, t).toContain(t);
  });

  it.each(built)('%s: class, family, origin, footprint, mass and LOD0 budget', (type) => {
    const b = M4_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.class).toBe(b.cls);
    expect(a.art.family).toBe(b.family);
    expect(a.art.origin).toBe(b.origin);
    b.footprint.forEach((v, i) => expect(a.art.footprint[i], `footprint[${i}]`).toBeCloseTo(v, 3));
    expect(a.art.massHint).toBeCloseTo(b.mass, 4);
    expect(lodStats(a.glb, 0).triangles).toBeLessThanOrEqual(b.budget);
    for (const m of a.art.materials) expect(m).toMatch(/^kn_[a-z0-9_]+$/);
    if (b.origin === 'bottom') expect(Math.abs(lodStats(a.glb, 0).min[1])).toBeLessThanOrEqual(0.0015); // on the floor
  });

  it.each(built)('%s: ports as briefed (name, channel, dir, size, place, facing, links, kind)', (type) => {
    const b = M4_BRIEFS[type]!;
    const { a, raw } = load(type)!;
    const want = b.ports ?? [];
    expect(a.art.ports.map((p) => `${p.channel}:${p.name}`).sort()).toEqual(want.map((p) => `${p.channel}:${p.name}`).sort());
    for (const p of want) {
      const got = a.art.ports.find((x) => x.name === p.name && x.channel === p.channel)!;
      expect(got.dir).toBe(p.dir);
      expect(got.size).toBe(p.size);
      const z = poseAtZero(raw.ports.find((x) => x.name === p.name && x.channel === p.channel)!, raw.pivots);
      const e = eng(p.at);
      for (let i = 0; i < 3; i++) expect(Math.abs(z.pos[i]! - e[i]!), `${type}.${p.name} pos[${i}]`).toBeLessThanOrEqual(0.0015);
      const f = eng(p.facing), fl = Math.hypot(...f);
      expect((z.dirVec[0]! * f[0] + z.dirVec[1]! * f[1] + z.dirVec[2]! * f[2]) / fl, `${type}.${p.name} facing`).toBeGreaterThan(0.99);
      expect(got.maxLinks ?? 1).toBe(p.maxLinks ?? 1);
      if (p.kind) expect(got.kind).toBe(p.kind);
    }
  });

  it.each(built)('%s: pivots on their brief axes', (type) => {
    const { raw } = load(type)!;
    for (const [name, [axis, at]] of Object.entries(M4_BRIEFS[type]!.pivots ?? {})) {
      const p = raw.pivots.find((x) => x.name === name);
      expect(p, `${type}: PIVOT__${name}`).toBeDefined();
      const w = AXIS[axis];
      expect(Math.abs(p!.axis[0] * w[0] + p!.axis[1] * w[1] + p!.axis[2] * w[2]), `${type}.${name} axis`).toBeGreaterThan(0.999);
      if (at) {
        const e = eng(at);
        const d = [0, 1, 2].map((i) => e[i]! - p!.pos[i]!);
        const t = d[0]! * w[0] + d[1]! * w[1] + d[2]! * w[2];
        expect(Math.hypot(...d.map((x, i) => x - t * w[i]!)), `${type}.${name} on axis`).toBeLessThanOrEqual(0.002);
      }
    }
  });

  it.each(built)('%s: screens and LED groups', (type) => {
    const b = M4_BRIEFS[type]!;
    const { a } = load(type)!;
    const scr = b.screens ?? {};
    expect(a.art.screens.map((s) => s.name).sort()).toEqual(Object.keys(scr).sort());
    for (const [name, s] of Object.entries(scr)) {
      const got = a.art.screens.find((x) => x.name === name)!;
      expect(got.kind).toBe(s.kind);
      expect(got.color).toBe(s.color);
      if (s.digits !== undefined) expect(got.digits).toBe(s.digits);
      if (s.cells !== undefined) expect(got.cells).toBe(s.cells);
    }
    expect(a.art.ledGroups.map((g) => g.name).sort()).toEqual([...(b.leds ?? [])].sort());
  });

  it.each(built.filter((t) => M4_BRIEFS[t]!.cavities))('%s: cavities carry the fill-pass data (closed mesh, 64-entry LUT that matches the mesh volume)', (type) => {
    const b = M4_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.cavities.map((c) => c.name).sort()).toEqual(Object.keys(b.cavities!).sort());
    for (const [name, [matter, lo, hi]] of Object.entries(b.cavities!)) {
      const c = a.art.cavities.find((x) => x.name === name)!;
      expect(c.matter, `${type} CAVITY__${name}`).toBe(matter);
      expect(c.volume!, `${type}.${name} litres`).toBeGreaterThanOrEqual(lo);
      expect(c.volume!, `${type}.${name} litres`).toBeLessThanOrEqual(hi);
      const lut = c.lut!;
      expect(lut).toHaveLength(64);
      for (let i = 1; i < 64; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
      expect(lut[0]).toBeCloseTo(c.min![1], 4);
      expect(lut[63]).toBeCloseTo(c.max![1], 4);
      // closed and consistently wound: every directed edge appears once and its reverse once
      const ix = c.mesh!.indices, edges = new Map<string, number>();
      expect(ix.length % 3).toBe(0);
      for (let t = 0; t < ix.length; t += 3) {
        for (let k = 0; k < 3; k++) { const key = `${ix[t + k]}>${ix[t + (k + 1) % 3]}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
      }
      for (const [key, n] of edges) {
        const [p, q] = key.split('>');
        expect(n, `${type}.${name} edge ${key}`).toBe(1);
        expect(edges.get(`${q}>${p}`), `${type}.${name} edge ${key} reverse`).toBe(1);
      }
      // the LUT inverts the mesh's own volume: half, quarter and three quarters of it, recomputed here
      const total = Math.abs(volumeBelow(c, c.max![1] + 1));
      expect(total * 1000).toBeCloseTo(c.volume!, 2);
      for (const i of [16, 32, 48]) {
        expect(Math.abs(volumeBelow(c, lut[i]!)) / total, `${type}.${name} lut[${i}]`).toBeCloseTo(i / 63, 2);
      }
    }
  });

  it.skipIf(!built.includes('sprinkle_can'))('sprinkle_can: the water cavity rides the tilt pivot with LUTs from 0 to the 45° pour stop', () => {
    const { a, raw } = load('sprinkle_can')!;
    const c = a.art.cavities[0]!;
    expect(c.pivot).toBe('tilt');
    expect(c.tilt!.angles[0]).toBe(0);
    expect(c.tilt!.angles.at(-1)).toBe(45);
    for (const l of c.tilt!.luts) expect(l).toHaveLength(64);
    expect(raw.pivots.find((p) => p.name === 'tilt')!.max).toBe(45);
    // tipping toward the spout lifts the full-level plane (the can's front corner rises)
    expect(c.tilt!.luts.at(-1)![63]!).toBeGreaterThan(c.tilt!.luts[0]![63]!);
  });

  it.each(built.filter((t) => M4_BRIEFS[t]!.shapeKeys))('%s: shape keys are morph targets on the briefed piece at LOD0/1 only', (type) => {
    const want = M4_BRIEFS[type]!.shapeKeys!;
    const { a, raw } = load(type)!;
    for (const m of a.glb.meshes) if (m.lod >= 2) expect(m.targetNames, `${m.nodeName}: morphs at LOD${m.lod}`).toEqual([]);
    for (const [name, [piece, def, delta]] of Object.entries(want)) {
      const k = raw.shapeKeys!.find((x) => x.name === name && x.mesh === `${type}__${piece}`)!;
      expect(k, `${type}__${piece} ${name}`).toBeDefined();
      expect(k.lods).toEqual([0, 1]);
      expect(k.default).toBe(def);
      for (const node of [`${type}__${piece}`, `${type}__${piece}__L1`]) {
        const m = a.glb.meshes.find((x) => x.nodeName === node)!;
        const ti = m.targetNames.indexOf(name);
        expect(ti, `${node} ${name}`).toBeGreaterThanOrEqual(0);
        let big = 0;
        for (const p of m.primitives) {
          const d = p.targets[ti]!.positions!;
          for (let v = 0; v < d.length; v += 3) big = Math.max(big, Math.hypot(d[v]!, d[v + 1]!, d[v + 2]!));
        }
        expect(big, `${node} ${name} largest delta`).toBeGreaterThan(delta * 0.75);
        expect(big, `${node} ${name} largest delta`).toBeLessThan(delta * 1.25);
      }
    }
  });

  it.skipIf(!built.includes('zippy'))('zippy: four wheel colliders whose bottoms touch z -0.035, and the tyres reach the ground', () => {
    const { a } = load('zippy')!;
    const wheels = a.shapes.shapes.filter((s) => s.kind === 'wheel');
    expect(wheels).toHaveLength(4);
    for (const w of wheels) if (w.kind === 'wheel') expect(w.pos[1] - w.radius).toBeCloseTo(-0.035, 4);
    expect(lodStats(a.glb, 0).min[1]).toBeCloseTo(-0.035, 3);
  });

  it.each(built.filter((t) => M4_BRIEFS[t]!.frac))('%s: the shell bits are exported (yolk.frac.glb)', (type) => {
    const p = join(BUILD, type, `${type}.frac.json`);
    expect(existsSync(p), `${type}.frac.json`).toBe(true);
    const f = JSON.parse(readFileSync(p, 'utf8')) as { chunks: number; hullPoints: number[] };
    expect(f.chunks).toBe(M4_BRIEFS[type]!.frac);
    for (const n of f.hullPoints) expect(n).toBeLessThanOrEqual(32);
  });

  it.each(built)('%s: D78 texture set (albedo / normal / ORM) on every textured LOD0 primitive', (type) => {
    const { a } = load(type)!;
    const t = a.art.textures;
    expect(t, `${type}: node tools/assets.mjs ${type} --tex`).toBeDefined();
    expect(t!.size).toBe(a.art.class === 'S' ? 1024 : 2048);
    for (const f of [t!.albedo, t!.normal, t!.orm]) expect(existsSync(join(BUILD, type, f)), f).toBe(true);
    for (const m of a.glb.meshes.filter((x) => x.lod === 0)) {
      for (const p of m.primitives) {
        const name = a.glb.materials[p.material]?.name ?? '';
        if (UV_EXEMPT.test(name)) continue;
        expect(p.uvs, `${m.nodeName} ${name}`).not.toBeNull();
        expect(t!.slots, `${type}: ${name} in the set`).toContain(name);
      }
    }
  });
});
