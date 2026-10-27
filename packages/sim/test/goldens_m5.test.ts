// Per-part golden machines for the M5 parts (stream A5, PART_SYSTEM §6–8): each Library demo runs headless twice
// (identical hashes and events), shows its part's main interaction (asserted through events, cause chains, flags, meters
// and body state), and pins its final state hash. Matter is off (D102: the M5 fields act on rigid bodies only).

import { describe, expect, it } from 'vitest';
import { golden } from './golden_helper.ts';
import type { Machine } from '../src/index.ts';

const T = 30_000;
const flags = (m: Machine): number[] => Array.from(m.partFlags(new Uint8Array(m.parts.length)));
const meters = (m: Machine): number[] => Array.from(m.partMeters(new Uint8Array(m.parts.length)));
const at = (type: string) => (g: { demo: { parts: readonly { type: string }[] } }, n = 0): number => g.demo.parts.map((p, i) => (p.type === type ? i : -1)).filter((i) => i >= 0)[n]!;

describe('golden machines (M5 parts)', () => {
  it('rift_gate: the STITCH falls into the gate lying face up and leaves its upright twin along +X at the same speed', async () => {
    const g = await golden('rift_gate', flags);
    const [a, b] = g.ids('rift_gate');
    const s = g.id('stitch');
    const tp = g.events('Teleport')[0]!;
    expect(tp.part).toBe(a);
    expect(tp.other).toBe(s);
    expect(tp.mag).toBeGreaterThan(3.5); // ≈ √(2 g · 0.75 m)
    const em = g.events('Emerge')[0]!;
    expect(em.part).toBe(b);
    expect(em.cause).toBe(tp.id);
    expect(em.mag).toBeCloseTo(tp.mag, 5); // momentum kept
    expect(g.events('Teleport')).toHaveLength(1);
    // it appears in front of B (x > 0.6) at the aperture's height, moving +X, and knocks the tiles over
    const after = g.path(s)[em.tick + 1]!;
    expect(after[0]).toBeGreaterThan(0.6);
    expect(after[1]).toBeCloseTo(0.205, 1);
    expect(g.path(s)[em.tick + 6]![0]).toBeGreaterThan(after[0] + 0.1);
    for (const tile of g.ids('topple_tile')) expect(g.moved(tile)).toBeGreaterThan(0.05);
    // flags: both gates lit (paired); armed during the 0.25 s cooldown
    const ia = at('rift_gate')(g), ib = at('rift_gate')(g, 1);
    expect(g.samples[0]![ia]! & 1).toBe(1);
    expect(g.samples[em.tick + 10]![ib]! & 16).toBe(16);
    expect(g.samples[em.tick + 40]![ib]! & 16).toBe(0);
    expect(g.hash).toMatchInlineSnapshot(`"5d41c6fe68dbee72"`);
  }, T);

  it('grav_well: switched on, it pulls the balls lying up to 0.6 m away in to its orb', async () => {
    const g = await golden('grav_well', flags);
    expect(g.events('Powered', g.id('grav_well'))).toHaveLength(1);
    for (const id of [...g.ids('stitch'), g.id('glint')]) {
      const e = g.now(id);
      expect(Math.hypot(e[0], e[2]), `${id}`).toBeLessThan(0.15);
    }
    expect(g.samples[10]![at('grav_well')(g)]! & 1).toBe(1);
    expect(g.hash).toMatchInlineSnapshot(`"30dfe7c6a5a8a3a1"`);
  }, T);

  it('tractor_beam: it lifts the STITCH 1 m down its beam and reels it in at 0.5 m/s to just short of the lens', async () => {
    const g = await golden('tractor_beam', meters);
    const s = g.id('stitch');
    const att = g.events('Attach', g.id('tractor_beam'))[0]!;
    expect(att.other).toBe(s);
    expect(g.path(s)[60]![1]).toBeCloseTo(0.06, 2); // floating on the beam axis (lens height)
    const speed = (g.path(s)[60]![2] - g.path(s)[180]![2]) / 1;
    expect(speed).toBeCloseTo(0.5, 1); // the servo runs ≈ 1 % slow (Jolt's default linear damping)
    expect(g.now(s)[2]).toBeCloseTo(0.155 + 0.0375 + 0.03, 2);
    expect(g.events('Release')).toHaveLength(0);
    expect(g.samples[200]![at('tractor_beam')(g)]!).toBe(1 + Math.round((20 * 0.15) / 2)); // load bar: 0.15 kg of 2
    expect(g.hash).toMatchInlineSnapshot(`"9ef27524e58b94bd"`);
  }, T);

  it('hover_pad: powered, it rises 0.5 m carrying the 7 kg THUD (sagging under 1 cm), then falls when the MAINS goes off', async () => {
    const g = await golden('hover_pad', flags);
    const pad = g.id('hover_pad');
    expect(g.path(pad)[60]![1]).toBeCloseTo(0.25, 1); // rising at 0.5 m/s
    const y = g.path(pad)[230]![1];
    expect(y).toBeLessThan(0.5);
    expect(0.5 - y).toBeLessThan(0.01); // sag ≤ 1 cm under 7 kg (SIMULATION §5.12: ≤ 1 cm at 10 kg)
    expect(Math.abs(g.path(g.id('thud'))[230]![0])).toBeLessThan(0.01); // carried, not rolled off
    const off = g.events('Unpowered', pad)[0]!;
    expect(g.chain(off)).toEqual(['Unpowered', 'Signal', 'Ring']);
    expect(g.now(pad)[1]).toBeLessThan(0.02); // dropped
    expect(g.samples[200]![at('hover_pad')(g)]! & 1).toBe(1);
    expect(g.samples.at(-1)![at('hover_pad')(g)]! & 1).toBe(0);
    expect(g.hash).toMatchInlineSnapshot(`"916eab42423fd784"`);
  }, T);

  it('force_wall: the wall across the slope stops the STITCH; switched off at 1 s, the STITCH rolls on through', async () => {
    const g = await golden('force_wall', flags);
    const wall = g.id('force_wall'), s = g.id('stitch');
    expect(g.path(s)[110]![0]).toBeCloseTo(0.2 + 0.01 + 0.0375, 2); // held against the field
    const off = g.events('Barrier', wall)[0]!;
    expect(off.mag).toBe(0);
    expect(off.tick).toBe(120);
    expect(g.chain(off)).toEqual(['Barrier', 'Signal', 'Ring']);
    expect(g.now(s)[0]).toBeLessThan(-0.5);
    const i = at('force_wall')(g);
    expect(g.samples[100]![i]! & 1).toBe(1);
    expect(g.samples[130]![i]! & 1).toBe(0);
    expect(g.hash).toMatchInlineSnapshot(`"0b84a14ae53e0258"`);
  }, T);

  it('coilgun_ring: charged in 0.5 s, it kicks the passing PIG IRON on by 3 m/s into the tiles, then recharges', async () => {
    const g = await golden('coilgun_ring', meters);
    const ring = g.id('coilgun_ring'), ball = g.id('pig_iron');
    const [c1, c2] = g.events('Charged', ring);
    expect(c1!.tick / 120).toBeCloseTo(0.5, 1);
    const boost = g.events('Boost', ring)[0]!;
    expect(boost.other).toBe(ball);
    expect(boost.mag).toBe(3);
    expect(g.events('Boost', ring)).toHaveLength(1); // once per pass
    expect((c2!.tick - boost.tick) / 120).toBeCloseTo(0.5, 1);
    const p = g.path(ball);
    const vBefore = (p[boost.tick - 1]![0] - p[boost.tick - 7]![0]) * 20, vAfter = (p[boost.tick + 7]![0] - p[boost.tick + 1]![0]) * 20;
    expect(vBefore - vAfter).toBeCloseTo(3, 0); // +3 m/s along −X (the ring faces −X)
    for (const tile of g.ids('topple_tile')) expect(g.moved(tile)).toBeGreaterThan(0.05);
    const i = at('coilgun_ring')(g);
    expect(g.samples[c1!.tick]![i]).toBe(21);
    expect(g.samples[boost.tick]![i]).toBeLessThan(3);
    expect(g.hash).toMatchInlineSnapshot(`"06394b7c491705cf"`);
  }, T);

  it('stasis_field: it freezes the falling balls in mid-air for 2 s; when the MAINS goes off they drop', async () => {
    const g = await golden('stasis_field', flags);
    const f = g.id('stasis_field');
    const [on, off] = g.events('Engage', f);
    expect(on!.mag).toBe(1);
    expect(off!.mag).toBe(0);
    expect(off!.tick).toBe(240);
    const frozen = g.events('Freeze', f).map((e) => e.other);
    expect(frozen.sort()).toEqual([g.id('boing'), g.id('stitch')].sort());
    for (const id of [g.id('boing'), g.id('stitch')]) {
      const a = g.path(id)[120]!, b = g.path(id)[239]!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `${id} still`).toBeLessThan(1e-4);
      expect(a[1]).toBeGreaterThan(0.4);
      expect(g.now(id)[1]).toBeLessThan(a[1] - 0.1); // released: falling
    }
    expect(g.samples[100]![at('stasis_field')(g)]! & 1).toBe(1);
    expect(g.hash).toMatchInlineSnapshot(`"815bc4bf31e22737"`);
  }, T);

  it('buzz_beacon: the button calls BUZZ; the beacon counts the call (Signal → Call)', async () => {
    const g = await golden('buzz_beacon', flags);
    const b = g.id('buzz_beacon');
    const call = g.events('Call', b)[0]!;
    expect(call.mag).toBe(1);
    expect(g.chain(call)).toEqual(['Call', 'Signal', 'Press']);
    expect(g.samples[call.tick]![at('buzz_beacon')(g)]! & 4).toBe(4); // pressed flash
    expect(g.hash).toMatchInlineSnapshot(`"3ddbf5f884fae24c"`);
  }, T);

  it('singularity: armed by the button, it pulls in and swallows every loose body around it, one by one', async () => {
    const g = await golden('singularity', meters);
    const s = g.id('singularity');
    const arm = g.events('Engage', s)[0]!;
    expect(g.chain(arm)).toEqual(['Engage', 'Signal', 'Press']);
    const gone = g.events('Despawn', s);
    const loose = g.demo.parts.filter((p) => !['singularity', 'the_button'].includes(p.type)).map((p) => p.id);
    expect(gone.map((e) => e.other).sort()).toEqual([...loose].sort());
    gone.forEach((e, k) => expect(e.mag).toBe(k + 1));
    expect(g.chain(gone.at(-1)!)).toContain('Engage');
    expect(g.events('Collapse')).toHaveLength(0); // 6 s: after the demo
    expect(g.samples[10]![at('singularity')(g)]).toBe(7); // "6" on the countdown (+1)
    expect(g.hash).toMatchInlineSnapshot(`"1b9a0fe35d01d047"`);
  }, T);

  it('grabber: powered and repeating, it picks the STITCH up at zone A and sets it down at zone B', async () => {
    const g = await golden('grabber', (m) => [...flags(m), ...Array.from(m.grabberJoints())]);
    const arm = g.id('grabber'), s = g.id('stitch');
    const [first] = g.events('Trigger', arm);
    expect(first!.tick).toBe(0);
    const grip = g.events('Attach', arm)[0]!, put = g.events('Release', arm)[0]!;
    expect(grip.other).toBe(s);
    expect(put.other).toBe(s);
    expect(g.path(s)[grip.tick + 40]![1]).toBeGreaterThan(0.1); // lifted
    const end = g.path(s)[put.tick + 60]!;
    expect(end[0]).toBeCloseTo(0.25 * Math.sin(Math.PI / 3), 1); // zone B: 60° from the front, 0.25 m out
    expect(end[2]).toBeCloseTo(0.25 * Math.cos(Math.PI / 3), 1);
    expect(end[1]).toBeCloseTo(0.0375, 2); // on the floor
    expect(g.events('Jam')).toHaveLength(0);
    const n = g.demo.parts.length, i = at('grabber')(g);
    expect(g.samples[grip.tick + 10]![i]! & 1).toBe(1); // lit while holding
    expect(g.samples[grip.tick + 10]![n + 7]).toBe(1); // joints: held
    expect(g.samples[grip.tick + 30]![n + 6]).toBeCloseTo(0.0375 + 0.001, 4); // PARTSIM (D120): the fingers closed on the STITCH (+1 mm)
    expect(g.samples[0]![n + 6]).toBeCloseTo(0.04, 4); // open at the 0.08 m grip
    expect(g.samples[0]![n]).toBe(i); // joints: part index
    expect(g.hash).toMatchInlineSnapshot(`"43b0667de0dc49d6"`);
  }, T);
});
