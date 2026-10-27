// Beta polish, stream PARTSIM (docs/dev/BETA_NOTES_PARTSIM.md, D120–D121): TURBINE turned by global wind (pitched-blade
// torque, SIMULATION §5.8), TRACTOR BEAM occlusion (the max-load and FORCE WALL cases are in m5.test.ts), GRABBER fingers
// that really close and a tolerant zone A, BUZZ's startle and its carried load. Each with a rollback across the new
// behaviour (M5 rule 14) and a threaded-hash check (multithreaded Jolt at 4 workers = the single-threaded build).

import { describe, expect, it } from 'vitest';
import { PartFlag, snappedEuler, type PartId, type PartRecord } from '@knockon/format';
import { loadJolt, type JoltModule } from '@knockon/jolt';
import { BUZZ_BEACON, CRITTER_FSM, CRITTER_M5, GRABBER_FINGER, grabberZone } from '@knockon/parts-data';
import { Machine, type MachineOptions, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose } from './harness.ts';

const TPS = 120;
type World = { readonly parts: readonly PartRecord[]; readonly links?: Build['links'] };

function run(m: Machine, ticks: number, each?: (t: number) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) { m.step(); ev.push(...m.drainEvents()); each?.(t); }
  return ev;
}
const of = (ev: readonly SimEvent[], kind: string, part?: number): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const idx = (m: Machine, id: PartId): number => m.parts.findIndex((p) => p.id === id);

/** Straight run vs a run that goes to `from` and restores to `to`: hashes from `to` + 1 to `end` must match. */
async function rollback(w: World, opts: MachineOptions, to: number, from: number, end: number): Promise<void> {
  const J = await jolt();
  const straight = new Machine(J, w, opts);
  run(straight, to);
  const hs: string[] = [];
  for (let t = to; t < end; t++) { straight.step(); straight.drainEvents(); hs.push(straight.hash()); }
  straight.destroy();
  const m = new Machine(J, w, opts);
  run(m, from);
  expect(m.restore(to)).toBe(to);
  const hs2: string[] = [];
  for (let t = to; t < end; t++) { m.step(); m.drainEvents(); hs2.push(m.hash()); }
  expect(hs2).toEqual(hs);
  m.destroy();
}

/** Hashes every 30 ticks on the single-threaded build and on the threaded build at 4 workers: they must match. */
let st: Promise<JoltModule> | null = null, mt: Promise<JoltModule> | null = null;
async function threaded(w: World, opts: MachineOptions, ticks: number): Promise<void> {
  const hashes = async (J: JoltModule, o: MachineOptions): Promise<string[]> => {
    const m = new Machine(J, w, o);
    const h: string[] = [];
    for (let t = 1; t <= ticks; t++) { m.step(); m.drainEvents(); if (t % 30 === 0) h.push(m.hash()); }
    m.destroy();
    return h;
  };
  const one = await hashes(await (st ??= loadJolt('single')), opts);
  expect(await hashes(await (mt ??= loadJolt('multi', { threads: 4 })), { ...opts, workerThreads: 4 })).toEqual(one);
}

// ---- TURBINE + global wind (D120) ----------------------------------------------------------------------------------

