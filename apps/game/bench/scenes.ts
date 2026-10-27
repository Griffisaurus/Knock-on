// Benchmark scenes (GAME_SPEC §13, PRODUCTION §2 M3 exit): "Kiloton", "Domino Day" and generated N-part worlds
// for the load-time target. Pure functions of their arguments: the same call always builds the same world, so
// the shipped demo files, the Node sim bench and the browser harness all run identical machines.

import {
  EMPTY_WORLD, makeId, metresToPos, snappedEuler, type EnvSettings, type LinkRecord, type PartRecord, type Rotation, type WorldSnapshot,
} from '@knockon/format';
import { partDef, propSteps } from '@knockon/parts-data';
import { DEMOS } from '../../../packages/parts-data/src/demos.ts'; // RENDER (beta polish)
import { sandstorm, type SandstormOptions } from '@knockon/sim'; // MI (M4)

class Builder {
  readonly parts: PartRecord[] = [];
  readonly links: LinkRecord[] = [];
  private n = 0;
  add(type: string, x: number, y: number, z: number, rot: Rotation = { tag: 0 }, props: Readonly<Record<string, number>> = {}): number {
    const def = partDef(type);
    if (!def) throw new Error(`unknown part ${type}`);
    const id = makeId(1, ++this.n);
    const list = Object.entries(props).map(([k, v]) => propSteps(def, k, v)).sort((a, b) => a[0] - b[0]);
    this.parts.push({ id, type, pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot, flags: 0, ...(list.length ? { props: list } : {}) });
    return id;
  }
  link(kind: LinkRecord['kind'], from: number, fromPort: string, to: number, toPort: string): number {
    const port = (id: number, name: string): number => partDef(this.parts.find((p) => p.id === id)!.type)!.ports.findIndex((x) => x.name === name);
    const id = makeId(1, ++this.n);
    this.links.push({ id, kind, from: { part: from, port: port(from, fromPort) }, to: { part: to, port: port(to, toPort) }, via: [], points: [], length: 0 });
    return id;
  }
  world(title: string, env: Partial<EnvSettings>): WorldSnapshot {
    return { ...EMPTY_WORLD, title, env: { ...EMPTY_WORLD.env, ...env }, parts: this.parts, links: this.links, counters: { 1: this.n } };
  }
}

/** POWDER KEG is stream A3's; until it lands the keg is a BANGSTICK stand-in (same sympathetic chain). */
export function kegType(): string { return partDef('powder_keg') ? 'powder_keg' : 'bangstick'; }

/**
 * "Kiloton": 400 BANGSTICKs and 60 POWDER KEGs in a BRIK fortress inside an Arena. A lit WICK burns a FUSE
 * into the first bangstick; the charges sit ≤ 0.6 m apart in rings along the walls and a central magazine, so
 * each blast sets off its neighbours (SIMULATION §6.1 sympathetic detonation) and the wave runs round the fort.
 */
export function kiloton(): WorldSnapshot {
  const b = new Builder();
  const half = 7; // a 14 × 14 m keep
  const courses = 8; // 0.8 m walls
  const brickL = 0.2, brickH = 0.1;
  // walls: running bond, one brick thick, gate gap on the front (+Z) face
  for (let c = 0; c < courses; c++) {
    const y = brickH / 2 + c * brickH;
    const off = (c % 2) * (brickL / 2);
    for (let s = 0; s < 4; s++) {
      const n = Math.round((half * 2) / brickL);
      for (let i = 0; i < n; i++) {
        const t = -half + off + brickL / 2 + i * brickL;
        if (t + brickL / 2 > half + 1e-6) continue;
        if (s === 0 && Math.abs(t) < 0.8) continue; // the gate
        if (Math.abs(t) > half - 0.8) continue; // the corner towers stand here
        const yaw = s % 2 === 0 ? 0 : 90;
        const [x, z] = s === 0 ? [t, half] : s === 1 ? [half, t] : s === 2 ? [t, -half] : [-half, t];
        b.add('brik', x, y, z, snappedEuler(yaw, 0, 0));
      }
    }
  }
  // corner towers: 1.2 m square, 16 courses
  for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
    for (let c = 0; c < 16; c++) {
      const y = brickH / 2 + c * brickH;
      for (let i = 0; i < 6; i++) {
        const t = -0.6 + 0.1 + i * 0.2;
        b.add('brik', cx + t, y, cz - 0.6 - 0.05, snappedEuler(0, 0, 0));
        b.add('brik', cx + t, y, cz + 0.6 + 0.05, snappedEuler(0, 0, 0));
        b.add('brik', cx - 0.6 - 0.05, y, cz + t, snappedEuler(90, 0, 0));
        b.add('brik', cx + 0.6 + 0.05, y, cz + t, snappedEuler(90, 0, 0));
      }
    }
  }
  // charges: a ring 1.2 m inside the walls (0.45 m apart) and a courtyard grid (0.5 × 0.75 m), all within the
  // 0.72 m sympathetic reach of a neighbour, so one blast walks through all 400
  const charges: [number, number][] = [];
  const ring = half - 1.2;
  for (let s = 0; s < 4; s++) {
    for (let t = -ring; t < ring - 1e-6; t += 0.45) charges.push(s === 0 ? [t, ring] : s === 1 ? [ring, -t] : s === 2 ? [-t, -ring] : [-ring, t]);
  }
  for (let z = -5.25; z <= 5.25 + 1e-6 && charges.length < 400; z += 0.75) {
    for (let x = -5; x <= 5 + 1e-6 && charges.length < 400; x += 0.5) charges.push([x, z]);
  }
  const sticks = charges.map(([x, z]) => b.add('bangstick', x, 0.039, z, { tag: 0 }, { fuse: 2 }));
  // kegs: 8 in each corner tower (a 3 × 3 floor layout inside its 1.2 m well) and 7 along each wall
  const keg = kegType();
  const ky = keg === 'bangstick' ? 0.039 : -(partDef(keg)!.bounds.min[1]) + 0.001;
  const kegs: number[] = [];
  for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
    for (let i = 0; i < 8; i++) kegs.push(b.add(keg, cx + (i % 3 - 1) * 0.35, ky, cz + (Math.floor(i / 3) - 1) * 0.3));
  }
  for (let s = 0; s < 4; s++) {
    for (let t = -4.8; t <= 4.8 + 1e-6; t += 1.6) {
      const d = half - 0.55;
      kegs.push(b.add(keg, s === 0 ? t : s === 1 ? d : s === 2 ? -t : -d, ky, s === 0 ? d : s === 1 ? -t : s === 2 ? -d : t, snappedEuler(s % 2 ? 90 : 0, 0, 0)));
    }
  }
  // ignition: a lit wick beside the first ring charge, its fuse into that charge (a 2 s stub)
  const [fx, fz] = charges[0]!;
  const wick = b.add('wick', fx + 0.35, 0, fz + 0.25, { tag: 0 }, { lit: 1 });
  b.link('fuse', wick, 'flame', sticks[0]!, 'fuse');
  void kegs;
  return b.world('Kiloton', { preset: 'arena', environment: 'studio' });
}

