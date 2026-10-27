// M4 critters (stream B4): BISCUIT, HENNY and DUSTY (GAME_SPEC §11, SIMULATION §7, critters.md), and MOCHI's
// flee(Biscuit). Contract data for E4b, the three golden demos with behaviour assertions, each species' behaviours
// (barks as Sound pulses, the barge, the YOLK pool, the trapped-no-flap rule, Dusty's zone, bumper, tumble, leash and
// Matter intake), and replay / rollback across every new mechanism. The goldens' final hashes are pinned; re-pin
// with `vitest -u` only for a change that explains them.

import { describe, expect, it } from 'vitest';
import type { PartId } from '@knockon/format';
import {
  CRITTER_BIN_SHIFT, CRITTER_CLIPS, CRITTER_EMOTES, CRITTER_FSM, CRITTER_M4, CRITTER_SPECS, CritterFlagBits, partDef,
  type CritterFsm,
} from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { Machine, type EventKind, type ExtraLure, type MachineOptions, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose, trace, type Trace } from './harness.ts';
import { FakeMatter } from './matter_fake.ts';
import { MatterCpu } from '../../matter/src/index.ts';

const fsm = (s: CritterFsm): number => CRITTER_FSM.indexOf(s);
const states = (ev: readonly SimEvent[], part: PartId): string[] => ev.filter((e) => e.kind === 'CritterState' && e.part === part).map((e) => CRITTER_FSM[e.mag]!);
const of = (ev: readonly SimEvent[], kind: EventKind, part?: PartId): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const emotes = (ev: readonly SimEvent[], part: PartId): string[] => of(ev, 'Emote', part).map((e) => CRITTER_EMOTES[e.mag]!);
const idx = (m: Machine, id: PartId): number => m.parts.findIndex((p) => p.id === id);
const cstate = (m: Machine, id: PartId): { clip: string; flags: number; emote: string; fsm: string } => {
  const b = m.critterState(new Uint8Array(m.parts.length * 4));
  const o = idx(m, id) * 4;
  return { clip: CRITTER_CLIPS[b[o]!]!, flags: b[o + 1]!, emote: CRITTER_EMOTES[b[o + 2]!]!, fsm: CRITTER_FSM[b[o + 3]!]! };
};
const finite = (m: Machine): boolean => m.transforms(new Float32Array(m.bodies.length * 7)).every((v) => Number.isFinite(v));
/** Body indices of a part's pooled pieces (HENNY's YOLKs), pool order. */
const eggs = (m: Machine, id: PartId): number[] => m.bodyInfo().flatMap((b, i) => (b.part === id && b.role === 'piece' ? [i] : []));
const at = (m: Machine, bi: number): [number, number, number] => { const p = m.bodies[bi]!.body.GetPosition(); return [p.GetX(), p.GetY(), p.GetZ()]; };
const massOf = (m: Machine, id: PartId): number => 1 / m.bodies[m.parts[idx(m, id)]!.base]!.body.GetMotionProperties().GetInverseMass();

/** Steps and collects events, checking a predicate every tick (a tiny trace with a hook). */
function run(m: Machine, ticks: number, each?: (t: number) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 1; t <= ticks; t++) { m.step(); ev.push(...m.drainEvents()); each?.(t); }
  return ev;
}

// ---- contract data (for E4b's rigs, F4's voices, U4's captions) -----------------------------------------------

describe('M4 critter data', () => {
  it('BISCUIT ragdoll: Mochi’s 15-capsule layout, 12 kg with hips 2.6, chest 2.4, head 1.4', () => {
    const b = CRITTER_SPECS.biscuit.ragdoll, mo = CRITTER_SPECS.mochi.ragdoll;
    expect(b.map((x) => x.bone)).toEqual(mo.map((x) => x.bone));
    expect(b.map((x) => x.parent)).toEqual(mo.map((x) => x.parent));
    const mass = (n: string): number => b.find((x) => x.bone === `RAG__${n}`)!.mass;
    expect(mass('hips')).toBe(2.6);
    expect(mass('spine_03')).toBe(2.4);
    expect(mass('head')).toBe(1.4);
    // ragdoll above 10 N·s, barges ≤ 6 kg, wakes at 55 dB, 10 m for Mochi (critters.md)
    const s = CRITTER_SPECS.biscuit;
    expect([s.ragdollJ, s.barge, s.hearDb, s.vision, s.smells.mochi]).toEqual([10, 6, 55, 10, 10]);
  });

  it('HENNY ragdoll: 10 capsules (hips, spine_02, neck_02, head, upper wings, thighs, shins), 1.6 kg', () => {
    expect(CRITTER_SPECS.henny.ragdoll.map((x) => x.bone.slice(5))).toEqual(['hips', 'spine_02', 'neck_02', 'head', 'upper_l', 'upper_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r']);
    expect([CRITTER_SPECS.henny.ragdollJ, CRITTER_SPECS.henny.hearDb]).toEqual([1.2, 50]);
  });

  it('DUSTY: one rigid RAG__body cylinder matching its COL__cylinder__0 disc (Ø 0.366 × 0.055 at y 0.008–0.063)', () => {
    const s = CRITTER_SPECS.dusty;
    expect(s.ragdoll).toHaveLength(1);
    const r = s.ragdoll[0]!;
    expect([r.bone, r.shape, r.parent, r.swing, r.twist, r.mass]).toEqual(['RAG__body', 'cylinder', -1, 0, 0, 3.2]);
    expect(r.radius).toBe(s.disc!.radius);
    expect(2 * r.halfHeight).toBeCloseTo(s.disc!.height, 6);
    expect(r.at[1]).toBeCloseTo(s.disc!.at[1], 6);
    expect([s.ragdollJ, s.hearDb, s.intake!.bin]).toEqual([4, 70, 1.8]);
  });

  it('new parts: ship M4, props (Henny’s eggs, Dusty’s zone), Dusty’s charge port; YOLK def from A4 feeds the pool', () => {
    for (const t of ['biscuit', 'henny', 'dusty']) expect(partDef(t)!.ship).toBe('M4');
    expect(partDef('henny')!.props.eggs!.default).toBe(CRITTER_M4.henny.eggs);
    expect(Object.keys(partDef('dusty')!.props)).toEqual(['zone_w', 'zone_d', 'zone_x', 'zone_z']);
    expect(partDef('dusty')!.ports.map((p) => [p.name, p.channel, p.dir])).toEqual([['charge', 'power', 'in']]);
    // M2 tables are unchanged (append-only): the M2 entries keep their indices
    expect(CRITTER_FSM.indexOf('pedal_dismount')).toBe(32);
    expect(CRITTER_CLIPS.indexOf('wash_hands')).toBe(37);
    expect(CRITTER_EMOTES.indexOf('pedal')).toBe(22);
  });
});

