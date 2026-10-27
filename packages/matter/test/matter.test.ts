import { describe, expect, it } from 'vitest';
import {
  MATR_HEADER_BYTES, MatterCpu, KIND_COUNT, checksumHex, damp, decodeMatr, encodeMatr, idiv, isqrt, normDist, ucell,
  type MatterStepOut,
} from '../src/index.ts';
import { shrS } from '../src/imath.ts';
import { MATTER_WGSL } from '../src/wgsl.ts';
import { ballisticScene, gooScene, lowGravityScene, mixScene, poolScene, sandstorm, type MatterScene } from '../src/scenes.ts';
import { GOO_H, GRAVITY_Q8, SURFACE_EMPTY, SUBSTEPS, gravityQ8 } from '../src/index.ts';
import { gravitySteps } from '../src/prep.ts';
import * as spike from '../src/spike/index.ts';

const sig = (o: MatterStepOut): string => JSON.stringify([
  checksumHex(o.checksum), [...o.counts], [...(o.bounds ?? [])],
  o.impulses.map((i) => [i.id, ...i.lin, ...i.ang]), o.absorbed.map((a) => [a.id, ...a.counts]),
  (o.near ?? []).map((q) => [q.id, q.count, ...q.centroid]),
]);

function run(sc: MatterScene, ticks: number, every = 30): { sums: string[]; sigs: string[]; be: MatterCpu } {
  const be = new MatterCpu();
  be.initSync({ capacity: sc.capacity, seed: sc.seed });
  if (sc.init) be.restoreSync(sc.init);
  const sums: string[] = [], sigs: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    const o = be.stepSync(sc.input(t));
    sigs.push(sig(o));
    if (t % every === 0) sums.push(checksumHex(o.checksum));
  }
  return { sums, sigs, be };
}

describe('integer helpers', () => {
  it('idiv truncates toward zero and guards b = 0', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(idiv(5, 0)).toBe(0);
    expect(idiv(-2147483648, -1)).toBe(-2147483648);
  });
  it('isqrt is the exact floor square root over u32 (vs a bit-by-bit integer method)', () => {
    const bit = (n0: number): number => {
      let x = n0 >>> 0, r = 0, b = 0x40000000;
      for (let k = 0; k < 16; k++) { if (x >= r + b) { x -= r + b; r = (r >>> 1) + b; } else r >>>= 1; b >>>= 2; }
      return r;
    };
    for (let k = 0; k < 65536; k += 7) for (const n of [k * k - 1, k * k, k * k + 1]) if (n >= 0) expect(isqrt(n)).toBe(bit(n));
    expect(isqrt(0xffffffff)).toBe(65535);
  });
  it('damping and shrS are sign-symmetric', () => {
    for (let v = -3000; v <= 3000; v++) { expect(damp(-v) + damp(v)).toBe(0); expect(shrS(-v, 5) + shrS(v, 5)).toBe(0); }
    expect(damp(1)).toBe(0);
  });
  it('ucell is a monotone floor division on offset-binary coordinates', () => {
    let last = -1;
    for (let x = -100000; x <= 100000; x += 37) { const u = ucell(x, 262); expect(u >= last).toBe(true); last = u; }
    expect(ucell(-1, 262)).toBe(ucell(0, 262) - (((2147483648 % 262) === 0) ? 1 : 0));
  });
  it('normDist returns a Q12 unit normal and the length', () => {
    const o = new Int32Array(4);
    normDist(o, 300, 400, 0);
    expect([...o]).toEqual([2457, 3276, 0, 500]);
    normDist(o, 0, 0, 0);
    expect([...o]).toEqual([0, 4096, 0, 0]);
  });
});

describe('MATR payload', () => {
  it('round-trips and rejects bad input', () => {
    const s = { tick: 9, count: 2, capacity: 10, seed: 3, pos: Int32Array.of(1, -2, 3, 4, 5, -6), vel: Int32Array.of(0, 1, 0, 2, 0, 3), mat: Uint32Array.of(0, 2) };
    const b = encodeMatr(s);
    expect(b.length).toBe(MATR_HEADER_BYTES + 2 * 28);
    const d = decodeMatr(b);
    expect([d.tick, d.count, d.capacity, d.seed, [...d.pos], [...d.vel], [...d.mat]]).toEqual([9, 2, 10, 3, [...s.pos], [...s.vel], [...s.mat]]);
    expect(() => decodeMatr(b.subarray(0, 40))).toThrow();
  });
});

