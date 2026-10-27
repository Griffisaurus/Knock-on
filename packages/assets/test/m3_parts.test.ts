// M3 part art (stream E3a) against its briefs (docs/art/briefs/*.md). parts.test.ts compares every ART_PARTS build
// with its parts-data def; this file pins the brief contract itself: class, family, origin, footprint, mass, LOD0
// budget, ports (Blender brief coordinates converted to engine Y-up), pivots on their brief axes, screens, LED groups,
// baked clips, shape keys (LOD0/1 only), cavities, roller colliders, fracture chunk counts, the path-kit sidecars,
// and UV1 on every textured LOD0 primitive (authored for the D78 texture set).
// Parts whose build is missing are skipped with a message (node tools/assets.mjs <type>).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_PARTS } from '../../../apps/game/src/artlist.ts';
import { assemblePartAssets, lodStats, type PartAssets } from '../src/index.ts';
import { poseAtZero, type RawPivot, type RawPort } from './pivot_pose.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');

type V3 = readonly [number, number, number];
type Axis = 'x' | 'y' | 'z';
interface BriefPort { name: string; channel: string; dir: 'in' | 'out' | 'both'; size: 'S' | 'M' | 'L'; at: V3; facing: V3; maxLinks?: number; kind?: string }
interface Brief {
  family: string; cls: 'S' | 'M' | 'L'; origin: string; footprint?: V3; mass: number; budget: number;
  ports?: BriefPort[];
  /** pivot name -> [Blender axis, optional point on the axis (Blender)] */
  pivots?: Record<string, [Axis, V3?]>;
  screens?: Record<string, { kind: string; color: string; digits?: number; cells?: number }>;
  leds?: string[]; clips?: string[]; cavities?: Record<string, string>;
  /** shape key -> [piece carrying it, default weight, largest morph delta in metres (± 25 %)] */
  shapeKeys?: Record<string, [string, number, number]>;
  sphere?: { radius: number; phys: string; restitution: number; friction: number };
  frac?: number;
}

const X: V3 = [1, 0, 0], NX: V3 = [-1, 0, 0], NY: V3 = [0, -1, 0], Z: V3 = [0, 0, 1];
const P = (name: string, channel: string, dir: BriefPort['dir'], size: BriefPort['size'], at: V3, facing: V3,
  extra: Partial<BriefPort> = {}): BriefPort => ({ name, channel, dir, size, at, facing, ...extra });

