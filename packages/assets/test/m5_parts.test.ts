// M5 part art (stream E5a) against its briefs (docs/art/briefs/{future,boom,drive,matter,critters}.md).
// parts.test.ts compares every ART_PARTS build with its parts-data def; this file pins the brief contract itself: class,
// family, origin, footprint, mass, LOD0 budget, ports (Blender brief coordinates converted to engine Y-up), pivots on
// their brief axes and their nesting, screens, LED groups, clips, device sockets, the resizable kit pieces (FORCE WALL,
// STASIS FIELD) and their collision against defs_m5.ts, the clear apertures (RIFT GATES, COILGUN RING), GOO VAT's
// cavity with its fill LUT, and the D78 texture set with its KTX2 (BC7) encode on every part. Parts whose build is
// missing are skipped with a message (node tools/assets.mjs <type> --tex --ktx2).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_PARTS } from '../../../apps/game/src/artlist.ts';
import { partDef, propValues } from '../../parts-data/src/index.ts';
import { assemblePartAssets, lodStats, type ArtCavity, type PartAssets } from '../src/index.ts';
import { poseAtZero, type RawPivot, type RawPort } from './pivot_pose.ts';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'build', 'parts');

type V3 = readonly [number, number, number];
type Axis = 'x' | 'y' | 'z';
interface BriefPort { name: string; channel: string; dir: 'in' | 'out' | 'both'; size: 'S' | 'M' | 'L'; at: V3; facing: V3 }
interface Brief {
  family: string; cls: 'S' | 'M' | 'L'; origin: string; footprint: V3; mass: number; budget: number;
  ports?: BriefPort[];
  /** pivot name -> [Blender axis, optional point on the axis (Blender), optional parent pivot] */
  pivots?: Record<string, [Axis, (V3 | undefined)?, string?]>;
  screens?: Record<string, { kind: string; color: string; digits?: number; cells?: number }>;
  leds?: string[];
  clips?: string[];
  sockets?: Record<string, V3>;
  /** cavity -> [matter, litres min, litres max] */
  cavities?: Record<string, [string, number, number]>;
}

const NY: V3 = [0, -1, 0], Z: V3 = [0, 0, 1];
const P = (name: string, channel: string, dir: BriefPort['dir'], size: BriefPort['size'], at: V3, facing: V3): BriefPort =>
  ({ name, channel, dir, size, at, facing });

