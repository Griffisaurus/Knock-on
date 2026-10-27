// D101 water buoyancy: the backend's water-surface map + Jolt's ApplyBuoyancyImpulse (matter/buoyancy.ts, host.ts).
//  - Still pond (matter_pond.ts): a synthetic backend with an exact flat level and no particles, so float depths are
//    Jolt's buoyancy alone and can be checked tightly: QUACK, SPONGE dry / soaked, wood, iron, a body pushed under,
//    flow, the measured impulse against ρ·g·V, Matter off, buoyancy off, hidden bodies, rollback.
//  - Real water (MX's CPU backend, a 0.2 m basin of 2,048 mL): a QUACK dropped in floats upright and steady, Jolt
//    carries its weight and the particles no longer add their own support; the map's level matches the water's volume;
//    rollback through floating rejoins the straight run.

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine } from '../src/index.ts';
import type { MatterOptions } from '../src/matter/host.ts';
import { packIn, packOut, unpackIn, unpackOut } from '../src/matter/pack.ts';
import { SURF_CELL, sampleWater, surfaceIndex, surfaceRequest, surfaceState } from '../src/matter/buoyancy.ts';
import type { MatterStepOut } from '../src/matter/contract.ts';
import { Build, jolt, pose } from './harness.ts';
import { PondMatter, type PondOptions } from './matter_pond.ts';

const T = 300_000;
const G = 9.81;
const LEVEL = 0.1;
const POND: PondOptions = { level: LEVEL, min: [-1, -1], max: [1, 1] };

async function pondMachine(b: Build, pond: PondOptions = POND, opts: Partial<MatterOptions> = {}, matterOn = true): Promise<{ m: Machine; be: PondMatter }> {
  const be = new PondMatter(pond);
  const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: matterOn }, matter: { backend: be, diagnostics: true, ...opts } });
  m.matter.emitWorld(-1, 1, 1, [0, 0.05, 0], [0, 0, 0], 0); // wakes Matter (the pond is the backend's)
  return { m, be };
}

/** The body index, world bounds (min xyz, max xyz), up-axis cosine and speed of a part's base body. */
function body(m: Machine, id: number): { bi: number; lo: number[]; hi: number[]; up: number; speed: number; kg: number; vol: number } {
  const pi = m.parts.findIndex((p) => p.id === id);
  const bi = m.parts[pi]!.base;
  const b = m.bodies[bi]!.body;
  const bb = b.GetWorldSpaceBounds();
  const q = pose(m, id).q;
  return {
    bi, lo: [bb.mMin.GetX(), bb.mMin.GetY(), bb.mMin.GetZ()], hi: [bb.mMax.GetX(), bb.mMax.GetY(), bb.mMax.GetZ()],
    up: 1 - 2 * (q[0] * q[0] + q[2] * q[2]), speed: b.GetLinearVelocity().Length(),
    kg: 1 / b.GetMotionProperties().GetInverseMass(), vol: b.GetShape().GetVolume(),
  };
}

function run(m: Machine, ticks: number, each?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) { m.step(); m.drainEvents(); each?.(t); }
}

/** Fraction of a body's height under `level`. */
const under = (x: { lo: number[]; hi: number[] }, level = LEVEL): number => (level - x.lo[1]!) / (x.hi[1]! - x.lo[1]!);

