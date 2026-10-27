// Per-part golden machines (PART_SYSTEM §6–7): every Library demo runs headless, shows its part's
// main interaction (asserted through events and body state), replays bit-identically, and pins its
// final state hash.

import { describe, expect, it } from 'vitest';
import { LinkKinds, type PartId } from '@knockon/format';
import { CARDS, PARTS, partDef } from '@knockon/parts-data';
import { DEMOS, DEMO_MAX_PARTS, DEMO_MAX_TICKS, type DemoMachine } from '../../parts-data/src/demos.ts';
import { Machine, type EventKind, type SimEvent } from '../src/index.ts';
import { Build, angleAbout, jolt, pose, rotate, trace, type Trace } from './harness.ts';

const LINK_CARDS = ['line', 'band', 'fuse', 'cable_signal', 'cable_power', 'gutter', 'glidepath'] as const;
const HINGED = new Set(['cog', 'fulcrum', 'motor', 'treadway']);

interface Golden {
  readonly demo: DemoMachine;
  readonly tr: Trace;
  readonly hash: string;
  /** Ids of the demo's parts of a type, in placement order. */
  ids(type: string): PartId[];
  /** The n-th part of a type. */
  id(type: string, n?: number): PartId;
  events(kind: EventKind, part?: PartId): SimEvent[];
  start(id: PartId): readonly [number, number, number];
  now(id: PartId): readonly [number, number, number];
  moved(id: PartId): number;
  /** Accumulated arm rotation (radians) of a hinged part: about X for motors, Z otherwise. */
  spin(id: PartId): number;
  /** Final arm angle about Z (fulcrum beams: negative = right end down, left end up). */
  armZ(id: PartId): number;
  /** Final world direction of a body-local axis of a part's base body. */
  up(id: PartId, axis: readonly [number, number, number]): [number, number, number];
}

/** Runs a demo twice (asserting identical hash sequences) and returns the first run for checks. */
async function golden(key: string): Promise<Golden> {
  const demo = DEMOS[key]!;
  const J = await jolt();
  const ids = (type: string): PartId[] => demo.parts.filter((p) => p.type === type).map((p) => p.id);
  const all = demo.parts.map((p) => p.id);
  const spins = demo.parts.filter((p) => HINGED.has(p.type)).map((p) => [p.id, p.type === 'motor' ? 0 : 2] as const);
  const once = (): { m: Machine; tr: Trace } => {
    const m = new Machine(J, demo);
    return { m, tr: trace(m, demo.ticks, { track: all, spin: spins }) };
  };
  const a = once();
  const b = once();
  expect(b.tr.hashes).toEqual(a.tr.hashes);
  b.m.destroy();
  const { m, tr } = a;
  const hash = tr.hashes.at(-1)!;
  const base = new Map(all.map((id) => [id, pose(m, id).q]));
  const arm = new Map(spins.map(([id]) => [id, pose(m, id, 'arm').q]));
  m.destroy();
  return {
    demo, tr, hash, ids,
    id: (type, n = 0) => ids(type)[n]!,
    events: (kind, part) => tr.events.filter((e) => e.kind === kind && (part === undefined || e.part === part)),
    start: (id) => tr.path.get(id)![0]!,
    now: (id) => tr.path.get(id)!.at(-1)!,
    moved: (id) => { const s = tr.path.get(id)![0]!, e = tr.path.get(id)!.at(-1)!; return Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]); },
    spin: (id) => tr.spin.get(id)!,
    armZ: (id) => angleAbout(arm.get(id)!, 2),
    up: (id, axis) => rotate(base.get(id)!, axis),
  };
}

const before = (a: SimEvent | undefined, b: SimEvent | undefined): void => {
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(a!.tick).toBeLessThanOrEqual(b!.tick);
};