// ---- goldens ------------------------------------------------------------------------------------------------

interface G { m: Machine; tr: Trace; hash: string; id(type: string, n?: number): PartId }

async function golden(key: string): Promise<G> {
  const demo = DEMOS[key]!;
  const J = await jolt();
  const ids = (type: string): PartId[] => demo.parts.filter((p) => p.type === type).map((p) => p.id);
  const once = (): { m: Machine; tr: Trace } => {
    const m = new Machine(J, demo);
    return { m, tr: trace(m, demo.ticks, { track: demo.parts.map((p) => p.id) }) };
  };
  const a = once(), b = once();
  expect(b.tr.hashes).toEqual(a.tr.hashes);
  b.m.destroy();
  return { m: a.m, tr: a.tr, hash: a.tr.hashes.at(-1)!, id: (type, n = 0) => ids(type)[n]! };
}

describe('golden machines (M4 critters)', () => {
  it('biscuit: a thump wakes him; he chases Mochi barking every 1.5 s (70 dB Sounds); she flees him', async () => {
    const g = await golden('biscuit');
    const biscuit = g.id('biscuit'), mochi = g.id('mochi');
    const seq = states(g.tr.events, biscuit);
    expect(seq.slice(0, 1)).toEqual(['wake']);
    expect(seq).toContain('chase');
    const barks = of(g.tr.events, 'Bark', biscuit);
    expect(barks.length).toBeGreaterThanOrEqual(2);
    expect(barks[1]!.tick - barks[0]!.tick).toBe(180); // every 1.5 s
    for (const b of barks) {
      const snd = g.tr.events.find((e) => e.kind === 'Sound' && e.cause === b.id)!;
      expect(snd.mag).toBe(70);
      expect(snd.part).toBe(biscuit);
    }
    expect(emotes(g.tr.events, mochi)).toContain('dog_alert');
    expect(states(g.tr.events, mochi)).toContain('flee');
    expect(g.tr.path.get(biscuit)!.at(-1)![2]).toBeGreaterThan(2); // he ran after her
    expect(finite(g.m)).toBe(true);
    expect(g.hash).toMatchInlineSnapshot(`"f1b9be978d6f7c94"`);
    g.m.destroy();
  }, 30_000);

  it('henny: a THUD lands 0.8 m away; startled → flap (1 m up) → lay_egg (a YOLK at the apex) → glide_down → proud_puff', async () => {
    const g = await golden('henny');
    const henny = g.id('henny');
    expect(states(g.tr.events, henny).slice(0, 5)).toEqual(['startled', 'flap', 'lay_egg', 'glide_down', 'proud_puff']);
    const ys = g.tr.path.get(henny)!.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(0.95);
    expect(Math.max(...ys)).toBeLessThan(1.1);
    const lay = of(g.tr.events, 'Lay', henny);
    expect(lay).toHaveLength(1);
    expect(lay[0]!.pos[1]).toBeGreaterThan(1.0); // at the apex (the vent is 0.10 m up her body)
    const pool = eggs(g.m, henny);
    expect(pool).toHaveLength(CRITTER_M4.henny.eggs);
    expect(at(g.m, pool[0]!)[1]).toBeLessThan(0.05); // the YOLK landed and rests on the floor, unbroken
    expect(at(g.m, pool[1]!)[1]).toBeLessThan(-25); // the rest of the pool is still parked
    expect(of(g.tr.events, 'Splat')).toHaveLength(0);
    expect(cstate(g.m, henny).clip).toBe('proud_puff');
    expect(g.hash).toMatchInlineSnapshot(`"5bbcb9d994170ca1"`);
    g.m.destroy();
  }, 30_000);

  it('dusty: patrols, bumps the LEDGE and turns away (bump_turn), staying in its zone', async () => {
    const g = await golden('dusty');
    const dusty = g.id('dusty');
    expect(states(g.tr.events, dusty)).toContain('bump_turn');
    expect(of(g.tr.events, 'Impact', dusty).length).toBeGreaterThan(0);
    const p = g.tr.path.get(dusty)!;
    expect(Math.max(...p.map((q) => q[2]))).toBeLessThan(0.45 - 0.2 - 0.18 + 0.03); // stopped at the ledge's edge
    for (const q of p) expect(Math.abs(q[1])).toBeLessThan(0.03);
    expect(g.hash).toMatchInlineSnapshot(`"e9406fdf01b69958"`);
    g.m.destroy();
  }, 30_000);
});