/**
 * "Domino Day": `count` TOPPLE TILES across a Megastructure: `lanes` straight lanes `gap` metres apart (768 m of
 * front by default), each run toward −Z and started by a BRIK stood on end leaning 35° (past its 27° tipping point)
 * onto its first tile. Tile spacing 0.1 m (2/3 of the 0.15 m height).
 *
 * Every `segment` tiles a BOING sits in the lane as a relay: the last tile knocks it on into the next segment. Jolt
 * puts a contact island to sleep only as a whole, and fallen tiles lean on each other, so an unbroken lane stays
 * awake from its first tile to the wave front (100k awake bodies by the end). The ball leaves the old segment
 * behind, which then sleeps, so each lane only keeps its current segment awake (measured: 4–60 awake per lane).
 */
export function dominoDay(count = 100_000, lanes = 64, gap = 12, segment = 40): WorldSnapshot {
  const b = new Builder();
  const spacing = 0.1, y = 0.075, r = 0.12; // BOING radius
  for (let l = 0; l < lanes; l++) {
    const x = -((lanes - 1) * gap) / 2 + l * gap;
    const per = Math.floor(count / lanes) + (l < count % lanes ? 1 : 0);
    const relays = Math.floor((per - 1) / segment);
    const len = (per - 1 - relays) * spacing + relays * (0.015 + 0.03 + 2 * r + 0.15 + 0.015);
    let z = len / 2;
    // TOPPLE TILES start asleep (they only move when hit), so the brick does the first push
    b.add('brik', x, 0.105, z + 0.13, snappedEuler(0, -35, 90));
    for (let i = 0; i < per; i++) {
      if (i > 0 && i % segment === 0) {
        z += spacing; // back to the last tile, then: 3 cm gap, the ball, 15 cm gap
        z -= 0.015 + 0.03 + r;
        b.add('boing', x, r, z);
        z -= r + 0.15 + 0.015;
      }
      b.add('topple_tile', x, y, z, snappedEuler(90, 0, 0));
      z -= spacing;
    }
  }
  return b.world('Domino Day', { preset: 'megastructure', environment: 'studio' });
}

/**
 * A generated world of `count` parts for the load-time target (GAME_SPEC §5.3: 1M parts on a Megastructure): a
 * 1 km grid of mixed static and dynamic parts, mostly asleep (BRIK, TOPPLE TILES, BOING, THUD, SLOPE, LEDGE; jittered and yawed, never overlapping),
 * the way a big build is: 99 % of it at rest.
 */
