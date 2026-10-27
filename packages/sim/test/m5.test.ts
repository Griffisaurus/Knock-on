// M5 parts (stream A5): rules the per-part goldens don't pin down. Rollback across every switch Jolt's saved state doesn't
// record (M5 rule 14: FORCE WALL layers, both ways) and across every M5 mechanism (transits, stasis, holds, despawns);
// dormant bodies never pushed (rule 8); RIFT GATES cooldown and bounce; GRAV WELL repel; TRACTOR BEAM max load; HOVER PAD
// sag at its 10 kg limit; COILGUN RING steel-only and recharge; STASIS needs 75 %; GRABBER shrug and supply-scaled speed;
// SINGULARITY collapse, critters spat out; the BUZZ BEACON interface (contract 3).

import { describe, expect, it } from 'vitest';
import { snappedEuler } from '@knockon/format';
import { Machine, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

function run(m: Machine, ticks: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) { m.step(); ev.push(...m.drainEvents()); }
  return ev;
}
const of = (ev: SimEvent[], kind: string, part?: number): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const x = (m: Machine): { m5: { wall: number[]; links: number[][] } } => (m as unknown as { x: { m5: { wall: number[]; links: number[][] } } }).x;

/** Straight run vs a run that goes to `from` and rolls back to `to`: hashes from `to` + 1 to `end` must match. */
async function rollback(b: Build, to: number, from: number, end: number, check?: (m: Machine) => void): Promise<void> {
  const J = await jolt();
  const straight = new Machine(J, b);
  run(straight, to);
  const hs: string[] = [];
  for (let t = to; t < end; t++) { straight.step(); straight.drainEvents(); hs.push(straight.hash()); }
  straight.destroy();
  const m = new Machine(J, b);
  run(m, from);
  expect(m.restore(to)).toBe(to);
  check?.(m);
  const hs2: string[] = [];
  for (let t = to; t < end; t++) { m.step(); m.drainEvents(); hs2.push(m.hash()); }
  expect(hs2).toEqual(hs);
  m.destroy();
}

/** Every M5 mechanism with state at once. */
function busyWorld(): Build {
  const b = new Build();
  const mains = b.add('mains', -2, 0, -2), mains2 = b.add('mains', 2, 0, -2), mains3 = b.add('mains', -2, 0, 2);
  // RIFT GATES: a STITCH drops into a face-up gate; it leaves the upright twin
  b.add('rift_gate', 1.5, 0.025, 1.205, {}, snappedEuler(0, -90, 0));
  b.add('rift_gate', 2.0, 0, 1.0, {}, snappedEuler(90, 0, 0));
  b.add('stitch', 1.5, 0.8, 1.0);
  // STASIS catches a falling BOING
  const field = b.add('stasis_field', -1, 0, -1);
  b.link('cable_power', mains, 'out', field, 'in');
  b.add('boing', -1, 1, -1);
  // TRACTOR holds a STITCH; GRAV WELL pulls a GLINT; COILGUN fires a PIG IRON rolling off a shelf
  const beam = b.add('tractor_beam', 0, 0, -1.5, { mode: 1, hold: 0.8 });
  b.add('stitch', 0, 0.0375, -0.6);
  const well = b.add('grav_well', 7, 0, -1); // far enough (its reach is 5 m) not to steer the others
  b.add('glint', 7.4, 0.008, -1);
  for (const p of [beam, well]) b.link('cable_power', mains2, 'out', p, 'in');
  const ring = b.add('coilgun_ring', -0.36, 0, 1.5, {}, snappedEuler(-90, 0, 0));
  b.add('ledge', -0.1, 0.05, 1.5);
  b.add('slope', 0.4, 0.1, 1.5, { angle: 20 });
  b.add('pig_iron', 0.6, 0.33, 1.5);
  b.link('cable_power', mains3, 'out', ring, 'in');
  // HOVER PAD rising with a STITCH; GRABBER carrying a STITCH
  const pad = b.add('hover_pad', 0, 0, 0.5);
  b.add('stitch', 0, 0.0875, 0.5);
  b.link('cable_power', mains3, 'out', pad, 'in');
  const arm = b.add('grabber', -1.2, 0, 0.3, { loop: 1, grip: 0.08 });
  b.add('stitch', -1.2 - 0.25 * Math.sin(Math.PI / 3), 0.0375, 0.3 + 0.25 * Math.cos(Math.PI / 3));
  b.link('cable_power', mains2, 'out', arm, 'in');
  return b;
}