describe('D101 surface map plumbing', () => {
  it('requests 2 cm cells around the bodies, coarser only past 4,096 cells', () => {
    const r = surfaceRequest([-0.1, -0.05, 0.1, 0.05])!;
    expect(r.cell).toBe(SURF_CELL);
    expect(Number.isInteger(r.x0 / r.cell)).toBe(true);
    expect(r.x0).toBeLessThanOrEqual(Math.floor(-0.2 * 65536));
    expect((r.x0 + r.nx * r.cell) / 65536).toBeGreaterThanOrEqual(0.2);
    const big = surfaceRequest([-3, -3, 3, 3])!;
    expect(big.nx * big.nz).toBeLessThanOrEqual(4096);
    expect(big.cell).toBeGreaterThan(SURF_CELL);
    expect(surfaceRequest([Infinity, Infinity, -Infinity, -Infinity])).toBeNull();
  });
  it('round-trips through the wire format (sparse) and the plain state, and samples the ring, not the footprint', () => {
    const nx = 5, nz = 4, nc = nx * nz, U = 65536;
    const count = new Int32Array(nc), top = new Int32Array(nc).fill(-2147483648), bottom = new Int32Array(nc).fill(-2147483648), vel = new Int32Array(nc * 3);
    for (let c = 0; c < nc; c++) {
      if (c === 0) continue; // one dry cell (in the ring)
      const inner = (c % nx) >= 1 && (c % nx) <= 3 && Math.floor(c / nx) >= 1 && Math.floor(c / nx) <= 2;
      count[c] = 400; top[c] = Math.round((inner ? 0.03 : 0.095) * U); bottom[c] = Math.round(0.005 * U); vel[c * 3] = 100 + c;
    }
    const out: MatterStepOut = {
      tick: 3, impulses: [], absorbed: [], counts: Int32Array.of(0, 7600, 0), checksum: [1, 2],
      surface: { x0: -2 * SURF_CELL, z0: -2 * SURF_CELL, cell: SURF_CELL, nx, nz, count, top, bottom, vel },
    };
    const back = unpackOut(packOut(out));
    expect(back.surface).toEqual(out.surface);
    const { surface: _s, ...bare } = out;
    expect(packOut(bare).length).toBe(packOut(out).length - 6 - 19 * 7);
    const inp = { tick: 1, proxies: [], emits: [], intakes: [], blasts: [], surface: { x0: -5, z0: 7, cell: 1311, nx: 3, nz: 2 } };
    expect(unpackIn(packIn(inp)).surface).toEqual(inp.surface);
    const { surface: _r, ...bareIn } = inp;
    expect(unpackIn(packIn(bareIn)).surface).toBeUndefined();
    // a body over the middle 3 × 2 cells: its footprint (where the water's top is its own bottom) is skipped
    const st = surfaceState(out), idx = surfaceIndex(st);
    const c = SURF_CELL / U;
    const w = sampleWater(st, idx, [-0.9 * c, 0.02, -0.9 * c, 1.9 * c, 0.2, 0.9 * c])!;
    expect(w.cells).toBe(13); // the ring: 20 cells − the 6 under the body − the dry one
    expect(w.level).toBeCloseTo(0.1, 3); // top centres + half a spacing
    expect(sampleWater(st, idx, [-0.9 * c, 0.15, -0.9 * c, 1.9 * c, 0.2, 0.9 * c])).not.toBeNull();
    expect(sampleWater(st, idx, [-0.9 * c, -0.3, -0.9 * c, 1.9 * c, -0.2, 0.9 * c])).toBeNull(); // water entirely above it
  });
});