describe('TURBINE in global wind (D26, pitched-blade torque)', () => {
  /** A TURBINE facing +Z (the rotor's face), banded to a DYNAMO (no load: a LAMP's brake would stall a toy rotor). */
  const world = (): Build => {
    const b = new Build();
    const t = b.add('turbine', 0, 0, 0);
    const dyn = b.add('dynamo', 0.5, 0, 0.3);
    b.link('band', t, 'out', dyn, 'in');
    return b;
  };
  const spin = (m: Machine): number => {
    const w = m.bodies[m.parts[0]!.arm]!.body.GetAngularVelocity();
    return w.GetZ(); // the rotor axis is +Z
  };
  const go = async (wind: MachineOptions['wind'], ticks = 3 * TPS): Promise<{ w: number; dyn: number; max: number; drops: number }> => {
    const m = new Machine(await jolt(), world(), { preset: 'room', checkpointEvery: 0, ...(wind ? { wind } : {}) });
    let max = 0, last = 0, drops = 0;
    run(m, ticks, () => { const w = spin(m); if (w < last - 1) drops++; last = w; max = Math.max(max, w); });
    const w = spin(m);
    const d = m.bodies[m.parts[1]!.arm]!.body.GetAngularVelocity();
    const dyn = Math.hypot(d.GetX(), d.GetY(), d.GetZ());
    m.destroy();
    return { w, dyn, max, drops };
  };

  it('wind on its face spins the rotor through the blade pitch (not drag); from behind it turns backwards; across, not at all', async () => {
    const calm = await go(null), face = await go({ speed: 4, dir: 90 }), back = await go({ speed: 4, dir: 270 }), across = await go({ speed: 4, dir: 0 });
    expect(Math.abs(calm.w)).toBeLessThan(0.01);
    expect(face.w).toBeGreaterThan(3); // 90° blows toward −Z: onto the rotor's +Z face
    expect(back.w).toBeLessThan(-3);
    expect(Math.abs(across.w)).toBeLessThan(0.5);
    // a stronger wind spins it faster (the drive fades as the blades reach twice the axial wind speed)
    const gale = await go({ speed: 8, dir: 90 });
    expect(gale.w).toBeGreaterThan(face.w);
  }, 60_000);

  it('its Spin output works as with a GALE: the BAND turns the DYNAMO; a gale holds the rotor under its 32 rad/s governor, never stalling', async () => {
    const breeze = await go({ speed: 6, dir: 90 }, 4 * TPS);
    expect(breeze.dyn).toBeGreaterThan(5);
    expect((await go(null, 4 * TPS)).dyn).toBeLessThan(0.01);
    // 20 s of a 15 m/s gale: the rotor tops out under 32 rad/s and never hiccups (past ≈ 35 rad/s it used to stop dead)
    const gale = await go({ speed: 15, dir: 90, gusts: 'gusty' }, 20 * TPS);
    expect(gale.max).toBeLessThan(32);
    expect(gale.max).toBeGreaterThan(20);
    expect(gale.drops).toBe(0);
  }, 60_000);

  it('gusty wind on a rotor is deterministic, rolls back exactly and is thread-safe', async () => {
    const opts: MachineOptions = { preset: 'room', wind: { speed: 5, dir: 75, gusts: 'gusty' }, seed: [3, 4] };
    const w = world();
    const a = new Machine(await jolt(), w, opts), b2 = new Machine(await jolt(), w, opts);
    run(a, 600); run(b2, 600);
    expect(a.hash()).toBe(b2.hash());
    a.destroy(); b2.destroy();
    await rollback(w, opts, 60, 400, 600); // back to a rotor at rest, then spinning up in gusts
    await rollback(w, opts, 240, 480, 600);
    await threaded(w, opts, 600);
  }, 120_000);
});

// ---- TRACTOR BEAM occlusion (D121): threaded -----------------------------------------------------------------------

describe('TRACTOR BEAM occlusion (D121)', () => {
  it('a THUD in the beam (too heavy: strain) shadows the STITCH behind it; poked aside, the STITCH is pulled; thread-safe', async () => {
    const b = new Build();
    const mains = b.add('mains', -0.5, 0, -0.5);
    const beam = b.add('tractor_beam', 0, 0, 0, { range: 2 });
    b.link('cable_power', mains, 'out', beam, 'in');
    const thud = b.add('thud', 0, 0.081, 0.7); // 7 kg: in the beam but past its 2 kg, so it stays where it is
    const s = b.add('stitch', 0, 0.0375, 1.3);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 120);
    expect(of(ev, 'Attach', beam)).toHaveLength(0);
    expect(pose(m, s).p[2]).toBeCloseTo(1.3, 2);
    m.addPoke({ tick: m.tick + 1, seq: 1, partId: thud, kind: 'impulse', data: [20, 2, 0] });
    const ev2 = run(m, 240);
    expect(of(ev2, 'Attach', beam).map((e) => e.other)).toEqual([s]);
    m.destroy();
    await threaded(b, {}, 240);
  }, 60_000);
});

// ---- GRABBER (D120) ------------------------------------------------------------------------------------------------

