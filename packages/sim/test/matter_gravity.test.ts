// X5 (M5, D104): Matter follows the world. Grains fall at the world's gravity % (format env.gravity), the Hangar's zero-g
// zones hold them weightless while env.zones is on, the Moon's grains settle on its authored regolith (static terrain
// tiles, matter/terrain.ts), Earth worlds send exactly what M4 sent, and rollback holds through all of it. Also here:
// QUACK's weighted keel (it rights itself in water). MX's CPU backend in Node, small grain counts.

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { HANGAR_SET, moonField, spacePreset } from '@knockon/parts-data';
import { MatterCpu, gravityQ8 } from '../../matter/src/index.ts';
import { Machine, type MachineOptions } from '../src/index.ts';
import type { MatterStepIn } from '../src/matter/contract.ts';
import { matterGravityQ8 } from '../src/matter/units.ts';
import { packIn, packOut, unpackIn, unpackOut } from '../src/matter/pack.ts';
import { moonTiles } from '../src/matter/terrain.ts';
import { spaceSetPlan } from '../src/envsets.ts';
import { Build, jolt, pose } from './harness.ts';
import { PondMatter } from './matter_pond.ts';

const T = 600_000;
const U = 65536;

/** A CPU backend that records every command it was given. */
class Recorder extends MatterCpu {
  readonly inputs: MatterStepIn[] = [];
  override stepSync(input: MatterStepIn): ReturnType<MatterCpu['stepSync']> {
    this.inputs.push(input);
    return super.stepSync(input);
  }
}

async function machine(b: Build, opts: MachineOptions, be: MatterCpu = new MatterCpu()): Promise<{ m: Machine; be: MatterCpu }> {
  const m = new Machine(await jolt(), b, { ...opts, simFlags: { matterGameplay: true }, matter: { backend: be, capacity: 8192 } });
  return { m, be };
}

function run(m: Machine, ticks: number): string[] {
  const hs: string[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); m.drainEvents(); if (t % 30 === 29) hs.push(m.hash()); }
  return hs;
}

/** A straight run's hashes from tick `to` to `end`, against a run that goes to `upto`, restores `to` and replays. */
async function rollback(b: Build, opts: MachineOptions, to = 240, upto = 330, end = 420): Promise<void> {
  const { m: a } = await machine(b, opts);
  const hs: string[] = [];
  for (let t = 0; t < end; t++) { a.step(); a.drainEvents(); if (t >= to) hs.push(a.hash()); }
  a.destroy();
  const { m } = await machine(b, opts);
  run(m, upto);
  expect(m.restore(to)).toBe(to);
  const h2: string[] = [];
  for (let t = to; t < end; t++) { m.step(); m.drainEvents(); h2.push(m.hash()); }
  expect(h2).toEqual(hs);
  m.destroy();
}

/** Live grains of `kind` on the backend: their positions (metres). */
function grains(be: MatterCpu, kind = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < be.n; i++) if ((be.mat[i]! & 0xff) === kind) out.push([be.pos[i * 3]! / U, be.pos[i * 3 + 1]! / U, be.pos[i * 3 + 2]! / U]);
  return out;
}