// Brief values (Blender metres: +X right, +Y back, +Z up). Budgets are LOD0 tris without linked port rings.
export const M3_BRIEFS: Record<string, Brief> = {
  lance: { family: 'power', cls: 'S', origin: 'bottom', footprint: [2, 1, 1], mass: 0.9, budget: 3000, ports: [P('in', 'power', 'in', 'S', [-0.07, -0.041, 0.047], NY)], leds: ['status', 'tube', 'aperture'] },
  // brief d 0.2 cells -> 0.5 (rule 3 half cells; the plate is 0.036 deep)
  mirror: { family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 2, 0.5], mass: 0.3, budget: 800, ports: [] },
  splitter: { family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 1, 1], mass: 0.5, budget: 1600, ports: [] },
  tripwire: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 1, 1], mass: 0.3, budget: 1500,
    ports: [P('out', 'signal', 'out', 'S', [0.015, -0.046, 0.045], NY, { maxLinks: 8 })], pivots: { mode_slider: ['x'] }, leds: ['eye', 'mode_break', 'mode_lit'],
  },
  ping: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 1, 1], mass: 0.25, budget: 1500,
    ports: [P('in', 'signal', 'in', 'S', [-0.046, 0, 0.025], NX), P('out', 'signal', 'out', 'S', [0.046, 0, 0.025], X, { maxLinks: 8 })],
    screens: { mode: { kind: 'icon', color: 'signal' } }, leds: ['pair_pulse'],
  },
  maglock: {
    family: 'power', cls: 'M', origin: 'bottom', footprint: [2, 2, 2], mass: 3.0, budget: 7000,
    ports: [P('in', 'power', 'in', 'M', [0.101, 0, 0.055], X), P('eye', 'tension', 'both', 'S', [0, 0, 0.183], Z, { kind: 'hook' })], leds: ['field_ring', 'status'],
  },
  marble: { family: 'rollers', cls: 'S', origin: 'com', footprint: [0.16, 0.16, 0.16], mass: 0.0054, budget: 288, ports: [], sphere: { radius: 0.008, phys: 'glass', restitution: 0.6, friction: 0.3 } },
  glidepath: { family: 'frame', cls: 'M', origin: 'path', mass: 1.0, budget: 4000, ports: [] },
  // the booster piece is its own part (parts-data glidepath_booster, A3): origin at its centre on the rail-top line
  glidepath_booster: {
    family: 'frame', cls: 'M', origin: 'path', footprint: [3, 1, 0.7], mass: 0.6, budget: 4500,
    ports: [P('drive', 'spin', 'in', 'M', [0, -0.025, -0.055], NY, { kind: 'axle' })],
    pivots: { tyre_l: ['z'], tyre_r: ['z'], drive: ['y', [0, 0, -0.055]] },
  },
  spindeck: {
    family: 'frame', cls: 'M', origin: 'bottom', footprint: [4, 1, 4], mass: 3.2, budget: 5000,
    ports: [P('in', 'spin', 'in', 'M', [0.035, -0.166, 0.035], NY, { kind: 'axle' })], pivots: { platter: ['z', [0, 0, 0]], pinion: ['y'] },
  },
  lift: {
    family: 'frame', cls: 'M', origin: 'bottom', footprint: [3, 11, 4.5], mass: 5.3, budget: 6000,
    ports: [P('in', 'power', 'in', 'M', [-0.11, 0.2, 0.08], NY), P('call', 'signal', 'in', 'M', [0.11, 0.2, 0.08], NY),
      P('arrive', 'signal', 'out', 'M', [0.11, 0.25, 0.155], Z, { maxLinks: 8 })],
    pivots: { carriage: ['z', [0, 0, 0]], pulley_drive: ['x'], pulley_idle: ['x'] }, leds: ['status', 'dir_up', 'dir_down'],
  },
  rack: {
    family: 'drive', cls: 'S', origin: 'bottom', footprint: [10, 1, 1], mass: 1.9, budget: 2900,
    ports: [P('pinion', 'spin', 'both', 'S', [0, -0.051, 0.075], NY, { kind: 'axle' })], pivots: { bar: ['x'], pinion: ['y', [0, 0, 0.075]] },
  },
  ram: {
    // the brief names the signal input PORT__signal__in; parts-data names it `fire` (unique port names)
    family: 'drive', cls: 'M', origin: 'bottom', footprint: [1, 1, 5], mass: 1.1, budget: 5000,
    ports: [P('in', 'power', 'in', 'S', [0, 0.22, 0.1], Z), P('fire', 'signal', 'in', 'S', [0, 0.175, 0.1], Z)], pivots: { rod: ['y'] }, leds: ['armed', 'extended'],
  },
  powder_keg: {
    family: 'boom', cls: 'M', origin: 'com', footprint: [2, 3, 2], mass: 6, budget: 8500, frac: 16,
    ports: [P('fuse', 'heat', 'in', 'S', [0.045, 0, 0.142], Z), P('detonator', 'signal', 'in', 'S', [-0.045, 0, 0.142], Z)],
  },
  jitterjuice: { family: 'boom', cls: 'S', origin: 'com', footprint: [1, 1.5, 1], mass: 0.4, budget: 2800, ports: [], leds: ['agitation'], cavities: { liquid: 'fill' }, frac: 14 },
  skyshow: { family: 'boom', cls: 'M', origin: 'bottom', footprint: [3, 2, 3], mass: 1.6, budget: 6500, ports: [P('fuse', 'heat', 'in', 'S', [0, -0.151, 0.022], NY)] },
  flamer: {
    family: 'boom', cls: 'M', origin: 'bottom', footprint: [3, 1, 1], mass: 1.2, budget: 6500,
    ports: [P('on', 'signal', 'in', 'S', [-0.07, -0.041, 0.019], NY), P('in', 'power', 'in', 'S', [-0.03, -0.041, 0.019], NY)],
    pivots: { valve_knob: ['z'] }, leds: ['status', 'igniter'],
  },
  popper: {
    family: 'boom', cls: 'S', origin: 'bottom', footprint: [1, 1.5, 1], mass: 0.12, budget: 2200,
    ports: [P('string', 'tension', 'in', 'S', [0, -0.041, 0.022], NY, { kind: 'hook' })], pivots: { tab: ['y'] }, shapeKeys: { sk_torn: ['cap', 0, 0.0432] },
  },
  snaptrap: {
    family: 'contraptions', cls: 'M', origin: 'bottom', footprint: [2, 0.5, 1], mass: 0.15, budget: 3500, ports: [],
    pivots: { bar: ['y', [0, 0, 0.022]], latch: ['y'], pedal: ['y'] }, shapeKeys: { sk_wind: ['springs', 1, 0.0047] },
  },
  bonker: {
    family: 'contraptions', cls: 'M', origin: 'hinge', footprint: [1, 4, 1], mass: 1.6, budget: 4000,
    ports: [P('swing', 'signal', 'in', 'S', [0, -0.051, -0.015], NY)], pivots: { arm: ['x', [0, 0, 0]] }, leds: ['ready'],
    shapeKeys: { sk_wind: ['springs', 1, 0.0076] },
  },
  flinger: {
    family: 'contraptions', cls: 'M', origin: 'bottom', footprint: [4, 3, 3], mass: 5, budget: 9000,
    ports: [P('release', 'signal', 'in', 'M', [-0.12, -0.138, 0.07], NY), P('trigger', 'tension', 'in', 'M', [-0.04, -0.138, 0.07], NY, { kind: 'hook' })],
    pivots: { arm: ['y', [0.04, 0, 0.12]], stop: ['y', [0.04, 0, 0.12]], latch: ['y'] }, leds: ['ready'], shapeKeys: { sk_wind: ['springs', 1, 0.013] },
  },
  wrecker: {
    family: 'contraptions', cls: 'M', origin: 'com', footprint: [2, 2, 2], mass: 20, budget: 4000,
    ports: [P('hook', 'tension', 'both', 'M', [0, 0, 0.097], Z, { kind: 'hook' })], pivots: { swivel: ['z', [0, 0, 0]] },
    sphere: { radius: 0.095, phys: 'steel', restitution: 0.1, friction: 0.5 },
  },
  pinger: {
    family: 'contraptions', cls: 'M', origin: 'bottom', footprint: [1, 1, 3], mass: 0.9, budget: 4500,
    ports: [P('fire', 'signal', 'in', 'S', [0, -0.138, 0.095], Z)], pivots: { plunger: ['y', [0, 0, 0.055]] }, leds: ['ready'],
    shapeKeys: { sk_compress: ['spring', 0, 0.06] },
  },
  paddle: {
    family: 'contraptions', cls: 'M', origin: 'hinge', footprint: [3, 1, 1], mass: 0.8, budget: 3500,
    ports: [P('flip', 'signal', 'in', 'S', [0, -0.036, -0.037], NY)], pivots: { bat: ['z', [0, 0, 0]] },
  },
  bumper: {
    family: 'contraptions', cls: 'S', origin: 'bottom', footprint: [1.5, 1, 1.5], mass: 0.6, budget: 2500,
    ports: [P('kick', 'signal', 'in', 'S', [0, -0.076, 0.019], NY)], pivots: { ring: ['z', [0, 0, 0]] }, leds: ['cap'],
  },
  pin: { family: 'fun', cls: 'S', origin: 'com', footprint: [0.5, 1.5, 0.5], mass: 0.1, budget: 290, ports: [] },
  stacker: { family: 'fun', cls: 'S', origin: 'com', footprint: [1, 0.3, 3], mass: 0.6, budget: 220, ports: [] },
  pane: { family: 'fun', cls: 'S', origin: 'com', footprint: [1, 4, 0.1], mass: 1.0, budget: 600, ports: [], frac: 24 },
  vase: { family: 'fun', cls: 'S', origin: 'com', footprint: [1, 2, 1], mass: 0.45, budget: 2800, ports: [], frac: 16 },
  tonebars: {
    family: 'fun', cls: 'M', origin: 'bottom', footprint: [1, 0.5, 3], mass: 1.2, budget: 3200, ports: [], pivots: { bar: ['z', [0, 0, 0]] },
    screens: { note: { kind: 'text', color: 'sound' } }, leds: ['note'],
  },
  ding: { family: 'fun', cls: 'S', origin: 'com', footprint: [1, 1, 1], mass: 0.45, budget: 2400, ports: [], pivots: { plunger: ['z', [0, 0, 0]], dome: ['z', [0, 0, 0]] }, leds: ['ring'] },
  fabricator: {
    family: 'future', cls: 'L', origin: 'bottom', footprint: [3, 3, 3], mass: 9, budget: 18000,
    ports: [P('spawn', 'signal', 'in', 'L', [-0.105, -0.15, 0.09], NY)], pivots: { mouth_flap: ['x', [0, -0.148, 0.145]], preview: ['z', [0, -0.09, 0]] },
    screens: { count: { kind: '7seg', digits: 3, color: 'plasma' }, interval: { kind: 'bar', cells: 10, color: 'plasma' } },
    leds: ['status', 'print_glow', 'mouth_rim'], clips: ['spawn_kick'], shapeKeys: { sk_hiccup: ['shell', 0, 0.00315] },
  },
  recycler: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [3, 2, 3], mass: 6, budget: 7500,
    ports: [P('count', 'signal', 'out', 'M', [-0.095, -0.15, 0.1], NY, { maxLinks: 8 })], pivots: { iris: ['z', [0, 0, 0]] },
    screens: { count: { kind: '7seg', digits: 3, color: 'plasma' }, target: { kind: '7seg', digits: 3, color: 'signal' }, core: { kind: 'icon', color: 'plasma' } },
    leds: ['rim', 'goal'],
  },
  zone: { family: 'future', cls: 'S', origin: 'bottom', footprint: [0.5, 0.5, 0.5], mass: 0.01, budget: 400, ports: [], leds: ['mode_cap'] },
};