describe('D101 buoyancy in a still pond (exact level, Jolt buoyancy alone)', () => {
  it('QUACK floats upright with about 10 % of its hull under', async () => {
    const b = new Build();
    const duck = b.add('quack', 0, 0.15, 0);
    const { m } = await pondMachine(b);
    run(m, 480);
    const d = body(m, duck);
    // hull: the 52 mm box under the head (bounds min y = the hull's bottom while upright)
    const draft = (LEVEL - d.lo[1]!) / 0.052;
    expect(d.up).toBeGreaterThan(0.99);
    expect(draft).toBeGreaterThan(0.08);
    expect(draft).toBeLessThan(0.14); // measured 12 %: 40 g displaces 40 mL, 5.2 mm of an 82 × 94 mm hull (+ its rounding)
    expect(d.speed).toBeLessThan(0.01);
    m.destroy();
  }, T);

  it('SPONGE: dry it rides high, half soaked it floats half under, soaked it floats awash', async () => {
    const at = async (start: number): Promise<number> => {
      const b = new Build();
      const sp = b.add('sponge', 0, 0.2, 0, start ? { start } : {});
      const { m } = await pondMachine(b);
      run(m, 600);
      const u = under(body(m, sp));
      m.destroy();
      return u;
    };
    const dry = await at(0), half = await at(50), soaked = await at(100);
    expect(dry).toBeLessThan(0.05); // 50 g in 2 L: 2.5 %
    expect(half).toBeGreaterThan(0.45);
    expect(half).toBeLessThan(0.62); // 1.05 kg: 53 %
    expect(soaked).toBeGreaterThan(0.85);
  }, T);

  it('wood (PLANK, 600 kg/m³) floats 60 % under; iron (PIG IRON) sinks to the floor', async () => {
    const b = new Build();
    const plank = b.add('plank', 0, 0.2, 0);
    const iron = b.add('pig_iron', 0, 0.3, 0.5);
    const { m } = await pondMachine(b);
    run(m, 600);
    const p = body(m, plank), i = body(m, iron);
    expect(p.kg / p.vol).toBeCloseTo(600, -1);
    expect(under(p)).toBeGreaterThan(0.57);
    expect(under(p)).toBeLessThan(0.63);
    expect(i.lo[1]).toBeLessThan(0.002); // on the floor, 10 cm under (it's 12 cm across)
    expect(i.speed).toBeLessThan(0.05);
    m.destroy();
  }, T);

  it('a PLANK pushed under rises, bobs past its float line and settles on it', async () => {
    const b = new Build();
    const plank = b.add('plank', 0, 0.02, 0); // top 0.07 m: 3 cm under the surface
    const { m } = await pondMachine(b);
    const eq = LEVEL - 0.06 + 0.05; // centre at rest: 60 % of 0.1 m under
    let top = -1, t1 = -1;
    const ys: number[] = [];
    run(m, 600, (t) => {
      const y = pose(m, plank).p[1];
      ys.push(y);
      if (y > top) top = y;
      if (t1 < 0 && y > eq) t1 = t;
    });
    expect(t1).toBeGreaterThan(0);
    expect(t1).toBeLessThan(60); // up through its float line within 0.5 s
    expect(top - eq).toBeGreaterThan(0.005); // overshoots (a bob)
    const last = ys.slice(-120);
    expect(Math.max(...last) - Math.min(...last)).toBeLessThan(0.002); // and settles
    expect(Math.abs(last[last.length - 1]! - eq)).toBeLessThan(0.003);
    m.destroy();
  }, T);

  it('measured: at rest the buoyant impulse equals ρ·g·V under the surface, and the body’s weight', async () => {
    const b = new Build();
    const plank = b.add('plank', 0, 0.2, 0);
    const { m } = await pondMachine(b);
    run(m, 480);
    const d = m.matter.diag!;
    d.buoy.clear();
    let vsub = 0;
    run(m, 120, () => { const p = body(m, plank); vsub += 0.1 * 1.0 * (LEVEL - p.lo[1]!); }); // flat: 0.1 × 1 m section
    const p = body(m, plank);
    const lift = d.buoy.get(p.bi)![1] / (120 / 120); // N·s over 1 s → N
    const rhoGV = (1000 * G * vsub) / 120;
    expect(Math.abs(lift - rhoGV) / rhoGV).toBeLessThan(0.02);
    expect(Math.abs(lift - p.kg * G) / (p.kg * G)).toBeLessThan(0.02);
    m.destroy();
  }, T);

  it('flowing water carries a floating QUACK along (drag relative to the water)', async () => {
    const b = new Build();
    const duck = b.add('quack', -0.5, 0.15, 0);
    const { m } = await pondMachine(b, { ...POND, flow: [0.3, 0, 0] });
    run(m, 360);
    const v = m.bodies[body(m, duck).bi]!.body.GetLinearVelocity();
    expect(v.GetX()).toBeGreaterThan(0.2);
    expect(v.GetX()).toBeLessThan(0.32);
    expect(Math.abs(v.GetZ())).toBeLessThan(0.02);
    m.destroy();
  }, T);

  it('Matter off, or buoyancy off: no surface map is asked for and nothing floats', async () => {
    for (const [on, buoyancy] of [[false, true], [true, false]] as const) {
      const b = new Build();
      const plank = b.add('plank', 0, 0.2, 0);
      const { m, be } = await pondMachine(b, POND, { buoyancy }, on);
      run(m, 240);
      expect(be.requests).toBe(0);
      expect(body(m, plank).lo[1]).toBeLessThan(0.002); // on the floor
      m.destroy();
    }
  }, T);

  it('hidden bodies are never touched: an unbroken FISHBOWL’s dormant chunks get no buoyancy', async () => {
    const b = new Build();
    const bowl = b.add('fishbowl', 0, 0.02, 0);
    const plank = b.add('plank', 0, 0.2, 0.5);
    const { m } = await pondMachine(b);
    run(m, 240);
    const pi = m.parts.findIndex((p) => p.id === bowl);
    const chunks = m.parts[pi]!.chunks;
    expect(chunks.length).toBeGreaterThan(0);
    const buoyed = [...m.matter.diag!.buoy.keys()];
    expect(buoyed).toContain(body(m, plank).bi);
    for (const c of chunks) expect(buoyed).not.toContain(c);
    m.destroy();
  }, T);

  it('rollback through floating: a restore while the PLANK bobs rejoins the straight run', async () => {
    const hashes = async (restoreAt: number): Promise<string[]> => {
      const b = new Build();
      b.add('plank', 0, 0.02, 0);
      b.add('quack', 0.3, 0.2, 0.3);
      const { m } = await pondMachine(b, POND, { checkpointEvery: 60 });
      const hs: string[] = [];
      const step = (): void => { m.step(); m.drainEvents(); if (m.tick % 30 === 0) { hs.length = m.tick / 30 - 1; hs.push(m.hash()); } };
      while (m.tick < (restoreAt || 300)) step();
      if (restoreAt) { expect(m.restore(130)).toBe(120); while (m.tick < 300) step(); }
      m.destroy();
      return hs;
    };
    const a = await hashes(0), b = await hashes(200);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  }, T);
});

