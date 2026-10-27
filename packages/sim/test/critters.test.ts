// Critters (SIMULATION §7, GAME_SPEC §11, stream B): the contract-3 data, the critter framework in the
// Machine (bodies, ragdoll and recovery, blasts, pokes, rollback, hashing, critterState) and the golden
// demo machines of the four critters and their four devices. The goldens' final hashes are pinned; they
// also depend on stream A's Sound levels (critters hear impacts), so re-pin with `vitest -u` when those
// are retuned, keeping the behaviour assertions.

import { describe, expect, it } from 'vitest';
import type { PartId } from '@knockon/format';
import {
  BANDIT_PROP_R, CARDS, CRITTER_CLIPS, CRITTER_EMOTES, CRITTER_FSM, CRITTER_PARTS, CRITTER_SPECS, CritterFlagBits, DeviceFlagBits, PARTS, partDef,
  type CritterFsm, type Species,
} from '@knockon/parts-data';
import { DEMOS } from '../../parts-data/src/demos.ts';
import { Machine, type EventKind, type ExtraLure, type SimEvent } from '../src/index.ts';
import { Build, jolt, pose, rotate, trace, type Trace } from './harness.ts';

const SPECIES: readonly Species[] = ['mochi', 'pip', 'goby', 'bandit', 'biscuit', 'henny', 'dusty', /* M5 (B5) */ 'buzz'];
const DEVICES = ['hamster_drive', 'pedal_rig', 'fishbowl', 'trap_box'] as const;
const fsm = (s: CritterFsm): number => CRITTER_FSM.indexOf(s);
const states = (ev: readonly SimEvent[], part: PartId): string[] => ev.filter((e) => e.kind === 'CritterState' && e.part === part).map((e) => CRITTER_FSM[e.mag]!);
const of = (ev: readonly SimEvent[], kind: EventKind, part?: PartId): SimEvent[] => ev.filter((e) => e.kind === kind && (part === undefined || e.part === part));
const idx = (m: Machine, id: PartId): number => m.parts.findIndex((p) => p.id === id);
const cstate = (m: Machine, id: PartId): { clip: string; flags: number; emote: string; fsm: string } => {
  const b = m.critterState(new Uint8Array(m.parts.length * 4));
  const o = idx(m, id) * 4;
  return { clip: CRITTER_CLIPS[b[o]!]!, flags: b[o + 1]!, emote: CRITTER_EMOTES[b[o + 2]!]!, fsm: CRITTER_FSM[b[o + 3]!]! };
};
const finite = (m: Machine): boolean => m.transforms(new Float32Array(m.bodies.length * 7)).every((v) => Number.isFinite(v));

