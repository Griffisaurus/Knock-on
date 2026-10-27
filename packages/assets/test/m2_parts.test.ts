// M2 part art (stream E1) against its briefs (docs/art/briefs/*.md). parts.test.ts compares every ART_PARTS build
// with its parts-data def once that def exists; this file pins the brief contract itself, so a build that drifts
// from its brief fails even before the def lands: class, origin, footprint, mass, budget, ports (Blender brief
// coordinates converted to engine Y-up), pivots on their brief axes, screens and their kind, LED groups, baked
// clips (in .art.json and as glTF animations), device sockets, cavities and roller colliders.
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
interface BriefPort { name: string; channel: string; dir: 'in' | 'out' | 'both'; size: 'S' | 'M' | 'L'; at: V3; facing: V3; maxLinks?: number; kind?: string; broadcast?: boolean }
interface Brief {
  family: string; cls: 'S' | 'M' | 'L' | 'XL'; origin: string; footprint?: V3; mass?: number; budget: number;
  ports?: BriefPort[];
  /** pivot name -> [Blender axis, optional point on the axis (Blender)]; axis null = rotated frame (not checked) */
  pivots?: Record<string, [Axis | null, V3?]>;
  screens?: Record<string, { kind: string; color: string; digits?: number; cells?: number }>;
  leds?: string[]; clips?: string[]; sockets?: string[]; cavities?: Record<string, string>;
  /** shape key -> [piece carrying it, default weight, largest morph delta in metres (± 25 %)] */
  shapeKeys?: Record<string, [string, number, number]>;
  sphere?: { radius: number; phys: string; restitution?: number; friction?: number };
}

const X: V3 = [1, 0, 0], NX: V3 = [-1, 0, 0], NY: V3 = [0, -1, 0], Z: V3 = [0, 0, 1];
const P = (name: string, channel: string, dir: BriefPort['dir'], size: BriefPort['size'], at: V3, facing: V3,
  extra: Partial<BriefPort> = {}): BriefPort => ({ name, channel, dir, size, at, facing, ...extra });