// ---- BISCUIT ----------------------------------------------------------------------------------------------------

describe('BISCUIT', () => {
  it('sleeps through quiet, wakes at 55 dB effective, and barges light bodies aside but not a THUD', async () => {
    const b = new Build();
    const biscuit = b.add('biscuit', 0, 0, 0);
    const mochi = b.add('mochi', 0, 0, 3.2);
    const boing = b.add('boing', 0.05, 0.12, 1.4); // 0.6 kg, right in his path
    const thud = b.add('thud', -1.6, 0.11, 1.0); // 7 kg, off to the side
    b.add('stitch', 0.4, 0.3, 0.2); // falls next to him: J ≈ 0.4 N·s, a quiet tap (no Sound) → he sleeps on
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 240, seq: 1, partId: thud, kind: 'impulse', data: [0, 30, 0] }); // the THUD hops and lands: a bang
    const quiet = run(m, 230);
    expect(states(quiet, biscuit)).toEqual([]);
    expect(cstate(m, biscuit).flags & CritterFlagBits.asleep).toBe(CritterFlagBits.asleep);
    const ev = run(m, 900);
    expect(states(ev, biscuit)[0]).toBe('wake');
    expect(states(ev, biscuit)).toContain('chase');
    // the BOING was shoved aside (sideways) as he ran through
    const bp = pose(m, boing).p;
    expect(Math.abs(bp[0] - 0.05)).toBeGreaterThan(0.3);
    expect(of(ev, 'Ragdoll', biscuit)).toHaveLength(0);
    void mochi;
    m.destroy();
  }, 30_000);

  it('a trapped Mochi gets barked at (bark state, a Bark every 1.5 s); then he gives up and later goes back to sleep', async () => {
    const b = new Build();
    const biscuit = b.add('biscuit', 0, 0, 0);
    const box = b.add('trap_box', 0, 0.02, 1.6);
    const mochi = b.add('mochi', 0, 0, 1.6);
    const thud = b.add('thud', 0.6, 0.11, -0.4);
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 30, seq: 1, partId: thud, kind: 'impulse', data: [0, 30, 0] });
    const ev = run(m, 40 * 120);
    expect(of(ev, 'Trapped', mochi).length).toBeGreaterThan(0);
    const seq = states(ev, biscuit);
    expect(seq).toContain('bark');
    const barks = of(ev, 'Bark', biscuit);
    expect(barks.length).toBeGreaterThanOrEqual(3);
    // ...and eventually he settles back to sleep
    expect(seq.at(-1)).toBe('sleep');
    expect(of(ev, 'CritterState', mochi).some((e) => e.mag === fsm('trapped'))).toBe(true);
    void box;
    m.destroy();
  }, 60_000);
});

// ---- HENNY ------------------------------------------------------------------------------------------------------