describe('critter data (contract 3)', () => {
  it('name tables are unique; emote 0 is none', () => {
    expect(new Set(CRITTER_CLIPS).size).toBe(CRITTER_CLIPS.length);
    expect(new Set(CRITTER_EMOTES).size).toBe(CRITTER_EMOTES.length);
    expect(new Set(CRITTER_FSM).size).toBe(CRITTER_FSM.length);
    expect(CRITTER_EMOTES[0]).toBe('none');
    expect(CRITTER_CLIPS.length).toBeLessThan(256);
  });

  it('ragdolls match the briefs: bone counts, masses, parents, capsule sizes', () => {
    const want: Record<Species, { bones: number; mass: number }> = {
      mochi: { bones: 15, mass: 4.0 }, pip: { bones: 7, mass: 0.12 }, goby: { bones: 4, mass: 0.03 }, bandit: { bones: 14, mass: 5.5 },
      biscuit: { bones: 15, mass: 12 }, henny: { bones: 10, mass: 1.6 }, dusty: { bones: 1, mass: 3.2 }, buzz: { bones: 1, mass: 1.1 },
    };
    for (const sp of SPECIES) {
      const s = CRITTER_SPECS[sp];
      expect(s.ragdoll.length, sp).toBe(want[sp].bones);
      expect(s.ragdoll.reduce((a, b) => a + b.mass, 0), sp).toBeCloseTo(want[sp].mass, 6);
      expect(s.mass, sp).toBeCloseTo(want[sp].mass, 6);
      expect(s.ragdoll[0]!.parent, sp).toBe(-1);
      s.ragdoll.forEach((b, i) => {
        expect(b.bone.startsWith('RAG__'), `${sp} ${b.bone}`).toBe(true);
        if (i > 0) { expect(b.parent).toBeGreaterThanOrEqual(0); expect(b.parent).toBeLessThan(i); }
        expect(b.halfHeight).toBeGreaterThan(0);
        expect(2 * b.radius, `${sp} ${b.bone} ≥ 5 mm thick`).toBeGreaterThanOrEqual(sp === 'pip' ? 0.008 : 0.005);
        expect(Math.hypot(...b.rot)).toBeCloseTo(1, 5);
        // the capsule's +Y runs from a to b
        const [x, y, z, w] = b.rot;
        const dir = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
        const ab = [b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]];
        const l = Math.hypot(...ab);
        for (let k = 0; k < 3; k++) expect(dir[k]!).toBeCloseTo(ab[k]! / l, 4);
      });
      expect(s.clips.every((c) => (CRITTER_CLIPS as readonly string[]).includes(c)), sp).toBe(true);
      expect(s.emotes.every((e) => (CRITTER_EMOTES as readonly string[]).includes(e)), sp).toBe(true);
    }
  });

  it('every critter fits the TRAP BOX interior (0.66 × 0.46 × 0.46 m)', () => {
    for (const sp of SPECIES) {
      const b = partDef(sp)!.bounds;
      const len = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
      const wid = Math.min(b.max[0] - b.min[0], b.max[2] - b.min[2]);
      expect(len, sp).toBeLessThanOrEqual(0.72); // Bandit's tail curls round his feet in `trapped`
      expect(wid, sp).toBeLessThanOrEqual(0.46);
      expect(b.max[1] - b.min[1], sp).toBeLessThanOrEqual(0.46);
    }
  });

  it('critter parts and devices are parts with cards and demos', () => {
    for (const t of [...SPECIES, ...DEVICES]) {
      const d = partDef(t);
      expect(d, t).toBeDefined();
      expect(PARTS.includes(d!)).toBe(true);
      expect(CARDS[t], t).toBeDefined();
      expect(DEMOS[t], t).toBeDefined();
    }
    for (const d of CRITTER_PARTS) { expect(d.family).toBe('critters'); expect(d.critter?.species).toBe(d.type); }
  });
});