describe('CPU reference', () => {
  const sc = mixScene(1);
  const a = run(sc, 240);

  it('is deterministic run to run (every output, every tick)', () => {
    expect(run(sc, 240).sigs).toEqual(a.sigs);
  });

  it('mix scene golden (every input path: 4 proxy shapes, 3 kinds, capacity-limited intake, blast)', () => {
    // MX golden, re-pinned 2026-10-25 (M4_NOTES_MX "Goldens": stacking rule + impulse budget), and by X5 (symmetric push
    // rounding, M5_NOTES_X5); the GPU harness shows GPU = CPU on these ticks
    expect(a.sums).toEqual(GOLDEN_MIX);
  });

  it('exercises absorption, impulses and the blast', () => {
    const outs = a.sigs.map((s) => JSON.parse(s) as [string, number[], number[], number[][], number[][]]);
    const absorbed = outs.reduce((n, o) => n + o[4][0]!.slice(1).reduce((x, y) => x + y, 0), 0);
    expect(absorbed).toBeGreaterThan(50);
    expect(outs.some((o) => o[3].some((i) => i.slice(1, 4).some((v) => v !== 0)))).toBe(true);
    const per = outs.map((o) => o[4][0]!.slice(1).reduce((x, y) => x + y, 0));
    expect(Math.max(...per)).toBeLessThanOrEqual(5); // intake capacity per tick
  });

  it('grain queries count and locate particles (vs brute force over the snapshot)', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: sc.capacity, seed: sc.seed });
    let o = b.stepSync(sc.input(1));
    for (let t = 2; t <= 120; t++) o = b.stepSync(sc.input(t));
    const s = decodeMatr(b.snapshotSync());
    const qs = sc.input(120).queries!;
    qs.forEach((q, k) => {
      let n = 0; const sum = [0n, 0n, 0n];
      for (let i = 0; i < s.count; i++) {
        if (!((q.kindMask >> s.mat[i]!) & 1)) continue;
        const d = [0, 1, 2].map((a) => BigInt(s.pos[i * 3 + a]! - q.center[a]!));
        if (d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]! >= BigInt(q.radius) * BigInt(q.radius)) continue;
        n++; for (let a = 0; a < 3; a++) sum[a]! += BigInt(s.pos[i * 3 + a]!);
      }
      expect(o.near![k]!.count).toBe(n);
      expect(n).toBeGreaterThan(0);
      expect([...o.near![k]!.centroid]).toEqual(sum.map((v) => Number(v / BigInt(n))));
    });
  });

  it('snapshot → restore continues bit for bit', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: sc.capacity, seed: sc.seed });
    for (let t = 1; t <= 100; t++) b.stepSync(sc.input(t));
    const snap = b.snapshotSync();
    const c = new MatterCpu();
    c.restoreSync(snap);
    expect(c.snapshotSync()).toEqual(snap);
    for (let t = 101; t <= 140; t++) expect(sig(c.stepSync(sc.input(t)))).toBe(a.sigs[t - 1]);
  });

  it('drops emits beyond capacity and removes particles below the kill plane', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: 100, seed: 1 });
    const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
    const o = b.stepSync({ tick: 1, proxies: [], emits: [{ seq: 0, kind: 0, count: 150, pos: v3(0, -(1 << 23), 0), vel: v3(), spread: 0, seed: 1 }], intakes: [], blasts: [] });
    expect(o.counts[0]).toBe(0); // all 100 accepted, then killed (64 m below)
    const o2 = b.stepSync({ tick: 2, proxies: [], emits: [{ seq: 0, kind: 1, count: 150, pos: v3(0, 65536, 0), vel: v3(), spread: 0, seed: 1 }], intakes: [], blasts: [] });
    expect(o2.counts[1]).toBe(100);
    expect(o2.counts.length).toBe(KIND_COUNT);
  });

  it('Sandstorm (20k-grain cut) golden: the vendor-matrix scene on the CPU reference', () => {
    expect(run(sandstorm({ grains: 20000 }), 30, 10).sums).toEqual(GOLDEN_STORM_20K);
  });
});