describe('HENNY', () => {
  /** Henny plus a THUD 2.5 m away, poked into the air at the given ticks: each landing is an 80+ dB Sound. */
  const startles = async (pokes: number[], props: Record<string, number> = {}): Promise<{ m: Machine; henny: PartId; ev: SimEvent[] }> => {
    const b = new Build();
    const henny = b.add('henny', 0, 0, 0, props);
    const thud = b.add('thud', 2.5, 0.11, 0);
    const m = new Machine(await jolt(), b);
    pokes.forEach((t, i) => m.addPoke({ tick: t, seq: i + 1, partId: thud, kind: 'impulse', data: [0, 28, 0] }));
    const ev = run(m, Math.max(...pokes) + 4 * 120);
    return { m, henny, ev };
  };

  it('lays at most one egg per 6 s and no more than `eggs` per run', async () => {
    // a fright each time she has settled from the last one (the THUD 2.5 m away is poked up; its landing is ~85 dB)
    const b = new Build();
    const henny = b.add('henny', 0, 0, 0, { eggs: 2 });
    const thud = b.add('thud', 2.5, 0.11, 0);
    const m = new Machine(await jolt(), b);
    const busy = new Set((['startled', 'flap', 'lay_egg', 'glide_down', 'proud_puff'] as CritterFsm[]).map(fsm));
    let pokes = 0, calm = 0;
    m.addPoke({ tick: 60, seq: ++pokes, partId: thud, kind: 'impulse', data: [0, 28, 0] });
    const ev = run(m, 40 * 120, (t) => {
      calm = busy.has(m.st.crit.c[0]!.fsm) ? 0 : calm + 1;
      if (calm === 30 && pokes < 4 && t > 200) m.addPoke({ tick: m.tick + 1, seq: ++pokes, partId: thud, kind: 'impulse', data: [0, 28, 0] });
    });
    const flaps = ev.filter((e) => e.kind === 'CritterState' && e.part === henny && e.mag === fsm('flap'));
    expect(flaps).toHaveLength(4);
    const lays = of(ev, 'Lay', henny);
    expect(lays.map((e) => e.mag)).toEqual([1, 2]);
    expect(lays[1]!.tick - lays[0]!.tick).toBeGreaterThanOrEqual(6 * 120);
    // the second fright came inside the 6 s cooldown: a flap without an egg; the fourth found the pool empty
    expect(flaps[1]!.tick).toBeLessThan(lays[0]!.tick + 6 * 120);
    expect(flaps[3]!.tick).toBeGreaterThan(lays[1]!.tick);
    expect(eggs(m, henny).map((bi) => at(m, bi)[1] > -1)).toEqual([true, true]);
    m.destroy();
  }, 30_000);

  it('eggs: 0 → she still flaps but lays nothing', async () => {
    const { m, henny, ev } = await startles([60], { eggs: 0 });
    expect(states(ev, henny)).toContain('flap');
    expect(of(ev, 'Lay')).toHaveLength(0);
    expect(eggs(m, henny)).toHaveLength(0);
    m.destroy();
  }, 30_000);

  it('trapped in a TRAP BOX she startles with a feather puff, but never flaps or lays (D14)', async () => {
    const b = new Build();
    const henny = b.add('henny', 0, 0, 0);
    b.add('trap_box', 0, 0.02, 0);
    const thud = b.add('thud', 2.5, 0.11, 0);
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 120, seq: 1, partId: thud, kind: 'impulse', data: [0, 28, 0] });
    const ev = run(m, 600);
    expect(cstate(m, henny).flags & CritterFlagBits.trapped).toBe(CritterFlagBits.trapped);
    const seq = states(ev, henny);
    expect(seq).toContain('startled');
    expect(seq).not.toContain('flap');
    expect(emotes(ev, henny)).toContain('feather');
    expect(of(ev, 'Lay')).toHaveLength(0);
    expect(Math.max(...[pose(m, henny).p[1]])).toBeLessThan(0.1);
    m.destroy();
  }, 30_000);

  it('an egg laid off a high LEDGE splats on the floor (≥ 0.3 N·s); a blast splats a resting one', async () => {
    const b = new Build();
    b.add('ledge', 0, 1.5, 0);
    const henny = b.add('henny', 0.15, 1.55, 0, {}, undefined);
    b.add('thud', -0.12, 1.9, 0);
    const m = new Machine(await jolt(), b);
    const ev = run(m, 6 * 120);
    const lay = of(ev, 'Lay', henny)[0]!;
    expect(lay.pos[1]).toBeGreaterThan(2.4);
    const splat = of(ev, 'Splat', henny);
    expect(splat).toHaveLength(1);
    expect(splat[0]!.mag).toBeGreaterThanOrEqual(0.3);
    expect(splat[0]!.pos[1]).toBeLessThan(0.1);
    expect(at(m, eggs(m, henny)[0]!)[1]).toBeLessThan(-25); // a splatted egg leaves play (parked, dormant)
    m.destroy();
    // blast
    const c = new Build();
    const h2 = c.add('henny', 0, 0, 0);
    c.add('thud', 0.8, 0.35, 0);
    const ringer = c.add('ringer', 3, 0, 3, { time: 5 });
    const stick = c.add('bangstick', -0.5, 0.039, 0.6);
    c.link('cable_signal', ringer, 'out', stick, 'detonator');
    const m2 = new Machine(await jolt(), c);
    const ev2 = run(m2, 8 * 120);
    expect(of(ev2, 'Lay', h2)[0]!.tick).toBeLessThan(5 * 120);
    const boom = of(ev2, 'Detonate')[0]!;
    expect(boom).toBeDefined();
    const s2 = of(ev2, 'Splat', h2);
    expect(s2).toHaveLength(1);
    expect(s2[0]!.cause).toBe(boom.id);
    expect(s2[0]!.tick).toBe(boom.tick);
    m2.destroy();
  }, 60_000);
});

// ---- DUSTY ------------------------------------------------------------------------------------------------------