describe('D104 world gravity for grains', () => {
  it('the gravity map: Earth is the M4 constant, Moon 16.5 % and Hangar 38 % scale a falling grain, 0 % is exactly 0', () => {
    expect(matterGravityQ8(100)).toBe(2816);
    expect(gravityQ8(100)).toBe(2816);
    for (const p of [0, 0.5, 16.5, 38, 50, 150, 300]) expect(matterGravityQ8(p)).toBe(gravityQ8(p));
    expect(matterGravityQ8(16.5)).toBe(625);
    expect(matterGravityQ8(38)).toBe(1189);
    expect(matterGravityQ8(0)).toBe(0);
  });

  it('an Earth world sends exactly the M4 command (no gravity, no zones); the Moon and the Hangar send theirs', async () => {
    const make = async (opts: MachineOptions): Promise<MatterStepIn> => {
      const b = new Build();
      b.add('tank', 30, 0, 0, { start: 5, open: 1 });
      const rec = new Recorder();
      const { m } = await machine(b, opts, rec);
      run(m, 10);
      m.destroy();
      return rec.inputs[0]!;
    };
    const earth = await make({});
    expect(earth.gravity).toBeUndefined();
    expect(earth.zones).toBeUndefined();
    const moon = await make({ environment: 'moon', preset: 'room', gravityPercent: 16.5 });
    expect(moon.gravity).toBe(625);
    expect(moon.zones).toBeUndefined();
    const hangar = await make({ environment: 'hangar', preset: 'warehouse', gravityPercent: 38 });
    expect(hangar.gravity).toBe(1189);
    const zs = spacePreset(HANGAR_SET, 'warehouse')!.zones!;
    expect(hangar.zones).toHaveLength(zs.length);
    expect(hangar.zones![0]!.gravity).toBe(0);
    expect([...hangar.zones![0]!.center]).toEqual(zs[0]!.center.map((v) => Math.round(v * U)));
    expect(hangar.zones![0]!.size[0]).toBe(Math.round(zs[0]!.radius * U));
    const off = await make({ environment: 'hangar', preset: 'warehouse', gravityPercent: 38, zones: false });
    expect(off.zones).toBeUndefined();
  }, T);

  it('sand falls at the world’s gravity: slower in the Hangar (38 %), slower still on the Moon (16.5 %)', async () => {
    // one hopper, open, far from everything; the first grains' drop over 0.25 s after they leave the spout
    const drop = async (opts: MachineOptions): Promise<number> => {
      const b = new Build();
      b.add('grit_hopper', 0, 3, 0, { capacity: 50000, rate: 1000, start: 5, open: 1 });
      const { m, be } = await machine(b, opts);
      run(m, 6); // the first command (Matter tick 0) carries the first grains
      // the falling front: the lowest grain (the first ones out), well before any reaches the floor
      const y0 = Math.min(...grains(be).map((g) => g[1]));
      run(m, 30);
      const y1 = Math.min(...grains(be).map((g) => g[1]));
      m.destroy();
      return y0 - y1;
    };
    // (the spout throws grains down at 0.3 m/s, so the drop isn't proportional to g: the backend test measures the
    // acceleration itself, test/matter.test.ts "world gravity")
    const earth = await drop({}), hangar = await drop({ gravityPercent: 38 }), moon = await drop({ gravityPercent: 16.5 });
    expect(earth).toBeGreaterThan(0.2);
    expect(hangar).toBeLessThan(0.6 * earth);
    expect(moon).toBeLessThan(0.75 * hangar);
    expect(moon).toBeGreaterThan(0.075); // the spout's 0.3 m/s × 0.25 s, plus gravity
  }, T);
});

describe('the browser wire (pack.ts) carries goo and D104', () => {
  it('commands keep their gravity and zones; results keep the goo counts and goo absorbed', () => {
    const v = (x: number, y: number, z: number): Int32Array => Int32Array.of(x, y, z);
    const inp: MatterStepIn = {
      tick: 7, proxies: [], emits: [{ seq: 1, kind: 3, count: 5, pos: v(1, 2, 3), vel: v(0, -4, 0), spread: 2, seed: 9 }], intakes: [], blasts: [],
      surface: { x0: -5, z0: 7, cell: 1311, nx: 3, nz: 2 }, gravity: 625,
      zones: [{ shape: 0, center: v(10, 20, 30), size: v(400, 500, 0), gravity: 0 }, { shape: 1, center: v(-1, -2, -3), size: v(6, 7, 8), gravity: 300 }],
    };
    const back = unpackIn(packIn(inp));
    expect(back.gravity).toBe(625);
    expect(back.surface).toEqual(inp.surface);
    expect(back.zones!.map((z) => [z.shape, ...z.center, ...z.size, z.gravity])).toEqual([[0, 10, 20, 30, 400, 500, 0, 0], [1, -1, -2, -3, 6, 7, 8, 300]]);
    expect(back.emits[0]!.kind).toBe(3);
    const { gravity: _g, zones: _z, surface: _s, ...bare } = inp;
    const b2 = unpackIn(packIn(bare));
    expect(b2.gravity).toBeUndefined();
    expect(b2.zones).toBeUndefined();
    expect(b2.surface).toBeUndefined();
    const out = { tick: 3, impulses: [], absorbed: [{ id: 2, counts: Int32Array.of(0, 1, 0, 7) }], counts: Int32Array.of(5, 6, 7, 8), checksum: [1, 2] as [number, number] };
    const o2 = unpackOut(packOut(out));
    expect([...o2.counts]).toEqual([5, 6, 7, 8]);
    expect([...o2.absorbed[0]!.counts]).toEqual([0, 1, 0, 7]);
  });
});