describe('water-surface map (D101)', () => {
  const pool = poolScene();
  it('matches a brute-force column scan of the snapshot (count, top, bottom, mean velocity)', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: pool.capacity, seed: pool.seed });
    let checked = 0;
    for (let t = 1; t <= 100; t++) {
      const o = b.stepSync(pool.input(t));
      if (t % 25 !== 0 && t % 25 !== 24) continue;
      const sf = o.surface!, s = decodeMatr(b.snapshotSync()), nc = sf.nx * sf.nz;
      const n = new Array(nc).fill(0), top = new Array(nc).fill(SURFACE_EMPTY), bot = new Array(nc).fill(SURFACE_EMPTY);
      const vs = Array.from({ length: nc * 3 }, () => 0n);
      for (let i = 0; i < s.count; i++) {
        if (s.mat[i] !== 1) continue;
        const dx = s.pos[i * 3]! - sf.x0, dz = s.pos[i * 3 + 2]! - sf.z0;
        if (dx < 0 || dz < 0 || Math.floor(dx / sf.cell) >= sf.nx || Math.floor(dz / sf.cell) >= sf.nz) continue;
        const c = Math.floor(dz / sf.cell) * sf.nx + Math.floor(dx / sf.cell), y = s.pos[i * 3 + 1]!;
        top[c] = n[c] ? Math.max(top[c], y) : y; bot[c] = n[c] ? Math.min(bot[c], y) : y; n[c]++;
        for (let a = 0; a < 3; a++) vs[c * 3 + a]! += BigInt(s.vel[i * 3 + a]!);
      }
      expect([...sf.count]).toEqual(n);
      expect([...sf.top]).toEqual(top);
      expect([...sf.bottom]).toEqual(bot);
      expect([...sf.vel]).toEqual(vs.map((v, k) => (n[Math.floor(k / 3)] ? Number((v * BigInt(SUBSTEPS)) / BigInt(n[Math.floor(k / 3)])) : 0)));
      expect(n.filter((v) => v > 0).length).toBeGreaterThan(t % 3 === 0 ? 3 : 40);
      checked++;
    }
    expect(checked).toBe(8);
  });
  it('is optional: without a request there is no map, and the run is unchanged', () => {
    const a = new MatterCpu(), b = new MatterCpu();
    a.initSync({ capacity: pool.capacity, seed: pool.seed }); b.initSync({ capacity: pool.capacity, seed: pool.seed });
    for (let t = 1; t <= 30; t++) {
      const inp = pool.input(t);
      const { surface: _s, ...bare } = inp;
      const oa = a.stepSync(inp), ob = b.stepSync(bare);
      expect(ob.surface).toBeUndefined();
      expect(oa.surface).toBeDefined();
      expect(sig(ob)).toBe(sig(oa));
    }
  });
  it('rejects maps out of range', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: 10, seed: 1 });
    const inp = { tick: 1, proxies: [], emits: [], intakes: [], blasts: [] };
    expect(() => b.stepSync({ ...inp, surface: { x0: 0, z0: 0, cell: 100, nx: 1, nz: 1 } })).toThrow(/surface/);
    expect(() => b.stepSync({ ...inp, surface: { x0: 0, z0: 0, cell: 1000, nx: 200, nz: 200 } })).toThrow(/surface/);
  });
});