describe('GRABBER fingers and zone A (D120)', () => {
  const zoneA = (): number[] => { const z = grabberZone({}, 'a'); return [z[0], z[2]]; };
  const world = (props: Record<string, number>, item = 'glint', y = 0.008): { b: Build; arm: PartId; s: PartId } => {
    const b = new Build();
    const mains = b.add('mains', -0.4, 0, -0.4);
    const arm = b.add('grabber', 0, 0, 0, { loop: 1, grip: 0.08, ...props });
    b.link('cable_power', mains, 'out', arm, 'in');
    const [x, z] = zoneA();
    const s = b.add(item, x!, y, z!);
    return { b, arm, s };
  };

  it('the fingers close on the payload (its width + 1 mm), physically flank it while it rides, and open at the set-down', async () => {
    const { b, arm, s } = world({});
    const m = new Machine(await jolt(), b);
    const fingers = (m as unknown as { x: { m5: { links: number[][] } } }).x.m5.links[idx(m, arm)]!;
    expect(fingers).toHaveLength(5); // upper arm, forearm, palm, two fingers (chunks 3, 4)
    expect(m.bodyInfo()[fingers[3]!]).toMatchObject({ role: 'piece', chunk: 3 });
    let held = -1, gap = Infinity, minOpen = Infinity, openAtRelease = 0;
    const ev = run(m, 480, () => {
      const j = m.grabberJoints();
      if (j[7] === 1) {
        minOpen = Math.min(minOpen, j[6]!);
        if (held < 0) held = m.tick;
        // the physical fingers sit where the opening says: their inner faces either side of the payload
        const at = (b: number): number[] => { const q = m.bodies[b]!.body.GetPosition(); return [q.GetX(), q.GetY(), q.GetZ()]; }; // Jolt reuses the returned vector
        const l = at(fingers[3]!), r = at(fingers[4]!);
        const sep = Math.hypot(l[0]! - r[0]!, l[1]! - r[1]!, l[2]! - r[2]!) - 2 * GRABBER_FINGER.inset;
        if (m.tick > held + 40) gap = Math.min(gap, sep);
      }
    });
    const grip = of(ev, 'Attach', arm)[0]!, put = of(ev, 'Release', arm)[0]!;
    expect(grip.other).toBe(s);
    expect(minOpen).toBeLessThan(0.01); // a GLINT (Ø 16 mm) in a 0.08 m grip: from 0.04 down to ≈ 0.009 per side
    expect(minOpen).toBeGreaterThan(0.008);
    expect(gap).toBeCloseTo(2 * minOpen, 4); // the finger bodies are as closed as the art says
    run(m, 0);
    openAtRelease = m.grabberJoints()[6]!;
    expect(openAtRelease).toBeCloseTo(0.04, 4); // open again, parked
    expect(put.tick).toBeGreaterThan(grip.tick);
    m.destroy();
  }, 60_000);

  it('zone A pointed at the payload’s top (aHeight 0.07 on a STITCH) still grips it (the playtest bug); a height above it shrugs', async () => {
    for (const [h, grips] of [[0.07, true], [0.075, true], [0.2, false]] as const) {
      const { b, arm } = world({ aHeight: h }, 'stitch', 0.0375);
      const m = new Machine(await jolt(), b);
      const ev = run(m, 360);
      expect(of(ev, 'Attach', arm).length > 0, `aHeight ${h}`).toBe(grips);
      expect(of(ev, 'Jam', arm).length > 0, `aHeight ${h}`).toBe(!grips);
      m.destroy();
    }
  }, 60_000);

  it('rollback across the grip, the closing fingers and the set-down rejoins the straight run; thread-safe', async () => {
    const { b } = world({ aHeight: 0.01 }, 'glint');
    await rollback(b, {}, 60, 200, 330); // checkpoint: open, descending; live: closed on the GLINT, mid-carry
    await rollback(b, {}, 120, 300, 420); // checkpoint: closing / closed; live: set down, opening
    await threaded(b, {}, 420);
  }, 120_000);
});

// ---- BUZZ (D121) ---------------------------------------------------------------------------------------------------

