// W5 (M5): ORBITAL HANGAR and MOON BASE in the sim (M5_PLAN contract 4): set colliders, the environment-ground
// materials, the Moon's fixed heightfield (determinism and rollback), the Hangar's zero-g zones (env.zones) across a
// rollback, and the gravity / air the format gives each environment.
import { describe, expect, it } from 'vitest';
import { envPhysics, makeId, metresToPos, type PartRecord } from '@knockon/format';
import { HANGAR_SET as HANGAR, MOON_SET as MOON, moonField, spaceTerrainHeight as moonHeightAt } from '@knockon/parts-data';
import { MOON as E5C_MOON, heightsFnv1a } from '../../parts-data/src/env_moon.ts';
import { Machine, type MachineOptions } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

const thud = (n: number, x: number, y: number, z: number): PartRecord => ({ id: makeId(1, n), type: 'thud', pos: [metresToPos(x), metresToPos(y), metresToPos(z)], rot: { tag: 0 }, flags: 0 });
const R = 0.11; // THUD radius

const hangar = (preset: 'warehouse' | 'arena', extra: Partial<MachineOptions> = {}): MachineOptions =>
  ({ preset, environment: 'hangar', gravityPercent: envPhysics('hangar').gravity, airPercent: envPhysics('hangar').air, ...extra });
const moon = (preset: 'room' | 'warehouse' | 'arena', extra: Partial<MachineOptions> = {}): MachineOptions =>
  ({ preset, environment: 'moon', gravityPercent: envPhysics('moon').gravity, airPercent: envPhysics('moon').air, ...extra });