describe('demo machines', () => {
  it('cover every part and the five link cards, within the demo limits', () => {
    const keys = [...PARTS.map((p) => p.type), ...LINK_CARDS];
    expect(Object.keys(DEMOS).sort()).toEqual([...keys].sort());
    for (const [key, d] of Object.entries(DEMOS)) {
      expect(d.parts.length, key).toBeLessThanOrEqual(DEMO_MAX_PARTS);
      expect(d.ticks, key).toBeLessThanOrEqual(DEMO_MAX_TICKS);
      expect(d.ticks, key).toBeGreaterThan(0);
      expect(d.camera.dist, key).toBeGreaterThan(0);
      const types = new Set(d.parts.map((p) => p.type));
      if (partDef(key)) expect(types.has(key), key).toBe(true);
      else expect(d.links.some((l) => l.kind === key), key).toBe(true);
      for (const l of d.links) {
        expect(LinkKinds as readonly string[]).toContain(l.kind);
        for (const end of [l.from, l.to]) {
          if (!end && (l.kind.startsWith('gutter') || l.kind.startsWith('tube') || l.kind === 'glidepath' || l.kind === 'fuse')) continue; // path links, free fuse ends
          const p = d.parts.find((q) => q.id === end?.part);
          expect(p, `${key}: link end`).toBeDefined();
          expect(partDef(p!.type)!.ports[end!.port], `${key}: port`).toBeDefined();
        }
      }
    }
  });

  it('cards: every part and link card has short, plain text', () => {
    const keys = [...PARTS.map((p) => p.type), ...LINK_CARDS];
    expect(Object.keys(CARDS).sort()).toEqual([...keys].sort());
    for (const [key, c] of Object.entries(CARDS)) {
      expect(c.needs.length, `${key}.needs`).toBeLessThanOrEqual(60);
      expect(c.does.length, `${key}.does`).toBeLessThanOrEqual(90);
      expect(c.needs.length * c.does.length, key).toBeGreaterThan(0);
      expect(c.tips.length, `${key}.tips`).toBeGreaterThanOrEqual(1);
      expect(c.tips.length, `${key}.tips`).toBeLessThanOrEqual(2);
    }
  });
});