describe('BUZZ: startle and carried load (D121)', () => {
  const Z = CRITTER_M5.buzz;
  const tag = (b: Build, id: PartId): void => {
    const i = b.parts.findIndex((p) => p.id === id);
    b.parts[i] = { ...b.parts[i]!, flags: b.parts[i]!.flags | PartFlag.Tagged } as PartRecord;
  };
  const states = (ev: readonly SimEvent[], part: number): string[] => ev.filter((e) => e.kind === 'CritterState' && e.part === part).map((e) => CRITTER_FSM[e.mag]!);
  /** BUZZ docked on its beacon; a RINGER calls it at `call` s (none: < 0); a BANGSTICK `boomAt` m away goes off at `boom` s. */
  const world = (o: { call?: number; boom?: number; boomAt?: readonly [number, number]; item?: string }): { b: Build; buzz: PartId; item: PartId | null } => {
    const b = new Build();
    const beacon = b.add('buzz_beacon', 0, 0, 0);
    const at = BUZZ_BEACON.dock;
    const buzz = b.add('buzz', at[0], at[1], at[2]);
    if ((o.call ?? -1) >= 0) { const r = b.add('ringer', -1.2, 0, -1.2, { time: o.call! }); b.link('cable_signal', r, 'out', beacon, 'call'); }
    let item: PartId | null = null;
    if (o.item) { item = b.add(o.item, 1.5, o.item === 'bangstick' ? 0.039 : 0.12, 1.0); tag(b, item); }
    if (o.boom !== undefined) {
      const [x, z] = o.boomAt ?? [-2.5, 2.0];
      const stick = b.add('bangstick', x, 0.039, z);
      const r = b.add('ringer', x + 0.4, 0, z, { time: o.boom });
      b.link('cable_signal', r, 'out', stick, 'detonator');
    }
    return { b, buzz, item };
  };

  it('a boom 3 m away startles it on its pad (blip, "!", the Sound as cause), then it docks again; a far one does not', async () => {
    const { b, buzz } = world({ boom: 1, boomAt: [2.2, 2.0] });
    const m = new Machine(await jolt(), b);
    let top = 0;
    const ev = run(m, 3 * TPS, () => { top = Math.max(top, pose(m, buzz).p[1]!); });
    expect(states(ev, buzz)).toEqual(['startled', 'docked']);
    const st = ev.find((e) => e.kind === 'CritterState' && e.part === buzz)!;
    const snd = of(ev, 'Sound').find((e) => e.id === st.cause);
    expect(snd).toBeDefined(); // the boom's Sound set it off
    expect(top).toBeGreaterThan(BUZZ_BEACON.dock[1] + 0.02); // the rotors blipped it off the pad
    expect(of(ev, 'Ragdoll', buzz)).toHaveLength(0); // outside the blast radius: no tumble
    m.destroy();
    const far = world({ boom: 1, boomAt: [12, 6] }); // 120 − 20·log10(13.4) ≈ 97 dB < 100
    const m2 = new Machine(await jolt(), far.b);
    expect(states(run(m2, 3 * TPS), far.buzz)).toEqual([]);
    m2.destroy();
  }, 60_000);

  it('mid-carry a boom makes it bob ("!") but it keeps its load and still delivers', async () => {
    const { b, buzz, item } = world({ call: 1, item: 'bangstick', boom: 9.2, boomAt: [-1.5, 2.5] });
    const m = new Machine(await jolt(), b);
    const k = idx(m, buzz);
    let carryDuring = true;
    const ev = run(m, 20 * TPS, () => {
      const s = m.critterState(new Uint8Array(m.parts.length * 4));
      if (CRITTER_FSM[s[k * 4 + 3]!] === 'startled' && !m.critterCarry().length) carryDuring = false;
    });
    const seq = states(ev, buzz);
    expect(seq).toContain('startled');
    expect(seq[seq.indexOf('startled') - 1]).toBe('carry');
    expect(seq[seq.indexOf('startled') + 1]).toBe('carry');
    expect(carryDuring).toBe(true);
    expect(of(ev, 'Deliver', buzz).map((e) => e.other)).toEqual([item]);
    m.destroy();
  }, 60_000);

  it('a load sags the hover by sagM × its payload fraction and slows the climb', async () => {
    // the same fetch with the load model on and off (sagM / climbLoad patched to 0 for the reference run)
    const J = await jolt();
    const measure = async (): Promise<{ y: number[]; vy: number }> => {
      const { b, buzz } = world({ call: 1, item: 'bangstick' });
      const m = new Machine(J, b);
      const k = idx(m, buzz);
      const y: number[] = [];
      let vy = 0;
      run(m, 13 * TPS, () => {
        const s = m.critterState(new Uint8Array(m.parts.length * 4));
        const f = CRITTER_FSM[s[k * 4 + 3]!];
        if (f === 'carry' && m.critterCarry().length) {
          y.push(pose(m, buzz).p[1]!);
          vy = Math.max(vy, m.bodies[m.parts[k]!.base]!.body.GetLinearVelocity().GetY());
        }
      });
      m.destroy();
      return { y, vy };
    };
    const loaded = await measure();
    const z = Z as unknown as { sagM: number; climbLoad: number };
    const keep = { sagM: z.sagM, climbLoad: z.climbLoad };
    let free: { y: number[]; vy: number };
    try { z.sagM = 0; z.climbLoad = 0; free = await measure(); } finally { z.sagM = keep.sagM; z.climbLoad = keep.climbLoad; }
    const frac = 0.8 / Z.payload; // a 0.8 kg BANGSTICK
    // on the level cruise (the carry's middle third) it flies sagM × frac lower
    const mid = (a: number[]): number => { const s = a.slice(Math.floor(a.length / 3), Math.floor((2 * a.length) / 3)); return s.reduce((p, q) => p + q, 0) / s.length; };
    expect(mid(free.y) - mid(loaded.y)).toBeCloseTo(Z.sagM * frac, 2);
    expect(loaded.vy).toBeLessThanOrEqual(Z.climb * (1 - Z.climbLoad * frac) + 1e-3);
    expect(free.vy).toBeGreaterThan(loaded.vy);
  }, 120_000);

  it('rollback across a startle (in the air and on the pad) rejoins the straight run; thread-safe', async () => {
    const { b } = world({ call: 1, item: 'bangstick', boom: 9.2, boomAt: [-1.5, 2.5] });
    const opts: MachineOptions = { checkpointEvery: 60, keepCheckpoints: 40 };
    await rollback(b, opts, 1080, 1260, 1500); // checkpoint: carrying; live: after the startle
    const pad = world({ boom: 1, boomAt: [2.2, 2.0] });
    await rollback(pad.b, opts, 60, 240, 360);
    await threaded(b, opts, 1500);
  }, 180_000);
});

