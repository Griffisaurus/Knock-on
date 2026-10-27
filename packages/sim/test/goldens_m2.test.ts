// Per-part golden machines for the M2 parts (stream A, PART_SYSTEM §6–7): each Library demo runs
// headless twice (identical hashes and events), shows its part's main interaction (asserted through
// events, cause chains and body state), and pins its final state hash.

import { describe, expect, it } from 'vitest';
import type { PartId } from '@knockon/format';
import { before, golden } from './golden_helper.ts';

const T = 30_000;

describe('golden machines (M2 parts)', () => {
  // ---- Rollers ---------------------------------------------------------------------------------
  it('fuzz: grips the steep slope and rolls away along −X', async () => {
    const g = await golden('fuzz');
    const b = g.id('fuzz');
    expect(g.now(b)[0]).toBeLessThan(g.start(b)[0] - 0.5);
    expect(g.hash).toMatchInlineSnapshot(`"24a05c86cc1c0113"`);
  }, T);

  it('pig_iron: rolls down the slope and knocks the plank over', async () => {
    const g = await golden('pig_iron');
    expect(g.moved(g.id('pig_iron'))).toBeGreaterThan(0.5);
    expect(Math.abs(g.up(g.id('plank'), [0, 0, 1])[1])).toBeLessThan(0.5);
    expect(g.hash).toMatchInlineSnapshot(`"37039a2f6cc50540"`);
  }, T);

  // ---- Frame -----------------------------------------------------------------------------------
  it('vortex: the ball rolls to the middle, drops through the throat and out underneath', async () => {
    const g = await golden('vortex');
    const s = g.id('stitch'), v = g.start(g.id('vortex'));
    // inside the outlet bore (between the outlet and the throat), on the axis
    const inBore = g.path(s).some((p) => p[1] > v[1] && p[1] < v[1] + 0.08 && Math.hypot(p[0] - v[0], p[2] - v[2]) < 0.144);
    expect(inBore).toBe(true);
    expect(Math.min(...g.path(s).map((p) => p[1]))).toBeLessThan(0.1); // fell out onto the floor
    expect(g.hash).toMatchInlineSnapshot(`"e52ea22501bb6e9f"`);
  }, T);

  it('sprong: the boing comes back up higher than it was dropped from', async () => {
    const g = await golden('sprong');
    const b = g.id('boing');
    const ys = g.path(b).map((p) => p[1]);
    const low = ys.indexOf(Math.min(...ys.slice(0, 80)));
    expect(Math.max(...ys.slice(low))).toBeGreaterThan(g.start(b)[1] + 0.1);
    expect(g.hash).toMatchInlineSnapshot(`"df3f100ac388a527"`);
  }, T);

  it('scoop: the balloon lifts the empty bucket by its handle', async () => {
    const g = await golden('scoop');
    expect(g.now(g.id('scoop'))[1]).toBeGreaterThan(g.start(g.id('scoop'))[1] + 0.3);
    expect(g.events('Cut')).toHaveLength(0);
    expect(g.hash).toMatchInlineSnapshot(`"b11ba146ce1ba850"`);
  }, T);

  it('flap: the button signal unlatches the trapdoor and the balls drop through', async () => {
    const g = await golden('flap');
    const sig = g.events('Signal', g.id('flap'))[0];
    before(g.events('Press', g.id('the_button'))[0], sig);
    expect(g.chain(sig!)).toEqual(['Signal', 'Press']);
    expect(g.armAngle(g.id('flap'), 0)).toBeGreaterThan(1.2); // swung open, front edge down
    for (const s of g.ids('stitch')) expect(g.now(s)[1]).toBeLessThan(0.2);
    expect(g.hash).toMatchInlineSnapshot(`"5c0d042b0e0f4bbc"`);
  }, T);

  // ---- Drive -----------------------------------------------------------------------------------
  it('dynamo: the motor spins it and its output lights the lamp at full power', async () => {
    const g = await golden('dynamo');
    const lamp = g.id('lamp');
    expect(g.events('Powered', g.id('motor'))).toHaveLength(1);
    expect(g.events('Powered', lamp)).toHaveLength(1);
    expect(g.events('Lit', lamp)).toHaveLength(1);
    expect(g.events('Brownout', lamp)).toHaveLength(0);
    expect(Math.abs(g.spin(g.id('dynamo')))).toBeGreaterThan(5);
    expect(g.hash).toMatchInlineSnapshot(`"d40815781eebb424"`);
  }, T);

  it('turbine: wind from the gale spins the rotor up', async () => {
    const g = await golden('turbine');
    expect(g.events('Powered', g.id('gale'))).toHaveLength(1);
    expect(Math.abs(g.spin(g.id('turbine')))).toBeGreaterThan(5);
    expect(g.hash).toMatchInlineSnapshot(`"90a3a5a595548fcc"`);
  }, T);

  // ---- Air -------------------------------------------------------------------------------------
  it('puffer: the thud hits the pad and the puff blows the wick out', async () => {
    const g = await golden('puffer');
    const press = g.events('Press', g.id('puffer'))[0];
    const out = g.events('Extinguish', g.id('wick'))[0];
    before(press, out);
    expect(out!.cause).toBe(press!.id);
    expect(g.hash).toMatchInlineSnapshot(`"74fb7e70cf594067"`);
  }, T);

  // ---- Power and signal ------------------------------------------------------------------------
  it('cell: the battery powers the lamp and motor', async () => {
    const g = await golden('cell');
    expect(g.events('Powered', g.id('lamp'))).toHaveLength(1);
    expect(g.events('Powered', g.id('motor'))).toHaveLength(1);
    expect(g.events('Lit', g.id('lamp'))).toHaveLength(1);
    expect(Math.abs(g.spin(g.id('motor')))).toBeGreaterThan(5);
    expect(g.hash).toMatchInlineSnapshot(`"786930c2bc7f537d"`);
  }, T);

  it('suncell: the torch beam on the panel powers the motor, which turns the cog', async () => {
    const g = await golden('suncell');
    const lit = g.events('Lit', g.id('suncell'))[0];
    before(lit, g.events('Powered', g.id('motor'))[0]);
    expect(lit!.mag).toBeGreaterThan(0.9); // all nine rays land on it
    expect(Math.abs(g.spin(g.id('cog')))).toBeGreaterThan(3);
    expect(g.hash).toMatchInlineSnapshot(`"dbb11ea06bc375f5"`);
  }, T);

  it('lamp: the bulb lights the suncell, which runs the gale', async () => {
    const g = await golden('lamp');
    before(g.events('Lit', g.id('lamp'))[0], g.events('Lit', g.id('suncell'))[0]);
    before(g.events('Lit', g.id('suncell'))[0], g.events('Powered', g.id('gale'))[0]);
    const b = g.id('boing');
    expect(g.now(b)[2]).toBeGreaterThan(g.start(b)[2] + 0.3);
    expect(g.hash).toMatchInlineSnapshot(`"f8fa0aef2a493a7b"`);
  }, T);

  it('torch: the button switches it on and its beam powers the lamp through the suncell', async () => {
    const g = await golden('torch');
    const on = g.events('Lit', g.id('torch'))[0];
    expect(g.chain(on!)).toEqual(['Lit', 'Signal', 'Press']);
    before(on, g.events('Lit', g.id('suncell'))[0]);
    before(g.events('Lit', g.id('suncell'))[0], g.events('Powered', g.id('lamp'))[0]);
    expect(g.hash).toMatchInlineSnapshot(`"6415a4210f1524bb"`);
  }, T);

  it('burning_glass: the focused beam pops the balloon', async () => {
    const g = await golden('burning_glass');
    const pop = g.events('Pop', g.id('helio'))[0];
    expect(g.events('Lit', g.id('burning_glass'))[0]!.tick).toBeLessThanOrEqual(pop!.tick);
    expect(g.chain(pop!)).toEqual(['Pop', 'Lit', 'Signal', 'Press']); // pop ← torch on ← signal ← button
    expect(g.hash).toMatchInlineSnapshot(`"8609784192088943"`);
  }, T);

  it('toggle: the dropped ball flips the lever on and the power reaches the gale', async () => {
    const g = await golden('toggle');
    const flip = g.events('Toggle', g.id('toggle'))[0];
    expect(flip!.mag).toBe(1);
    expect(flip!.other).toBe(g.id('stitch'));
    const on = g.events('Powered', g.id('gale'))[0];
    expect(on!.cause).toBe(flip!.id);
    const b = g.id('boing');
    expect(g.now(b)[2]).toBeGreaterThan(g.start(b)[2] + 0.3);
    expect(g.hash).toMatchInlineSnapshot(`"a8b9f36ac6f9e5f6"`);
  }, T);

  it('ringer: rings at 1 s (an 80 dB sound) and the signal sets off the bangstick', async () => {
    const g = await golden('ringer');
    const ring = g.events('Ring', g.id('ringer'))[0]!;
    expect(ring.tick).toBe(120);
    const snd = g.events('Sound', g.id('ringer'))[0]!;
    expect(snd.mag).toBe(80);
    expect(snd.cause).toBe(ring.id);
    const boom = g.events('Detonate', g.id('bangstick'))[0]!;
    expect(g.chain(boom)).toEqual(['Detonate', 'Signal', 'Ring']);
    expect(g.hash).toMatchInlineSnapshot(`"332d6ab0633ae425"`);
  }, T);

  it('delay: the bangstick gets the button’s signal exactly 1 s later', async () => {
    const g = await golden('delay');
    const inn = g.events('Signal', g.id('delay'))[0]!;
    const out = g.events('Signal', g.id('bangstick'))[0]!;
    expect(out.tick - inn.tick).toBe(120);
    expect(g.chain(out)).toEqual(['Signal', 'Signal', 'Press']);
    expect(g.hash).toMatchInlineSnapshot(`"851d2f5fd7a1b1d2"`);
  }, T);

  // ---- Fire and boom ---------------------------------------------------------------------------
  it('t_plunger: the thud lands on the handle and both bangsticks go off together', async () => {
    const g = await golden('t_plunger');
    const press = g.events('Press', g.id('t_plunger'))[0]!;
    const [a, b] = g.ids('bangstick') as [PartId, PartId];
    const ba = g.events('Detonate', a)[0]!, bb = g.events('Detonate', b)[0]!;
    expect(ba.tick).toBe(bb.tick);
    expect(ba.tick).toBe(press.tick + 1);
    expect(g.chain(bb)).toEqual(['Detonate', 'Signal', 'Press']);
    expect(g.hash).toMatchInlineSnapshot(`"075a806180144162"`);
  }, T);

  it('skyrocket: lit through its fuse, it launches after its stub, thrusts 2 s and climbs', async () => {
    const g = await golden('skyrocket');
    const r = g.id('skyrocket');
    const lit = g.events('Ignite', r)[0]!, launch = g.events('Launch', r)[0]!, out = g.events('Extinguish', r)[0]!;
    expect(launch.tick - lit.tick).toBe(24); // 0.2 s stub
    expect(out.tick - launch.tick).toBe(240); // 2.0 s burn
    expect(g.chain(launch)).toEqual(['Launch', 'Ignite', 'FuseEnd', 'FuseLit']);
    expect(g.maxY(r)).toBeGreaterThan(3);
    expect(g.hash).toMatchInlineSnapshot(`"725b84dec7aa2e94"`);
  }, T);

  it('big_top: lit through its fuse, it fires the loaded boing at √(2E/m)', async () => {
    const g = await golden('big_top');
    const shot = g.events('Launch', g.id('big_top'))[0]!;
    expect(shot.other).toBe(g.id('boing'));
    expect(shot.mag).toBeCloseTo(Math.sqrt((2 * 22) / 0.6), 3); // power 3 → 22 J, 0.6 kg
    expect(g.chain(shot).slice(0, 2)).toEqual(['Launch', 'Ignite']);
    const b = g.id('boing');
    expect(g.now(b)[0]).toBeGreaterThan(g.start(b)[0] + 2);
    expect(g.hash).toMatchInlineSnapshot(`"a93592ed13a62d72"`);
  }, T);

  it('cork_blaster: the button fires the cork and it pops the balloon on its string', async () => {
    const g = await golden('cork_blaster');
    const cb = g.id('cork_blaster');
    const shot = g.events('Launch', cb)[0]!;
    expect(shot.mag).toBe(12);
    expect(g.events('Spawn', cb)).toHaveLength(1);
    const pop = g.events('Pop', g.id('helio'))[0]!;
    expect(pop.tick - shot.tick).toBeLessThan(15);
    expect(g.chain(pop)).toEqual(['Pop', 'Spawn', 'Launch', 'Signal', 'Press']);
    expect(g.hash).toMatchInlineSnapshot(`"5200134f3c485b11"`);
  }, T);

  // ---- Contraptions ----------------------------------------------------------------------------
  it('punchline: the signal punches the glove out and the boing flies', async () => {
    const g = await golden('punchline');
    const sig = g.events('Signal', g.id('punchline'))[0];
    before(sig, g.events('Launch', g.id('punchline'))[0]);
    const b = g.id('boing');
    expect(g.now(b)[0]).toBeGreaterThan(g.start(b)[0] + 1);
    expect(g.hash).toMatchInlineSnapshot(`"7dd12fd2a6bbfbc7"`);
  }, T);

  it('gotcha_box: three crank turns pop the head, which bonks the plank over', async () => {
    const g = await golden('gotcha_box');
    const popped = g.events('Launch', g.id('gotcha_box'))[0]!;
    expect(popped.tick).toBeGreaterThanOrEqual(230); // 3 turns at 9.42 rad/s ≈ 2.0 s
    expect(popped.tick).toBeLessThanOrEqual(250);
    expect(Math.abs(g.up(g.id('plank'), [0, 0, 1])[1])).toBeLessThan(0.5);
    expect(g.hash).toMatchInlineSnapshot(`"adc285a0880751be"`);
  }, T);

  // ---- Links -----------------------------------------------------------------------------------
  it('gutter: the ball runs along the half-pipe and drops off the far end', async () => {
    const g = await golden('gutter');
    const s = g.id('stitch');
    // while over the straight run it stays in the channel (above the floor line, near z = 0)
    for (const p of g.path(s)) if (p[0] > -0.5 && p[0] < 0.3) { expect(p[1]).toBeGreaterThan(0.25); expect(Math.abs(p[2])).toBeLessThan(0.1); }
    expect(g.now(s)[0]).toBeGreaterThan(0.8);
    expect(g.hash).toMatchInlineSnapshot(`"53cbae9eb949671a"`);
  }, T);
});