describe('M5 parts: determinism (M5 rule 14)', () => {
  it('a rollback mid-run rejoins the straight run bit for bit (transit, stasis, beam, well, coilgun, hover, grabber hold)', async () => {
    const J = await jolt();
    const b = busyWorld();
    const m = new Machine(J, b);
    const ev = run(m, 300);
    for (const k of ['Teleport', 'Freeze', 'Attach', 'Boost', 'Engage']) expect(of(ev, k).length, k).toBeGreaterThan(0);
    m.destroy();
    await rollback(b, 60, 200, 360); // back across the transit (t 45 is before 60: so also from a mid-hold, mid-carry state)
    await rollback(b, 0, 120, 240); // back across the transit and the freeze
  }, 120_000);

  it('FORCE WALL: its field layer is re-derived after a restore, both ways (on in the checkpoint, off live, and back)', async () => {
    const b = new Build();
    // starts on, off at 1 s (RINGER), on again at 2.5 s: a STITCH rests against it on the slope, then rolls on;
    // a second STITCH rolling later meets it switched on again
    const wall = b.add('force_wall', 0.2, 0, 0, { width: 0.4, height: 0.3, start: 1 }, snappedEuler(90, 0, 0));
    b.add('slope', 0.35, 0, 0, { angle: 20 });
    b.add('stitch', 0.55, 0.22, 0);
    const r1 = b.add('ringer', 0.3, 0, -0.4, { time: 1 }), r2 = b.add('ringer', 0.5, 0, -0.4, { time: 2.5 });
    b.link('cable_signal', r1, 'out', wall, 'toggle');
    b.link('cable_signal', r2, 'out', wall, 'toggle');
    const layer = (m: Machine): number => m.bodies[x(m).m5.wall[0]!]!.body.GetObjectLayer();
    await rollback(b, 60, 200, 360, (m) => expect(layer(m)).toBe(0)); // checkpoint: on (static layer); live: off
    await rollback(b, 240, 330, 420, (m) => expect(layer(m)).toBe(2)); // checkpoint: off (ghost layer); live: on again
  }, 60_000);

  it('HOVER PAD: its rotation-lock enable is re-derived after a restore, both ways (powered off at 1 s, on again at 2 s)', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, -0.5);
    const pad = b.add('hover_pad', 0, 0, 0);
    b.link('cable_power', mains, 'out', pad, 'in');
    b.add('thud', -0.09, 0.161, 0); // off-centre: unlocked, the falling pad tips
    const r1 = b.add('ringer', -0.5, 0, 0.5, { time: 1 }), r2 = b.add('ringer', -0.8, 0, 0.5, { time: 2 });
    b.link('cable_signal', r1, 'out', mains, 'in');
    b.link('cable_signal', r2, 'out', mains, 'in');
    const lock = (m: Machine): boolean => (m as unknown as { x: { m5: { hoverC: { GetEnabled(): boolean }[] } } }).x.m5.hoverC[1]!.GetEnabled();
    await rollback(b, 60, 200, 360, (m) => expect(lock(m)).toBe(true)); // checkpoint: powered (locked); live: falling (free)
    await rollback(b, 180, 300, 420, (m) => expect(lock(m)).toBe(false)); // checkpoint: unpowered; live: powered again
  }, 60_000);

  it('GRABBER, SINGULARITY: a rollback mid-carry and across despawns rejoins the straight run', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, -0.4);
    const arm = b.add('grabber', 0, 0, 0, { loop: 1, grip: 0.08 });
    b.link('cable_power', mains, 'out', arm, 'in');
    b.add('stitch', -0.25 * Math.sin(Math.PI / 3), 0.0375, 0.25 * Math.cos(Math.PI / 3));
    const sing = b.add('singularity', 3, 0, 0);
    const r = b.add('ringer', 3, 0, 0.6, { time: 1 });
    b.link('cable_signal', r, 'out', sing, 'arm');
    for (let k = 0; k < 4; k++) b.add('stitch', 3.4 + 0.3 * k, 0.0375, 0);
    await rollback(b, 120, 300, 420);
  }, 60_000);
});