describe('golden machines (per part)', () => {
  // ---- Rollers ---------------------------------------------------------------------------------
  it('thud: rolls down the slope and knocks the plank over', async () => {
    const g = await golden('thud');
    expect(g.moved(g.id('thud'))).toBeGreaterThan(0.5);
    const up = g.up(g.id('plank'), [0, 0, 1]);
    expect(Math.abs(up[1])).toBeLessThan(0.5); // stood on end, now lying down
    expect(g.hash).toMatchInlineSnapshot(`"25d4e112fcdea62b"`);
  }, 30_000);

  it('boing: bounces back up most of the way', async () => {
    const g = await golden('boing');
    const ys = g.tr.path.get(g.id('boing'))!.map((p) => p[1]);
    const low = ys.indexOf(Math.min(...ys.slice(0, 80)));
    expect(ys[low]!).toBeLessThan(0.15);
    expect(Math.max(...ys.slice(low))).toBeGreaterThan(ys[low]! + 0.4);
    expect(g.hash).toMatchInlineSnapshot(`"010f3f183a94f731"`);
  }, 30_000);

  it('stitch: bounces off the slope and rolls away', async () => {
    const g = await golden('stitch');
    const b = g.id('stitch');
    const ys = g.tr.path.get(b)!.map((p) => p[1]);
    const low = ys.indexOf(Math.min(...ys.slice(0, 60)));
    expect(Math.max(...ys.slice(low))).toBeGreaterThan(ys[low]! + 0.05); // bounced
    expect(g.now(b)[0]).toBeLessThan(g.start(b)[0] - 0.4);
    expect(g.hash).toMatchInlineSnapshot(`"b9d3f361611a3d16"`);
  }, 30_000);

  it('helio: gains height, then pops on the cog teeth', async () => {
    const g = await golden('helio');
    const h = g.id('helio');
    expect(Math.max(...g.tr.path.get(h)!.map((p) => p[1]))).toBeGreaterThan(g.start(h)[1] + 0.4);
    expect(g.events('Pop', h)).toHaveLength(1);
    expect(g.hash).toMatchInlineSnapshot(`"1e5ec21c4b6075b2"`);
  }, 30_000);

  // ---- Frame -----------------------------------------------------------------------------------
  it('brik: the wall holds, then the blast cracks its mortar and throws the bricks', async () => {
    const g = await golden('brik');
    const boom = g.events('Detonate')[0];
    expect(boom).toBeDefined();
    const cracks = g.events('Break');
    expect(cracks.length).toBeGreaterThanOrEqual(5);
    expect(cracks.every((e) => e.tick >= boom!.tick)).toBe(true); // no crack before the blast
    expect(g.ids('brik').filter((b) => g.moved(b) > 0.1).length).toBeGreaterThanOrEqual(6);
    expect(g.hash).toMatchInlineSnapshot(`"f10c2a3db4057906"`);
  }, 30_000);

  it('plank: snaps in two under the dropped thud', async () => {
    const g = await golden('plank');
    const brk = g.events('Break', g.id('plank'));
    expect(brk).toHaveLength(1);
    expect(brk[0]!.tick).toBeLessThan(120);
    expect(g.hash).toMatchInlineSnapshot(`"32dda1ac6d5b8f60"`);
  }, 30_000);

  it('slope: the boing rolls down and away along −X', async () => {
    const g = await golden('slope');
    const b = g.id('boing');
    expect(g.now(b)[0]).toBeLessThan(g.start(b)[0] - 0.5);
    expect(g.hash).toMatchInlineSnapshot(`"97d770dbb7128359"`);
  }, 30_000);

  it('ledge: holds the thud up', async () => {
    const g = await golden('ledge');
    const t = g.id('thud');
    expect(Math.abs(g.now(t)[1] - 0.56)).toBeLessThan(0.02);
    expect(g.moved(t)).toBeLessThan(0.05);
    expect(g.hash).toMatchInlineSnapshot(`"21fe4e0b70940538"`);
  }, 30_000);

  it('fulcrum: the thud tips the beam onto its right stop', async () => {
    const g = await golden('fulcrum');
    expect(g.armZ(g.id('fulcrum'))).toBeLessThan(-0.18); // ≈ −12°
    expect(g.hash).toMatchInlineSnapshot(`"b1d33f2b3d21ea56"`);
  }, 30_000);

  it('anchor: the line holds the balloon in place', async () => {
    const g = await golden('anchor');
    const h = g.id('helio');
    expect(g.moved(h)).toBeLessThan(0.05);
    expect(g.events('Cut')).toHaveLength(0);
    expect(g.hash).toMatchInlineSnapshot(`"461a1b1e977c4f06"`);
  }, 30_000);

  it('sheave: the balloon pulls the rope over the pulley and lifts the beam’s left end', async () => {
    const g = await golden('sheave');
    expect(g.armZ(g.id('fulcrum'))).toBeLessThan(-0.18); // left end up, onto its stop
    expect(g.now(g.id('helio'))[1]).toBeGreaterThan(g.start(g.id('helio'))[1] + 0.2);
    expect(g.hash).toMatchInlineSnapshot(`"70b2f2c1f6005e86"`);
  }, 30_000);

  // ---- Drive -----------------------------------------------------------------------------------
  it('treadway: the motor-driven belt carries the brick along +X', async () => {
    const g = await golden('treadway');
    expect(g.events('Powered', g.id('motor'))).toHaveLength(1);
    const b = g.id('brik');
    expect(g.now(b)[0]).toBeGreaterThan(g.start(b)[0] + 0.3);
    expect(g.hash).toMatchInlineSnapshot(`"0a49f7dd46ce323d"`);
  }, 30_000);

  it('cog: the driven S turns a meshed M at half speed and an L at a third, the other way', async () => {
    const g = await golden('cog');
    const [s, m, l] = g.ids('cog') as [PartId, PartId, PartId];
    expect(Math.abs(g.spin(s))).toBeGreaterThan(5);
    expect(g.spin(m) / g.spin(s)).toBeCloseTo(-0.5, 1);
    expect(g.spin(l) / g.spin(s)).toBeCloseTo(-1 / 3, 1);
    expect(g.hash).toMatchInlineSnapshot(`"7420123b969da775"`);
  }, 30_000);

  it('motor: powered, it spins (CCW) and turns the cog', async () => {
    const g = await golden('motor');
    const mo = g.id('motor');
    expect(g.events('Powered', mo)).toHaveLength(1);
    expect(g.spin(mo)).toBeGreaterThan(5); // CCW = positive about the shaft (+X)
    expect(Math.abs(g.spin(g.id('cog')))).toBeGreaterThan(5);
    expect(g.hash).toMatchInlineSnapshot(`"443699844a6f9881"`);
  }, 30_000);

  // ---- Air -------------------------------------------------------------------------------------
  it('gale: blows the boing away and puts the wick out', async () => {
    const g = await golden('gale');
    expect(g.events('Powered', g.id('gale'))).toHaveLength(1);
    expect(g.events('Extinguish', g.id('wick'))).toHaveLength(1);
    const b = g.id('boing');
    expect(g.now(b)[2]).toBeGreaterThan(g.start(b)[2] + 0.3);
    expect(g.hash).toMatchInlineSnapshot(`"f8524eede23a7458"`);
  }, 30_000);

  // ---- Power and signal ------------------------------------------------------------------------
  it('mains: off at start, the button switches it on and the gale blows', async () => {
    const g = await golden('mains');
    const press = g.events('Press', g.id('the_button'))[0];
    const sig = g.events('Signal', g.id('mains'))[0];
    const on = g.events('Powered', g.id('gale'))[0];
    before(press, sig);
    before(sig, on);
    const b = g.id('boing');
    expect(g.now(b)[2]).toBeGreaterThan(g.start(b)[2] + 0.5);
    expect(g.hash).toMatchInlineSnapshot(`"2aa077059b85a463"`);
  }, 30_000);

  it('stomp_pad: the 0.6 kg boing is under the 2 kg trigger weight, the thud presses it', async () => {
    const g = await golden('stomp_pad');
    const [light, heavy] = g.ids('stomp_pad') as [PartId, PartId];
    expect(g.events('Press', light)).toHaveLength(0);
    const press = g.events('Press', heavy)[0];
    const boom = g.events('Detonate', g.id('bangstick'))[0];
    before(press, g.events('Signal', g.id('bangstick'))[0]);
    before(press, boom);
    expect(g.hash).toMatchInlineSnapshot(`"52cff5cff92a01ea"`);
  }, 30_000);

  it('the_button: the falling thud presses it; the signal sets off the bangstick', async () => {
    const g = await golden('the_button');
    const press = g.events('Press', g.id('the_button'))[0];
    const sig = g.events('Signal', g.id('bangstick'))[0];
    before(press, sig);
    before(sig, g.events('Detonate', g.id('bangstick'))[0]);
    expect(g.hash).toMatchInlineSnapshot(`"9ea1a53515c55613"`);
  }, 30_000);

  // ---- Fire and boom ---------------------------------------------------------------------------
  it('wick: the flame burns through one line after 1.5 s and the balloon swings free', async () => {
    const g = await golden('wick');
    const cut = g.events('Cut');
    expect(cut).toHaveLength(1);
    expect(cut[0]!.part).toBe(g.demo.links[0]!.id); // the line over the flame
    expect(cut[0]!.tick).toBeGreaterThanOrEqual(175);
    expect(cut[0]!.tick).toBeLessThanOrEqual(190);
    expect(g.now(g.id('helio'))[0]).toBeGreaterThan(0.2); // swung over to the other anchor
    expect(g.hash).toMatchInlineSnapshot(`"a15d491cfd3ab562"`);
  }, 30_000);

  it('bangstick: lit through its fuse, it goes off and sets off its neighbour', async () => {
    const g = await golden('bangstick');
    const [a, b] = g.ids('bangstick') as [PartId, PartId];
    const lit = g.events('Ignite', a)[0];
    const boomA = g.events('Detonate', a)[0], boomB = g.events('Detonate', b)[0];
    before(lit, boomA);
    expect(boomA!.tick - lit!.tick).toBeGreaterThanOrEqual(59); // fuse 0.5 s
    expect(boomA!.tick - lit!.tick).toBeLessThanOrEqual(62);
    expect(boomB!.tick).toBeGreaterThan(boomA!.tick); // sympathetic, a few ticks later
    expect(g.ids('brik').filter((k) => g.moved(k) > 0.1).length).toBeGreaterThanOrEqual(3);
    expect(g.hash).toMatchInlineSnapshot(`"261c91f6f5c49917"`);
  }, 30_000);

  // ---- Contraptions ----------------------------------------------------------------------------
  it('snipper: the button signal closes the blades, the line is cut and the balloon floats off', async () => {
    const g = await golden('snipper');
    const sig = g.events('Signal', g.id('snipper'))[0];
    const cut = g.events('Cut')[0];
    before(g.events('Press', g.id('the_button'))[0], sig);
    before(sig, cut);
    expect(cut!.part).toBe(g.demo.links.find((l) => l.kind === 'line')!.id);
    expect(g.now(g.id('helio'))[1]).toBeGreaterThan(1.5);
    expect(g.hash).toMatchInlineSnapshot(`"778220f74dce5573"`);
  }, 30_000);

  // ---- Fun -------------------------------------------------------------------------------------
  it('topple_tile: the thud starts the row and all ten tiles fall', async () => {
    const g = await golden('topple_tile');
    for (const t of g.ids('topple_tile')) {
      expect(g.up(t, [0, 1, 0])[1], `tile ${t}`).toBeLessThan(0.8);
    }
    expect(g.hash).toMatchInlineSnapshot(`"4db697faca62d508"`);
  }, 30_000);

  // ---- Links -----------------------------------------------------------------------------------
  it('line: the balloon on the line tips the fulcrum’s left end up and stays tethered', async () => {
    const g = await golden('line');
    expect(g.armZ(g.id('fulcrum'))).toBeLessThan(-0.18);
    expect(g.now(g.id('helio'))[1]).toBeLessThan(g.start(g.id('helio'))[1] + 0.15);
    expect(g.hash).toMatchInlineSnapshot(`"483dcc8c8091dc6b"`);
  }, 30_000);

  it('band: the cog turns at the motor’s speed', async () => {
    const g = await golden('band');
    const r = Math.abs(g.spin(g.id('cog')) / g.spin(g.id('motor')));
    expect(Math.abs(g.spin(g.id('motor')))).toBeGreaterThan(5);
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(1.25);
    expect(g.hash).toMatchInlineSnapshot(`"ebde8b6cd2fbc5da"`);
  }, 30_000);

  it('fuse: lit by the wick, it burns at 0.2 m/s to the bangstick, which goes off after its fuse time', async () => {
    const g = await golden('fuse');
    const stick = g.id('bangstick');
    expect(g.events('FuseLit', g.id('wick'))[0]!.tick).toBe(0);
    const lit = g.events('Ignite', stick)[0]!;
    const boom = g.events('Detonate', stick)[0]!;
    // straight port to port: wick flame port (0, 0.019, 0.047) → stick fuse port (0, 0.068, 0.33)
    const len = Math.hypot(0.049, 0.283);
    const end = g.events('FuseEnd', stick)[0]!;
    expect(Math.abs(end.tick - (len / 0.2) * 120)).toBeLessThanOrEqual(2);
    expect(lit.tick).toBeLessThanOrEqual(end.tick); // the spark catches the stub as it arrives
    expect(lit.tick).toBeGreaterThanOrEqual(end.tick - 12);
    expect(boom.tick - lit.tick).toBeGreaterThanOrEqual(59);
    expect(boom.tick - lit.tick).toBeLessThanOrEqual(62);
    expect(g.hash).toMatchInlineSnapshot(`"ad7ed1503f532129"`);
  }, 30_000);

  it('cable_signal: one pad wired to two bangsticks sets both off in the same tick', async () => {
    const g = await golden('cable_signal');
    const [s1, s2] = g.ids('bangstick') as [PartId, PartId];
    const a = g.events('Detonate', s1)[0], b = g.events('Detonate', s2)[0];
    expect(a).toBeDefined();
    expect(b?.tick).toBe(a!.tick);
    expect(g.events('Signal', s1)[0]?.tick).toBe(g.events('Signal', s2)[0]?.tick);
    expect(g.hash).toMatchInlineSnapshot(`"9b0d2d6991b1d2b3"`);
  }, 30_000);

  it('cable_power: one mains powers both the motor and the gale', async () => {
    const g = await golden('cable_power');
    expect(g.events('Powered', g.id('motor'))).toHaveLength(1);
    expect(g.events('Powered', g.id('gale'))).toHaveLength(1);
    expect(Math.abs(g.spin(g.id('cog')))).toBeGreaterThan(5);
    const b = g.id('boing');
    expect(g.now(b)[2]).toBeGreaterThan(g.start(b)[2] + 0.3);
    expect(g.hash).toMatchInlineSnapshot(`"53586c5eef2a6dc1"`);
  }, 30_000);
});