describe('critters in the Machine', () => {
  it('each critter has an upright base capsule and dormant RAG__ capsules (no bodies made during a run)', async () => {
    const b = new Build();
    const ids = SPECIES.map((sp, i) => b.add(sp, -1.5 + i, 0, 0));
    const m = new Machine(await jolt(), b);
    const info = m.bodyInfo();
    const count = info.length;
    for (const [i, sp] of SPECIES.entries()) {
      const mine = info.filter((x) => x.part === ids[i]);
      expect(mine.filter((x) => x.role === 'base')).toHaveLength(1);
      const rags = mine.filter((x) => x.role === 'rag');
      expect(rags.map((x) => x.bone)).toEqual(CRITTER_SPECS[sp].ragdoll.map((r) => r.bone));
    }
    const t0 = m.transforms(new Float32Array(count * 7));
    trace(m, 240);
    expect(m.bodies.length).toBe(count);
    const t1 = m.transforms(new Float32Array(count * 7));
    info.forEach((x, i) => {
      if (x.role !== 'rag') return;
      for (let k = 0; k < 7; k++) expect(t1[i * 7 + k]).toBe(t0[i * 7 + k]); // dormant: they never moved
    });
    // the base capsules stay upright (rotation locked about X and Z)
    for (const id of ids) {
      const q = pose(m, id).q;
      expect(Math.abs(q[0]) + Math.abs(q[2])).toBeLessThan(1e-3);
    }
    m.destroy();
  }, 30_000);

  it('a THUD dropped on Mochi ragdolls her; she recovers to getup → dizzy and stands upright again', async () => {
    const b = new Build();
    const mochi = b.add('mochi', 0, 0, 0);
    b.add('thud', 0, 1.4, 0.02);
    const m = new Machine(await jolt(), b);
    const tr = trace(m, 9 * 120);
    const rag = of(tr.events, 'Ragdoll', mochi);
    const up = of(tr.events, 'Getup', mochi);
    expect(rag).toHaveLength(1);
    expect(rag[0]!.mag).toBeGreaterThanOrEqual(3);
    expect(up).toHaveLength(1);
    expect(up[0]!.tick - rag[0]!.tick).toBeGreaterThanOrEqual(120); // 1 s still, at least
    expect(up[0]!.tick - rag[0]!.tick).toBeLessThanOrEqual(8 * 120 + 1);
    expect(up[0]!.cause).toBe(rag[0]!.id);
    const seq = states(tr.events, mochi);
    expect(seq.indexOf('ragdoll')).toBeLessThan(seq.indexOf('getup'));
    expect(seq.indexOf('getup')).toBeLessThan(seq.indexOf('dizzy'));
    expect(finite(m)).toBe(true);
    const s = cstate(m, mochi);
    expect(s.flags & CritterFlagBits.ragdoll).toBe(0);
    const p = pose(m, mochi);
    expect(Math.abs(p.p[1])).toBeLessThan(0.05); // standing on the floor
    expect(Math.abs(p.q[0]) + Math.abs(p.q[2])).toBeLessThan(1e-3);
    m.destroy();
  }, 30_000);

  it('critters inside a blast ragdoll, caused by the Detonate; Pip is thrown out of his wheel', async () => {
    const b = new Build();
    const mochi = b.add('mochi', 0.6, 0, 0);
    b.add('hamster_drive', -0.5, 0, 0);
    const pip = b.add('pip', -0.5, 0.042, -0.005);
    const button = b.add('the_button', 0, 0, 0.8);
    b.add('thud', 0, 0.4, 0.8);
    const stick = b.add('bangstick', 0, 0.039, 0);
    b.link('cable_signal', button, 'out', stick, 'detonator');
    const m = new Machine(await jolt(), b);
    expect(cstate(m, pip).flags & CritterFlagBits.inDevice).toBe(CritterFlagBits.inDevice);
    const tr = trace(m, 10 * 120);
    const boom = of(tr.events, 'Detonate')[0]!;
    for (const id of [mochi, pip]) {
      const r = of(tr.events, 'Ragdoll', id)[0];
      expect(r, `${id}`).toBeDefined();
      expect(r!.tick).toBe(boom.tick);
      expect(r!.cause).toBe(boom.id);
      expect(of(tr.events, 'Getup', id)).toHaveLength(1);
    }
    expect(cstate(m, pip).flags & CritterFlagBits.inDevice).toBe(0);
    expect(finite(m)).toBe(true);
    m.destroy();
  }, 30_000);

  it('pokes: a strong one tumbles a critter, a weak one only nudges it', async () => {
    const b = new Build();
    const a = b.add('bandit', -1, 0, 0);
    const c = b.add('bandit', 1, 0, 0);
    const m = new Machine(await jolt(), b);
    m.addPoke({ tick: 10, seq: 1, partId: a, kind: 'impulse', data: [20, 10, 0] });
    m.addPoke({ tick: 10, seq: 2, partId: c, kind: 'impulse', data: [1, 0.5, 0] });
    const tr = trace(m, 120);
    expect(of(tr.events, 'Ragdoll', a)).toHaveLength(1);
    expect(of(tr.events, 'Ragdoll', c)).toHaveLength(0);
    m.destroy();
  }, 30_000);

  it('rollback mid-ragdoll and checkpoint transfer reproduce the same future (critter state is in st)', async () => {
    const b = new Build();
    b.add('mochi', 0, 0, 0);
    b.add('thud', 0, 1.4, 0.02);
    const pip = b.add('pip', 0.9, 0, 0.6);
    b.add('fishbowl', -0.8, 0, 0.3);
    b.add('goby', -0.8, 0.13, 0.3);
    const poke = { tick: 200, seq: 1, partId: pip, kind: 'impulse' as const, data: [0.4, 0.3, 0] };
    const J = await jolt();
    const a = new Machine(J, b);
    a.addPoke(poke);
    const ha: string[] = [];
    for (let t = 1; t <= 900; t++) { a.step(); a.drainEvents(); if (t % 60 === 0) ha.push(a.hash()); }
    const c = new Machine(J, b);
    for (let t = 0; t < 260; t++) { c.step(); c.drainEvents(); }
    c.addPoke(poke); // late: rolls back across Mochi's ragdoll
    const back = c.restore(200);
    expect(back).toBeLessThanOrEqual(200);
    const hc: string[] = ha.slice(0, back / 60);
    while (c.tick < 900) { c.step(); c.drainEvents(); if (c.tick % 60 === 0) hc.push(c.hash()); }
    expect(hc).toEqual(ha);
    // desync repair: a fresh machine adopts c's checkpoint and continues identically
    const cp = c.exportCheckpoint(c.tick)!;
    const d = new Machine(J, b);
    d.importCheckpoint(cp.blob);
    expect(d.tick).toBe(cp.tick);
    for (let t = 0; t < 120; t++) { c.step(); d.step(); }
    expect(d.hash()).toBe(c.hash());
    a.destroy(); c.destroy(); d.destroy();
  }, 60_000);

  it('hashes cover critter state: same world in any part order → same hashes; different seed → different', async () => {
    const b = new Build();
    b.add('mochi', 0, 0, -0.5);
    b.add('pip', 0, 0, 1.2);
    b.add('bandit', 1.2, 0, 0);
    const J = await jolt();
    const run = (parts: typeof b.parts, seed?: readonly [number, number]): string[] => {
      const m = new Machine(J, { parts, links: [] }, seed ? { seed } : {});
      const h = trace(m, 600, { hashEvery: 60 }).hashes;
      m.destroy();
      return h;
    };
    const h1 = run(b.parts);
    expect(run([...b.parts].reverse())).toEqual(h1);
    expect(run(b.parts, [1, 2])).not.toEqual(h1); // idle variety comes from the critter:<id> streams
  }, 60_000);

  it('a minute with all four critters, devices, blasts and pokes stays finite, in the world and recovers every tumble', async () => {
    const b = new Build();
    b.add('mochi', 0.3, 0, -0.4);
    b.add('pip', -0.6, 0, 0.9);
    b.add('hamster_drive', -1.5, 0, 0);
    b.add('pip', -1.5, 0.042, -0.005);
    b.add('fishbowl', 1.5, 0, 0.5);
    b.add('goby', 1.5, 0.13, 0.5);
    b.add('pedal_rig', 0, 0, 1.8);
    b.add('bandit', 0.8, 0, 1.2);
    for (const [x, z, f] of [[-0.8, -1.2, 2], [1.0, -0.8, 6], [0.2, 0.5, 11]] as const) {
      const stick = b.add('bangstick', x, 0.039, z, { fuse: f > 5 ? 5 : f });
      const wick = b.add('wick', x + (f > 5 ? 1.2 : 0.5), 0, z);
      b.link('fuse', wick, 'flame', stick, 'fuse');
    }
    b.add('thud', 0.3, 2.5, -0.4);
    b.add('boing', -0.6, 1.5, 0.9);
    const m = new Machine(await jolt(), b);
    const crit = m.parts.filter((p) => p.def.critter).map((p) => p.id);
    for (let k = 0; k < 6; k++) m.addPoke({ tick: 300 + k * 900, seq: k + 1, partId: crit[k % crit.length]!, kind: 'impulse', data: [8, 6, -4] });
    const open = new Map<number, number>();
    for (let t = 1; t <= 60 * 120; t++) {
      m.step();
      for (const e of m.drainEvents()) {
        if (e.kind === 'Ragdoll') { expect(open.has(e.part)).toBe(false); open.set(e.part, e.tick); }
        if (e.kind === 'Getup') { expect(e.tick - open.get(e.part)!).toBeLessThanOrEqual(8 * 120 + 1); open.delete(e.part); }
      }
      if (t % 120 === 0) {
        const tr = m.transforms(new Float32Array(m.bodies.length * 7));
        const roles = m.bodyInfo();
        for (let i = 0; i < m.bodies.length; i++) {
          expect(Number.isFinite(tr[i * 7]! + tr[i * 7 + 1]! + tr[i * 7 + 2]!)).toBe(true);
          // fracture chunks keep the part's origin (their hull is in part space), so a flipped shard's origin may sit
          // below the floor while the shard rests on it; their centres are checked in fracture.test.ts
          if (roles[i]!.role === 'chunk') continue;
          expect(tr[i * 7 + 1]!).toBeGreaterThan(-0.25);
        }
      }
    }
    for (const at of open.values()) expect(60 * 120 - at).toBeLessThan(9 * 120);
    m.destroy();
  }, 120_000);
});