describe('D104 zero-g zones for grains (ORBITAL HANGAR)', () => {
  const zone = spacePreset(HANGAR_SET, 'warehouse')!.zones![0]!;
  // a metre up inside the zone (it spans the deck to 20 m): with zones off, grains reach the deck within 2 s at 38 %
  const inside: [number, number, number] = [zone.center[0], 1, zone.center[2]];
  it('with env.zones on, sand poured inside a zone floats (weightless); with it off, the same sand falls to the deck', async () => {
    const at = async (zones: boolean): Promise<number> => {
      const b = new Build();
      b.add('grit_hopper', inside[0], inside[1], inside[2], { capacity: 50000, rate: 5000, start: 5, open: 1 });
      const { m, be } = await machine(b, { environment: 'hangar', preset: 'warehouse', gravityPercent: 38, zones });
      run(m, 240);
      const ys = grains(be).map((g) => g[1]);
      m.destroy();
      return Math.min(...ys);
    };
    const on = await at(true), off = await at(false);
    // the hopper's spout is 66 mm over its base: weightless grains drift out of it slowly, they don't fall
    expect(on).toBeGreaterThan(inside[1] - 0.5);
    expect(off).toBeLessThan(0.1); // on the deck (y ≈ 0)
  }, T);

  it('survives a late-poke rollback through the zone (weightless grains restored exactly)', async () => {
    const b = new Build();
    b.add('grit_hopper', inside[0], inside[1], inside[2], { capacity: 50000, rate: 5000, start: 5, open: 1 });
    await rollback(b, { environment: 'hangar', preset: 'warehouse', gravityPercent: 38 });
  }, T);
});

describe('D104 the Moon’s regolith for grains (MOON BASE)', () => {
  // the Arena: the Room and Warehouse windows of the field are flat (y = 0) everywhere
  const plan = spaceSetPlan('moon', 'arena')!;
  const tiles = moonTiles(plan.field!, plan.holes);
  // a spot off the concrete apron (r 24 m) where the regolith rises ≈ 0.15 m on a gentle slope
  const X = 53.75, Z = 2.75;
  it('the tiles follow the heightfield (within the cell twist) and skip the apron', () => {
    const f = moonField('arena')!;
    const s = 0.5, ix = Math.floor((X - f.origin[0]) / s), iz = Math.floor((Z - f.origin[1]) / s);
    const h = (i: number, j: number): number => f.heights[j * f.nx + i]! * (f.maxHeight / 65535);
    const mean = (h(ix, iz) + h(ix + 1, iz) + h(ix, iz + 1) + h(ix + 1, iz + 1)) / 4;
    expect(tiles.heightAt(f.origin[0] + (ix + 0.5) * s, f.origin[1] + (iz + 0.5) * s)).toBeCloseTo(mean, 6);
    expect(Math.abs(mean)).toBeGreaterThan(0.1); // genuinely off the y = 0 plane
    // the region over the apron's middle has no tiles (its concrete boxes are the surface there)
    expect(tiles.cover([-2, -1, -2, 2, 1, 2], 4096, 0)).toHaveLength(0);
    const near = tiles.cover([X - 1, -5, Z - 1, X + 1, 5, Z + 1], 4096, 0);
    expect(near.length).toBeGreaterThan(16);
  });

  it('sand poured off the apron settles on the regolith, not on the y = 0 plane; replays and rolls back exactly', async () => {
    const ground = tiles.heightAt(X, Z);
    const b = new Build();
    b.add('grit_hopper', X, ground + 0.4, Z, { capacity: 50000, rate: 8000, start: 5, open: 1 });
    const opts: MachineOptions = { environment: 'moon', preset: 'arena', gravityPercent: 16.5 };
    const { m, be } = await machine(b, opts);
    run(m, 480);
    const g = grains(be);
    expect(g.length).toBe(2500);
    // every grain rests on or over the tiles (the lowest within a grain of the surface), the pile 0.1 m+ over y = 0
    const rest = g.map((p) => p[1] - tiles.heightAt(p[0], p[2]));
    expect(Math.min(...rest)).toBeGreaterThan(-0.004);
    expect(Math.min(...rest)).toBeLessThan(0.01);
    expect(g.reduce((y, p) => y + p[1], 0) / g.length).toBeGreaterThan(0.1);
    m.destroy();
    await rollback(b, opts);
  }, T);
});

describe('QUACK’s weighted keel (X5: the D101 session found it floating upside down)', () => {
  it('dropped upside down or on its side into still water, it rights itself within 1.5 s and floats upright', async () => {
    for (const r of [[0, 180, 0], [0, 0, 180], [0, 0, 90], [0, 150, 0], [0, 175, 5]] as const) {
      const b = new Build();
      const duck = b.add('quack', 0, 0.15, 0, {}, snappedEuler(r[0], r[1], r[2]));
      const be = new PondMatter({ level: 0.1, min: [-1, -1], max: [1, 1] });
      const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: be } });
      m.matter.emitWorld(-1, 1, 1, [0, 0.05, 0], [0, 0, 0], 0);
      for (let t = 0; t < 180; t++) { m.step(); m.drainEvents(); }
      const q = pose(m, duck).q;
      expect(1 - 2 * (q[0] * q[0] + q[2] * q[2]), `start ${r.join(',')}`).toBeGreaterThan(0.95);
      m.destroy();
    }
  }, T);
});