describe('free flight (regression: MI 2026-10-24, blobs were damped by an energy clamp)', () => {
  it('a thrown particle and a thrown 200-particle blob fly the same ballistic arc', () => {
    const fly = (kind: 0 | 1, count: number): [number, number] => {
      const be = new MatterCpu();
      be.initSync({ capacity: 1000, seed: 1 });
      const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
      be.stepSync({ tick: 1, proxies: [], emits: [{ seq: 0, kind, count, pos: v3(0, 65536, 0), vel: v3(1092, 0, 0), spread: 0, seed: 1 }], intakes: [], blasts: [] });
      const com = (): [number, number] => { let x = 0, y = 0; for (let i = 0; i < be.n; i++) { x += be.pos[i * 3]!; y += be.pos[i * 3 + 1]!; } return [x / be.n / 65536, y / be.n / 65536]; };
      const a = com();
      for (let t = 2; t <= 20; t++) be.stepSync({ tick: t, proxies: [], emits: [], intakes: [], blasts: [] });
      const b = com();
      return [b[0] - a[0], b[1] - a[1]];
    };
    const one = fly(0, 1);
    // 1 m/s for 19 ticks (0.317 s) with SIMULATION's air damping (≈ 250/256 per tick): 0.226 m forward, 0.419 m down
    expect(one[0]).toBeGreaterThan(0.21); expect(one[0]).toBeLessThan(0.25);
    expect(one[1]).toBeGreaterThan(-0.46); expect(one[1]).toBeLessThan(-0.38);
    for (const [k, n] of [[1, 200], [0, 200], [1, 1]] as const) {
      const f = fly(k, n);
      expect(Math.abs(f[0] - one[0])).toBeLessThan(0.01);
      expect(Math.abs(f[1] - one[1])).toBeLessThan(0.01);
    }
  });
});

describe('parallel CPU driver', () => {
  it('equals the serial CPU reference bit for bit (4 worker threads)', async () => {
    const { MatterCpuParallel } = await import('../src/node/parallel.ts');
    const sc = mixScene(1);
    const p = new MatterCpuParallel(4);
    await p.init({ capacity: sc.capacity, seed: sc.seed });
    p.minRange = 16;
    const a = run(sc, 90, 1000);
    for (let t = 1; t <= 90; t++) expect(sig(p.stepSync(sc.input(t)))).toBe(a.sigs[t - 1]);
    p.destroy();
  }, 120_000);
});

// ---- M5 (stream X5): goo, world gravity and gravity zones -----------------------------------------------------------

/** Goo particles with no other goo particle within the cohesion range (torn-off drops). */
function loneGoo(be: MatterCpu): number {
  let lone = 0;
  for (let i = 0; i < be.n; i++) {
    if ((be.mat[i]! & 0xff) !== 3) continue;
    let nb = false;
    for (let j = 0; j < be.n && !nb; j++) {
      if (j === i || (be.mat[j]! & 0xff) !== 3) continue;
      const dx = be.pos[i * 3]! - be.pos[j * 3]!, dy = be.pos[i * 3 + 1]! - be.pos[j * 3 + 1]!, dz = be.pos[i * 3 + 2]! - be.pos[j * 3 + 2]!;
      nb = dx * dx + dy * dy + dz * dz < GOO_H * GOO_H;
    }
    if (!nb) lone++;
  }
  return lone;
}