// Brief values (Blender metres: +X right, +Y back, +Z up). Budgets are LOD0 tris without linked port rings.
export const M2_BRIEFS: Record<string, Brief> = {
  stitch: { family: 'rollers', cls: 'S', origin: 'com', footprint: [0.75, 0.75, 0.75], mass: 0.15, budget: 2200, sphere: { radius: 0.0375, phys: 'powder', restitution: 0.5, friction: 0.45 } },
  fuzz: { family: 'rollers', cls: 'S', origin: 'com', footprint: [0.65, 0.65, 0.65], mass: 0.058, budget: 1600, sphere: { radius: 0.0325, phys: 'fabric', restitution: 0.7, friction: 1.2 } },
  pig_iron: { family: 'rollers', cls: 'S', origin: 'com', footprint: [1.2, 1.2, 1.2], mass: 6.5, budget: 1800, sphere: { radius: 0.06, phys: 'steel', restitution: 0.1, friction: 0.4 } },
  gutter: { family: 'frame', cls: 'S', origin: 'path', budget: 3000 },
  vortex: { family: 'frame', cls: 'S', origin: 'bottom', footprint: [8, 4.5, 8], budget: 2800 },
  sprong: { family: 'frame', cls: 'M', origin: 'bottom', footprint: [3, 0.5, 3], mass: 1.8, budget: 6500, shapeKeys: { sk_depress: ['mat', 0, 0.022] } },
  trap_box: {
    family: 'frame', cls: 'M', origin: 'bottom', footprint: [7, 5, 5], mass: 5.2, budget: 8000,
    ports: [P('hook', 'tension', 'both', 'M', [0, 0, 0.492], Z, { kind: 'hook' })], pivots: { flag: ['y'] },
  },
  scoop: {
    family: 'frame', cls: 'S', origin: 'bottom', footprint: [2, 2, 2], mass: 0.45, budget: 2300,
    // The bail port rides PIVOT__bail: briefed at (0, 0.097, 0.191) in the rest pose (-75), (0, 0, 0.265) facing +Z
    // upright (pivot 0). Checked at pivot 0 like parts-data; the art is modelled at rest.
    ports: [P('bail', 'tension', 'both', 'S', [0, 0, 0.265], Z, { kind: 'hook' })], pivots: { bail: ['x', [0, 0, 0.165]] },
    cavities: { contents: 'fill' },
  },
  flap: {
    family: 'frame', cls: 'S', origin: 'hinge', footprint: [3, 0.5, 3], mass: 0.27, budget: 1400,
    ports: [P('in', 'signal', 'in', 'S', [0.11, -0.28, -0.0125], NY)], pivots: { panel: ['x', [0, 0, 0]] }, leds: ['status'],
  },
  dynamo: {
    family: 'drive', cls: 'L', origin: 'bottom', footprint: [3, 2, 2], mass: 4.5, budget: 18000,
    ports: [P('in', 'spin', 'in', 'L', [-0.151, 0, 0.1], NX, { kind: 'axle' }), P('out', 'power', 'out', 'L', [0.108, -0.096, 0.1], NY, { maxLinks: 4 })],
    pivots: { rotor: ['x', [0, 0, 0.1]] }, screens: { output: { kind: 'bar', cells: 10, color: 'power' } }, leds: ['coil_glow', 'status'],
  },
  hamster_drive: {
    family: 'drive', cls: 'L', origin: 'bottom', footprint: [3, 3, 2], mass: 3.2, budget: 16000,
    ports: [P('out', 'spin', 'out', 'M', [0.151, 0.084, 0.065], X, { kind: 'axle' })],
    pivots: { wheel: ['y', [0, 0.005, 0.162]], gear_a: ['y'], gear_b: ['y'] }, leds: ['run_timer'], sockets: ['socket_pip', 'socket_pip_exit'],
  },
  turbine: {
    // Brief 3 cells is the swept disc (tip r 0.145); three blades at rest span 2 x 0.145 x cos 30° = 0.25 m.
    family: 'drive', cls: 'M', origin: 'bottom', footprint: [2.5, 4, 1], mass: 1.4, budget: 7000,
    ports: [P('out', 'spin', 'out', 'M', [0, -0.051, 0.034], NY, { kind: 'axle' })],
    pivots: { rotor: ['y', [0, -0.03, 0.25]], bevel_in: ['z'], bevel_out: ['y'] }, leds: ['status'],
  },
  pedal_rig: {
    family: 'drive', cls: 'XL', origin: 'bottom', footprint: [4, 4, 2], mass: 5.0, budget: 15000,
    ports: [P('out', 'spin', 'out', 'M', [-0.13, -0.076, 0.08], NY, { kind: 'axle' }), P('bait', 'tension', 'both', 'S', [0.195, 0, 0.385], X, { kind: 'hook' })],
    pivots: { crank: ['y', [0.03, 0, 0.07]], pedal_l: ['y'], pedal_r: ['y'], flywheel: ['y', [-0.13, 0, 0.08]] }, leds: ['timer', 'lure_seen'],
    sockets: ['socket_pedal_l', 'socket_pedal_r', 'socket_seat', 'socket_grip_l', 'socket_grip_r', 'socket_mount', 'socket_lure_look'],
  },
  puffer: {
    family: 'air', cls: 'M', origin: 'bottom', footprint: [3, 2, 2], mass: 1.6, budget: 7000,
    pivots: { lid: ['y', [0.1, 0, 0.09]] }, leds: ['puff'], clips: ['squeeze'],
    shapeKeys: { sk_squash: ['pleats', 0, 0.05], sk_spring: ['spring', 0, 0.05] },
  },
  cell: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 2, 1], mass: 0.6, budget: 1800,
    ports: [P('out', 'power', 'out', 'S', [0, -0.046, 0.152], NY, { maxLinks: 4 })], screens: { charge: { kind: 'bar', cells: 5, color: 'power' } }, leds: [],
  },
  suncell: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [3, 0.2, 2], mass: 0.7, budget: 1200,
    ports: [P('out', 'power', 'out', 'S', [0.125, -0.075, 0.019], Z)], leds: ['output'],
  },
  lamp: { family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 2, 1], mass: 0.5, budget: 2200, ports: [P('in', 'power', 'in', 'S', [0, -0.046, 0.036], NY)], leds: ['filament'] },
  torch: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [2, 1, 1], mass: 0.4, budget: 2500,
    ports: [P('in', 'signal', 'in', 'S', [-0.015, -0.0335, 0.055], NY)], pivots: { switch: ['z', [-0.03, 0, 0.088]] }, leds: ['lens'],
  },
  burning_glass: { family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 3, 1], mass: 0.6, budget: 2500, ports: [], leds: ['focus'] },
  toggle: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 2, 1], mass: 0.4, budget: 1600,
    // Brief names both outputs `out`; the art names them out_power / out_signal (unique port names; noted for A).
    ports: [P('in', 'power', 'in', 'S', [-0.046, 0, 0.042], NX), P('out_power', 'power', 'out', 'S', [0.046, 0, 0.042], X),
      P('out_signal', 'signal', 'out', 'S', [0, -0.046, 0.042], NY, { maxLinks: 8 })],
    pivots: { lever: ['y', [0, 0, 0.08]] }, leds: ['state'],
  },
  ringer: {
    family: 'power', cls: 'M', origin: 'bottom', footprint: [1, 1, 1], mass: 0.5, budget: 4500,
    ports: [P('out', 'signal', 'out', 'S', [0.046, 0, 0.05], X, { maxLinks: 8 })], pivots: { hammer: ['y', [0, 0, 0.083]] },
    screens: { countdown: { kind: '7seg', digits: 4, color: 'signal' } }, leds: ['armed'],
  },
  delay: {
    family: 'power', cls: 'S', origin: 'bottom', footprint: [1, 1, 1], mass: 0.35, budget: 2400,
    ports: [P('in', 'signal', 'in', 'S', [-0.046, 0, 0.045], NX, { maxLinks: 4 }), P('out', 'signal', 'out', 'S', [0.046, 0, 0.045], X, { maxLinks: 8 })],
    pivots: { escapement: ['y'], knob: ['z'] }, screens: { delay: { kind: '7seg', digits: 3, color: 'signal' } }, leds: ['status', 'progress'],
  },
  t_plunger: {
    family: 'boom', cls: 'M', origin: 'bottom', footprint: [2, 3, 2], mass: 2.5, budget: 7000,
    ports: [P('out', 'signal', 'out', 'M', [0.055, -0.091, 0.075], NY, { maxLinks: 64, broadcast: true })],
    pivots: { plunger: ['z'], pinion: ['x'], armature: ['x'] }, leds: ['armed', 'coil'],
  },
  skyrocket: {
    family: 'boom', cls: 'M', origin: 'com', footprint: [1, 3, 1], mass: 0.3, budget: 4500,
    ports: [P('fuse', 'heat', 'in', 'S', [0, -0.032, -0.045], NY)], leds: ['nozzle_heat'],
  },
  big_top: {
    family: 'boom', cls: 'L', origin: 'bottom', footprint: [6, 4, 4], mass: 18, budget: 24000,
    ports: [P('fuse', 'heat', 'in', 'L', [-0.2, -0.186, 0.1], NY)],
    pivots: { elevation: ['y', [0.06, 0, 0.18]], recoil: [null], ram: [null], wheel_l: ['y', [0.02, 0.197, 0.09]], wheel_r: ['y', [0.02, -0.197, 0.09]], flag: ['y'] },
    clips: ['recoil'], shapeKeys: { sk_iris: ['iris', 0, 0.13] },
  },
  cork_blaster: {
    family: 'boom', cls: 'M', origin: 'bottom', footprint: [3, 1, 1], mass: 0.9, budget: 5500,
    ports: [P('fire', 'signal', 'in', 'S', [-0.03, -0.041, 0.021], NY), P('pull', 'tension', 'in', 'S', [-0.128, 0, 0.06], NX, { kind: 'hook' })],
    pivots: { plunger: ['x'], piston: ['x'] }, leds: ['ready'], shapeKeys: { sk_compress: ['spring', 1, 0.06] },
  },
  punchline: {
    family: 'contraptions', cls: 'M', origin: 'bottom', footprint: [3, 2, 2], mass: 4, budget: 8500,
    ports: [P('trigger', 'signal', 'in', 'M', [-0.1, -0.088, 0.06], NY)], pivots: { ram_1: ['x'], ram_2: ['x'], glove: ['x'] }, leds: ['ready'],
    shapeKeys: { sk_compress: ['spring', 1, 0.07] },
  },
  gotcha_box: {
    family: 'contraptions', cls: 'L', origin: 'bottom', footprint: [2, 2, 2], mass: 3, budget: 14000,
    ports: [P('crank', 'spin', 'in', 'M', [0.035, -0.091, 0.095], NY, { kind: 'axle' })],
    pivots: { crank: ['y'], drum: ['y'], lid: ['x', [0, 0.09, 0.174]], lean: ['x'], spring: ['z'], head: ['y'] }, leds: ['wind'], clips: ['pop', 'reset'],
    shapeKeys: { sk_stretch: ['spring', 0, 0.3] },
  },
  fishbowl: { family: 'contraptions', cls: 'L', origin: 'bottom', footprint: [3, 3, 3], mass: 15, budget: 15000, ports: [], cavities: { water: 'water' } },
};