// ---- goldens ------------------------------------------------------------------------------------------

interface G { m: Machine; tr: Trace; hash: string; id(type: string, n?: number): PartId }

async function golden(key: string, spin: readonly string[] = []): Promise<G> {
  const demo = DEMOS[key]!;
  const J = await jolt();
  const ids = (type: string): PartId[] => demo.parts.filter((p) => p.type === type).map((p) => p.id);
  const spins = demo.parts.filter((p) => spin.includes(p.type)).map((p) => [p.id, 2] as const);
  const once = (): { m: Machine; tr: Trace } => {
    const m = new Machine(J, demo);
    return { m, tr: trace(m, demo.ticks, { track: demo.parts.map((p) => p.id), spin: spins }) };
  };
  const a = once(), b = once();
  expect(b.tr.hashes).toEqual(a.tr.hashes);
  b.m.destroy();
  return { m: a.m, tr: a.tr, hash: a.tr.hashes.at(-1)!, id: (type, n = 0) => ids(type)[n]! };
}

const moved = (tr: Trace, id: PartId): number => { const p = tr.path.get(id)!; const s = p[0]!, e = p.at(-1)!; return Math.hypot(e[0] - s[0], e[2] - s[2]); };

describe('golden machines (critters and their devices)', () => {
  it('mochi: smells Pip, chases and pounces', async () => {
    const g = await golden('mochi');
    const mochi = g.id('mochi');
    const seq = states(g.tr.events, mochi);
    expect(seq).toContain('chase');
    expect(seq).toContain('pounce');
    const z = g.tr.path.get(mochi)!.map((p) => p[2]);
    expect(z.at(-1)! - z[0]!).toBeGreaterThan(1.5); // she covered the gap
    expect(states(g.tr.events, g.id('pip'))).toContain('flee');
    expect(finite(g.m)).toBe(true);
    expect(g.hash).toMatchInlineSnapshot(`"1ab8f1900ecdc42e"`);
    g.m.destroy();
  }, 30_000);

  it('pip: Mochi inside 2.5 m, he flees', async () => {
    const g = await golden('pip');
    const pip = g.id('pip');
    expect(states(g.tr.events, pip)[0]).toBe('flee');
    expect(of(g.tr.events, 'Emote', pip)[0]!.mag).toBe(CRITTER_EMOTES.indexOf('cat_alert'));
    expect(Math.max(...g.tr.path.get(pip)!.map((p) => p[2]))).toBeGreaterThan(1.2);
    expect(g.hash).toMatchInlineSnapshot(`"051ac5aa3b06c862"`);
    g.m.destroy();
  }, 30_000);

  it('goby: the THUD breaks the bowl, Goby tumbles out (ragdoll) and flops', async () => {
    const g = await golden('goby');
    const goby = g.id('goby'), bowl = g.id('fishbowl');
    const brk = of(g.tr.events, 'Break', bowl)[0]!;
    expect(brk).toBeDefined();
    expect(of(g.tr.events, 'Splash', bowl)[0]!.cause).toBe(brk.id);
    const rag = of(g.tr.events, 'Ragdoll', goby)[0]!;
    expect(rag.tick).toBe(brk.tick);
    expect(states(g.tr.events, goby)).toContain('flop');
    expect(cstate(g.m, goby).clip).toBe('flop');
    expect(g.hash).toMatchInlineSnapshot(`"262bf5ec478feca8"`);
    g.m.destroy();
  }, 30_000);

  it('bandit: the blast’s noise reaches his rig; he runs over, mounts and pedals', async () => {
    const g = await golden('bandit');
    const bandit = g.id('bandit');
    const seq = states(g.tr.events, bandit);
    expect(seq.slice(0, 3)).toEqual(['goto_rig', 'pedal_mount', 'pedal']);
    const s = cstate(g.m, bandit);
    expect(s.fsm).toBe('pedal');
    expect(s.flags & CritterFlagBits.inDevice).toBe(CritterFlagBits.inDevice);
    const rig = g.m.critterState(new Uint8Array(g.m.parts.length * 4));
    expect(rig[idx(g.m, g.id('pedal_rig')) * 4 + 1]! & DeviceFlagBits.running).toBe(DeviceFlagBits.running);
    expect(g.hash).toMatchInlineSnapshot(`"8bdb02f087f1bad1"`);
    g.m.destroy();
  }, 30_000);

  it('hamster_drive: the BOING bumps the wheel, Pip startles and sprints, the band turns the COG', async () => {
    const g = await golden('hamster_drive', ['cog']);
    const pip = g.id('pip');
    expect(states(g.tr.events, pip).slice(0, 2)).toEqual(['wheel_startled', 'wheel_sprint']);
    expect(Math.abs(g.tr.spin.get(g.id('cog'))!)).toBeGreaterThan(4);
    const s = cstate(g.m, pip);
    expect(s.clip).toBe('wheel_sprint');
    const dev = g.m.critterState(new Uint8Array(g.m.parts.length * 4));
    const o = idx(g.m, g.id('hamster_drive')) * 4;
    expect(dev[o + 1]! & DeviceFlagBits.running).toBe(DeviceFlagBits.running);
    expect(dev[o]!).toBeGreaterThan(0); // seconds left on the sprint
    expect(g.hash).toMatchInlineSnapshot(`"117d3274fd2f2051"`);
    g.m.destroy();
  }, 30_000);

  it('pedal_rig: the blast startles the lounging Bandit into pedalling; the band turns the COG', async () => {
    const g = await golden('pedal_rig', ['cog']);
    const bandit = g.id('bandit');
    const boom = of(g.tr.events, 'Detonate')[0]!;
    const ped = g.tr.events.find((e) => e.kind === 'CritterState' && e.part === bandit && e.mag === fsm('pedal'))!;
    expect(ped.tick - boom.tick).toBeLessThanOrEqual(2);
    expect(Math.abs(g.tr.spin.get(g.id('cog'))!)).toBeGreaterThan(20);
    expect(g.hash).toMatchInlineSnapshot(`"20d52ecf68e80cc0"`);
    g.m.destroy();
  }, 30_000);

  it('fishbowl: the THUD rolls off the SLOPE into the bowl, which breaks; Goby flops', async () => {
    const g = await golden('fishbowl');
    expect(of(g.tr.events, 'Break', g.id('fishbowl'))).toHaveLength(1);
    expect(states(g.tr.events, g.id('goby'))).toContain('flop');
    expect(g.hash).toMatchInlineSnapshot(`"1aa957113eb40e09"`);
    g.m.destroy();
  }, 30_000);

  it('trap_box: the SNIPPER cuts the LINE, the cage drops and Mochi is trapped (flag up)', async () => {
    const g = await golden('trap_box');
    const mochi = g.id('mochi'), box = g.id('trap_box');
    const cut = of(g.tr.events, 'Cut')[0]!;
    const trap = of(g.tr.events, 'Trapped', mochi)[0]!;
    expect(trap.tick).toBeGreaterThan(cut.tick);
    expect(trap.other).toBe(box);
    const s = cstate(g.m, mochi);
    expect(s.fsm).toBe('trapped');
    expect(s.flags & CritterFlagBits.trapped).toBe(CritterFlagBits.trapped);
    const dev = g.m.critterState(new Uint8Array(g.m.parts.length * 4));
    expect(dev[idx(g.m, box) * 4 + 1]! & DeviceFlagBits.caught).toBe(DeviceFlagBits.caught);
    expect(g.hash).toMatchInlineSnapshot(`"11eae40736a63a11"`);
    g.m.destroy();
  }, 30_000);
});