describe('ORBITAL HANGAR', () => {
  it('the set collides in both presets: the deck, a cargo container, the shuttle (convex hulls)', async () => {
    const J = await jolt();
    for (const preset of ['warehouse', 'arena'] as const) {
      const set = HANGAR.presets[preset]!;
      const box = set.boxes.find((x) => x.name === 'container')!;
      const top: readonly [number, number, number] = [box.center[0], box.center[1] + box.half[1], box.center[2]];
      const hull = set.hulls!.find((x) => x.name === 'shuttle_hull')!;
      const hx = (hull.aabb!.min[0] + hull.aabb!.max[0]) / 2, hz = (hull.aabb!.min[2] + hull.aabb!.max[2]) / 2;
      const parts = [thud(1, set.neutral.min[0] + 1, 1, set.neutral.min[2] + 1), thud(2, top[0], top[1] + 1, top[2]), thud(3, hx, hull.aabb!.max[1] + 1, hz)];
      const m = new Machine(J, { parts }, hangar(preset, { checkpointEvery: 0 }));
      for (let t = 0; t < 600; t++) m.step();
      expect(pose(m, parts[0]!.id).p[1]).toBeCloseTo(R, 1); // the deck
      expect(pose(m, parts[1]!.id).p[1]).toBeCloseTo(top[1] + R, 1); // a container's top
      expect(pose(m, parts[2]!.id).p[1]).toBeGreaterThan(hull.aabb!.min[1] + 0.5); // on the shuttle, not through it
      m.destroy();
    }
  }, 60_000);

  it('falls at the hangar’s 38 % gravity (½·g·t² over 0.5 s)', async () => {
    const J = await jolt();
    const m = new Machine(J, { parts: [thud(1, 0, 10, 12)] }, hangar('warehouse', { checkpointEvery: 0 }));
    for (let t = 0; t < 60; t++) m.step();
    const drop = 10 - pose(m, makeId(1, 1)).p[1];
    expect(drop).toBeGreaterThan(0.5 * 9.81 * 0.38 * 0.25 * 0.95);
    expect(drop).toBeLessThan(0.5 * 9.81 * 0.38 * 0.25 * 1.05);
    m.destroy();
  });

  it('a zero-g zone cancels gravity; env.zones = false (and outside the zone) it falls; the hash carries the flag', async () => {
    const J = await jolt();
    const zone = HANGAR.presets.warehouse!.zones![0]!;
    const inside = thud(1, zone.center[0], 5, zone.center[2]); // the zone stands on the deck: 5 m up is inside it
    const outside = thud(2, zone.center[0] + 12, 5, zone.center[2]);
    const run = (zones: boolean): { a: number; b: number; hash: string } => {
      const m = new Machine(J, { parts: [inside, outside] }, hangar('warehouse', { zones, checkpointEvery: 0 }));
      for (let t = 0; t < 480; t++) m.step();
      const out = { a: pose(m, inside.id).p[1], b: pose(m, outside.id).p[1], hash: m.hash() };
      m.destroy();
      return out;
    };
    const on = run(true), off = run(false);
    expect(on.a).toBeCloseTo(5, 3); // floats where it was released
    expect(on.b).toBeCloseTo(R, 1); // outside: on the deck
    expect(off.a).toBeCloseTo(R, 1); // zones off: on the deck
    expect(on.hash).not.toBe(off.hash);
    expect(run(true).hash).toBe(on.hash); // deterministic
  }, 60_000);

  it('rollback across a zone entry: a late poke that throws a THUD into a zone rolls back to the straight run', async () => {
    const J = await jolt();
    const zone = HANGAR.presets.warehouse!.zones![1]!;
    const parts = [thud(1, zone.center[0] - 7, R, zone.center[2]), thud(2, zone.center[0] + 1, 3, zone.center[2] - 1)];
    const early = { tick: 30, seq: 1, partId: parts[1]!.id, kind: 'impulse' as const, data: [0.4, 0.6, 0.1] };
    const late = { tick: 130, seq: 2, partId: parts[0]!.id, kind: 'impulse' as const, data: [21, 28, 0] }; // 3 m/s across, 4 m/s up: it sails into the zone and keeps rising there
    const a = new Machine(J, { parts }, hangar('warehouse'));
    a.addPoke(early); a.addPoke(late);
    for (let t = 0; t < 420; t++) a.step();
    const p0 = pose(a, parts[0]!.id).p;
    expect(Math.hypot(p0[0] - zone.center[0], p0[2] - zone.center[2])).toBeLessThan(zone.radius); // it ended up in the zone…
    expect(p0[1]).toBeGreaterThan(4); // …still rising, gravity cancelled
    const c = new Machine(J, { parts }, hangar('warehouse'));
    c.addPoke(early);
    for (let t = 0; t < 200; t++) c.step();
    c.addPoke(late);
    expect(c.restore(130)).toBe(120);
    while (c.tick < 420) c.step();
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 60_000);
});

describe('MOON BASE', () => {
  it('builds the regolith heightfield and the concrete apron: THUDs rest on the apron (y = 0), its edge and the regolith, the highest ground included', async () => {
    const J = await jolt();
    const f = moonField('arena')!;
    let top = 0;
    for (let i = 1; i < f.heights.length; i++) if (f.heights[i]! > f.heights[top]!) top = i;
    const tx = f.origin[0] + (top % f.nx) * 0.5, tz = f.origin[1] + Math.floor(top / f.nx) * 0.5;
    const spots: [number, number][] = [[3, 2], [23.2, 0.5], [-40, 30], [60, 60], [tx, tz]];
    const parts = spots.map(([x, z], i) => thud(i + 1, x, moonHeightAt(f, x, z) + 0.6, z));
    const m = new Machine(J, { parts }, moon('arena', { checkpointEvery: 0 }));
    for (let t = 0; t < 900; t++) m.step();
    spots.forEach((_, i) => {
      const p = pose(m, parts[i]!.id).p;
      const ground = moonHeightAt(f, p[0], p[2]);
      expect(p[1]).toBeGreaterThan(ground + R - 0.03); // never through the ground (it may still roll on a slope at 16.5 % g)
      if (i < 2) expect(p[1]).toBeCloseTo(R, 2); // on the concrete apron
    });
    expect(pose(m, parts[4]!.id).p[1]).toBeGreaterThan(moonHeightAt(f, tx, tz) - 3); // the highest ground holds it up
    m.destroy();
  }, 60_000);

  it('the heightfield is deterministic: two runs match, and a late poke rolls back to the straight run', async () => {
    const J = await jolt();
    const f = moonField('arena')!;
    // THUDs on rough regolith off the apron, one on the apron
    const parts = [thud(1, 45, moonHeightAt(f, 45, 50) + 0.5, 50), thud(2, -50, moonHeightAt(f, -50, 40) + 0.3, 40), thud(3, 2, 0.3, 2)];
    const early = { tick: 20, seq: 1, partId: parts[1]!.id, kind: 'impulse' as const, data: [3, 1, -2] };
    const late = { tick: 190, seq: 2, partId: parts[2]!.id, kind: 'impulse' as const, data: [9, 3, 2] };
    const straight = (): string => {
      const m = new Machine(J, { parts }, moon('arena'));
      m.addPoke(early); m.addPoke(late);
      for (let t = 0; t < 480; t++) m.step();
      const h = m.hash();
      m.destroy();
      return h;
    };
    const a = straight();
    expect(straight()).toBe(a);
    const c = new Machine(J, { parts }, moon('arena'));
    c.addPoke(early);
    for (let t = 0; t < 260; t++) c.step();
    c.addPoke(late);
    expect(c.restore(190)).toBe(180);
    while (c.tick < 480) c.step();
    expect(c.hash()).toBe(a);
    c.destroy();
  }, 60_000);

  it('Room and Warehouse are the flat landing pad (the central 64 m window); the lander collides (convex hulls)', async () => {
    const J = await jolt();
    for (const preset of ['room', 'warehouse'] as const) {
      const cabin = MOON.presets[preset]!.hulls!.find((h) => h.name === 'lander_cabin')!;
      const cx = (cabin.aabb!.min[0] + cabin.aabb!.max[0]) / 2, cz = (cabin.aabb!.min[2] + cabin.aabb!.max[2]) / 2;
      const parts = [thud(1, 1, 1, 1), thud(2, cx, cabin.aabb!.max[1] + 1, cz)];
      const m = new Machine(J, { parts }, moon(preset, { checkpointEvery: 0 }));
      for (let t = 0; t < 120; t++) m.step();
      expect(pose(m, parts[1]!.id).p[1]).toBeGreaterThan(cabin.aabb!.max[1] - 0.3); // landed on the cabin's top (it rolls off later)
      for (let t = 0; t < 780; t++) m.step();
      expect(pose(m, parts[0]!.id).p[1]).toBeCloseTo(R, 2);
      m.destroy();
    }
  }, 60_000);

  it('falls at 16.5 % gravity, and with 0 % air a HELIO doesn’t rise', async () => {
    const J = await jolt();
    const helio: PartRecord = { id: makeId(1, 2), type: 'helio', pos: [metresToPos(2), metresToPos(1), metresToPos(2)], rot: { tag: 0 }, flags: 0 };
    const m = new Machine(J, { parts: [thud(1, 0, 10, 2), helio] }, moon('room', { checkpointEvery: 0 }));
    for (let t = 0; t < 60; t++) m.step();
    const drop = 10 - pose(m, makeId(1, 1)).p[1];
    expect(drop).toBeGreaterThan(0.5 * 9.81 * 0.165 * 0.25 * 0.95);
    expect(drop).toBeLessThan(0.5 * 9.81 * 0.165 * 0.25 * 1.05);
    for (let t = 0; t < 240; t++) m.step();
    expect(pose(m, helio.id).p[1]).toBeLessThan(1); // no buoyancy in a vacuum
    m.destroy();
  }, 60_000);
});

describe('MOON BASE heightfield data (E5c)', () => {
  it('decodes to the generated checksums, shares the origin, and is flat on the apron and the Arena neutral zone', () => {
    for (const p of ['room', 'warehouse', 'arena'] as const) {
      const t = moonField(p)!;
      expect(heightsFnv1a(t.heights)).toBe(E5C_MOON.presets[p].terrain.fnv1a);
    }
    const room = moonField('room')!, arena = moonField('arena')!;
    expect([room.nx, room.nz, arena.nx, arena.nz]).toEqual([129, 129, 513, 513]);
    expect(moonField('desk')).toBeNull();
    for (let x = -23; x <= 23; x += 0.5) for (let z = -23; z <= 23; z += 0.5) if (x * x + z * z <= 23 * 23) expect(Math.abs(moonHeightAt(arena, x, z))).toBeLessThan(0.002);
    for (let x = -16; x <= 16; x += 2) for (let z = -12; z <= 20; z += 2) expect(Math.abs(moonHeightAt(arena, x, z))).toBeLessThan(0.01);
    expect(Math.abs(moonHeightAt(room, 30, -30) - moonHeightAt(arena, 30, -30))).toBeLessThan(0.01); // same ground, finer steps in the Room
  });
});

describe('global wind (W5, D26)', () => {
  const helio = (n: number, x: number, z: number): PartRecord => ({ id: makeId(1, n), type: 'helio', pos: [metresToPos(x), metresToPos(1), metresToPos(z)], rot: { tag: 0 }, flags: 0 });

  it('a HELIO drifts downwind (toward the wind direction); without wind it rises straight', async () => {
    const J = await jolt();
    const run = (wind: MachineOptions['wind']): readonly number[] => {
      const m = new Machine(J, { parts: [helio(1, 0, 0)] }, { preset: 'warehouse', checkpointEvery: 0, ...(wind ? { wind } : {}) });
      for (let t = 0; t < 240; t++) m.step();
      const p = pose(m, makeId(1, 1)).p;
      m.destroy();
      return p;
    };
    const calm = run(null), east = run({ speed: 5, dir: 0 }), back = run({ speed: 5, dir: 90 });
    expect(Math.abs(calm[0]!)).toBeLessThan(0.01);
    expect(east[0]).toBeGreaterThan(1); // blown toward +X
    expect(Math.abs(east[2]!)).toBeLessThan(0.05);
    expect(back[2]).toBeLessThan(-1); // 90° = toward −Z (away from the default camera)
  }, 60_000);

  it('is deterministic with seeded gusts, rolls back exactly, and is in the hash', async () => {
    const J = await jolt();
    const parts = [helio(1, 0, 0), helio(2, 2, 1), thud(3, -2, 0.5, 0)];
    const wind = { speed: 6, dir: 30, gusts: 'gusty' as const };
    const early = { tick: 25, seq: 1, partId: parts[2]!.id, kind: 'impulse' as const, data: [10, 4, 0] };
    const late = { tick: 190, seq: 2, partId: parts[1]!.id, kind: 'impulse' as const, data: [0.02, 0.01, 0] };
    const straight = (): string => {
      const m = new Machine(J, { parts }, { preset: 'warehouse', wind, seed: [7, 9] });
      m.addPoke(early); m.addPoke(late);
      for (let t = 0; t < 420; t++) m.step();
      const h = m.hash();
      m.destroy();
      return h;
    };
    const a = straight();
    expect(straight()).toBe(a);
    const c = new Machine(J, { parts }, { preset: 'warehouse', wind, seed: [7, 9] });
    c.addPoke(early);
    for (let t = 0; t < 250; t++) c.step();
    c.addPoke(late);
    expect(c.restore(190)).toBe(180);
    while (c.tick < 420) c.step();
    expect(c.hash()).toBe(a);
    c.destroy();
    const calm = new Machine(J, { parts }, { preset: 'warehouse', seed: [7, 9] });
    calm.addPoke(early); calm.addPoke(late);
    for (let t = 0; t < 420; t++) calm.step();
    expect(calm.hash()).not.toBe(a);
    calm.destroy();
  }, 60_000);

  it('does nothing without air (MOON BASE), and a still world hashes as before wind existed', async () => {
    const J = await jolt();
    const run = (wind: MachineOptions['wind']): string => {
      const m = new Machine(J, { parts: [thud(1, 0, 0.5, 0), helio(2, 2, 2)] }, moon('room', { checkpointEvery: 0, ...(wind ? { wind } : {}) }));
      for (let t = 0; t < 240; t++) m.step();
      const h = m.hash();
      m.destroy();
      return h;
    };
    expect(run({ speed: 12, dir: 0, gusts: 'gusty' })).toBe(run(null));
    const s = (wind: MachineOptions['wind']): string => {
      const m = new Machine(J, { parts: [thud(1, 0, 0.5, 0)] }, { preset: 'room', checkpointEvery: 0, ...(wind ? { wind } : {}) });
      for (let t = 0; t < 120; t++) m.step();
      const h = m.hash();
      m.destroy();
      return h;
    };
    expect(s({ speed: 0, dir: 90 })).toBe(s(null)); // zero wind = no wind
  }, 60_000);

  it('over 4 m/s it blows out a lit WICK; a breeze does not', async () => {
    const J = await jolt();
    const wick: PartRecord = { id: makeId(1, 1), type: 'wick', pos: [0, 0, 0], rot: { tag: 0 }, flags: 0 };
    for (const [speed, out] of [[3, false], [5, true]] as const) {
      const m = new Machine(J, { parts: [wick] }, { preset: 'room', checkpointEvery: 0, wind: { speed, dir: 0 } });
      for (let t = 0; t < 30; t++) m.step();
      expect(m.drainEvents().some((e) => e.kind === 'Extinguish')).toBe(out);
      m.destroy();
    }
  }, 60_000);
});

describe('zero-g zones with the M5 fields (A5)', () => {
  it('a TRACTOR BEAM-held and a STASIS-frozen body inside a zero-g zone feel net 0 g, not +1 g (same pose as with zones off)', async () => {
    const J = await jolt();
    const zone = HANGAR.presets.warehouse!.zones![0]!;
    const zx = zone.center[0], zz = zone.center[2];
    const run = (zones: boolean): { held: number; frozen: number } => {
      const b = new Build();
      const mains = b.add('mains', zx - 2, 0, zz - 2);
      const beam = b.add('tractor_beam', zx - 2, 0, zz - 1, { mode: 1, hold: 1.5, range: 3 });
      b.link('cable_power', mains, 'out', beam, 'in');
      const held = b.add('stitch', zx - 2, 0.0375, zz + 1);
      const mains2 = b.add('mains', zx + 2, 0, zz - 2);
      const field = b.add('stasis_field', zx + 2, 0, zz);
      b.link('cable_power', mains2, 'out', field, 'in');
      const frozen = b.add('stitch', zx + 2, 0.4, zz);
      const m = new Machine(J, b, hangar('warehouse', { zones, checkpointEvery: 0 }));
      for (let t = 0; t < 480; t++) m.step();
      const out = { held: pose(m, held).p[1], frozen: pose(m, frozen).p[1] };
      m.destroy();
      return out;
    };
    const on = run(true), off = run(false);
    expect(Math.abs(on.held - off.held)).toBeLessThan(0.005);
    expect(Math.abs(on.frozen - off.frozen)).toBeLessThan(0.002);
    expect(on.frozen).toBeGreaterThan(0.3); // still frozen where it was caught, not drifting up out of the field
  }, 60_000);
});
