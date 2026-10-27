// Per-part golden machines for the M4 parts (stream A4, PART_SYSTEM §6–8): each Library demo runs headless twice
// (identical hashes and events), shows its part's main interaction (asserted through events, cause chains, fill and body
// state), and pins its final state hash. These run with Matter gameplay off (the default MachineOptions): the Matter
// containers still run their valves and drain their stored quantity; m4_matter.test.ts runs the Matter parts with
// MX's CPU backend on.

import { describe, expect, it } from 'vitest';
import { before, golden } from './golden_helper.ts';
import type { Machine } from '../src/index.ts';

const T = 30_000;
/** Fill per part each tick (Machine.partFill). */
const fills = (m: Machine): number[] => Array.from(m.partFill(new Float32Array(m.parts.length)));
/** Part flags each tick. */
const flags = (m: Machine): number[] => Array.from(m.partFlags(new Uint8Array(m.parts.length)));
/** Rotation (radians) about Z of the first `type` part's arm body. */
const armZ = (m: Machine, type: string): number => {
  const info = m.bodyInfo();
  const i = info.findIndex((b) => b.type === type && b.role === 'arm');
  const t = m.transforms(new Float32Array(info.length * 7));
  return 2 * Math.atan2(t[i * 7 + 5]!, t[i * 7 + 6]!);
};

