// X5 (M5): GOO VAT and goo in the Machine. The part is A4's dispenser with goo (channels/m4_matter.ts, defs_m5_matter.ts):
// its stored goo leaves the vat only at the nozzle, comes back through the lid hatch, and with Matter on it becomes
// Matter goo (kind 3, SIMULATION §8): cohesive, viscous and sticky, so it catches and slows a rolling ball. Matter off,
// the vat still toggles, drains and signals the same (the golden machine). MX's CPU backend in Node.

import { describe, expect, it } from 'vitest';
import { GOO_VAT, partDef } from '@knockon/parts-data';
import { MatterCpu } from '../../matter/src/index.ts';
import { Machine } from '../src/index.ts';
import { matterGrains } from '../src/matter/budget.ts';
import { golden } from './golden_helper.ts';
import { Build, jolt, pose } from './harness.ts';

const T = 600_000;

async function matterMachine(b: Build, be = new MatterCpu()): Promise<Machine> {
  return new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: be, capacity: 8192 } });
}

function go(m: Machine, ticks: number, each?: (t: number) => void): string[] {
  const hs: string[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); m.drainEvents(); each?.(t); if (t % 30 === 29) hs.push(m.hash()); }
  return hs;
}

const fullVat = (): Build['parts'] => { const b = new Build(); b.add('goo_vat', 0, 0, 0); return b.parts; };
const halfVat = (): Build['parts'] => { const b = new Build(); b.add('goo_vat', 0, 0, 0, { start: 50 }); return b.parts; };
const fillOf = (m: Machine, i: number): number => m.partFill(new Float32Array(m.parts.length))[i]!;

/** The demo layout: an open vat (20 % = 846 goo particles at 1 L/s) and a STITCH rolled down a slope past its nozzle. */
function demo(open: number): { b: Build; ball: number } {
  const b = new Build();
  b.add('goo_vat', 0, 0, 0, { flow: 1, start: 20, open });
  b.add('slope', 0.5, 0, 0.3, { angle: 20 });
  const ball = b.add('stitch', 0.7, 0.22, 0.3);
  return { b, ball };
}

describe('GOO VAT golden machine (Matter off)', () => {
  it('goo_vat: open from the start it drains its 20 % at 1 L/s and signals Empty; lit while pouring, amber when low', async () => {
    const flags = (m: Machine): number[] => Array.from(m.partFlags(new Uint8Array(m.parts.length)));
    const g = await golden('goo_vat', flags);
    const vat = g.ids('goo_vat')[0]!;
    const empty = g.events('Empty', vat);
    expect(empty).toHaveLength(1);
    // 846 particles at 470 per second: 1.8 s (216 ticks)
    expect(empty[0]!.tick).toBeGreaterThan(210);
    expect(empty[0]!.tick).toBeLessThan(222);
    expect(g.samples[10]![0]! & 1).toBe(1); // lit: pouring
    expect(g.samples[200]![0]! & 64).toBe(64); // under 10 %: the amber blink
    expect(g.samples[300]![0]! & 1).toBe(0); // empty: dark
    expect(g.hash).toMatchInlineSnapshot(`"6da39fabebc65f97"`);
  }, T);

  it('a Signal on `open` toggles the valve (Valve events), like TANK', async () => {
    const b = new Build();
    const vat = b.add('goo_vat', 0, 0, 0, { start: 50 });
    const button = b.add('the_button', -0.5, 0, 0.3);
    b.add('thud', -0.5, 0.2, 0.3);
    b.link('cable_signal', button, 'out', vat, 'open');
    const m = new Machine(await jolt(), b);
    const kinds: string[] = [];
    for (let t = 0; t < 240; t++) { m.step(); for (const e of m.drainEvents()) if (e.part === vat) kinds.push(e.kind); }
    expect(kinds).toContain('Valve');
    expect(fillOf(m, 0)).toBeLessThan(0.5); // draining at 0.3 L/s once opened
    expect(fillOf(m, 0)).toBeGreaterThan(0.3);
    m.destroy();
  }, T);
});