// Brief values (Blender metres: +X right, +Y back, +Z up). Budgets are LOD0 tris without linked port rings. Port names
// follow defs_m5.ts (GRABBER's signal input is `go`).
export const M5_BRIEFS: Record<string, Brief> = {
  rift_gate: {
    family: 'future', cls: 'L', origin: 'bottom', footprint: [4, 4, 0.5], mass: 4.5, budget: 12000, ports: [],
    pivots: { trim_ring: ['y', [0, -0.010, 0.205]] },
    screens: { membrane: { kind: 'icon', color: 'plasma' } }, leds: ['pair_ring', 'cooldown'],
  },
  // footprint h 1.5: the resting orb tops out at z 0.160 (brief 0.18 with the orb lifted)
  grav_well: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [2, 1.5, 2], mass: 3, budget: 6500,
    ports: [P('in', 'power', 'in', 'M', [0.055, -0.100, 0.025], NY)],
    pivots: { orb_lift: ['z', [0, 0, 0.115]], orb_spin: ['z', [0, 0, 0.115], 'orb_lift'] },
    leds: ['seam', 'tips', 'mode_ring'],
  },
  tractor_beam: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [1, 1, 3], mass: 2, budget: 5500,
    ports: [P('in', 'power', 'in', 'M', [0, 0.070, 0.100], Z)], pivots: { dish_spin: ['y', [0, -0.145, 0.060]] },
    leds: ['lens_rings', 'mode', 'load'],
  },
  hover_pad: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [3, 0.5, 3], mass: 2.5, budget: 4500,
    ports: [P('in', 'power', 'in', 'S', [0.100, -0.150, 0.026], NY)],
    screens: { load: { kind: 'bar', color: 'plasma', cells: 6 } }, leds: ['edge_strip', 'thrusters'],
  },
  // built at the def default W 0.6 x H 0.4
  force_wall: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [6, 4, 0.5], mass: 1.2, budget: 4000,
    ports: [P('toggle', 'signal', 'in', 'S', [-0.28, -0.025, 0.022], NY)], leds: ['emitter_strips', 'caps'],
  },
  coilgun_ring: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [3, 3, 1], mass: 4, budget: 9500,
    ports: [P('in', 'power', 'in', 'M', [0.050, -0.050, 0.025], NY)],
    screens: { charge: { kind: 'bar', color: 'power', cells: 8 } }, leds: ['bore_chase'],
  },
  // built at the def default 0.5 x 0.5 x 0.5
  stasis_field: {
    family: 'future', cls: 'M', origin: 'bottom', footprint: [5, 0.5, 5], mass: 1.6, budget: 7000,
    ports: [P('in', 'power', 'in', 'S', [-0.23, -0.25, 0.030], NY)], leds: ['nodes', 'rail_dashes'],
  },
  buzz_beacon: {
    family: 'future', cls: 'S', origin: 'bottom', footprint: [2, 0.5, 2], mass: 0.4, budget: 2500,
    ports: [P('call', 'signal', 'in', 'S', [0, -0.100, 0.022], NY)], leds: ['pair_ring'],
    sockets: { socket_dock: [0, 0, 0.040] },
  },
  singularity: {
    family: 'boom', cls: 'L', origin: 'bottom', footprint: [2, 2, 2], mass: 7, budget: 16000,
    ports: [P('arm', 'signal', 'in', 'M', [0.06, -0.101, 0.027], NY)],
    pivots: { ring_outer: ['z', [0, 0, 0.115]], ring_inner: ['x', [0, 0, 0.115], 'ring_outer'] },
    screens: { countdown: { kind: '7seg', color: 'field', digits: 2 } }, leds: ['containment', 'charge', 'status', 'core'],
    clips: ['collapse'],
  },
  grabber: {
    family: 'drive', cls: 'L', origin: 'bottom', footprint: [2, 5, 2], mass: 3.5, budget: 20000,
    ports: [P('in', 'power', 'in', 'M', [-0.045, -0.096, 0.032], NY), P('go', 'signal', 'in', 'S', [0.050, -0.096, 0.032], NY)],
    pivots: {
      yaw: ['z', [0, 0, 0]], shoulder: ['x', [0, 0, 0.10], 'yaw'], elbow: ['x', [0, 0, 0.27], 'shoulder'],
      wrist_pitch: ['x', [0, 0, 0.42], 'elbow'], wrist_roll: ['z', [0, 0, 0.42], 'wrist_pitch'],
      finger_l: ['x', undefined, 'wrist_roll'], finger_r: ['x', undefined, 'wrist_roll'],
    },
    leds: ['status', 'holding', 'zone_a', 'zone_b'], clips: ['idle', 'park', 'shrug'],
    sockets: { socket_grip: [0, 0, 0.4725], socket_tip: [0, 0, 0.495] },
  },
  goo_vat: {
    family: 'matter', cls: 'M', origin: 'bottom', footprint: [3, 3, 3], mass: 6, budget: 7500,
    ports: [P('open', 'signal', 'in', 'M', [0.075, -0.14, 0.032], NY)],
    pivots: { stirrer: ['z', [0, 0, 0.17]], valve_lever: ['x', [0, -0.141, 0.112]] },
    screens: { level: { kind: 'bar', color: 'fluid', cells: 10 } }, leds: ['valve_open'], cavities: { goo: ['goo', 8.8, 9.4] },
  },
};

/** Blender (x, y, z) -> engine Y-up (x, z, -y), as the exporter writes. */
const eng = (v: V3): V3 => [v[0], v[2], -v[1]];
const AXIS: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
const UV_EXEMPT = /^kn_(poly_|glass|chrome|led|screen|decal|interior_)/;

interface RawSocket { name: string; pos: V3; rot: [number, number, number, number]; follow?: string }
interface RawArt {
  pivots: (RawPivot & { pos: V3; axis: V3; min?: number; max?: number; parent?: string; rest?: number })[];
  ports: RawPort[]; sockets?: RawSocket[];
  textures?: { size: number; ktx2?: { albedo: string; normal: string; orm: string; format: string } };
}