describe('goo (kind 3, X5)', () => {
  const sc = gooScene();
  const a = run(sc, 260, 26);

  it('goo scene golden (rope, puddle, hanging lid, rolling ball, every kind, capacity-limited goo intake, blast)', () => {
    expect(a.sums).toEqual(GOLDEN_GOO);
  });

  it('is deterministic run to run, and snapshot → restore continues bit for bit', () => {
    const b = new MatterCpu();
    b.initSync({ capacity: sc.capacity, seed: sc.seed });
    for (let t = 1; t <= 130; t++) expect(sig(b.stepSync(sc.input(t)))).toBe(a.sigs[t - 1]);
    const c = new MatterCpu();
    c.restoreSync(b.snapshotSync());
    for (let t = 131; t <= 170; t++) expect(sig(c.stepSync(sc.input(t)))).toBe(a.sigs[t - 1]);
  });

  it('holds together: almost every goo particle keeps a neighbour; the intake takes only goo, ≤ its capacity', () => {
    const outs = a.sigs.map((s) => JSON.parse(s) as [string, number[], number[], number[][], number[][]]);
    const goo = a.be.mat.subarray(0, a.be.n).filter((m) => (m & 0xff) === 3).length;
    expect(goo).toBeGreaterThan(500);
    expect(loneGoo(a.be)).toBeLessThan(goo * 0.03);
    const abs = outs.map((o) => o[4][0]!.slice(1));
    expect(Math.max(...abs.map((k) => k[3]!))).toBeLessThanOrEqual(3);
    expect(abs.every((k) => k[0] === 0 && k[1] === 0 && k[2] === 0)).toBe(true);
    expect(abs.reduce((n, k) => n + k[3]!, 0)).toBeGreaterThan(0);
  });

  it('drags on a body moving through it (the impulse opposes the motion) and weighs on what it hangs from', () => {
    // the ball (proxy 10) rolls +x on ticks 0–79 of each 160 and −x on 80–159 (gooScene); once the puddle is down,
    // its x impulse opposes its motion (the goo's drag), and the lid (proxy 11) is pulled down by the goo on it
    const outs = a.sigs.map((s) => JSON.parse(s) as [string, number[], number[], number[][], number[][]]);
    let oppose = 0, assist = 0, lidDown = 0;
    for (let t = 100; t <= 260; t++) {
      const imp = outs[t - 1]![3];
      const ball = imp.find((i) => i[0] === 10)!, lid = imp.find((i) => i[0] === 11)!;
      const dir = (t % 160) < 80 ? 1 : -1;
      if (ball[1]! * dir < 0) oppose++; else if (ball[1]! * dir > 0) assist++;
      if (lid[2]! < 0) lidDown++;
    }
    expect(oppose).toBeGreaterThan(3 * assist);
    expect(lidDown).toBeGreaterThan(40);
  });

  it('goo against a static ramp sticks: a puddle on a gentle slope creeps (viscous), it doesn’t slide off', () => {
    const be = new MatterCpu();
    be.initSync({ capacity: 2000, seed: 1 });
    const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
    const ramp = { id: 1, shape: 2 as const, pos: v3(0, -6554, 0), rot: Int32Array.of(0, 0, 1427, 16322), size: v3(65536, 6554, 65536), vel: v3(), ang: v3(), dynamic: false }; // 10°
    const com = (): number => { let x = 0, n = 0; for (let i = 0; i < be.n; i++) { x += be.pos[i * 3]!; n++; } return x / n / 65536; };
    be.stepSync({ tick: 1, proxies: [ramp], emits: [{ seq: 0, kind: 3, count: 216, pos: v3(0, 4500, 0), vel: v3(), spread: 0, seed: 1 }], intakes: [], blasts: [] });
    for (let t = 2; t <= 60; t++) be.stepSync({ tick: t, proxies: [ramp], emits: [], intakes: [], blasts: [] });
    const x0 = com();
    for (let t = 61; t <= 180; t++) be.stepSync({ tick: t, proxies: [ramp], emits: [], intakes: [], blasts: [] });
    // sand on 10° stays put; water would run off (≈ 0.8 m in 2 s); goo creeps a few centimetres
    expect(Math.abs(com() - x0)).toBeLessThan(0.08);
  });
});