// ---- real water ----------------------------------------------------------------------------------------------------

/** A 0.2 × 0.2 m basin of standing LEDGEs (inner faces at ±0.1 m) filled with 2,048 mL of water at the start. */
async function basin(add: (b: Build) => void, every = 0): Promise<Machine> {
  const b = new Build();
  for (const [x, z, yaw] of [[0, 0.125, 0], [0, -0.125, 0], [0.125, 0, 90], [-0.125, 0, 90]] as const) b.add('ledge', x, 0.2, z, {}, snappedEuler(yaw, 90, 0));
  add(b);
  const m = new Machine(await jolt(), b, {
    simFlags: { matterGameplay: true },
    matter: { backend: new MatterCpu(), capacity: 4000, diagnostics: true, ...(every ? { checkpointEvery: every } : {}) },
  });
  for (const [x, z] of [[-0.045, -0.045], [0.045, -0.045], [-0.045, 0.045], [0.045, 0.045]] as const) m.matter.emitWorld(-1, 1, 512, [x, 0.045, z], [0, 0, 0], 0);
  return m;
}

describe('D101 buoyancy in real Matter water (MX CPU backend)', () => {
  it('a QUACK dropped into a basin floats upright and steady, ≈ 10 % under; Jolt carries its weight, the particles don’t double it', async () => {
    let duck = 0;
    const m = await basin((b) => { duck = b.add('quack', 0, 0.3, 0); });
    run(m, 240);
    const d = m.matter.diag!;
    d.buoy.clear(); d.contact.clear();
    const drafts: number[] = [];
    let ups = 1, vmax = 0;
    const pi = m.parts.findIndex((p) => p.id === duck);
    run(m, 120, () => {
      const x = body(m, duck), w = m.matter.waterAt(pi)!;
      drafts.push((w.level - x.lo[1]!) / 0.052);
      ups = Math.min(ups, x.up);
      vmax = Math.max(vmax, x.speed);
    });
    const x = body(m, duck), mg = x.kg * G;
    const lift = d.buoy.get(x.bi)![1], push = d.contact.get(x.bi)?.[1] ?? 0; // N·s over 1 s
    const mean = drafts.reduce((s, v) => s + v, 0) / drafts.length;
    expect(ups).toBeGreaterThan(0.9);
    expect(mean).toBeGreaterThan(0.05);
    expect(mean).toBeLessThan(0.25); // measured ≈ 12 % (the pond's exact answer); the AABB bottom moves as it rocks
    expect(vmax).toBeLessThan(0.3); // no fling
    expect(Math.abs(lift - mg) / mg).toBeLessThan(0.05); // buoyancy carries it (measured 1.00 mg)…
    expect(Math.abs(push) / mg).toBeLessThan(0.05); // …and the particles add no support of their own (was ≈ 0.5 mg)
    m.destroy();
  }, T);

  it('the map’s level matches the water’s volume', async () => {
    let duck = 0;
    const m = await basin((b) => { duck = b.add('quack', 0, 0.3, 0); });
    run(m, 300);
    const w = m.matter.waterAt(m.parts.findIndex((p) => p.id === duck))!;
    // 2,048 mL at 1.05 L per litre of particles over 0.04 m², plus the 40 mL the duck displaces
    const expected = ((2048 * 1.05 + 40) * 1e-6) / 0.04;
    expect(Math.abs(w.level - expected)).toBeLessThan(0.004);
    m.destroy();
  }, T);

  it('rollback through floating: a late restore with the QUACK afloat rejoins the straight run', async () => {
    const hashes = async (late: boolean): Promise<string[]> => {
      const m = await basin((b) => { b.add('quack', 0, 0.3, 0); }, 60);
      const hs: string[] = [];
      const step = (): void => { m.step(); m.drainEvents(); if (m.tick % 30 === 0) { hs.length = m.tick / 30 - 1; hs.push(`${m.hash()}/${m.matter.checksumHex()}`); } };
      while (m.tick < (late ? 280 : 300)) step();
      if (late) { expect(m.restore(250)).toBe(240); while (m.tick < 300) step(); }
      m.destroy();
      return hs;
    };
    const a = await hashes(false), b = await hashes(true);
    expect(b).toEqual(a);
  }, T);
});
