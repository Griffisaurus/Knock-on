// Per-part golden machines for the M3 parts (stream A3, PART_SYSTEM §6–7): each Library demo runs headless twice
// (identical hashes and events), shows its part's main interaction (asserted through events, cause chains and body
// state), and pins its final state hash.

import { describe, expect, it } from 'vitest';
import { before, golden } from './golden_helper.ts';

const T = 30_000;
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('golden machines (M3 parts)', () => {
  // ---- Rollers ---------------------------------------------------------------------------------
  it('glint: the glass marble rolls down the slope and away', async () => {
    const g = await golden('glint');
    expect(g.now(g.id('glint'))[0]).toBeLessThan(g.start(g.id('glint'))[0] - 0.5);
    expect(g.hash).toMatchInlineSnapshot(`"5071e9e2851bfb40"`);
  }, T);

  it('bearing: the steel marble rolls down and knocks the second one on', async () => {
    const g = await golden('bearing');
    const [a, b] = g.ids('bearing');
    expect(g.moved(a!)).toBeGreaterThan(0.5);
    expect(g.moved(b!)).toBeGreaterThan(0.02);
    expect(g.hash).toMatchInlineSnapshot(`"e2d7c1d522f6b12d"`);
  }, T);

  // ---- Frame -----------------------------------------------------------------------------------
  it('glidepath: a bearing at the rail start rides it round the bend and leaves at the far end', async () => {
    const g = await golden('glidepath');
    const b = g.id('bearing');
    const on = g.events('RailOn', b)[0], off = g.events('RailOff', b)[0];
    before(on, off);
    // it left at the far end (0.5, 0.3, 0.3), not back at the start, and flew on past it
    expect(dist(off!.pos, [0.5, 0.306, 0.3])).toBeLessThan(0.05);
    expect(g.now(b)[0]).toBeGreaterThan(0.9);
    expect(g.hash).toMatchInlineSnapshot(`"49f50329bea8bc31"`);
  }, T);

  it('glidepath_booster: the spinning booster speeds the riding bearing up to tyre speed', async () => {
    const g = await golden('glidepath_booster');
    const boost = g.events('Boost', g.id('glidepath_booster'))[0];
    expect(boost).toBeDefined();
    expect(boost!.mag).toBeGreaterThan(1.3); // 9.42 rad/s × 10 × 0.015 m
    expect(boost!.other).toBe(g.id('bearing'));
    before(g.events('RailOn', g.id('bearing'))[0], boost);
    before(boost, g.events('RailOff', g.id('bearing'))[0]);
    expect(g.hash).toMatchInlineSnapshot(`"2a4e4e8ac32cb571"`);
  }, T);

  it('spindeck: the motor turns the platter and the stitch on it rides round', async () => {
    const g = await golden('spindeck', (m) => {
      const info = m.bodyInfo();
      const i = info.findIndex((b) => b.type === 'spindeck' && b.role === 'arm');
      const t = m.transforms(new Float32Array(info.length * 7));
      return [t[i * 7 + 4]!, t[i * 7 + 6]!]; // arm rotation about Y: qy, qw
    });
    const s = g.id('stitch');
    const a0 = Math.atan2(g.start(s)[2], g.start(s)[0]), a1 = Math.atan2(g.now(s)[2], g.now(s)[0]);
    expect(Math.abs(a1 - a0)).toBeGreaterThan(0.5); // carried round the axis
    const turned = g.samples.some(([qy]) => Math.abs(qy!) > 0.5);
    expect(turned).toBe(true);
    expect(g.hash).toMatchInlineSnapshot(`"fbaacfc27dd1a6ac"`);
  }, T);

  it('lift: the button calls it; it carries the boing up 0.6 m and signals on arrival', async () => {
    const g = await golden('lift');
    const arrive = g.events('Arrive', g.id('lift'))[0];
    expect(arrive?.mag).toBe(1);
    expect(g.chain(arrive!)).toEqual(['Arrive', 'Signal', 'Press']);
    expect(g.now(g.id('boing'))[1]).toBeGreaterThan(g.start(g.id('boing'))[1] + 0.55);
    expect(g.hash).toMatchInlineSnapshot(`"b8979a71beae13ee"`);
  }, T);

  // ---- Drive -----------------------------------------------------------------------------------
  it('rack: the motor turns the pinion and the bar slides out into the tiles', async () => {
    const g = await golden('rack');
    expect(g.moved(g.ids('topple_tile')[0]!)).toBeGreaterThan(0.1);
    expect(g.hash).toMatchInlineSnapshot(`"9c110daf8d44a122"`);
  }, T);

  it('ram: the button fires the powered piston; it punches the boing away and pulls back', async () => {
    const g = await golden('ram');
    const out = g.events('Extend', g.id('ram'));
    expect(out).toHaveLength(1);
    expect(g.events('Retract', g.id('ram'))).toHaveLength(1);
    expect(g.chain(out[0]!)).toEqual(['Extend', 'Signal', 'Press']);
    expect(g.now(g.id('boing'))[2]).toBeGreaterThan(g.start(g.id('boing'))[2] + 1);
    expect(g.hash).toMatchInlineSnapshot(`"21a653cf5466f080"`);
  }, T);

  // ---- Power and signal: optics ------------------------------------------------------------------
  it('lance: through the burning glass the beam cuts the helio’s line, and the helio floats away', async () => {
    const g = await golden('lance');
    const lit = g.events('Lit', g.id('lance'))[0], cut = g.events('Cut')[0];
    before(lit, cut);
    expect((cut!.tick - lit!.tick) / 120).toBeGreaterThan(1.4); // 1.5 s of heat burns a LINE through
    expect(g.chain(cut!)).toContain('Lit');
    expect(g.now(g.id('helio'))[1]).toBeGreaterThan(g.start(g.id('helio'))[1] + 0.5);
    expect(g.hash).toMatchInlineSnapshot(`"833abfc0fe9e8bf0"`);
  }, T);

  it('mirror: the bounced beam lights the suncell, which powers the motor', async () => {
    const g = await golden('mirror');
    const lit = g.events('Lit', g.id('suncell'))[0];
    expect(lit!.mag).toBeGreaterThan(0.99);
    before(lit, g.events('Powered', g.id('motor'))[0]);
    expect(g.hash).toMatchInlineSnapshot(`"ef45ad6f2cfd7127"`);
  }, T);

  it('splitter: one beam fans into three, each lighting a tripwire at a third of its intensity', async () => {
    const g = await golden('splitter');
    for (const t of g.ids('tripwire')) {
      const lit = g.events('Lit', t)[0];
      expect(lit!.mag).toBeCloseTo(1 / 3, 2);
      expect(g.events('Trip', t)).toHaveLength(1); // Lit mode
    }
    expect(g.hash).toMatchInlineSnapshot(`"e376a17ebe0a95cd"`);
  }, T);

  it('tripwire: the rolling stitch breaks the beam; the tripwire sets off the bangstick', async () => {
    const g = await golden('tripwire');
    const trip = g.events('Trip', g.id('tripwire'))[0];
    const boom = g.events('Detonate', g.id('bangstick'))[0];
    before(trip, boom);
    expect(g.chain(boom!).slice(0, 4)).toEqual(['Detonate', 'Signal', 'Trip', 'Unlit']);
    expect(g.hash).toMatchInlineSnapshot(`"e87c05802071f0b8"`);
  }, T);

  // ---- Power and signal: wireless and field --------------------------------------------------------
  it('ping: the Tx reaches the Rx of its colour in the same tick; the other colour stays quiet', async () => {
    const g = await golden('ping');
    const [tx, rx, other] = g.ids('ping');
    const ping = g.events('PingRx', rx)[0];
    expect(ping!.other).toBe(tx);
    expect(g.events('PingRx', other)).toHaveLength(0);
    const [s1, s2] = g.ids('bangstick');
    const boom = g.events('Detonate', s1)[0];
    expect(boom!.tick).toBe(g.events('Signal', tx)[0]!.tick); // a wire: same tick
    expect(g.chain(boom!)).toEqual(['Detonate', 'Signal', 'PingRx', 'Signal', 'Press']);
    expect(g.events('Detonate', s2)).toHaveLength(0);
    expect(g.hash).toMatchInlineSnapshot(`"93162832068bb23a"`);
  }, T);

  it('maglock: powered, it pulls the steel onto its face and holds it; the stitch isn’t steel', async () => {
    const g = await golden('maglock');
    const attach = g.events('Attach', g.id('maglock'));
    expect(attach.length).toBeGreaterThan(0);
    const face = [0, 0.1, 0.09];
    expect(dist(g.now(g.id('bearing')), face)).toBeLessThan(dist(g.start(g.id('bearing')), face) - 0.1);
    expect(dist(g.now(g.id('pig_iron')), face)).toBeLessThan(dist(g.start(g.id('pig_iron')), face) - 0.03);
    expect(attach.some((e) => e.other === g.id('stitch'))).toBe(false);
    expect(g.hash).toMatchInlineSnapshot(`"d6014ca480d9082e"`);
  }, T);

  // ---- Fire and boom ------------------------------------------------------------------------------
  it('powder_keg: a wick against its side cooks it off after 1.5 s: a yield-3 blast flattens the wall', async () => {
    const g = await golden('powder_keg');
    const cook = g.events('Cook', g.id('powder_keg'))[0], boom = g.events('Detonate', g.id('powder_keg'))[0];
    before(cook, boom);
    expect(boom!.mag).toBe(3);
    expect((boom!.tick - cook!.tick) / 120).toBeCloseTo(1.5, 1);
    for (const b of g.ids('brik')) expect(g.moved(b)).toBeGreaterThan(1);
    expect(g.hash).toMatchInlineSnapshot(`"24eaa51432ed2686"`);
  }, T);

  it('jitterjuice: the cork’s knock sets the flask off', async () => {
    const g = await golden('jitterjuice');
    const boom = g.events('Detonate', g.id('jitterjuice'))[0];
    expect(boom!.mag).toBe(1.5);
    expect(g.chain(boom!)).toEqual(['Detonate', 'Spawn', 'Launch', 'Signal', 'Press']);
    expect(g.hash).toMatchInlineSnapshot(`"8b4f92acba482536"`);
  }, T);

  it('skyshow: the wick lights its fuse; tubes fire 0.6 s apart and the shells burst overhead', async () => {
    const g = await golden('skyshow');
    const cake = g.id('skyshow');
    const launches = g.events('Launch', cake), bursts = g.events('Detonate', cake);
    expect(launches.length).toBeGreaterThanOrEqual(4);
    expect(launches[1]!.tick - launches[0]!.tick).toBe(72); // 0.6 s at 120 Hz
    expect(bursts.length).toBeGreaterThanOrEqual(2);
    expect(bursts[0]!.mag).toBeCloseTo(0.2, 6);
    expect(bursts[0]!.pos[1]).toBeGreaterThan(1.8); // near the 2 m burst altitude
    expect(g.events('Burst', cake)).toHaveLength(bursts.length);
    expect(g.chain(bursts[0]!).slice(0, 3)).toEqual(['Detonate', 'Launch', 'Ignite']);
    expect(g.hash).toMatchInlineSnapshot(`"cfe62fe42e34573b"`);
  }, T);

  it('flamer: the button opens the gas; the flame pops the helio and lights the wick', async () => {
    const g = await golden('flamer');
    const on = g.events('Ignite', g.id('flamer'))[0];
    const pop = g.events('Pop', g.id('helio'))[0], wick = g.events('Ignite', g.id('wick'))[0];
    before(on, pop);
    before(on, wick);
    expect(g.chain(pop!)).toContain('Ignite');
    expect(g.hash).toMatchInlineSnapshot(`"69f83c65b9a8eec9"`);
  }, T);

  it('popper: the helio’s tug pops it; the puff throws the fuzz up (no blast, no heat)', async () => {
    const g = await golden('popper');
    expect(g.events('Confetti', g.id('popper'))).toHaveLength(1);
    expect(g.maxY(g.id('fuzz'))).toBeGreaterThan(g.start(g.id('fuzz'))[1] + 0.2);
    expect(g.events('Detonate')).toHaveLength(0);
    expect(g.events('Pop')).toHaveLength(0);
    expect(g.hash).toMatchInlineSnapshot(`"798ddee0463b3ffb"`);
  }, T);

  // ---- Contraptions --------------------------------------------------------------------------------
  it('snaptrap: the stitch on the pedal springs it; the glint in its cup is flung', async () => {
    const g = await golden('snaptrap');
    expect(g.events('Snap', g.id('snaptrap'))).toHaveLength(1);
    expect(g.maxY(g.id('glint'))).toBeGreaterThan(0.5);
    expect(g.hash).toMatchInlineSnapshot(`"f09cd51c0b9ad03f"`);
  }, T);

  it('bonker: the button swings it; it bonks the second button, which sets off the bangstick', async () => {
    const g = await golden('bonker');
    const [, target] = g.ids('the_button');
    const press = g.events('Press', target)[0];
    expect(g.chain(press!).slice(0, 4)).toEqual(['Press', 'Trigger', 'Signal', 'Press']);
    expect(g.events('Detonate', g.id('bangstick'))).toHaveLength(1);
    expect(g.events('Trigger', g.id('bonker'))).toHaveLength(1);
    expect(g.events('Retract', g.id('bonker'))).toHaveLength(1);
    expect(g.hash).toMatchInlineSnapshot(`"5e5dcaa6ee7a4d01"`);
  }, T);

  it('flinger: the button releases it; the stitch in the cup flies off along +X', async () => {
    const g = await golden('flinger');
    expect(g.events('Fire', g.id('flinger'))).toHaveLength(1);
    const s = g.id('stitch');
    expect(g.now(s)[0]).toBeGreaterThan(g.start(s)[0] + 1.5);
    expect(g.maxY(s)).toBeGreaterThan(0.5);
    expect(g.hash).toMatchInlineSnapshot(`"d62d1cc47ef6e19e"`);
  }, T);

  it('wrecker: the ball swings down on its chain and shoves the brik wall over', async () => {
    const g = await golden('wrecker');
    let moved = 0;
    for (const b of g.ids('brik')) if (g.moved(b) > 0.1) moved++;
    expect(moved).toBeGreaterThanOrEqual(6);
    expect(g.hash).toMatchInlineSnapshot(`"9a0a9765acceadd6"`);
  }, T);

  it('pinger: the button cocks and fires it; the striker sends the stitch along +Z', async () => {
    const g = await golden('pinger');
    const fire = g.events('Fire', g.id('pinger'))[0];
    before(g.events('Trigger', g.id('pinger'))[0], fire);
    expect(g.now(g.id('stitch'))[2]).toBeGreaterThan(g.start(g.id('stitch'))[2] + 1);
    expect(g.hash).toMatchInlineSnapshot(`"88bd151b53434231"`);
  }, T);

  it('paddle: the button flips the bat; it smacks the stitch away', async () => {
    const g = await golden('paddle');
    expect(g.events('Trigger', g.id('paddle'))).toHaveLength(1);
    expect(g.events('Retract', g.id('paddle'))).toHaveLength(1);
    expect(g.moved(g.id('stitch'))).toBeGreaterThan(1);
    expect(g.hash).toMatchInlineSnapshot(`"cfb2e4eab1e5ba28"`);
  }, T);

  it('bumper: the stitch rolls into it and is kicked back out at 1.2× (at least 1.5 m/s)', async () => {
    const g = await golden('bumper');
    const kick = g.events('Trigger', g.id('bumper'))[0];
    expect(kick!.other).toBe(g.id('stitch'));
    expect(kick!.mag).toBeGreaterThanOrEqual(1.5);
    const p = g.path(g.id('stitch'));
    expect(p[kick!.tick + 30]![0]).toBeGreaterThan(p[kick!.tick]![0] + 0.1); // back toward +X
    expect(g.hash).toMatchInlineSnapshot(`"4ecb5982c3ed236b"`);
  }, T);

  // ---- Fun ---------------------------------------------------------------------------------------
  it('pin: the thud rolls into the rack and topples most of it', async () => {
    const g = await golden('pin');
    let down = 0;
    for (const p of g.ids('pin')) if (g.up(p, [0, 1, 0])[1] < 0.7071) down++;
    expect(down).toBeGreaterThanOrEqual(8);
    expect(g.hash).toMatchInlineSnapshot(`"0d2f70ed46709c6a"`);
  }, T);

  it('stacker: the thud shoves the tower; its top layers slide', async () => {
    const g = await golden('stacker');
    const top = g.ids('stacker').slice(-3);
    for (const s of top) expect(g.moved(s)).toBeGreaterThan(0.03);
    expect(g.hash).toMatchInlineSnapshot(`"17f0a1580d3db65a"`);
  }, T);

  it('pane: the thud hits the standing pane and it shatters into its shards', async () => {
    const g = await golden('pane');
    const brk = g.events('Break', g.id('pane'));
    expect(brk).toHaveLength(1);
    expect(g.chain(brk[0]!)).toContain('Impact');
    expect(g.hash).toMatchInlineSnapshot(`"b8c41b32c195f79e"`);
  }, T);

  it('vase: dropped from 0.5 m, it smashes on the floor', async () => {
    const g = await golden('vase');
    expect(g.events('Break', g.id('vase'))).toHaveLength(1);
    expect(g.events('Sound', g.id('vase')).some((e) => e.mag >= 85)).toBe(true);
    expect(g.hash).toMatchInlineSnapshot(`"2d4bf8028b4fcf8e"`);
  }, T);

  it('tonebars: the three stitches play scale degrees 0, 2 and 4, each with a quiet Sound', async () => {
    const g = await golden('tonebars');
    const bars = g.ids('tonebars');
    const first = bars.map((b) => g.events('Note', b)[0]!);
    expect(first.map((e) => Math.floor(e.mag))).toEqual([0, 2, 4]);
    for (const e of first) expect(e.mag % 1).toBeGreaterThan(0); // the fraction is the volume
    expect(g.events('Sound', bars[0]).every((e) => e.mag === 55)).toBe(true);
    expect(g.hash).toMatchInlineSnapshot(`"80bd311d1fa3180f"`);
  }, T);

  it('ding: the stitch hits the button: a Note and a 77 dB Sound', async () => {
    const g = await golden('ding');
    const note = g.events('Note', g.id('ding'))[0];
    expect(Math.floor(note!.mag)).toBe(0);
    expect(g.events('Sound', g.id('ding'))[0]!.mag).toBe(77);
    expect(g.hash).toMatchInlineSnapshot(`"62913d387bc36943"`);
  }, T);

  // ---- Future tech -----------------------------------------------------------------------------------
  it('fabricator: every 0.5 s a boing comes out of its pool, five in all', async () => {
    const g = await golden('fabricator');
    const spawns = g.events('Spawn', g.id('fabricator'));
    expect(spawns.map((e) => e.tick)).toEqual([60, 120, 180, 240, 300]);
    for (const e of spawns) expect(e.mag).toBe(0.6); // the BOING's mass
    expect(g.hash).toMatchInlineSnapshot(`"0e989b480f356a5e"`);
  }, T);

  it('recycler: three stitches fall in and vanish; at its goal it sets off the bangstick', async () => {
    const g = await golden('recycler');
    const r = g.id('recycler');
    const gone = g.events('Despawn', r);
    expect(gone.map((e) => e.mag)).toEqual([1, 2, 3]);
    expect(new Set(gone.map((e) => e.other))).toEqual(new Set(g.ids('stitch')));
    const goal = g.events('Goal', r)[0];
    expect(g.chain(g.events('Detonate', g.id('bangstick'))[0]!).slice(0, 4)).toEqual(['Detonate', 'Signal', 'Goal', 'Despawn']);
    expect(goal!.mag).toBe(3);
    expect(g.hash).toMatchInlineSnapshot(`"27d29e59e6d48fd3"`);
  }, T);

  it('zone: the boing inside the antigrav zone floats up; its twin outside stays down', async () => {
    const g = await golden('zone');
    const [inside, outside] = g.ids('boing');
    expect(g.maxY(inside!)).toBeGreaterThan(1.0);
    expect(g.maxY(outside!)).toBeLessThan(0.13);
    expect(g.hash).toMatchInlineSnapshot(`"95bf1c884b3eed84"`);
  }, T);
});