describe('world gravity and gravity zones (D104, X5)', () => {
  it('gravitySteps splits Q8 gravity exactly: Earth is 11 every substep, any G sums to G per 256 substeps', () => {
    for (let t = 0; t < 100; t++) expect([...gravitySteps(GRAVITY_Q8, t)]).toEqual([11, 11, 11, 11]);
    for (const G of [0, 1, 255, 465, 572, 1149, 2815, 2817, 9999]) {
      let sum = 0;
      for (let t = 0; t < 64; t++) for (const g of gravitySteps(G, t + 1000)) sum += g;
      expect(sum).toBe(G);
    }
  });

  it('an explicit Earth gravity (2,816) is exactly the default: the mix scene runs bit for bit', () => {
    const sc = mixScene(1);
    const b = new MatterCpu();
    b.initSync({ capacity: sc.capacity, seed: sc.seed });
    const ref = run(sc, 60, 1000).sigs;
    for (let t = 1; t <= 60; t++) expect(sig(b.stepSync({ ...sc.input(t), gravity: 2816 }))).toBe(ref[t - 1]);
  });

  it('a free grain falls at the world’s gravity: drop times over 5–50 cm are Earth’s × 1/√p within 6 % (Hangar, Moon)', () => {
    const ticksToDrop = (G: number, h: number): number => {
      const be = new MatterCpu();
      be.initSync({ capacity: 10, seed: 1 });
      const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
      be.stepSync({ tick: 1, proxies: [], emits: [{ seq: 0, kind: 0, count: 1, pos: v3(0, 4 * 65536, 0), vel: v3(), spread: 0, seed: 1 }], intakes: [], blasts: [], gravity: G });
      for (let t = 2; t < 400; t++) {
        be.stepSync({ tick: t, proxies: [], emits: [], intakes: [], blasts: [], gravity: G });
        if (4 - be.pos[1]! / 65536 >= h) return t;
      }
      return -1;
    };
    // (Earth's own fall stays under the velocity clamp up to ≈ 0.5 m)
    for (const h of [0.05, 0.2, 0.5]) {
      const e = ticksToDrop(GRAVITY_Q8, h);
      for (const p of [38, 16.5]) {
        const t = ticksToDrop(gravityQ8(p), h), ideal = e / Math.sqrt(p / 100);
        expect(Math.abs(t - ideal) / ideal, `h ${h} p ${p}`).toBeLessThan(0.06);
      }
    }
    expect(ticksToDrop(0, 0.01)).toBe(-1); // zero-g: it never moves
  });

  it('grains rest on gentle tilted surfaces at any gravity (no creep from the push rounding)', () => {
    const v3 = (x = 0, y = 0, z = 0): Int32Array => Int32Array.of(x, y, z);
    for (const [shape, G] of [[2, gravityQ8(16.5)], [3, gravityQ8(16.5)], [2, GRAVITY_Q8]] as const) {
      const be = new MatterCpu();
      be.initSync({ capacity: 200, seed: 1 });
      const slope = { id: 1, shape, pos: v3(0, -6554, 0), rot: Int32Array.of(0, 0, 329, 16381), size: v3(65536, 6554, 65536), vel: v3(), ang: v3(), dynamic: false }; // 2.3°
      const x = (): number => { let s = 0; for (let i = 0; i < be.n; i++) s += be.pos[i * 3]!; return s / be.n / 65536; };
      be.stepSync({ tick: 1, proxies: [slope], emits: [{ seq: 0, kind: 0, count: 64, pos: v3(0, 1500, 0), vel: v3(), spread: 0, seed: 1 }], intakes: [], blasts: [], gravity: G });
      for (let t = 2; t <= 60; t++) be.stepSync({ tick: t, proxies: [slope], emits: [], intakes: [], blasts: [], gravity: G });
      const x0 = x();
      for (let t = 61; t <= 300; t++) be.stepSync({ tick: t, proxies: [slope], emits: [], intakes: [], blasts: [], gravity: G });
      expect(Math.abs(x() - x0), `shape ${shape} G ${G}`).toBeLessThan(0.001); // it slid 1.1 m in 4 s before X5's fix
    }
  });

  it('low-g scene golden; grains in the zero-g zone float, the half-g box zone and the Moon outside fall', () => {
    const sc = lowGravityScene();
    const r = run(sc, 300, 30);
    expect(r.sums).toEqual(GOLDEN_LOWG);
    expect(run(sc, 300, 30).sums).toEqual(r.sums);
    // sand poured into the zero-g cylinder (x −0.1 m, y 0.13 … 0.37 m) hangs there
    const be = r.be;
    let floating = 0, sand = 0;
    for (let i = 0; i < be.n; i++) {
      if ((be.mat[i]! & 0xff) !== 0) continue;
      sand++;
      const x = be.pos[i * 3]! / 65536, y = be.pos[i * 3 + 1]! / 65536;
      if (Math.abs(x + 0.1) < 0.09 && y > 0.12 && y < 0.38) floating++;
    }
    expect(floating).toBeGreaterThan(sand * 0.5);
    // water poured at y 0.4 m through the half-g box zone has all fallen out of the pour, most of it down to the ramp
    const wy: number[] = [];
    for (let i = 0; i < be.n; i++) if ((be.mat[i]! & 0xff) === 1) wy.push(be.pos[i * 3 + 1]! / 65536);
    expect(wy.length).toBeGreaterThan(100);
    expect(Math.max(...wy)).toBeLessThan(0.37);
    expect(wy.reduce((a, b) => a + b, 0) / wy.length).toBeLessThan(0.2);
  });

  it('the parallel CPU driver equals the serial reference on goo and zones (4 worker threads)', async () => {
    const { MatterCpuParallel } = await import('../src/node/parallel.ts');
    for (const sc of [gooScene(), lowGravityScene()]) {
      const p = new MatterCpuParallel(4);
      await p.init({ capacity: sc.capacity, seed: sc.seed });
      p.minRange = 8;
      const ref = run(sc, 80, 1000).sigs;
      for (let t = 1; t <= 80; t++) expect(sig(p.stepSync(sc.input(t)))).toBe(ref[t - 1]);
      p.destroy();
    }
  }, 120_000);
});