describe('DUSTY', () => {
  it('stays inside its zone (props), turning back at the edges', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, 0, { zone_w: 1.2, zone_d: 0.8, zone_x: 0.3, zone_z: 0 });
    const m = new Machine(await jolt(), b);
    let out = 0;
    const ev = run(m, 40 * 120, () => {
      const p = pose(m, dusty).p;
      if (Math.abs(p[0] - 0.3) > 0.6 + 0.08 || Math.abs(p[2]) > 0.4 + 0.08) out++;
    });
    expect(out).toBe(0);
    expect(states(ev, dusty).filter((s) => s === 'bump_turn').length).toBeGreaterThan(3);
    m.destroy();
  }, 60_000);

  it('a quiet patrol stint (25–45 s) ends in a scan and a nap, then it patrols again', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, 0);
    const m = new Machine(await jolt(), b);
    let asleep = 0;
    const ev = run(m, 70 * 120, () => { if (cstate(m, dusty).flags & CritterFlagBits.asleep) asleep++; });
    const seq = states(ev, dusty).filter((s) => s !== 'bump_turn' && s !== 'patrol');
    expect(seq.slice(0, 2)).toEqual(['scan', 'sleep']);
    expect(asleep).toBeGreaterThanOrEqual(6 * 120);
    expect(asleep).toBeLessThanOrEqual(12 * 120 + 1);
    expect(states(ev, dusty).at(-1)).not.toBe('sleep');
    m.destroy();
  }, 30_000);

  it('beelines to grains, vacuums them (bin fills: heavier, slower, bin cells lit) until bin_full → sleep; parts are never taken', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, 0, { zone_w: 3, zone_d: 3 });
    const stitch = b.add('stitch', 0.6, 0.0375, -0.6);
    // stand-in grain patches (MachineOptions.extraLures: tests and soaks; real grains come through machine.matter)
    const lures: ExtraLure[] = [[0.7, 0.5], [-0.8, 0.6], [0.5, -0.9], [-0.6, -0.7], [0, 1.1], [1.1, 0], [-1.1, 0]].map(([x, z]) => ({ pos: [x!, 0, z!], radius: 1.5, species: { dusty: 1 } }));
    const m = new Machine(await jolt(), b, { extraLures: lures });
    const m0 = massOf(m, dusty);
    let maxCells = 0, fullAt = -1;
    const ev = run(m, 70 * 120, (t) => {
      const s = cstate(m, dusty);
      maxCells = Math.max(maxCells, (s.flags >> CRITTER_BIN_SHIFT) & 7);
      if (fullAt < 0 && s.fsm === 'bin_full') fullAt = t;
    });
    const seq = states(ev, dusty);
    expect(seq).toContain('beeline');
    expect(seq).toContain('vacuum');
    expect(fullAt).toBeGreaterThan(0);
    expect(seq.at(-1)).toBe('sleep');
    expect(emotes(ev, dusty)).toEqual(expect.arrayContaining(['sparkle_clean', 'bin_full']));
    const bin = m.st.crit.m4![0]!.bin;
    expect(bin).toBeGreaterThan(1.8 - 0.001); // full: within 3 grains of 1.8 kg
    expect(bin).toBeLessThanOrEqual(1.8);
    expect(massOf(m, dusty)).toBeCloseTo(m0 + bin, 3);
    expect(maxCells).toBe(5);
    expect(m.st.alive[idx(m, stitch)]).toBe(true); // never sucks parts
    expect(cstate(m, dusty).flags & CritterFlagBits.sucking).toBe(0);
    m.destroy();
  }, 60_000);

  it('vacuums real Matter grains through machine.matter.intake (sand and marbles, never water); the bin adds mass', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, -0.6);
    const anchor = b.add('ledge', 2.5, 0, 2.5);
    const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: new FakeMatter() } });
    const ai = idx(m, anchor);
    m.matter.emit(ai, 0, 3000, [-2.5, 0.01, -2.5], [0, 0, 0], 0.1); // sand, 0.6 m ahead of Dusty
    m.matter.emit(ai, 2, 40, [-2.5, 0.01, -2.5], [0, 0, 0], 0.1); // marbles
    m.matter.emit(ai, 1, 500, [-2.5, 0.01, -2.4], [0, 0, 0], 0.1); // water: not for Dusty
    const ev = run(m, 6 * 120);
    expect(states(ev, dusty)).toContain('vacuum');
    const x = m.st.crit.m4![0]!;
    expect(x.n).toBe(3040);
    const kg = 3000 * CRITTER_M4.dusty.grainKg[0] + 40 * CRITTER_M4.dusty.grainKg[2];
    expect(x.bin).toBeCloseTo(kg, 6);
    expect(massOf(m, dusty)).toBeCloseTo(3.2 + kg, 3);
    expect(m.matter.count(0)).toBe(0);
    expect(m.matter.count(1)).toBe(500);
    m.destroy();
  }, 30_000);

  it('a full bin (1.8 kg) closes the intake: bin_full → sleep, and the grains left stay put', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, -0.6);
    const anchor = b.add('ledge', 2.5, 0, 2.5);
    const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: new FakeMatter() } });
    m.matter.emit(idx(m, anchor), 0, 24000, [-2.5, 0.01, -2.5], [0, 0, 0], 0.12); // 2.1 kg of sand
    let fullAt = -1, left = -1;
    const ev = run(m, 12 * 120, (t) => {
      if (fullAt < 0 && cstate(m, dusty).fsm === 'bin_full') { fullAt = t; left = m.matter.count(0); }
    });
    expect(fullAt).toBeGreaterThan(0);
    expect(states(ev, dusty).at(-1)).toBe('sleep');
    expect(m.st.crit.m4![0]!.bin).toBeGreaterThan(1.8 - 0.001);
    expect(m.st.crit.m4![0]!.bin).toBeLessThanOrEqual(1.8);
    expect(m.matter.count(0)).toBe(left); // nothing more is taken (in-flight capacity was sized to the room left)
    expect(m.matter.count(0)).toBeGreaterThan(24000 - Math.ceil(1.8 / CRITTER_M4.dusty.grainKg[0]) - 1000);
    expect(cstate(m, dusty).flags & CritterFlagBits.sucking).toBe(0);
    m.destroy();
  }, 60_000);

  it('on MX’s CPU backend it vacuums a real sand pile (grains its bumper pushes are sucked in); water stays', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, -0.6);
    const anchor = b.add('ledge', 2.5, 0, 2.5);
    const m = new Machine(await jolt(), b, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 20000 } });
    const ai = idx(m, anchor);
    m.matter.emit(ai, 0, 1500, [-2.5, 0.01, -2.5], [0, 0, 0], 0.08); // a pile 0.6 m ahead
    m.matter.emit(ai, 1, 200, [-2.5 + 0.8, 0.01, -2.5 + 0.8], [0, 0, 0], 0.04); // a puddle off to the side
    const ev = run(m, 6 * 120);
    expect(states(ev, dusty)).toContain('vacuum');
    const x = m.st.crit.m4![0]!;
    expect(x.n).toBeGreaterThan(0.9 * 1500);
    expect(x.bin).toBeCloseTo(x.n * CRITTER_M4.dusty.grainKg[0], 6);
    expect(massOf(m, dusty)).toBeCloseTo(3.2 + x.bin, 3);
    expect(m.matter.count(0)).toBe(1500 - x.n);
    expect(m.matter.count(1)).toBe(200);
    m.destroy();
  }, 60_000);

  it('Matter vacuuming replays and survives a late-poke rollback across it (bin, mass and intake state restored)', async () => {
    const J = await jolt();
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, -1.0, { zone_d: 3.2 });
    const anchor = b.add('ledge', 2.5, 0, 2.5);
    const ball = b.add('stitch', 1.2, 0.04, 1.2);
    const make = (): Machine => {
      const m = new Machine(J, b, { simFlags: { matterGameplay: true }, matter: { backend: new MatterCpu(), capacity: 20000, checkpointEvery: 60 }, checkpointEvery: 60, keepCheckpoints: 16 });
      m.matter.emit(idx(m, anchor), 0, 1200, [-2.5, 0.01, -2.2], [0, 0, 0], 0.08);
      return m;
    };
    // where vacuuming starts depends on how soon Dusty finds the pile (matter.near(), M4): probe it, then put the
    // poke and the rollback window around that tick (orchestrator, after near() landed)
    let start = -1;
    {
      const m = make();
      while (m.tick < 900 && start < 0) { m.step(); m.drainEvents(); if (m.st.crit.m4![0]!.bin > 0) start = m.tick; }
      m.destroy();
    }
    expect(start).toBeGreaterThan(60);
    const pokeAt = Math.max(61, Math.floor((start - 30) / 60) * 60 + 1), lateAt = start + 90, until = Math.max(900, start + 480);
    const go = (late: boolean): { h: string[]; bin: number; mass: number } => {
      const m = make();
      const poke = { tick: pokeAt, seq: 1, partId: ball, kind: 'impulse' as const, data: [0.2, 0.3, 0] };
      if (!late) m.addPoke(poke);
      const h: string[] = [];
      while (m.tick < until) {
        m.step(); m.drainEvents();
        if (!late && m.tick === pokeAt) expect(m.st.crit.m4![0]!.bin).toBe(0);
        if (!late && m.tick === lateAt) expect(m.st.crit.m4![0]!.bin).toBeGreaterThan(0); // the rollback window spans the vacuuming
        if (late && m.tick === lateAt) {
          m.addPoke(poke);
          const back = m.restore(pokeAt);
          expect(back).toBeGreaterThan(0);
          expect(back).toBeLessThan(start);
          h.length = back / 60;
          while (m.tick < lateAt) { m.step(); m.drainEvents(); if (m.tick % 60 === 0) h.push(m.hash()); }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      const out = { h, bin: m.st.crit.m4![0]!.bin, mass: massOf(m, dusty) };
      m.destroy();
      return out;
    };
    const a = go(false);
    expect(a.bin).toBeGreaterThan(0.09); // nearly all 1,200 grains
    const c = go(true);
    expect(c.h).toEqual(a.h);
    expect(c.bin).toBe(a.bin);
    expect(c.mass).toBe(a.mass);
  }, 60_000);

  it('the bin’s mass is a pure function of its contents: a rollback mid-vacuum rejoins the straight run (critter soak seed 48)', async () => {
    // Jolt's ScaleToMass is relative: re-applied after a restore it rounded the inertia differently and the soak
    // desynced ~3 s later. setMass now scales from the built properties.
    const J = await jolt();
    const b = new Build();
    b.add('dusty', 0, 0, 0, { zone_w: 2.5, zone_d: 2.5 });
    const ball = b.add('stitch', 1.0, 0.04, -1.0);
    b.add('boing', -0.5, 0.12, 0.4);
    b.add('thud', 0.6, 0.11, 0.7);
    const lures: ExtraLure[] = [[0.6, 0.5], [-0.7, -0.6], [0.4, -0.8], [-0.5, 0.8]].map(([x, z]) => ({ pos: [x!, 0, z!], radius: 1.5, species: { dusty: 1 } }));
    const poke = { tick: 300, seq: 1, partId: ball, kind: 'impulse' as const, data: [0.1, 0.2, 0] };
    const go = (late: boolean): string[] => {
      const m = new Machine(J, b, { extraLures: lures, checkpointEvery: 60, keepCheckpoints: 16 });
      if (!late) m.addPoke(poke);
      const h: string[] = [];
      const base = m.bodies[m.bodyInfo().findIndex((x) => x.type === 'dusty' && x.role === 'base')]!.body;
      while (m.tick < 40 * 120) {
        m.step(); m.drainEvents();
        if (m.tick % 60 === 0) {
          // the mass properties themselves, bit for bit (Jolt's state doesn't carry them; hashes see them only later)
          const mp = base.GetMotionProperties(), d = mp.GetInverseInertiaDiagonal();
          h.push(`${mp.GetInverseMass()}:${d.GetX()}:${d.GetY()}:${d.GetZ()}`);
        }
        if (late && m.tick === 390) {
          expect(m.st.crit.m4![0]!.bin).toBeGreaterThan(0); // vacuuming across the rollback
          m.addPoke(poke);
          const back = m.restore(300);
          h.length = (back / 60) * 2;
          while (m.tick < 390) {
            m.step(); m.drainEvents();
            if (m.tick % 60 === 0) {
              const mp = base.GetMotionProperties(), d = mp.GetInverseInertiaDiagonal();
              h.push(`${mp.GetInverseMass()}:${d.GetX()}:${d.GetY()}:${d.GetZ()}`, m.hash());
            }
          }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      m.destroy();
      return h;
    };
    const a = go(false);
    expect(go(true)).toEqual(a);
  }, 60_000);

  it('tumbles as one rigid body on a 4 N·s poke (with its bin’s mass) and on running off a ledge; it always gets up', async () => {
    const b = new Build();
    const d1 = b.add('dusty', 0, 0, 0);
    b.add('ledge', 3, 0.4, 0);
    const d2 = b.add('dusty', 3, 0.45, 0, { zone_w: 3, zone_d: 3 }); // its zone runs past the ledge's edge
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 60, seq: 1, partId: d1, kind: 'impulse', data: [12, 6, 0] });
    const ev = run(m, 14 * 120);
    for (const d of [d1, d2]) {
      const r = of(ev, 'Ragdoll', d);
      expect(r.length, `${d}`).toBeGreaterThanOrEqual(1);
      const up = of(ev, 'Getup', d);
      expect(up.length).toBeGreaterThanOrEqual(1);
      expect(up[0]!.tick - r[0]!.tick, 'settled, not the 8 s forced recovery').toBeLessThan(8 * 120 - 1);
      const seq = states(ev, d);
      expect(seq.indexOf('getup')).toBeGreaterThan(seq.indexOf('ragdoll'));
      expect(seq).toContain('patrol');
    }
    expect(of(ev, 'Ragdoll', d1)[0]!.tick).toBe(60);
    expect(pose(m, d2).p[1]).toBeLessThan(0.05); // it ended up on the floor
    expect(finite(m)).toBe(true);
    m.destroy();
  }, 30_000);

  it('on a charge leash it works only while powered; it startles at 70 dB', async () => {
    const b = new Build();
    const dusty = b.add('dusty', 0, 0, 0);
    const mains = b.add('mains', -1, 0, -1, { on: 0 });
    b.link('cable_power', mains, 'out', dusty, 'charge');
    const ringer = b.add('ringer', -4, 0, -3, { time: 4 }); // its ring is 80 dB, under 70 dB by the time it reaches Dusty
    b.link('cable_signal', ringer, 'out', mains, 'in'); // switches MAINS on at 4 s
    const loud = b.add('thud', 0.7, 0.11, 0.7);
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 9 * 120, seq: 1, partId: loud, kind: 'impulse', data: [0, 30, 0] });
    const early = run(m, 3 * 120);
    expect(cstate(m, dusty).fsm).toBe('sleep');
    expect(Math.hypot(pose(m, dusty).p[0], pose(m, dusty).p[2])).toBeLessThan(0.02);
    const ev = run(m, 9 * 120);
    expect(states(ev, dusty)).toContain('patrol');
    expect(states(ev, dusty)).toContain('startled');
    void early;
    m.destroy();
  }, 30_000);
});