export function bigWorld(count = 1_000_000, preset: 'megastructure' | 'arena' | 'warehouse' | 'room' = 'megastructure', environment = 'studio'): WorldSnapshot {
  const b = new Builder();
  const types = ['brik', 'topple_tile', 'boing', 'ledge', 'slope', 'thud'] as const;
  const side = Math.ceil(Math.sqrt(count));
  const span = { megastructure: 960, arena: 240, warehouse: 60, room: 15 }[preset]; // T5 (M5): + Warehouse, Room (each tier's max world)
  const step = span / side;
  // a lattice hash for jitter, so the file compresses like a real build (~5 B per part), not like a perfect grid
  const h = (i: number, k: number): number => { let x = Math.imul(i ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  for (let i = 0; i < count; i++) {
    const ix = i % side, iz = Math.floor(i / side);
    const type = types[Math.floor(h(i, 1) * types.length)]!;
    const def = partDef(type)!;
    const yh = -def.bounds.min[1];
    const jx = (h(i, 2) - 0.5) * step * 0.3, jz = (h(i, 3) - 0.5) * step * 0.3;
    b.add(type, -span / 2 + ix * step + jx, yh + 0.001, -span / 2 + iz * step + jz, snappedEuler(Math.floor(h(i, 4) * 24) * 15, 0, 0));
  }
  return b.world(`${count.toLocaleString('en-US')} parts`, { preset, environment });
}

/**
 * T5 (M5): the awake-body ceiling scene (GAME_SPEC §5.3 footnote). `count` loose bodies (THUD, BOING, TOPPLE TILES,
 * jittered and tilted) in `layers` lattice layers 0.3 m apart over the floor, dropped at once: every body is awake
 * from tick 0 while they fall, land, collide and pile, then they settle and sleep. Nothing breaks (no BRIKs), so the
 * body count stays `count`.
 */
export function awakePile(count = 10_000, layers = 8, preset: 'arena' | 'megastructure' = 'arena'): WorldSnapshot {
  const b = new Builder();
  const types = ['thud', 'boing', 'topple_tile'] as const;
  const per = Math.ceil(count / layers);
  const side = Math.ceil(Math.sqrt(per));
  const step = 0.32;
  const h = (i: number, k: number): number => { let x = Math.imul(i ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  for (let i = 0; i < count; i++) {
    const l = Math.floor(i / per), k = i % per, ix = k % side, iz = Math.floor(k / side);
    const type = types[Math.floor(h(i, 1) * types.length)]!;
    const x = (ix - side / 2) * step + (h(i, 2) - 0.5) * 0.06, z = (iz - side / 2) * step + (h(i, 3) - 0.5) * 0.06;
    b.add(type, x, 0.2 + l * 0.3, z, snappedEuler(Math.floor(h(i, 4) * 24) * 15, Math.floor(h(i, 5) * 6) * 15, 0));
  }
  return b.world(`${count.toLocaleString('en-US')} awake`, { preset, environment: 'studio' });
}

/**
 * MI (M4): "Sandstorm" as a full rigid + Matter world (GAME_SPEC §13, M4 exit): WATERWHEELs in a valley under GRIT
 * HOPPERs (packages/sim/src/matter/sandstorm.ts). Full scale: 4 × 1M grains = the 16 GB tier's 4M. Matter gameplay on.
 */
export function sandstormWorld(o: SandstormOptions = {}): WorldSnapshot {
  const w = sandstorm(o);
  return {
    ...EMPTY_WORLD, title: 'Sandstorm', env: { ...EMPTY_WORLD.env, preset: 'room', environment: 'studio' }, parts: w.parts, links: w.links,
    counters: { 1: w.parts.length + w.links.length }, simFlags: { matterGameplay: true }, grains: w.grains,
  };
}

/** RENDER (beta polish): a Library demo machine (parts-data DEMOS) as a Desk world, for visual checks (scene=demo&demo=). */
export function demoWorld(name: string): WorldSnapshot {
  const d = DEMOS[name];
  if (!d) throw new Error(`no demo ${name}`);
  return {
    ...EMPTY_WORLD, title: `demo ${name}`, env: { ...EMPTY_WORLD.env, preset: 'desk', environment: 'studio' }, parts: [...d.parts], links: [...d.links],
    counters: { 1: d.parts.length + d.links.length + 1 },
  };
}

/**
 * RENDER (beta polish): the LOD check scene: a dense mixed grid of small and large parts (STITCH, PIN, COG S, BRIK, TOPPLE
 * TILES, THUD, BOING, LEDGE, BIG TOP, LIFT) over `half` × 2 m of the Arena, 1.1 m apart, for dolly shots.
 */
export function lodMix(half = 40): WorldSnapshot {
  const b = new Builder();
  const types: [string, Record<string, number>][] = [['stitch', {}], ['pin', {}], ['cog', { size: 0 }], ['brik', {}], ['topple_tile', {}], ['thud', {}], ['boing', {}], ['ledge', {}], ['big_top', {}], ['lift', {}]];
  let i = 0;
  for (let x = -half; x <= half; x += 1.1) {
    for (let z = -half; z <= half; z += 1.1) {
      const [type, props] = types[i++ % types.length]!;
      const def = partDef(type)!;
      b.add(type, x, -def.bounds.min[1] + 0.001, z, snappedEuler((i * 37) % 24 * 15, 0, 0), props);
    }
  }
  return b.world('LOD mix', { preset: 'arena', environment: 'studio' });
}