describe('WGSL kernels', () => {
  const FLOAT = /\bf(16|32)\b|\b(vec[234]|mat[234]x[234])[fh]\b|\d\.\d|\.\d+\b|\d[eE][+-]?\d|0[xX][0-9a-fA-F]*[pP]|\b(sqrt|inverseSqrt|exp2?|log2?|pow|sin|cos|tan|floor|ceil|round|fract|trunc|mix|smoothstep|step|length|normalize|distance|fma|ldexp|frexp|modf|degrees|radians|atan2?)\s*\(/;
  const strip = (src: string): string => src.replace(/\/\/.*$/gm, '').replace(/\b0[xX][0-9a-fA-F]+[ui]?\b/g, '0');
  it('contain no floating-point types, literals or float builtins (SIMULATION §8.3)', () => {
    for (const [name, src] of Object.entries(MATTER_WGSL)) expect(strip(src), name).not.toMatch(FLOAT);
  });
  it('the validator catches floats', () => {
    for (const bad of ['let a: f32 = 1;', 'let a = 1.5;', 'let a = sqrt(x);', 'var v: vec3f;', 'let a = 1e3;', 'let a = .5;']) expect(strip(bad)).toMatch(FLOAT);
  });
  it('M0 spike kernels stay float-free too', () => {
    for (const [name, src] of Object.entries(spike.MATTER_WGSL)) expect(strip(src), name).not.toMatch(FLOAT);
  });
});

describe('M0 spike (legacy, unchanged)', () => {
  it('still matches its NVIDIA GPU golden (2,048 grains × 60 ticks)', () => {
    const sim = new spike.MatterCpu(spike.initialState(2048));
    for (let t = 1; t <= 60; t++) sim.step();
    expect(spike.checksumHex(sim.checksum())).toBe('002f60fa00098ce5ffdd602a244cbfad');
  });
});

// X5 re-pin (2026-10-25): the proxy push is rounded sign-symmetrically (cpu.ts apply), which moves grains resting on the
// mix scene's tilted ramp and spinning paddle (negative normal components); goo and gravity don't touch this scene
const GOLDEN_MIX = ['d470ecaf1b001fa7', '9b513cd048b9b5d4', '0da5987c8920d6a3', '1825044665006dd3', 'e7d8ceff90f3cc19', 'a877e845b0f7eccc', 'c781f247f7aa6b3c', 'afab900aec8b6341'];
const GOLDEN_STORM_20K = ['b5caccf2caab88af', '88ac2b73d5b269b8', 'bf349d289c265b50'];
// X5 goldens (2026-10-25): every 26 ticks of gooScene, every 30 of lowGravityScene; GPU = CPU in the harness (D3D12,
// D3D11, SwiftShader)
const GOLDEN_GOO = ['61d8357f35868fb1', 'a7254b6b64db4d60', 'ed58118996e20773', 'ea9565dfa090eaad', 'e6bbe58884300ff2', 'a9715b3c205783ba', '0616275d695f63e2', '8c3d04a7d57c28e9', 'b587dd3fd4f645bd', '2a6097af37ba20bc'];
const GOLDEN_LOWG = ['4df71a9a3a825ec3', '4a58df44e68922ef', 'a0fe4ebcaacdb539', 'ae109722c3f30bec', 'e07844eb164e8fad', '916ebd15afe867e0', 'c099ee7f7bc0d7d1', '475e4e8e8b6b9a4a', '1c7ed14cb0e2c7ae', '7f3a43c47fbb3304'];