/** Blender (x, y, z) -> engine Y-up (x, z, -y), as the exporter writes. */
const eng = (v: V3): V3 => [v[0], v[2], -v[1]];
const AXIS: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };

interface RawShapeKey { name: string; mesh: string; lods: number[]; default: number; range: string }
interface RawArt {
  shapeKeys?: RawShapeKey[]; pivots: (RawPivot & { pos: V3; axis: V3 })[]; ports: RawPort[]; sockets?: { name: string; pos: V3 }[]; clips: string[] }

function load(type: string): { a: PartAssets; raw: RawArt; json: { animations?: { name: string; channels: { target: { node: number } }[] }[]; nodes: { name: string }[] } } | null {
  const base = join(BUILD, type, type);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const glb = readFileSync(`${base}.glb`);
  const raw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as RawArt;
  const a = assemblePartAssets(type, glb, raw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  const len = glb.readUInt32LE(12);
  return { a, raw, json: JSON.parse(glb.subarray(20, 20 + len).toString('utf8')) };
}

const types = Object.keys(M2_BRIEFS);
const built = types.filter((t) => load(t) !== null);
const missing = types.filter((t) => !built.includes(t));
if (missing.length) console.warn(`[assets] M2 brief checks skipped for ${missing.join(', ')}: not built (node tools/assets.mjs <type>)`);

describe.skipIf(!built.length)('M2 part art matches its brief (stream E1)', () => {
  it('every M2 build is listed in ART_PARTS', () => {
    for (const t of built) expect(ART_PARTS, t).toContain(t);
  });

  it.each(built)('%s: class, family, origin, footprint, mass and LOD0 budget', (type) => {
    const b = M2_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.class).toBe(b.cls);
    expect(a.art.family).toBe(b.family);
    expect(a.art.origin).toBe(b.origin);
    if (b.footprint) b.footprint.forEach((v, i) => expect(a.art.footprint[i], `footprint[${i}]`).toBeCloseTo(v, 3));
    if (b.mass !== undefined) expect(a.art.massHint).toBeCloseTo(b.mass, 4);
    const t0 = lodStats(a.glb, 0).triangles;
    expect(t0).toBeLessThanOrEqual(b.budget);
    for (const m of a.art.materials) expect(m).toMatch(/^kn_[a-z0-9_]+$/);
    if (b.footprint && b.origin === 'bottom') {
      const s = lodStats(a.glb, 0);
      expect(Math.abs(s.min[1])).toBeLessThanOrEqual(0.0015); // feet on the floor
    }
  });

  it.each(built)('%s: ports as briefed (name, channel, dir, size, place, facing, links, kind)', (type) => {
    const b = M2_BRIEFS[type]!;
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
      if (p.maxLinks !== undefined) expect(got.maxLinks).toBe(p.maxLinks);
      if (p.kind) expect(got.kind).toBe(p.kind);
      if (p.broadcast) expect(got.broadcast).toBe(true);
    }
  });

  it.each(built)('%s: pivots on their brief axes; nested chains resolve', (type) => {
    const b = M2_BRIEFS[type]!;
    const { raw } = load(type)!;
    const names = raw.pivots.map((p) => p.name);
    for (const [name, [axis, at]] of Object.entries(b.pivots ?? {})) {
      const p = raw.pivots.find((x) => x.name === name);
      expect(p, `${type}: PIVOT__${name}`).toBeDefined();
      if (axis) {
        const w = AXIS[axis];
        expect(Math.abs(p!.axis[0] * w[0] + p!.axis[1] * w[1] + p!.axis[2] * w[2]), `${type}.${name} axis`).toBeGreaterThan(0.999);
        if (at) { // distance from the brief point to the pivot's axis line
          const e = eng(at);
          const d = [0, 1, 2].map((i) => e[i]! - p!.pos[i]!);
          const t = d[0]! * w[0] + d[1]! * w[1] + d[2]! * w[2];
          expect(Math.hypot(...d.map((x, i) => x - t * w[i]!)), `${type}.${name} on axis`).toBeLessThanOrEqual(0.002);
        }
      }
    }
    for (const p of raw.pivots) if (p.parent) expect(names, `${type}.${p.name} parent`).toContain(p.parent);
  });

  it.each(built)('%s: screens, LED groups, cavities, sockets', (type) => {
    const b = M2_BRIEFS[type]!;
    const { a, raw } = load(type)!;
    const scr = b.screens ?? {};
    expect(a.art.screens.map((s) => s.name).sort()).toEqual(Object.keys(scr).sort());
    for (const [name, s] of Object.entries(scr)) {
      const got = a.art.screens.find((x) => x.name === name)!;
      expect(got.kind).toBe(s.kind);
      expect(got.color).toBe(s.color);
      if (s.digits !== undefined) expect(got.digits).toBe(s.digits);
      if (s.cells !== undefined) expect(got.cells).toBe(s.cells);
    }
    if (b.leds) expect(a.art.ledGroups.map((g) => g.name).sort()).toEqual([...b.leds].sort());
    for (const [name, matter] of Object.entries(b.cavities ?? {})) {
      expect(a.art.cavities.find((c) => c.name === name)?.matter, `${type} CAVITY__${name}`).toBe(matter);
    }
    const sockets = (raw.sockets ?? []).map((s) => s.name);
    for (const s of b.sockets ?? []) expect(sockets, `${type} sockets`).toContain(s);
  });

  it.each(built)('%s: baked clips are listed and exported as glTF animations on pivots (every LOD)', (type) => {
    const b = M2_BRIEFS[type]!;
    const { a, json } = load(type)!;
    expect([...a.art.clips].sort()).toEqual([...(b.clips ?? [])].sort());
    const anims = json.animations ?? [];
    for (const c of b.clips ?? []) {
      const anim = anims.find((x) => x.name === `${type}__${c}`);
      expect(anim, `${type}__${c}`).toBeDefined();
      const targets = anim!.channels.map((ch) => json.nodes[ch.target.node]!.name);
      expect(targets.every((n) => n.startsWith('PIVOT__'))).toBe(true);
      for (let lod = 1; lod < 4; lod++) expect(targets.some((n) => n.endsWith(`__L${lod}`)), `${type}__${c} LOD${lod}`).toBe(true);
    }
  });

  it.each(built)('%s: shape keys are glTF morph targets on the briefed piece at LOD0/1 only, listed in .art.json', (type) => {
    const want = M2_BRIEFS[type]!.shapeKeys ?? {};
    const { a, raw } = load(type)!;
    expect((raw.shapeKeys ?? []).map((k) => k.name).sort()).toEqual(Object.keys(want).sort());
    for (const m of a.glb.meshes) if (m.lod >= 2) expect(m.targetNames, `${m.nodeName}: morphs at LOD${m.lod}`).toEqual([]);
    for (const [name, [piece, def, delta]] of Object.entries(want)) {
      const k = raw.shapeKeys!.find((x) => x.name === name)!;
      expect(k.mesh).toBe(`${type}__${piece}`);
      expect(k.lods).toEqual([0, 1]);
      expect(k.default).toBe(def);
      expect(k.range.length).toBeGreaterThan(10);
      for (const node of [`${type}__${piece}`, `${type}__${piece}__L1`]) {
        const m = a.glb.meshes.find((x) => x.nodeName === node);
        expect(m, node).toBeDefined();
        const ti = m!.targetNames.indexOf(name);
        expect(ti, `${node} ${name}`).toBeGreaterThanOrEqual(0);
        expect(m!.targetWeights[ti]).toBeCloseTo(def, 4);
        let big = 0;
        for (const p of m!.primitives) {
          const d = p.targets[ti]?.positions;
          expect(d, `${node} ${name} positions`).toBeTruthy();
          for (let v = 0; v < d!.length; v += 3) big = Math.max(big, Math.hypot(d![v]!, d![v + 1]!, d![v + 2]!));
        }
        expect(big, `${node} ${name} largest delta`).toBeGreaterThan(delta * 0.75);
        expect(big, `${node} ${name} largest delta`).toBeLessThan(delta * 1.25);
      }
    }
  });

  it.each(built.filter((t) => M2_BRIEFS[t]!.sphere))('%s: roller collider is the briefed sphere', (type) => {
    const s = M2_BRIEFS[type]!.sphere!;
    const { a } = load(type)!;
    expect(a.shapes.shapes).toHaveLength(1);
    const sh = a.shapes.shapes[0]!;
    expect(sh.kind).toBe('sphere');
    if (sh.kind === 'sphere') expect(sh.radius).toBeCloseTo(s.radius, 3);
    expect(sh.phys).toBe(s.phys);
    if (s.restitution !== undefined) expect(sh.restitution).toBeCloseTo(s.restitution, 3);
    if (s.friction !== undefined) expect(sh.friction).toBeCloseTo(s.friction, 3);
    for (const p of sh.pos) expect(Math.abs(p)).toBeLessThan(1e-4);
  });
});