describe('GOO VAT with Matter on (MX CPU backend)', () => {
  it('every particle that leaves the store is live goo; the vat empties', async () => {
    const { b } = demo(1);
    const m = await matterMachine(b);
    go(m, 300);
    expect(fillOf(m, 0)).toBe(0);
    expect(m.matter.count(3)).toBe(Math.round(GOO_VAT.capacity * 0.2)); // 846
    expect(m.matter.count(0) + m.matter.count(1) + m.matter.count(2)).toBe(0);
    m.destroy();
  }, T);

  it('the goo catches and slows a STITCH rolling past the nozzle (it rolls on 1.5 m without it)', async () => {
    const travel = async (open: number): Promise<number> => {
      const { b, ball } = demo(open);
      const m = await matterMachine(b);
      go(m, 360);
      const x = pose(m, ball).p[0];
      m.destroy();
      return 0.7 - x;
    };
    const free = await travel(0), goo = await travel(1);
    expect(free).toBeGreaterThan(2.0); // measured 2.2 m (from x 0.7 to −1.5)
    expect(goo).toBeLessThan(free * 0.6); // measured 1.15 m: caught in the puddle
  }, T);

  it('goo dropped into the lid hatch refills the vat (only goo: water poured in the same place stays out)', async () => {
    const b = new Build();
    b.add('goo_vat', 0, 0, 0, { start: 0 });
    const m = await matterMachine(b);
    for (let t = 0; t < 360; t++) {
      // a little goo and a little water above the hatch (part space (0, 0.285, −0.06)) every 6 ticks for 2 s
      if (t % 6 === 0 && t < 240) {
        m.matter.emitWorld(-1, 3, 4, [0, 0.36, -0.06], [0, -0.5, 0], 0.01);
        m.matter.emitWorld(-1, 1, 4, [0.0, 0.36, -0.06], [0, -0.5, 0], 0.01);
      }
      m.step(); m.drainEvents();
    }
    const got = fillOf(m, 0) * GOO_VAT.capacity;
    expect(got).toBeGreaterThan(50); // of the 160 goo particles dropped
    expect(m.matter.count(1)).toBeGreaterThan(100); // the water stayed out
    m.destroy();
  }, T);

  it('replays identically, and a late-poke rollback through the pour rejoins the straight run', async () => {
    const { b } = demo(1);
    const a = await matterMachine(b);
    const hs: string[] = [];
    for (let t = 0; t < 420; t++) { a.step(); a.drainEvents(); if (t >= 240) hs.push(a.hash()); }
    a.destroy();
    const m = await matterMachine(b);
    go(m, 330);
    expect(m.restore(240)).toBe(240);
    const h2: string[] = [];
    for (let t = 240; t < 420; t++) { m.step(); m.drainEvents(); h2.push(m.hash()); }
    expect(h2).toEqual(hs);
    m.destroy();
    const m2 = await matterMachine(b), m3 = await matterMachine(b);
    expect(go(m2, 240)).toEqual(go(m3, 240));
    m2.destroy(); m3.destroy();
  }, T);

  it('goo joins the world hash only where there is goo (Matter worlds without it hash as in M4)', async () => {
    const { b } = demo(1);
    const m = await matterMachine(b);
    go(m, 60);
    expect(m.matter.count(3)).toBeGreaterThan(0);
    const st = (m as unknown as { st: { matter: { counts: number[]; cont: number[] } } }).st.matter;
    expect(st.counts).toHaveLength(4);
    m.destroy();
  }, T);

  it('the Matter budget counts a vat’s goo: 9 L × 470 per litre × its start %', () => {
    expect(partDef('goo_vat')).toBeDefined();
    expect(matterGrains(new Build().parts.concat(fullVat()))).toBe(4230);
    expect(matterGrains(halfVat())).toBe(2115);
  });
});