// Behaviour the briefs ask for that the sim doesn't do yet (found while building the demos).
// Skipped, not deleted: un-skip when the sim catches up.
describe('drive-train regressions (found by the goldens, fixed)', () => {
  const drive = (b: Build, to: number, port: string, dir = 0): number => {
    const mains = b.add('mains', -0.9, 0, 0.35);
    const motor = b.add('motor', -0.5, 0, 0.35, { direction: dir });
    b.link('cable_power', mains, 'out', motor, 'in');
    b.link('band', motor, 'out', to, port);
    return motor;
  };

  it('TREADWAY carries loads the way its belt surface moves (sign of the sim’s own beltSpeed)', async () => {
    // observed: the brick always moves opposite to st.beltSpeed (and to the drum's top surface)
    const b = new Build();
    const belt = b.add('treadway', 0, 0, 0);
    const brick = b.add('brik', -0.1, 0.15, 0);
    drive(b, belt, 'drive_l');
    const m = new Machine(await jolt(), b);
    trace(m, 60);
    const x0 = pose(m, brick).p[0];
    trace(m, 12);
    const speed = m.st.beltSpeed[m.parts.findIndex((p) => p.id === belt)]!;
    expect(Math.sign(pose(m, brick).p[0] - x0)).toBe(Math.sign(speed));
    m.destroy();
  });

  it('MOTOR → BAND → TREADWAY: the drum turns steadily at the motor’s no-load speed', async () => {
    // observed: motor and drum speeds swing between about −23 and +3 rad/s every quarter second
    const b = new Build();
    const belt = b.add('treadway', 0, 0, 0);
    drive(b, belt, 'drive_l');
    const m = new Machine(await jolt(), b);
    trace(m, 120);
    for (let k = 0; k < 4; k++) {
      const t = trace(m, 30, { spin: [[belt, 2]] });
      expect(Math.abs(t.spin.get(belt)! * 4)).toBeGreaterThan(9.42 * 0.8);
    }
    m.destroy();
  });

  it('COG M driving a meshed COG S turns it twice as fast (S → M, S → L and L → S already do)', async () => {
    // observed: M → S runs 1:1 (ratio −0.98) and M → L −0.49 instead of −2 and −0.67
    const b = new Build();
    const big = b.add('cog', 0.1, 0.4, 0, { size: 1 });
    const small = b.add('cog', 0.25, 0.4, 0, { size: 0 });
    drive(b, big, 'axle');
    const m = new Machine(await jolt(), b);
    trace(m, 240);
    const t = trace(m, 120, { spin: [[big, 2], [small, 2]] });
    expect(t.spin.get(small)! / t.spin.get(big)!).toBeCloseTo(-2, 1);
    m.destroy();
  });

  it('BAND from one COG to another turns them the same way, never faster than the motor', async () => {
    // observed: the chained cogs counter-rotate and run away (up to ≈ 54 rad/s against 9.42 no-load)
    const b = new Build();
    const c1 = b.add('cog', 0.1, 0.4, 0);
    const c2 = b.add('cog', 0.6, 0.4, 0);
    drive(b, c1, 'axle');
    b.link('band', c1, 'axle', c2, 'axle');
    const m = new Machine(await jolt(), b);
    trace(m, 120);
    for (let k = 0; k < 4; k++) {
      const t = trace(m, 60, { spin: [[c1, 2], [c2, 2]] });
      expect(Math.sign(t.spin.get(c2)!)).toBe(Math.sign(t.spin.get(c1)!));
      expect(Math.abs(t.spin.get(c2)! * 2)).toBeLessThan(9.42 * 1.2);
    }
    m.destroy();
  });

  it('a crossed BAND reverses direction', async () => {
    // observed: band_crossed builds exactly the same constraint as band (the ratio sign is dropped)
    const spinOf = async (kind: 'band' | 'band_crossed'): Promise<number> => {
      const b = new Build();
      const c1 = b.add('cog', 0.1, 0.4, 0);
      const c2 = b.add('cog', 0.6, 0.4, 0);
      drive(b, c1, 'axle');
      b.link(kind, c1, 'axle', c2, 'axle');
      const m = new Machine(await jolt(), b);
      const t = trace(m, 120, { spin: [[c2, 2]] });
      m.destroy();
      return t.spin.get(c2)!;
    };
    expect(Math.sign(await spinOf('band_crossed'))).toBe(-Math.sign(await spinOf('band')));
  });
});