function load(type: string): { a: PartAssets; raw: RawArt } | null {
  const base = join(BUILD, type, type);
  if (![`${base}.glb`, `${base}.art.json`, `${base}.shapes.json`].every((p) => existsSync(p))) return null;
  const raw = JSON.parse(readFileSync(`${base}.art.json`, 'utf8')) as RawArt;
  const a = assemblePartAssets(type, readFileSync(`${base}.glb`), raw, JSON.parse(readFileSync(`${base}.shapes.json`, 'utf8')));
  return { a, raw };
}

/** Volume of the closed cavity mesh below the plane y = h (engine Y-up): the same exact integral as cavity.py. */
function volumeBelow(c: ArtCavity, h: number): number {
  const v = c.mesh!.vertices, ix = c.mesh!.indices;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
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

/** Every LOD0 vertex of the meshes not drawn with the given masters (engine space). */
function lod0Verts(a: PartAssets, skip: RegExp = /^kn_screen$/): number[][] {
  const out: number[][] = [];
  for (const m of a.glb.meshes.filter((x) => x.lod === 0)) {
    for (const p of m.primitives) {
      if (skip.test(a.glb.materials[p.material]?.name ?? '')) continue;
      for (let i = 0; i < p.vertexCount; i++) out.push([p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!]);
    }
  }
  return out;
}

const types = Object.keys(M5_BRIEFS);
const built = types.filter((t) => load(t) !== null);
const missing = types.filter((t) => !built.includes(t));
if (missing.length) console.warn(`[assets] M5 brief checks skipped for ${missing.join(', ')}: not built (node tools/assets.mjs <type> --tex --ktx2)`);

describe.skipIf(!built.length)('M5 part art matches its brief (stream E5a)', () => {
  it('every M5 build is listed in ART_PARTS', () => {
    for (const t of built) expect(ART_PARTS, t).toContain(t);
  });

  it.each(built)('%s: class, family, origin, footprint, mass and LOD0 budget', (type) => {
    const b = M5_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.class).toBe(b.cls);
    expect(a.art.family).toBe(b.family);
    expect(a.art.origin).toBe(b.origin);
    b.footprint.forEach((v, i) => expect(a.art.footprint[i], `footprint[${i}]`).toBeCloseTo(v, 3));
    expect(a.art.massHint).toBeCloseTo(b.mass, 4);
    expect(lodStats(a.glb, 0).triangles).toBeLessThanOrEqual(b.budget);
    for (const m of a.art.materials) expect(m).toMatch(/^kn_[a-z0-9_]+$/);
    expect(Math.abs(lodStats(a.glb, 0).min[1])).toBeLessThanOrEqual(0.0015); // on the floor
  });

  it.each(built)('%s: ports as briefed (name, channel, dir, size, place, facing)', (type) => {
    const b = M5_BRIEFS[type]!;
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
      expect(got.maxLinks ?? 1).toBe(1);
    }
  });

  it.each(built)('%s: pivots on their brief axes, nested as briefed', (type) => {
    const { raw } = load(type)!;
    const want = M5_BRIEFS[type]!.pivots ?? {};
    expect(raw.pivots.map((p) => p.name).sort()).toEqual(Object.keys(want).sort());
    for (const [name, [axis, at, parent]] of Object.entries(want)) {
      const p = raw.pivots.find((x) => x.name === name)!;
      const w = AXIS[axis];
      expect(Math.abs(p.axis[0] * w[0] + p.axis[1] * w[1] + p.axis[2] * w[2]), `${type}.${name} axis`).toBeGreaterThan(0.999);
      if (at) {
        const e = eng(at);
        const d = [0, 1, 2].map((i) => e[i]! - p.pos[i]!);
        const t = d[0]! * w[0] + d[1]! * w[1] + d[2]! * w[2];
        expect(Math.hypot(...d.map((x, i) => x - t * w[i]!)), `${type}.${name} on axis`).toBeLessThanOrEqual(0.002);
      }
      expect(p.parent, `${type}.${name} parent`).toBe(parent);
    }
  });

  it.each(built)('%s: screens, LED groups and clips', (type) => {
    const b = M5_BRIEFS[type]!;
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
    expect([...a.art.clips].sort()).toEqual([...(b.clips ?? [])].sort());
    for (const c of b.clips ?? []) expect(a.glb.animations.map((x) => x.name), `${type}__${c}`).toContain(`${type}__${c}`);
  });

  it.each(built.filter((t) => M5_BRIEFS[t]!.sockets))('%s: device sockets (ASSET_PIPELINE §3.9)', (type) => {
    const { raw } = load(type)!;
    for (const [name, at] of Object.entries(M5_BRIEFS[type]!.sockets!)) {
      const s = raw.sockets!.find((x) => x.name === name)!;
      expect(s, `${type} ${name}`).toBeDefined();
      const e = eng(at);
      for (let i = 0; i < 3; i++) expect(s.pos[i]!, `${type}.${name} pos[${i}]`).toBeCloseTo(e[i]!, 3);
    }
  });

  it.skipIf(!built.includes('buzz_beacon'))('buzz_beacon: socket_dock on the pad top faces the port side (+X -> engine +Z, defs_m5 BEACON)', () => {
    const { raw } = load('buzz_beacon')!;
    const s = raw.sockets!.find((x) => x.name === 'socket_dock')!;
    const [x, y, z, w] = s.rot;
    // the quaternion's local +X in engine space
    const ax = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    expect(ax[2]).toBeCloseTo(1, 4);
    expect(s.pos[1]).toBeCloseTo(0.04, 4);
  });

  it.skipIf(!built.includes('grabber'))('grabber: park pose stays within 0.5 m; tips at z 0.495; fingers slide apart about the default grip', () => {
    const { a, raw } = load('grabber')!;
    expect(lodStats(a.glb, 0).max[1]).toBeLessThanOrEqual(0.5);
    expect(lodStats(a.glb, 0).max[1]).toBeGreaterThan(0.49);
    const fl = raw.pivots.find((p) => p.name === 'finger_l')!, fr = raw.pivots.find((p) => p.name === 'finger_r')!;
    expect(fl.rest).toBeCloseTo(0.03, 6);
    expect(fr.rest).toBeCloseTo(0.03, 6);
    expect(fl.min).toBeCloseTo(0.01, 6);
    expect(fl.max).toBeCloseTo(0.04, 6);
    expect(fl.axis[0] * fr.axis[0]).toBeCloseTo(-1, 4); // opposite slide directions
    const cols = a.shapes.shapes.map((s) => s.name).sort();
    expect(cols).toEqual(['finger_l', 'finger_r', 'fore', 'gripper', 'plinth', 'turntable', 'upper'].sort());
  });

  it.each(built.filter((t) => t === 'force_wall' || t === 'stasis_field'))('%s: resizable kit pieces are separate nodes in every LOD; collision matches defs_m5 at the default size', (type) => {
    const { a } = load(type)!;
    const pieces = type === 'force_wall'
      ? ['base_l', 'column_l', 'cap_l', 'base_r', 'column_r', 'cap_r', 'field']
      : ['node_fl', 'node_fr', 'node_bl', 'node_br', 'rail_front', 'rail_back', 'rail_left', 'rail_right'];
    for (let lod = 0; lod < 4; lod++) {
      const names = a.glb.meshes.filter((m) => m.lod === lod).map((m) => m.nodeName);
      for (const p of pieces) expect(names, `LOD${lod}`).toContain(`${type}__${p}${['', '__L1', '__L2', '__L3'][lod]}`);
    }
    const def = partDef(type);
    if (!def?.shapes) return; // A5's def not landed yet
    const want = def.shapes(propValues(def));
    const got = a.shapes.shapes;
    expect(got).toHaveLength(want.length);
    for (const s of want) {
      const hit = got.find((g) => g.kind === 'box' && [0, 1, 2].every((i) => Math.abs(g.pos[i]! - s.at![i]!) < 0.001 &&
        Math.abs(g.halfExtents[i]! * 2 - s.size[i]!) < 0.001));
      expect(hit, `${type}: def shape ${JSON.stringify(s)}`).toBeDefined();
    }
  });

  it.skipIf(!built.includes('force_wall'))('force_wall: the field surface spans the column inner faces with 0-1 UVs', () => {
    const { a } = load('force_wall')!;
    const m = a.glb.meshes.find((x) => x.nodeName === 'force_wall__field')!;
    const p = m.primitives[0]!;
    expect(a.glb.materials[p.material]!.name).toBe('kn_poly_plasma');
    const xs = [], ys = [];
    for (let i = 0; i < p.vertexCount; i++) { xs.push(p.positions[i * 3]!); ys.push(p.positions[i * 3 + 1]!); }
    expect(Math.min(...xs)).toBeCloseTo(-0.268, 3); // W/2 - 0.032
    expect(Math.max(...xs)).toBeCloseTo(0.268, 3);
    expect(Math.min(...ys)).toBeCloseTo(0.04, 3);
    expect(Math.max(...ys)).toBeCloseTo(0.385, 3); // H - 0.015
    const us = Array.from(p.uvs!);
    expect(Math.min(...us)).toBeCloseTo(0, 5);
    expect(Math.max(...us)).toBeCloseTo(1, 5);
  });

  it.skipIf(!built.includes('rift_gate'))('rift_gate: the Ø 0.31 aperture is clear in front of the backplate (every Roller passes)', () => {
    const { a } = load('rift_gate')!;
    for (const [x, y, z] of lod0Verts(a) as [number, number, number][]) {
      if (z < -0.018 && z > -0.035) continue; // the backplate (engine z = -y) closes the back
      if (z <= -0.035 || z >= 0.03) continue;
      expect(Math.hypot(x!, y! - 0.205), `vertex ${x},${y},${z}`).toBeGreaterThanOrEqual(0.1545);
    }
  });

  it.skipIf(!built.includes('coilgun_ring'))('coilgun_ring: the Ø 0.16 bore is clear', () => {
    const { a } = load('coilgun_ring')!;
    for (const [x, y, z] of lod0Verts(a) as [number, number, number][]) {
      if (Math.abs(z!) > 0.041 || y! < 0.06) continue;
      expect(Math.hypot(x!, y! - 0.1575), `vertex ${x},${y},${z}`).toBeGreaterThanOrEqual(0.0795);
    }
  });

  it.each(built.filter((t) => M5_BRIEFS[t]!.cavities))('%s: cavities carry the fill-pass data (closed mesh, 64-entry LUT that matches the mesh volume)', (type) => {
    const b = M5_BRIEFS[type]!;
    const { a } = load(type)!;
    expect(a.art.cavities.map((c) => c.name).sort()).toEqual(Object.keys(b.cavities!).sort());
    for (const [name, [matter, lo, hi]] of Object.entries(b.cavities!)) {
      const c = a.art.cavities.find((x) => x.name === name)!;
      expect(c.matter).toBe(matter);
      expect(c.capacity).toBe(9);
      expect(c.volume!).toBeGreaterThanOrEqual(lo);
      expect(c.volume!).toBeLessThanOrEqual(hi);
      const lut = c.lut!;
      expect(lut).toHaveLength(64);
      for (let i = 1; i < 64; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
      const ix = c.mesh!.indices, edges = new Map<string, number>();
      for (let t = 0; t < ix.length; t += 3) {
        for (let k = 0; k < 3; k++) { const key = `${ix[t + k]}>${ix[t + (k + 1) % 3]}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
      }
      for (const [key, n] of edges) {
        const [p, q] = key.split('>');
        expect(n).toBe(1);
        expect(edges.get(`${q}>${p}`)).toBe(1);
      }
      const total = Math.abs(volumeBelow(c, c.max![1] + 1));
      expect(total * 1000).toBeCloseTo(c.volume!, 2);
      for (const i of [16, 32, 48]) expect(Math.abs(volumeBelow(c, lut[i]!)) / total, `${type}.${name} lut[${i}]`).toBeCloseTo(i / 63, 2);
    }
  });

  it.each(built)('%s: D78 texture set (albedo / normal / ORM + BC7 KTX2) on every textured LOD0 primitive', (type) => {
    const { a, raw } = load(type)!;
    const t = a.art.textures;
    expect(t, `${type}: node tools/assets.mjs ${type} --tex --ktx2`).toBeDefined();
    expect(t!.size).toBe(a.art.class === 'S' ? 1024 : 2048);
    for (const f of [t!.albedo, t!.normal, t!.orm]) expect(existsSync(join(BUILD, type, f)), f).toBe(true);
    const k = raw.textures!.ktx2!;
    expect(k, `${type}: --ktx2`).toBeDefined();
    expect(k.format).toBe('bc7');
    for (const f of [k.albedo, k.normal, k.orm]) expect(existsSync(join(BUILD, type, f)), f).toBe(true);
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