describe('TRAP BOX', () => {
  it('catches each M4 critter standing (Biscuit 0.62 m, Henny, Dusty’s 0.366 m disc): trapped flag, caught flag', async () => {
    for (const sp of ['biscuit', 'henny', 'dusty'] as const) {
      const b = new Build();
      const c = b.add(sp, 0, 0, 0);
      const box = b.add('trap_box', 0, 0.02, 0);
      const m = new Machine(await jolt(), b);
      const ev = run(m, 3 * 120);
      expect(of(ev, 'Trapped', c).length, sp).toBeGreaterThan(0);
      expect(cstate(m, c).flags & CritterFlagBits.trapped, sp).toBe(CritterFlagBits.trapped);
      expect(cstate(m, c).fsm, sp).toBe('trapped');
      expect(of(ev, 'Ragdoll', c), sp).toHaveLength(0);
      void box;
      m.destroy();
    }
  }, 30_000);
});

// ---- MOCHI flee(Biscuit) and determinism ------------------------------------------------------------------------

describe('M4 critters: flee(Biscuit), replay, rollback, hashes', () => {
  /** All three new critters, Mochi and Pip, eggs, grain patches, hazards and pokes. */
  const world = (): { b: Build; lures: ExtraLure[]; pokes: { tick: number; part: PartId; data: number[] }[]; ids: Record<string, PartId> } => {
    const b = new Build();
    const ids: Record<string, PartId> = {};
    ids.biscuit = b.add('biscuit', -0.8, 0, 0);
    ids.mochi = b.add('mochi', 0.9, 0, 1.4);
    ids.henny = b.add('henny', 1.2, 0, -0.6);
    ids.dusty = b.add('dusty', -0.3, 0, -1.4, { zone_w: 2.5, zone_d: 1.4 });
    ids.pip = b.add('pip', -1.5, 0, 1.2);
    ids.thud = b.add('thud', 0.2, 0.6, 0.1);
    ids.boing = b.add('boing', 0.4, 0.12, 0.8);
    b.add('stitch', -0.2, 0.04, 0.5);
    // at 7.5 s a BANGSTICK goes off beside Henny's first egg (it splats; she tumbles)
    const ringer = b.add('ringer', 3.5, 0, 3.5, { time: 7.5 });
    const stick = b.add('bangstick', 1.9, 0.039, -1.25);
    b.link('cable_signal', ringer, 'out', stick, 'detonator');
    const lures: ExtraLure[] = [{ pos: [0.6, 0, -1.2], radius: 1.5, species: { dusty: 1 } }, { pos: [-1.2, 0, -1.6], radius: 1.5, species: { dusty: 1 } }];
    // late versions of these roll back across the blast and splat, a lay, Dusty's tumble and Biscuit's tumble
    const pokes = [
      { tick: 880, part: ids.boing!, data: [0.3, 0.6, 0] },
      { tick: 1400, part: ids.henny!, data: [0.5, 0.4, 0] },
      { tick: 1990, part: ids.boing!, data: [-0.3, 0.6, 0.2] },
      { tick: 2100, part: ids.dusty!, data: [9, 4, 0] },
      { tick: 2600, part: ids.biscuit!, data: [60, 30, 0] },
    ];
    return { b, lures, pokes, ids };
  };

  it('replays identically and survives late-poke rollbacks across barks, eggs, vacuuming and tumbles', async () => {
    const J = await jolt();
    const { b, lures, pokes } = world();
    const opts: MachineOptions = { extraLures: lures, checkpointEvery: 60, keepCheckpoints: 16 };
    const go = (late: number): string[] => {
      const m = new Machine(J, b, opts);
      pokes.forEach((p, i) => { if (i !== late) m.addPoke({ tick: p.tick, seq: i + 1, partId: p.part, kind: 'impulse', data: p.data }); });
      const h: string[] = [];
      const lp = late >= 0 ? pokes[late]! : null;
      while (m.tick < 3600) {
        m.step(); m.drainEvents();
        if (lp && m.tick === lp.tick + 90) {
          m.addPoke({ tick: lp.tick, seq: late + 1, partId: lp.part, kind: 'impulse', data: lp.data });
          const was = m.tick;
          const back = m.restore(lp.tick);
          expect(back).toBeGreaterThan(0);
          h.length = back / 60;
          while (m.tick < was) { m.step(); m.drainEvents(); if (m.tick % 60 === 0) h.push(m.hash()); }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      m.destroy();
      return h;
    };
    const a = go(-1);
    expect(go(-1)).toEqual(a);
    // the straight run has every M4 mechanism in it
    const m = new Machine(J, b, opts);
    pokes.forEach((p, i) => m.addPoke({ tick: p.tick, seq: i + 1, partId: p.part, kind: 'impulse', data: p.data }));
    const ev = run(m, 3600);
    m.destroy();
    for (const k of ['Bark', 'Lay', 'Splat', 'Detonate', 'Ragdoll', 'Getup'] as const) expect(of(ev, k).length, k).toBeGreaterThan(0);
    expect(ev.some((e) => e.kind === 'CritterState' && e.mag === fsm('vacuum'))).toBe(true);
    for (let late = 0; late < pokes.length; late++) expect(go(late), `late poke ${late}`).toEqual(a);
  }, 120_000);

  it('the world hashes cover the M4 state: part order doesn’t matter, the seed does; checkpoints transfer', async () => {
    const J = await jolt();
    const { b, lures } = world();
    const h = (parts: typeof b.parts, seed?: readonly [number, number]): string[] => {
      const m = new Machine(J, { parts, links: b.links }, { extraLures: lures, ...(seed ? { seed } : {}) });
      const out = trace(m, 1200, { hashEvery: 120 }).hashes;
      m.destroy();
      return out;
    };
    const h1 = h(b.parts);
    expect(h([...b.parts].reverse())).toEqual(h1);
    expect(h(b.parts, [7, 9])).not.toEqual(h1);
    const a = new Machine(J, b, { extraLures: lures });
    run(a, 1500);
    const cp = a.exportCheckpoint(a.tick)!;
    const c = new Machine(J, b, { extraLures: lures });
    c.importCheckpoint(cp.blob);
    while (c.tick < a.tick) { c.step(); c.drainEvents(); }
    for (let t = 0; t < 600; t++) { a.step(); a.drainEvents(); c.step(); c.drainEvents(); }
    expect(c.hash()).toBe(a.hash());
    a.destroy(); c.destroy();
  }, 60_000);

  it('a minute with the new cast: finite, on the floor, every tumble recovered, Mochi flees Biscuit', async () => {
    const J = await jolt();
    const { b, lures, pokes, ids } = world();
    const m = new Machine(J, b, { extraLures: lures });
    pokes.forEach((p, i) => m.addPoke({ tick: p.tick, seq: i + 1, partId: p.part, kind: 'impulse', data: p.data }));
    const open = new Map<number, number>();
    const ev = run(m, 60 * 120, (t) => {
      if (t % 120 !== 0) return;
      const tr = m.transforms(new Float32Array(m.bodies.length * 7));
      const info = m.bodyInfo();
      for (let i = 0; i < info.length; i++) {
        expect(Number.isFinite(tr[i * 7]! + tr[i * 7 + 1]! + tr[i * 7 + 2]!)).toBe(true);
        if (info[i]!.role === 'chunk' || info[i]!.role === 'piece') continue; // pooled eggs park 30 m down
        expect(tr[i * 7 + 1]!).toBeGreaterThan(-0.25);
      }
    });
    for (const e of ev) {
      if (e.kind === 'Ragdoll') { expect(open.has(e.part)).toBe(false); open.set(e.part, e.tick); }
      if (e.kind === 'Getup') { expect(e.tick - open.get(e.part)!).toBeLessThanOrEqual(8 * 120 + 1); open.delete(e.part); }
    }
    for (const t0 of open.values()) expect(60 * 120 - t0).toBeLessThan(9 * 120);
    expect(of(ev, 'Bark', ids.biscuit).length).toBeGreaterThan(0);
    expect(emotes(ev, ids.mochi!)).toContain('dog_alert');
    m.destroy();
  }, 120_000);
});