// ---- extra lures (tests and soaks: no M2 part is a small shiny body, and seeds and snacks come later) ----

describe('lures from MachineOptions.extraLures: Bandit steals, Pip eats', () => {
  /** Bandit, a STITCH made shiny for him, and (far away, to make a noise on demand) THE BUTTON wired to a BANGSTICK. */
  const stealWorld = (): { b: Build; bandit: PartId; stitch: PartId; button: PartId; lures: ExtraLure[] } => {
    const b = new Build();
    const bandit = b.add('bandit', 0, 0, 0);
    const stitch = b.add('stitch', 0.2, 0.04, 1.0);
    const button = b.add('the_button', -4, 0, -2);
    const stick = b.add('bangstick', -4.5, 0.039, -2.5);
    b.link('cable_signal', button, 'out', stick, 'detonator');
    return { b, bandit, stitch, button, lures: [{ part: stitch, radius: 5, species: { bandit: 1 } }] };
  };
  const fsmTick = (ev: readonly SimEvent[], part: PartId, s: CritterFsm): number => ev.find((e) => e.kind === 'CritterState' && e.part === part && e.mag === fsm(s))?.tick ?? -1;

  it('Bandit: seek → steal_grab → steal_carry (the item rides at prop_r; critterCarry says so) → admire, then drops it', async () => {
    const { b, bandit, stitch, lures } = stealWorld();
    const m = new Machine(await jolt(), b, { extraLures: lures });
    const ev: SimEvent[] = [];
    let carried = 0;
    for (let t = 0; t < 1200; t++) {
      m.step();
      ev.push(...m.drainEvents());
      if (m.st.crit.c[0]!.carry >= 0) {
        carried++;
        expect([...m.critterCarry()]).toEqual([idx(m, bandit), idx(m, stitch)]); // who carries what, for the renderer
        const bp = pose(m, bandit), sp = pose(m, stitch).p;
        const want = rotate(bp.q, BANDIT_PROP_R);
        for (let k = 0; k < 3; k++) expect(sp[k]).toBeCloseTo(bp.p[k]! + want[k]!, 4);
      }
    }
    expect(states(ev, bandit).slice(0, 4)).toEqual(['seek', 'steal_grab', 'steal_carry', 'admire']);
    expect(carried).toBeGreaterThan(120);
    expect(of(ev, 'Emote', bandit).map((e) => CRITTER_EMOTES[e.mag])).toEqual(expect.arrayContaining(['sparkle', 'grin']));
    expect(m.st.crit.c[0]!.carry).toBe(-1);
    expect(m.critterCarry()).toHaveLength(0);
    expect(pose(m, stitch).p[1]).toBeLessThan(0.06); // dropped: back on the floor
    expect(Math.hypot(pose(m, stitch).p[0] - 0.2, pose(m, stitch).p[2] - 1.0)).toBeGreaterThan(1); // carried off to the hideout
    m.destroy();
  }, 30_000);

  it('Bandit drops his loot when he tumbles (ragdoll) or is startled (a blast 4 m away)', async () => {
    const J = await jolt();
    const { b, bandit, stitch, button, lures } = stealWorld();
    const probe = new Machine(J, b, { extraLures: lures });
    const tr = trace(probe, 400);
    const carryAt = fsmTick(tr.events, bandit, 'steal_carry');
    expect(carryAt).toBeGreaterThan(0);
    probe.destroy();
    // ragdoll
    const r = new Machine(J, b, { extraLures: lures });
    r.addPoke({ tick: carryAt + 40, seq: 1, partId: bandit, kind: 'impulse', data: [15, 12, 0] });
    const rt = trace(r, carryAt + 200);
    expect(of(rt.events, 'Ragdoll', bandit)[0]?.tick).toBe(carryAt + 40);
    expect(r.st.crit.c[0]!.carry).toBe(-1);
    expect(pose(r, stitch).p[1]).toBeLessThan(0.06);
    r.destroy();
    // startle
    const s = new Machine(J, b, { extraLures: lures });
    s.addPoke({ tick: carryAt + 40, seq: 1, partId: button, kind: 'impulse', data: [0, -1, 0] });
    const sev = trace(s, carryAt + 200).events;
    const boom = of(sev, 'Detonate')[0]!;
    const startle = sev.find((e) => e.kind === 'CritterState' && e.part === bandit && e.mag === fsm('startled'))!;
    expect(startle.tick - boom.tick).toBeLessThanOrEqual(6);
    expect(startle.cause).toBeGreaterThanOrEqual(0); // the blast's Sound
    expect(s.st.crit.c[0]!.carry).toBe(-1);
    s.destroy();
  }, 60_000);

  it('a rollback across the grab hands the item back to the world (M3 critter soak, seed 133)', async () => {
    // Jolt's saved state has no object layers or gravity factors: restoring to before the grab must
    // un-ghost the item, or the re-simulation diverges two ticks after the checkpoint
    const J = await jolt();
    const { b, bandit, stitch, lures } = stealWorld();
    const opts = { extraLures: lures, checkpointEvery: 30, keepCheckpoints: 16 };
    /** The STITCH body's object layer and gravity factor (what Jolt's saved state leaves out). */
    const phys = (m: Machine): [number, number] => {
      const bi = m.bodyInfo().findIndex((x) => x.part === stitch && x.role === 'base');
      const body = m.bodies[bi]!.body;
      return [body.GetObjectLayer(), body.GetMotionProperties().GetGravityFactor()];
    };
    const straight = new Machine(J, b, opts);
    const want = new Map<number, string>();
    const wantPhys = new Map<number, [number, number]>();
    let carryAt = -1;
    while (straight.tick < 600) {
      straight.step();
      if (carryAt < 0) carryAt = fsmTick(straight.drainEvents(), bandit, 'steal_carry'); else straight.drainEvents();
      want.set(straight.tick, straight.hash());
      wantPhys.set(straight.tick, phys(straight));
    }
    expect(carryAt).toBeGreaterThan(0);
    expect(carryAt).toBeLessThan(500);
    straight.destroy();
    const m = new Machine(J, b, opts);
    while (m.tick < carryAt + 30) { m.step(); m.drainEvents(); }
    expect(m.st.crit.c[0]!.carry).toBeGreaterThanOrEqual(0);
    const back = m.restore(carryAt - 2);
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(carryAt);
    expect(m.st.crit.c[0]!.carry).toBe(-1);
    expect(phys(m)).toEqual(wantPhys.get(back)); // a solid, falling STITCH again, not a ghost
    while (m.tick < carryAt + 90) { m.step(); m.drainEvents(); expect(m.hash(), `tick ${m.tick}`).toBe(want.get(m.tick)); }
    m.destroy();
  }, 60_000);

  it('Pip: a seed lure draws him (seek) and he eats it (stuff_cheeks), then ignores it for 20 s', async () => {
    const b = new Build();
    const pip = b.add('pip', 0, 0, 0);
    const m = new Machine(await jolt(), b, { extraLures: [{ pos: [0.6, 0, 0.5], radius: 4, species: { pip: 1 } }] });
    const ev: SimEvent[] = [];
    let ate = -1;
    for (let t = 0; t < 2000; t++) {
      m.step();
      ev.push(...m.drainEvents());
      if (ate < 0 && cstate(m, pip).fsm === 'eat') { ate = t; expect(cstate(m, pip).clip).toBe('stuff_cheeks'); }
    }
    const seq = states(ev, pip);
    expect(seq.slice(0, 2)).toEqual(['seek', 'eat']);
    expect(seq.filter((x) => x === 'eat')).toHaveLength(1); // 2000 ticks < the 20 s it ignores the eaten lure
    expect(of(ev, 'Emote', pip).some((e) => CRITTER_EMOTES[e.mag] === 'seed')).toBe(true);
    expect(ate).toBeGreaterThan(0);
    m.destroy();
  }, 30_000);

  it('steal and eat runs replay identically and survive a late-poke rollback', async () => {
    const J = await jolt();
    const { b, bandit, button, lures } = stealWorld();
    b.add('pip', 2, 0, 1);
    const all: ExtraLure[] = [...lures, { pos: [2.5, 0, 1.6], radius: 4, species: { pip: 1 } }];
    const probe = new Machine(J, b, { extraLures: all });
    const carryAt = fsmTick(trace(probe, 400).events, bandit, 'steal_carry');
    probe.destroy();
    const poke = { tick: carryAt + 30, seq: 1, partId: button, kind: 'impulse' as const, data: [0, -1, 0] };
    const run = (late: boolean): string[] => {
      const m = new Machine(J, b, { extraLures: all });
      if (!late) m.addPoke(poke);
      const h: string[] = [];
      for (let t = 1; t <= 900; t++) {
        m.step(); m.drainEvents();
        if (late && m.tick === poke.tick + 50) {
          m.addPoke(poke);
          const back = m.restore(poke.tick);
          h.length = back / 60;
          while (m.tick < t) { m.step(); m.drainEvents(); if (m.tick % 60 === 0) h.push(m.hash()); }
          continue;
        }
        if (m.tick % 60 === 0) h.push(m.hash());
      }
      m.destroy();
      return h;
    };
    const a = run(false);
    expect(run(false)).toEqual(a);
    expect(run(true)).toEqual(a);
    // the extra lures are part of the run: without them the run differs
    const none = new Machine(J, b);
    expect(trace(none, 900, { hashEvery: 60 }).hashes).not.toEqual(a);
    none.destroy();
  }, 60_000);
});