describe('golden machines (M4 parts)', () => {
  // ---- Matter ---------------------------------------------------------------------------------------------------
  it('grit_hopper: the button opens the gate; its 2,500 grains pour out in 0.5 s and it reports empty', async () => {
    const g = await golden('grit_hopper', fills);
    const hop = g.id('grit_hopper');
    const valve = g.events('Valve', hop)[0]!;
    expect(valve.mag).toBe(1);
    expect(g.chain(valve)).toEqual(['Valve', 'Signal', 'Press']);
    const empty = g.events('Empty', hop)[0]!;
    expect(empty.cause).toBe(valve.id);
    expect((empty.tick - valve.tick) / 120).toBeCloseTo(0.5, 1); // 2,500 grains at 5,000/s
    expect(g.samples[0]![0]).toBeCloseTo(0.05, 3); // 5 % of 50k
    expect(g.samples.at(-1)![0]).toBe(0);
    expect(g.hash).toMatchInlineSnapshot(`"0c328e0ce8d934e2"`);
  }, T);

  it('hourglass: the 2 s timer runs out and its signal sets off the bangstick', async () => {
    const g = await golden('hourglass', fills);
    const empty = g.events('Empty', g.id('hourglass'))[0]!;
    expect(empty.tick / 120).toBeCloseTo(2, 1);
    const boom = g.events('Detonate', g.id('bangstick'))[0]!;
    expect(g.chain(boom)).toEqual(['Detonate', 'Signal', 'Empty']);
    expect(g.samples[119]![0]).toBeCloseTo(0.5, 1); // half the top bulb gone at 1 s
    expect(g.events('Flip')).toHaveLength(0);
    expect(g.hash).toMatchInlineSnapshot(`"d61708ebdfcbc0bb"`);
  }, T);

  it('tank: the button opens the valve and the stored water drains at 1 L/s', async () => {
    const g = await golden('tank', fills);
    const valve = g.events('Valve', g.id('tank'))[0]!;
    expect(g.chain(valve)).toEqual(['Valve', 'Signal', 'Press']);
    const a = g.samples[60]![0]!, b = g.samples[180]![0]!;
    expect((a - b) * 15).toBeCloseTo(1, 1); // 1 L/s out of 15 L over 1 s
    expect(g.hash).toMatchInlineSnapshot(`"0d7d38eba3380d06"`);
  }, T);

  it('sprinkle_can: a dropped stitch knocks it past its detent; it tips onto its stop and pours', async () => {
    const g = await golden('sprinkle_can', (m) => [...fills(m), ...flags(m), armZ(m, 'sprinkle_can')]);
    const tip = g.events('Trigger', g.id('sprinkle_can'))[0]!;
    expect(g.events('Impact').some((e) => e.tick === tip.tick && (e.part === g.id('stitch') || e.other === g.id('stitch')))).toBe(true); // the knock itself
    const can = 0, n = g.demo.parts.length;
    expect(g.samples[tip.tick]![can]).toBeCloseTo(0.5, 2);
    expect(g.samples.at(-1)![can]!).toBeLessThan(0.5 - 0.1); // ≥ 0.2 L sprinkled
    expect(g.samples.some((s) => (s[n + can]! & 1) === 1)).toBe(true); // `lit` while it sprinkles
    expect(g.samples.at(-1)!.at(-1)!).toBeLessThan(-0.6); // tipped forward (about −Z) toward its 45° stop
    expect(g.hash).toMatchInlineSnapshot(`"ed3511e982996b0c"`);
  }, T);

  it('waterwheel: the tank above it opens (with Matter off nothing pours, so the wheel stays put)', async () => {
    const g = await golden('waterwheel', (m) => [armZ(m, 'waterwheel')]);
    expect(g.events('Valve', g.id('tank'))[0]!.mag).toBe(1);
    expect(Math.abs(g.samples.at(-1)![0]!)).toBeLessThan(0.05);
    expect(g.hash).toMatchInlineSnapshot(`"12610e1672d4a498"`);
  }, T);

  it('sponge: the falling thud squeezes the soaked sponge, which releases its water at 1 L/s', async () => {
    const g = await golden('sponge', fills);
    const sq = g.events('Squeeze', g.id('sponge'))[0]!;
    expect(sq.mag).toBe(2000);
    expect(g.samples[sq.tick]![0]).toBeCloseTo(1, 2);
    expect(g.samples[sq.tick + 120]![0]).toBeCloseTo(0.5, 1); // 1 L of 2 L in a second
    expect(g.samples.at(-1)![0]).toBe(0);
    expect(g.hash).toMatchInlineSnapshot(`"3367b079697c23d3"`);
  }, T);

  it('marble_hopper: the button starts the feed; its 500 marbles rattle out at 400 a second', async () => {
    const g = await golden('marble_hopper', fills);
    const hop = g.id('marble_hopper');
    const valve = g.events('Valve', hop)[0]!;
    const empty = g.events('Empty', hop)[0]!;
    before(valve, empty);
    expect((empty.tick - valve.tick) / 120).toBeCloseTo(1.25, 1);
    expect(g.hash).toMatchInlineSnapshot(`"0c328e0ce8d934e2"`);
  }, T);

  // ---- Air ------------------------------------------------------------------------------------------------------
  it('blowout: its jet pushes the tethered helio downwind, then the warm hot air pops it', async () => {
    const g = await golden('blowout');
    const h = g.id('helio');
    const pop = g.events('Pop', h)[0]!;
    expect(g.chain(pop)).toEqual(['Pop', 'Powered']);
    expect(pop.tick / 120).toBeGreaterThan(0.49); // the heater warms for 0.5 s first
    expect(g.path(h)[pop.tick]![0]).toBeGreaterThan(g.start(h)[0] + 0.01);
    expect(g.hash).toMatchInlineSnapshot(`"9c520fd874559fe1"`);
  }, T);

  it('vac: it sucks the fuzz in from the floor and holds it on its mouth', async () => {
    const g = await golden('vac');
    const at = g.events('Attach', g.id('vac'))[0]!;
    expect(at.other).toBe(g.id('fuzz'));
    expect(g.events('Release', g.id('vac'))).toHaveLength(0);
    expect(g.now(g.id('fuzz'))[2]).toBeCloseTo(0.1825, 2); // on the mouth (z 0.15 + its radius)
    expect(g.hash).toMatchInlineSnapshot(`"0744a9ad31c5de65"`);
  }, T);

  it('inflator: the valve fills the empty helio on its nozzle; one press too many over-fills it and it pops', async () => {
    const g = await golden('inflator', fills);
    const inf = g.id('inflator'), h = g.id('helio');
    const valve = g.events('Valve', inf)[0]!;
    expect(g.chain(valve)).toEqual(['Valve', 'Signal', 'Press']);
    const helio = g.demo.parts.findIndex((p) => p.type === 'helio');
    expect(g.samples[valve.tick + 120]![helio]).toBeCloseTo(0.5, 1); // 50 %/s
    const over = g.events('Overfill', inf)[0]!, pop = g.events('Pop', h)[0]!;
    before(over, pop);
    expect(over.other).toBe(h);
    expect(g.chain(pop)).toContain('Signal');
    expect(g.hash).toMatchInlineSnapshot(`"dfab3730d63d7c2a"`);
  }, T);

  // ---- Power and signal -------------------------------------------------------------------------------------------
  it('arc_tower: charged, it strikes the pig iron (not the nearer stitch) every 0.25 s; a spark pops the helio', async () => {
    const g = await golden('arc_tower');
    const arcs = g.events('Arc', g.id('arc_tower'));
    expect(arcs.length).toBeGreaterThanOrEqual(5);
    expect(arcs[0]!.tick / 120).toBeCloseTo(0.5, 1);
    for (const a of arcs) expect(a.other).toBe(g.id('pig_iron'));
    expect(arcs[1]!.tick - arcs[0]!.tick).toBe(30);
    expect(g.events('Sound', g.id('arc_tower')).filter((s) => s.mag === 85)).toHaveLength(arcs.length);
    expect(g.chain(g.events('Pop', g.id('helio'))[0]!)).toEqual(['Pop', 'Arc', 'Powered']);
    expect(g.hash).toMatchInlineSnapshot(`"4229075d1939167f"`);
  }, T);

  // ---- Contraptions ------------------------------------------------------------------------------------------------
  it('toast_cannon: power starts a 1.5 s toast, then two slices pop up about half a metre', async () => {
    const g = await golden('toast_cannon', (m) => {
      const info = m.bodyInfo();
      const t = m.transforms(new Float32Array(info.length * 7));
      return info.flatMap((b, i) => (b.role === 'piece' && (b.chunk ?? 9) < 2 ? [t[i * 7 + 1]!] : []));
    });
    const tc = g.id('toast_cannon');
    const lever = g.events('Trigger', tc)[0]!;
    const pop = g.events('Launch', tc)[0]!;
    expect(g.chain(pop)).toEqual(['Launch', 'Trigger', 'Powered']);
    expect((pop.tick - lever.tick) / 120).toBeCloseTo(1.5, 1);
    expect(pop.mag).toBe(3);
    const peak = Math.max(...g.samples.map((s) => Math.min(s[0]!, s[1]!)));
    expect(peak).toBeGreaterThan(0.216 + 0.4); // 3 m/s ≈ 0.46 m rise
    expect(g.samples[0]![0]!).toBeLessThan(-20); // parked, dormant, until the pop
    expect(g.hash).toMatchInlineSnapshot(`"390dd60c8ac80811"`);
  }, T);

  // ---- Rollers -----------------------------------------------------------------------------------------------------
  it('yolk: the egg dropped from 2 m splats; the one resting on the floor stays whole', async () => {
    const g = await golden('yolk');
    const [drop, rest] = g.ids('yolk');
    const splat = g.events('Splat');
    expect(splat).toHaveLength(1);
    expect(splat[0]!.part).toBe(drop);
    expect(splat[0]!.mag).toBeGreaterThan(0.3);
    expect(g.moved(rest!)).toBeLessThan(0.02);
    expect(g.hash).toMatchInlineSnapshot(`"50f781b3adeaaac8"`);
  }, T);

  // ---- Fun ---------------------------------------------------------------------------------------------------------
  it('zippy: the button sends it off towing the scoop; it stops when its nose bumps the brick', async () => {
    const g = await golden('zippy', flags);
    const car = g.id('zippy');
    const [go, stop] = g.events('Drive', car);
    expect(go!.mag).toBe(1);
    expect(g.chain(go!)).toEqual(['Drive', 'Signal', 'Press']);
    expect(stop!.mag).toBe(0);
    expect(g.now(car)[0]).toBeGreaterThan(0.9);
    expect(g.moved(g.id('scoop'))).toBeGreaterThan(0.5); // towed on the LINE
    const i = g.demo.parts.findIndex((p) => p.type === 'zippy');
    expect(g.samples[go!.tick + 10]![i]! & 1).toBe(1); // headlights while driving
    expect(g.hash).toMatchInlineSnapshot(`"5116806ffc4ee047"`);
  }, T);

  it('quack: the duck squeaks when it lands and again when the stitch bonks it, with no Sound event', async () => {
    const g = await golden('quack');
    const q = g.id('quack');
    expect(g.events('Squeak', q).length).toBeGreaterThanOrEqual(2);
    expect(g.events('Sound', q)).toHaveLength(0);
    // re-pinned by X5 (M5): QUACK's weighted keel (body.com) and the demo's STITCH now dropped from 1.2 m (M5_NOTES_X5)
    expect(g.hash).toMatchInlineSnapshot(`"dabc3a27d7926952"`);
  }, T);
});