describe('M5 parts: rules', () => {
  it('fields never push dormant pool bodies (rule 8): a SINGULARITY right beside a FABRICATOR pool leaves it parked', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('fabricator', 0, 0, 0, { count: 5 });
    const sing = b.add('singularity', 0, -28, 0); // the pool is parked 30 m under its fabricator
    const r = b.add('ringer', 0.6, 0, 0, { time: 1 });
    b.link('cable_signal', r, 'out', sing, 'arm');
    const m = new Machine(J, b);
    const info = m.bodyInfo();
    const pool = info.map((p, i) => (p.role === 'piece' && p.type === 'fabricator' ? i : -1)).filter((i) => i >= 0);
    expect(pool).toHaveLength(5);
    const before = m.transforms(new Float32Array(info.length * 7));
    const ev = run(m, 360);
    expect(of(ev, 'Engage').length).toBe(1);
    expect(of(ev, 'Despawn')).toHaveLength(0);
    const after = m.transforms(new Float32Array(info.length * 7));
    for (const i of pool) for (let k = 0; k < 7; k++) expect(after[i * 7 + k]).toBe(before[i * 7 + k]);
    m.destroy();
  });

  it('RIFT GATES: a second body arriving within 0.25 s of a transit bounces off the membrane; one after it transits', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('rift_gate', 0, 0.025, 0.205, { pair: 3 }, snappedEuler(0, -90, 0));
    b.add('rift_gate', 1, 0, 0, { pair: 3 }, snappedEuler(90, 0, 0));
    b.add('rift_gate', 3, 0, 0, { pair: 1 }); // a lone gate of another colour: unpaired
    const s1 = b.add('stitch', 0, 0.6, 0), s2 = b.add('stitch', 0.02, 0.75, 0.01), s3 = b.add('stitch', -0.01, 1.4, 0);
    const m = new Machine(J, b);
    const ev = run(m, 240);
    const tp = of(ev, 'Teleport');
    expect(tp.map((e) => e.other)).toEqual([s1, s3]);
    const bounce = of(ev, 'Bounce');
    expect(bounce.map((e) => e.other)).toContain(s2);
    expect(bounce[0]!.tick - tp[0]!.tick).toBeLessThan(30);
    expect(tp[1]!.tick - tp[0]!.tick).toBeGreaterThanOrEqual(30);
    const f = m.partFlags(new Uint8Array(m.parts.length));
    expect(f[2]! & 1).toBe(0); // the lone gate isn't lit
    m.destroy();
  });

  it('RIFT GATES: a tethered body bounces instead of travelling (its LINE would yank across the room)', async () => {
    const J = await jolt();
    const b = new Build();
    b.add('rift_gate', 0, 0.025, 0.205, {}, snappedEuler(0, -90, 0));
    b.add('rift_gate', 1, 0, 0, {}, snappedEuler(90, 0, 0));
    const ball = b.add('maglock', 0, 0.5, 0); // 3 kg, hung from its eye
    const hook = b.add('anchor', -0.5, 0, -0.5);
    b.link('line', ball, 'eye', hook, 'hook');
    const m = new Machine(J, b);
    const ev = run(m, 120);
    expect(of(ev, 'Teleport')).toHaveLength(0);
    expect(of(ev, 'Bounce').length).toBeGreaterThan(0);
    m.destroy();
  });

  it('GRAV WELL in Repel pushes a ball away; unpowered it does nothing', async () => {
    const J = await jolt();
    for (const powered of [true, false]) {
      const b = new Build();
      const well = b.add('grav_well', 0, 0, 0, { mode: 1 });
      if (powered) { const mains = b.add('mains', -0.5, 0, -0.5); b.link('cable_power', mains, 'out', well, 'in'); }
      const s = b.add('stitch', 0.4, 0.0375, 0);
      const m = new Machine(J, b);
      run(m, 120);
      const p = pose(m, s).p;
      if (powered) expect(p[0]).toBeGreaterThan(1);
      else expect(p[0]).toBeCloseTo(0.4, 2);
      m.destroy();
    }
  });

  it('TRACTOR BEAM carries at most 2 kg: a 3 kg MAGLOCK in its beam stays put (strain); a STITCH in the clear behind it is held, one in its shadow is not (D121)', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, -0.5);
    const beam = b.add('tractor_beam', 0, 0, 0, { mode: 1, hold: 1.5, range: 3 });
    b.link('cable_power', mains, 'out', beam, 'in');
    const heavy = b.add('maglock', 0.1, 0, 0.8); // off the axis, still in the cone: strain
    const hid = b.add('stitch', 0.1, 0.0375, 1.2); // in the cone, but the lens's ray to it runs through the MAGLOCK
    const s = b.add('stitch', 0, 0.0375, 2.0); // on the axis: the ray passes beside the MAGLOCK
    const m = new Machine(J, b);
    const ev = run(m, 360);
    expect(of(ev, 'Attach').map((e) => e.other)).toEqual([s]);
    expect(pose(m, heavy).p[2]).toBeCloseTo(0.8, 2);
    expect(pose(m, hid).p[2]).toBeCloseTo(1.2, 2); // shadowed: never lifted
    expect(pose(m, hid).p[1]).toBeCloseTo(0.0375, 2);
    expect(pose(m, s).p[2]).toBeCloseTo(0.155 + 1.5, 1); // held at the hold point
    expect(pose(m, s).p[1]).toBeCloseTo(0.06, 1);
    const f = m.partFlags(new Uint8Array(m.parts.length));
    expect(f[1]! & 64).toBe(64); // strain
    m.destroy();
  });

  it('TRACTOR BEAM occlusion (D121): a STITCH behind a FORCE WALL is pulled only once the wall switches off; rollback across it', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, -0.5);
    const beam = b.add('tractor_beam', 0, 0, 0, { range: 1.5 });
    b.link('cable_power', mains, 'out', beam, 'in');
    const wall = b.add('force_wall', 0, 0, 0.6, { start: 1 }); // across the beam
    const r = b.add('ringer', 0.6, 0, -0.4, { time: 1 });
    b.link('cable_signal', r, 'out', wall, 'toggle');
    const s = b.add('stitch', 0, 0.0375, 1.2);
    const m = new Machine(J, b);
    const ev = run(m, 360);
    const att = of(ev, 'Attach', beam);
    expect(att.map((e) => e.other)).toEqual([s]);
    expect(att[0]!.tick).toBeGreaterThanOrEqual(120); // not before the wall goes off at 1 s
    expect(att[0]!.tick).toBeLessThan(126);
    expect(pose(m, s).p[2]).toBeLessThan(0.4); // reeled in through where the wall was
    m.destroy();
    await rollback(b, 60, 200, 300); // checkpoint: shadowed (wall on); live: held (wall off)
    await rollback(b, 0, 150, 260);
  }, 60_000);

  it('HOVER PAD at its 10 kg payload limit sags at most 1 cm; past it (20 kg) it reports overload', async () => {
    const J = await jolt();
    for (const load of [10, 20]) {
      const b = new Build();
      const mains = b.add('mains', -0.5, 0, -0.5);
      const pad = b.add('hover_pad', 0, 0, 0);
      b.link('cable_power', mains, 'out', pad, 'in');
      let thud = -1;
      if (load === 10) {
        thud = b.add('thud', -0.095, 0.161, 0); // 7 kg …
        b.add('maglock', 0.125, 0.05, 0); // … + 3 kg beside it
      } else b.add('wrecker', 0, 0.146, 0); // 20 kg: twice the limit
      const m = new Machine(J, b);
      run(m, 300); // settled (the rise ends by ≈ 1.5 s); a sphere creeps off the deck after ≈ 3.5 s (see M5_NOTES_A5)
      const sag = 0.5 - pose(m, pad).p[1];
      const f = m.partFlags(new Uint8Array(m.parts.length))[1]!;
      if (load === 10) {
        expect(pose(m, thud).p[1]).toBeGreaterThan(0.6); // the THUD is still aboard
        expect(sag).toBeGreaterThan(0.0095); // measured 9.9 mm (10 kg × g / 10,000 N/m = 9.8 mm)
        expect(sag).toBeLessThanOrEqual(0.01);
        expect(f & 64).toBe(0);
      }
      else { expect(sag).toBeGreaterThan(0.01); expect(f & 64).toBe(64); }
      const q = pose(m, pad).q;
      expect(Math.abs(q[3])).toBeGreaterThan(0.9999); // rotation locked level despite the off-centre load
      m.destroy();
    }
  });

  it('COILGUN RING: steel only, once per pass, and a second steel ball inside the 0.5 s recharge passes as a dud', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, -0.5);
    // lying flat in mid-air (its axis points up; the bore is 0.1575 m toward −Z of its origin), boosting downward
    const ring = b.add('coilgun_ring', 0, 0.6, 0, { direction: 1 }, snappedEuler(0, -90, 0));
    b.link('cable_power', mains, 'out', ring, 'in');
    const z = -0.1575;
    const steel = b.add('pig_iron', 0, 2.2, z), steel2 = b.add('bearing', 0.01, 2.32, z), plain = b.add('stitch', 0, 3.4, z + 0.01); // the ring charges for 0.5 s first
    const m = new Machine(J, b);
    const ev = run(m, 240);
    const boosts = of(ev, 'Boost');
    const first = boosts.find((e) => e.other === steel)!;
    expect(first.mag).toBe(3);
    expect(boosts.find((e) => e.other === steel2)!.mag).toBe(0); // within the recharge
    expect(boosts.find((e) => e.other === plain)!.mag).toBe(0); // not steel
    expect(boosts.filter((e) => e.other === steel)).toHaveLength(1);
    m.destroy();
  });

  it('STASIS FIELD needs 75 % supply: with one ARC TOWER on the MAINS (f 0.81) it freezes, with two (f 0.49) it does not', async () => {
    const J = await jolt();
    for (const towers of [1, 2]) {
      const b = new Build();
      const mains = b.add('mains', -0.8, 0, -0.6);
      const field = b.add('stasis_field', 0, 0, 0);
      b.link('cable_power', mains, 'out', field, 'in');
      for (let k = 0; k < towers; k++) { const t = b.add('arc_tower', 1 + k, 0, 0); b.link('cable_power', mains, 'out', t, 'in'); }
      const s = b.add('stitch', 0, 0.8, 0);
      const m = new Machine(J, b);
      const ev = run(m, 120);
      expect(of(ev, 'Freeze').length > 0, `${towers} towers`).toBe(towers === 1);
      expect(pose(m, s).p[1] > 0.3, `${towers} towers`).toBe(towers === 1);
      m.destroy();
    }
  });

  it('GRABBER: with nothing at zone A it shrugs (Jam) and parks; on half supply its cycle takes about twice as long', async () => {
    const J = await jolt();
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, -0.4);
    const arm = b.add('grabber', 0, 0, 0);
    const button = b.add('the_button', 0.5, 0, 0.4);
    b.add('thud', 0.5, 0.2, 0.4);
    b.link('cable_power', mains, 'out', arm, 'in');
    b.link('cable_signal', button, 'out', arm, 'go');
    const m = new Machine(J, b);
    const ev = run(m, 480);
    const trig = of(ev, 'Trigger')[0]!, jam = of(ev, 'Jam')[0]!;
    expect(jam).toBeDefined();
    expect(of(ev, 'Attach')).toHaveLength(0);
    expect(m.grabberJoints()[2]).toBeCloseTo(0, 5); // parked again (shoulder 0)
    expect(trig.tick).toBeLessThan(jam.tick);
    m.destroy();
    const ticksToGrip = async (towers: number): Promise<number> => {
      const c = new Build();
      const mn = c.add('mains', -0.4, 0, -0.4);
      const g = c.add('grabber', 0, 0, 0, { loop: 1, grip: 0.08 });
      c.link('cable_power', mn, 'out', g, 'in');
      for (let k = 0; k < towers; k++) { const t = c.add('arc_tower', 1 + k, 0, 1); c.link('cable_power', mn, 'out', t, 'in'); }
      c.add('stitch', -0.25 * Math.sin(Math.PI / 3), 0.0375, 0.25 * Math.cos(Math.PI / 3));
      const mm = new Machine(J, c);
      const e = run(mm, 720);
      mm.destroy();
      return of(e, 'Attach')[0]!.tick;
    };
    const full = await ticksToGrip(0), half = await ticksToGrip(2); // 100 W + 800 W on 500 W: f = 0.56
    expect(half / full).toBeGreaterThan(1.6);
    expect(half / full).toBeLessThan(2);
  });

  it('SINGULARITY: collapses at 6 s and is spent (a second arm does nothing); a critter at the core is spat out, never swallowed', async () => {
    const J = await jolt();
    const b = new Build();
    const sing = b.add('singularity', 0, 0, 0);
    const r1 = b.add('ringer', 1.5, 0, 1.5, { time: 1 }), r2 = b.add('ringer', 1.5, 0, -1.5, { time: 8 });
    b.link('cable_signal', r1, 'out', sing, 'arm');
    b.link('cable_signal', r2, 'out', sing, 'arm');
    const pip = b.add('pip', 0.6, 0.05, 0);
    const m = new Machine(J, b);
    const ev = run(m, 120 * 9);
    const arms = of(ev, 'Engage');
    expect(arms).toHaveLength(1);
    const col = of(ev, 'Collapse')[0]!;
    expect((col.tick - arms[0]!.tick) / 120).toBeCloseTo(6, 2);
    expect(of(ev, 'Despawn').filter((e) => e.other === pip)).toHaveLength(0);
    expect(of(ev, 'Launch').some((e) => e.other === pip)).toBe(true);
    expect(m.partMeters(new Uint8Array(m.parts.length))[0]).toBe(1); // spent: "0"
    m.destroy();
  }, 60_000);

  it('BUZZ BEACON: the interface reports calls, the Call event as cause, the dock pose and the pad item; the status drives the flags', async () => {
    const J = await jolt();
    const b = new Build();
    const beacon = b.add('buzz_beacon', 0.5, 0, 0, { pair: 2 }, snappedEuler(90, 0, 0));
    const button = b.add('the_button', -0.3, 0, 0.2);
    b.add('thud', -0.3, 0.2, 0.2);
    b.link('cable_signal', button, 'out', beacon, 'call');
    const item = b.add('stitch', 0.52, 0.0775, 0.01);
    const m = new Machine(J, b);
    const m5 = (m as unknown as { x: { m5: import('../src/channels/m5.ts').M5Parts } }).x.m5;
    expect(m5.beacons()).toEqual([0]);
    const ev = run(m, 60);
    const call = of(ev, 'Call')[0]!;
    const v = m5.beacon(0)!;
    expect(v.calls).toBe(1);
    expect(v.callCause).toBe(call.id);
    expect(v.callTick).toBe(call.tick);
    expect(v.pair).toBe(2);
    expect(v.dockPos[0]).toBeCloseTo(0.5, 5);
    expect(v.dockPos[1]).toBeCloseTo(0.04, 5);
    expect(v.dockRot[1]).toBeCloseTo(Math.SQRT1_2, 4); // yawed 90°: BUZZ docks facing +X
    expect(v.padItem).toBe(3); // the STITCH resting on the pad (part index)
    m5.setBeaconStatus(0, 1);
    expect(m.partFlags(new Uint8Array(m.parts.length))[0]! & 2).toBe(2);
    m5.setBeaconStatus(0, 2);
    expect(m.partFlags(new Uint8Array(m.parts.length))[0]! & 16).toBe(16);
    void item;
    m.destroy();
  });
});