/** Blender (x, y, z) -> engine Y-up (x, z, -y), as the exporter writes. */
const eng = (v: V3): V3 => [v[0], v[2], -v[1]];
const AXIS: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
const UV_EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;

interface RawShapeKey { name: string; mesh: string; lods: number[]; default: number; range: string }
interface RawArt { shapeKeys?: RawShapeKey[]; pivots: (RawPivot & { pos: V3; axis: V3 })[]; ports: RawPort[]; clips: string[] }
interface GlbJson { animations?: { name: string; channels: { target: { node: number } }[] }[]; nodes: { name: string }[] }

function load(type: string): { a: PartAssets; raw: RawArt; json: GlbJson } | null {
  const base = join(BUILD, type, type);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const glb = readFileSync(`${base}.glb`);
  const raw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as RawArt;
  const a = assemblePartAssets(type, glb, raw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  const len = glb.readUInt32LE(12);
  return { a, raw, json: JSON.parse(glb.subarray(20, 20 + len).toString('utf8')) as GlbJson };
}

const types = Object.keys(M3_BRIEFS);
const built = types.filter((t) => load(t) !== null);
const missing = types.filter((t) => !built.includes(t));
if (missing.length) console.warn(`[assets] M3 brief checks skipped for ${missing.join(', ')}: not built (node tools/assets.mjs <type>)`);

describe.skipIf(!built.length)('M3 part art matches its brief (stream E3a)', () => {
  it('every M3 build is listed in ART_PARTS', () => {
    for (const t of built) expect(ART_PARTS, t).toContain(t);
  });

  it.each(built)('%s: class, family, origin, footprint, mass and LOD0 budget', (type) => {
    const b = M3_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.class).toBe(b.cls);
    expect(a.art.family).toBe(b.family);
    expect(a.art.origin).toBe(b.origin);
    if (b.footprint) b.footprint.forEach((v, i) => expect(a.art.footprint[i], `footprint[${i}]`).toBeCloseTo(v, 3));
    expect(a.art.massHint).toBeCloseTo(b.mass, 4);
    expect(lodStats(a.glb, 0).triangles).toBeLessThanOrEqual(b.budget);
    for (const m of a.art.materials) expect(m).toMatch(/^kn_[a-z0-9_]+$/);
    if (b.origin === 'bottom') expect(Math.abs(lodStats(a.glb, 0).min[1])).toBeLessThanOrEqual(0.0015); // on the floor
  });

  it.each(built)('%s: ports as briefed (name, channel, dir, size, place, facing, links, kind)', (type) => {
    const b = M3_BRIEFS[type]!;
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
      const f = eng(p.facing);
      expect(z.dirVec[0]! * f[0] + z.dirVec[1]! * f[1] + z.dirVec[2]! * f[2], `${type}.${p.name} facing`).toBeGreaterThan(0.99);
      expect(got.maxLinks ?? 1).toBe(p.maxLinks ?? 1);
      if (p.kind) expect(got.kind).toBe(p.kind);
    }
  });

  it.each(built)('%s: pivots on their brief axes', (type) => {
    const { raw } = load(type)!;
    for (const [name, [axis, at]] of Object.entries(M3_BRIEFS[type]!.pivots ?? {})) {
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

  it.each(built)('%s: screens, LED groups, cavities', (type) => {
    const b = M3_BRIEFS[type]!;
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
    for (const [name, matter] of Object.entries(b.cavities ?? {})) {
      expect(a.art.cavities.find((c) => c.name === name)?.matter, `${type} CAVITY__${name}`).toBe(matter);
    }
  });

  it.each(built)('%s: baked clips are glTF animations on pivots in every LOD', (type) => {
    const b = M3_BRIEFS[type]!;
    const { a, json } = load(type)!;
    expect([...a.art.clips].sort()).toEqual([...(b.clips ?? [])].sort());
    for (const c of b.clips ?? []) {
      const anim = (json.animations ?? []).find((x) => x.name === `${type}__${c}`);
      expect(anim, `${type}__${c}`).toBeDefined();
      const targets = anim!.channels.map((ch) => json.nodes[ch.target.node]!.name);
      expect(targets.every((n) => n.startsWith('PIVOT__'))).toBe(true);
      for (let lod = 1; lod < 4; lod++) expect(targets.some((n) => n.endsWith(`__L${lod}`)), `${type}__${c} LOD${lod}`).toBe(true);
    }
  });

  it.each(built)('%s: shape keys are morph targets on the briefed piece at LOD0/1 only', (type) => {
    const want = M3_BRIEFS[type]!.shapeKeys ?? {};
    const { a, raw } = load(type)!;
    expect((raw.shapeKeys ?? []).map((k) => k.name).sort()).toEqual(Object.keys(want).sort());
    for (const m of a.glb.meshes) if (m.lod >= 2) expect(m.targetNames, `${m.nodeName}: morphs at LOD${m.lod}`).toEqual([]);
    for (const [name, [piece, def, delta]] of Object.entries(want)) {
      const k = raw.shapeKeys!.find((x) => x.name === name)!;
      expect(k.mesh).toBe(`${type}__${piece}`);
      expect(k.lods).toEqual([0, 1]);
      expect(k.default).toBe(def);
      for (const node of [`${type}__${piece}`, `${type}__${piece}__L1`]) {
        const m = a.glb.meshes.find((x) => x.nodeName === node)!;
        const ti = m.targetNames.indexOf(name);
        expect(ti, `${node} ${name}`).toBeGreaterThanOrEqual(0);
        expect(m.targetWeights[ti]).toBeCloseTo(def, 4);
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

  it.each(built.filter((t) => M3_BRIEFS[t]!.sphere))('%s: roller collider is the briefed sphere', (type) => {
    const s = M3_BRIEFS[type]!.sphere!;
    const { a } = load(type)!;
    expect(a.shapes.shapes).toHaveLength(1);
    const sh = a.shapes.shapes[0]!;
    expect(sh.kind).toBe('sphere');
    if (sh.kind === 'sphere') expect(sh.radius).toBeCloseTo(s.radius, 3);
    expect(sh.phys).toBe(s.phys);
    expect(sh.restitution).toBeCloseTo(s.restitution, 3);
    expect(sh.friction).toBeCloseTo(s.friction, 3);
  });

  it.each(built.filter((t) => M3_BRIEFS[t]!.frac))('%s: fracture chunks exported (--frac)', (type) => {
    const p = join(BUILD, type, `${type}.frac.json`);
    expect(existsSync(p), `${type}.frac.json (node tools/assets.mjs ${type} --frac)`).toBe(true);
    const f = JSON.parse(readFileSync(p, 'utf8')) as { chunks: number; hullPoints: number[] };
    expect(f.chunks).toBe(M3_BRIEFS[type]!.frac);
    for (const n of f.hullPoints) expect(n).toBeLessThanOrEqual(32);
  });

  it.each(built)('%s: UV1 on every textured LOD0 primitive (authored for the texture set)', (type) => {
    const { a } = load(type)!;
    for (const m of a.glb.meshes.filter((x) => x.lod === 0)) {
      for (const p of m.primitives) {
        const name = a.glb.materials[p.material]?.name ?? '';
        if (UV_EXEMPT.test(name)) continue;
        expect(p.uvs, `${m.nodeName} ${name}`).not.toBeNull();
      }
    }
  });

  it.skipIf(!built.includes('glidepath'))('glidepath: profile.json carries the rail + spine loops per LOD and the kit anchors', () => {
    const prof = JSON.parse(readFileSync(join(BUILD, 'glidepath', 'glidepath.profile.json'), 'utf8')) as {
      kind: string; lods: Record<string, { loops: { name: string; master: string; points: number[][] }[] }>; kit: Record<string, unknown> };
    expect(prof.kind).toBe('path_sweep');
    expect(Object.keys(prof.lods)).toEqual(['LOD0', 'LOD1', 'LOD2', 'LOD3']);
    for (const l of Object.values(prof.lods)) expect(l.loops.map((x) => x.name)).toEqual(['rail_l', 'rail_r', 'spine']);
    expect(Object.keys(prof.kit).sort()).toEqual(['glidepath__buffer', 'glidepath__clamp', 'glidepath__post', 'glidepath__tie', 'glidepath_booster']);
  });

  it.skipIf(!built.includes('tonebars'))('tonebars: 15 bar variants halving over two octaves, tonics ignition', () => {
    const v = JSON.parse(readFileSync(join(BUILD, 'tonebars', 'tonebars.variants.json'), 'utf8')) as { variants: { length: number; master: string }[] };
    expect(v.variants).toHaveLength(15);
    expect(v.variants[0]!.length).toBeCloseTo(0.3, 3);
    expect(v.variants[14]!.length).toBeCloseTo(0.15, 3);
    for (const i of [0, 7, 14]) expect(v.variants[i]!.master).toBe('kn_anod_ignition');
  });
});
